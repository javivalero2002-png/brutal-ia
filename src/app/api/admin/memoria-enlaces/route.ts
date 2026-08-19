import { getAuthCtx } from '@/lib/authz'
import type { SupabaseClient } from '@supabase/supabase-js'
import { rutaApp } from '@/lib/appUrl'
import { NextResponse } from 'next/server'

export const maxDuration = 60

// ─────────────────────────────────────────────────────────────────────────────
// Las notas de Memoria que todavía llevan la dirección PÚBLICA del fichero
// escrita dentro del texto.
//
// Qué desbloquea: el bucket `content-videos` sigue abierto —cualquiera con la
// dirección se descarga contratos, presupuestos y briefs sin sesión—, y lo único
// que quedaba para poder cerrarlo eran estas notas. Casi todo lo que sale del
// bucket se firma al leer, pero Memoria guarda el enlace DENTRO del texto de la
// nota, así que no hay nada que firmar: es una cadena en un párrafo.
//
// Desde el 13 de agosto las notas nuevas guardan `/api/archivo?u=…`, que exige
// sesión y no caduca. Las anteriores no, y CLAUDE.md decía que había que
// arreglarlas «a mano desde la app». A mano significa que alguien tiene que
// encontrarlas primero, y encontrarlas es justo lo que un ordenador hace mejor.
//
// Solo owner: reescribe contenido del estudio en lote.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Una dirección pública del Storage suelta en el texto.
 *
 * Las que YA están envueltas no casan y no hace falta excluirlas aparte: dentro
 * de `/api/archivo?u=` la dirección va codificada (`https%3A%2F%2F…`), así que no
 * contiene `://` y este patrón no la ve. Aun así se comprueba abajo, porque
 * envolver dos veces dejaría un enlace roto y silencioso.
 */
const CRUDA = /https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/[^\s)\]"'<>]+/gi

/** El enlace estable que exige sesión y no caduca. */
const envolver = (url: string) => rutaApp(`/api/archivo?u=${encodeURIComponent(url)}`)

type Afectada = { id: string; title: string; enlaces: number }

async function buscar(admin: SupabaseClient) {
  const { data, error } = await admin.from('memoria').select('id,title,content')
  // «No pude leerlo» no puede pintarse como «no hay ninguna»: sería decir que el
  // bucket se puede cerrar sin haberlo comprobado.
  if (error) throw new Error(error.message)

  const afectadas: (Afectada & { content: string })[] = []
  for (const nota of data || []) {
    const texto = (nota.content || '') as string
    const encontrados = texto.match(CRUDA) || []
    // Las ya envueltas van precedidas de `u=` y codificadas; esto es el cinturón.
    const sueltos = encontrados.filter(u => !texto.includes(`u=${encodeURIComponent(u)}`))
    if (sueltos.length) {
      afectadas.push({ id: nota.id as string, title: (nota.title as string) || '(sin título)', enlaces: sueltos.length, content: texto })
    }
  }
  return afectadas
}

/** Cuántas quedan, sin tocar nada. */
export async function GET() {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (ctx.role !== 'owner') return NextResponse.json({ error: 'Solo el propietario' }, { status: 403 })

  try {
    const afectadas = await buscar(ctx.admin)
    return NextResponse.json({
      afectadas: afectadas.map(({ id, title, enlaces }) => ({ id, title, enlaces })),
      total: afectadas.reduce((n, a) => n + a.enlaces, 0),
    })
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e)
    console.error('[memoria-enlaces] no se pudieron revisar las notas:', motivo)
    return NextResponse.json({ error: motivo }, { status: 500 })
  }
}

/** Envolverlos. Idempotente: pasarlo dos veces no cambia nada la segunda. */
export async function POST() {
  const ctx = await getAuthCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (ctx.role !== 'owner') return NextResponse.json({ error: 'Solo el propietario' }, { status: 403 })

  try {
    const afectadas = await buscar(ctx.admin)
    let arregladas = 0
    const fallos: string[] = []

    for (const nota of afectadas) {
      // Solo se toca lo que hace falta: se sustituye cada dirección por su
      // envoltorio y el resto del texto queda intacto, palabra por palabra. Nada
      // de regenerar la nota — es contenido escrito por una persona.
      const nuevo = nota.content.replace(CRUDA, (u) =>
        nota.content.includes(`u=${encodeURIComponent(u)}`) ? u : envolver(u))
      if (nuevo === nota.content) continue

      const { error } = await ctx.admin.from('memoria').update({ content: nuevo }).eq('id', nota.id)
      // El error SÍ se mira: contar como arreglada una que no se guardó diría que
      // el bucket ya se puede cerrar cuando todavía no.
      if (error) fallos.push(`${nota.title}: ${error.message}`)
      else arregladas++
    }

    if (fallos.length) console.error('[memoria-enlaces] no se pudieron arreglar:', fallos.join(' | '))
    return NextResponse.json({ arregladas, fallos })
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e)
    console.error('[memoria-enlaces] falló el arreglo:', motivo)
    return NextResponse.json({ error: motivo }, { status: 500 })
  }
}
