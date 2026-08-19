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
