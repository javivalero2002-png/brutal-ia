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
  it('nunca devuelve más de MAX_MATCHES_PER_RULE (8)', () => {
    vi.setSystemTime(new Date('2026-08-09T10:00:00Z'))
    const tasks = Array.from({ length: 30 }, (_, i) => task({ id: `t${i}`, level: 'urgent' }))
    expect(evaluateTrigger(rule({ type: 'high_priority_unassigned' }), ctx({ tasks }))).toHaveLength(8)
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
