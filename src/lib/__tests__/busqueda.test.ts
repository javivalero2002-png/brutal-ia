import { describe, it, expect } from 'vitest'
import { buscaEnTexto } from '@/components/shared/helpers'

// Los dos casos que se dan de verdad escribiendo en español, y que el
// `includes()` de antes no cubría.
describe('buscaEnTexto · encuentra lo que la gente escribe', () => {
  const nota = 'Presupuesto de Nike — diseño de campaña · 12.000 €'

  it('sin tildes encuentra con tildes, y al revés', () => {
    expect(buscaEnTexto(nota, 'diseno')).toBe(true)
    expect(buscaEnTexto('Presupuesto de campana', 'campaña')).toBe(true)
  })

  it('dos palabras sueltas, en cualquier orden', () => {
    expect(buscaEnTexto(nota, 'presupuesto nike')).toBe(true)
    expect(buscaEnTexto(nota, 'nike presupuesto')).toBe(true)
  })

  it('exige TODAS: una que no está descarta la nota', () => {
    expect(buscaEnTexto(nota, 'presupuesto adidas')).toBe(false)
  })

  it('sin búsqueda, todo casa', () => {
    expect(buscaEnTexto(nota, '')).toBe(true)
    expect(buscaEnTexto(nota, '   ')).toBe(true)
  })

  it('la frase literal sigue funcionando', () => {
    expect(buscaEnTexto(nota, 'de campaña')).toBe(true)
  })
})
