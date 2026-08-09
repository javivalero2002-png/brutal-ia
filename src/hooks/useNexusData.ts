'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Client, Project, Task, InboxMessage, MemoriaEntry, ContentItem, Regla, ChatMessage, Profile } from '@/types'

export interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
  location?: string
  description?: string
  colorId?: string
  htmlLink?: string
  hangoutLink?: string
}

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, opts)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export function useNexusData(profile: Profile | null, onNewInboxMessage?: (msg: InboxMessage) => void) {
  const onNewInboxRef = useRef(onNewInboxMessage)
  onNewInboxRef.current = onNewInboxMessage
  const [clients, setClients] = useState<Client[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [inbox, setInbox] = useState<InboxMessage[]>([])
  const [memoria, setMemoria] = useState<MemoriaEntry[]>([])
  const [agenda, setAgenda] = useState<ContentItem[]>([])
  const [reglas, setReglas] = useState<Regla[]>([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [team, setTeam] = useState<Profile[]>([])
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const [calendarScopeError, setCalendarScopeError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string } | null>(null)
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current

  const aliveRef = useRef(true)
  // Re-armar en el setup, no solo apagar en el cleanup: en StrictMode el ciclo
  // setup→cleanup→setup dejaba aliveRef en false para siempre, y a partir de ahí
  // load() nunca commiteaba resultados.
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false } }, [])

  // IDs de mensajes ya notificados: evita que el dueño de la cuenta colabs reciba el
  // aviso dos veces cuando un email compartido dispara ambas suscripciones realtime
  // (user_id=own y shared=true) para el mismo mensaje.
  const notifiedIdsRef = useRef<Set<string>>(new Set())
  const notifyOnce = useCallback((msg: InboxMessage) => {
    if (notifiedIdsRef.current.has(msg.id)) return
    notifiedIdsRef.current.add(msg.id)
    onNewInboxRef.current?.(msg)
  }, [])

  const load = useCallback(async () => {
    if (!profile) return
    try {
      // allSettled en vez de all: antes, un solo endpoint devolviendo 500 rechazaba
      // el Promise.all, no se seteaba NADA, el finally apagaba loading y el usuario
      // veía un dashboard vacío indistinguible de una cuenta nueva. Ahora cada
      // sección falla por separado y loadError permite avisar.
      // /api/team va dentro del lote: estaba después del await, así que añadía una
      // etapa serial entera al arranque solo para traer 5 perfiles.
      const res = await Promise.allSettled([
        apiFetch('/api/clients'),
        apiFetch('/api/projects'),
        apiFetch('/api/tasks'),
        apiFetch('/api/inbox'),
        apiFetch('/api/memoria'),
        apiFetch('/api/agenda'),
        apiFetch('/api/reglas'),
        apiFetch('/api/chat/history'),
        apiFetch('/api/team'),
      ])
      if (!aliveRef.current) return
      const list = (n: number) => {
        const r = res[n]
        return r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []
      }
      setLoadError(res.some(r => r.status === 'rejected'))
      setClients(list(0)); setProjects(list(1)); setTasks(list(2)); setInbox(list(3))
      setMemoria(list(4)); setAgenda(list(5)); setReglas(list(6)); setChatMessages(list(7))
      setTeam(list(8))
      apiFetch('/api/calendar/events').then((res: any) => {
        if (!aliveRef.current) return
        if (res?.__error === 'no_scope') { setCalendarScopeError(true); setCalendarEvents([]) }
        else { setCalendarScopeError(false); setCalendarEvents(Array.isArray(res) ? res : []) }
      }).catch(()=>{})
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [profile])

  useEffect(() => { load() }, [load])

  // Supabase Realtime — own inbox messages
  useEffect(() => {
    if (!profile) return
    const channel = supabase
      .channel(`inbox-own-${profile.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'inbox_messages',
        filter: `user_id=eq.${profile.id}`,
      }, (payload) => {
        const msg = payload.new as InboxMessage
        setInbox(prev => {
          if (prev.some(m => m.id === msg.id)) return prev
          return [msg, ...prev]
        })
        notifyOnce(msg)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  // Supabase Realtime — shared colabs emails (visible to all team members)
  useEffect(() => {
    if (!profile) return
    const sharedChannel = supabase
      .channel(`inbox-shared-${profile.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'inbox_messages',
        filter: `shared=eq.true`,
      }, (payload) => {
        const msg = payload.new as InboxMessage
        setInbox(prev => {
          if (prev.some(m => m.id === msg.id)) return prev
          return [msg, ...prev]
        })
        notifyOnce(msg)
      })
      .subscribe()
    return () => { supabase.removeChannel(sharedChannel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  const reloadInbox = useCallback(async () => {
    const newInbox = await apiFetch('/api/inbox')
    setInbox(newInbox)
    return newInbox
  }, [])

  const reloadCalendar = useCallback(async () => {
    try {
      const res = await apiFetch('/api/calendar/events')
      if (!aliveRef.current) return
      if (res?.__error === 'no_scope') { setCalendarScopeError(true); setCalendarEvents([]) }
      else { setCalendarScopeError(false); setCalendarEvents(Array.isArray(res) ? res : []) }
    } catch {}
  }, [])

  const syncGmail = useCallback(async (): Promise<{synced:number;total:number}> => {
    if (!profile?.gmail_connected) throw new Error('Gmail no conectado')
    setSyncing(true)
    setSyncResult(null)
    try {
      const result = await apiFetch('/api/gmail/sync', { method: 'POST' })
      const newInbox = await apiFetch('/api/inbox')
      setInbox(newInbox)
      setSyncResult({ ok: true, message: `✓ ${result.synced ?? 0} emails nuevos (${result.total ?? 0} revisados)` })
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setSyncResult({ ok: false, message: `Error: ${msg.slice(0, 200)}` })
      throw err
    } finally {
      setSyncing(false)
    }
  }, [profile])

  // ── TASKS ──────────────────────────────────────────────────
  const createTask = useCallback(async (task: Partial<Task>) => {
    const created = await apiFetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(task) })
    setTasks(prev => [created, ...prev])
    return created
  }, [])

  const updateTask = useCallback(async (id: string, updates: Partial<Task>) => {
    const updated = await apiFetch(`/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
    setTasks(prev => prev.map(t => t.id === id ? updated : t))
  }, [])

  const deleteTask = useCallback(async (id: string) => {
    await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' })
    setTasks(prev => prev.filter(t => t.id !== id))
  }, [])

  const toggleTask = useCallback(async (id: string) => {
    const task = tasks.find(t => t.id === id)
    if (!task) return
    const done = !task.done
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done } : t))
    try {
      await apiFetch(`/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done }) })
    } catch {
      setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !done } : t))
    }
  }, [tasks])

  // ── CLIENTS ────────────────────────────────────────────────
  const createClientRecord = useCallback(async (client: Partial<Client>) => {
    const created = await apiFetch('/api/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(client) })
    setClients(prev => [...prev, created])
    return created
  }, [])

  const updateClientRecord = useCallback(async (id: string, updates: Partial<Client>) => {
    const updated = await apiFetch(`/api/clients/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
    setClients(prev => prev.map(c => c.id === id ? updated : c))
  }, [])

  const deleteClient = useCallback(async (id: string) => {
    await apiFetch(`/api/clients/${id}`, { method: 'DELETE' })
    setClients(prev => prev.filter(c => c.id !== id))
  }, [])

  // ── PROJECTS ───────────────────────────────────────────────
  const createProject = useCallback(async (project: Partial<Project>) => {
    const created = await apiFetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project) })
    setProjects(prev => [created, ...prev])
    return created
  }, [])

  const updateProject = useCallback(async (id: string, updates: Partial<Project>) => {
    const updated = await apiFetch(`/api/projects/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
    setProjects(prev => prev.map(p => p.id === id ? updated : p))
  }, [])

  const deleteProject = useCallback(async (id: string) => {
    await apiFetch(`/api/projects/${id}`, { method: 'DELETE' })
    setProjects(prev => prev.filter(p => p.id !== id))
  }, [])

  // ── INBOX ──────────────────────────────────────────────────
  const markRead = useCallback(async (id: string) => {
    await apiFetch('/api/inbox', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, is_read: true }) })
    setInbox(prev => prev.map(m => m.id === id ? { ...m, is_read: true, is_unread: false } : m))
  }, [])

  // Marca varios mensajes de una vez (una sola petición, no N)
  const markManyRead = useCallback(async (ids: string[]) => {
    if (!ids.length) return
    setInbox(prev => prev.map(m => ids.includes(m.id) ? { ...m, is_read: true, is_unread: false } : m))
    try {
      await apiFetch('/api/inbox', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, is_read: true }) })
    } catch {
      // Si falla, recargamos para no dejar el estado local mintiendo
      try { const fresh = await apiFetch('/api/inbox'); if (aliveRef.current) setInbox(fresh) } catch {}
    }
  }, [])

  const markUnread = useCallback(async (id: string) => {
    await apiFetch('/api/inbox', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, is_read: false }) })
    setInbox(prev => prev.map(m => m.id === id ? { ...m, is_read: false, is_unread: true } : m))
  }, [])

  const sendInternalMessage = useCallback(async (toUserId: string, subject: string, body: string, fromName: string) => {
    await apiFetch('/api/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to_user_id: toUserId, subject, body, from_name: fromName }) })
  }, [])

  // ── CHAT ───────────────────────────────────────────────────
  const sendChatMessage = useCallback(async (message: string): Promise<string> => {
    const tempId = crypto.randomUUID()
    setChatMessages(prev => [...prev, { id: tempId, role: 'user', content: message, created_at: new Date().toISOString() }])
    try {
      const { reply, searched } = await apiFetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) })
      setChatMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'ai', content: reply, created_at: new Date().toISOString(), searched: !!searched }])
      return reply
    } catch (err) {
      setChatMessages(prev => prev.filter(m => m.id !== tempId))
      throw err
    }
  }, [])

  // Borra también en servidor: antes solo vaciaba el estado local, así que el botón
  // "BORRAR" no borraba nada y la conversación reaparecía al recargar.
  const clearChat = useCallback(async () => {
    setChatMessages([])
    try { await apiFetch('/api/chat/history', { method: 'DELETE' }) } catch {}
  }, [])

  // ── MEMORIA ────────────────────────────────────────────────
  const createMemoria = useCallback(async (entry: Partial<MemoriaEntry>) => {
    const created = await apiFetch('/api/memoria', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) })
    setMemoria(prev => [created, ...prev])
  }, [])

  const updateMemoria = useCallback(async (id: string, updates: Partial<MemoriaEntry>) => {
    const updated = await apiFetch(`/api/memoria/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
    setMemoria(prev => prev.map(m => m.id === id ? updated : m))
  }, [])

  const deleteMemoria = useCallback(async (id: string) => {
    await apiFetch(`/api/memoria/${id}`, { method: 'DELETE' })
    setMemoria(prev => prev.filter(m => m.id !== id))
  }, [])

  // ── AGENDA ─────────────────────────────────────────────────
  const createAgenda = useCallback(async (item: Partial<ContentItem>) => {
    const created = await apiFetch('/api/agenda', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) })
    setAgenda(prev => [...prev, created])
  }, [])

  const updateAgenda = useCallback(async (id: string, updates: Partial<ContentItem>) => {
    const updated = await apiFetch(`/api/agenda/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
    setAgenda(prev => prev.map(a => a.id === id ? updated : a))
  }, [])

  const deleteAgenda = useCallback(async (id: string) => {
    await apiFetch(`/api/agenda/${id}`, { method: 'DELETE' })
    setAgenda(prev => prev.filter(a => a.id !== id))
  }, [])

  // ── REGLAS ─────────────────────────────────────────────────
  const createRegla = useCallback(async (regla: Partial<Regla>) => {
    const created = await apiFetch('/api/reglas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(regla) })
    setReglas(prev => [...prev, created])
  }, [])

  const updateRegla = useCallback(async (id: string, updates: Partial<Regla>) => {
    const updated = await apiFetch(`/api/reglas/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
    setReglas(prev => prev.map(r => r.id === id ? updated : r))
  }, [])

  const deleteRegla = useCallback(async (id: string) => {
    await apiFetch(`/api/reglas/${id}`, { method: 'DELETE' })
    setReglas(prev => prev.filter(r => r.id !== id))
  }, [])

  // Ejecuta el motor de automatizaciones ahora y refresca lo que pueda haber
  // cambiado (tareas creadas + contador/última ejecución de las reglas).
  const runAutomations = useCallback(async (): Promise<{ ran: number; results: Array<{ ruleName: string; action: string; detail: string }> }> => {
    const res = await apiFetch('/api/automations/run', { method: 'POST' })
    try {
      const [t, r] = await Promise.all([apiFetch('/api/tasks'), apiFetch('/api/reglas')])
      if (aliveRef.current) { setTasks(t); setReglas(r) }
    } catch {}
    return res
  }, [])

  return {
    loading, syncing, syncGmail, syncResult,
    clients, createClient: createClientRecord, updateClient: updateClientRecord, deleteClient,
    projects, createProject, updateProject, deleteProject,
    tasks, createTask, updateTask, deleteTask, toggleTask,
    inbox, markRead, markManyRead, markUnread, sendInternalMessage, reloadInbox,
    memoria, createMemoria, updateMemoria, deleteMemoria,
    agenda, createAgenda, updateAgenda, deleteAgenda,
    reglas, createRegla, updateRegla, deleteRegla, runAutomations,
    chatMessages, sendChatMessage, clearChat,
    team, calendarEvents, calendarScopeError, reloadCalendar, reload: load,
  }
}
