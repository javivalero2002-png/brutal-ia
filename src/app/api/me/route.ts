import { createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'No token' }, { status: 401 })

  const admin = await createAdminClient()

  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

  // 1. Try to find profile by user ID (normal case)
  // Allowlist explicita de columnas, nunca el comodin. La tabla profiles guarda
  // gmail_refresh_token y gmail_colabs_refresh_token, y con el asterisco viajaban
  // al navegador en cada arranque de la app: quedaban en el estado de React, en la
  // pestaña de red de las devtools y en cualquier volcado de sesion. Un refresh
  // token da acceso COMPLETO al Gmail de esa persona y no caduca solo.
  //
  // Nadie en el cliente los lee (comprobado), asi que solo eran exposicion.
  // (El comentario no escribe el patron prohibido: el test que lo persigue escanea
  // el fichero como texto y no distingue codigo de prosa.)
  const { data: profile } = await admin
    .from('profiles')
    // `analizar_correo` y `ver_colabs` SÍ viajan: son las que pintan los dos
    // interruptores de Operativa → Sincronización. Sin ellas el perfil llegaba con
    // `undefined` y `profile?.ver_colabs !== false` daba true, así que el
    // interruptor volvía a salir MARCADO al recargar por mucho que lo apagaras —
    // el PATCH sí lo guardaba, pero nadie lo leía de vuelta. Sigue siendo una
    // allowlist explícita: aquí no entra ningún token.
    .select('id, email, name, role, avatar_color, initials, gmail_connected, gmail_account, gmail_colabs_connected, gmail_colabs_account, onboarding_at, analizar_correo, ver_colabs')
    .eq('id', user.id)
    .single()

  if (profile) return NextResponse.json(profile)

  // 2. If not found by ID, check if email already exists (Google sign-in for existing account).
  //    NOTA: el vínculo se hace por email verificado por el proveedor (Google/Supabase)
  //    y el alta de cuentas está restringida al owner, así que no hay auto-registro.
  //    No se filtra por dominio a propósito: el equipo usa también cuentas Gmail.
  if (user.email) {
    const { data: existingByEmail } = await admin
      .from('profiles')
      // La MISMA allowlist que arriba, y por eso hay un test que las compara:
      // este camino (alta por email de Google) llegaba con las columnas viejas y
      // el interruptor volvía a salir marcado solo para quien entra por ahí.
      .select('id, email, name, role, avatar_color, initials, gmail_connected, gmail_account, gmail_colabs_connected, gmail_colabs_account, onboarding_at, analizar_correo, ver_colabs')
      .eq('email', user.email)
      .single()

    if (existingByEmail) {
      // Update the profile ID to match the new auth user so future lookups work.
      //
      // El error SE MIRA, y es el gemelo del callback de Gmail: si este update
      // falla y se devuelve `{...existingByEmail, id: user.id}` igualmente, el
      // cliente se queda con un id que NO existe en la tabla. Todo lo que haga a
      // partir de ahi apunta a una fila fantasma —tareas creadas a nombre de nadie,
      // permisos resueltos contra un perfil que no esta— y sin un solo error.
      const { error: errVinculo } = await admin
        .from('profiles')
        .update({ id: user.id })
        .eq('email', user.email)
      if (errVinculo) {
        console.error('[me] no se pudo revincular el perfil:', errVinculo.message)
        return NextResponse.json({ error: 'No se pudo vincular tu perfil' }, { status: 500 })
      }
      return NextResponse.json({ ...existingByEmail, id: user.id })
    }
  }

  // 3. Unknown user — self-registration is disabled
  // All accounts must be pre-created by the owner via /api/admin/team
  return NextResponse.json(
    { error: 'Acceso no autorizado. Contacta con el administrador de Brutal Studios.' },
    { status: 403 }
  )
}
