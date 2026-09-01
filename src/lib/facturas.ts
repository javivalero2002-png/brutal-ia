import { todayKey } from '@/components/shared/helpers'

// ─────────────────────────────────────────────────────────────────────────────
// FACTURAS: lo que hay que saber en los dos lados.
//
// Vive aquí y no dentro de la ruta ni dentro de la sección porque las dos
// necesitan lo mismo —qué estado tiene una factura, cuánto suma con IVA— y
// escribirlo dos veces es la fábrica de gemelos que este repo lleva pagando toda
// la auditoría: el servidor diría «vencida» y la pantalla «pendiente», y eso no
// se ve hasta que alguien reclama un cobro que ya estaba hecho.
// ─────────────────────────────────────────────────────────────────────────────

export type Factura = {
  id: string
  client_id: string
  numero: string | null
  concepto: string | null
  importe_centimos: number
  iva_pct: number
  emitida_el: string
  vence_el: string | null
  cobrada_el: string | null
  notas: string | null
  created_at?: string
}

export type EstadoFactura = 'cobrada' | 'vencida' | 'pendiente'

/**
 * El estado se DERIVA, no se guarda.
 *
 * Una columna de estado sería una segunda verdad que hay que mantener en
 * sincronía con las fechas, y en cuanto se olvide una actualización la pantalla
 * dice «pendiente» de algo cobrado. Esta app ya lo pagó con `archived_at`.
 *
 * Y se compara por DÍA, nunca restando instantes: un deadline es un día entero.
 * Comparar timestamps hizo que una tarea que vencía hoy saliera vencida desde las
 * 02:00 de Madrid, con la pantalla diciendo lo contrario. Ver CLAUDE.md.
 */
export function estadoFactura(f: Pick<Factura, 'cobrada_el' | 'vence_el'>, hoy: string = todayKey()): EstadoFactura {
  if (f.cobrada_el) return 'cobrada'
  // Sin fecha de vencimiento NO está vencida: nadie ha incumplido nada. Poner
  // aquí una fecha por defecto convertiría en moroso a quien no lo es.
  if (f.vence_el && f.vence_el < hoy) return 'vencida'
  return 'pendiente'
}

/** El total con IVA, en céntimos y en enteros. */
export const totalConIva = (f: Pick<Factura, 'importe_centimos' | 'iva_pct'>): number =>
  Math.round(f.importe_centimos * (100 + (f.iva_pct ?? 0)) / 100)

/**
 * Céntimos → «€1.234,56». En un solo sitio porque la alternativa es que la lista,
 * el total y el PDF redondeen distinto y no cuadren entre ellos por un céntimo,
 * que es el tipo de diferencia que hace desconfiar de toda la pantalla.
 */
export const euros = (centimos: number): string =>
  // `useGrouping: 'always'` y no el defecto. En es-ES la agrupación automática
  // NO separa los números de cuatro cifras —«1815,00»—, que es correcto en
  // castellano y queda raro justo aquí: al lado, la facturación del cliente la
  // escribe una persona y pone «€1.500». Dos formas del mismo número en la misma
  // pantalla se leen como un fallo. Visto en el navegador, no deducido.
  '€' + (centimos / 100).toLocaleString('es-ES',
    { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })

/**
 * «1.234,56 €», «1234.56», «1.234» → céntimos.
 *
 * Se escribe a mano en un campo, así que llega de todo. La regla que importa: el
 * ÚLTIMO separador decide, y solo si deja dos dígitos detrás. Con `parseFloat` a
 * secas, «1.234,56» son 1,23 € —mil veces menos— y nadie lo nota hasta que el
 * total no cuadra. Devuelve null si no hay nada interpretable, que NO es lo mismo
 * que cero: cero es una factura de cero euros.
 */
export function importeACentimos(texto: string): number | null {
  const limpio = String(texto || '').replace(/[^\d.,-]/g, '').trim()
  if (!limpio || !/\d/.test(limpio)) return null
  const ultimo = Math.max(limpio.lastIndexOf(','), limpio.lastIndexOf('.'))
  // UNO O DOS dígitos detrás del último separador: es la parte decimal. TRES es
  // un separador de millares («1.500» son mil quinientos euros en España).
  //
  // Empecé exigiendo exactamente dos y el test lo tumbó: «1500,5» se leía como
  // 15005 y salían €15.005 en vez de €1.500,50 — diez veces más, en un campo que
  // alguien va a comparar con su banco. Escribir un solo decimal es de lo más
  // normal cuando el importe acaba en cero.
  const detras = ultimo >= 0 ? limpio.length - ultimo - 1 : -1
  const decimales = detras === 1 || detras === 2
  const entero = decimales ? limpio.slice(0, ultimo) : limpio
  const resto = decimales ? limpio.slice(ultimo + 1) : '00'
  const n = Number(entero.replace(/[.,]/g, '') + resto.padEnd(2, '0'))
  return Number.isFinite(n) ? n : null
}
