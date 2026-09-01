import { createClient, createAdminClient } from '@/lib/supabase/server'
import { codigoHttpDeError, mensajeDeError } from '@/lib/respuestaDb'
import { NextRequest, NextResponse } from 'next/server'

// Solo columnas conocidas: campos desconocidos no deben tumbar la petición
// ni permitir escribir columnas arbitrarias (p. ej. created_by).
const pick = (obj: any, keys: string[]) => Object.fromEntries(Object.entries(obj || {}).filter(([k, v]) => keys.includes(k) && v !== undefined))


export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()
  const { data, error } = await admin.from('clients').select('*').order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Cualquier miembro del equipo autenticado puede crear clientes (el borrado sigue siendo solo-owner)
  const admin = await createAdminClient()

  // La facturación la fija solo el owner, IGUAL QUE AL EDITARLA: el PATCH de
  // clients/[id] condiciona su allowlist por rol desde el principio, y este POST
  // la aceptaba de cualquiera — el mismo dato con dos puertas y una sin cerrojo.
  // Un miembro creaba un cliente con un importe y el MRR del panel lo sumaba.
  // El campo se descarta en silencio: el modal ya no se lo enseña a quien no es
  // owner, así que si llega es un cliente manipulado, no una persona confundida.
  const { data: perfilCreador } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  const esOwner = perfilCreador?.role === 'owner'

  const body = await request.json()
  // DOS LETRAS SIEMPRE.
  //
  // Cogía la inicial de hasta dos palabras, así que «Ginebra Exótica» daba «GE»
  // pero «Panrico» daba «P»: una sola letra en un círculo pensado para dos, al
  // lado de los que sí tienen dos. La mitad de las marcas son de una palabra.
  //
  // Y `[^A-Za-z ]` no quitaba solo los símbolos: se comía las TILDES y la Ñ. En
  // una app en español eso es un cliente llamado «Ñandú» convertido en «andú», y
  // uno llamado «Óptica Ñ» reducido al fallback. Se normaliza y se descompone
  // (NFD) para separar el acento de la letra, que es lo que deja la letra viva.
  const limpio = (body.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    // Los DÍGITOS también: «3M» se quedaba en «M» y «M80» en «M». Una marca con
    // cifra no es rara, y perderla convierte dos clientes distintos en el mismo
    // círculo.
    .replace(/[^A-Za-z0-9 ]/g, ' ')
  const palabras = limpio.split(' ').filter(Boolean)
  const initials = (palabras.length >= 2
    ? palabras.slice(0, 2).map((w: string) => w[0]).join('')
    : (palabras[0] || '').slice(0, 2)
  ).toUpperCase() || 'CL'

  const { data, error } = await admin
    .from('clients')
    .insert({ ...pick(body, esOwner ? ['name','industry','status','revenue','notes','color'] : ['name','industry','status','notes','color']), initials, created_by: user.id })
    .select()
    .single()

  // 400 si la culpa es del cliente (un status fuera del CHECK, p. ej.), 500 si es nuestra.
  if (error) return NextResponse.json({ error: mensajeDeError(error) }, { status: codigoHttpDeError(error) })
  return NextResponse.json(data)
}
