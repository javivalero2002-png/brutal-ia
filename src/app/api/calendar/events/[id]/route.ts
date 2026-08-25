import { createClient, createAdminClient } from '@/lib/supabase/server'
import { tokenParaCorreo, personalesDe } from '@/lib/gmailCuentas'
import { deleteCalendarEvent, updateCalendarEvent } from '@/lib/gmail'
import { NextRequest, NextResponse } from 'next/server'

/**
 * El token con el que se toca la agenda de esta persona.
 *
 * Antes esto devolvia el perfil y cada sitio leia `gmail_refresh_token`, que es
 * UNA ranura que el callback pisa en cada conexion: con dos cuentas personales,
 * borrar o editar un evento iba a la agenda de la otra.
 *
 * `tokenParaCorreo(..., null)` cae a la cuenta MAS ANTIGUA, que es la que esa
 * persona conecto primero. Es una eleccion, pero es una eleccion que significa
 * algo — «la ultima que paso por el callback» no.
 */
/**
 * El token con el que se toca ESTE evento.
 *
 * `cuenta` es la direccion del buzon del que salio el evento, que el GET pega a
 * cada uno. Sin ella, borrar o editar un evento de la segunda cuenta se hacia con
 * el token de la primera: Google contesta que ese evento no existe y el usuario ve
 * «Error eliminando evento» sin ninguna pista.
 *
 * Es la mitad que faltaba del arreglo de hoy: la lectura paso a ser de varias
 * cuentas y la escritura se quedo en una.
 */
async function tokenDeAgenda(userId: string, cuenta: string | null) {
  const admin = await createAdminClient()
  const { token } = await tokenParaCorreo(admin, userId, cuenta)
  return { token, hayCuenta: !!token }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: eventId } = await params
  const cuenta = new URL(_req.url).searchParams.get('cuenta')
  const { token, hayCuenta } = await tokenDeAgenda(user.id, cuenta)
  if (!hayCuenta) {
    return NextResponse.json({ error: 'Gmail no conectado' }, { status: 400 })
  }

  // El calendario llega del cliente, y no hace falta más: el token es el SUYO,
  // así que solo puede alcanzar calendarios a los que su propia cuenta de Google
  // ya tiene acceso. Google es quien decide, y devuelve 403 si no toca.
  const calendarId = new URL(_req.url).searchParams.get('calendarId') || 'primary'

  try {
    await deleteCalendarEvent(token!, eventId, calendarId)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('Calendar delete error:', err?.message)
    return NextResponse.json({ error: 'Error eliminando evento' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: eventId } = await params
  // El cuerpo se lee ANTES de resolver el token: la cuenta viene en él, y sin
  // leerla primero volveríamos a escribir en la agenda equivocada.
  const { title, date, time, calendarId, cuenta } = await request.json()

  const { token, hayCuenta } = await tokenDeAgenda(user.id, typeof cuenta === 'string' ? cuenta : null)
  if (!hayCuenta) {
    return NextResponse.json({ error: 'Gmail no conectado' }, { status: 400 })
  }

  try {
    const result = await updateCalendarEvent(token!, eventId, { title, date, time, calendarId })
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('Calendar update error:', err?.message)
    return NextResponse.json({ error: 'Error actualizando evento' }, { status: 500 })
  }
}
