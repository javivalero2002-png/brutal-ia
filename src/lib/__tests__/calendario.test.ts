import { describe, it, expect } from 'vitest'
import { tramoHorario, tramoDiaCompleto } from '../gmail'

// Los tests corren con TZ=UTC a propósito (ver package.json), que es justo la zona
// de Vercel: si el cálculo vuelve a depender de la zona del servidor, aquí no se
// notaría... salvo porque lo que se comprueba es la CADENA que se le manda a
// Google, no un instante. Esa cadena no debe llevar 'Z' nunca.
describe('calendario: el tramo que se le manda a Google', () => {
  it('manda la hora sin zona y la zona aparte', () => {
    const { start, end } = tramoHorario('2026-08-20', '10:00', 60)
    expect(start).toEqual({ dateTime: '2026-08-20T10:00:00', timeZone: 'Europe/Madrid' })
    expect(end).toEqual({ dateTime: '2026-08-20T11:00:00', timeZone: 'Europe/Madrid' })
  })

  // El bug que motivó todo esto: con `toISOString()` el dateTime salía como
  // "2026-08-20T10:00:00.000Z". Google respeta ese offset explícito e IGNORA
  // timeZone, así que las 10:00 se guardaban como 12:00 de Madrid en verano.
  it('nunca lleva la Z, que es lo que hacia que Google ignorase la zona', () => {
    for (const t of ['00:00', '09:30', '13:45', '23:59']) {
      const { start, end } = tramoHorario('2026-08-20', t, 60)
      expect(start.dateTime).not.toContain('Z')
      expect(end.dateTime).not.toContain('Z')
      expect(start.dateTime).not.toContain('+')
    }
  })

  // Y este es el que demuestra que ya no se acumula. Antes, editar el título de un
  // evento de las 10:00 lo dejaba a las 12:00; volver a editarlo, a las 14:00.
  it('reeditar la misma hora no la mueve', () => {
    let hora = '10:00'
    for (let i = 0; i < 3; i++) {
      const { start } = tramoHorario('2026-08-20', hora, 60)
      hora = start.dateTime.slice(11, 16)   // lo que la UI releería del evento
    }
    expect(hora).toBe('10:00')
  })

  it('conserva la duracion original en vez de forzar una hora', () => {
    expect(tramoHorario('2026-08-20', '10:00', 30).end.dateTime).toBe('2026-08-20T10:30:00')
    expect(tramoHorario('2026-08-20', '10:00', 90).end.dateTime).toBe('2026-08-20T11:30:00')
    expect(tramoHorario('2026-08-20', '10:00', 15).end.dateTime).toBe('2026-08-20T10:15:00')
  })

  it('un evento que cruza la medianoche termina al dia siguiente', () => {
    const { start, end } = tramoHorario('2026-08-20', '23:30', 60)
    expect(start.dateTime).toBe('2026-08-20T23:30:00')
    expect(end.dateTime).toBe('2026-08-21T00:30:00')
  })

  it('cruza tambien el fin de mes y el fin de año', () => {
    expect(tramoHorario('2026-08-31', '23:30', 60).end.dateTime).toBe('2026-09-01T00:30:00')
    expect(tramoHorario('2026-12-31', '23:30', 60).end.dateTime).toBe('2027-01-01T00:30:00')
  })

  it('un evento larguisimo salta varios dias sin descuadrarse', () => {
    // 50 horas desde las 10:00 del 20 -> las 12:00 del 22.
    expect(tramoHorario('2026-08-20', '10:00', 50 * 60).end.dateTime).toBe('2026-08-22T12:00:00')
  })

  it('el dia completo termina en el dia siguiente, tambien en cambio de mes', () => {
    expect(tramoDiaCompleto('2026-08-20')).toEqual({ start: { date: '2026-08-20' }, end: { date: '2026-08-21' } })
    expect(tramoDiaCompleto('2026-08-31').end.date).toBe('2026-09-01')
    expect(tramoDiaCompleto('2026-12-31').end.date).toBe('2027-01-01')
    // Año bisiesto: 2028 lo es.
    expect(tramoDiaCompleto('2028-02-28').end.date).toBe('2028-02-29')
  })

  // El cambio de hora de Madrid es justo donde un cálculo con Date se rompe. Aquí
  // no debe pasar nada raro porque no se convierte a instante: se manda la hora de
  // pared y Google la resuelve con la zona.
  it('el cambio de hora no altera la hora de pared', () => {
    // Último domingo de marzo de 2026: el 29. A las 02:00 se salta a las 03:00.
    expect(tramoHorario('2026-03-29', '10:00', 60).start.dateTime).toBe('2026-03-29T10:00:00')
    // Último domingo de octubre de 2026: el 25.
    expect(tramoHorario('2026-10-25', '10:00', 60).start.dateTime).toBe('2026-10-25T10:00:00')
  })
})
