import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ACCENT_COLORS } from '@/components/shared/design-tokens'
import { APP_URL } from '@/lib/appUrl'
import { NextRequest, NextResponse } from 'next/server'
import { PUSH_ROW } from '@/lib/push'

// Tres viajes a Supabase seguidos —crear la cuenta de auth, insertar el perfil y
// generar el enlace— y el primero, en frío, no es rápido. Se declara el techo a
// propósito: sin él rige el defecto y el fallo no se distingue de un cuelgue.
export const maxDuration = 60

// Only the owner can call these endpoints
async function requireOwner() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const admin = await createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'owner') return null
  return { user, admin }
}

// GET: list all auth users + profiles
export async function GET() {
  const ctx = await requireOwner()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { admin } = ctx
  // Igual que en /api/me, y aqui es peor: con el asterisco esta ruta devolvia los
  // refresh tokens de Gmail de LAS SIETE PERSONAS en una sola respuesta.
  const { data: profiles, error } = await admin.from('profiles').select('id, email, name, role, avatar_color, initials, gmail_connected, gmail_account, gmail_colabs_connected, gmail_colabs_account')
    .ilike('email', '%@brutalstudios.es')
    .order('role', { ascending: false })
  // supabase-js NO lanza: descartando `error` esto devolvia [] con un 200, que es
  // exactamente lo mismo que responde una tabla vacia. En Ajustes → Equipo el
  // propietario veia la lista de las siete personas EN BLANCO y la lectura obvia es
  // que se han borrado las cuentas — no que la consulta se ha caido. Un 500 deja
  // que la UI avise y que quede rastro del motivo real en los logs.
  if (error) {
    console.error('[admin/team] no se pudo leer la lista de perfiles:', error.message)
    return NextResponse.json({ error: 'No se pudo cargar el equipo' }, { status: 500 })
  }
  return NextResponse.json(profiles || [])
}

// POST: create a new team member account
export async function POST(request: NextRequest) {
  const ctx = await requireOwner()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { admin } = ctx
  const { email, name, role = 'member', avatar_color, initials, password, cambiarRol } = await request.json()

  if (!email || !name) return NextResponse.json({ error: 'email and name required' }, { status: 400 })

  const rawInitials = initials || name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
  // La paleta compartida, no una lista a mano. Tres de los colores que había
  // aquí eran barajados de los dígitos de 1B5FFA que no existían en ningún otro
  // sitio de la app — y el picker de Ajustes ofrece exactamente ACCENT_COLORS,
  // así que el color de un miembro nuevo ni siquiera aparecía seleccionable.
  const color = avatar_color || ACCENT_COLORS[Math.abs(email.charCodeAt(0)) % ACCENT_COLORS.length]
  const { randomBytes } = await import('crypto')
  const pwd = password || randomBytes(16).toString('base64url') + 'Aa1!'

  // Check if user already exists
  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id, email')
    .eq('email', email)
    .single()

  if (existingProfile) {
    // El `role` NO se toca aqui, y es a proposito.
    //
    // Este formulario es de ALTA, y su selector de rol vuelve a 'member' despues
    // de cada uso. Si el fundador daba de alta un email que ya existia —para
    // corregir un nombre mal escrito, por ejemplo— la actualizacion arrastraba
    // `role: 'member'` y DEGRADABA la cuenta en silencio. Un owner podia dejar de
    // serlo por corregir una errata, y la respuesta decia ok:true.
    //
    // Cambiar de rol tiene que ser una accion deliberada, no un efecto colateral
    // de un alta: solo se toca si el cliente lo pide con `cambiarRol`. El resto de
    // campos (nombre, iniciales, color) si son lo que se esta editando.
    const campos: Record<string, string> = { name, initials: rawInitials, avatar_color: color }
    if (cambiarRol && (role === 'owner' || role === 'member')) campos.role = role
    const { error: updErr } = await admin.from('profiles').update(campos).eq('id', existingProfile.id)
    // Antes se devolvia ok:true sin mirar el resultado: un fallo del UPDATE se
    // reportaba como exito y el cambio no se veia hasta recargar.
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
    // Y se devuelve enlace TAMBIÉN al actualizar. Sin esto, repetir un alta que
    // se quedó a medias —lo primero que hace cualquiera— entraba por aquí y salía
    // sin enlace, que es justo lo que se venía a buscar.
    const { link, motivo } = await generarEnlace(admin, email)
    return NextResponse.json({ ok: true, action: 'updated', email, inviteLink: link, avisoEnlace: motivo })
  }

  // Create new auth user (pre-confirmed — owner creates accounts, no email verify loop)
  const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: pwd,
    email_confirm: true,
    user_metadata: { full_name: name },
  })

  if (createErr || !newUser.user) {
    return NextResponse.json({ error: createErr?.message || 'Failed to create user' }, { status: 500 })
  }

  // Create profile row
  const { error: profileErr } = await admin.from('profiles').insert({
    id: newUser.user.id,
    email,
    name,
    initials: rawInitials,
    avatar_color: color,
    role,
  })

  if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 })

  // Generate a password-reset link so the new member can set their own password
  const { link: inviteLink, motivo } = await generarEnlace(admin, email)

  // El enlace es lo ÚNICO que se le puede mandar a la persona nueva: si no sale,
  // hay que decirlo. Antes el fallo se tragaba con un `catch {}` y la respuesta
  // era ok:true sin enlace, así que parecía que el alta no había funcionado — y
  // lo lógico entonces es repetirla.
  return NextResponse.json({ ok: true, action: 'created', email, inviteLink, avisoEnlace: motivo })
}

// PATCH: update profile by email, or regenerate invite link
export async function PATCH(request: NextRequest) {
  const ctx = await requireOwner()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { admin } = ctx
  const body = await request.json()
  const { email, action, ...updates } = body
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  if (action === 'regenerate_invite') {
    const appUrl = APP_URL
    let inviteLink: string | null = null
    try {
      const { data: linkData } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: `${appUrl}/reset-password` },
      })
      inviteLink = (linkData as any)?.properties?.action_link || null
    } catch { /* non-fatal */ }
    return NextResponse.json({ ok: true, inviteLink })
  }

  const ALLOWED_COLS = ['name', 'role', 'initials', 'avatar_color']
  const safeUpdates: Record<string, unknown> = {}
  for (const k of ALLOWED_COLS) if (k in updates) safeUpdates[k] = updates[k]
  if (Object.keys(safeUpdates).length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
  const { error } = await admin.from('profiles').update(safeUpdates).eq('email', email)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE: remove a team member (cannot delete owner)
/**
 * El enlace para que la persona ponga su contraseña. Devuelve el motivo cuando no
 * sale, en vez de un null mudo.
 */
async function generarEnlace(admin: Awaited<ReturnType<typeof createAdminClient>>, email: string) {
  try {
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${APP_URL}/reset-password` },
    })
    // supabase-js no lanza: el error viaja en la respuesta.
    if (error) return { link: null, motivo: error.message }
    const link = (data as { properties?: { action_link?: string } })?.properties?.action_link || null
    return { link, motivo: link ? null : 'Supabase no devolvió el enlace' }
  } catch (e) {
    return { link: null, motivo: e instanceof Error ? e.message : 'No se pudo generar el enlace' }
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = await requireOwner()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { admin } = ctx
  const email = request.nextUrl.searchParams.get('email')
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const { data: profile } = await admin.from('profiles').select('id, role').eq('email', email).single()
  if (!profile) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  // Los propietarios SÍ se pueden dar de baja — antes estaba prohibido a machete y
  // dejaba cuentas de gente que ya no está sin forma de quitarlas. Pero con las
  // dos guardas que de verdad importan, y las dos son irreversibles si fallan:
  //
  //  · No el ÚLTIMO: sin ningún propietario nadie puede volver a nombrar a otro,
  //    porque esta misma ruta exige serlo. El workspace se queda sin gobierno.
  //  · No a TI MISMO: te quedarías fuera de tu propia app a mitad de clic, y no
  //    hay otra puerta para volver a entrar.
  if (profile.role === 'owner') {
    if (profile.id === ctx.user.id) {
      return NextResponse.json({ error: 'No puedes darte de baja a ti mismo' }, { status: 400 })
    }
    const { count, error: errCuenta } = await admin
      .from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'owner')
    // Un fallo al contar NO puede leerse como «hay de sobra»: sin este corte, un
    // error de consulta autorizaría borrar al último.
    if (errCuenta) return NextResponse.json({ error: errCuenta.message }, { status: 500 })
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: 'Es el único propietario: nombra a otro antes de darlo de baja' }, { status: 400 })
    }
  }

  // La suscripcion push se borra TAMBIEN, y antes que el perfil.
  //
  // Vive en `reglas` con name = PUSH_ROW y created_by = el usuario (ver
  // src/lib/push.ts). Al dar de baja a alguien solo se borraba su cuenta de auth y
  // su perfil: la fila de la suscripcion sobrevivia, y sendPushToAll la sigue
  // seleccionando por `name` sin mirar si ese created_by aun existe. Resultado:
  // quien ya no esta en el equipo seguia recibiendo en su movil los avisos de
  // correo de CLIENTES, con remitente y asunto en la notificacion del sistema.
  //
  // Va lo PRIMERO, antes incluso de borrar la cuenta de auth. Lo tenia despues, y
  // eso era inutil: deleteUser cascadea sobre profiles, y segun como este la FK de
  // `reglas` o bien la fila ya habia desaparecido (y este DELETE no borraba nada)
  // o bien la referencia impedia el borrado de la cuenta. Primero se retira la
  // suscripcion, y solo si eso funciona se sigue.
  const { error: pushErr } = await admin
    .from('reglas')
    .delete()
    .eq('name', PUSH_ROW)
    .eq('created_by', profile.id)
  if (pushErr) {
    console.error('[team] no se pudo borrar la suscripcion push de', profile.id, '—', pushErr.message)
    return NextResponse.json(
      { error: 'No se pudo retirar la suscripción de avisos. La cuenta NO se ha dado de baja.' },
      { status: 500 },
    )
  }

  const { error: authErr } = await admin.auth.admin.deleteUser(profile.id)
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 })

  await admin.from('profiles').delete().eq('id', profile.id)
  return NextResponse.json({ ok: true })
}
