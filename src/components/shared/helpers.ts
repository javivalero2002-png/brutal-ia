const DL_FAR_FUTURE = new Date(8640000000000000)
const DL_MES: Record<string,number> = {ene:0,feb:1,mar:2,abr:3,may:4,jun:5,jul:6,ago:7,sep:8,oct:9,nov:10,dic:11,jan:0,apr:3,aug:7,dec:11}

export const dlDate = (d?: string|null): Date => {
  if (!d || d === 'TBD') return DL_FAR_FUTURE
  const str = d.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const t = new Date(str.slice(0,10)+'T23:59:59')
    return isNaN(t.getTime()) ? DL_FAR_FUTURE : t
  }
  if (/^hoy$/i.test(str)) { const t = new Date(); t.setHours(23,59,59,0); return t }
  const m = str.toLowerCase().match(/^(?:(\d{1,2})\s+)?([a-záéíóú]{3,})\.?\s+(\d{4})$/)
  if (m) {
    const mon = DL_MES[m[2].slice(0,3)]
    if (mon !== undefined) return new Date(+m[3], mon, m[1] ? +m[1] : 28, 23, 59, 59)
  }
  const t = new Date(str)
  return isNaN(t.getTime()) ? DL_FAR_FUTURE : t
}

// Fecha "hoy" en la zona horaria de España (Europe/Madrid), formato YYYY-MM-DD.
// NO usar `new Date().toISOString().slice(0,10)`: eso da la fecha en UTC y tras
// las ~22-23h de Madrid salta al día siguiente, rompiendo "vence hoy",
// "completadas hoy" y las automatizaciones del día.
export const todayKey = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' })

// Convierte cualquier fecha/ISO a su día local en España (YYYY-MM-DD).
export const localDayKey = (d: string | number | Date): string =>
  new Date(d).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' })

// Días naturales entre dos day keys (YYYY-MM-DD). Positivo si `hasta` es posterior.
//
// Restar timestamps y dividir entre 86400000 cuenta bloques de 24 HORAS, que no es
// lo mismo: un email de ayer a las 22:00 daba 0 días a las 09:00 de la mañana
// siguiente, y la UI seguía diciendo "HOY". Anclando las dos claves a medianoche
// UTC la resta es exacta y el cambio de hora no la afecta, porque ambas se anclan
// igual — el día ya viene resuelto en zona de Madrid por localDayKey/todayKey.
export const daysBetweenKeys = (desde: string, hasta: string): number =>
  Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000)

// Hora del día (0-23) en Madrid. `new Date().getHours()` usa la zona de QUIEN
// ejecuta: en el servidor de Vercel es UTC y en el navegador la del usuario.
// HoySection es la única sección con render en servidor, así que ese desajuste
// rompía la hidratación de React entre las 13:00 y las 15:00 de Madrid — el
// servidor mandaba "Buenos días" y el cliente pintaba "Buenas tardes".
export const madridHour = (): number =>
  Number(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid', hour: 'numeric', hour12: false }))

// Fecha larga en español, fijada a Madrid para que servidor y cliente coincidan.
export const madridDateLabel = (opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }): string =>
  new Date().toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', ...opts })

export const dlLabel = (d?: string|null): string => {
  if (!d || d === 'TBD') return ''
  const t = dlDate(d)
  if (t.getTime() === 8640000000000000) return d
  return t.toLocaleDateString('es-ES', {day:'numeric', month:'short'})
}

// Normaliza el nivel de una tarea que viene del MODELO, no de un formulario.
//
// Harvey emite `[ACCION:tarea|texto|nivel|persona]` y el nivel es literalmente lo
// que haya escrito Claude. El prompt le pide «urgent, high, normal» en inglés
// dentro de una conversación entera en español, así que un «urgente» es cuestión
// de tiempo — y `tasks.level` tiene CHECK (level in ('urgent','high','normal')):
// un valor de fuera hace que el INSERT rebote, la tarea no se cree y Harvey ya
// haya dicho en voz alta que la creaba.
//
// Estaba sin validar en los dos sitios que confirman la acción, y en uno de ellos
// el error de tipo estaba TAPADO con `as any` — por eso no se veía.
export const NIVELES_TAREA = ['urgent', 'high', 'normal'] as const
export type NivelTarea = (typeof NIVELES_TAREA)[number]

// `porDefecto` existe porque el mismo vocabulario sirve para dos cosas con
// prudencias opuestas: una TAREA que Harvey crea sin decir nivel se queda en
// 'high' (que la vea alguien), y la urgencia de un CORREO que el modelo no supo
// clasificar se queda en 'normal' (no inflar la bandeja de todo el equipo).
// Un segundo normalizador para eso seria justo el gemelo que este proyecto no
// para de pagar.
export const nivelTarea = (crudo?: string | null, porDefecto: NivelTarea = 'high'): NivelTarea => {
  const v = (crudo || '').trim().toLowerCase()
  if (!v) return porDefecto
  if ((NIVELES_TAREA as readonly string[]).includes(v)) return v as NivelTarea
  // Lo que el modelo escribe cuando contesta en español.
  if (/^(urgente|urgentes|crítica|critica|máxima|maxima)$/.test(v)) return 'urgent'
  if (/^(alta|alto|importante|prioritaria)$/.test(v)) return 'high'
  if (/^(normal|media|medio|baja|bajo|low)$/.test(v)) return 'normal'
  return porDefecto
}

// Plural en los recuentos que la UI enseña. Sin esto salían "1 mensajes
// marcados como leídos", "Propietario · 1 tareas" y "1 eventos": el patrón
// `${n} cosas` estaba escrito a mano en una docena de sitios y ninguno miraba
// el número. Se pasa el singular y, si el plural no es el singular + "s"
// (mes → meses), se pasa también.
export const plural = (n: number, singular: string, plural?: string): string =>
  `${n} ${n === 1 ? singular : (plural ?? singular + 's')}`

// ¿Esta tarea es de esta persona? Una sola respuesta para toda la app.
//
// Estaba escrito solo en EquipoSection, y ReportesSection tenia el suyo propio con
// DOS diferencias: emparejaba por `assignee.name` en vez de por id, e ignoraba por
// completo `co_assigned_to`. Resultado: la misma persona salia con una carga de
// trabajo en Equipo y otra distinta en Reportes — y quien solo estuviera
// co-asignado aparecia con CERO tareas en el informe.
//
// Por id y no por nombre: `profiles.name` no es unique, y dos homonimos se
// fusionaban en uno.
/**
 * El rango que hay que PEDIR a la base para quedarse luego con un día de Madrid.
 *
 * `completed_at` es un instante UTC y el día del diario es un día de Madrid, así
 * que no se pueden comparar como texto: `${dia}T00:00:00Z` empieza a las 02:00 de
 * Madrid en verano. Lo cerrado entre medianoche y las dos se apuntaba al día
 * anterior — y Reportes, que sí usa `localDayKey`, lo colocaba bien. Dos
 * pantallas dando dos respuestas del mismo trabajo.
 *
 * Se pide con un día de margen por cada lado y se decide en JS con `localDayKey`,
 * que es la única fuente de verdad de a qué día pertenece algo.
 */
export const ventanaDelDia = (dia: string, diasAntes = 0) => {
  const t = Date.parse(`${dia}T12:00:00Z`)
  const clave = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  return {
    desde: `${clave(t - (diasAntes + 1) * 86400000)}T00:00:00Z`,
    hasta: `${clave(t + 86400000)}T23:59:59.999Z`,
  }
}

// Acepta las DOS formas de una tarea: la del cliente, que trae los perfiles
// embebidos (`assignee`), y la cruda del servidor, que solo trae los ids.
//
// Hacía falta porque el criterio de «tarea de quién» estaba escrito de dos
// maneras: Reportes usaba esta función (que cuenta al co-responsable) y el
// Diario, el briefing y Harvey usaban `assigned_to === id` a secas. Una tarea
// con dos responsables sumaba en un sitio y no en el otro, así que los dos
// comprobadores daban números distintos del mismo trabajo.
/**
 * Lee la facturación de un cliente, que es TEXTO LIBRE.
 *
 * Lo que había hacía `parseFloat` sobre la cadena limpia, y eso convertía en
 * silencio importes en números mil veces más pequeños:
 *
 *   «12k»    → 12          (debería ser 12.000)
 *   «1,5k»   → 1,5         (1.500)
 *   «1.2M»   → 12          (1.200.000 — el punto se quitaba como separador de
 *                           miles y quedaba «12M», que parseFloat corta en 12)
 *
 * Y el periodo se TIRABA: `.replace(/\/.*$/, '')` borraba «/año» junto con todo
 * lo demás, así que un contrato anual se sumaba al MRR como si fuera mensual —
 * doce veces más de lo que es.
 *
 * Devuelve siempre el equivalente MENSUAL, que es lo que significa MRR, más el
 * periodo leído para poder decirlo en pantalla.
 */
export function parseImporte(bruto?: string | null): { mensual: number; anual: boolean } {
  const t = (bruto || '').trim()
  if (!t || t === '—') return { mensual: 0, anual: false }

  const sinTildes = t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const anual = /\b(anual|ano|year|yr)\b|\/\s*(ano|year)/.test(sinTildes)

  // El número, con su sufijo. Se busca el PRIMERO: «12k/mes» y «€12k» dan igual.
  const m = /(\d[\d.,\s]*)\s*([km])?/i.exec(t.replace(/[€$£]/g, ''))
  if (!m) return { mensual: 0, anual }

  let cuerpo = m[1].replace(/\s/g, '')
  // Español: el punto separa miles y la coma decimales. Pero «1.2M» usa el punto
  // como decimal, así que un punto seguido de MENOS de tres cifras y con sufijo
  // se trata como decimal — que es como lo escribe la gente.
  const sufijo = (m[2] || '').toLowerCase()
  if (sufijo && /^\d+\.\d{1,2}$/.test(cuerpo)) cuerpo = cuerpo.replace('.', ',')
  cuerpo = cuerpo.replace(/\./g, '').replace(',', '.')

  const n = parseFloat(cuerpo)
  if (!Number.isFinite(n)) return { mensual: 0, anual }

  const factor = sufijo === 'k' ? 1_000 : sufijo === 'm' ? 1_000_000 : 1
  const total = n * factor
  return { mensual: anual ? total / 12 : total, anual }
}

/**
 * ¿Casa este texto con lo que se ha buscado?
 *
 * Lo que había era un `includes()` de la cadena entera en minúsculas, y eso falla
 * en los dos casos que se dan de verdad al escribir en español:
 *
 *   · «diseno» no encontraba «diseño», ni «Nike» encontraba «nike» con tilde
 *     alrededor: la comparación no normalizaba.
 *   · «presupuesto nike» no encontraba «Presupuesto de Nike», porque buscaba la
 *     frase LITERAL y sobra un «de» en medio.
 *
 * Ahora se parte la búsqueda en palabras y se exigen TODAS, en cualquier orden y
 * en cualquier sitio del texto. Es lo que hace la gente sin darse cuenta: teclear
 * dos palabras que recuerda y esperar que aparezca.
 *
 * Importa más ahora que los documentos entran solos en Memoria: con veinte notas
 * se encontraba a ojo, con doscientas no.
 */
const sinTildes = (t: string) =>
  (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

export function buscaEnTexto(texto: string, consulta: string): boolean {
  const q = sinTildes(consulta).split(/\s+/).filter(Boolean)
  if (!q.length) return true
  const t = sinTildes(texto)
  return q.every(p => t.includes(p))
}

export const esTareaDe = (
  t: {
    assignee?: { id?: string } | null; co_assignee?: { id?: string } | null
    assigned_to?: string | null; co_assigned_to?: string | null
  },
  miembro: { id?: string },
): boolean =>
  !!miembro?.id && (
    t.assignee?.id === miembro.id || t.co_assignee?.id === miembro.id ||
    t.assigned_to === miembro.id || t.co_assigned_to === miembro.id
  )

/** Tiene responsable, sea principal o co-responsable. */
export const tieneResponsable = (
  t: { assignee?: unknown; co_assignee?: unknown; co_assigned_to?: unknown },
): boolean => !!t.assignee || !!t.co_assignee || !!t.co_assigned_to

export const strColor = (s: string) => {
  const palette = ['#3B82F6','#8B5CF6','#EC4899','#F59E0B','#10B981','#EF4444','#06B6D4','#F97316','#6366F1','#84CC16']
  let h = 0; for (let i=0;i<s.length;i++) h = s.charCodeAt(i)+((h<<5)-h)
  return palette[Math.abs(h) % palette.length]
}

export const relTime = (iso: string) => {
  const ts = new Date(iso).getTime()
  if (isNaN(ts)) return ''
  const m = Math.floor((Date.now()-ts)/60000)
  if (m<2) return 'ahora'
  if (m<60) return `${m}m`
  if (m<1440) return `${Math.floor(m/60)}h`
  if (m<10080) return `${Math.floor(m/1440)}d`
  return new Date(iso).toLocaleDateString('es-ES',{day:'numeric',month:'short'})
}

export const videoEmbed = (url: string) => {
  if (!url) return null
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/)
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`
  const vm = url.match(/vimeo\.com\/(\d+)/)
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`
  return null
}

// Estado de un deadline en DÍAS, no en instantes.
//
// Existía tres veces escrito a mano en ProyectosSection, siempre así:
//
//     Math.round(Math.abs(dlDate(p.deadline).getTime() - Date.now()) / 86400000)
//
// y estaba mal las tres. dlDate() devuelve el deadline a las 23:59:59, así que a
// las 09:00 del día en que vence la resta da 0,62 días → Math.round → 1 → la UI
// decía "+1d" para algo que vencía HOY. La rama de 'HOY' solo se alcanzaba a
// partir de las ~12:00. Y con Math.abs, un proyecto vencido AYER daba
// Math.round(0,37) = 0 y salía "−0d".
//
// O sea: antes de mediodía todos los contadores de la sección iban desplazados un
// día entero, todos los días.
//
// Un deadline es un DÍA, no un instante — la misma regla que ya cubre
// src/lib/automations.ts. Comparando claves de día la hora deja de importar.
export function estadoDeadline(deadline?: string|null): {
  dias: number; vencido: boolean; pronto: boolean; etiqueta: string; etiquetaLarga: string
} | null {
  if (!deadline || deadline === 'TBD') return null
  const dias = daysBetweenKeys(todayKey(), deadline.slice(0, 10))
  // Deadlines en TEXTO LIBRE ("ago 2026", "finales de mes"): quedan de cuando el
  // campo era un input suelto, y siguen en la base. slice(0,10) no los sabe leer,
  // Date.parse da NaN y `dias` sale NaN — que no es inofensivo, porque `NaN < 0`
  // es false y `NaN === 0` también: el deadline no se marca ni vencido ni de hoy,
  // y la etiqueta se pinta literalmente "+NaNd".
  //
  // Devolver null es lo correcto: significa "no sé cuándo vence", que es la
  // verdad, y todos los consumidores ya tratan el null (es lo que devuelve un
  // deadline vacío o 'TBD'). Se hace aquí y no en cada sitio porque estadoDeadline
  // se llama ya desde ocho ficheros, y blindarlo en siete es dejarse uno.
  // Para PINTAR el texto original está dlLabel(), que sí lo interpreta.
  if (!Number.isFinite(dias)) return null
  return {
    dias,
    vencido: dias < 0,
    pronto: dias >= 0 && dias <= 7,
    etiqueta: dias === 0 ? 'HOY' : dias < 0 ? `−${-dias}d` : `+${dias}d`,
    etiquetaLarga: dias === 0 ? 'HOY' : dias < 0 ? `hace ${-dias}d` : `en ${dias}d`,
  }
}

// Qué decirle al usuario cuando /api/harvey/transcribe no devuelve OK.
//
// Existe porque el diagnóstico estaba MAL y además escrito dos veces. HoySection
// solo desviaba en `res.status === 402`, y esa ruta no devuelve 402 en ningún
// sitio: era código muerto. Todo lo demás —401, 400, 413, 429, 503, 502— caía en
// «No se entendió el audio, vuelve a pulsar», que culpa al usuario de un fallo
// del servidor. Y se refuerza solo: a las diez repeticiones en un minuto salta el
// 429, cuyo texto también se tragaba el mismo `else`.
//
// Por qué traduce en vez de usar `json.error` a secas, que era lo propuesto: tres
// de esos estados contestan en INGLÉS («Unauthorized», «STT not configured»,
// «Transcription failed»), así que justo en el caso que motivó el arreglo la
// interfaz en español enseñaría «STT not configured». El texto del servidor se
// usa solo cuando ya viene en español y dice algo accionable (429 y 413).
export function mensajeErrorTranscripcion(status: number, delServidor?: string | null): string {
  // El propio servidor responde en español y con algo que hacer.
  if (status === 429 || status === 413) {
    return delServidor || 'Audio demasiado largo o demasiadas grabaciones seguidas — espera un momento'
  }
  if (status === 401) return 'Tu sesión ha caducado — vuelve a entrar'
  if (status === 503) return 'La transcripción no está configurada — avisa a quien lleva Brutal.IA'
  if (status === 400) return 'No llegó el audio — vuelve a grabar'
  // 502 y cualquier otro: es del servidor, y decirlo así es lo que evita que el
  // usuario repita la grabación creyendo que habla mal.
  return 'El servicio de transcripción falló — inténtalo en un momento'
}
