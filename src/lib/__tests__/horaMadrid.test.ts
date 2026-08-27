import { describe, it, expect } from 'vitest'
import { instanteEnMadrid } from '@/lib/horaMadrid'

// La suite corre con TZ=UTC a propósito (ver CLAUDE.md): en un portátil español
// estos fallos se esconden, que es justo lo que hace falta comprobar aquí.
describe('instanteEnMadrid', () => {
  it('en verano Madrid va dos horas por delante de UTC', () => {
    // 26 de agosto, 18:30 en Madrid = 16:30Z.
    expect(instanteEnMadrid('2026-08-26', '18:30')).toBe('2026-08-26T16:30:00.000Z')
  })

  it('en invierno va una', () => {
    // 15 de enero, 18:30 en Madrid = 17:30Z. Un `new Date(dia+"T"+hora)` en el
    // servidor —que en Vercel va en UTC— daría 18:30Z: una hora de más, y esa
    // hora se convierte en tiempo trabajado en el panel del jefe.
    expect(instanteEnMadrid('2026-01-15', '18:30')).toBe('2026-01-15T17:30:00.000Z')
  })

  it('la madrugada no se va al día anterior', () => {
    // 00:30 de Madrid en verano es las 22:30Z del día ANTERIOR. Si se guardara
    // como 00:30Z, el cierre caería en un día distinto del que se está cerrando.
    expect(instanteEnMadrid('2026-08-26', '00:30')).toBe('2026-08-25T22:30:00.000Z')
  })

  it('la hora que NO existe se rechaza en vez de inventarse', () => {
    // La noche del cambio a horario de verano de 2026: a las 02:00 el reloj salta
    // a las 03:00, así que las 02:30 no existieron. Estampar una hora inventada en
    // el cierre de una jornada es peor que decir que no.
    expect(instanteEnMadrid('2026-03-29', '02:30')).toBeNull()
  })

  it('una hora con formato raro no cuela', () => {
    expect(instanteEnMadrid('2026-08-26', '25:00')).toBeNull()
    expect(instanteEnMadrid('no-es-un-dia', '18:30')).toBeNull()
  })
})
