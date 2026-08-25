import { describe, it, expect } from 'vitest'
import { correosParaIA, prioridadCorreo } from '@/lib/correosParaIA'

// MEDIDO sobre el contexto real de Harvey: traia diez correos y eran DHGate,
// Polymarket, Creator Spotlight, LinkedIn, Temu, adidas, idealista… Con 704 sin
// leer, casi todos boletines, el tope se gastaba entero por ORDEN DE LLEGADA antes
// de llegar a nada que importara. Un correo de cliente de ayer no salia por ningun
// lado, y la IA contestaba «no tienes nada» con toda la razon desde su punto de vista.
describe('que correos ve la IA', () => {
  const esCliente = (m: { ai_client?: string | null }) => m.ai_client === 'ClipBoom'

  const boletin = (i: number) => ({
    is_read: false, ai_urgency: 'normal', received_at: `2026-08-25T1${i}:00:00Z`, from: `Temu ${i}`,
  })

  it('un cliente entra aunque haya cien boletines mas nuevos', () => {
    const correos = [
      ...Array.from({ length: 100 }, (_, i) => boletin(i)),
      { is_read: true, ai_urgency: 'normal', ai_client: 'ClipBoom', received_at: '2026-08-20T09:00:00Z', from: 'Ana de ClipBoom' },
    ]
    const elegidos = correosParaIA(correos, 10, esCliente as never)
    expect(elegidos.some(c => (c as { from: string }).from === 'Ana de ClipBoom'),
      'el correo del cliente se queda fuera otra vez').toBe(true)
  })

  it('el orden es: compañero, urgente, cliente, alta, sin leer', () => {
    const p = (m: Record<string, unknown>) => prioridadCorreo(m as never, esCliente as never)
    expect(p({ from_user_id: 'u1' })).toBeLessThan(p({ ai_urgency: 'urgent' }))
    expect(p({ ai_urgency: 'urgent' })).toBeLessThan(p({ ai_client: 'ClipBoom' }))
    expect(p({ ai_client: 'ClipBoom' })).toBeLessThan(p({ ai_urgency: 'high' }))
    expect(p({ ai_urgency: 'high' })).toBeLessThan(p({ is_read: false }))
    expect(p({ is_read: false })).toBeLessThan(p({ is_read: true }))
  })

  it('un mensaje de un compañero nunca se queda fuera', () => {
    // Es la unica clase de correo que nadie mas va a mandar: si se pierde, se pierde
    // del todo.
    const correos = [
      ...Array.from({ length: 50 }, (_, i) => ({ ...boletin(i), ai_urgency: 'urgent' })),
      { is_read: true, from_user_id: 'u1', received_at: '2026-01-01T00:00:00Z', from: 'Jorge' },
    ]
    expect(correosParaIA(correos, 5, esCliente as never)[0]).toMatchObject({ from: 'Jorge' })
  })

  it('dentro del mismo nivel, lo mas reciente primero', () => {
    const viejo = { is_read: false, received_at: '2026-08-01T09:00:00Z', from: 'viejo' }
    const nuevo = { is_read: false, received_at: '2026-08-25T09:00:00Z', from: 'nuevo' }
    expect(correosParaIA([viejo, nuevo], 2, esCliente as never)[0]).toMatchObject({ from: 'nuevo' })
  })

  it('respeta el tope y no rompe con lista vacia', () => {
    expect(correosParaIA([], 10, esCliente as never)).toEqual([])
    expect(correosParaIA(Array.from({ length: 30 }, (_, i) => boletin(i)), 7, esCliente as never)).toHaveLength(7)
  })
})
