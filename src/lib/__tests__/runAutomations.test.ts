import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Tests de runAutomations — la parte del motor que NADIE cubría.
//
// Importa: es lo único que se ejecuta solo, 24 veces al día, sin humano delante,
// y puede crear tareas y mandar push a todo el equipo. Los tests que ya existían
// cubren evaluateTrigger e isSelfFeedingRule, que son funciones puras — la parte
// fácil. Los tres bugs reales del motor (canSendPush ausente en notify_owner, y
// el insert de tareas y el update de reglas fallando en silencio) vivían aquí.
//
// `push` se mockea entero para no tocar red; Supabase se sustituye por un doble
// encadenable que registra lo que se le pide.
// ─────────────────────────────────────────────────────────────────────────────

const pushCalls: { fn: string; arg?: any }[] = []
let canSendPushResult = true

vi.mock('@/lib/push', () => ({
  sendPushToAll: vi.fn(async (_a: any, p: any) => { pushCalls.push({ fn: 'all', arg: p }) }),
  sendPushToUser: vi.fn(async (_a: any, u: string) => { pushCalls.push({ fn: 'user', arg: u }) }),
  canSendPush: vi.fn(async () => canSendPushResult),
  PUSH_ROW: '__push_subscription__',
}))

import { runAutomations, AUTO_MARK, type RuleConfig } from '@/lib/automations'

// ── Doble de Supabase ────────────────────────────────────────────────────────
type Tabla = 'reglas' | 'inbox_messages' | 'tasks' | 'projects' | 'clients'

interface Estado {
  reglas: any[]
  inbox: any[]
  tasks: any[]
  projects: any[]
  clients: any[]
  inserts: any[]
  updates: { tabla: string; datos: any }[]
  /** fuerza un error en el insert de tasks, para probar el camino de fallo */
  insertFalla?: string
  /** fuerza un error en el update de reglas */
  updateFalla?: string
  /** fuerza un error al leer las reglas */
  reglasFalla?: string
}

function fakeSupabase(e: Estado): any {
  const resolver = (tabla: Tabla) => {
    const datos =
      tabla === 'reglas' ? e.reglas :
      tabla === 'inbox_messages' ? e.inbox :
      tabla === 'tasks' ? e.tasks :
      tabla === 'projects' ? e.projects : e.clients
    const err = tabla === 'reglas' && e.reglasFalla ? { message: e.reglasFalla } : null
    return { data: err ? null : datos, error: err }
  }

  return {
    from(tabla: Tabla) {
      // Cadena perezosa: cada método devuelve `this` y el objeto es "thenable",
      // así que funciona tanto con await directo como dentro de Promise.all.
      const q: any = {
        select: () => q,
        eq: () => q,
        neq: () => q,
        // `.not('name','in',...)` — el filtro de filas de sistema
        // (__push_subscription__, __account_logo__) vive en reglaRows.ts.
        not: () => q,
        order: () => q,
        limit: () => q,
        insert: (fila: any) => {
          e.inserts.push({ tabla, fila })
          return Promise.resolve(
            e.insertFalla && tabla === 'tasks'
              ? { data: null, error: { message: e.insertFalla } }
              : { data: fila, error: null }
          )
        },
        update: (datos: any) => {
          e.updates.push({ tabla, datos })
          const res = e.updateFalla && tabla === 'reglas'
            ? { data: null, error: { message: e.updateFalla } }
            : { data: datos, error: null }
          const u: any = { eq: () => Promise.resolve(res), then: (r: any) => Promise.resolve(res).then(r) }
          return u
        },
        then: (onOk: any, onErr?: any) => Promise.resolve(resolver(tabla)).then(onOk, onErr),
      }
      return q
    },
  }
}

const regla = (cfg: RuleConfig, extra: Record<string, any> = {}) => ({
  id: 'r1', name: 'Regla de prueba', active: true, trigger_count: 0,
  last_triggered_at: null, created_by: 'u1',
  condition_text: JSON.stringify(cfg), action_text: '', ...extra,
})

const tarea = (o: Record<string, any> = {}) => ({
  id: 't1', text: 'tarea', done: false, due_date: null,
  project_id: null, client_id: null, notes: null, level: 'normal', assigned_to: null, ...o,
})

const estadoBase = (): Estado => ({
  reglas: [], inbox: [], tasks: [], projects: [], clients: [], inserts: [], updates: [],
})

beforeEach(() => {
  pushCalls.length = 0
  canSendPushResult = true
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-09T10:00:00Z'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('runAutomations · casos base', () => {
  it('sin reglas activas no hace nada y no consulta datos', async () => {
    const e = estadoBase()
    const r = await runAutomations(fakeSupabase(e))
    expect(r.ran).toBe(0)
    expect(e.inserts).toHaveLength(0)
    expect(pushCalls).toHaveLength(0)
  })

  it('una regla "manual" (condition_text no-JSON) se ignora', async () => {
    const e = estadoBase()
    e.reglas = [{ ...regla({} as any), condition_text: 'texto libre, no JSON' }]
    const r = await runAutomations(fakeSupabase(e))
    expect(r.ran).toBe(0)
  })

  it('el interruptor NEXUS_AUTOMATIONS=off corta antes de leer nada', async () => {
    const anterior = process.env.NEXUS_AUTOMATIONS
    process.env.NEXUS_AUTOMATIONS = 'off'
    try {
      const e = estadoBase()
      e.reglas = [regla({ v:1, trigger:{type:'task_overdue'}, action:{type:'notify_team'} })]
      const r = await runAutomations(fakeSupabase(e))
      expect(r.ran).toBe(0)
      expect(pushCalls).toHaveLength(0)
    } finally {
      if (anterior === undefined) delete process.env.NEXUS_AUTOMATIONS
      else process.env.NEXUS_AUTOMATIONS = anterior
    }
  })
})

describe('runAutomations · create_task', () => {
  const reglaCrear = regla({
    v: 1,
    trigger: { type: 'task_overdue' },
    action: { type: 'create_task', taskText: 'Revisar: {tarea}', level: 'normal' },
  })

  it('crea la tarea y la marca con AUTO_MARK para el dedup', async () => {
    const e = estadoBase()
    e.reglas = [reglaCrear]
    e.tasks = [tarea({ id: 'vieja', due_date: '2026-08-01' })]
    const r = await runAutomations(fakeSupabase(e))

    expect(r.ran).toBe(1)
    expect(e.inserts).toHaveLength(1)
    const fila = e.inserts[0].fila
    expect(fila.notes).toContain(AUTO_MARK)
    expect(fila.notes).toContain('taskdue:vieja')
    expect(fila.done).toBe(false)
  })

  it('NO vuelve a crearla si ya existe una tarea con esa marca (dedup)', async () => {
    const e = estadoBase()
    e.reglas = [reglaCrear]
    e.tasks = [
      tarea({ id: 'vieja', due_date: '2026-08-01' }),
      tarea({ id: 'ya', notes: `${AUTO_MARK}r1:taskdue:vieja` }),
    ]
    const r = await runAutomations(fakeSupabase(e))
    expect(r.ran).toBe(0)
    expect(e.inserts).toHaveLength(0)
  })

  it('respeta el tope de 8 acciones por regla y ejecución', async () => {
    const e = estadoBase()
    e.reglas = [reglaCrear]
    e.tasks = Array.from({ length: 20 }, (_, i) => tarea({ id: `v${i}`, due_date: '2026-08-01' }))
    await runAutomations(fakeSupabase(e))
    expect(e.inserts).toHaveLength(8)
  })

  it('un insert que falla NO cuenta como ejecutado ni marca el dedup', async () => {
    // Este es el camino que fallaba en silencio: sin comprobar `error`, el motor
    // reportaba la tarea como creada y añadía la marca aunque no existiera fila.
    const e = estadoBase()
    e.reglas = [reglaCrear]
    e.tasks = [tarea({ id: 'vieja', due_date: '2026-08-01' })]
    e.insertFalla = 'columna notes inexistente'
    const r = await runAutomations(fakeSupabase(e))
    expect(r.ran).toBe(0)
    expect(e.updates.filter(u => u.tabla === 'reglas')).toHaveLength(0)
  })

  it('rechaza la regla que se autoalimenta (high_priority_unassigned + create_task)', async () => {
    const e = estadoBase()
    e.reglas = [regla({
      v: 1,
      trigger: { type: 'high_priority_unassigned' },
      action: { type: 'create_task', taskText: 'Asignar: {tarea}', level: 'urgent' },
    })]
    e.tasks = [tarea({ id: 'sinAsignar', level: 'urgent' })]
    const r = await runAutomations(fakeSupabase(e))
    expect(r.ran).toBe(0)
    expect(e.inserts).toHaveLength(0)
  })
})

describe('runAutomations · notificaciones', () => {
  const reglaEquipo = regla({ v:1, trigger:{type:'task_overdue'}, action:{type:'notify_team', message:'Hay retrasos'} })
  const reglaDueno  = regla({ v:1, trigger:{type:'task_overdue'}, action:{type:'notify_owner', message:'Hay retrasos'} })

  it('notify_team manda push a todos', async () => {
    const e = estadoBase()
    e.reglas = [reglaEquipo]
    e.tasks = [tarea({ due_date: '2026-08-01' })]
    await runAutomations(fakeSupabase(e))
    expect(pushCalls.map(p => p.fn)).toEqual(['all'])
  })

  it('notify_team NO manda si canSendPush lo frena', async () => {
    canSendPushResult = false
    const e = estadoBase()
    e.reglas = [reglaEquipo]
    e.tasks = [tarea({ due_date: '2026-08-01' })]
    await runAutomations(fakeSupabase(e))
    expect(pushCalls).toHaveLength(0)
  })

  it('notify_owner TAMBIÉN pasa por canSendPush', async () => {
    // El bug: canSendPush estaba solo en la rama notify_team pese a que las dos
    // dependen del mismo update de last_triggered_at, cuyo error no se comprobaba.
    canSendPushResult = false
    const e = estadoBase()
    e.reglas = [reglaDueno]
    e.tasks = [tarea({ due_date: '2026-08-01' })]
    await runAutomations(fakeSupabase(e))
    expect(pushCalls).toHaveLength(0)
  })

  it('el throttle de 6h impide repetir el aviso de la misma regla', async () => {
    const e = estadoBase()
    e.reglas = [regla(
      { v:1, trigger:{type:'task_overdue'}, action:{type:'notify_team', message:'x'} },
      { last_triggered_at: new Date('2026-08-09T08:00:00Z').toISOString() }, // hace 2h
    )]
    e.tasks = [tarea({ due_date: '2026-08-01' })]
    await runAutomations(fakeSupabase(e))
    expect(pushCalls).toHaveLength(0)
  })

  it('pasado el throttle sí vuelve a avisar', async () => {
    const e = estadoBase()
    e.reglas = [regla(
      { v:1, trigger:{type:'task_overdue'}, action:{type:'notify_team', message:'x'} },
      { last_triggered_at: new Date('2026-08-08T20:00:00Z').toISOString() }, // hace 14h
    )]
    e.tasks = [tarea({ due_date: '2026-08-01' })]
    await runAutomations(fakeSupabase(e))
    expect(pushCalls.map(p => p.fn)).toEqual(['all'])
  })
})

describe('runAutomations · resiliencia', () => {
  it('si falla la consulta de reglas devuelve 0 sin lanzar', async () => {
    // Antes esto se reportaba como "0 automatizaciones", indistinguible de no
    // tener ninguna regla activa.
    const e = estadoBase()
    e.reglasFalla = 'conexión rechazada'
    const r = await runAutomations(fakeSupabase(e))
    expect(r.ran).toBe(0)
  })

  it('un update de reglas que falla no tumba la ejecución', async () => {
    const e = estadoBase()
    e.reglas = [regla({ v:1, trigger:{type:'task_overdue'}, action:{type:'create_task', taskText:'x'} })]
    e.tasks = [tarea({ id: 'vieja', due_date: '2026-08-01' })]
    e.updateFalla = 'permiso denegado'
    const r = await runAutomations(fakeSupabase(e))
    expect(r.ran).toBe(1)          // la tarea sí se creó
    expect(e.inserts).toHaveLength(1)
  })

  it('una tarea que vence HOY no dispara task_overdue', async () => {
    // Regresión de zona horaria a nivel de motor completo, no solo de la función
    // pura: a las 10:00 UTC son las 12:00 en Madrid del mismo día.
    const e = estadoBase()
    e.reglas = [regla({ v:1, trigger:{type:'task_overdue'}, action:{type:'create_task', taskText:'x'} })]
    e.tasks = [tarea({ id: 'hoy', due_date: '2026-08-09' })]
    const r = await runAutomations(fakeSupabase(e))
    expect(r.ran).toBe(0)
    expect(e.inserts).toHaveLength(0)
  })
})
