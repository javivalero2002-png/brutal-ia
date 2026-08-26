import { describe, it, expect } from 'vitest'
import { partesJornada } from '@/components/shared/RelojJornada'

// Javi lo pidio asi: «un contador de cuanto tiempo llevo trabajando: un minuto, dos
// minutos, tres minutos, que se vaya actualizando». Lo que habia era un intervalo de
// 30 SEGUNDOS con formato HH:MM — el primer cambio visible llegaba entre 60 y 90 s
// despues de fichar— y, peor, el «ahora» se sembraba al montar la seccion, asi que
// el numero grande arrancaba en «—» y no en 00:00.
describe('las partes de una jornada', () => {
  const seg = (n: number) => partesJornada(n * 1000)

  it('el primer segundo ya cuenta', () => {
    // Es el caso que mas se nota: el instante siguiente a pulsar MARCAR ENTRADA.
    expect(seg(1)).toEqual({ h: 0, m: 0, s: 1 })
  })

  it('los minutos y los segundos, por debajo de la hora', () => {
    expect(seg(59)).toEqual({ h: 0, m: 0, s: 59 })
    expect(seg(60)).toEqual({ h: 0, m: 1, s: 0 })
    expect(seg(252)).toEqual({ h: 0, m: 4, s: 12 })
    expect(seg(3599)).toEqual({ h: 0, m: 59, s: 59 })
  })

  it('a partir de la hora', () => {
    expect(seg(3600)).toEqual({ h: 1, m: 0, s: 0 })
    expect(seg(3 * 3600 + 7 * 60 + 41)).toEqual({ h: 3, m: 7, s: 41 })
    // Un turno que cruza la medianoche, o un dia que nadie cerro.
    expect(seg(17 * 3600 + 4 * 60 + 22)).toEqual({ h: 17, m: 4, s: 22 })
  })

  it('la jornada de 19 segundos de Javi sale como 00:19, no como cero', () => {
    // Su fila real de hoy: entrada 08:57:31, cierre 08:57:50.
    expect(seg(19)).toEqual({ h: 0, m: 0, s: 19 })
  })

  it('un negativo es un CERO, no una raya', () => {
    // El unico origen de un negativo es el desfase entre el reloj del portatil y el
    // `now()` del servidor. Antes eso devolvia null y la pantalla ponia «—» — la
    // cara de «esto esta roto» justo al fichar.
    expect(partesJornada(-5000)).toEqual({ h: 0, m: 0, s: 0 })
    expect(partesJornada(-1)).toEqual({ h: 0, m: 0, s: 0 })
  })

  it('no se redondea hacia arriba: 59,9 s siguen siendo 59', () => {
    expect(partesJornada(59_900)).toEqual({ h: 0, m: 0, s: 59 })
  })
})
