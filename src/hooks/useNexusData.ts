'use client'
import { useState, useEffect, useCallback } from 'react'
import type { Client, Project, Task, InboxMessage, MemoriaEntry, ContentItem, Regla, ChatMessage, Profile } from '@/types'

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, opts)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export function useNexusData(profile: Profile | null) {
  const [clients, setClients] = useState<Client[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [inbox, setInbox] = useState<InboxMessage[]>([])
  const [memoria, setMemoria] = useState<MemoriaEntry[]>([])
  const [agenda, setAgenda] = useState<ContentItem[]>([])
  const [reglas, setReglas] = useState<Regla[]>([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [team, setTeam] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string } | null>(null)

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
    } finally {
      setLoading(false)
    }
  }, [profile])

  useEffect(() => { load() }, [load])

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
  const createClient = useCallback(async (client: Partial<Client>) => {
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
    clients, createClient, deleteClient,
    projects, createProject, updateProject, deleteProject,
    tasks, createTask, updateTask, deleteTask, toggleTask,
    inbox, markRead,
    memoria, createMemoria, deleteMemoria,
    agenda, createAgenda,
    reglas, createRegla, deleteRegla,
    chatMessages, sendChatMessage,
    team, reload: load,
  }
}
