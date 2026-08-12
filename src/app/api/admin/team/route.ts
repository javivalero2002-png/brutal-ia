import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { PUSH_ROW } from '@/lib/push'

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
  const { data: profiles } = await admin.from('profiles').select('id, email, name, role, avatar_color, initials, gmail_connected, gmail_account, gmail_colabs_connected, gmail_colabs_account')
    .ilike('email', '%@brutalstudios.es')
    .order('role', { ascending: false })
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
  const colors = ['#1B5FFA','#9B5FFA','#E51D2A','#FA8B1B','#1BFA9B','#F97316','#06B6D4']
  const color = avatar_color || colors[Math.abs(email.charCodeAt(0)) % colors.length]
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
    return NextResponse.json({ ok: true, action: 'updated', email })
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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://brutalstudios-ia.vercel.app'
  let inviteLink: string | null = null
  try {
    const { data: linkData } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${appUrl}/reset-password` },
    })
    inviteLink = (linkData as any)?.properties?.action_link || null
  } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true, action: 'created', email, inviteLink })
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
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://brutalstudios-ia.vercel.app'
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
export async function DELETE(request: NextRequest) {
  const ctx = await requireOwner()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { admin } = ctx
  const email = request.nextUrl.searchParams.get('email')
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const { data: profile } = await admin.from('profiles').select('id, role').eq('email', email).single()
  if (!profile) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (profile.role === 'owner') return NextResponse.json({ error: 'Cannot delete owner' }, { status: 403 })

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
