import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/inbox/thread?withUserId=X
// Devuelve la conversacion interna entre quien llama y otro miembro del equipo.
// EquipoSection sigue mandando `withName` en la URL, pero aqui se IGNORA a
// proposito: ver el bloque de abajo.
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
  const { data: perfiles, error: perfilesErr } = await admin.from('profiles').select('id,name')
  if (perfilesErr || !perfiles) {
    console.error('[inbox/thread] no se pudieron leer los perfiles:', perfilesErr?.message)
    return NextResponse.json({ error: 'No se pudo identificar tu perfil' }, { status: 500 })
  }

  const limpia = (s: string | null | undefined) => (s || '').trim()
  const miNombre = limpia(perfiles.find(p => p.id === user.id)?.name)
  // El nombre del otro sale de la BD por su id, NO del `withName` de la URL: lo
  // de la URL lo escribe el cliente y aqui decide que filas se leen.
  const nombreOtro = limpia(perfiles.find(p => p.id === withUserId)?.name)

  if (!miNombre) {
    console.error('[inbox/thread] el perfil del llamante no tiene nombre:', user.id)
    return NextResponse.json({ error: 'No se pudo identificar tu perfil' }, { status: 500 })
  }
  if (!nombreOtro) return NextResponse.json({ error: 'Compañero no encontrado' }, { status: 404 })

  // Sin mayusculas ni espacios a proposito: para el filtro de abajo "Pablo" y
  // "pablo " son valores distintos, pero como identidad son la misma persona y
  // basta con que dos perfiles lo hayan compartido un rato para que queden
  // mensajes cruzados. Aqui interesa detectar la ambigüedad, no casar filas.
  const homonimos = (n: string) =>
    perfiles.filter(p => limpia(p.name).toLowerCase() === n.toLowerCase()).length > 1
  if (homonimos(miNombre) || homonimos(nombreOtro)) {
    console.error('[inbox/thread] dos perfiles con el mismo nombre: hilo ambiguo, no se sirve')
    return NextResponse.json(
      { error: 'Hay dos personas con el mismo nombre en el equipo: cambiad uno para poder abrir la conversación' },
      { status: 409 },
    )
  }

  // El nombre COMPLETO y exacto, no el de pila con ilike.
  //
  // Antes era `ilike('from_name', '%' + primerNombre + '%')`. Con dos cuentas que
  // empiezan igual —ahora mismo hay una "Javi" y una "Javi Valero"— los dos hilos
  // se mezclaban: en la conversacion con una veias los mensajes de la otra. Leer
  // mensajes de un companero creyendo que son de otro es de lo peor que puede
  // hacer esta seccion.
  const receivedQuery = admin
    .from('inbox_messages')
    .select('*')
    .eq('user_id', user.id)
    .eq('source', 'internal')
    .eq('from_name', nombreOtro)
    .order('received_at', { ascending: true })

  const sentQuery = admin
    .from('inbox_messages')
    .select('*')
    .eq('user_id', withUserId)
    .eq('source', 'internal')
    .eq('from_name', miNombre)
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
