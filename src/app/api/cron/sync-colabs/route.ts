import { createAdminClient } from '@/lib/supabase/server'
import { syncColabsInbox, syncPersonalInbox } from '@/lib/colabsSync'
import { runAutomations } from '@/lib/automations'
import { NextRequest, NextResponse } from 'next/server'

// Analizar varios buzones con IA puede superar los 10s por defecto
export const maxDuration = 60

// ⚠️ NO colapsar los 24 crons de vercel.json en un solo `0 * * * *`.
// Esta cuenta es plan Hobby, donde cada cron job debe ser como máximo DIARIO.
// Las 24 entradas (`0 0 * * *` … `0 23 * * *`) son un apaño deliberado: cada una
// es legalmente diaria, y juntas dan cobertura horaria. Un único `0 * * * *`
// hace que el deploy falle con "Hobby accounts are limited to daily cron jobs".
//
// Cron de Vercel (horario, ver vercel.json): sincroniza el buzón compartido de
// colaboraciones Y el Gmail personal de cada perfil conectado, sin sesión de
// usuario — los pushes de emails llegan aunque nadie tenga la app abierta.
// Vercel añade automáticamente `Authorization: Bearer ${CRON_SECRET}` a la petición.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = await createAdminClient()

  // Estados que NO son fallos: el buzón simplemente no está conectado. Tratarlos
  // como error dejaría el cron en rojo permanente en un estudio que aún no ha
  // conectado el buzón compartido — y un rojo permanente se ignora enseguida.
  const NOT_CONNECTED = new Set(['Colaboraciones not connected', 'not connected'])

  type Outcome = { mailbox: string; ok: boolean; synced?: number; error?: string; terminal?: boolean }
  const outcomes: Outcome[] = []

  const record = (mailbox: string, r: any) => {
    if (r.ok) { outcomes.push({ mailbox, ok: true, synced: r.synced }); return }
    if (NOT_CONNECTED.has(r.error)) return // configuración, no fallo
    // token_expired requiere que un humano reconecte Gmail: es accionable.
    outcomes.push({ mailbox, ok: false, error: r.error, terminal: r.error === 'token_expired' })
  }

  record('colabs', await syncColabsInbox(admin))

  // Buzones personales de todos los perfiles con Gmail conectado
  const { data: profiles, error: profilesError } = await admin
    .from('profiles')
    .select('id, gmail_refresh_token')
    .eq('gmail_connected', true)
    .not('gmail_refresh_token', 'is', null)

  if (profilesError) {
    console.error('[cron] no se pudieron leer los perfiles:', profilesError.message)
    outcomes.push({ mailbox: 'profiles', ok: false, error: profilesError.message, terminal: true })
  }

  for (const p of profiles || []) record(p.id, await syncPersonalInbox(admin, p))

  // Motor de automatizaciones: tras sincronizar los buzones, evalúa las reglas
  // activas (crear tareas / avisar) sobre los datos ya frescos. Best-effort:
  // un fallo aquí no debe tumbar el sync de emails.
  let automations: { ran: number } | { error: string } = { ran: 0 }
  try {
    const { ran } = await runAutomations(admin)
    automations = { ran }
  } catch (err: any) {
    console.error('[cron] runAutomations falló:', err?.message)
    automations = { error: err?.message || 'error' }
  }

  // Retención de datos, una vez al día (a las 04:00 UTC de las 24 ejecuciones).
  // Va aquí y no en un borrado manual porque manual = se hace una vez y nunca
  // más. Ninguna de estas tablas tenía borrado en ningún sitio: los límites del
  // código son solo de LECTURA (.limit(100)), así que crecen sin que se note.
  // Para un estudio en la UE, además, guardar correspondencia de clientes sin
  // plazo es exposición de RGPD (art. 5.1.e).
  // Los emails SIN LEER no se tocan nunca.
  let retention: Record<string, number> | { error: string } | null = null
  if (new Date().getUTCHours() === 4) {
    try {
      const purge = async (table: string, col: string, days: number) => {
        const cutoff = new Date(Date.now() - days * 86400000).toISOString()
        // El count va como opción del delete(), no en un .select() posterior.
        let q = admin.from(table).delete({ count: 'exact' }).lt(col, cutoff)
        if (table === 'inbox_messages') q = q.eq('is_read', true)
        const { error, count } = await q
        if (error) throw new Error(`${table}: ${error.message}`)
        return count || 0
      }
      retention = {
        inbox_messages: await purge('inbox_messages', 'received_at', 180),
        notification_log: await purge('notification_log', 'created_at', 30),
        chat_messages: await purge('chat_messages', 'created_at', 90),
        rate_limits: await purge('rate_limits', 'window_start', 1),
        push_rate_limits: await purge('push_rate_limits', 'last_sent', 1),
      }
    } catch (err: any) {
      // No tumba el cron: el sync de emails es más importante que la poda.
      console.error('[cron] retención falló:', err?.message)
      retention = { error: err?.message || 'error' }
    }
  }

  const failures = outcomes.filter(o => !o.ok)
  const attempted = outcomes.length
  // Devolver 500 hace que Vercel marque la ejecución como fallida en el panel.
  // Antes esto siempre era 200 {ok:true} con los errores enterrados en el cuerpo:
  // el dashboard salía verde mientras no se sincronizaba nada.
  // Se falla solo cuando hay algo que hacer — un token caducado (hay que
  // reconectar Gmail) o que TODOS los buzones intentados fallen. Un fallo suelto
  // y transitorio (429/5xx de Gmail en 1 de 7) no debe pintar el cron de rojo:
  // 24 rojos al día enseñan al equipo a ignorar el rojo, y volvemos al punto de partida.
  const terminal = failures.filter(o => o.terminal)
  // `attempted >= 2` y no `> 0`: con un solo buzón conectado (lo normal aquí),
  // "todos fallaron" es lo mismo que "falló uno", así que un 429 puntual de Gmail
  // pintaría de rojo las 24 ejecuciones del día — justo la fatiga de alarma que
  // este código quería evitar. Un fallo transitorio queda en el console.error.
  const allFailed = attempted >= 2 && failures.length === attempted
  const failed = terminal.length > 0 || allFailed

  if (failures.length) {
    console.error(`[cron] ${failures.length}/${attempted} buzones fallaron:`,
      failures.map(f => `${f.mailbox}=${f.error}`).join(' | '))
  }

  return NextResponse.json({
    ok: !failed,
    synced: outcomes.filter(o => o.ok).reduce((n, o) => n + (o.synced || 0), 0),
    mailboxes: outcomes,
    automations,
    ...(retention ? { retention } : {}),
  }, { status: failed ? 500 : 200 })
}
