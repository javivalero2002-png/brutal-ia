import { describe, it, expect } from 'vitest'
import { memoriaRelevante, lineasDeMemoria, type NotaMemoria } from '../memoriaRelevante'

// ─────────────────────────────────────────────────────────────────────────────
// El fallo que justifica este fichero: coger «las N más recientes» de Memoria.
// Como cada documento subido entra como una nota más, unos cuantos PDFs empujan
// fuera de la ventana justo lo que nunca caduca —cómo se trabaja aquí—, y el
// modelo empieza a contestar sin doctrina sin que nadie note el cambio.
// ─────────────────────────────────────────────────────────────────────────────

const doc = (title: string, content = ''): NotaMemoria => ({ title, category: 'Documento', content })
const curada = (title: string, content = ''): NotaMemoria => ({ title, category: 'Proceso', content })

describe('memoriaRelevante', () => {
  it('lo curado entra aunque haya cien documentos por delante', () => {
    // El orden imita el de la base: los documentos, recién subidos, van primero.
    const notas = [...Array.from({ length: 100 }, (_, i) => doc(`Presupuesto ${i}`)), curada('Cómo facturamos')]
    const sale = memoriaRelevante(notas, 'da igual la pregunta')
    expect(sale.some(m => m.title === 'Cómo facturamos'),
      'cien documentos han expulsado la doctrina del estudio: es exactamente el bug de «las 12 más recientes»').toBe(true)
  })

  it('de los documentos solo entran los que casan con la pregunta', () => {
    const notas = [doc('Presupuesto Mango', 'campaña de verano'), doc('Contrato Nike', 'vídeo'), curada('Tono de marca')]
    const sale = memoriaRelevante(notas, '¿qué acordamos con Mango?')
    expect(sale.map(m => m.title)).toContain('Presupuesto Mango')
    expect(sale.map(m => m.title)).not.toContain('Contrato Nike')
    expect(sale.map(m => m.title)).toContain('Tono de marca')
  })

  it('encuentra con tildes y sin ellas, en los dos sentidos', () => {
    const notas = [doc('Diseño de campaña', 'identidad')]
    expect(memoriaRelevante(notas, 'diseno').map(m => m.title)).toContain('Diseño de campaña')
    expect(memoriaRelevante([doc('Diseno sin tilde')], 'diseño').map(m => m.title)).toContain('Diseno sin tilde')
  })

  it('las palabras cortas no seleccionan: casan con todo y equivalen a no filtrar', () => {
    const notas = [doc('Presupuesto Mango'), doc('Contrato Nike')]
    // «con» y «que» aparecerían en cualquier texto; si contaran, entrarían los dos.
    expect(memoriaRelevante(notas, 'que con por').length).toBe(2)  // sin claves → los recientes
    expect(memoriaRelevante(notas, 'Mango').map(m => m.title)).toEqual(['Presupuesto Mango'])
  })

  it('sin pregunta cae a unos pocos documentos, pero nunca a costa de lo curado', () => {
    const notas = [...Array.from({ length: 20 }, (_, i) => doc(`Doc ${i}`)), ...Array.from({ length: 12 }, (_, i) => curada(`Proceso ${i}`))]
    const sale = memoriaRelevante(notas)
    expect(sale.filter(m => m.category === 'Documento').length).toBe(4)
    expect(sale.filter(m => m.category !== 'Documento').length).toBe(10)
  })

  it('el que más veces casa va primero', () => {
    const notas = [doc('Nota suelta', 'mango'), doc('Informe Mango', 'mango campaña verano mango')]
    expect(memoriaRelevante(notas, 'mango campaña verano')[0].title).toBe('Informe Mango')
  })

  it('aguanta lo vacío y lo nulo sin romperse', () => {
    expect(memoriaRelevante(null, 'algo')).toEqual([])
    expect(memoriaRelevante(undefined)).toEqual([])
    expect(memoriaRelevante([{ }], 'algo')).toHaveLength(1)   // sin category cuenta como curada
  })
})

  it('la nota curada que ENCAJA sube, aunque se guardara la ultima', () => {
    // El fallo: `curadas.slice(0, 10)` cogia las diez primeras POR ORDEN DE LLEGADA.
    // Con once decisiones curadas, la undecima era invisible para las dos IAs para
    // siempre — preguntases lo que preguntases, y por mucho que fuera exactamente
    // sobre ella. Es el mismo fallo que el `.limit(120)` de /api/chat, un piso mas
    // arriba: recortar por antiguedad lo que hay que recortar por relevancia.
    const relleno = Array.from({ length: 10 }, (_, i) => ({
      title: `Nota de relleno ${i}`, category: 'General', content: 'texto cualquiera sin nada que ver',
    }))
    const laBuena = { title: 'Tarifas de postproduccion', category: 'Decisiones', content: 'La hora de postproduccion se factura a 45 euros.' }
    const elegidas = memoriaRelevante([...relleno, laBuena], '¿cuanto cobramos la postproduccion?')
    expect(elegidas.map(m => m.title)).toContain('Tarifas de postproduccion')
    // Y sube arriba, no se cuela por los pelos: lo primero que lee el modelo.
    expect(elegidas[0].title).toBe('Tarifas de postproduccion')
  })

  it('sin coincidencias, el orden y el resultado son los de siempre', () => {
    // La reordenacion no puede cambiar lo que salia antes cuando nada casa: todas
    // puntuan 0 y el desempate por indice conserva el orden de llegada.
    const notas = Array.from({ length: 12 }, (_, i) => ({
      title: `Nota ${i}`, category: 'General', content: 'contenido neutro',
    }))
    const conPregunta = memoriaRelevante(notas, 'algo que no aparece en ninguna parte')
    const sinPregunta = memoriaRelevante(notas)
    expect(conPregunta.map(m => m.title)).toEqual(notas.slice(0, 10).map(m => m.title))
    expect(sinPregunta.map(m => m.title)).toEqual(notas.slice(0, 10).map(m => m.title))
  })

  it('una nota curada que no casa NO se descarta, solo baja', () => {
    // La diferencia deliberada con los documentos: a un documento que no casa se le
    // DESCARTA; a lo curado, no. Lo escribio alguien a mano y vale como base aunque
    // la pregunta no lo mencione.
    const curadas = [
      { title: 'Como facturamos', category: 'Procesos', content: 'facturacion a 30 dias' },
      { title: 'Nada que ver', category: 'General', content: 'xxx' },
    ]
    const r = memoriaRelevante(curadas, 'facturamos')
    expect(r).toHaveLength(2)
    expect(r[0].title).toBe('Como facturamos')
  })

describe('lineasDeMemoria', () => {
  it('aplana los saltos de línea y corta, para no colar un texto entero', () => {
    const salida = lineasDeMemoria([{ title: 'T', category: 'Documento', content: 'a\n\n   b' }], 10)
    expect(salida).toBe('  - T [Documento]: a b')
  })

  it('corta al límite pedido', () => {
    const salida = lineasDeMemoria([{ title: 'T', content: 'x'.repeat(999) }], 20)
    expect(salida.endsWith('x'.repeat(20))).toBe(true)
  })
})
