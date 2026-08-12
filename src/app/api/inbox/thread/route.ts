import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/inbox/thread?withUserId=X&withName=Name
// Returns all internal messages between current user and the other user
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const withUserId = searchParams.get('withUserId')
  const withName = searchParams.get('withName') || ''

  if (!withUserId) return NextResponse.json({ error: 'withUserId required' }, { status: 400 })

  const admin = await createAdminClient()

  const { data: myProfile } = await admin.from('profiles').select('name').eq('id', user.id).single()
  const myName = myProfile?.name || ''

  // El nombre COMPLETO y exacto, no el de pila con ilike.
  //
  // Antes era `ilike('from_name', '%' + primerNombre + '%')`. Con dos cuentas que
  // empiezan igual —ahora mismo hay una "Javi" y una "Javi Valero"— los dos hilos
  // se mezclaban: en la conversacion con una veias los mensajes de la otra. Leer
  // mensajes de un companero creyendo que son de otro es de lo peor que puede
  // hacer esta seccion.
  //
  // Lo correcto seria emparejar por id del remitente, pero inbox_messages solo
  // guarda `from_name` (lo escribe POST /api/inbox, sacandolo de la sesion) y
  // añadir una columna es tocar el esquema, que va aparte. El nombre exacto
  // resuelve el caso real y no empeora ninguno: dos personas con el nombre
  // ENTERO identico seguirian mezclandose, y eso ya no se puede distinguir aqui.
  //
  // El nombre viene de la URL, pero no hace falta validarlo: solo se usa para
  // filtrar mensajes cuyo user_id ya esta acotado a los dos participantes.
  const nombreOtro = withName.trim()
  const miNombre = myName.trim()

  let receivedQuery = admin
    .from('inbox_messages')
    .select('*')
    .eq('user_id', user.id)
    .eq('source', 'internal')
    .order('received_at', { ascending: true })
  if (nombreOtro) receivedQuery = receivedQuery.eq('from_name', nombreOtro)

  let sentQuery = admin
    .from('inbox_messages')
    .select('*')
    .eq('user_id', withUserId)
    .eq('source', 'internal')
    .order('received_at', { ascending: true })
  if (miNombre) sentQuery = sentQuery.eq('from_name', miNombre)

  const [{ data: received }, { data: sent }] = await Promise.all([receivedQuery, sentQuery])

  // Merge + sort by time, mark direction
  const thread = [
    ...(received || []).map(m => ({ ...m, _dir: 'received' })),
    ...(sent || []).map(m => ({ ...m, _dir: 'sent' })),
  ].sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime())

  return NextResponse.json(thread)
}
