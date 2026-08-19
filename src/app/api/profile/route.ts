import { NextResponse } from 'next/server'
import { getAuthCtx } from '@/lib/authz'

// ─────────────────────────────────────────────────────────────────────────────
// Editar TU PROPIO perfil. Cualquiera con sesión, no solo el owner.
//
// Antes Ajustes mandaba esto a /api/admin/team, que exige owner: los 6 miembros
// del equipo recibían 403 al cambiar su propio nombre y solo veían el toast
// "Error actualizando perfil". Mañana entran becarios, que son justo eso —
// miembros — y personalizar su ficha es de las primeras cosas que van a tocar.
//
// La barrera está aquí, no en el cliente:
//   · se escribe SOLO en la fila de quien llama (`.eq('id', ctx.userId)`)
//   · lista blanca de tres columnas. `role` y `email` no se pueden tocar por esta
//     vía ni mandándolos en el body — es lo que impide que alguien se ascienda a
//     owner, que es la única señal de autorización que mira el servidor.
//   · va por service role porque el rol `authenticated` tiene REVOKE de update
//     sobre `profiles` (deliberado; ver CLAUDE.md).
// ─────────────────────────────────────────────────────────────────────────────

const HEX = /^#[0-9a-fA-F]{6}$/

export async function PATCH(request: Request) {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const updates: Record<string, string> = {}

  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, 80)
    if (!name) return NextResponse.json({ error: 'El nombre no puede estar vacío' }, { status: 400 })

    // Dos personas no pueden llamarse igual, y esto NO es cosmético.
    //
    // `inbox_messages` no guarda el id de quien envía: solo `from_name`, que sale
    // de la sesión al mandar el DM. /api/inbox/thread empareja la conversación
    // por ese nombre, así que el nombre es, de hecho, la identidad del remitente.
    // Poniéndome el nombre de un compañero, esa ruta me devolvía los mensajes que
    // ÉL había mandado a un tercero — la conversación privada de otros dos, con
    // dos líneas de curl.
    //
    // Desde la migración 20260813 el hilo empareja por `from_user_id`, así que un
    // nombre repetido ya NO puede cruzar conversaciones: esto dejó de ser una
    // barrera de seguridad. Se mantiene por claridad —dos "Pablo" en una lista de
    // siete es confuso en el inbox, en las menciones y al asignar tareas— pero si
    // algún día estorba, quitarlo ya no abre nada.
    //
    // Sin acentos ni mayúsculas: "Pablo" y "pablo " tienen que chocar, porque como
    // identidad son la misma persona aunque como filtro SQL no lo sean.
    const clave = (s: string | null | undefined) =>
      (s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

    const { data: otros, error: otrosErr } = await ctx.admin
      .from('profiles')
      .select('id,name')
      .neq('id', ctx.userId)

    if (otrosErr || !otros) {
      console.error('[profile] no se pudo comprobar si el nombre está repetido —', otrosErr?.message)
      return NextResponse.json({ error: 'No se pudo guardar el perfil' }, { status: 500 })
    }
    if (otros.some(p => clave(p.name) === clave(name))) {
      return NextResponse.json(
        { error: 'Ya hay alguien en el equipo con ese nombre — añade el apellido o una inicial' },
        { status: 409 },
      )
    }

    updates.name = name
  }

  if (typeof body.initials === 'string') {
    // Dos caracteres como mucho: es lo que cabe en el avatar redondo.
    const ini = body.initials.trim().toUpperCase().slice(0, 2)
    if (ini) updates.initials = ini
  }

  if (typeof body.avatar_color === 'string') {
    // Solo hex de 6 dígitos. Además de evitar basura en la columna, la UI
    // concatena sufijos de opacidad sobre este valor (`color + '18'`), y eso solo
    // es CSS válido con hex — un rgba() aquí dejaría avatares sin fondo.
    if (!HEX.test(body.avatar_color)) return NextResponse.json({ error: 'Color inválido' }, { status: 400 })
    updates.avatar_color = body.avatar_color
  }

  // Si su correo personal pasa por el modelo. Booleano estricto: `typeof` y no
  // truthiness, porque `false` es un valor legítimo aquí y `!body.x` lo trataría
  // como «no lo ha mandado» — que es justo la mitad de los casos.
  if (typeof body.analizar_correo === 'boolean') {
    updates.analizar_correo = body.analizar_correo
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })
  }

  const { data, error } = await ctx.admin
    .from('profiles')
    .update(updates)
    .eq('id', ctx.userId)
    .select('id,name,initials,avatar_color,email,role,analizar_correo')
    .single()

  if (error) {
    console.error('[profile] no se pudo actualizar el perfil de', ctx.userId, '—', error.message)
    return NextResponse.json({ error: 'No se pudo guardar el perfil' }, { status: 500 })
  }

  return NextResponse.json(data)
}
