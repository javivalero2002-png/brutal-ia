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

export const dlLabel = (d?: string|null): string => {
  if (!d || d === 'TBD') return ''
  const t = dlDate(d)
  if (t.getTime() === 8640000000000000) return d
  return t.toLocaleDateString('es-ES', {day:'numeric', month:'short'})
}

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
