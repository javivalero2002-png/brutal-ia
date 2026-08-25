import { daysBetweenKeys } from '@/components/shared/helpers'
import { readFileSync } from 'node:fs'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { evaluateTrigger, isSelfFeedingRule, AUTO_MARK, type RuleConfig } from '@/lib/automations'

// ─────────────────────────────────────────────────────────────────────────────
// evaluateTrigger es pura: (config, snapshot) → Match[]. Sin Supabase, sin red.
// Es el motor de un cron que se ejecuta 24 veces al día creando tareas y
// mandando push a todo el equipo sin humano delante, así que sus regresiones
// llegan directas a producción.
//
// Los tests fijan el reloj en instantes UTC concretos y comprueban el
// comportamiento en Europe/Madrid (UTC+2 en agosto, UTC+1 en enero).
// ─────────────────────────────────────────────────────────────────────────────

const task = (o: Record<string, unknown> = {}) => ({
  id: 't1', text: 'tarea', done: false, due_date: null, level: 'normal',
  assigned_to: null, notes: null, project_id: null, client_id: null, ...o,
})
const mail = (o: Record<string, unknown> = {}) => ({
  id: 'm1', subject: 'asunto', from_name: 'Alguien', from_email: 'a@b.com',
  ai_client: null, ai_urgency: 'normal', is_read: false,
  received_at: new Date().toISOString(), ...o,
})
const project = (o: Record<string, unknown> = {}) => ({
  id: 'p1', name: 'Proyecto', status: 'activo', deadline: null, client_id: null, ...o,
})
const client = (o: Record<string, unknown> = {}) => ({ id: 'c1', name: 'KOTO', ...o })

const ctx = (o: Partial<{ inbox: any[]; tasks: any[]; projects: any[]; clients: any[] }> = {}) =>
  ({ inbox: [], tasks: [], projects: [], clients: [], ...o })

const rule = (trigger: any, action: any = { type: 'notify_team' }): RuleConfig =>
  ({ v: 1, trigger, action })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('task_overdue — regresión del bug de zona horaria', () => {
  // El bug: '2026-08-09' pasaba por Date.parse → 00:00 UTC → 02:00 en Madrid.
  // A partir de esa hora, una tarea que vencía HOY se marcaba como vencida,
  // mientras la UI decía que no lo estaba. Con el cron horario, eso generaba
  // alertas falsas todos los días desde las 02:00 hasta medianoche.
  const HOY = '2026-08-09'
  const instantes: [string, string][] = [
    ['2026-08-08T22:30:00Z', 'Madrid 00:30'],
    ['2026-08-08T23:59:59Z', 'Madrid 01:59'],
    ['2026-08-09T00:00:01Z', 'Madrid 02:00 — aquí fallaba antes'],
    ['2026-08-09T07:00:00Z', 'Madrid 09:00'],
    ['2026-08-09T21:30:00Z', 'Madrid 23:30'],
  ]

  it.each(instantes)('a las %s (%s) una tarea que vence hoy NO está vencida', (iso) => {
    vi.setSystemTime(new Date(iso))
    const out = evaluateTrigger(rule({ type: 'task_overdue' }), ctx({ tasks: [task({ due_date: HOY })] }))
    expect(out).toHaveLength(0)
  })

  it.each(instantes)('a las %s (%s) una tarea de ayer SÍ está vencida', (iso) => {
    vi.setSystemTime(new Date(iso))
    const out = evaluateTrigger(rule({ type: 'task_overdue' }), ctx({ tasks: [task({ due_date: '2026-08-08' })] }))
    expect(out).toHaveLength(1)
    expect(out[0].key).toBe('taskdue:t1')
  })

  it('en invierno (UTC+1) sigue sin marcar como vencida la de hoy', () => {
    vi.setSystemTime(new Date('2026-01-15T23:30:00Z')) // Madrid 00:30 del 16
    const out = evaluateTrigger(rule({ type: 'task_overdue' }), ctx({ tasks: [task({ due_date: '2026-01-16' })] }))
    expect(out).toHaveLength(0)
  })

  it('respeta el periodo de gracia en días', () => {
    vi.setSystemTime(new Date('2026-08-09T10:00:00Z'))
    const conGracia = rule({ type: 'task_overdue', days: 2 })
    // vencida hace 1 día → dentro de la gracia de 2
    expect(evaluateTrigger(conGracia, ctx({ tasks: [task({ due_date: '2026-08-08' })] }))).toHaveLength(0)
    // vencida hace 3 días → fuera de la gracia
    expect(evaluateTrigger(conGracia, ctx({ tasks: [task({ due_date: '2026-08-06' })] }))).toHaveLength(1)
  })

  it('ignora tareas hechas o sin fecha', () => {
    vi.setSystemTime(new Date('2026-08-09T10:00:00Z'))
    const tasks = [task({ id: 'a', due_date: '2026-01-01', done: true }), task({ id: 'b', due_date: null })]
    expect(evaluateTrigger(rule({ type: 'task_overdue' }), ctx({ tasks }))).toHaveLength(0)
  })
})

describe('many_overdue — misma semántica de día', () => {
  it('no cuenta las que vencen hoy', () => {
    vi.setSystemTime(new Date('2026-08-09T07:00:00Z'))
    const tasks = [
      task({ id: 'a', due_date: '2026-08-09' }),
      task({ id: 'b', due_date: '2026-08-09' }),
      task({ id: 'c', due_date: '2026-08-07' }),
    ]
    expect(evaluateTrigger(rule({ type: 'many_overdue', threshold: 2 }), ctx({ tasks }))).toHaveLength(0)
  })

  it('usa el día de Madrid en la clave, no el de UTC', () => {
    // Madrid 23:30 del 9 = 21:30Z del 9. La clave UTC habría dado el mismo día
    // aquí, pero a las 22:30Z (00:30 Madrid del 10) saltaba antes de tiempo.
    vi.setSystemTime(new Date('2026-08-09T22:30:00Z')) // Madrid: 00:30 del 10
    const tasks = [task({ id: 'a', due_date: '2026-08-01' }), task({ id: 'b', due_date: '2026-08-02' })]
    const out = evaluateTrigger(rule({ type: 'many_overdue', threshold: 2 }), ctx({ tasks }))
    expect(out[0].key).toBe('many_overdue:2026-08-10')
  })
})

describe('project_deadline', () => {
  it('incluye un proyecto que vence hoy', () => {
    vi.setSystemTime(new Date('2026-08-09T20:00:00Z')) // Madrid 22:00
    const out = evaluateTrigger(
      rule({ type: 'project_deadline', days: 7 }),
      ctx({ projects: [project({ deadline: '2026-08-09' })] }),
    )
    expect(out).toHaveLength(1)
    expect(out[0].vars.dias).toBe('0')
    expect(out[0].key).toBe('proj:p1:2026-08-09')
  })

  it('excluye los ya vencidos y los que caen fuera de la ventana', () => {
    vi.setSystemTime(new Date('2026-08-09T10:00:00Z'))
    const projects = [project({ id: 'viejo', deadline: '2026-08-01' }), project({ id: 'lejos', deadline: '2026-12-01' })]
    expect(evaluateTrigger(rule({ type: 'project_deadline', days: 7 }), ctx({ projects }))).toHaveLength(0)
  })

  it('ignora proyectos completados', () => {
    vi.setSystemTime(new Date('2026-08-09T10:00:00Z'))
    const projects = [project({ deadline: '2026-08-10', status: 'completado' })]
    expect(evaluateTrigger(rule({ type: 'project_deadline' }), ctx({ projects }))).toHaveLength(0)
  })

  it('interpreta "mes año" con día 28, igual que la UI', () => {
    vi.setSystemTime(new Date('2026-08-09T10:00:00Z'))
    const out = evaluateTrigger(
      rule({ type: 'project_deadline', days: 30 }),
      ctx({ projects: [project({ deadline: 'ago 2026' })] }),
    )
    expect(out[0].key).toBe('proj:p1:2026-08-28')
  })
})

describe('high_priority_unassigned — el bucle que se autoalimentaba', () => {
  it('detecta una tarea humana sin asignar', () => {
    vi.setSystemTime(new Date('2026-08-09T10:00:00Z'))
    const out = evaluateTrigger(rule({ type: 'high_priority_unassigned' }), ctx({ tasks: [task({ level: 'urgent' })] }))
    expect(out).toHaveLength(1)
  })

  it('IGNORA las tareas creadas por el propio motor', () => {
    vi.setSystemTime(new Date('2026-08-09T10:00:00Z'))
    const generada = task({ id: 'gen', level: 'urgent', notes: `${AUTO_MARK}regla1:unassigned:t1` })
    expect(evaluateTrigger(rule({ type: 'high_priority_unassigned' }), ctx({ tasks: [generada] }))).toHaveLength(0)
  })

  it('no se realimenta: 50 tareas generadas siguen dando 0 coincidencias', () => {
    vi.setSystemTime(new Date('2026-08-09T10:00:00Z'))
    const generadas = Array.from({ length: 50 }, (_, i) =>
      task({ id: `g${i}`, level: 'high', notes: `${AUTO_MARK}r1:unassigned:t${i}` }))
    expect(evaluateTrigger(rule({ type: 'high_priority_unassigned' }), ctx({ tasks: generadas }))).toHaveLength(0)
  })

  it('ignora las ya asignadas y las de prioridad normal', () => {
    vi.setSystemTime(new Date('2026-08-09T10:00:00Z'))
    const tasks = [task({ id: 'a', level: 'urgent', assigned_to: 'u1' }), task({ id: 'b', level: 'normal' })]
    expect(evaluateTrigger(rule({ type: 'high_priority_unassigned' }), ctx({ tasks }))).toHaveLength(0)
  })
})

describe('client_followup — el goteo infinito', () => {
  const cli = client({ id: 'c1', name: 'KOTO' })

  it('NO dispara cuando el cliente no tiene ningún email (antes lo hacía cada día)', () => {
    vi.setSystemTime(new Date('2026-08-09T10:00:00Z'))
    const out = evaluateTrigger(
      rule({ type: 'client_followup', clientId: 'c1', clientName: 'KOTO', days: 14 }),
      ctx({ clients: [cli], inbox: [] }),
    )
    expect(out).toHaveLength(0)
  })

  it('dispara cuando hay emails pero son antiguos', () => {
    vi.setSystemTime(new Date('2026-08-09T10:00:00Z'))
    const viejo = mail({ ai_client: 'KOTO', received_at: '2026-06-01T10:00:00Z' })
    const out = evaluateTrigger(
      rule({ type: 'client_followup', clientId: 'c1', clientName: 'KOTO', days: 14 }),
      ctx({ clients: [cli], inbox: [viejo] }),
    )
    expect(out).toHaveLength(1)
    expect(Number(out[0].vars.dias)).toBeGreaterThan(14)
  })

  it('no dispara si hay contacto reciente', () => {
    vi.setSystemTime(new Date('2026-08-09T10:00:00Z'))
    const reciente = mail({ ai_client: 'KOTO', received_at: '2026-08-08T10:00:00Z' })
    const out = evaluateTrigger(
      rule({ type: 'client_followup', clientId: 'c1', clientName: 'KOTO', days: 14 }),
      ctx({ clients: [cli], inbox: [reciente] }),
    )
    expect(out).toHaveLength(0)
  })
})

describe('isSelfFeedingRule', () => {
  it('rechaza la combinación que se autoalimenta', () => {
    expect(isSelfFeedingRule(rule(
      { type: 'high_priority_unassigned' },
      { type: 'create_task', level: 'urgent' },
    ))).toBe(true)
  })

  it('acepta la misma regla si asigna responsable', () => {
    expect(isSelfFeedingRule(rule(
      { type: 'high_priority_unassigned' },
      { type: 'create_task', level: 'urgent', assignTo: 'u1' },
    ))).toBe(false)
  })

  it('acepta la misma regla si solo notifica', () => {
    expect(isSelfFeedingRule(rule(
      { type: 'high_priority_unassigned' },
      { type: 'notify_team' },
    ))).toBe(false)
  })

  it('acepta create_task de prioridad normal (no cumple el predicado del trigger)', () => {
    expect(isSelfFeedingRule(rule(
      { type: 'high_priority_unassigned' },
      { type: 'create_task', level: 'normal' },
    ))).toBe(false)
  })
})

describe('límites y ventanas', () => {
  // El tope de 8 ya NO vive aquí, y el cambio es la corrección de un bug: cortando
  // en el evaluador, las coincidencias ya atendidas seguían ocupando plaza. Con 12
  // tareas vencidas se creaban 8 la primera vez y CERO en todas las siguientes —
  // las mismas 8 llenaban el cupo y el dedup las descartaba una a una. Cuatro
  // tareas sin seguimiento para siempre, y la app diciendo «sin acciones
  // pendientes». Ahora el evaluador devuelve todo y el tope cuenta acciones
  // REALIZADAS, dentro del bucle de runAutomations.
  it('el evaluador devuelve TODAS las coincidencias, sin cortar', () => {
    vi.setSystemTime(new Date('2026-08-09T10:00:00Z'))
    const tasks = Array.from({ length: 30 }, (_, i) => task({ id: `t${i}`, level: 'urgent' }))
    expect(evaluateTrigger(rule({ type: 'high_priority_unassigned' }), ctx({ tasks }))).toHaveLength(30)
  })

  // Pero el tope sigue existiendo, y sigue siendo 8: el motor no puede ponerse a
  // crear treinta tareas de una tacada. Se comprueba donde ahora está.
  it('el tope sigue puesto, contando acciones hechas y no coincidencias miradas', () => {
    const src = readFileSync('src/lib/automations.ts', 'utf8')
    expect(/hechasEnEstaRegla >= MAX_MATCHES_PER_RULE/.test(src),
      'el tope por regla ha desaparecido: una regla podría crear tareas sin límite').toBe(true)
    expect(/return out\.slice\(0, MAX_MATCHES_PER_RULE\)/.test(src),
      'el tope vuelve a cortar en el evaluador, antes del dedup').toBe(false)
  })

  it('email_urgent solo mira los últimos 3 días', () => {
    vi.setSystemTime(new Date('2026-08-09T10:00:00Z'))
    const inbox = [
      mail({ id: 'nuevo', ai_urgency: 'urgent', received_at: '2026-08-09T08:00:00Z' }),
      mail({ id: 'viejo', ai_urgency: 'urgent', received_at: '2026-07-01T08:00:00Z' }),
    ]
    const out = evaluateTrigger(rule({ type: 'email_urgent' }), ctx({ inbox }))
    expect(out.map(m => m.key)).toEqual(['email:nuevo'])
  })

  it('unread_pileup usa el día de Madrid en la clave', () => {
    vi.setSystemTime(new Date('2026-08-09T22:30:00Z')) // Madrid: 00:30 del 10
    const inbox = Array.from({ length: 12 }, (_, i) => mail({ id: `m${i}`, is_read: false }))
    const out = evaluateTrigger(rule({ type: 'unread_pileup', threshold: 10 }), ctx({ inbox }))
    expect(out[0].key).toBe('pileup:2026-08-10')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('daysBetweenKeys · días naturales, no bloques de 24h', () => {
  it('el mismo día son 0', () => {
    expect(daysBetweenKeys('2026-08-11', '2026-08-11')).toBe(0)
  })

  it('ayer es 1 aunque hayan pasado menos de 24 horas', () => {
    // El caso que rompía la UI: un email de ayer a las 22:00 leído a las 09:00 de
    // hoy son 11 horas — la resta de timestamps daba 0 y ponía "HOY".
    expect(daysBetweenKeys('2026-08-10', '2026-08-11')).toBe(1)
  })

  it('el cambio de hora no descuadra la cuenta', () => {
    // Último domingo de octubre: la noche dura 25 horas en Madrid. Contando
    // bloques de 24h, ese día daría 0 en vez de 1.
    expect(daysBetweenKeys('2026-10-24', '2026-10-25')).toBe(1)
    expect(daysBetweenKeys('2026-10-25', '2026-10-26')).toBe(1)
    // Y el de marzo, que dura 23.
    expect(daysBetweenKeys('2026-03-28', '2026-03-29')).toBe(1)
  })

  it('cuenta a través de meses y años', () => {
    expect(daysBetweenKeys('2026-08-31', '2026-09-01')).toBe(1)
    expect(daysBetweenKeys('2025-12-31', '2026-01-01')).toBe(1)
    expect(daysBetweenKeys('2026-01-01', '2026-12-31')).toBe(364)
  })

  it('es negativo si la fecha de destino es anterior', () => {
    expect(daysBetweenKeys('2026-08-11', '2026-08-04')).toBe(-7)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Lo que encontró la auditoría del motor (46 agentes, 2026-08-17).
//
// El modo de fallo dominante era el SILENCIO: nada duplicaba datos ni mandaba
// spam, pero varias reglas no saltaban nunca y la sección decía «Todo en orden».
// En algo que corre cada hora sin nadie delante, eso es lo peor que puede pasar.
// ─────────────────────────────────────────────────────────────────────────────
describe('motor · lo que el snapshot tiene que traer', () => {
  const MOTOR = readFileSync('src/lib/automations.ts', 'utf8')

  // «Urgentes sin asignar» evaluaba `tk.level` y `tk.assigned_to`, y el snapshot
  // no los traía: llegaban `undefined`, la condición cortaba siempre, y la regla
  // no produjo una sola tarea desde que existe. Un snapshot que no trae lo que el
  // evaluador mira no da error — da cero coincidencias para siempre.
  it('el snapshot de tareas trae lo que los disparadores evalúan', () => {
    const m = MOTOR.match(/from\('tasks'\)\.select\('([^']+)'\)/)
    expect(m, 'ya no se lee el snapshot de tareas así: revisa esta regla').toBeTruthy()
    const cols = (m![1]).split(',').map(c => c.trim())
    for (const necesaria of ['level', 'assigned_to', 'done', 'due_date']) {
      expect(cols, `el snapshot no trae «${necesaria}», que el evaluador sí mira`).toContain(necesaria)
    }
  })

  // Un aviso que no llega a nadie se contaba como enviado: mismo resultado que uno
  // correcto, más el UPDATE que bloquea el reintento 6 h. Justo el caso en que hace
  // falta reintentar era el que se marcaba como hecho.
  it('un aviso solo cuenta si de verdad se envió', () => {
    const i = MOTOR.indexOf('sendPushToAll(admin, payload)')
    expect(i, 'ya no se envía así: revisa esta regla').toBeGreaterThan(-1)
    const bloque = MOTOR.slice(i - 400, i + 900)
    expect(/enviado = true/.test(bloque), 'no se distingue un envío hecho de uno fallido').toBe(true)
    expect(/if \(!enviado\) break/.test(bloque),
      'un envío fallido sigue marcando la regla como disparada y se auto-bloquea 6 h').toBe(true)
  })

  // `followup` es un estado sostenido, no un hecho puntual: con la fecha en la
  // clave, treinta días de silencio eran treinta tareas idénticas.
  it('la clave de un estado sostenido no lleva el día', () => {
    expect(/key: `followup:\$\{cli\.id\}:\$\{todayKey\(\)\}`/.test(MOTOR),
      'la clave de followup vuelve a llevar el día: una tarea idéntica cada 24 h, indefinidamente').toBe(false)
  })
})

// El modal ofrecía las mismas cuatro variables para los ocho disparadores, y no
// eran ciertas de ninguno: `{remitente}` existe en 2 de 8 y `{proyecto}` en 1 de 8.
// Con «Inbox saturado» no servía NINGUNA, y la única que sí —`{total}`— no estaba
// escrita en ningún sitio. La tarea se creaba literalmente como «Revisar  de».
describe('las variables que ofrece el modal son las que rellena el motor', () => {
  const MOTOR = readFileSync('src/lib/automations.ts', 'utf8')
  const MODAL = readFileSync('src/components/CreateModal.tsx', 'utf8')

  it('la ayuda depende del disparador elegido', () => {
    expect(/VARS_POR_DISPARADOR/.test(MODAL), 'la ayuda vuelve a ser una lista fija').toBe(true)
    expect(/\{'\{cliente\} \{asunto\} \{remitente\} \{proyecto\}'\}/.test(MODAL),
      'vuelve la lista fija de cuatro variables que no son ciertas de ningún disparador').toBe(false)
  })

  // Lo que de verdad importa: que el mapa del modal no prometa nada que el motor
  // no ponga. Se compara contra el código del motor, no contra una copia.
  // Trocea el motor POR DISPARADOR y compara cada lista con la suya.
  //
  // La primera version solo miraba si la variable existia en algun sitio del
  // motor, y con eso ofrecer {remitente} en «Inbox saturado» pasaba en verde:
  // {remitente} existe... en otro disparador. Comprobado reintroduciendo ese
  // cambio exacto. Una regla que no distingue el sitio no comprueba nada aqui,
  // porque el bug ERA ofrecer la variable del disparador equivocado.
  it('cada disparador ofrece solo las variables que él rellena', () => {
    const mapa = MODAL.slice(MODAL.indexOf('VARS_POR_DISPARADOR'), MODAL.indexOf('const varsDe'))
    const ofrecido: Record<string, string[]> = {}
    for (const m of mapa.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
      ofrecido[m[1]] = [...m[2].matchAll(/'(\w+)'/g)].map(x => x[1])
    }
    expect(Object.keys(ofrecido).length, 'el mapa del modal quedó vacío').toBeGreaterThan(6)

    // Acotado a evaluateTrigger. Los mismos `t.type === '...'` aparecen ANTES,
    // en la función que compone la etiqueta legible, y esa no rellena variables:
    // buscando en todo el fichero se cogía siempre esa primera copia y la regla
    // fallaba con el código correcto.
    const EVAL = MOTOR.slice(MOTOR.indexOf('export function evaluateTrigger'))
    expect(EVAL, 'no se encontró evaluateTrigger').not.toBe('')
    const cortes = [...EVAL.matchAll(/t\.type === '(\w+)'/g)]
    const tramo = (tipo: string) => {
      const k = cortes.findIndex(c => c[1] === tipo)
      if (k === -1) return ''
      const desde = cortes[k].index as number
      const hasta = k + 1 < cortes.length ? (cortes[k + 1].index as number) : EVAL.length
      return EVAL.slice(desde, hasta)
    }

    for (const [disparador, vars] of Object.entries(ofrecido)) {
      const cuerpo = tramo(disparador)
      expect(cuerpo, `el motor no tiene rama para «${disparador}»`).not.toBe('')
      for (const v of vars) {
        expect(new RegExp(`\\b${v}\\s*:`).test(cuerpo),
          `el modal ofrece {${v}} en «${disparador}», y esa rama del motor no lo rellena`).toBe(true)
      }
    }
  })
})

describe('automatizaciones de control · miran PERSONAS, no cosas', () => {
  // Javi: «el jefe puede ponerse un aviso de que alguien lleva dos días sin fichar».
  // Los disparadores que había miraban correos, tareas y proyectos. Ninguno miraba
  // al equipo, que es la pregunta que un jefe se hace todos los días.
  const equipo = [{ id: 'p1', name: 'Pablo' }, { id: 'p2', name: 'Claudia' }]
  const base = { inbox: [], tasks: [], projects: [], clients: [], equipo, diario: [], agenda: [] }
  const regla = (t: Record<string, unknown>) =>
    ({ v: 1, trigger: t, action: { type: 'notify_owner' as const, message: 'x' } }) as never

  it('sin_fichar cuenta dias LABORABLES, no naturales', () => {
    // Sin saltar el fin de semana, un umbral de 2 avisa CADA LUNES de todo el
    // equipo — y un aviso que salta siempre deja de leerse.
    // Lunes 2026-08-24: los dos laborables anteriores son viernes 21 y jueves 20,
    // NO domingo 23 y sabado 22.
    const lunes = '2026-08-24'
    const soloPabloElViernes = [{ user_id: 'p1', dia: '2026-08-21', entrada: 'algo', entrada_at: '2026-08-21T09:00:00Z' }]
    const r = evaluateTrigger(regla({ type: 'sin_fichar', threshold: 2 }),
      { ...base, diario: soloPabloElViernes, hoy: lunes })
    // Pablo fichó el viernes → le falta uno de los dos, no salta.
    // Claudia no fichó ninguno de los dos → salta.
    expect(r.map(m => m.vars.persona)).toEqual(['Claudia'])
  })

  it('sin_fichar NO cuenta hoy: aun no ha llegado a la oficina', () => {
    // Avisar a las 8 de la mañana de que alguien «no ha fichado» cuando el dia
    // acaba de empezar no es control, es ruido — y del que enfada.
    const martes = '2026-08-25'
    const ficharonAyer = [
      { user_id: 'p1', dia: '2026-08-24', entrada: 'x', entrada_at: '2026-08-24T09:00:00Z' },
      { user_id: 'p2', dia: '2026-08-24', entrada: 'x', entrada_at: '2026-08-24T09:00:00Z' },
    ]
    const r = evaluateTrigger(regla({ type: 'sin_fichar', threshold: 1 }),
      { ...base, diario: ficharonAyer, hoy: martes })
    expect(r, 'avisa de que no han fichado HOY, cuando el dia acaba de empezar').toEqual([])
  })

  it('una entrada VACIA no cuenta como fichar', () => {
    // Abrir la pantalla y no escribir nada es justo a quien hay que recordarselo.
    const r = evaluateTrigger(regla({ type: 'sin_fichar', threshold: 1 }),
      { ...base, diario: [{ user_id: 'p1', dia: '2026-08-24', entrada: '   ' }], hoy: '2026-08-25' })
    expect(r.map(m => m.vars.persona).sort()).toEqual(['Claudia', 'Pablo'])
  })

  it('dia_sin_cerrar ignora el dia de HOY, que sigue abierto por definicion', () => {
    const hoy = '2026-08-25'
    const r = evaluateTrigger(regla({ type: 'dia_sin_cerrar' }), {
      ...base, hoy,
      diario: [
        { user_id: 'p1', dia: hoy, entrada: 'x', entrada_at: `${hoy}T09:00:00Z`, cierre_at: null },          // en curso
        { user_id: 'p2', dia: '2026-08-24', entrada: 'x', entrada_at: '2026-08-24T09:00:00Z', cierre_at: null }, // sin cerrar de verdad
      ],
    })
    expect(r.map(m => m.vars.persona)).toEqual(['Claudia'])
  })

  it('bloqueado salta con el animo, que es la señal mas urgente', () => {
    const r = evaluateTrigger(regla({ type: 'bloqueado' }), {
      ...base,
      diario: [
        { user_id: 'p1', dia: '2026-08-24', entrada: 'x', entrada_at: '2026-08-24T09:00:00Z', animo: 'productivo' },
        { user_id: 'p2', dia: '2026-08-24', entrada: 'x', entrada_at: '2026-08-24T09:00:00Z', animo: 'bloqueado' },
      ],
    })
    expect(r.map(m => m.vars.persona)).toEqual(['Claudia'])
  })

  it('proyecto_nuevo y pieza_nueva solo miran lo RECIENTE', () => {
    // Sin la ventana, activar la regla dispararia una avalancha sobre todo el
    // historico — el mismo cuidado que ya tienen los disparadores de email.
    const ahora = new Date().toISOString()
    const viejo = new Date(Date.now() - 5 * 86400000).toISOString()
    const p = evaluateTrigger(regla({ type: 'proyecto_nuevo' }), {
      ...base,
      projects: [{ id: 'a', name: 'Nuevo', created_at: ahora }, { id: 'b', name: 'Viejo', created_at: viejo }],
    })
    expect(p.map(m => m.vars.proyecto)).toEqual(['Nuevo'])

    const c = evaluateTrigger(regla({ type: 'pieza_nueva' }), {
      ...base,
      agenda: [{ id: 'x', title: 'Reel', created_at: ahora }, { id: 'y', title: 'Antiguo', created_at: viejo }],
    })
    expect(c.map(m => m.vars.pieza)).toEqual(['Reel'])
  })
})
