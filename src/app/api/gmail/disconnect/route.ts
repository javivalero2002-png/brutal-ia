import { getAuthCtx } from '@/lib/authz'
import { quitarCuentaTodas } from '@/lib/gmailCuentas'
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

    // Y de `gmail_cuentas`, que es lo que de verdad consultan los sincronizadores
    // desde el cambio a varias cuentas. Sin esto, apagar el buzón compartido aquí
    // limpiaba `profiles` y la UI decía «desconectado», pero `cuentaCompartida()`
    // seguía encontrando la fila de la tabla y el cron seguía bajando el correo
    // de todo el equipo después de haberlo apagado.
    const errCuentas = await quitarCuentaTodas(admin, { compartida: true })
    if (errCuentas) console.error('[gmail] no se pudo limpiar gmail_cuentas (colabs):', errCuentas)
  } else {
    const { error } = await admin
      .from('profiles')
      .update({ gmail_connected: false, gmail_refresh_token: null, gmail_account: null })
      .eq('id', userId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Mismo motivo que arriba: sin esto, la cuenta migrada desde las columnas
    // viejas seguía viva en `gmail_cuentas` y el cron la seguía sincronizando.
    const errCuentas = await quitarCuentaTodas(admin, { profileId: userId, compartida: false })
    if (errCuentas) console.error('[gmail] no se pudo limpiar gmail_cuentas (personal):', errCuentas)
  }

  return NextResponse.json({ ok: true })
}
