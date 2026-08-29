import { describe, it, expect } from 'vitest'
import { parseImporte } from '@/components/shared/helpers'

// La facturación es texto libre y la gente la escribe como le sale. Lo que había
// devolvía números MIL VECES más pequeños sin avisar de nada, y tiraba el periodo:
// un contrato anual se sumaba al MRR como si fuera mensual.
describe('parseImporte · la facturación es texto libre', () => {
  const casos: [string, number][] = [
    ['12k', 12_000],
    ['12K', 12_000],
    ['€12k', 12_000],
    ['12.000', 12_000],
    ['12000', 12_000],
    ['1,5k', 1_500],
    ['1.2M', 1_200_000],
    ['€ 48.000 /mes', 48_000],
    ['—', 0],
    ['', 0],
    ['sin contrato', 0],
  ]
  for (const [texto, esperado] of casos) {
    it(`«${texto}» → ${esperado}`, () => {
      expect(parseImporte(texto).mensual).toBeCloseTo(esperado, 2)
    })
  }

  it('lo anual se convierte a mensual, que es lo que significa MRR', () => {
    expect(parseImporte('120k/año').mensual).toBeCloseTo(10_000, 2)
    expect(parseImporte('120k/año').anual).toBe(true)
    expect(parseImporte('120000 anual').mensual).toBeCloseTo(10_000, 2)
  })

  it('lo mensual no se toca', () => {
    expect(parseImporte('10k/mes').mensual).toBe(10_000)
    expect(parseImporte('10k/mes').anual).toBe(false)
  })

  it('el sufijo no roba la primera letra de la palabra siguiente', () => {
    // «12 mil» era 12.000.000 y «1500 mensuales» eran 1.500 MILLONES en el MRR:
    // la clase del número se tragaba el espacio y la «m» de la palabra siguiente
    // pasaba por sufijo. Escrito tal cual invitan los placeholders de la app.
    expect(parseImporte('12 mil').mensual).toBe(12_000)
    expect(parseImporte('1500 mensuales').mensual).toBe(1_500)
    expect(parseImporte('3000 mes').mensual).toBe(3_000)
    expect(parseImporte('2 millones').mensual).toBe(2_000_000)
    expect(parseImporte('10 mil al año').mensual).toBeCloseTo(833.33, 1)
  })

  it('no confunde «ano» dentro de otra palabra', () => {
    // «engaño», «año» suelto… la guarda es de palabra completa.
    expect(parseImporte('12k plan engañoso').anual).toBe(false)
  })
})
