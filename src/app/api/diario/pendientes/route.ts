import { createClient, createAdminClient } from '@/lib/supabase/server'
import { todayKey, localDayKey } from '@/components/shared/helpers'
import { NextResponse } from 'next/server'

export const maxDuration = 30

// ─────────────────────────────────────────────────────────────────────────────
// MIS DÍAS SIN CERRAR.
//
// Javi: «¿qué pasa si no cierras el día? Al día siguiente, cuando abras la app,
// que te salga un aviso».
//
// Lo que había: un push a las 20:00 y una regla que se lo cuenta al jefe. O sea
// que el aviso existía para todo el mundo MENOS para quien tiene que cerrarlo,
// dentro de la app, que es donde se cierra.
//
// Solo MÍOS y solo del pasado: el de hoy está abierto por definición.
// ─────────────────────────────────────────────────────────────────────────────

/** Cuántos días atrás se mira. Más allá, cerrar «a ver qué pasó» es inventarlo. */
const DIAS_ATRAS = 7

const HORA_MADRID = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false,
})

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const hoy = todayKey()
  const desde = new Date(`${hoy}T12:00:00Z`)
  desde.setUTCDate(desde.getUTCDate() - DIAS_ATRAS)
  const desdeClave = localDayKey(desde)

  const [{ data: filas, error: eDiario }, { data: tareas, error: eTareas }] = await Promise.all([
    admin.from('diario').select('dia, entrada, entrada_at, cierre_at, updated_at')
      .eq('user_id', user.id).gte('dia', desdeClave).lt('dia', hoy).order('dia', { ascending: true }),
    admin.from('tasks').select('id, text, done, completed_at, diario_dia, diario_objetivo')
      .eq('assigned_to', user.id).gte('diario_dia', desdeClave).lt('diario_dia', hoy),
  ])
  // Un fallo al leer NO puede pintarse como «no hay ninguno»: sería decirle a
  // alguien que tiene sus días cerrados sin haberlos mirado.
  if (eDiario || eTareas) {
    console.error('[diario/pendientes] no se pudo revisar:', eDiario?.message || '', eTareas?.message || '')
    return NextResponse.json({ error: 'No se pudieron revisar los días' }, { status: 500 })
  }

  const dias = (filas || [])
    .filter(f => f.entrada_at && !f.cierre_at)
    .map(f => {
      const delDia = (tareas || []).filter(t => t.diario_dia === f.dia)
      // Los objetivos se guardan uno por línea en `entrada`, que es el formato que
      // permite tacharlos luego. La tarea se empareja por `diario_objetivo`, no
      // por el texto: editar el texto de la tarea en Tareas rompería el vínculo.
      const objetivos = String(f.entrada || '').split('\n').map(s => s.trim()).filter(Boolean)
        .map(texto => {
          const t = delDia.find(x => String(x.diario_objetivo || '').trim() === texto)
          return { texto, hecha: !!t?.done, taskId: (t?.id as string) || null }
        })

      // LA HORA QUE SE SUGIERE SALE DE UNA SEÑAL REAL, no de un número redondo.
      // La última tarea que completaste ese día, o la última vez que se tocó la
      // fila. Si no hay ninguna, no se sugiere nada y la pantalla la pide: nadie
      // debería inventarle horas trabajadas a nadie, y menos si las mira un jefe.
      const marcas = [
        ...delDia.map(t => t.completed_at).filter(Boolean) as string[],
        ...(f.updated_at && localDayKey(f.updated_at) === f.dia ? [f.updated_at as string] : []),
      ].filter(m => localDayKey(m) === f.dia && new Date(m) > new Date(f.entrada_at as string))
      const ultima = marcas.sort().at(-1) || null

      return {
        dia: f.dia,
        entrada_at: f.entrada_at,
        entro: HORA_MADRID.format(new Date(f.entrada_at as string)),
        objetivos,
        horaSugerida: ultima ? HORA_MADRID.format(new Date(ultima)) : null,
      }
    })

  return NextResponse.json({ dias })
}
