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

  it('no confunde «ano» dentro de otra palabra', () => {
    // «engaño», «año» suelto… la guarda es de palabra completa.
    expect(parseImporte('12k plan engañoso').anual).toBe(false)
  })
})
