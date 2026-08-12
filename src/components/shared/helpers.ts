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

// Plural en los recuentos que la UI enseña. Sin esto salían "1 mensajes
// marcados como leídos", "Propietario · 1 tareas" y "1 eventos": el patrón
// `${n} cosas` estaba escrito a mano en una docena de sitios y ninguno miraba
// el número. Se pasa el singular y, si el plural no es el singular + "s"
// (mes → meses), se pasa también.
export const plural = (n: number, singular: string, plural?: string): string =>
  `${n} ${n === 1 ? singular : (plural ?? singular + 's')}`

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
