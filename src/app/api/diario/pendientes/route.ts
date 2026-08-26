import { createClient, createAdminClient } from '@/lib/supabase/server'
import { todayKey, localDayKey, normalizarObjetivo } from '@/components/shared/helpers'
import { NextResponse } from 'next/server'

// ─────────────────────────────────────────────────────────────────────────────
// Lo MÍO que me propuse en días anteriores y sigue sin hacer.
//
// «Vienen de antes» lo calculaba el cliente mirando TAREAS, y eso lo hacía
// depender de que la tarea existiera: un objetivo escrito en el diario cuya tarea
// no se llegó a crear —porque se escribió antes de que eso funcionara, o porque
// la creación falló— desaparecía al día siguiente sin dejar rastro. Justo lo que
// Javi vio con «Prueba top».
//
// Aquí se mira el DIARIO, que es donde el objetivo está de verdad escrito, y se
// cruza con las tareas solo para saber cuál está hecho. Así el arrastre sobrevive
// aunque la tarea nunca llegara a existir.
//
// Solo lo propio: `user.id` sale de la sesión y no hay parámetro que lo cambie.
// ─────────────────────────────────────────────────────────────────────────────

/** Una línea de objetivo, sin viñetas ni espacios de más. */
const lineas = (t?: string | null) =>
  (t || '').split('\n').map(l => l.replace(/^[-•*\s]+/, '').trim()).filter(Boolean)

// Vive en `shared/helpers.ts`: estaba escrito aquí y en el otro sitio, byte por byte.
const normalizar = normalizarObjetivo

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const hoy = todayKey()
  const desde = new Date(`${hoy}T12:00:00Z`)
  desde.setUTCDate(desde.getUTCDate() - 14)
  const desdeClave = localDayKey(desde.toISOString())

  const [{ data: entradas, error: errD }, { data: tareas, error: errT }] = await Promise.all([
    admin.from('diario').select('dia,entrada').eq('user_id', user.id).gte('dia', desdeClave).lt('dia', hoy),
    // Mías incluye las compartidas: si la cierra el co-responsable, el objetivo
    // ESTÁ hecho, y sin esto volvería mañana a decirme que lo tengo pendiente.
    admin.from('tasks').select('id,text,done,diario_dia,diario_objetivo')
      .or(`assigned_to.eq.${user.id},co_assigned_to.eq.${user.id}`),
  ])

  // supabase-js no lanza: sin mirar el error, un fallo se leería como «no tienes
  // nada pendiente», que es indistinguible de la verdad y peor que un error.
  if (errD || errT) {
    return NextResponse.json({ error: (errD || errT)!.message }, { status: 500 })
  }

  const hechas = new Set(
    (tareas || []).filter(t => t.done).flatMap(t => [
      t.diario_objetivo ? normalizar(t.diario_objetivo) : '',
      normalizar(t.text || ''),
    ].filter(Boolean)),
  )
  // Los objetivos que YA tienen tarea viva se dejan fuera: de esos se encarga la
  // lista de tareas del cliente, y meterlos aquí los duplicaría en pantalla.
  const conTarea = new Set(
    (tareas || []).filter(t => !t.done).flatMap(t => [
      t.diario_objetivo ? normalizar(t.diario_objetivo) : '',
      normalizar(t.text || ''),
    ].filter(Boolean)),
  )

  const vistos = new Set<string>()
  const pendientes: { dia: string; texto: string }[] = []
  // De más reciente a más antiguo: si el mismo objetivo se repitió varios días, se
  // enseña una vez y con la fecha en que se escribió por última vez.
  for (const e of (entradas || []).sort((a, b) => b.dia.localeCompare(a.dia))) {
    for (const o of lineas(e.entrada)) {
      const k = normalizar(o)
      if (!k || vistos.has(k) || hechas.has(k) || conTarea.has(k)) continue
      vistos.add(k)
      pendientes.push({ dia: e.dia, texto: o })
    }
  }

  return NextResponse.json({ pendientes: pendientes.slice(0, 30) })
}
