import { getAuthCtx } from '@/lib/authz'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { account } = await request.json()
  const { admin, userId, role } = ctx

  if (account === 'colabs') {
    // Desconectar el buzón COMPARTIDO es infraestructura de la empresa, no una
    // preferencia personal: borra el token de TODOS los perfiles y deja al equipo
    // entero sin sincronización de correo hasta que alguien lo reconecte.
    //
    // Antes esta rama no comprobaba nada. La asimetría era clara y no intencionada:
    // la rama personal se limita a `user.id` (tu cuenta y solo la tuya) mientras
    // esta afectaba a los siete, desde un botón que además está a la vista de todos.
    // No hace falta mala fe — basta con pulsar el botón equivocado.
    if (role !== 'owner') {
      return NextResponse.json(
        { error: 'Solo el propietario puede desconectar el buzón compartido' },
        { status: 403 },
      )
    }
    // El token de colabs puede pertenecer a un perfil distinto del actual (quien lo
    // conectó la última vez), así que se limpia de todos los que lo tengan.
    const { error } = await admin
      .from('profiles')
      .update({ gmail_colabs_connected: false, gmail_colabs_refresh_token: null, gmail_colabs_account: null })
      .not('gmail_colabs_refresh_token', 'is', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await admin
      .from('profiles')
      .update({ gmail_connected: false, gmail_refresh_token: null, gmail_account: null })
      .eq('id', userId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
