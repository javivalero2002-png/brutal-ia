import type { SupabaseClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────────────
// Copia de seguridad de la base.
//
// Por qué existe: hasta hoy no había NINGUNA. El plan gratuito de Supabase no
// hace copias ni tiene point-in-time recovery, así que un `delete` mal apuntado
// —o dar de baja a alguien y que el CASCADE se lleve su diario— era pérdida
// definitiva. Con siete personas escribiendo, la pregunta no era si iba a pasar.
//
// Qué NO es: esto no sustituye a un `pg_dump`. No guarda el esquema, ni los
// índices, ni las políticas de RLS, ni lo que hay en Storage. Guarda LAS FILAS,
// que es lo irrecuperable: el esquema se reconstruye desde `migrations/` (hay un
// test que lo vigila) y los ficheros siguen en su bucket. Decir que es un backup
// completo sería mentir, y una copia en la que confías de más es peor que ninguna.
//
// Formato: un JSON por ejecución con todas las tablas dentro. A esta escala son
// pocos megas; partirlo por tabla complicaría restaurar sin ganar nada.
// ─────────────────────────────────────────────────────────────────────────────

export const BUCKET_COPIAS = 'copias'

/**
 * Las tablas que se copian, y el orden IMPORTA: es el orden en que habría que
 * reinsertarlas para que las claves ajenas no rebooten. `profiles` primero
 * porque casi todo cuelga de ella; las hijas después de sus padres.
 *
 * Se omiten a propósito las de servicio, que se regeneran solas y solo harían
 * ruido: `job_locks` (cerrojos vivos), `rate_limits` y `push_rate_limits`
 * (ventanas de unos minutos). Perderlas no pierde nada.
 */
export const TABLAS_COPIADAS = [
  'profiles',
  'clients',
  'projects',
  'tasks',
  'task_subtasks',
  'task_attachments',
  'project_notes',
  'project_milestones',
  'client_comments',
  'content_agenda',
  'memoria',
  'diario',
  'inbox_messages',
  'chat_messages',
  'whatsapp_sessions',
  'reglas',
  'notification_log',
] as const

/**
 * Columnas que NO salen en la copia.
 *
 * Los refresh tokens de Gmail dan acceso al correo de una persona y son
 * indefinidos. Un fichero de copia acaba descargado, en un portátil, en un
 * correo — y ahí un token vale lo mismo que la contraseña. No se copian: si hay
 * que restaurar, cada uno vuelve a conectar su cuenta, que es un clic.
 */
const COLUMNAS_OMITIDAS: Record<string, string[]> = {
  profiles: ['gmail_refresh_token', 'gmail_colabs_refresh_token'],
}

export type ResumenCopia = {
  fichero: string
  filas: Record<string, number>
  total: number
  bytes: number
  omitidas: string[]
}

const limpiar = (tabla: string, filas: Record<string, unknown>[]) => {
  const fuera = COLUMNAS_OMITIDAS[tabla]
  if (!fuera?.length) return filas
  return filas.map(f => {
    const copia = { ...f }
    for (const c of fuera) delete copia[c]
    return copia
  })
}

/**
 * Lee una tabla entera, en páginas.
 *
 * Sin paginar, PostgREST corta en 1.000 filas por defecto y devuelve las
 * primeras SIN error: la copia saldría incompleta y perfectamente verosímil, que
 * es justo lo que no puede pasar en un backup. Se pide de mil en mil hasta que
 * una página venga corta.
 */
async function leerTabla(admin: SupabaseClient, tabla: string): Promise<Record<string, unknown>[]> {
  const PAGINA = 1000
  const todo: Record<string, unknown>[] = []
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await admin.from(tabla).select('*').range(desde, desde + PAGINA - 1)
    // Un error aquí NO se traga: una copia a la que le falta una tabla y no lo
    // dice es peor que no tener copia, porque se confía en ella.
    if (error) throw new Error(`${tabla}: ${error.message}`)
    todo.push(...(data || []))
    if (!data || data.length < PAGINA) return todo
    // Tope de seguridad: a esta escala no se alcanza, y evita que un fallo de
    // paginación se convierta en un bucle que agota la función.
    if (todo.length >= 200_000) return todo
  }
}

/**
 * Hace la copia y la deja en Storage. Devuelve el resumen.
 *
 * @param dia Clave 'YYYY-MM-DD' de Madrid. La calcula quien llama con
 *   `todayKey()` — aquí no, para que el nombre del fichero no dependa de la zona
 *   horaria del servidor.
 */
export async function hacerCopia(admin: SupabaseClient, dia: string): Promise<ResumenCopia> {
  // El bucket se crea solo la primera vez: si hubiera que crearlo a mano en el
  // panel de Supabase, una instancia nueva se quedaría sin copias hasta que
  // alguien se acordara — y nadie se acuerda de lo que nunca ha fallado.
  // PRIVADO, obviamente: dentro va la base entera.
  const { data: buckets } = await admin.storage.listBuckets()
  if (!buckets?.some(b => b.name === BUCKET_COPIAS)) {
    const { error } = await admin.storage.createBucket(BUCKET_COPIAS, { public: false })
    // Si dos ejecuciones coinciden, la segunda falla con «ya existe» y da igual.
    if (error && !/exist/i.test(error.message)) {
      throw new Error(`no se pudo crear el bucket de copias: ${error.message}`)
    }
  }

  const contenido: Record<string, unknown[]> = {}
  const filas: Record<string, number> = {}
  for (const tabla of TABLAS_COPIADAS) {
    const datos = limpiar(tabla, await leerTabla(admin, tabla))
    contenido[tabla] = datos
    filas[tabla] = datos.length
  }

  const cuerpo = JSON.stringify(
    {
      version: 1,
      dia,
      hecha_en: new Date().toISOString(),
      // Escrito DENTRO del fichero: quien lo abra dentro de un año tiene que
      // saber qué le falta sin buscar este comentario.
      no_incluye: [
        'esquema, indices y politicas (se reconstruyen desde migrations/)',
        'ficheros de Storage (siguen en su bucket)',
        'tokens de Gmail (se omiten a proposito)',
        'tablas de servicio: job_locks, rate_limits, push_rate_limits',
      ],
      tablas: contenido,
    },
    null,
    0,
  )

  const fichero = `${dia}.json`
  const { error } = await admin.storage.from(BUCKET_COPIAS).upload(fichero, cuerpo, {
    contentType: 'application/json',
    // Sobrescribe la del mismo día: si el cron se ejecuta dos veces, no quedan
    // dos ficheros del mismo día compitiendo por ser el bueno.
    upsert: true,
  })
  if (error) throw new Error(`no se pudo guardar la copia: ${error.message}`)

  return {
    fichero,
    filas,
    total: Object.values(filas).reduce((n, x) => n + x, 0),
    bytes: cuerpo.length,
    omitidas: Object.entries(COLUMNAS_OMITIDAS).map(([t, cs]) => `${t}.${cs.join(', ')}`),
  }
}

/**
 * Borra las copias más viejas que `conservar` ficheros.
 *
 * Sin poda, un JSON diario llena el medio giga del plan gratuito y entonces
 * fallan las copias Y las subidas de la app. Devuelve cuántas ha borrado.
 */
export async function podarCopias(admin: SupabaseClient, conservar = 30): Promise<number> {
  const { data, error } = await admin.storage.from(BUCKET_COPIAS).list('', {
    limit: 200,
    sortBy: { column: 'name', order: 'desc' },
  })
  if (error || !data) return 0
  // Los nombres son 'YYYY-MM-DD.json', así que ordenar por nombre es ordenar por
  // fecha — sin depender de la marca de tiempo del Storage.
  const sobran = data.filter(f => f.name.endsWith('.json')).slice(conservar).map(f => f.name)
  if (!sobran.length) return 0
  const { error: errBorrado } = await admin.storage.from(BUCKET_COPIAS).remove(sobran)
  // El borrado SÍ se mira: si falla, el bucket crece en silencio hasta llenarse.
  if (errBorrado) {
    console.error('[copias] no se pudieron podar las copias viejas:', errBorrado.message)
    return 0
  }
  return sobran.length
}
