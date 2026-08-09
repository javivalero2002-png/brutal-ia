import type { SupabaseClient } from '@supabase/supabase-js'
import { sendPushToAll, sendPushToUser } from '@/lib/push'

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

export const AUTO_MARK = '⚙ auto:'
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
    : t.type === 'unread_pileup'          ? `${t.threshold ?? 10}+ emails sin leer`
    : t.type === 'many_overdue'           ? `${t.threshold ?? 5}+ tareas vencidas`
    : t.type === 'high_priority_unassigned' ? 'Tareas urgentes sin responsable'
    : t.type === 'client_followup'        ? `Sin emails de ${t.clientName || clientName || 'cliente'} en ${t.days ?? 14} días`
    : 'Condición'
  const act =
    a.type === 'create_task'  ? `Crear tarea${a.level && a.level !== 'normal' ? ` (${a.level === 'urgent' ? 'urgente' : 'alta'})` : ''}`
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
function parseDeadline(raw?: string | null): Date | null {
  if (!raw) return null
  const s = raw.trim().toLowerCase()
  if (!s || s === 'tbd' || s === '—' || s === '-') return null
  if (s === 'hoy') return new Date()
  if (s === 'mañana') { const d = new Date(); d.setDate(d.getDate() + 1); return d }
  // dd mmm yyyy  |  mmm yyyy
  const m = s.match(/(\d{1,2})?\s*([a-záéíóú]{3,})\.?\s*(\d{4})?/)
  if (m) {
    const mesKey = (m[2] || '').slice(0, 3)
    if (mesKey in MESES) {
      const day = m[1] ? parseInt(m[1], 10) : 1
      const year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear()
      return new Date(year, MESES[mesKey], day)
    }
  }
  const iso = Date.parse(raw)
  return isNaN(iso) ? null : new Date(iso)
}

function daysUntil(d: Date): number {
  return Math.floor((d.getTime() - Date.now()) / 86400000)
}

interface Match { key: string; vars: Record<string, string>; clientId?: string; projectId?: string }

// ── Evaluación de disparadores ───────────────────────────────────────────────
function evaluateTrigger(cfg: RuleConfig, ctx: {
  inbox: any[]; tasks: any[]; projects: any[]; clients: any[]
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
      const d = parseDeadline(p.deadline)
      if (!d) continue
      const du = daysUntil(d)
      if (du < 0 || du > within) continue
      const cli = ctx.clients.find(c => c.id === p.client_id)
      out.push({ key: `proj:${p.id}:${d.toISOString().slice(0, 10)}`, projectId: p.id, clientId: p.client_id, vars: {
        proyecto: p.name, cliente: cli?.name || '', dias: String(du),
      } })
    }
  } else if (t.type === 'task_overdue') {
    const grace = t.days ?? 0
    for (const tk of ctx.tasks) {
      if (tk.done || !tk.due_date) continue
      const d = parseDeadline(tk.due_date)
      if (!d) continue
      if (daysUntil(d) > -grace - 0.01) continue // ya vencida (con gracia opcional)
      out.push({ key: `taskdue:${tk.id}`, projectId: tk.project_id, clientId: tk.client_id, vars: {
        tarea: tk.text || '', asunto: tk.text || '',
      } })
    }
  } else if (t.type === 'unread_pileup') {
    const threshold = t.threshold ?? 10
    const unread = ctx.inbox.filter(m => !m.is_read).length
    if (unread >= threshold) {
      out.push({ key: `pileup:${new Date().toISOString().slice(0, 10)}`, vars: { total: String(unread) } })
    }
  } else if (t.type === 'many_overdue') {
    const threshold = t.threshold ?? 5
    const overdueList = ctx.tasks.filter(tk => {
      if (tk.done || !tk.due_date) return false
      const d = parseDeadline(tk.due_date)
      return d ? daysUntil(d) < 0 : false
    })
    if (overdueList.length >= threshold) {
      out.push({ key: `many_overdue:${new Date().toISOString().slice(0, 10)}`, vars: { total: String(overdueList.length) } })
    }
  } else if (t.type === 'high_priority_unassigned') {
    for (const tk of ctx.tasks) {
      if (tk.done || tk.assigned_to) continue
      if (tk.level !== 'urgent' && tk.level !== 'high') continue
      out.push({ key: `unassigned:${tk.id}`, projectId: tk.project_id, clientId: tk.client_id, vars: {
        tarea: tk.text || '', asunto: tk.text || '',
      } })
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
      if (mostRecent < cutoff) {
        const daysSince = mostRecent > 0 ? Math.floor((Date.now() - mostRecent) / 86400000) : days
        out.push({
          key: `followup:${cli.id}:${new Date().toISOString().slice(0, 10)}`,
          clientId: cli.id,
          vars: { cliente: cli.name, dias: String(daysSince) },
        })
      }
    }
  }

  return out.slice(0, MAX_MATCHES_PER_RULE)
}

// ── Ejecución ────────────────────────────────────────────────────────────────
export async function runAutomations(admin: SupabaseClient): Promise<{ ran: number; results: AutomationResult[] }> {
  const results: AutomationResult[] = []

  // Reglas activas (excluye las filas de suscripción push)
  const { data: rules } = await admin
    .from('reglas')
    .select('id,name,condition_text,action_text,active,trigger_count,last_triggered_at,created_by')
    .eq('active', true)
    .neq('name', '__push_subscription__')

  const structured = (rules || [])
    .map(r => ({ r, cfg: parseRuleConfig(r.condition_text) }))
    .filter((x): x is { r: any; cfg: RuleConfig } => !!x.cfg)

  if (structured.length === 0) return { ran: 0, results }

  // Snapshot de datos (una sola vez)
  const [{ data: inbox }, { data: tasks }, { data: projects }, { data: clients }] = await Promise.all([
    admin.from('inbox_messages').select('id,subject,from_name,from_email,ai_client,ai_urgency,is_read,received_at').order('received_at', { ascending: false }).limit(200),
    admin.from('tasks').select('id,text,done,due_date,project_id,client_id,notes'),
    admin.from('projects').select('id,name,status,deadline,client_id'),
    admin.from('clients').select('id,name'),
  ])
  const ctx = { inbox: inbox || [], tasks: tasks || [], projects: projects || [], clients: clients || [] }

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
    const matches = evaluateTrigger(cfg, ctx)
    if (matches.length === 0) continue

    for (const match of matches) {
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
        if (!error) {
          existingMarks.add(markId)
          fired = true
          results.push({ ruleId: r.id, ruleName: r.name, action: 'create_task', detail: text })
          // Avisar al asignado
          if (a.assignTo && a.assignTo !== r.created_by) {
            sendPushToUser(admin, a.assignTo, { title: `Tarea automática · ${r.name}`, body: text.slice(0, 120), url: '/dashboard', tag: `auto-${r.id}` }).catch(() => {})
          }
        }
      } else if (a.type === 'notify_team' || a.type === 'notify_owner') {
        // Throttle: no repetir el aviso de esta regla dentro de la ventana
        const last = r.last_triggered_at ? new Date(r.last_triggered_at).getTime() : 0
        if (now - last < NOTIFY_THROTTLE_MS) break
        const body = fillTemplate(a.message || '{asunto}', match.vars).slice(0, 160) || r.name
        const payload = { title: `⚡ ${r.name}`, body, url: '/dashboard', tag: `auto-${r.id}`, urgent: cfg.action.level === 'urgent' }
        if (a.type === 'notify_team') await sendPushToAll(admin, payload)
        else if (r.created_by) await sendPushToUser(admin, r.created_by, payload)
        fired = true
        results.push({ ruleId: r.id, ruleName: r.name, action: a.type, detail: body })
        break // un aviso por ejecución basta
      }
    }

    if (fired) {
      await admin.from('reglas').update({
        trigger_count: (r.trigger_count || 0) + results.filter(x => x.ruleId === r.id).length,
        last_triggered_at: new Date().toISOString(),
      }).eq('id', r.id)
    }
  }

  return { ran: results.length, results }
}
