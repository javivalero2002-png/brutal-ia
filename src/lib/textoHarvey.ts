/**
 * Lo que Harvey dice, limpio para leerlo y para decirlo.
 *
 * El prompt ya le pide «texto limpio, cero markdown, nada de asteriscos»
 * (harvey/chat/route.ts:204) y aun así emitió `**Estado del día:**` en un
 * briefing. Es la misma lección que con `[ACCION:...]`: una instrucción en el
 * prompt NO es determinista, así que si algo tiene que cumplirse siempre, se
 * cumple aquí y no allí.
 */

/** Quita el markdown que se cuela. Para PINTAR. */
export function limpiarTextoHarvey(texto: string): string {
  return String(texto || '')
    // Enlaces `[texto](url)` → el texto. Antes que nada, o el resto los parte.
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
    // Cabeceras de línea: `### Título` → `Título`.
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    // Viñetas al principio de línea. El bloque de respuesta ya pinta sus propios
    // puntos, así que un `- ` delante sale como un guion suelto.
    .replace(/^[ \t]*[-*•·][ \t]+/gm, '')
    // Citas.
    .replace(/^[ \t]*>[ \t]?/gm, '')
    // Negrita, cursiva y código. Los dobles ANTES que los simples, o `**x**`
    // se queda en `*x*`.
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[\s(¡¿"'])\*([^*\n]+)\*/g, '$1$2')
    .replace(/(^|[\s(¡¿"'])_([^_\n]+)_/g, '$1$2')
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/`([^`]+)`/g, '$1')
    // Lo que quede suelto: un asterisco solo no es énfasis, es basura.
    .replace(/\*+/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** Singular o plural, que «1 horas» canta más que el problema que arregla. */
const unidad = (n: string, una: string, varias: string) => `${n} ${n === '1' ? una : varias}`

/**
 * El texto listo para la VOZ.
 *
 * Javi: «cuando reprodujo en audio dos horas y diez minutos, dijo 2H10M».
 * Y es que se le mandaba a Fish Audio tal cual. La app escribe las duraciones
 * en corto —`2h 10m`, `2h10m`, `46m`, ese es el formato de `resumenEquipo.ts`—
 * porque en pantalla es lo que se lee de un vistazo; dicho en voz alta hay que
 * decirlo entero.
 *
 * Va en el SERVIDOR, en la ruta que habla, y no en cada botón: así vale para
 * cualquiera que la llame, hoy y mañana.
 */
export function textoParaVoz(texto: string): string {
  return limpiarTextoHarvey(texto)
    // Una URL leída en voz alta es medio minuto de ruido.
    .replace(/https?:\/\/\S+/g, '')
    // `2h 10m` y `2h10m` juntos: primero el par, o el suelto se come la hora.
    .replace(/\b(\d{1,3})\s*h\s*(\d{1,2})\s*m\b/gi, (_, h: string, m: string) =>
      `${unidad(h, 'hora', 'horas')} y ${unidad(m, 'minuto', 'minutos')}`)
    .replace(/\b(\d{1,3})\s*h\b/gi, (_, h: string) => unidad(h, 'hora', 'horas'))
    .replace(/\b(\d{1,3})\s*m\b/gi, (_, m: string) => unidad(m, 'minuto', 'minutos'))
    .replace(/\b(\d{1,3})\s*s\b/gi, (_, s: string) => unidad(s, 'segundo', 'segundos'))
    // Símbolos que se leen mal o no se leen.
    .replace(/(\d)\s*€/g, '$1 euros')
    .replace(/(\d)\s*%/g, '$1 por ciento')
    .replace(/\s*·\s*/g, ', ')
    .replace(/\s*&\s*/g, ' y ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}
