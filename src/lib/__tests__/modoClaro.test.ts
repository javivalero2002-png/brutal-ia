import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// El modo claro no es un tema aparte: es un `filter: invert(1) hue-rotate(180deg)`
// sobre el body. Eso funciona para grises y blancos, pero hunde los colores de
// marca, que están elegidos para fondo oscuro y al invertirse salen claros sobre
// blanco. Medido en el navegador: rojo 2,17 · azul 2,70 · verde 3,10 (AA pide 4,5).
//
// No se arregla ajustando el filtro. Se probaron contrast/brightness/saturate en
// todo su rango útil y el mejor caso dejaba el peor color en 2,46: oscurecer el
// color oscurece también el fondo, así que la razón entre ambos apenas se mueve.
//
// La solución es contra-invertir esos elementos y declararles la variante oscura.
// Lo delicado NO es elegir el color, es acertar con la FORMA del selector: fallé
// dos veces seguidas ahí. De eso va este test.
const CSS = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')

// Dos bloques con reglas OPUESTAS sobre el parentesis de cierre. Conviene no
// mezclarlos: la primera version de este test miraba el fichero entero y saltó
// en cuanto se añadió el segundo bloque, que es justo lo que debia pasar.
const BLOQUE = CSS.slice(CSS.indexOf('Colores de marca en modo claro'),
                         CSS.indexOf('Texto secundario tenue en modo claro'))
const BLOQUE_GRIS = CSS.slice(CSS.indexOf('Texto secundario tenue en modo claro'))

function coloresDelBloque(): Array<[number, number, number]> {
  const vistos = new Map<string, [number, number, number]>()
  for (const m of BLOQUE.matchAll(/\[style\^="color: rgb\((\d+), (\d+), (\d+)\)"\]/g)) {
    vistos.set(m[1] + m[2] + m[3], [+m[1], +m[2], +m[3]])
  }
  return [...vistos.values()]
}

describe('modo claro: contraste de los colores de marca', () => {
  it('el bloque de correccion existe', () => {
    expect(BLOQUE).toContain('invert(1) hue-rotate(180deg)')
    expect(coloresDelBloque().length).toBeGreaterThanOrEqual(12)
  })

  // Cada color llega al DOM de cuatro formas distintas y basta olvidar una para
  // dejar textos sin arreglar. Con solo `rgb(...)` se quedaban fuera 53 de 138.
  // La regla que de verdad importa, y la que fallo en produccion.
  //
  // `[style*="color: rgb(...)"]` parece inofensivo y no lo es: casa como SUBCADENA
  // dentro de caret-color, border-color, background-color, outline-color y
  // text-decoration-color, porque todas terminan en «color». El buscador de Tareas
  // lleva caretColor: BLU, asi que recibia el contrafiltro entero y salia una CAJA
  // NEGRA en pleno modo claro. Y como `filter` afecta al subarbol, cualquier
  // contenedor que casara arrastraba su texto: titulos blancos sobre fondo claro,
  // invisibles.
  it('ningun selector casa color como subcadena de otra propiedad', () => {
    const sinAnclar: string[] = []
    for (const bloque of [BLOQUE, BLOQUE_GRIS]) {
      for (const m of bloque.matchAll(/\[style([\^*])="([^"]*)"\]/g)) {
        const [, operador, valor] = m
        const anclado = (operador === '^' && valor.startsWith('color:')) ||
                        (operador === '*' && valor.startsWith('; color:'))
        if (!anclado) sinAnclar.push(`[style${operador}="${valor}"]`)
      }
    }
    expect(sinAnclar).toEqual([])
  })

  // Segunda red: aunque algo casara, no puede arrastrar a sus hijos.
  it('el contrafiltro solo se aplica a elementos sin hijos', () => {
    for (const m of BLOQUE.matchAll(/html\.theme-light (\[style[^\]]*\])(:not\(:has\(\*\)\))?/g)) {
      expect(m[2], `selector sin :not(:has(*)): ${m[1]}`).toBeTruthy()
    }
  })

  it('cada color cubre las formas en que llega al DOM', () => {
    const faltan: string[] = []
    for (const [r, g, b] of coloresDelBloque()) {
      const hex = '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase()
      for (const f of [
        `[style^="color: rgb(${r}, ${g}, ${b})"]`,
        `[style*="; color: rgb(${r}, ${g}, ${b})"]`,
        `[style^="color: rgba(${r}, ${g}, ${b}"]`,
        `[style*="; color: rgba(${r}, ${g}, ${b}"]`,
        `[style^="color:${hex}"]`,
        `[style*="; color:${hex}"]`,
      ]) if (!BLOQUE.includes(f)) faltan.push(f)
    }
    expect(faltan).toEqual([])
  })

  // En los grises el alfa ES el valor a distinguir: sin el parentesis de cierre,
  // `0.3` casaria tambien `0.35`, ganaria por orden de aparicion y los cinco
  // niveles de jerarquia se colapsarian en uno. Es la regla CONTRARIA a la de los
  // colores de marca, que van sin cierre para casar cualquier alfa, y conviven a
  // veinte lineas de distancia.
  it('los grises SI llevan parentesis de cierre, al reves que los de marca', () => {
    const reglas = [...BLOQUE_GRIS.matchAll(/\[style[\^*]="(?:; )?color: rgba\(([^"]*)"\]/g)]
    expect(reglas.length).toBeGreaterThanOrEqual(5)
    for (const m of reglas) expect(m[1]).toContain(')')
  })

  // Subir el suelo no debe aplanar la jerarquia: cada nivel tiene que seguir
  // siendo mas claro que el anterior, o "apagado" y "casi principal" acaban
  // pintandose igual.
  it('los grises conservan el orden entre niveles', () => {
    const pares = [...BLOQUE_GRIS.matchAll(/rgba\(255, 255, 255, ([\d.]+)\)"\][^{]*\{[^}]*rgba\(255, 255, 255, ([\d.]+)\)/g)]
      .map(m => [parseFloat(m[1]), parseFloat(m[2])])
    expect(pares.length).toBeGreaterThanOrEqual(5)
    for (const [antes, despues] of pares) expect(despues).toBeGreaterThan(antes)
    const salidas = pares.map(p => p[1])
    expect([...salidas].sort((a, b) => a - b)).toEqual(salidas)   // estrictamente creciente
    expect(Math.min(...salidas)).toBeGreaterThanOrEqual(0.54)     // el minimo que da AA
  })

  // La comprobacion que de verdad importa: que el color declarado cumpla AA
  // contra el fondo de tarjeta mas oscuro que existe en la app (medido: no es
  // blanco puro, hay tarjetas teñidas que llegan a 235,249,249).
  it('cada variante oscura cumple AA sobre la tarjeta mas oscura', () => {
    const FONDO_MAS_OSCURO: [number, number, number] = [235, 249, 249]
    const lum = ([r, g, b]: number[]) => {
      const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const flojos: string[] = []
    for (const m of BLOQUE.matchAll(/color: (#[0-9A-Fa-f]{6}) !important/g)) {
      const c = [1, 3, 5].map(i => parseInt(m[1].slice(i, i + 2), 16))
      const [x, y] = [lum(c), lum(FONDO_MAS_OSCURO)].sort((a, b) => b - a)
      const ratio = (x + 0.05) / (y + 0.05)
      if (ratio < 4.5) flojos.push(`${m[1]} -> ${ratio.toFixed(2)}`)
    }
    expect(flojos).toEqual([])
  })
})
