import { describe, it, expect } from 'vitest'
import { CADENCIA, MARGEN, seHaPasado } from '@/lib/cadencia'

describe('cuándo se da algo por caído', () => {
  it('un retraso pequeño NO es una avería', () => {
    // Un cron horario que llega diez minutos tarde es un cron, no un incendio.
    // Avisar ahí es lo que enseña a ignorar los avisos.
    expect(seHaPasado('sync-colabs', 70)).toBe(false)
    expect(seHaPasado('sync-colabs', 119)).toBe(false)
  })

  it('pasado el doble, sí', () => {
    expect(seHaPasado('sync-colabs', 121)).toBe(true)
    expect(CADENCIA['sync-colabs'] * MARGEN).toBe(120)
  })

  it('el fin de semana no dispara los recordatorios', () => {
    // Corren de lunes a viernes, así que el lunes llevan ~72 h sin latir. Con la
    // cadencia de 4 días eso no es avería: es que era sábado.
    expect(seHaPasado('recordatorio-fichar', 72 * 60)).toBe(false)
  })

  it('una tarea que no ha corrido NUNCA no es una avería', () => {
    // En una instancia recién montada, ningún cron ha latido todavía. Avisar ahí
    // le daría al cliente una alarma el día que estrena la app.
    expect(seHaPasado('sync-colabs', null)).toBe(false)
  })

  it('una tarea desconocida no dispara nada', () => {
    expect(seHaPasado('lo-que-sea', 99999)).toBe(false)
  })
})
