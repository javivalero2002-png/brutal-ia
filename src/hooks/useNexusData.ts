'use client'
import { useState, useEffect, useCallback } from 'react'
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
}

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, opts)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export function useNexusData(profile: Profile | null, onNewInboxMessage?: (msg: InboxMessage) => void) {
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
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string } | null>(null)
  const supabase = createClient()

  const load = useCallback(async () => {
    if (!profile) return
    try {
      const [c, p, t, i, m, a, r, ch] = await Promise.all([
        apiFetch('/api/clients'),
        apiFetch('/api/projects'),
        apiFetch('/api/tasks'),
        apiFetch('/api/inbox'),
        apiFetch('/api/memoria'),
        apiFetch('/api/agenda'),
        apiFetch('/api/reglas'),
        apiFetch('/api/chat/history'),
      ])
      setClients(c); setProjects(p); setTasks(t); setInbox(i)
      setMemoria(m); setAgenda(a); setReglas(r); setChatMessages(ch)
      const teamData = await apiFetch('/api/team')
      setTeam(teamData)
      // Load calendar events (non-blocking)
      apiFetch('/api/calendar/events').then(setCalendarEvents).catch(()=>{})
    } finally {
      setLoading(false)
    }
  }, [profile])

  useEffect(() => { load() }, [load])

  // Supabase Realtime — inbox
  useEffect(() => {
    if (!profile) return
    const channel = supabase
      .channel(`inbox-${profile.id}`)
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
        if (onNewInboxMessage) onNewInboxMessage(msg)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  const syncGmail = useCallback(async () => {
    if (!profile?.gmail_connected) return
    setSyncing(true)
    setSyncResult(null)
    try {
      const result = await apiFetch('/api/gmail/sync', { method: 'POST' })
      const newInbox = await apiFetch('/api/inbox')
      setInbox(newInbox)
      setSyncResult({ ok: true, message: `✓ ${result.synced ?? 0} emails nuevos (${result.total ?? 0} revisados)` })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setSyncResult({ ok: false, message: `Error: ${msg.slice(0, 200)}` })
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
    await updateTask(id, { done: !task.done })
  }, [tasks, updateTask])

  // ── CLIENTS ────────────────────────────────────────────────
  const createClientRecord = useCallback(async (client: Partial<Client>) => {
    const created = await apiFetch('/api/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(client) })
    setClients(prev => [...prev, created])
    return created
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

  const sendInternalMessage = useCallback(async (toUserId: string, subject: string, body: string, fromName: string) => {
    await apiFetch('/api/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to_user_id: toUserId, subject, body, from_name: fromName }) })
  }, [])

  // ── CHAT ───────────────────────────────────────────────────
  const sendChatMessage = useCallback(async (message: string): Promise<string> => {
    const tempId = crypto.randomUUID()
    setChatMessages(prev => [...prev, { id: tempId, role: 'user', content: message, created_at: new Date().toISOString() }])
    const { reply } = await apiFetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) })
    setChatMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'ai', content: reply, created_at: new Date().toISOString() }])
    return reply
  }, [])

  // ── MEMORIA ────────────────────────────────────────────────
  const createMemoria = useCallback(async (entry: Partial<MemoriaEntry>) => {
    const created = await apiFetch('/api/memoria', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) })
    setMemoria(prev => [created, ...prev])
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

  const deleteRegla = useCallback(async (id: string) => {
    await apiFetch(`/api/reglas/${id}`, { method: 'DELETE' })
    setReglas(prev => prev.filter(r => r.id !== id))
  }, [])

  return {
    loading, syncing, syncGmail, syncResult,
    clients, createClient: createClientRecord, deleteClient,
    projects, createProject, updateProject, deleteProject,
    tasks, createTask, updateTask, deleteTask, toggleTask,
    inbox, markRead, sendInternalMessage,
    memoria, createMemoria, deleteMemoria,
    agenda, createAgenda, updateAgenda, deleteAgenda,
    reglas, createRegla, deleteRegla,
    chatMessages, sendChatMessage,
    team, calendarEvents, reload: load,
  }
}
