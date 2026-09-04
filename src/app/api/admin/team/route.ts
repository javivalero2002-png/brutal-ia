import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ACCENT_COLORS } from '@/components/shared/design-tokens'
import { APP_URL } from '@/lib/appUrl'
import { NextRequest, NextResponse } from 'next/server'
import { PUSH_ROW } from '@/lib/push'
import { randomInt } from 'node:crypto'

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
    // EL DOMINIO, DE UNA VARIABLE. Estaba escrito a mano, y en la instancia de
    // otro negocio eso significa que la lista de Equipo sale VACÍA — sin error y
    // sin nada raro: la consulta va bien y no casa ni un perfil. El defecto es el
    // de siempre, así que aquí no cambia nada.
    .ilike('email', `%@${process.env.DOMINIO_EQUIPO || 'brutalstudios.es'}`)
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

  // Normalizado AQUÍ, no solo en la pantalla.
  //
  // La pantalla ya mandaba `.trim().toLowerCase()`, pero una API que depende de
  // que su cliente se porte bien no está bien hecha: cualquier otra forma de
  // llamarla —o un cambio en esa pantalla— vuelve a abrir el hueco. Y el hueco
  // aquí es feo: Supabase normaliza los correos por dentro, así que
  // `Laura@…` y `laura@…` son la MISMA cuenta para él y dos distintas para
  // nuestra búsqueda. Resultado: no encontramos el perfil, pedimos crear la
  // cuenta, Supabase nos devuelve la que ya existía, y el insert del perfil
  // revienta con «duplicate key». Que es justo lo que pasó.
  const correo = String(email).trim().toLowerCase()

  const rawInitials = initials || name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
  // La paleta compartida, no una lista a mano. Tres de los colores que había
  // aquí eran barajados de los dígitos de 1B5FFA que no existían en ningún otro
  // sitio de la app — y el picker de Ajustes ofrece exactamente ACCENT_COLORS,
  // así que el color de un miembro nuevo ni siquiera aparecía seleccionable.
  const color = avatar_color || ACCENT_COLORS[Math.abs(email.charCodeAt(0)) % ACCENT_COLORS.length]
  const { randomBytes } = await import('crypto')
  // Contraseña temporal LEGIBLE, y que se le enseña al propietario.
  //
  // Antes era `randomBytes(16).toString('base64url')`: imposible de dictar, de
  // copiar a mano o de leer por teléfono — y daba igual, porque no se enseñaba a
  // nadie. Eso dejaba el enlace de recuperación como ÚNICA puerta de entrada, y
  // ese enlace caduca en una hora y se quema al primer uso (una vista previa de
  // WhatsApp basta). Si moría, la persona no podía entrar de ninguna forma: nadie
  // en el mundo conocía su contraseña.
  //
  // Con una legible el propietario puede darla por el canal que sea, no caduca, y
  // el paso «pon tu propia contraseña» de la puesta en marcha pasa a ser verdad —
  // porque ahora sí se la ha dado otra persona.
  const pwd = password || claveTemporal()

  // ¿Existe ya?
  //
  // `maybeSingle` y no `single`: con `single`, «no hay ninguna» ES un error de
  // PostgREST, así que el camino normal —dar de alta a alguien nuevo— pasaba por
  // una rama de error. Y el error se descartaba al desestructurar solo `data`,
  // que es la trampa que este repo tiene documentada: un fallo de consulta era
  // indistinguible de «no existe», y entonces se intentaba crear encima.
  const { data: existingProfile, error: errBusqueda } = await admin
    .from('profiles')
    .select('id, email')
    .eq('email', correo)
    .maybeSingle()

  // Si no se puede saber si existe, NO se crea a ciegas: crear encima de una
  // cuenta viva es lo que reventaba con «duplicate key», y en el peor caso podría
  // pisar el perfil de alguien.
  if (errBusqueda) {
    console.error('[team] no se pudo comprobar si el miembro existe:', errBusqueda.message)
    return NextResponse.json({ error: 'No se pudo comprobar si esa cuenta ya existe. Inténtalo otra vez.' }, { status: 503 })
  }

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
    const { link, motivo } = await generarEnlace(admin, correo)
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
    // «Ya está registrado» NO es un fallo: es que la cuenta existe en
    // autenticación aunque su perfil no apareciera por email. Pasa cuando el
    // correo se guardó distinto, o cuando un alta anterior murió a medias. Dar de
    // alta a alguien que ya está tiene que devolver su enlace, no un error —que
    // es exactamente lo que el propietario quiere en ese momento.
    if (createErr && /already|registered|exists/i.test(createErr.message || '')) {
      const { link, motivo } = await generarEnlace(admin, correo)
      return NextResponse.json({ ok: true, action: 'existing', email: correo, inviteLink: link, avisoEnlace: motivo })
    }
    return NextResponse.json({ error: createErr?.message || 'Failed to create user' }, { status: 500 })
  }

  // Create profile row
  const { error: profileErr } = await admin.from('profiles').insert({
    id: newUser.user.id,
    email: correo,
    name,
    initials: rawInitials,
    avatar_color: color,
    role,
  })

  if (profileErr) {
    // Choque de clave = el perfil ya estaba. Misma idea: no es un fallo del
    // propietario, es que la cuenta existe. Se le da su enlace y se acabó. Antes
    // esto salía en pantalla como «duplicate key value violates unique constraint
    // "profiles_pkey"», que no le dice nada a nadie y parece que la app está rota.
    if (/duplicate key|already exists|23505/i.test(profileErr.message || '')) {
      const { link, motivo } = await generarEnlace(admin, correo)
      return NextResponse.json({ ok: true, action: 'existing', email: correo, inviteLink: link, avisoEnlace: motivo })
    }
    return NextResponse.json({ error: profileErr.message }, { status: 500 })
  }

  // Generate a password-reset link so the new member can set their own password
  const { link: inviteLink, motivo } = await generarEnlace(admin, correo)

  // El enlace es lo ÚNICO que se le puede mandar a la persona nueva: si no sale,
  // hay que decirlo. Antes el fallo se tragaba con un `catch {}` y la respuesta
  // era ok:true sin enlace, así que parecía que el alta no había funcionado — y
  // lo lógico entonces es repetirla.
  // La clave viaja en la respuesta a propósito: es lo único que el propietario
  // puede dar y que no caduca. Solo la ve él —esta ruta ya exige ser propietario—
  // y solo en el momento de crear la cuenta; no se guarda en ningún sitio legible.
  return NextResponse.json({ ok: true, action: 'created', email, inviteLink, avisoEnlace: motivo, clave: password ? null : pwd })
}

// PATCH: update profile by email, or regenerate invite link
export async function PATCH(request: NextRequest) {
  const ctx = await requireOwner()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { admin } = ctx
  const body = await request.json()
  const { email, action, ...updates } = body
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })
  // Igual que en el alta: Supabase normaliza los correos por dentro, así que
  // buscar por el texto crudo puede no encontrar una cuenta que sí existe.
  const correo = String(email).trim().toLowerCase()

  // Empezar de cero SIN borrar nada.
  //
  // Lo que Javi quiere el día de la presentación es que cada uno reciba su enlace,
  // ponga su contraseña y vea la puesta en marcha. Eso NO necesita borrar la
  // cuenta — y borrarla cuesta caro: `inbox_messages`, `chat_messages` y `diario`
  // cuelgan de `profiles` con ON DELETE CASCADE, así que la baja se lleva por
  // delante el historial de correo, las conversaciones con Harvey y el Fichar
  // entero de esa persona. Sin preguntar y sin vuelta atrás.
  //
  // Y encima puede ni llegar a ocurrir: `task_attachments.created_by` no tiene
  // regla de borrado y `client_comments.profile_id` es RESTRICT, así que a quien
  // haya adjuntado un fichero o comentado en un enlace de revisión, la baja le
  // REBOTA con un error de clave foránea. Delante del equipo, eso es «el botón no
  // funciona».
  //
  // Esto hace las dos cosas que sí hacen falta, y solo esas: borra la marca de
  // puesta en marcha y devuelve un enlace nuevo.
  if (action === 'reiniciar_acceso') {
    const { error: errReset } = await admin
      .from('profiles').update({ onboarding_at: null }).eq('email', correo)
    // El error SE MIRA: sin esto se devolvería un enlace con la puesta en marcha
    // todavía marcada como hecha, y la persona entraría directa al panel — que es
    // justo lo contrario de lo que se ha pedido, pero con cara de haber ido bien.
    if (errReset) {
      console.error('[team] no se pudo reiniciar la puesta en marcha:', errReset.message)
      return NextResponse.json({ error: 'No se pudo reiniciar la puesta en marcha' }, { status: 500 })
    }
    const { link, motivo } = await generarEnlace(admin, correo)
    return NextResponse.json({ ok: true, inviteLink: link, motivo, reiniciado: true })
  }

  if (action === 'regenerate_invite') {
    // Por `generarEnlace()`, que es donde vive el arreglo de PKCE.
    //
    // Esta rama se lo saltaba y devolvía el `action_link` de Supabase — o sea, la
    // VÍA DE RESCATE de un enlace quemado devolvía otro enlace quemado. Y con el
    // `email` crudo en vez del `correo` normalizado que se calcula tres líneas
    // más arriba, que es el mismo fallo que ya rompió el alta.
    const { link, motivo } = await generarEnlace(admin, correo)
    return NextResponse.json({ ok: true, inviteLink: link, motivo })
  }

  // `ver_colabs` entra en la allowlist a propósito.
  //
  // Reunión de empresa del 2026-09-03: «conceder acceso al buzón de colaboraciones
  // a Pablo y a Julio». No había forma de hacerlo desde la app: la columna solo la
  // escribía cada uno en su propia Sincronización, así que un «concede acceso a X»
  // solo se podía cumplir tocando la base a mano. Un permiso que no se puede
  // gestionar desde dentro es un permiso que acaba gestionando quien tiene la clave
  // de servicio, que es lo contrario de lo que se quiere.
  //
  // Sigue siendo UN solo interruptor, no dos: lo puede tocar el propietario desde
  // Equipo y la propia persona desde Sincronización, y los dos ven el mismo valor.
  // Con siete personas de confianza, separar «permiso» de «preferencia» en dos
  // columnas sería inventarse un problema.
  const ALLOWED_COLS = ['name', 'role', 'initials', 'avatar_color', 'ver_colabs']
  const safeUpdates: Record<string, unknown> = {}
  for (const k of ALLOWED_COLS) if (k in updates) safeUpdates[k] = updates[k]
  if (Object.keys(safeUpdates).length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
  const { error } = await admin.from('profiles').update(safeUpdates).eq('email', correo)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE: remove a team member (cannot delete owner)
/**
 * El enlace para que la persona ponga su contraseña. Devuelve el motivo cuando no
 * sale, en vez de un null mudo.
 */
/**
 * Una contraseña temporal que se pueda leer en voz alta.
 *
 * Palabras cortas sin tildes ni ambigüedad, más cuatro cifras. Sale algo como
 * `nube-plata-7412`: se dicta por teléfono, se copia a mano sin errores y se
 * escribe en un móvil sin pelearse con las mayúsculas. La entropía es de sobra
 * para una clave que se usa una vez y se cambia en el primer minuto.
 */
function claveTemporal() {
  // Tres palabras y no dos, y listas de 16 y no de 10.
  //
  // Antes eran 10 × 10 × 9000 = 900.000 combinaciones: **menos de 20 bits**. El
  // comentario de arriba decía que era «de sobra porque se cambia en el primer
  // minuto», y eso resultó ser falso — el paso de cambiarla en la puesta en marcha
  // se puede saltar, y a propósito. O sea que esta clave puede ser la de verdad de
  // alguien durante meses, viajando por WhatsApp.
  //
  // Ahora son 16 × 16 × 16 × 9000 ≈ 37 millones, unos 25 bits, y se sigue pudiendo
  // dictar por teléfono: «faro-coral-duna-7412». Que es de lo que iba el formato.
  const A = ['nube', 'faro', 'roble', 'duna', 'lino', 'brisa', 'cobre', 'menta',
             'nieve', 'sauce', 'cedro', 'olivo', 'marea', 'cumbre', 'valle', 'junco']
  const B = ['plata', 'coral', 'ambar', 'verde', 'indigo', 'lima', 'siena', 'perla',
             'rubi', 'jade', 'cobalto', 'ocre', 'malva', 'turquesa', 'granate', 'arena']
  // `randomInt`, no `randomBytes` + `%`: con 256 valores y listas de 10, el módulo
  // hacía los seis primeros más probables que los cuatro últimos. Poco, pero es
  // sesgo gratis — y con listas de 16 el módulo ya no sesga, así que esto es para
  // que siga siendo cierto si alguien añade una palabra número 17.
  const de = (xs: string[]) => xs[randomInt(xs.length)]
  return `${de(A)}-${de(B)}-${de(A)}-${1000 + randomInt(9000)}`
}

async function generarEnlace(admin: Awaited<ReturnType<typeof createAdminClient>>, email: string) {
  try {
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${APP_URL}/reset-password` },
    })
    // supabase-js no lanza: el error viaja en la respuesta.
    if (error) return { link: null, motivo: error.message }
    const props = (data as { properties?: { action_link?: string; hashed_token?: string } })?.properties

    // NUESTRO enlace, no el de Supabase, y esto arregla el fallo de raíz.
    //
    // El `action_link` que devuelve Supabase pasa primero por su página de
    // verificación, y ESA página consume el token antes de que la nuestra llegue a
    // ejecutarse. Después redirige con un `?code=` que solo se puede canjear si el
    // navegador guarda un verificador PKCE — y el nuestro no lo tiene, porque el
    // enlace lo generó el servidor. Resultado: el enlace muere al abrirlo, siempre,
    // ya lo abra la persona o el robot que hace la vista previa de WhatsApp.
    //
    // Con el token en crudo montamos un enlace a nuestra propia pantalla, que lo
    // canjea con `verifyOtp`. El token no se gasta hasta que alguien llega de
    // verdad al formulario.
    if (props?.hashed_token) {
      const propio = `${APP_URL}/reset-password?token_hash=${encodeURIComponent(props.hashed_token)}&type=recovery`
      return { link: propio, motivo: null }
    }

    // Sin `hashed_token` se cae al de Supabase: funciona a medias, pero es mejor
    // que no dar enlace. Y se dice, para que no parezca que va bien.
    const link = props?.action_link || null
    return { link, motivo: link ? 'Supabase no devolvió el token en crudo: este enlace se gasta al abrirlo' : 'Supabase no devolvió el enlace' }
  } catch (e) {
    return { link: null, motivo: e instanceof Error ? e.message : 'No se pudo generar el enlace' }
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = await requireOwner()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { admin } = ctx
  const email = (request.nextUrl.searchParams.get('email') || '').trim().toLowerCase()
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

  // Se SUELTAN sus tareas antes de borrarlo. Dos motivos, y el segundo es el que
  // hacía que el botón no funcionara:
  //
  //  · Una tarea asignada a alguien que ya no está es una tarea perdida: no sale
  //    en la carga de nadie y nadie la va a recoger. Queda sin responsable, que
  //    es lo que de verdad es.
  //  · Y varias tablas apuntan a `profiles` SIN regla de borrado (por ejemplo
  //    `task_attachments.created_by`), así que la baja rebotaba con un error de
  //    clave foránea. Eso llegaba como un mensaje de Postgres en inglés y sin
  //    contexto: desde fuera, «el botón no hace nada».
  await admin.from('tasks').update({ assigned_to: null }).eq('assigned_to', profile.id)
  await admin.from('tasks').update({ co_assigned_to: null }).eq('co_assigned_to', profile.id)

  const { error: authErr } = await admin.auth.admin.deleteUser(profile.id)
  if (authErr) {
    // Un fallo de clave foránea se explica en cristiano y se dice QUÉ lo bloquea:
    // el mensaje crudo de Postgres no le sirve a nadie.
    const fk = /foreign key|violates|constraint/i.test(authErr.message)
    console.error('[team] no se pudo dar de baja a', profile.id, '—', authErr.message)
    return NextResponse.json({
      error: fk
        ? `No se puede dar de baja: quedan cosas suyas enlazadas en la base (${authErr.message}). Dímelo y lo desenganchamos.`
        : authErr.message,
    }, { status: 500 })
  }

  // El error SÍ se mira. Sin esto, un fallo aquí devolvía `ok: true` con la cuenta
  // de autenticación ya borrada y el perfil todavía en la tabla — el peor estado
  // posible: la persona no puede entrar, sigue saliendo en la lista del equipo, y
  // al intentar volver a darla de alta el alta choca contra su fila huérfana.
  //
  // `deleteUser` normalmente cascadea sobre `profiles`, así que este borrado suele
  // no encontrar nada y va bien. Pero «suele» no es «siempre», y de eso justo se
  // entera uno el día que no.
  const { error: perfilErr } = await admin.from('profiles').delete().eq('id', profile.id)
  if (perfilErr) {
    console.error('[team] la cuenta se borró pero su perfil no:', perfilErr.message)
    return NextResponse.json({
      error: `La cuenta se ha dado de baja pero su ficha ha quedado en la lista (${perfilErr.message}). Vuelve a intentarlo.`,
    }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
