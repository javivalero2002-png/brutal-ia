import { describe, it, expect } from 'vitest'
import { sanearHistorial, type TurnoIA } from '../historialIA'

const u = (content: string): TurnoIA => ({ role: 'user', content })
const a = (content: string): TurnoIA => ({ role: 'assistant', content })

describe('historial para la API: el primer mensaje tiene que ser user', () => {
  // El caso exacto que fallaba a diario en Harvey: la conversación arranca con su
  // saludo, y el cliente mandaba eso como primer mensaje. Anthropic devolvía 400,
  // la respuesta caía al fallback local y se leía en voz alta como si fuera suya.
  it('descarta el saludo de Harvey del principio', () => {
    expect(sanearHistorial([a('Buenos días, Javier.')])).toEqual([])
    expect(sanearHistorial([a('Buenos días.'), u('¿qué tengo hoy?')]))
      .toEqual([u('¿qué tengo hoy?')])
  })

  it('descarta TODOS los del asistente que haya al principio, no solo el primero', () => {
    expect(sanearHistorial([a('uno'), a('dos'), a('tres'), u('pregunta')]))
      .toEqual([u('pregunta')])
  })

  it('no toca un historial que ya empieza bien', () => {
    const bueno = [u('hola'), a('dime'), u('¿y mañana?')]
    expect(sanearHistorial(bueno)).toEqual(bueno)
  })

  it('conserva los mensajes del asistente que van EN MEDIO', () => {
    const conv = [u('hola'), a('dime'), u('gracias'), a('a ti')]
    expect(sanearHistorial(conv)).toEqual(conv)
  })

  // Un mensaje vacío también hace fallar la llamada, y aparecía cuando Harvey se
  // quedaba en blanco y ese turno se guardaba igual.
  it('quita los mensajes vacios o solo con espacios', () => {
    expect(sanearHistorial([u(''), u('   '), u('real')])).toEqual([u('real')])
    expect(sanearHistorial([u('  \n '), a('x'), u('real')])).toEqual([u('real')])
  })

  it('el vaciado se aplica ANTES de buscar el primer user', () => {
    // Si se mirara primero el rol, este `user` vacío haría creer que el historial
    // ya empieza bien y se colaría un mensaje vacío a la API.
    expect(sanearHistorial([u('   '), a('saludo'), u('pregunta')]))
      .toEqual([u('pregunta')])
  })

  it('aguanta lo que llegue sin reventar', () => {
    expect(sanearHistorial([])).toEqual([])
    expect(sanearHistorial([a('solo yo')])).toEqual([])
    // Entradas mal formadas: vienen de un JSON del cliente, no de un tipo.
    expect(sanearHistorial([{ role: 'user', content: null as any }, u('vale')])).toEqual([u('vale')])
  })

  // La garantía que de verdad importa, sobre cualquier entrada.
  it('el resultado o esta vacio o empieza por user, siempre', () => {
    const roles: Array<'user' | 'assistant'> = ['user', 'assistant']
    for (let n = 0; n < 64; n++) {
      const turnos: TurnoIA[] = []
      for (let bit = 0; bit < 6; bit++) turnos.push({ role: roles[(n >> bit) & 1], content: `m${bit}` })
      const out = sanearHistorial(turnos)
      if (out.length) expect(out[0].role).toBe('user')
      // y no se inventa nada
      expect(out.length).toBeLessThanOrEqual(turnos.length)
    }
  })
})
