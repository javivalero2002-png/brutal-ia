import { describe, it, expect } from 'vitest'
import { parsearAccionHarvey } from '@/lib/harveyAccion'

// ─────────────────────────────────────────────────────────────────────────────
// El comando [ACCION:...] de Harvey.
//
// Esta lógica estaba escrita DOS veces, línea por línea, dentro de HoySection y
// HarveySection — dos ficheros de mil líneas donde no se podía testear nada. La
// auditoría de agosto encontró tres bugs en esa pareja y cada uno hubo que
// arreglarlo dos veces.
//
// Lo que se comprueba aquí es lo que el modelo puede hacer mal, porque el que
// escribe esta cadena es Claude, no un formulario.
// ─────────────────────────────────────────────────────────────────────────────

describe('parsearAccionHarvey', () => {
  it('separa la frase hablada del comando', () => {
    const { texto, accion } = parsearAccionHarvey('Te la creo. [ACCION:tarea|Llamar a Nocilla|high|Pablo]')
    expect(texto).toBe('Te la creo.')
    expect(accion).toEqual({ type: 'tarea', text: 'Llamar a Nocilla', level: 'high', assigneeName: 'Pablo' })
  })

  it('sin comando devuelve la frase entera y ninguna acción', () => {
    const { texto, accion } = parsearAccionHarvey('  Hoy tienes tres reuniones.  ')
    expect(texto).toBe('Hoy tienes tres reuniones.')
    expect(accion).toBeNull()
  })

  // El TTS lee lo que quede en el texto. Una etiqueta sin limpiar se pronuncia:
  // «corchete ACCION dos puntos tarea». Por eso el texto se limpia SIEMPRE,
  // incluso cuando la acción no se entiende.
  it('limpia la etiqueta aunque el tipo sea desconocido', () => {
    const { texto, accion } = parsearAccionHarvey('Hecho. [ACCION:recordatorio|algo|x]')
    expect(texto).toBe('Hecho.')
    expect(texto).not.toContain('ACCION')
    expect(accion).toBeNull()
  })

  it('limpia varias etiquetas si el modelo se repite', () => {
    const { texto } = parsearAccionHarvey('Va. [ACCION:tarea|A|high|] y [ACCION:tarea|B|high|]')
    expect(texto).not.toContain('[ACCION')
  })

  // El prompt pide los niveles en inglés dentro de una conversación en español,
  // así que el modelo escribe «urgente» tarde o temprano. `tasks.level` tiene
  // CHECK: un valor de fuera hace que el INSERT rebote. Y la tarjeta «HARVEY
  // PROPONE» pinta su color comparando con 'urgent', así que además salía gris.
  it('normaliza el nivel que escribe el modelo en español', () => {
    expect(parsearAccionHarvey('[ACCION:tarea|X|urgente|]').accion?.level).toBe('urgent')
    expect(parsearAccionHarvey('[ACCION:tarea|X|alta|]').accion?.level).toBe('high')
    expect(parsearAccionHarvey('[ACCION:tarea|X|baja|]').accion?.level).toBe('normal')
  })

  it('sin nivel, o con uno irreconocible, cae en «high»', () => {
    expect(parsearAccionHarvey('[ACCION:tarea|X||]').accion?.level).toBe('high')
    expect(parsearAccionHarvey('[ACCION:tarea|X|P1|]').accion?.level).toBe('high')
    expect(parsearAccionHarvey('[ACCION:tarea|X]').accion?.level).toBe('high')
  })

  it('recorta los espacios que el modelo deja alrededor de las barras', () => {
    const { accion } = parsearAccionHarvey('[ACCION:tarea| Revisar contrato | urgente | Marta ]')
    expect(accion).toEqual({ type: 'tarea', text: 'Revisar contrato', level: 'urgent', assigneeName: 'Marta' })
  })

  it('lee los cinco tipos con sus campos', () => {
    expect(parsearAccionHarvey('[ACCION:evento|Reunión|2026-08-20|10:00|todos]').accion)
      .toEqual({ type: 'evento', text: 'Reunión', date: '2026-08-20', time: '10:00', invitees: 'todos' })
    expect(parsearAccionHarvey('[ACCION:proyecto|Web nueva|Nocilla|2026-09-01]').accion)
      .toEqual({ type: 'proyecto', text: 'Web nueva', clientName: 'Nocilla', date: '2026-09-01' })
    expect(parsearAccionHarvey('[ACCION:cliente|KOTO|Moda]').accion)
      .toEqual({ type: 'cliente', text: 'KOTO', industry: 'Moda' })
    expect(parsearAccionHarvey('[ACCION:pieza|Reel del festival|TikTok|Reel]').accion)
      .toEqual({ type: 'pieza', text: 'Reel del festival', platform: 'TikTok', contentType: 'Reel' })
  })

  it('rellena los valores por defecto que el resto de la app da por hechos', () => {
    expect(parsearAccionHarvey('[ACCION:cliente|KOTO]').accion?.industry).toBe('—')
    const pieza = parsearAccionHarvey('[ACCION:pieza|Algo]').accion
    expect(pieza?.platform).toBe('Instagram')
    expect(pieza?.contentType).toBe('Post')
  })

  it('aguanta lo que el modelo puede mandar roto sin lanzar', () => {
    for (const raro of ['[ACCION:]', '[ACCION:|||]', '[ACCION:tarea|]', 'texto [ACCION: tarea |X|high|]']) {
      expect(() => parsearAccionHarvey(raro)).not.toThrow()
      expect(parsearAccionHarvey(raro).texto).not.toContain('[ACCION')
    }
  })
})
