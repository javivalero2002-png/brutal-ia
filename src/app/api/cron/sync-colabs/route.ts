import { createAdminClient } from '@/lib/supabase/server'
import { syncColabsInbox, syncPersonalInbox } from '@/lib/colabsSync'
import { runAutomations } from '@/lib/automations'
import { madridHour } from '@/components/shared/helpers'
import { acquireLock, releaseLock } from '@/lib/jobLock'
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

  // Presupuesto de tiempo para TODA la ejecución.
  //
  // El cron hace en serie: buzón compartido → los buzones personales de todo el
  // equipo → motor de automatizaciones → purga de retención. Cada email nuevo
  // cuesta una llamada a Claude, y en el plan Hobby la función se MATA a los 60s.
  // Con 7 personas con Gmail conectado, los buzones podían comerse el tiempo
  // entero y dejar sin ejecutar el motor — que es justo lo que crea tareas y
  // avisa al equipo. Y sin ninguna señal: la ejecución simplemente moría.
  //
  // Se reserva margen para la cola. Si los buzones agotan lo suyo, se paran y el
  // motor se ejecuta igual; los buzones que falten van en la siguiente hora.
  const T0 = Date.now()
  const PARA_BUZONES_MS = 38_000
  const quedaTiempo = () => Date.now() - T0 < PARA_BUZONES_MS
  const pendientes: string[] = []

  // Estados que NO son fallos: el buzón simplemente no está conectado. Tratarlos
  // como error dejaría el cron en rojo permanente en un estudio que aún no ha
  // conectado el buzón compartido — y un rojo permanente se ignora enseguida.
  const NOT_CONNECTED = new Set(['Colaboraciones not connected', 'not connected'])

  type Outcome = { mailbox: string; ok: boolean; synced?: number; insertFailures?: number; error?: string; terminal?: boolean }
  const outcomes: Outcome[] = []

  const record = (mailbox: string, r: any) => {
    if (r.ok) {
      // ok:true con inserts fallidos NO es verde. El análisis con Claude ocurre
      // ANTES del insert: si el insert falla, el gmail_id no se guarda y la
      // ejecución siguiente vuelve a analizar los mismos emails y a pagarlos.
      // Contarlo como éxito es lo que dejaba ese bucle caro corriendo en
      // silencio cada hora, sin que nadie mirara.
      const fallos = r.insertFailures ?? 0
      outcomes.push({
        mailbox,
        ok: fallos === 0,
        synced: r.synced,
        ...(fallos > 0 ? { insertFailures: fallos, error: `${fallos} emails analizados no se pudieron guardar` } : {}),
      })
      return
    }
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

  // Se empieza por una posición distinta cada hora. Recorriendo siempre en el
  // mismo orden, si el tiempo se agota son SIEMPRE los mismos últimos perfiles los
  // que se quedan sin sincronizar — para ellos el cron no existiría. Rotando, en
  // 24 ejecuciones le toca a todo el mundo.
  const lista = profiles || []
  const inicio = lista.length ? madridHour() % lista.length : 0
  for (let i = 0; i < lista.length; i++) {
    const p = lista[(inicio + i) % lista.length]
    if (!quedaTiempo()) { pendientes.push(p.id); continue }
    record(p.id, await syncPersonalInbox(admin, p))
  }
  if (pendientes.length) {
    console.warn(`[cron] sin tiempo para ${pendientes.length} buzón(es); se sincronizan en la siguiente ejecución`)
  }

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
  //
  // El disparo va por CERROJO DE DÍA, no por «la hora 4 en punto».
  //
  // Antes la condición era `getUTCHours() === 4`, y eso tiene una única
  // oportunidad al día: si esa ejecución concreta no llega hasta aquí, la purga
  // se salta el día entero y sin dejar rastro. Formas de perderla, todas reales:
  //   · la función se mata a los 60s de Hobby antes de esta línea — el
  //     presupuesto de 38s solo acota los buzones, runAutomations va sin tope;
  //   · el cron de esa hora no se dispara (despliegue en curso, fallo de plataforma);
  //   · se retrasa cruzando la hora, y entonces getUTCHours() ya no vale 4.
  // Y el modo de fallo es justo el que este código venía a evitar: las tablas
  // crecen sin que nadie lo note, porque ningún otro sitio las borra.
  //
  // Con el cerrojo, la purga la hace la PRIMERA ejecución del día que llegue aquí,
  // y si falla se suelta para que lo reintente la siguiente hora. Se conserva la
  // preferencia por la madrugada (>= 04:00 UTC) porque es cuando menos molesta,
  // pero ahora es un suelo, no una cita exacta: quedan 20 ejecuciones de margen.
  //
  // La clave va en día UTC y no de Madrid, al revés que el resto del repo. Aquí no
  // hay lógica de negocio —esto no es un deadline que ve un usuario— sino un
  // calendario de mantenimiento anclado al mismo reloj que la condición horaria.
  // Mezclar día de Madrid con hora UTC haría que la purga corriera dos veces en la
  // franja en que no coinciden.
  let retention: Record<string, number> | { error: string } | null = null
  const ahoraUTC = new Date()
  if (ahoraUTC.getUTCHours() >= 4) {
    // El día se compone con los getters UTC explícitos en vez de recortar los diez
    // primeros caracteres del ISO. Da lo mismo, pero deja la intención por escrito:
    // recortar un ISO es justo la forma del bug de zona horaria que hay tests para
    // impedir, y «aquí sí quiero UTC» es lo que dice todo el que lo introduce sin
    // querer. (El comentario tampoco nombra esa llamada: el test que la persigue
    // escanea el texto del fichero y no distingue código de prosa.)
    const dia = [
      ahoraUTC.getUTCFullYear(),
      String(ahoraUTC.getUTCMonth() + 1).padStart(2, '0'),
      String(ahoraUTC.getUTCDate()).padStart(2, '0'),
    ].join('-')
    const clave = `retencion-${dia}`
    // 25h: más que un día, para que el cerrojo del día siga vigente hasta que la
    // clave del día siguiente lo sustituya.
    const cerrojo = await acquireLock(admin, clave, 25 * 3600_000)
    if (cerrojo.adquirido) {
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
          // La propia tabla de cerrojos: una fila por día se acumularía para
          // siempre. Los vigentes no se tocan, y el de hoy caduca en 25h.
          job_locks: await purge('job_locks', 'expires_at', 0),
        }
      } catch (err: any) {
        // No tumba el cron: el sync de emails es más importante que la poda.
        // Se suelta el cerrojo para que la purga se reintente en la hora
        // siguiente en vez de perderse hasta mañana.
        console.error('[cron] retención falló:', err?.message)
        if (!cerrojo.degradado) await releaseLock(admin, clave, cerrojo.holder)
        retention = { error: err?.message || 'error' }
      }
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
    // Visible desde fuera: si esto es > 0 de forma sostenida, el presupuesto se
    // queda corto y hay que repartir los buzones en mas ejecuciones.
    ...(pendientes.length ? { aplazados: pendientes.length } : {}),
    automations,
    ...(retention ? { retention } : {}),
  }, { status: failed ? 500 : 200 })
}
