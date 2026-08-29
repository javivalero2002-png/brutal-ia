import type { SupabaseClient } from '@supabase/supabase-js'
import { haFichado } from '@/components/shared/helpers'
import { sendPushToAll, sendPushToUser, canSendPush, type PushPayload } from '@/lib/push'
import { todayKey, localDayKey, rotuloNivel } from '@/components/shared/helpers'
import { logQueryErrors } from '@/lib/queryLog'
import { NON_RULE_ROWS_FILTER } from '@/lib/reglaRows'
import { acquireLock, releaseLock } from '@/lib/jobLock'

const LOCK_KEY = 'automations'
// El techo de Vercel (Hobby) son 60 s: pasado ese punto la instancia ya no existe
// y su cerrojo es basura. 90 s deja margen sin llegar al cron de la hora siguiente.
const LOCK_TTL_MS = 90_000

// ─────────────────────────────────────────────────────────────────────────────
// MOTOR DE AUTOMATIZACIONES (determinista)
//
// Cada regla guarda su configuración como JSON en `condition_text`:
//   { v:1, trigger:{type,...}, action:{type,...} }
// `action_text` guarda un resumen legible (para la UI y compatibilidad).
//
// Las reglas antiguas (condition_text no-JSON) se consideran "manuales":
// se muestran y organizan pero el motor NO las ejecuta.
//
// Dedup SIN migración:
//   · create_task → marca oculta en el campo `notes` de la tarea
//     (`⚙ auto:<ruleId>:<entityKey>`). No se crea dos veces la misma tarea.
//   · notify_*    → throttle por regla vía `last_triggered_at` (una vez / VENTANA).
// ─────────────────────────────────────────────────────────────────────────────

// La constante vive en shared/helpers.ts porque también la necesita la UI
// (separar la marca del texto al pintar y editar notas); este módulo importa
// web-push y no puede entrar en un componente de cliente. Se re-exporta para
// que los consumidores del motor sigan encontrándola aquí.
export { AUTO_MARK } from '@/components/shared/helpers'
import { AUTO_MARK } from '@/components/shared/helpers'

/**
 * Prefijo con el que una regla de AVISO recuerda, en su `description`, las
 * claves que ya notificó. Mismo espíritu que AUTO_MARK: dedup sin migración.
 *
 * Sin esto el único freno era el throttle de 6 h por regla, que no distingue
 * eventos: «Claudia se marcó bloqueado el día 14» avisaba hasta 4 veces al día
 * mientras la fila siguiera en la ventana del diario — ~56 pushes por UN día
 * bloqueado. El throttle responde «¿cuándo avisé por última vez?»; esto
 * responde «¿ya avisé de ESTO?», que es la pregunta correcta para un evento.
 *
 * `description` está libre: el esquema la tiene y ni la UI ni las rutas la
 * leen para las reglas normales (las filas especiales __latido__/__prefs__ la
 * usan, pero no son reglas estructuradas y no pasan por aquí).
 */
export const AVISADAS_MARK = '⚙avisadas:'
const AVISADAS_MAX = 40

/**
 * Disparadores de estado SOSTENIDO: su clave describe una situación que sigue
 * viva («10+ sin leer»), no un hecho puntual. Ahí repetir cada 6 h es lo
 * esperado — recordar la clave los silenciaría para siempre a la primera.
 */
const SOSTENIDOS = new Set(['unread_pileup', 'many_overdue'])
// Eventos con VENTANA DE FRESCURA de 24h: proyecto_nuevo y pieza_nueva salen de
// `matches` cuando el item pasa de 24h (automations.ts, ramas de esos triggers).
// Para ellos el throttle de 6h no vale: con un lote creado de golpe, el motor
// avisa 1 por ejecución y a las 24h los últimos se caen de la ventana SIN
// avisar. Su dedup real es `avisadas` (por clave, una vez cada uno), así que se
// les salta el throttle. task_overdue, bloqueado, etc. NO están: su match
// persiste y el throttle solo los retrasa, no los pierde.
const EVENTOS_VENTANA_CORTA = new Set(['proyecto_nuevo', 'pieza_nueva'])

/** Hace N días, en day key de Madrid. Para acotar la ventana del diario. */
const hace = (n: number) => {
  const d = new Date(`${todayKey()}T12:00:00`)
  d.setDate(d.getDate() - n)
  return localDayKey(d)
}
const NOTIFY_THROTTLE_MS = 6 * 60 * 60 * 1000 // 6h entre avisos de la misma regla
const MAX_MATCHES_PER_RULE = 8                // tope de acciones por regla y ejecución

export type TriggerType =
  | 'email_urgent'             // email urgente sin leer
  | 'email_from_client'        // email sin leer de un cliente concreto
  | 'project_deadline'         // proyecto con deadline en < N días
  | 'task_overdue'             // tarea vencida sin completar
  | 'unread_pileup'            // ≥ N emails sin leer
  | 'many_overdue'             // ≥ N tareas vencidas sin completar (count global)
  | 'high_priority_unassigned' // tareas urgentes/altas sin responsable
  | 'client_followup'          // sin emails del cliente en N días
  // ── AUTOMATIZACIONES DE CONTROL ──────────────────────────────────────────
  // Javi: «el jefe puede ponerse un aviso de que alguien lleva dos días sin
  // fichar». Las de arriba miran COSAS (correos, tareas, proyectos); estas miran
  // PERSONAS, que es lo que un jefe necesita y no tenía.
  | 'sin_fichar'               // alguien lleva ≥ N días laborables sin fichar
  | 'dia_sin_cerrar'           // alguien fichó y no cerró el día
  | 'bloqueado'                // alguien se marcó BLOQUEADO al cerrar
  // ── AVISOS DE ALTA ───────────────────────────────────────────────────────
  | 'proyecto_nuevo'           // se creó un proyecto
  | 'pieza_nueva'              // se añadió una pieza de contenido

export type ActionType = 'create_task' | 'notify_team' | 'notify_owner'

export interface RuleConfig {
  v: number
  trigger: {
    type: TriggerType
    clientId?: string
    clientName?: string
    days?: number
    threshold?: number
    level?: 'urgent' | 'high'
  }
  action: {
    type: ActionType
    taskText?: string
    level?: 'urgent' | 'high' | 'normal'
    assignTo?: string | null
    message?: string
  }
}

export interface AutomationResult {
  ruleId: string
  ruleName: string
  action: ActionType
  detail: string
}

export function parseRuleConfig(conditionText: string | null | undefined): RuleConfig | null {
  if (!conditionText) return null
  const t = conditionText.trim()
  if (!t.startsWith('{')) return null
  try {
    const cfg = JSON.parse(t)
    if (cfg && cfg.trigger?.type && cfg.action?.type) return cfg as RuleConfig
  } catch { /* regla manual/legacy */ }
  return null
}

// Resumen legible para mostrar en la UI (también se guarda en action_text)
export function describeRule(cfg: RuleConfig, clientName?: string): { cond: string; act: string } {
  const t = cfg.trigger, a = cfg.action
  const cond =
    t.type === 'email_urgent'             ? 'Email urgente sin leer'
    : t.type === 'email_from_client'      ? `Email de ${t.clientName || clientName || 'cliente'} sin leer`
    : t.type === 'project_deadline'       ? `Proyecto con deadline en < ${t.days ?? 7} días`
    : t.type === 'task_overdue'           ? 'Tarea vencida sin completar'
    : t.type === 'sin_fichar'             ? `Alguien lleva ${t.threshold ?? 2}+ días sin fichar`
    : t.type === 'dia_sin_cerrar'         ? 'Alguien fichó y no cerró el día'
    : t.type === 'bloqueado'              ? 'Alguien se marcó BLOQUEADO'
    : t.type === 'proyecto_nuevo'         ? 'Se crea un proyecto'
    : t.type === 'pieza_nueva'            ? 'Se añade una pieza de contenido'
    : t.type === 'unread_pileup'          ? `${t.threshold ?? 10}+ emails sin leer`
    : t.type === 'many_overdue'           ? `${t.threshold ?? 5}+ tareas vencidas`
    : t.type === 'high_priority_unassigned' ? 'Tareas urgentes sin responsable'
    : t.type === 'client_followup'        ? `Sin emails de ${t.clientName || clientName || 'cliente'} en ${t.days ?? 14} días`
    : 'Condición'
  const act =
    a.type === 'create_task'  ? `Crear tarea${a.level && a.level !== 'normal' ? ` (${rotuloNivel(a.level).toLowerCase()})` : ''}`
    : a.type === 'notify_team'  ? 'Notificar al equipo'
    : a.type === 'notify_owner' ? 'Avisarme a mí'
    : 'Acción'
  return { cond, act }
}

function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
}

// Parser tolerante para deadlines en texto libre ("31 Jul 2026", "Oct 2026", "HOY").
const MESES: Record<string, number> = {
  ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, oct: 9, nov: 10, dic: 11,
}
// Un deadline es un DÍA, no un instante. Comparar timestamps era el origen de un
// bug real: '2026-08-09' pasaba por Date.parse → 00:00 UTC → 02:00 en Madrid, y
// a partir de esa hora una tarea que vence HOY se marcaba como vencida, mientras
// la UI (TareasSection, vía dlDate) decía correctamente que no lo estaba. Con el
// cron horario eso generaba alertas falsas de "vencida" todos los días.
// Solución: trabajar siempre con day keys 'YYYY-MM-DD' en Europe/Madrid, la misma
// convención que ya usa la UI (helpers.ts), en vez de forkear la lógica de fechas.
const DAY_MS = 86400000
const dayKeyToUTC = (k: string): number => Date.parse(`${k}T00:00:00Z`)

/** Deadline → día 'YYYY-MM-DD', o null si no se puede interpretar. */
function deadlineDayKey(raw?: string | null): string | null {
  if (!raw) return null
  const s = raw.trim().toLowerCase()
  if (!s || s === 'tbd' || s === '—' || s === '-') return null
  if (s === 'hoy') return todayKey()
  if (s === 'mañana') return new Date(dayKeyToUTC(todayKey()) + DAY_MS).toISOString().slice(0, 10)
  // ISO primero: '2026-08-09' no tiene letras, así que caía al Date.parse de abajo.
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (iso) return iso[1]
  // dd mmm yyyy  |  mmm yyyy
  const m = s.match(/(\d{1,2})?\s*([a-záéíóú]{3,})\.?\s*(\d{4})?/)
  if (m) {
    const mesKey = (m[2] || '').slice(0, 3)
    if (mesKey in MESES) {
      // Día 28 por defecto para "oct 2026", igual que dlDate en helpers.ts. Antes
      // el motor usaba el día 1 y la UI el 28: dos verdades para el mismo texto.
      const day = m[1] ? parseInt(m[1], 10) : 28
      const year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear()
      return `${year}-${String(MESES[mesKey] + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }
  const t = Date.parse(raw)
  return isNaN(t) ? null : localDayKey(t)
}

/** Días enteros desde hoy (Madrid) hasta ese día. 0 = vence hoy, -1 = ayer. */
function daysUntilDay(k: string): number {
  return Math.round((dayKeyToUTC(k) - dayKeyToUTC(todayKey())) / DAY_MS)
}

/** Una tarea creada por el propio motor lleva la marca oculta en `notes`. */
const isEngineTask = (tk: any): boolean =>
  typeof tk?.notes === 'string' && tk.notes.includes(AUTO_MARK)

/**
 * `high_priority_unassigned` + `create_task` sin responsable y con prioridad
 * alta/urgente es un bucle: la tarea creada cumple el mismo predicado que la
 * disparó. La UI permite combinarlos (listas de triggers y acciones sin
 * validación cruzada), así que el motor se niega explícitamente.
 */
export function isSelfFeedingRule(cfg: RuleConfig): boolean {
  return cfg.trigger.type === 'high_priority_unassigned'
    && cfg.action.type === 'create_task'
    && !cfg.action.assignTo
    && (cfg.action.level === 'urgent' || cfg.action.level === 'high')
}

interface Match { key: string; vars: Record<string, string>; clientId?: string; projectId?: string }

// ── Evaluación de disparadores ───────────────────────────────────────────────
// Exportada para poder testearla: es una función pura (sin Supabase ni red) y es
// el motor de un cron que crea tareas y notifica al equipo sin humano delante.
export function evaluateTrigger(cfg: RuleConfig, ctx: {
  inbox: any[]; tasks: any[]; projects: any[]; clients: any[]
  /** Sin leer en el buzón PERSONAL de quien creó la regla. Solo lo usa `unread_pileup`. */
  sinLeerMios?: number
  /** El equipo y su fichaje reciente. Lo usan las automatizaciones de control. */
  equipo?: { id: string; name?: string | null }[]
  /** Filas de `diario` de los últimos días, para saber quién fichó y quién cerró. */
  diario?: { user_id: string; dia: string; entrada?: string | null; entrada_at?: string | null; cierre_at?: string | null; animo?: string | null }[]
  /** Hoy en Madrid, inyectado: la función es pura y los días son días de Madrid. */
  hoy?: string
  /** Piezas de contenido, para el aviso de pieza nueva. */
  agenda?: { id: string; title?: string | null; platform?: string | null; created_at?: string | null }[]
}): Match[] {
  const t = cfg.trigger
  const out: Match[] = []
  // Los disparadores de email solo miran mensajes recientes: así activar una
  // regla no dispara una avalancha de acciones sobre el histórico del inbox.
  const FRESH_MS = 3 * 86400000
  const isFresh = (m: any) => { const ts = m.received_at ? new Date(m.received_at).getTime() : 0; return ts === 0 || Date.now() - ts < FRESH_MS }

  if (t.type === 'email_urgent') {
    for (const m of ctx.inbox) {
      if (m.is_read || !isFresh(m)) continue
      if ((m.ai_urgency || 'normal') !== 'urgent') continue
      out.push({ key: `email:${m.id}`, vars: {
        asunto: m.subject || '(sin asunto)', remitente: m.from_name || m.from_email || '', cliente: m.ai_client || '',
      } })
    }
  } else if (t.type === 'email_from_client') {
    const cli = ctx.clients.find(c => c.id === t.clientId)
    const cname = (t.clientName || cli?.name || '').toLowerCase()
    for (const m of ctx.inbox) {
      if (m.is_read || !isFresh(m)) continue
      const hay = [m.ai_client, m.from_name, m.from_email].filter(Boolean).map((x: string) => x.toLowerCase())
      if (!cname || !hay.some(h => h.includes(cname) || cname.includes(h.split(' ')[0]))) continue
      out.push({ key: `email:${m.id}`, clientId: cli?.id, vars: {
        asunto: m.subject || '(sin asunto)', remitente: m.from_name || m.from_email || '', cliente: cli?.name || t.clientName || '',
      } })
    }
  } else if (t.type === 'project_deadline') {
    const within = t.days ?? 7
    for (const p of ctx.projects) {
      if (p.status === 'completado') continue
      const d = deadlineDayKey(p.deadline)
      if (!d) continue
      const du = daysUntilDay(d)
      if (du < 0 || du > within) continue
      const cli = ctx.clients.find(c => c.id === p.client_id)
      out.push({ key: `proj:${p.id}:${d}`, projectId: p.id, clientId: p.client_id, vars: {
        proyecto: p.name, cliente: cli?.name || '', dias: String(du),
      } })
    }
  } else if (t.type === 'task_overdue') {
    const grace = t.days ?? 0
    for (const tk of ctx.tasks) {
      if (tk.done || !tk.due_date) continue
      const d = deadlineDayKey(tk.due_date)
      if (!d) continue
      // Vencida = su DÍA ya pasó. Una tarea que vence hoy no está vencida en
      // ningún momento del día, igual que en la UI (TareasSection: `atrasadas`).
      if (daysUntilDay(d) >= -grace) continue
      out.push({ key: `taskdue:${tk.id}`, projectId: tk.project_id, clientId: tk.client_id, vars: {
        tarea: tk.text || '', asunto: tk.text || '',
      } })
    }
  } else if (t.type === 'unread_pileup') {
    const threshold = t.threshold ?? 10
    // QUÉ buzón se cuenta depende de A QUIÉN avisa la regla, y no es un detalle:
    //
    //  · `notify_team` mira SOLO el compartido. Empujarle a los siete que a
    //    alguien se le acumula el correo personal no es lo que nadie espera al
    //    conectar su Gmail — esa es la decisión que ya estaba tomada aquí.
    //  · `notify_owner` («avisarme a mí») avisa a UNA persona: la suya. Ahí ese
    //    motivo no aplica, y contar solo el compartido hacía que la regla no
    //    saltara nunca por mucho correo sin leer que uno tuviera. Es lo que
    //    reportó Javi: 96 sin leer y el motor diciendo «nada que disparar».
    const compartidos = ctx.inbox.filter(m => !m.is_read).length
    const unread = cfg.action.type === 'notify_owner'
      ? compartidos + (ctx.sinLeerMios ?? 0)
      : compartidos
    if (unread >= threshold) {
      // todayKey() y no toISOString(): la clave UTC saltaba de día a las 22:00 de
      // Madrid, permitiendo que la regla se disparara dos veces el mismo día español.
      out.push({ key: `pileup:${todayKey()}`, vars: { total: String(unread) } })
    }
  } else if (t.type === 'many_overdue') {
    const threshold = t.threshold ?? 5
    const overdueList = ctx.tasks.filter(tk => {
      if (tk.done || !tk.due_date) return false
      const d = deadlineDayKey(tk.due_date)
      return d ? daysUntilDay(d) < 0 : false
    })
    if (overdueList.length >= threshold) {
      out.push({ key: `many_overdue:${todayKey()}`, vars: { total: String(overdueList.length) } })
    }
  } else if (t.type === 'high_priority_unassigned') {
    for (const tk of ctx.tasks) {
      // Excluir las tareas del propio motor: si las contamos, la regla se
      // autoalimenta. Cada tarea generada es una fuente nueva con un markId que
      // el dedup nunca ha visto (la marca va con el id de la tarea ORIGEN), así
      // que cada ejecución producía hasta 8 tareas más — 192/día con el cron.
      if (tk.done || tk.assigned_to || isEngineTask(tk)) continue
      if (tk.level !== 'urgent' && tk.level !== 'high') continue
      out.push({ key: `unassigned:${tk.id}`, projectId: tk.project_id, clientId: tk.client_id, vars: {
        tarea: tk.text || '', asunto: tk.text || '',
      } })
    }
  } else if (t.type === 'sin_fichar') {
    // ── QUIÉN LLEVA N DÍAS SIN FICHAR ──────────────────────────────────────
    //
    // Cuenta DÍAS LABORABLES hacia atrás desde ayer, no días naturales, y no
    // incluye hoy. Dos motivos, y los dos importan:
    //
    //  · Sin saltar fin de semana, un umbral de 2 días avisa cada lunes por la
    //    mañana de todo el equipo. Un aviso que salta siempre deja de leerse.
    //  · Sin excluir hoy, avisaría a las 8 de la mañana de que alguien «no ha
    //    fichado» cuando aún no ha llegado a la oficina. Eso no es control, es
    //    ruido — y del que enfada.
    const umbral = Math.max(1, t.threshold ?? 2)
    const hoy = ctx.hoy || todayKey()
    const fichados = new Set((ctx.diario || [])
      // Mismo criterio que el resto de la app: la marca es `entrada_at`, no el
      // texto. Un borrador con algo escrito no es un fichaje.
      .filter(d => haFichado(d as { entrada_at?: string | null }))
      .map(d => `${d.user_id}|${d.dia}`))

    // Los N últimos días laborables antes de hoy.
    const laborables: string[] = []
    const cursor = new Date(`${hoy}T12:00:00`)
    while (laborables.length < umbral) {
      cursor.setDate(cursor.getDate() - 1)
      const dow = cursor.getDay()
      if (dow === 0 || dow === 6) continue
      laborables.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`)
    }

    for (const p of ctx.equipo || []) {
      const faltan = laborables.filter(d => !fichados.has(`${p.id}|${d}`))
      if (faltan.length < umbral) continue
      out.push({
        // La clave lleva el ÚLTIMO día contado: así el aviso se repite si sigue
        // sin fichar mañana, pero no se repite hoy por la misma racha.
        key: `sinfichar:${p.id}:${laborables[0]}`,
        vars: { persona: p.name || 'alguien', dias: String(umbral) },
      })
    }
  } else if (t.type === 'dia_sin_cerrar') {
    // Fichó y no cerró. Solo días PASADOS: el de hoy sigue abierto por definición.
    const hoy = ctx.hoy || todayKey()
    const nombre = new Map((ctx.equipo || []).map(p => [p.id, p.name || 'alguien']))
    for (const d of ctx.diario || []) {
      if (d.dia >= hoy) continue
      // `haFichado` y NO el texto. Con el texto, quien abre Fichar, escribe dos
      // palabras y se va —sin llegar a fichar— salía acusado de «fichó y no
      // cerró»: una afirmación falsa sobre el trabajo de alguien, y le llega a un
      // jefe. Es el mismo criterio que ya usa el recordatorio de las 20:00, donde
      // está escrito al lado: «haFichado y no el texto».
      if (!haFichado(d as { entrada_at?: string | null }) || d.cierre_at) continue
      out.push({ key: `sincerrar:${d.user_id}:${d.dia}`, vars: { persona: nombre.get(d.user_id) || 'alguien', dia: d.dia } })
    }
  } else if (t.type === 'bloqueado') {
    // Alguien se marcó BLOQUEADO. Es la señal que más rápido debe llegar a un
    // jefe: es la única que dice «estoy parado y no puedo salir solo».
    const nombre = new Map((ctx.equipo || []).map(p => [p.id, p.name || 'alguien']))
    for (const d of ctx.diario || []) {
      if (d.animo !== 'bloqueado') continue
      out.push({ key: `bloqueado:${d.user_id}:${d.dia}`, vars: { persona: nombre.get(d.user_id) || 'alguien', dia: d.dia } })
    }
  } else if (t.type === 'proyecto_nuevo') {
    // Proyectos creados en las últimas 24h. El `key` lleva el id, así que cada
    // proyecto avisa UNA vez aunque el cron pase doce veces.
    for (const p of ctx.projects) {
      const creado = (p as { created_at?: string }).created_at
      if (!creado || Date.now() - new Date(creado).getTime() > 86400000) continue
      out.push({ key: `proyNuevo:${p.id}`, vars: { proyecto: p.name || 'sin nombre' }, projectId: p.id })
    }
  } else if (t.type === 'pieza_nueva') {
    for (const a of ctx.agenda || []) {
      const creado = a.created_at
      if (!creado || Date.now() - new Date(creado).getTime() > 86400000) continue
      out.push({ key: `piezaNueva:${a.id}`, vars: { pieza: a.title || 'sin título', plataforma: a.platform || '' } })
    }
  } else if (t.type === 'client_followup') {
    const cli = ctx.clients.find(c => c.id === t.clientId)
    const cname = (t.clientName || cli?.name || '').toLowerCase()
    const days = t.days ?? 14
    const cutoff = Date.now() - days * 86400000
    if (cname && cli) {
      const emails = ctx.inbox.filter(m => {
        const hay = [m.ai_client, m.from_name, m.from_email].filter(Boolean).map((x: string) => x.toLowerCase())
        return hay.some((h: string) => h.includes(cname.split(' ')[0]) || cname.includes(h.split('@')[0].split(' ')[0]))
      })
      const mostRecent = emails.reduce((mx: number, m: any) => {
        const ts = m.received_at ? new Date(m.received_at).getTime() : 0
        return Math.max(mx, ts)
      }, 0)
      // `mostRecent > 0` es imprescindible: si NINGÚN email casa con el cliente,
      // el reduce devuelve 0 y `0 < cutoff` es siempre cierto, así que la regla
      // se disparaba cada día para siempre. Sin emails previos no hay seguimiento
      // que reclamar — no es un cliente "frío", es un cliente sin histórico.
      if (mostRecent > 0 && mostRecent < cutoff) {
        const daysSince = Math.floor((Date.now() - mostRecent) / DAY_MS)
        out.push({
          // Sin el dia. `followup` es un estado SOSTENIDO —«este cliente lleva N
          // dias sin escribir»— no un hecho puntual: con la fecha dentro, cada dia
          // era una clave nueva y salia una tarea identica cada 24 h,
          // indefinidamente, porque escribirle TU al cliente no deja rastro en el
          // buzon y la condicion solo se apaga si contesta el. Treinta dias de
          // silencio eran treinta tareas iguales.
          // ...y CON el día del último email del cliente: es estable durante un
          // mismo silencio (no gotea) y cambia cuando el cliente escribe y vuelve
          // a callarse. Sin él, la marca de la tarea ya hecha —que sobrevive en
          // sus notes— bloqueaba el seguimiento PARA SIEMPRE: el primer silencio
          // creaba la tarea y ningún silencio posterior volvía a crear ninguna.
          key: `followup:${cli.id}:${localDayKey(new Date(mostRecent))}`,
          clientId: cli.id,
          vars: { cliente: cli.name, dias: String(daysSince) },
        })
      }
    }
  }

  // Se devuelven TODAS las coincidencias. El tope se aplica mas adelante, dentro
  // del bucle, contando solo las que pasan el dedup.
  //
  // Cortando aqui, las coincidencias ya atendidas seguian ocupando plaza: con 12
  // tareas vencidas se creaban 8 la primera vez y CERO en todas las siguientes —
  // las mismas 8 llenaban el cupo y el dedup las descartaba una por una. Cuatro
  // tareas vencidas sin seguimiento para siempre, y la app diciendo «sin acciones
  // pendientes».
  return out
}

// ── Ejecución ────────────────────────────────────────────────────────────────
export async function runAutomations(admin: SupabaseClient): Promise<{ ran: number; results: AutomationResult[]; skipped?: true }> {
  const results: AutomationResult[] = []

  // Interruptor de emergencia. Ojo: cambiar una env var en Vercel requiere
  // redeploy, así que el corte INSTANTÁNEO sigue siendo poner active=false en la
  // tabla `reglas` (el motor solo carga reglas activas, justo debajo).
  if (process.env.NEXUS_AUTOMATIONS === 'off') return { ran: 0, results }

  // Una sola ejecución a la vez en toda la instalación. El dedup de create_task
  // compara contra las marcas leídas en el snapshot de abajo y no las escribe
  // hasta el insert: dos motores solapados pasan los dos por ese hueco y crean
  // la tarea dos veces. TTL por encima del corte de 60 s de Vercel, para que una
  // instancia matada a mitad no bloquee la ejecución de la hora siguiente.
  const cerrojo = await acquireLock(admin, LOCK_KEY, LOCK_TTL_MS)
  if (!cerrojo.adquirido) {
    console.warn('[automations] ya hay una ejecución en curso, se omite esta')
    return { ran: 0, results, skipped: true }
  }

  try {
    return await ejecutarReglas(admin, results)
  } finally {
    // Solo si el cerrojo es real. En modo degradado (tabla ausente) no hay nada
    // que soltar y el DELETE volvería a fallar por lo mismo.
    if (!cerrojo.degradado) await releaseLock(admin, LOCK_KEY, cerrojo.holder)
  }
}

async function ejecutarReglas(
  admin: SupabaseClient,
  results: AutomationResult[],
): Promise<{ ran: number; results: AutomationResult[] }> {
  // Reglas activas (excluye las filas que no son reglas: push y logos de cuenta)
  const { data: rules, error: rulesError } = await admin
    .from('reglas')
    .select('id,name,description,condition_text,action_text,active,trigger_count,last_triggered_at,created_by')
    .eq('active', true)
    .not('name', 'in', NON_RULE_ROWS_FILTER)

  // Sin esto, un fallo al leer las reglas se reportaba como "0 automatizaciones
  // ejecutadas" — indistinguible de no tener ninguna regla activa.
  if (rulesError) console.error('[automations] no se pudieron leer las reglas:', rulesError.message)

  const structured = (rules || [])
    .map(r => ({ r, cfg: parseRuleConfig(r.condition_text) }))
    .filter((x): x is { r: any; cfg: RuleConfig } => !!x.cfg)
    // Defensa en profundidad: aunque isEngineTask ya rompe el bucle, una regla
    // que se autoalimenta por diseño no debe ejecutarse nunca.
    .filter(x => !isSelfFeedingRule(x.cfg))

  if (structured.length === 0) return { ran: 0, results }

  // Snapshot de datos (una sola vez)
  const snapshot = await Promise.all([
    // SOLO el buzon compartido. Antes esta consulta no filtraba nada, asi que el
    // motor leia el Gmail PERSONAL de cada miembro del equipo —asunto, remitente y
    // cliente detectado— y lo convertia en tareas y avisos que ve todo el mundo.
    //
    // Que una regla salte por un correo del banco, del medico o de una entrevista
    // que alguien tiene en su cuenta personal, y que eso aparezca como tarea del
    // equipo o llegue como push a los siete, no es lo que nadie espera al conectar
    // su Gmail para no perderse los correos de clientes.
    //
    // El buzon compartido si es correspondencia de empresa, y es para lo que
    // existen las reglas. ESTO ESTRECHA EL COMPORTAMIENTO a proposito: una regla
    // que hoy salte por un correo personal dejara de hacerlo.
    admin.from('inbox_messages').select('id,subject,from_name,from_email,ai_client,ai_urgency,is_read,received_at').eq('shared', true).order('received_at', { ascending: false }).limit(200),
    // El correo PERSONAL va en su propia lista y NO entra en `ctx.inbox`.
    //
    // Mezclarlos habría sido el arreglo fácil y el error grave: los otros tres
    // disparadores que miran el buzón —email urgente, de un cliente— dependen de
    // que ahí solo haya correspondencia de empresa, y con el personal dentro
    // empezarían a saltar por correo privado y a empujárselo a los siete. Solo
    // `unread_pileup` con «avisarme a mí» mira esta lista.
    //
    // Se piden únicamente los SIN LEER: es lo único que se cuenta, y así el
    // límite no se lo comen los leídos.
    admin.from('inbox_messages').select('user_id').eq('shared', false).eq('is_read', false).limit(2000),
    // `level` y `assigned_to` van AQUI porque el disparador «urgentes sin asignar»
    // los evalua (:253-254) y sin traerlos llegaban `undefined`: `tk.level !==
    // 'urgent' && tk.level !== 'high'` era siempre cierto, asi que la regla
    // descartaba TODAS las tareas y no ha saltado una sola vez desde que existe.
    // Y no basta con `level`: sin `assigned_to`, el filtro de "ya tiene
    // responsable" tampoco funciona y avisaria de tareas que si lo tienen.
    //
    // Un snapshot que no trae lo que el evaluador mira es un fallo mudo: no hay
    // error, solo cero coincidencias para siempre.
    admin.from('tasks').select('id,text,done,due_date,project_id,client_id,notes,level,assigned_to'),
    // `created_at` VA EN EL SELECT: el disparador «Nuevo proyecto añadido» lo lee
    // (`Date.now() - new Date(p.created_at)`) y sin la columna es `undefined`, el
    // `continue` se ejecuta siempre y la automatizacion NO PUEDE SALTAR NUNCA.
    // Mismo fallo mudo que este fichero ya documenta con `level` y `assigned_to`.
    admin.from('projects').select('id,name,status,deadline,client_id,created_at'),
    admin.from('clients').select('id,name'),
    // ── Lo que miran las automatizaciones de CONTROL ────────────────────────
    // El comentario de arriba lo dice y vale también aquí: un snapshot que no trae
    // lo que el evaluador mira es un fallo MUDO —no hay error, solo cero
    // coincidencias para siempre—. Estas tres consultas son las que hacen que
    // `sin_fichar`, `dia_sin_cerrar` y `bloqueado` puedan saltar alguna vez.
    admin.from('profiles').select('id,name'),
    // Dos semanas: cubre de sobra un umbral de días laborables sin traerse el
    // histórico entero cada hora.
    admin.from('diario').select('user_id,dia,entrada,entrada_at,cierre_at,animo').gte('dia', hace(14)),
    admin.from('content_agenda').select('id,title,platform,created_at').order('created_at', { ascending: false }).limit(50),
  ])
  // Si una consulta falla, su lista queda vacía y el motor decide sobre datos
  // incompletos — p. ej. "0 tareas vencidas" cuando en realidad no pudo leerlas.
  logQueryErrors('automations', snapshot)
  const [{ data: inbox }, { data: personales }, { data: tasks }, { data: projects }, { data: clients }, { data: equipo }, { data: diario }, { data: agenda }] = snapshot
  // Cuántos sin leer tiene cada uno en su buzón personal.
  const sinLeerPorPersona = new Map<string, number>()
  for (const m of personales || []) {
    if (m.user_id) sinLeerPorPersona.set(m.user_id, (sinLeerPorPersona.get(m.user_id) || 0) + 1)
  }
  const ctx = {
    inbox: inbox || [], tasks: tasks || [], projects: projects || [], clients: clients || [],
    equipo: equipo || [], diario: diario || [], agenda: agenda || [], hoy: todayKey(),
  }

  // Marcas de dedup ya existentes en tareas creadas por el motor
  const existingMarks = new Set<string>()
  for (const tk of ctx.tasks) {
    const notes: string = tk.notes || ''
    const idx = notes.indexOf(AUTO_MARK)
    if (idx >= 0) existingMarks.add(notes.slice(idx + AUTO_MARK.length).split(/\s/)[0])
  }

  const now = Date.now()

  for (const { r, cfg } of structured) {
    let fired = false
    const matches = evaluateTrigger(cfg, { ...ctx, sinLeerMios: sinLeerPorPersona.get(r.created_by || '') || 0 })
    if (matches.length === 0) continue

    // El tope, aqui: cuenta acciones REALIZADAS, no coincidencias miradas. Las
    // ramas de aviso hacen `break` a la primera, asi que esto solo afecta de hecho
    // a create_task, que es donde estaba el problema.
    let hechasEnEstaRegla = 0

    // Las claves ya avisadas por esta regla, si las hay.
    const avisadasSet = new Set<string>((() => {
      const d = (r as { description?: string | null }).description || ''
      if (!d.startsWith(AVISADAS_MARK)) return [] as string[]
      try { const j = JSON.parse(d.slice(AVISADAS_MARK.length)); return Array.isArray(j) ? j : [] } catch { return [] }
    })())
    let avisadaNueva = false

    for (const match of matches) {
      if (hechasEnEstaRegla >= MAX_MATCHES_PER_RULE) break
      const a = cfg.action

      if (a.type === 'create_task') {
        const markId = `${r.id}:${match.key}`
        if (existingMarks.has(markId)) continue // ya creada
        const text = fillTemplate(a.taskText || 'Revisar: {asunto}', match.vars).slice(0, 300).trim() || 'Tarea automática'
        const { error } = await admin.from('tasks').insert({
          text,
          level: a.level || 'normal',
          done: false,
          source: 'ai',
          assigned_to: a.assignTo || null,
          client_id: match.clientId || null,
          project_id: match.projectId || null,
          created_by: r.created_by || null,
          notes: `${AUTO_MARK}${markId}`,
        })
        // Un fallo persistente aquí (columna ausente, RLS) dejaba al motor sin
        // hacer nada para siempre y sin rastro: el cron seguía reportando "0
        // automatizaciones ejecutadas", indistinguible de no tener coincidencias.
        if (error) console.error(`[automations] insert de tarea falló (regla ${r.name}):`, error.message)
        if (!error) {
          existingMarks.add(markId)
          hechasEnEstaRegla++
          fired = true
          results.push({ ruleId: r.id, ruleName: r.name, action: 'create_task', detail: text })
          // Avisar al asignado. CON await, como las ramas notify_* de más abajo.
          //
          // Aquí el `.catch(()=>{})` suelto era peor que en el resto de sitios: la
          // marca de dedup ya está escrita —la tarea se insertó con
          // `notes: AUTO_MARK+markId` y arriba se hizo existingMarks.add(markId)—,
          // así que la siguiente ejecución del motor sale por el `continue` de la
          // línea 389 y NO reintenta nada. Con el envío sin esperar, en serverless
          // la instancia se congela con la consulta a `reglas`, el insert en
          // notification_log y las llamadas a FCM/APNs a medias: la tarea aparece
          // en el tablero y a su asignado no le avisa nadie, nunca.
          //
          // El fallo se registra en vez de tumbar la ejecución: la tarea ya existe
          // y las demás reglas del bucle deben seguir.
          if (a.assignTo && a.assignTo !== r.created_by) {
            try {
              await sendPushToUser(admin, a.assignTo, { title: `Tarea automática · ${r.name}`, body: text.slice(0, 120), url: '/dashboard', tag: `auto-${r.id}`, categoria: 'tarea' })
            } catch (err) {
              console.error(`[automations] el push al asignado falló (regla ${r.name}) y no se reintentará, la tarea ya está marcada:`, err)
            }
          }
        }
      } else if (a.type === 'notify_team' || a.type === 'notify_owner') {
        // Throttle, salvo para los eventos de ventana corta (proyecto_nuevo,
        // pieza_nueva). Su dedup real es `avisadas` (por clave, abajo): «cada uno
        // avisa UNA vez». El throttle de 6h solo estorbaba —con 5 piezas de golpe
        // salía 1 aviso y las otras 4 esperaban un hueco, y a las 24h la 5ª se
        // caía de la ventana de frescura sin avisar NUNCA, incumpliendo la
        // promesa—. Sin él, cada pasada horaria recoge la siguiente pieza nueva:
        // mismo volumen de push (1/ejecución/regla, por el break de abajo) pero
        // sin perder ninguna. Ver EVENTOS_VENTANA_CORTA.
        const last = r.last_triggered_at ? new Date(r.last_triggered_at).getTime() : 0
        if (!EVENTOS_VENTANA_CORTA.has(cfg.trigger.type) && now - last < NOTIFY_THROTTLE_MS) break
        // La CLAVE, no solo el reloj: de un evento puntual se avisa UNA vez.
        // `continue` y no `break` — el siguiente match puede ser un evento nuevo.
        if (!SOSTENIDOS.has(cfg.trigger.type) && avisadasSet.has(match.key)) continue
        const body = fillTemplate(a.message || '{asunto}', match.vars).slice(0, 160) || r.name
        const payload: PushPayload = { title: `⚡ ${r.name}`, body, url: '/dashboard', tag: `auto-${r.id}`, urgent: cfg.action.level === 'urgent', categoria: 'automatizacion' }
        // canSendPush como en colabsSync y gmail/sync. Sin él, el único freno era
        // `last_triggered_at`, cuyo UPDATE (abajo) no comprueba errores: si esa
        // escritura fallaba, la regla notificaba a los 7 del equipo 24 veces al día.
        // El cerrojo va ANTES de bifurcar: las dos ramas dependen del mismo
        // `last_triggered_at`, cuyo UPDATE (abajo) puede fallar. Aplicarlo solo a
        // notify_team dejaba a notify_owner con el aviso repetido en las 24
        // ejecuciones del día si esa escritura no cuajaba.
        if (!(await canSendPush(admin, `auto-${r.id}`))) break
        // El try/catch NO es decorativo: sendPushToAll/sendPushToUser ahora LANZAN
        // cuando no pueden leer las suscripciones (antes devolvían 0 en silencio,
        // que es justo lo que las hacía inútiles). Sin envolverlo, el fallo de un
        // solo aviso sale de `ejecutarReglas` y se lleva por delante el resto del
        // motor: las reglas que vienen detrás en el bucle no se evalúan siquiera.
        // Un aviso perdido es un aviso; el motor entero parado son todas las
        // automatizaciones del estudio.
        //
        // El aviso de esta vuelta se pierde: canSendPush ya escribió la ventana.
        // Queda en el log, que es la diferencia con antes.
        // `fired` se pone DENTRO del try, no despues.
        //
        // Estaba fuera, asi que un envio que fallaba —o un notify_owner con
        // created_by nulo, que ni llegaba a llamar a push— quedaba byte a byte
        // igual que uno correcto: «1 accion ejecutada», etiqueta EQUIPO AVISADO,
        // trigger_count +1, y el UPDATE de abajo bloqueando el reintento 6 horas.
        // O sea que el unico caso en el que hace falta reintentar era justamente el
        // que se marcaba como hecho.
        let enviado = false
        try {
          if (a.type === 'notify_team') {
            await sendPushToAll(admin, payload)
            enviado = true
          } else if (r.created_by) {
            await sendPushToUser(admin, r.created_by, payload)
            enviado = true
          } else {
            // notify_owner sin dueño: no hay a quién avisar. No es un fallo de red,
            // es una regla mal configurada, y callarlo la deja muda para siempre.
            console.error(`[automations] la regla "${r.name}" avisa al dueño pero no tiene created_by`)
          }
        } catch (err) {
          console.error(`[automations] el aviso de la regla "${r.name}" no se pudo enviar y se pierde:`, err)
        }
        if (!enviado) break   // sin throttle: que la siguiente vuelta lo reintente
        fired = true
        if (!SOSTENIDOS.has(cfg.trigger.type)) { avisadasSet.add(match.key); avisadaNueva = true }
        results.push({ ruleId: r.id, ruleName: r.name, action: a.type, detail: body })
        break // un aviso por ejecución basta
      }
    }

    if (fired) {
      // Este UPDATE es el throttle de las reglas de aviso. Si falla en silencio,
      // `last_triggered_at` se queda viejo y la regla vuelve a disparar en la
      // siguiente ejecución; canSendPush es la segunda red, pero el fallo debe
      // verse en los logs para poder arreglarlo.
      const { error: updErr } = await admin.from('reglas').update({
        trigger_count: (r.trigger_count || 0) + results.filter(x => x.ruleId === r.id).length,
        last_triggered_at: new Date().toISOString(),
        // Las últimas N claves avisadas, para no reavisar del mismo evento. Se
        // recorta por el final: las viejas ya salieron de la ventana del trigger.
        ...(avisadaNueva ? { description: AVISADAS_MARK + JSON.stringify([...avisadasSet].slice(-AVISADAS_MAX)) } : {}),
      }).eq('id', r.id)
      if (updErr) console.error(`[automations] no se pudo actualizar la regla ${r.name}:`, updErr.message)
    }
  }

  return { ran: results.length, results }
}
