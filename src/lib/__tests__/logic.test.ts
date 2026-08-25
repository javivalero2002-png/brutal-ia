import { describe, it, expect } from 'vitest'
import { parseRuleConfig, AUTO_MARK } from '@/lib/automations'
import { dlDate, todayKey, localDayKey, estadoDeadline, diarioTieneAlgo } from '@/components/shared/helpers'
import { splitForTTS } from '@/components/shared/audio'
import { needsWebSearch } from '@/lib/ai'

// ─────────────────────────────────────────────────────────────────────────────
// Tests de la lógica pura del sistema. Cubren las partes donde una regresión
// silenciosa haría daño real: fechas (bug de zona horaria), el motor de
// automatizaciones y el troceado de voz de Harvey.
// ─────────────────────────────────────────────────────────────────────────────

describe('fechas — zona horaria España', () => {
  it('todayKey devuelve formato YYYY-MM-DD', () => {
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('localDayKey usa el día de Madrid, no el de UTC', () => {
    // 23:30 del 9 de agosto en Madrid (UTC+2) = 21:30 UTC del día 9.
    // A las 00:30 del día 10 en Madrid son las 22:30 UTC del 9: el día local
    // debe ser el 10, no el 9. Este es exactamente el bug que se corrigió.
    expect(localDayKey('2026-08-09T22:30:00Z')).toBe('2026-08-10')
    expect(localDayKey('2026-08-09T12:00:00Z')).toBe('2026-08-09')
  })

  it('localDayKey es estable para una fecha a mediodía', () => {
    expect(localDayKey('2026-01-15T12:00:00Z')).toBe('2026-01-15')
  })
})

describe('dlDate — parseo de deadlines', () => {
  it('trata TBD y vacío como futuro lejano', () => {
    expect(dlDate('TBD').getTime()).toBe(8640000000000000)
    expect(dlDate(null).getTime()).toBe(8640000000000000)
    expect(dlDate('').getTime()).toBe(8640000000000000)
  })

  it('parsea ISO al final del día', () => {
    const d = dlDate('2026-03-15')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(2)
    expect(d.getDate()).toBe(15)
    expect(d.getHours()).toBe(23)
  })

  it('parsea el formato español "mar 2026"', () => {
    const d = dlDate('mar 2026')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(2)
  })

  it('un deadline pasado es anterior a ahora', () => {
    expect(dlDate('2020-01-01').getTime()).toBeLessThan(Date.now())
  })
})

describe('motor de automatizaciones — parseRuleConfig', () => {
  it('acepta una regla estructurada válida', () => {
    const cfg = parseRuleConfig(JSON.stringify({
      v: 1,
      trigger: { type: 'email_urgent' },
      action: { type: 'create_task', taskText: 'Revisar' },
    }))
    expect(cfg).not.toBeNull()
    expect(cfg!.trigger.type).toBe('email_urgent')
    expect(cfg!.action.type).toBe('create_task')
  })

  it('rechaza reglas legacy en texto libre (no deben ejecutarse)', () => {
    expect(parseRuleConfig('Cuando llegue un email urgente, avísame')).toBeNull()
    expect(parseRuleConfig(null)).toBeNull()
    expect(parseRuleConfig('')).toBeNull()
  })

  it('rechaza JSON malformado o incompleto sin lanzar', () => {
    expect(parseRuleConfig('{roto')).toBeNull()
    expect(parseRuleConfig('{"v":1}')).toBeNull()
    expect(parseRuleConfig('{"v":1,"trigger":{"type":"x"}}')).toBeNull()
  })

  it('la marca de dedup es estable (evita tareas duplicadas)', () => {
    expect(AUTO_MARK).toBe('⚙ auto:')
  })
})

describe('splitForTTS — troceado de la voz de Harvey', () => {
  it('devuelve vacío si no hay texto', () => {
    expect(splitForTTS('')).toEqual([])
    expect(splitForTTS('   ')).toEqual([])
  })

  it('no pierde contenido al trocear', () => {
    const text = 'Primera frase. Segunda frase. Tercera frase.'
    const joined = splitForTTS(text).join(' ').replace(/\s+/g, ' ')
    expect(joined).toContain('Primera frase')
    expect(joined).toContain('Tercera frase')
  })

  it('un texto corto se queda en un solo trozo', () => {
    expect(splitForTTS('Hola.').length).toBe(1)
  })
})

describe('needsWebSearch — cuándo Harvey busca en internet', () => {
  it('detecta consultas que piden datos actuales', () => {
    expect(needsWebSearch('busca influencers de moda')).toBe(true)
    expect(needsWebSearch('¿cuánto cuesta una campaña?')).toBe(true)
    expect(needsWebSearch('tendencias de TikTok')).toBe(true)
  })

  it('detecta preguntas de conocimiento externo (antes fallaban)', () => {
    expect(needsWebSearch('¿quién es el CEO de Nike?')).toBe(true)
    expect(needsWebSearch('qué es el SEO técnico')).toBe(true)
    expect(needsWebSearch('¿cuánto cobra un community manager?')).toBe(true)
  })

  it('NO busca cuando la pregunta es sobre datos internos', () => {
    expect(needsWebSearch('¿qué tareas tengo hoy?')).toBe(false)
    expect(needsWebSearch('crea una tarea para Pablo')).toBe(false)
    expect(needsWebSearch('resume mis emails sin leer')).toBe(false)
    expect(needsWebSearch('¿cómo va el proyecto de Zara?')).toBe(false)
    expect(needsWebSearch('dame el briefing')).toBe(false)
  })
})

describe('deadline: los dias no dependen de la hora a la que mires', () => {

  const enDias = (n: number) => {
    const d = new Date(`${todayKey()}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
  }

  // El bug: dlDate() devolvia el deadline a las 23:59:59, asi que a las 09:00 del
  // dia en que vencia la resta daba 0,62 -> Math.round -> 1 -> "+1d" para algo que
  // vencia HOY. La rama de 'HOY' solo se alcanzaba a partir de las ~12:00.
  it('lo que vence hoy dice HOY, sea la hora que sea', () => {
    expect(estadoDeadline(enDias(0))!.etiqueta).toBe('HOY')
    expect(estadoDeadline(enDias(0))!.dias).toBe(0)
    expect(estadoDeadline(enDias(0))!.vencido).toBe(false)
  })

  it('manana es +1d y pasado +2d', () => {
    expect(estadoDeadline(enDias(1))!.etiqueta).toBe('+1d')
    expect(estadoDeadline(enDias(2))!.etiqueta).toBe('+2d')
  })

  // Con Math.abs, lo vencido AYER daba Math.round(0,37) = 0 y salia "−0d".
  it('lo vencido ayer no dice −0d', () => {
    const ayer = estadoDeadline(enDias(-1))!
    expect(ayer.etiqueta).toBe('−1d')
    expect(ayer.etiquetaLarga).toBe('hace 1d')
    expect(ayer.vencido).toBe(true)
  })

  it('«pronto» es de hoy a siete dias, y no incluye lo vencido', () => {
    expect(estadoDeadline(enDias(0))!.pronto).toBe(true)
    expect(estadoDeadline(enDias(7))!.pronto).toBe(true)
    expect(estadoDeadline(enDias(8))!.pronto).toBe(false)
    expect(estadoDeadline(enDias(-1))!.pronto).toBe(false)
  })

  it('sin deadline o TBD devuelve null en vez de inventarse un dia', () => {
    expect(estadoDeadline(null)).toBeNull()
    expect(estadoDeadline(undefined)).toBeNull()
    expect(estadoDeadline('')).toBeNull()
    expect(estadoDeadline('TBD')).toBeNull()
  })

  it('acepta un deadline con hora, quedandose con el dia', () => {
    expect(estadoDeadline(`${enDias(3)}T17:30:00Z`)!.etiqueta).toBe('+3d')
  })

  // Deadlines en texto libre heredados de cuando el campo era un input suelto.
  // slice(0,10) no los sabe leer y `dias` salia NaN: como `NaN < 0` y `NaN === 0`
  // son los dos false, no se marcaba ni vencido ni de hoy, y la etiqueta se
  // pintaba literalmente "+NaNd" en la ficha de la tarea y en el tablero.
  it('un deadline en texto libre devuelve null, no "+NaNd"', () => {
    for (const libre of ['ago 2026', 'finales de mes', 'cuando cierre', 'ASAP']) {
      expect(estadoDeadline(libre)).toBeNull()
    }
  })

  it('ningun deadline produce NaN en dias ni en la etiqueta', () => {
    for (const d of [enDias(0), enDias(-3), enDias(30), 'ago 2026', 'TBD', '', null]) {
      const e = estadoDeadline(d)
      if (e === null) continue
      expect(Number.isFinite(e.dias)).toBe(true)
      expect(e.etiqueta).not.toContain('NaN')
      expect(e.etiquetaLarga).not.toContain('NaN')
    }
  })
})

// El filtro de "CORREOS RECIENTES" de la ficha del cliente. Se replica aqui la
// misma logica porque vive dentro de un IIFE en el JSX y no es importable; lo que
// se fija es el CRITERIO, que es donde estaba el fallo.
//
// Antes era `nombreCliente.includes(ai) || ai.includes(primeraPalabra)` sin minimo
// de longitud. "La Nave" da primeraPalabra "la", y "coca-cola".includes("la") es
// cierto: los correos de Coca-Cola salian en la ficha de La Nave.
describe('clientes: los correos de un cliente no son los de otro', () => {
  const normaliza = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const casan = (cliente: string, aiClient: string) => {
    const name = normaliza(cliente)
    const ai = normaliza(aiClient)
    if (ai === name) return true
    const palabras = name.split(/[^a-z0-9]+/).filter(p => p.length >= 4)
    const palabrasAi = ai.split(/[^a-z0-9]+/).filter(p => p.length >= 4)
    return palabras.some(p => palabrasAi.includes(p))
  }

  it('no mete correos de otro cliente por un articulo', () => {
    expect(casan('La Nave', 'Coca-Cola')).toBe(false)
    expect(casan('El Corte', 'Telefónica')).toBe(false)
    expect(casan('El Corte', 'Adobe')).toBe(false)
    expect(casan('La Nave', 'Dell')).toBe(false)
  })

  it('sigue casando lo que tiene que casar', () => {
    expect(casan('La Nave', 'La Nave')).toBe(true)
    expect(casan('La Nave', 'Nave Producciones')).toBe(true)
    expect(casan('Coca-Cola', 'Coca-Cola España')).toBe(true)
    expect(casan('Nike', 'Nike')).toBe(true)          // exacto, aunque tenga 4 letras justas
  })

  it('los acentos no impiden la coincidencia', () => {
    expect(casan('Telefónica', 'Telefonica')).toBe(true)
    expect(casan('Iberdrola España', 'IBERDROLA')).toBe(true)
  })

  it('una marca con apellido sigue siendo la misma marca', () => {
    expect(casan('BBVA', 'BBVA')).toBe(true)
    // "BBVA Asset Management" ES BBVA: la palabra completa esta ahi. Escribi la
    // expectativa contraria y el test me corrigio a mi, no al reves.
    expect(casan('BBVA', 'BBVA Asset Management')).toBe(true)
  })

  // El limite del criterio, escrito para que se vea: un cliente cuyo nombre entero
  // sean palabras de menos de 4 letras solo casa de forma exacta. Es el precio de
  // no mezclar clientes, y a esta escala (una veintena) se prefiere fallar por
  // defecto antes que enseñar correos ajenos.
  it('un nombre de palabras muy cortas solo casa exacto', () => {
    expect(casan('Zip Co', 'Zip Co')).toBe(true)
    expect(casan('Zip Co', 'Zip Co Australia')).toBe(false)
  })
})

describe('una fila de diario vacia no es un dia de trabajo', () => {
  // En la base hay CUATRO filas asi: `entrada: ''` y todo lo demas a null. Las crea
  // abrir Fichar y borrar lo que escribiste — el autoguardado manda el texto vacio.
  //
  // No era un detalle de limpieza: esa fila se contaba como dia. El briefing decia
  // «1 dia» de alguien que no estuvo, el resumen del equipo escribia una linea por
  // cada una, y las dos IAs lo leian y lo repetian en voz alta. Textual de
  // Brutal.IA con los datos reales: «ha habido actividad los dias 21, 22, 24 y 25».
  // No la hubo.
  it('la fila que no es nada, no cuenta', () => {
    expect(diarioTieneAlgo({ entrada: '', cierre: null, entrada_at: null, cierre_at: null, animo: null })).toBe(false)
    expect(diarioTieneAlgo({ entrada: '   ', cierre: null, entrada_at: null, cierre_at: null, animo: null })).toBe(false)
    expect(diarioTieneAlgo(null)).toBe(false)
    expect(diarioTieneAlgo(undefined)).toBe(false)
    expect(diarioTieneAlgo({})).toBe(false)
  })

  it('cualquier señal real cuenta', () => {
    expect(diarioTieneAlgo({ entrada: 'montar el teaser' }), 'escribio objetivos').toBe(true)
    expect(diarioTieneAlgo({ cierre: 'lo hice' }), 'cerro el dia').toBe(true)
    expect(diarioTieneAlgo({ entrada_at: '2026-08-25T08:00:00Z' }), 'ficho').toBe(true)
    expect(diarioTieneAlgo({ cierre_at: '2026-08-25T18:00:00Z' }), 'cerro').toBe(true)
    // El caso real del 22 de agosto: dijo como fue el dia sin escribir nada mas.
    expect(diarioTieneAlgo({ entrada: '', animo: 'productivo' }), 'marco el animo').toBe(true)
    expect(diarioTieneAlgo({ entrada: '', animo: 'bloqueado' }), 'se marco bloqueado').toBe(true)
  })
})
