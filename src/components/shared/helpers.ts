import { RED, AMBAR, BLU } from './design-tokens'

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

// Hora y minuto de UN instante cualquiera en Madrid, para pintar y clasificar
// jornadas. Sin esto, un `new Date(iso).getHours()` da la hora de QUIEN MIRA: un
// fichaje de las 10:00 de Madrid, visto desde un rodaje en UTC+3, salía marcado
// «ENTRÓ TARDE» y con la barra corrida — la misma trampa que ya se arregló en el
// Calendario. En-GB con hour12:false da 00–23 (y 24 en medianoche, que se dobla a 0).
export const horaMinutoMadrid = (iso: string): { h: number; m: number } => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso))
  const h = Number(p.find(x => x.type === 'hour')?.value ?? 0)
  const m = Number(p.find(x => x.type === 'minute')?.value ?? 0)
  return { h: h === 24 ? 0 : h, m }
}

/**
 * El saludo según la hora de MADRID: mañana, tarde o noche.
 *
 * Los umbrales son los de España, no los de un reloj anglosajón: la tarde
 * empieza a las 14:00 (Javi y el jefe: «normalmente a partir de las 14:00 aquí
 * en España»). Antes estaba en 13:00 y escrito A MANO en tres sitios —dos en
 * Hoy y uno en Harvey—, así que cambiarlo obligaba a acordarse de los tres.
 * Vive aquí por eso, y porque uno de los tres calculaba la hora con
 * `new Date().getHours()`, o sea la del NAVEGADOR: desde un rodaje fuera de
 * España saludaba a destiempo. La franja se decide siempre en Madrid.
 */
export const saludoMadrid = (hora: number = madridHour()): string =>
  hora < 14 ? 'Buenos días' : hora < 21 ? 'Buenas tardes' : 'Buenas noches'

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
/**
 * Cómo se LLAMA cada nivel en pantalla. Un solo sitio, y a propósito.
 *
 * Estaba escrito de tres maneras: al crear elegías «Urgente / Alta / Normal», la
 * lista de Tareas lo repintaba «ALTA / MEDIA / BAJA» y el calendario mezclaba las
 * dos. Pulsabas ALTA y salía etiquetada MEDIA. Y no era solo el rótulo: el filtro
 * era `<option value="urgent">Alta</option>`, así que filtrar por «Alta» te daba
 * las Urgentes y escondía las Altas debajo de «Media».
 *
 * Se queda el vocabulario del formulario porque es el que ya entiende el resto del
 * código: `nivelTarea()`, aquí debajo, traduce «alta» a `high`. Llamar «MEDIA» a
 * `high` contradecía a este helper a diez líneas de distancia.
 */
export const NIVEL_TAREA: Record<NivelTarea, { label: string; corto: string; color: string }> = {
  urgent: { label: 'Urgente', corto: 'URGENTE', color: RED },
  high:   { label: 'Alta',    corto: 'ALTA',    color: AMBAR },
  normal: { label: 'Normal',  corto: 'NORMAL',  color: BLU },
}

/** El rótulo de un nivel que puede venir de cualquier sitio, incluido el modelo. */
export const rotuloNivel = (crudo?: string | null, corto = false) => {
  const n = NIVEL_TAREA[nivelTarea(crudo)]
  return corto ? n.corto : n.label
}

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
  //
  // Dos trampas pagadas aquí. La clase antigua incluía \s, así que en «12 mil»
  // consumía «2 » y el sufijo opcional caía sobre la «m» de la PALABRA
  // SIGUIENTE: 12 → 12.000.000. Con «1500 mensuales» —escrito tal cual invita
  // el placeholder— el MRR subía 1.500 millones. Ahora el número no puede
  // acabar en espacio, y el sufijo solo vale como token completo: una «m»
  // pegada a más letras es otra palabra, no un multiplicador.
  const m = /(\d[\d.,]*(?:\s\d[\d.,]*)*)\s*([km])?(?![a-zñá-ú])/i.exec(t.replace(/[€$£]/g, ''))
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

  // «mil» y «millones» escritos con todas sus letras son sufijo legítimo.
  const porPalabra = /\bmillon(es)?\b/.test(sinTildes) ? 1_000_000 : /\bmil(es)?\b/.test(sinTildes) ? 1_000 : 1
  const factor = sufijo === 'k' ? 1_000 : sufijo === 'm' ? 1_000_000 : porPalabra
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

/**
 * La dirección incrustable de un vídeo, o `null` si no se puede incrustar.
 *
 * Drive está aquí porque la propia app le dice al usuario «sube el vídeo a
 * YouTube, Vimeo o Drive» y luego no sabía enseñar los de Drive: el cliente
 * abría el enlace de revisión y veía el título y una caja de texto vacía. Le
 * pedíamos opinión sobre algo que no le enseñábamos.
 *
 * Quien no case aquí NO es un fallo: es material que hay que abrir aparte, y
 * quien llame debe ofrecer el enlace en vez de no pintar nada.
 */
export const videoEmbed = (url: string) => {
  if (!url) return null
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/)
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`
  const vm = url.match(/vimeo\.com\/(\d+)/)
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`
  // Drive: /file/d/ID/view — y también los enlaces con ?id=ID.
  const dr = url.match(/drive\.google\.com\/file\/d\/([^/?&\s]+)/)
    || url.match(/drive\.google\.com\/[^\s]*[?&]id=([^&\s]+)/)
  if (dr) return `https://drive.google.com/file/d/${dr[1]}/preview`

  // Instagram: reels, publicaciones y tv. Es lo que más se va a pegar aquí —el
  // estudio publica ahí— y hasta ahora no se entendía, aunque el propio texto de
  // la pantalla lo prometía. Pegabas el enlace y no se veía nada.
  const ig = url.match(/instagram\.com\/(?:reel|reels|p|tv)\/([^/?&\s]+)/)
  if (ig) return `https://www.instagram.com/p/${ig[1]}/embed`

  return null
}

/**
 * ¿El vídeo es vertical? Decide la forma del hueco donde se pinta.
 *
 * Un reel de Instagram en un marco 16:9 sale como un sello en medio de dos
 * franjas negras — que es justo lo contrario de «verse con facilidad» cuando es el
 * formato que más se publica. Con esto el marco se adapta al vídeo en vez de al
 * revés.
 */
export const videoEsVertical = (url: string) =>
  /instagram\.com\/(reel|reels|tv)\//.test(url || '')

/**
 * La forma del hueco donde se pinta un vídeo incrustado.
 *
 * Javi: «cuando quiero ver un vídeo después de poner el enlace, no se me
 * reproduce». No era eso: el vídeo estaba y se reproducía. Medido abriendo el
 * embed a pelo —hay un `<video>` de cdninstagram, 37,5 s, y arranca al pulsar—.
 * Lo que fallaba era el MARCO.
 *
 * A un reel se le ponía 9/16 porque es vídeo vertical, pero lo que se incrusta no
 * es el vídeo: es la TARJETA de Instagram, con su cabecera de cuenta y su pie de
 * «me gusta». Esa tarjeta mide 1 : 1,46 —medido en el navegador—, así que en un
 * hueco de 1 : 1,78 sobraban casi veinte de cada cien píxeles de alto y salían en
 * NEGRO, justo debajo de la portada. Parecía un vídeo que no carga.
 *
 * YouTube, Vimeo y Drive sí son marcos de vídeo puros y siguen en 16/9.
 */
export const proporcionEmbed = (url: string): { aspectRatio: string; maxWidth: string } => {
  if (/instagram\.com\//.test(url || '')) return { aspectRatio: '1 / 1.46', maxWidth: '340px' }
  if (videoEsVertical(url)) return { aspectRatio: '9 / 16', maxWidth: '320px' }
  return { aspectRatio: '16 / 9', maxWidth: 'none' }
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

/**
 * ¿Esta persona FICHÓ ese día? Una sola respuesta para toda la app.
 *
 * Javi: «aquí me pone 3 seguidos y en verdad no completé ningún día de fichar». Y
 * tenía razón: su diario tenía CUATRO filas —25, 24, 22 y 21 de agosto— y las
 * cuatro completamente vacías. Ni hora de entrada, ni cierre, ni una palabra.
 * Filas fantasma que deja el guardado automático del borrador con solo abrir la
 * sección.
 *
 * `/api/diario/mes` contaba CUALQUIER fila como «fichó ese día», así que la racha
 * decía 3 (salta los fines de semana: 25, 24, y 21) sobre cero días fichados.
 *
 * LA MARCA ES `entrada_at`, y no el texto, porque es lo único que significa
 * exactamente esto: el servidor la sella solo cuando guardas de verdad —no un
 * borrador— y en un día que no es futuro. Escribir texto en un borrador es estar
 * escribiendo; planificar el jueves que viene es planificar. Fichar es otra cosa.
 *
 * Había TRES criterios distintos repartidos por la app para la misma pregunta.
 * Este es el único.
 */
/**
 * Cómo se compara el texto de un objetivo con el de su tarea.
 *
 * Sin tildes, sin signos y sin dobles espacios, porque las dos cosas las escribe
 * una persona y no siempre igual. Estaba escrito DOS veces —en `DiarioSection` y
 * en `/api/diario/pendientes`— byte por byte, que es la fábrica de gemelos de este
 * repo: el día que una de las dos empiece a conservar los dígitos o los guiones, el
 * diario y los pendientes dejarán de emparejar lo mismo y nadie lo verá.
 */
export const normalizarObjetivo = (t: string) =>
  (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

export const haFichado = (d: { entrada_at?: string | null } | null | undefined) =>
  !!d?.entrada_at

/**
 * ¿Esta fila de diario CUENTA como un día, o es un resto?
 *
 * Abrir Fichar y escribir dos letras que luego borras deja una fila con
 * `entrada: ''` y todo lo demás a null. En la base hay cuatro así ahora mismo.
 *
 * No es un detalle de limpieza: esa fila se contaba como día. El briefing decía
 * «1 día» de alguien que no estuvo, el resumen del equipo escribía una línea por
 * cada una —«no escribió objetivos · no cerró el día»— y las dos IAs lo leían y lo
 * repetían en voz alta. Textual de Brutal.IA con los datos reales: «ha habido
 * actividad los días 21, 22, 24 y 25». No la hubo.
 *
 * Existir no es haber hecho algo. Una fila cuenta si tiene texto, si se fichó, si
 * se cerró o si se dijo cómo fue el día.
 */
export const diarioTieneAlgo = (d: {
  entrada?: string | null; cierre?: string | null
  entrada_at?: string | null; cierre_at?: string | null; animo?: string | null
} | null | undefined) =>
  !!(d && ((d.entrada || '').trim() || (d.cierre || '').trim() || d.entrada_at || d.cierre_at || d.animo))

// ─────────────────────────────────────────────────────────────────────────────
// LO QUE ESCRIBE EL MODELO, NORMALIZADO EN LA FRONTERA.
//
// `nivelTarea` existe desde hace tiempo y hace exactamente esto para las tareas.
// Pero de las CINCO acciones que Harvey puede emitir, solo la tarea pasaba por un
// normalizador: las otras cuatro metían `campo(n).trim()` crudo en la base.
//
// No rebotaba nada porque esas columnas NO tienen CHECK —al revés que `level` o
// `animo`— así que el fallo no era un error, era un dato falso que se guarda:
// una pieza con plataforma «Facebook» no casa ningún color y sale en gris, y un
// proyecto con deadline «próximo viernes» no vence NUNCA, porque
// `estadoDeadline` devuelve null para lo que no sea YYYY-MM-DD.
// ─────────────────────────────────────────────────────────────────────────────

/** Las plataformas que la app sabe pintar. Una sola lista, no tres. */
export const PLATAFORMAS = ['Instagram', 'TikTok', 'YouTube', 'LinkedIn', 'Twitter', 'Pinterest'] as const
export const TIPOS_CONTENIDO = ['Post', 'Reel', 'Story', 'Video', 'Carrusel', 'Newsletter', 'Thread'] as const

const casaCon = <T extends string>(lista: readonly T[], crudo: string | null | undefined, porDefecto: T): T => {
  const v = (crudo || '').trim().toLowerCase()
  if (!v) return porDefecto
  const exacta = lista.find(x => x.toLowerCase() === v)
  if (exacta) return exacta
  // «ig», «yt», «insta»: lo que el modelo escribe cuando abrevia.
  const parcial = lista.find(x => x.toLowerCase().startsWith(v) || v.startsWith(x.toLowerCase()))
  return parcial || porDefecto
}

export const plataformaContenido = (crudo?: string | null) => casaCon(PLATAFORMAS, crudo, 'Instagram')
export const tipoContenido = (crudo?: string | null) => casaCon(TIPOS_CONTENIDO, crudo, 'Post')

/**
 * Una fecha que la app pueda usar, o 'TBD'.
 *
 * `estadoDeadline` solo entiende `YYYY-MM-DD`. Guardar «próximo viernes» no da
 * error: crea un proyecto que no vence nunca y que no sale en ninguna alerta de
 * retraso. 'TBD' es lo que la app ya usa para «sin fecha», y al menos es cierto.
 */
export const fechaOTBD = (crudo?: string | null): string => {
  const v = (crudo || '').trim()
  if (!v) return 'TBD'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'TBD'
  // Bien formada pero imposible: '2026-13-45' pasa el patrón y no existe.
  const d = new Date(`${v}T12:00:00`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? 'TBD' : v
}

/**
 * La marca de dedup del motor de reglas, que viaja DENTRO de `tasks.notes`.
 *
 * El motor crea sus tareas con `notes: '⚙ auto:clave'` y esa clave es lo único
 * que impide que la misma regla cree la misma tarea cada hora (automations.ts
 * la relee de las notas — dedup sin migración). El problema: notes es un campo
 * que el usuario ve y EDITA. Sin estos helpers, el editor enseñaba la marca en
 * crudo —«⚙ auto:overdue:9f2c…» como si fuera una nota tuya— y bastaba borrarla
 * y guardar para que la tarea «duplicada» reapareciera en la siguiente pasada.
 *
 * El contrato es de ida y vuelta: la UI pinta y edita SOLO `texto`, y al
 * guardar vuelve a unir la marca que hubiera. Un campo que el usuario no ha
 * tocado no debe cambiar por el viaje.
 */
export const AUTO_MARK = '⚙ auto:'

/** Separa la marca del motor (si la hay) del texto legible de unas notas. */
export const separarMarcaAuto = (notes: string | null | undefined): { marca: string | null; texto: string } => {
  const n = notes || ''
  const idx = n.indexOf(AUTO_MARK)
  if (idx < 0) return { marca: null, texto: n }
  // La clave llega hasta el primer blanco — mismo corte que hace el motor al releerla.
  const resto = n.slice(idx + AUTO_MARK.length)
  const clave = resto.split(/\s/)[0]
  return {
    marca: AUTO_MARK + clave,
    texto: (n.slice(0, idx) + resto.slice(clave.length)).trim(),
  }
}

/** Reúne texto editado y marca para guardar. Devuelve null si no queda nada. */
export const unirMarcaAuto = (texto: string | null | undefined, marca: string | null): string | null => {
  const t = (texto || '').trim()
  if (!marca) return t || null
  return t ? `${t}\n${marca}` : marca
}

/**
 * ¿Es un remitente automático que no lee respuestas?
 *
 * Medido contra el buzón real: el 49% de los mensajes vienen de direcciones
 * así (notifications@github, jobalerts-noreply@linkedin, drive-shares-dm-
 * noreply@google…). Ofrecer «Harvey redacta la respuesta» ahí gasta una
 * llamada al modelo en un borrador que no puede llegar a nadie — y peor,
 * hace creer que responder sirve de algo.
 *
 * Conservador a propósito: solo el local-part, y solo las formas que no
 * puede tener una persona. Un falso negativo enseña un botón de más; un
 * falso positivo le quita a alguien la posibilidad de responder a un humano.
 */
export const esNoReply = (email: string | null | undefined): boolean => {
  const [local, dominio] = (email || '').toLowerCase().split('@')
  if (!local) return false
  // Dominios que SOLO envían notificaciones, se llame como se llame el local:
  // en la vista Personas, seis avisos de security@facebookmail.com encabezaban
  // la lista de «humanos». facebookmail.com es el dominio de notificaciones de
  // Facebook — ahí no escribe nadie.
  if (dominio === 'facebookmail.com') return true
  // «noresponder» es el noreply en español (idealista lo usa y era el segundo
  // remitente más frecuente del buzón). «reminders» salió al probar con el
  // buzón real: reminders@facebookmail.com. Marketing (temu@, campaigns@,
  // info@…) queda FUERA a propósito: ahí puede haber una persona leyendo.
  return /no[-_.]?reply|no[-_.]?responder|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon/.test(local)
    || /^(notifications?|bounces?|reminders?)$/.test(local)
}

/**
 * Quita los caracteres de control que Postgres no puede almacenar en `text`.
 *
 * El byte NULO (U+0000) es el que muerde: un insert con un nulo dentro rebota
 * con «unsupported Unicode escape sequence» —un 500 crudo— y llega más de lo que
 * parece, al pegar texto copiado de un PDF o de ciertas apps de Windows. `ai.ts`
 * ya tenía este saneo para no romper la API de Anthropic; las rutas de escritura
 * no lo aplicaban y un byte nulo en una nota tumbaba el guardado. Se conservan
 * tab, salto de línea y retorno (\x09/\x0A/\x0D): son texto legítimo y Postgres
 * los guarda sin queja (medido en la prueba de estrés).
 */
export const sinControl = (s: string | null | undefined): string | null | undefined => {
  if (typeof s !== 'string') return s
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
}
