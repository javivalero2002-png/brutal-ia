'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Client, Project, Task, InboxMessage, MemoriaEntry, ContentItem, Regla, ChatMessage, Profile } from '@/types'

// Estaba declarado aquí Y en src/types, byte a byte igual. Esa es exactamente la
// forma en que este proyecto se hace daño: se añade un campo a una copia, la otra
// se queda atrás y tsc no ve nada porque las dos son estructuralmente válidas.
import type { CalendarEvent } from '@/types'
export type { CalendarEvent }

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, opts)
  if (!res.ok) {
    // El cuerpo crudo acababa tal cual en un toast: el usuario llegaba a ver
    // errores de Postgres ("column ... does not exist") o HTML de una página de
    // error de Vercel. Se extrae el campo `error` del JSON cuando existe y se
    // acota la longitud; si no, un mensaje humano según el código.
    const raw = await res.text()
    let msg = ''
    try { msg = JSON.parse(raw)?.error || '' } catch {}
    if (!msg || msg.length > 160 || /<[a-z]/i.test(msg)) {
      msg = res.status === 429 ? 'Demasiadas solicitudes. Espera un momento.'
          : res.status === 401 ? 'Tu sesión ha caducado. Vuelve a entrar.'
          : res.status >= 500 ? 'El servidor ha fallado. Inténtalo de nuevo.'
          : 'No se pudo completar la operación.'
    }
    throw new Error(msg)
  }
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
      // `apply` NO pisa lo que ya hay si la consulta falló. Importa porque load()
      // se expone como reload() y se llama CON datos en pantalla (HoySection,
      // HarveySection): un 500 transitorio de /api/tasks vaciaba la lista delante
      // del usuario. Se considera fallo tanto un rechazo como un 200 que no
      // devuelve un array (p. ej. {error}), que si no se colaba como lista vacía.
      let failed = 0
      const apply = <T,>(n: number, setter: (v: T[]) => void) => {
        const r = res[n]
        if (r.status === 'fulfilled' && Array.isArray(r.value)) setter(r.value as T[])
        else failed++
      }
      apply(0, setClients); apply(1, setProjects); apply(2, setTasks); apply(3, setInbox)
      apply(4, setMemoria); apply(5, setAgenda); apply(6, setReglas); apply(7, setChatMessages)
      apply(8, setTeam)
      setLoadError(failed > 0)
      // El calendario va fuera del lote a propósito: es la consulta más lenta
      // (una llamada a Google por calendario conectado) y no debe retrasar el
      // resto del dashboard. Pero su fallo sí cuenta como carga parcial: antes
      // el .catch() lo tragaba y la franja ámbar nunca aparecía, así que un
      // calendario caído era indistinguible de una agenda vacía.
      apiFetch('/api/calendar/events').then((res: any) => {
        if (!aliveRef.current) return
        if (res?.__error === 'no_scope') { setCalendarScopeError(true); setCalendarEvents([]) }
        else { setCalendarScopeError(false); setCalendarEvents(Array.isArray(res) ? res : []) }
      }).catch(() => { if (aliveRef.current) setLoadError(true) })
    } finally {
      if (aliveRef.current) setLoading(false)
    }
    // Depende del ID, no del objeto `profile` entero.
    //
    // DashboardClient reconstruye ese objeto en cada onAuthStateChange —lo saca de
    // un `await resp.json()`— y Supabase dispara ese evento al refrescar el token y
    // al volver a la pestaña. Con el objeto como dependencia, cada uno de esos
    // eventos creaba un `load` nuevo, el efecto de abajo se volvia a ejecutar y se
    // recargaba el dashboard ENTERO: diez endpoints, incluido el que sale a Google
    // Calendar por cada miembro del equipo. Todo para volver a pintar exactamente
    // lo mismo, porque el perfil no habia cambiado: solo era otro objeto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

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

  // Dar de alta o de baja a alguien no refrescaba la lista: la persona nueva no
  // aparecia hasta recargar la pagina, asi que parecia que el alta no habia
  // funcionado —y mas de uno la repetiria—.
  const reloadTeam = useCallback(async () => {
    const nuevo = await apiFetch('/api/team')
    setTeam(nuevo)
    return nuevo
  }, [])

  const reloadInbox = useCallback(async () => {
    const newInbox = await apiFetch('/api/inbox')
    setInbox(newInbox)
    return newInbox
  }, [])

  // Devuelve el resultado en vez de solo setear estado: el llamante leía
  // `data.calendarScopeError` justo después del await, pero eso viene del closure
  // del render anterior — anunciaba SIEMPRE el estado previo, así que el aviso de
  // "reconecta Gmail" salía tarde o no salía.
  const reloadCalendar = useCallback(async (): Promise<{ ok: boolean; noScope: boolean }> => {
    try {
      const res = await apiFetch('/api/calendar/events')
      if (!aliveRef.current) return { ok: true, noScope: false }
      const noScope = res?.__error === 'no_scope'
      if (noScope) { setCalendarScopeError(true); setCalendarEvents([]) }
      else { setCalendarScopeError(false); setCalendarEvents(Array.isArray(res) ? res : []) }
      return { ok: true, noScope }
    } catch { return { ok: false, noScope: false } }
  }, [])

  const syncGmail = useCallback(async (): Promise<{synced:number;total:number;insertFailures?:number;saltado?:boolean}> => {
    if (!profile?.gmail_connected) throw new Error('Gmail no conectado')
    setSyncing(true)
    setSyncResult(null)
    try {
      const result = await apiFetch('/api/gmail/sync', { method: 'POST' })
      const newInbox = await apiFetch('/api/inbox')
      setInbox(newInbox)
      // `insertFailures` viene de /api/gmail/sync: emails que se analizaron con
      // Claude y luego NO se pudieron guardar. Sin mirarlo, "0 emails nuevos (20
      // revisados)" se lee como "no había nada" cuando en realidad no se guardó
      // nada — y el cron los reanaliza, y se vuelve a pagar, cada hora.
      // Otra instancia lo esta haciendo ahora mismo (el cerrojo de job_locks).
      // Decirlo, en vez de "0 emails nuevos (0 revisados)", que se lee como que
      // el buzon estaba vacio.
      if (result.saltado) {
        setSyncResult({ ok: true, message: 'Ya se estaba sincronizando — los mensajes llegan solos' })
        return result
      }
      const fallos = result.insertFailures ?? 0
      setSyncResult({
        ok: fallos === 0,
        message: fallos > 0
          ? `${result.total ?? 0} revisados, ${fallos} no se pudieron guardar`
          : `✓ ${result.synced ?? 0} emails nuevos (${result.total ?? 0} revisados)`,
      })
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

  // Una sola peticion en vez de una por tarea. "LIMPIAR COMPLETADAS" hacia un
  // Promise.all de N borrados: N invocaciones de Vercel repitiendo cada una la
  // sesion, el rol y el propietario.
  //
  // Devuelve cuantas cayeron DE VERDAD y solo quita del estado local si coinciden
  // con las enviadas. La ruta recorta la lista a 500 ids y, si quien llama no es
  // owner, filtra por created_by dentro del propio DELETE — por eso responde
  // `borradas`. Se ignoraba: con 620 completadas el boton decia "¿BORRAR 620?",
  // el servidor borraba 500, la pantalla las quitaba las 620 igual y las otras
  // 120 reaparecian al recargar sin que nadie hubiera avisado. Cuando el recuento
  // no cuadra se recarga —load() no pisa lo que hay si la consulta falla— y se
  // relanza para que el llamante pueda contarlo.
  const deleteTasks = useCallback(async (ids: string[]): Promise<number> => {
    if (!ids.length) return 0
    const res = await apiFetch('/api/tasks', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
    const borradas: number = typeof res?.borradas === 'number' ? res.borradas : 0
    if (borradas !== ids.length) {
      await load()
      throw new Error(`Se borraron ${borradas} de ${ids.length} — vuelve a intentarlo`)
    }
    const fuera = new Set(ids)
    setTasks(prev => prev.filter(t => !fuera.has(t.id)))
    return borradas
  }, [load])

  const toggleTask = useCallback(async (id: string) => {
    const task = tasks.find(t => t.id === id)
    if (!task) return
    const done = !task.done
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done } : t))
    try {
      await apiFetch(`/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done }) })
    } catch (err) {
      setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !done } : t))
      // Se RELANZA despues de deshacer. Antes se tragaba aqui, asi que el
      // `.catch()` de quien llamaba no se ejecutaba nunca y no habia forma de
      // avisar: con la sesion caducada pulsabas "marcar como hecha", la tarea
      // desaparecia un instante, volvia, y nadie decia por que.
      throw err
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
  // Devuelve false si el borrado en servidor falló, para que la UI no mienta.
  // El vaciado local va DESPUÉS del DELETE: si se hace antes y la petición falla,
  // el usuario cree que borró y la conversación reaparece al recargar.
  const clearChat = useCallback(async (): Promise<boolean> => {
    try {
      await apiFetch('/api/chat/history', { method: 'DELETE' })
      setChatMessages([])
      return true
    } catch { return false }
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

  // Devuelve las columnas que el servidor NO ha llegado a escribir. El PATCH
  // responde 200 aunque haya tenido que reintentar sin las que faltan en la BD
  // (account_name, video_url, feedback, cover_url) y las lista en `__dropped`;
  // nadie lo leia, asi que la UI cantaba "Guardado" y ademas dejaba fijados en
  // pantalla valores que no estaban en ninguna parte. `__dropped` no es una
  // columna de la pieza: se separa antes de meter la fila en el estado.
  const updateAgenda = useCallback(async (id: string, updates: Partial<ContentItem>): Promise<string[]> => {
    const { __dropped, ...fila } = await apiFetch(`/api/agenda/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
    setAgenda(prev => prev.map(a => a.id === id ? (fila as ContentItem) : a))
    return Array.isArray(__dropped) ? __dropped : []
  }, [])

  /**
   * Mete en la lista una fila que YA ha escrito el servidor. No hace PATCH.
   *
   * Existe por la subida de portada: `upload-cover` guarda el identificador y
   * devuelve la fila entera ya firmada. Lo que se hacía antes era llamar a
   * `updateAgenda` con la URL FIRMADA para refrescar la rejilla — y eso manda un
   * PATCH que sustituye el identificador de la base por una firma con token.
   */
  const aplicarAgendaLocal = useCallback((fila: ContentItem) => {
    setAgenda(prev => prev.map(a => a.id === fila.id ? fila : a))
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
  const runAutomations = useCallback(async (): Promise<{ ran: number; results: Array<{ ruleName: string; action: string; detail: string }>; skipped?: boolean }> => {
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
    tasks, createTask, updateTask, deleteTask, deleteTasks, toggleTask,
    inbox, markRead, markManyRead, markUnread, sendInternalMessage, reloadInbox,
    memoria, createMemoria, updateMemoria, deleteMemoria,
    agenda, createAgenda, updateAgenda, deleteAgenda, aplicarAgendaLocal,
    reglas, createRegla, updateRegla, deleteRegla, runAutomations,
    chatMessages, sendChatMessage, clearChat,
    team, reloadTeam, calendarEvents, calendarScopeError, reloadCalendar, reload: load,
    // loadError se calculaba y NO se devolvía: era estado muerto. Sin él, un 500
    // en /api/tasks dejaba la app con la sección vacía y CERO señal — y el cambio
    // a allSettled borró el último rastro (antes el rechazo salía en consola).
    loadError,
  }
}
