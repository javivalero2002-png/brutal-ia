import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/inbox/thread?withUserId=X
// Devuelve la conversacion interna entre quien llama y otro miembro del equipo.
// El emparejado va por `from_user_id` desde la migracion 20260813: ver abajo.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const withUserId = searchParams.get('withUserId')

  if (!withUserId) return NextResponse.json({ error: 'withUserId required' }, { status: 400 })

  const admin = await createAdminClient()

  // ── Por que se leen TODOS los perfiles y no solo los dos implicados ──────────
  //
  // `inbox_messages` no guarda el id del remitente: solo `from_name` (lo escribe
  // POST /api/inbox sacandolo de la sesion). Emparejar el hilo por nombre es lo
  // unico posible sin tocar el esquema, pero un nombre NO es una identidad:
  // `profiles.name` no es unique (schema.sql:13, solo `email` lo es) y cualquiera
  // se lo puede cambiar con PATCH /api/profile.
  //
  // El agujero que habia: `sentQuery` filtra `user_id = withUserId` (id crudo de
  // la URL) + `from_name = miNombre`. Renombrandome "Pablo" esa consulta me
  // devolvia los DM que PABLO le ha mandado a quien yo pusiera en la URL —
  // leer la conversacion privada de otros dos compañeros con dos lineas de curl.
  //
  // Sin columna nueva no hay forma de distinguir a dos homonimos, asi que la
  // ruta se NIEGA: si el nombre de cualquiera de los dos lados lo lleva mas de un
  // perfil, el emparejamiento es ambiguo y se corta con 409 en vez de servir
  // mensajes que a lo mejor no son de quien dice el hilo. Con nombres distintos
  // —el caso real, siete personas— no cambia nada.
  //
  // Antes se leia solo `profiles.name` del llamante y se descartaba el `error`.
  // supabase-js no lanza: `myName` caia a '' y entonces el `eq('from_name', ...)`
  // NO se aplicaba, con lo que la ruta listaba TODOS los mensajes internos
  // recibidos por `withUserId`, vinieran de quien vinieran. Degradar aqui es
  // abrir la bandeja de otro, asi que se corta con 500.
  // Que el otro exista de verdad, y nada mas. El nombre ya NO decide que filas se
  // leen: para eso esta `from_user_id` desde la migracion 20260813.
  const { data: otro, error: otroErr } = await admin
    .from('profiles').select('id').eq('id', withUserId).maybeSingle()
  if (otroErr) {
    console.error('[inbox/thread] no se pudo comprobar el perfil:', otroErr.message)
    return NextResponse.json({ error: 'No se pudo cargar la conversación' }, { status: 500 })
  }
  if (!otro) return NextResponse.json({ error: 'Compañero no encontrado' }, { status: 404 })

  // Se empareja por `from_user_id`, no por `from_name`.
  //
  // Emparejar por nombre era el agujero de esta ruta: `profiles.name` no es unique
  // y cualquiera se lo cambia con PATCH /api/profile, asi que renombrandote como un
  // compañero esta consulta te devolvia los DM que EL le habia mandado a un
  // tercero. El 2026-08-13 se tapo lo tapable sin esquema (cortar con 409 ante
  // homonimos, impedir nombres repetidos), pero quedaba vivo un caso: un nombre
  // liberado por un renombrado antiguo seguia casando los mensajes historicos.
  //
  // SIN respaldo por nombre a proposito. Una fila sin `from_user_id` simplemente no
  // aparece, y eso es lo correcto: mantener el respaldo seria mantener el agujero
  // para justo las filas que lo sufren. Se verifico antes de migrar que
  // `inbox_messages` tenia CERO filas con source='internal', asi que no se pierde
  // ningun mensaje real.
  const receivedQuery = admin
    .from('inbox_messages')
    .select('*')
    .eq('user_id', user.id)
    .eq('source', 'internal')
    .eq('from_user_id', withUserId)
    .order('received_at', { ascending: true })

  const sentQuery = admin
    .from('inbox_messages')
    .select('*')
    .eq('user_id', withUserId)
    .eq('source', 'internal')
    .eq('from_user_id', user.id)
    .order('received_at', { ascending: true })

  const [recibidos, enviados] = await Promise.all([receivedQuery, sentQuery])

  // Los dos `error` se descartaban. Si reventaba la consulta `sent`, la ruta
  // respondia 200 con solo lo recibido: la conversacion salia como si nunca
  // hubieras contestado a ese compañero, y se reescribe algo ya enviado. Aqui va
  // 500 y no `{ parcial: true }` como /api/notifications porque el cliente
  // (EquipoSection.openThread) hace `Array.isArray(msgs) ? msgs : []` y pintaria
  // "Sin mensajes aun"; con !r.ok ya enseña el aviso de que no se pudo cargar.
  if (recibidos.error || enviados.error) {
    console.error('[inbox/thread] consulta fallida:', recibidos.error?.message || enviados.error?.message)
    return NextResponse.json({ error: 'No se pudo cargar la conversación' }, { status: 500 })
  }

  // Merge + sort by time, mark direction
  const thread = [
    ...(recibidos.data || []).map(m => ({ ...m, _dir: 'received' })),
    ...(enviados.data || []).map(m => ({ ...m, _dir: 'sent' })),
  ].sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime())

  return NextResponse.json(thread)
}
