import { describe, it, expect } from 'vitest'
import { filtrarBusqueda, POR_TIPO, TOTAL } from '@/lib/busquedaGlobal'

// La lupa de ⌘K era el UNICO buscador de la app que no usaba `buscaEnTexto`. Las
// seis secciones ya iban con el; la mas a mano se quedo con
// `title.toLowerCase().includes(q)`. Gemelo de libro, y del peor tipo: el arreglo
// estaba hecho y escrito, y el sitio mas visible no lo tenia.
describe('la lupa global', () => {
  const CATALOGO = [
    { type: 'Cliente', title: 'Nocilla', sub: 'Alimentación' },
    { type: 'Proyecto', title: 'Diseño de campaña', sub: 'Nocilla' },
    { type: 'Memoria', title: 'Tarifas 2026', sub: 'Decisiones', extra: 'El reel suelto empieza en 400 euros' },
    { type: 'Equipo', title: 'Jorge', sub: 'Miembro' },
  ]

  it('encuentra sin tildes, que es como se escribe deprisa', () => {
    expect(filtrarBusqueda(CATALOGO, 'diseno').map(r => r.title)).toContain('Diseño de campaña')
  })

  it('dos palabras sueltas, en cualquier orden', () => {
    expect(filtrarBusqueda(CATALOGO, 'campana diseno')).toHaveLength(1)
  })

  it('busca DENTRO de una nota, no solo en su titulo', () => {
    // Buscar por titulo deja fuera justo lo que se busca cuando no te acuerdas de
    // como se llamaba la nota.
    expect(filtrarBusqueda(CATALOGO, 'euros').map(r => r.title)).toEqual(['Tarifas 2026'])
  })

  it('menos de dos letras no busca nada', () => {
    expect(filtrarBusqueda(CATALOGO, 'a')).toEqual([])
    expect(filtrarBusqueda(CATALOGO, ' ')).toEqual([])
  })

  it('un tipo con muchos resultados no se come la lista', () => {
    // EL CASO REAL. Se concatenaba en orden fijo y se cortaba a 9, con el equipo el
    // ULTIMO. Con 871 correos cargados, buscar «jorge» llenaba el hueco de inbox y
    // la persona Jorge no aparecia nunca.
    const muchos = [
      ...Array.from({ length: 50 }, (_, i) => ({ type: 'Inbox', title: `Correo sobre Jorge ${i}` })),
      { type: 'Equipo', title: 'Jorge', sub: 'Miembro' },
    ]
    const r = filtrarBusqueda(muchos, 'jorge')
    expect(r.filter(x => x.type === 'Inbox').length, 'el inbox vuelve a acaparar').toBeLessThanOrEqual(POR_TIPO)
    expect(r.some(x => x.type === 'Equipo'), 'la persona que buscas no sale').toBe(true)
    expect(r.length).toBeLessThanOrEqual(TOTAL)
  })

  it('sin resultados devuelve vacio, no todo', () => {
    expect(filtrarBusqueda(CATALOGO, 'zzzz')).toEqual([])
  })
})
