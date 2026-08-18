import { describe, it, expect } from 'vitest'
import { evaluateTrigger } from '@/lib/automations'

const ctxBase = { inbox: [] as any[], tasks: [], projects: [], clients: [] }
const regla = (accion: 'notify_owner' | 'notify_team') =>
  ({ v: 1, trigger: { type: 'unread_pileup', threshold: 15 }, action: { type: accion } }) as any

describe('inbox saturado · qué buzón cuenta', () => {
  it('«avisarme a mí» suma mi correo personal', () => {
    const r = evaluateTrigger(regla('notify_owner'), { ...ctxBase, sinLeerMios: 96 })
    expect(r.length, 'con 96 sin leer en el personal la regla no salta').toBe(1)
    expect(r[0].vars.total).toBe('96')
  })
  it('«notificar al equipo» NO mira el personal de nadie', () => {
    const r = evaluateTrigger(regla('notify_team'), { ...ctxBase, sinLeerMios: 96 })
    expect(r.length, 'empuja a los siete el correo privado de alguien').toBe(0)
  })
  it('el compartido sigue contando para las dos', () => {
    const compartidos = Array.from({ length: 20 }, (_, i) => ({ id: String(i), is_read: false }))
    expect(evaluateTrigger(regla('notify_team'), { ...ctxBase, inbox: compartidos }).length).toBe(1)
    expect(evaluateTrigger(regla('notify_owner'), { ...ctxBase, inbox: compartidos }).length).toBe(1)
  })
  it('por debajo del umbral no salta', () => {
    expect(evaluateTrigger(regla('notify_owner'), { ...ctxBase, sinLeerMios: 14 }).length).toBe(0)
  })
})
