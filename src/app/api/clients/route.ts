import { createClient, createAdminClient } from '@/lib/supabase/server'
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
    .insert({ ...pick(body, ['name','industry','status','revenue','notes','color']), initials, created_by: user.id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
