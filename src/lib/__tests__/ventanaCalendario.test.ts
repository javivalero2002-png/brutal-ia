import { describe, it, expect } from 'vitest'
import { ventanaCalendario, mesCargado, horaMadrid, cuandoEnMadrid } from '@/lib/ventanaCalendario'

describe('la ventana del calendario', () => {
  const HOY = new Date('2026-08-25T10:00:00Z')

  it('llega hasta bastante mas alla de tres meses', () => {
    // El caso medido: un evento del 30 de diciembre se creo en Google con 200 y la
    // app no lo enseñaba NUNCA, porque solo se traian tres meses. Y Harvey puede
    // crear a esa distancia con una frase.
    const { desde, hasta } = ventanaCalendario(HOY)
    expect(mesCargado(2026, 11, HOY), 'diciembre sigue fuera').toBe(true)
    expect(desde.toISOString().slice(0, 7)).toBe('2026-06')
    expect(hasta.toISOString().slice(0, 7)).toBe('2027-09')
  })

  it('tambien mira hacia atras', () => {
    // La seccion deja navegar al mes anterior con la flecha. Se traia desde el dia
    // 1 del mes ACTUAL, asi que el mes pasado salia vacio: el calendario decia
    // «no tuviste nada» de algo que ni habia pedido.
    expect(mesCargado(2026, 6, HOY), 'julio').toBe(true)
    expect(mesCargado(2026, 5, HOY), 'junio').toBe(true)
  })

  it('lo que queda fuera lo dice, no lo pinta vacio', () => {
    expect(mesCargado(2026, 0, HOY), 'enero de 2026 esta fuera').toBe(false)
    expect(mesCargado(2028, 0, HOY), '2028 esta fuera').toBe(false)
  })
})

describe('la hora de un evento es la de Madrid', () => {
  it('no depende del desfase con que Google lo devuelva', () => {
    // MEDIDO SOBRE LOS EVENTOS REALES. Google devuelve cada evento en el desfase
    // del calendario donde vive: el personal de Javi va en +01:00 y el compartido
    // en +02:00. Los dos instantes de abajo son EL MISMO, y cortando el texto ISO
    // salian dos horas distintas.
    const enUno = '2026-08-04T10:30:00+01:00'
    const enOtro = '2026-08-04T11:30:00+02:00'
    expect(new Date(enUno).getTime()).toBe(new Date(enOtro).getTime())
    expect(horaMadrid(enUno)).toBe('11:30')
    expect(horaMadrid(enOtro)).toBe('11:30')
    // Y lo que hacia el codigo viejo, para que se vea la diferencia:
    expect(enUno.slice(11, 16)).toBe('10:30')
  })

  it('un evento de dia completo no se inventa una hora', () => {
    expect(horaMadrid('2026-08-04')).toBe('')
    expect(cuandoEnMadrid('2026-08-04')).toBe('2026-08-04')
  })

  it('una fecha ilegible no rompe ni miente', () => {
    expect(horaMadrid('no es una fecha')).toBe('')
    expect(horaMadrid('')).toBe('')
  })

  it('el cambio de hora se respeta', () => {
    // El ultimo domingo de octubre Madrid pasa de +02:00 a +01:00. El MISMO
    // instante UTC se dice distinto a los dos lados, y ese es justo el caso que un
    // desfase escrito a mano se come.
    expect(horaMadrid('2026-10-24T09:00:00Z'), 'sabado, todavia verano').toBe('11:00')
    expect(horaMadrid('2026-10-27T09:00:00Z'), 'martes, ya invierno').toBe('10:00')
  })
})
