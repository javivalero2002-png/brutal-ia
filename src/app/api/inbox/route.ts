import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sendPushToUser } from '@/lib/push'
import { sinControl } from '@/components/shared/helpers'
import { codigoHttpDeError } from '@/lib/respuestaDb'
import { NextRequest, NextResponse } from 'next/server'

// Lecturas grandes de bandeja + envio de push: el default de Vercel se queda corto.
export const maxDuration = 60

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient()

  // ¿Esta persona ve el buzón compartido?
  //
  // La marca `shared` está en el CORREO, no en la persona, así que sin esto lo ve
  // cualquiera con sesión — y dar de baja a alguien y volver a crearlo no cambia
  // nada: la cuenta nueva lo vería igual.
  //
  // Un fallo al leer la preferencia NO oculta el buzón: se sigue enseñando. Es el
  // lado seguro — que a alguien le aparezca correo del equipo que ya veía ayer es
  // un incordio; que desaparezca sin motivo parece que se ha perdido.
  const { data: perfil, error: errPerfil } = await admin
    .from('profiles').select('ver_colabs').eq('id', user.id).maybeSingle()
  if (errPerfil) console.error('[inbox] no se pudo leer ver_colabs:', errPerfil.message)
  const veColabs = perfil?.ver_colabs !== false

  // Las dos consultas ENTERAS, cada una con su filtro pegado.
  //
  // Estaba escrito como un constructor en una variable y el filtro dos líneas más
  // abajo, y una regla nueva lo marcó: es exactamente la forma en la que se
  // esconde un filtro que falta —de un vistazo se lee `.select('*')` sin `where`—.
  // Se cambió el código en vez de relajar la regla.
  const { data, error } = veColabs
    ? await admin.from('inbox_messages').select('*')
        .or(`user_id.eq.${user.id},shared.eq.true`)
        .order('received_at', { ascending: false }).limit(100)
    : await admin.from('inbox_messages').select('*')
        .eq('user_id', user.id)
        .order('received_at', { ascending: false }).limit(100)

  if (error) {
    // El fallback existe porque la columna `shared` puede no estar en la BD.
    // Se registra: si no, la bandeja pasa a mostrar SOLO el correo propio y el
    // buzón compartido desaparece sin que nadie sepa por qué.
    console.error('[inbox] consulta con `shared` falló, usando solo correo propio —', error.message)
    const { data: fallback, error: fbErr } = await admin
      .from('inbox_messages')
      .select('*')
      .eq('user_id', user.id)
      .order('received_at', { ascending: false })
      .limit(100)
    if (fbErr) return NextResponse.json({ error: fbErr.message }, { status: 500 })
    return NextResponse.json(fallback)
  }

  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { to_user_id, subject, body } = await request.json()
  if (!to_user_id || !body?.trim()) return NextResponse.json({ error: 'Faltan campos' }, { status: 400 })

  const admin = await createAdminClient()

  // El remitente sale de la sesión, NUNCA del body. Antes `from_name` llegaba del
  // cliente sin comprobarse contra el usuario autenticado: cualquiera podía mandar
  // un DM que apareciera como de otra persona, con su push nativo "Mensaje de
  // Pablo" incluido. Suplantación dentro del equipo con dos líneas de curl.
  //
  // Y el `error` no se descarta (supabase-js no lanza): con la consulta caida
  // `fromName` caia a 'Equipo', y `from_name` es lo UNICO que empareja el hilo en
  // GET /api/inbox/thread —inbox_messages no guarda el id del remitente—. Un DM
  // guardado como 'Equipo' se entrega pero no aparece en ninguna conversacion, ni
  // para quien lo manda ni para quien lo recibe: se da por escrito algo que nadie
  // va a volver a ver. Mejor fallar y que el remitente lo reintente.
  const { data: sender, error: senderErr } = await admin.from('profiles').select('name').eq('id', user.id).single()
  const fromName = (sender?.name || '').trim()
  if (senderErr || !fromName) {
    console.error('[inbox] no se pudo resolver el remitente:', senderErr?.message || 'perfil sin nombre')
    return NextResponse.json({ error: 'No se pudo identificar tu perfil' }, { status: 500 })
  }

  const { data, error } = await admin.from('inbox_messages').insert({
    user_id: to_user_id,
    source: 'internal',
    // `from_user_id` es la identidad REAL del remitente; `from_name` se queda solo
    // para mostrar. Emparejar hilos por nombre era el agujero: profiles.name no es
    // unique y cualquiera se lo cambia, asi que renombrandote como un compañero
    // podias leer sus DM con un tercero.
    from_user_id: user.id,
    from_name: fromName,
    subject: sinControl(subject) || '(sin asunto)',
    body_preview: sinControl(body.slice(0, 500)),
    ai_urgency: 'normal',
    is_read: false,
    is_unread: true,
    received_at: new Date().toISOString(),
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: codigoHttpDeError(error) })

  // Notificación push al destinatario del mensaje interno.
  //
  // CON await, igual que en colabsSync y /api/gmail/sync y por lo mismo: iba
  // suelto con `.catch(()=>{})` y el `return` en la linea siguiente, o sea cero
  // awaits entre lanzar y responder. A sendPushToUser aun le quedaban la consulta
  // a `reglas`, el insert en `notification_log` y las llamadas HTTP a FCM/APNs, y
  // en serverless la instancia se congela al devolver: el aviso se perdia sin
  // dejar rastro. El DM ya esta insertado, asi que un fallo del push se registra
  // pero no tumba la respuesta. La ruta declara maxDuration = 60 (linea 6).
  try {
    await sendPushToUser(admin, to_user_id, {
      title: `Mensaje de ${fromName}`,
      body: (subject && subject !== '(sin asunto)' ? subject + ' — ' : '') + body.slice(0, 100),
      url: '/dashboard',
      tag: `dm-${data?.id || ''}`,
      categoria: 'mensaje',
    })
  } catch (err) {
    console.error('[inbox] el push del mensaje interno fallo:', err)
  }
  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, ids, is_read } = await request.json()
  const admin = await createAdminClient()

  // Modo bulk: marcar varios de una vez ("todo leído") en una sola consulta,
  // en lugar de un PATCH por mensaje desde el cliente.
  if (Array.isArray(ids)) {
    if (ids.length === 0) return NextResponse.json({ ok: true, updated: 0 })
    const { error: bulkErr } = await admin
      .from('inbox_messages')
      .update({ is_read, is_unread: !is_read })
      .in('id', ids.slice(0, 500))
      .or(`user_id.eq.${user.id},shared.eq.true`)
    if (bulkErr) return NextResponse.json({ error: bulkErr.message }, { status: 500 })
    return NextResponse.json({ ok: true, updated: ids.length })
  }

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  // Allow marking own messages OR shared (colabs) messages as read
  const { error } = await admin
    .from('inbox_messages')
    .update({ is_read, is_unread: !is_read })
    .eq('id', id)
    .or(`user_id.eq.${user.id},shared.eq.true`)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
