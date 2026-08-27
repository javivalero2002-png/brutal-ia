'use client'

import { useState, useRef, useEffect } from 'react'
import { mesCargado } from '@/lib/ventanaCalendario'
import { hayModalAbierto } from '@/components/shared/modalAbierto'
import type { NexusData } from '@/types'
import { PLATAFORMA_COLOR, useIsMobile, BLU, RED, GRN, SURFACE, SURF2, BORDER, LucideIcon, SafeImg, dlDate, AMBAR, NIVEL_TAREA, rotuloNivel, nivelTarea } from '@/components/shared'
// `plural` no se reexporta desde el índice de shared: se importa del módulo.
import { plural, todayKey as claveDeHoyMadrid, localDayKey } from '@/components/shared/helpers'
import { PlatformLogo } from '@/components/PlatformLogo'

interface PropsCalendario {
  data: NexusData
  profile: any
  showToast: any
  onOpenModal: any
}

function CalendarioSection({data, profile, showToast, onOpenModal}: PropsCalendario) {
  const isMobile = useIsMobile()
  // EL DÍA DE MADRID, no el del portátil.
  //
  // Aquí ponía `new Date()` y la clave de cada casilla salía de `getDate()`, que
  // devuelve el día de quien ejecuta. Desde un rodaje fuera de España —o con la
  // zona del portátil mal puesta— el recuadro de HOY cae en una casilla y las
  // tareas de hoy en la de al lado. Es exactamente la trampa que CLAUDE.md manda
  // no repetir, y estaba aquí.
  //
  // Se construye una fecha LOCAL con los números del día de Madrid: así toda la
  // aritmética de abajo (`getDate() + 1`, la semana, los próximos 14 días) sigue
  // funcionando igual y queda anclada a Madrid.
  const claveHoy = claveDeHoyMadrid()
  const today = (() => { const [a, m, d] = claveHoy.split('-').map(Number); return new Date(a, m - 1, d) })()
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [selectedDay, setSelectedDay] = useState<Date|null>(today)
  // Ya nace en 'mes' —es el defecto— así que aquí no había parpadeo. El efecto de
  // abajo se queda para cuando se GIRA la pantalla estando en vista semana.
  const [calView, setCalView] = useState<'mes'|'semana'>('mes')
  /**
   * ¿Las tareas de todo el equipo, o solo las mías?
   *
   * Javi: «en el apartado calendario solo se deberían ver las tareas que tiene uno
   * propio, no la de los demás. Si quieres ver la de los demás, ya lo ves en
   * tareas». Tiene razón para el uso normal: este calendario es MI agenda —mis
   * tareas, mis reuniones, lo que se publica—, y un mes con las tareas de siete
   * personas encima no se lee.
   *
   * Con interruptor y no a secas porque la otra pregunta —«¿cómo va la semana del
   * estudio?»— también se hace, y sin esto habría que irse a Tareas y reconstruir
   * el mes a mano. Arranca en «solo las mías», que es el caso de todos los días.
   */
  const [tareasDeTodos, setTareasDeTodos] = useState(false)
  const [syncingCal, setSyncingCal] = useState(false)
  const [calEvents, setCalEvents] = useState<any[]>(data.calendarEvents || [])
  // Alta rápida de evento en Google Calendar (usa POST /api/calendar/events)
  const [eventForm, setEventForm] = useState<null | { title: string; date: string; time: string; guests: string; desc: string }>(null)
  const [evSaving, setEvSaving] = useState(false)
  const [editEvent, setEditEvent] = useState<null|{id:string;title:string;date:string;time:string;calendarId?:string;cuenta?:string}>(null)
  const [editSaving, setEditSaving] = useState(false)
  // Dos estados, no uno: `deletingEventId` hacía a la vez de «confirmación
  // armada» y de «petición en vuelo», y como el valor no cambiaba al arrancar el
  // DELETE el botón seguía diciendo «¿BORRAR?» y seguía habilitado durante toda
  // la llamada a Google. Un segundo clic mandaba un segundo DELETE: el primero
  // borraba el evento y el segundo recibía el 410 de Google, que la ruta traduce
  // a 500 — «Error eliminando evento» sobre un evento que sí se había borrado.
  const [confirmEventId, setConfirmEventId] = useState<string|null>(null)
  const [deletingEventId, setDeletingEventId] = useState<string|null>(null)

  // Sync local state when the parent data hook loads calendar events asynchronously
  useEffect(() => {
    if (Array.isArray(data.calendarEvents)) setCalEvents(data.calendarEvents)
  }, [data.calendarEvents])

  // Forzar vista mes en móvil (semana no cabe en pantalla pequeña)
  useEffect(() => {
    if (isMobile) setCalView('mes')
  }, [isMobile])

  const syncCalendar = async () => {
    setSyncingCal(true)
    try {
      if (data.reloadCalendar) {
        // Se usa lo que DEVUELVE la llamada, no data.calendarScopeError: ese venía
        // del closure del render anterior y anunciaba el estado previo.
        const r = await data.reloadCalendar()
        if (r?.noScope) showToast('Sin permisos de calendario — reconecta Gmail Personal')
        else if (r?.ok === false) showToast('No se pudo sincronizar el calendario')
        else showToast('Calendario sincronizado')
      } else {
        const rEv = await fetch('/api/calendar/events')
        const res = await rEv.json()
        if (res?.__error === 'no_scope') { showToast('Sin permisos de calendario — reconecta Gmail Personal'); return }
        // Sin esto el mensaje era "0 eventos de Google Calendar": suena a que no
        // tienes ninguno, no a que no se pudieron leer.
        if (!rEv.ok) { showToast(res?.error || 'No se pudieron leer los eventos de Google Calendar'); return }
        const events = Array.isArray(res) ? res : []
        setCalEvents(events)
        showToast(`${plural(events.length, 'evento')} de Google Calendar`)
      }
    } catch { showToast('Error sincronizando calendario') }
    finally { setSyncingCal(false) }
  }

  const openEventForm = (dateKey?: string) => {
    if (!profile?.gmail_connected) { showToast('Conecta Gmail en Operativa → Sincronización para crear eventos'); return }
    setEventForm({ title: '', date: dateKey || toKey(selectedDay || today), time: '', guests: '', desc: '' })
  }

  // El calendario del evento viaja con él. Editar y borrar iban SIEMPRE contra
  // 'primary', así que cualquier evento de otro calendario —los que se listan
  // desde que la sincronización lee todos— daba 404 con los botones a la vista.
  const deleteEvent = async (eventId: string, calendarId?: string, cuenta?: string) => {
    // Cinturón además del `disabled` del botón: el teclado (Enter mantenido) y un
    // doble toque en móvil se cuelan antes de que React repinte.
    if (deletingEventId) return
    setDeletingEventId(eventId)
    try {
      const res = await fetch(`/api/calendar/events/${eventId}?calendarId=${encodeURIComponent(calendarId || 'primary')}&cuenta=${encodeURIComponent(cuenta || '')}`, { method: 'DELETE' })
      if (!res.ok) { showToast('Error eliminando evento'); return }
      setConfirmEventId(null)
      setCalEvents(prev => prev.filter(e => e.id !== eventId))
      // Tambien hay que refrescar el calendario del HOOK, no solo `calEvents`.
      // El resto de la app —Hoy, Harvey, el briefing— lee data.calendarEvents:
      // borrabas un evento aqui, salia "Evento eliminado" y desaparecia de la
      // pantalla, pero seguia anunciandose como proxima reunion en las demas
      // secciones hasta recargar. submitEvent ya lo hacia; estas dos no.
      if (data.reloadCalendar) await data.reloadCalendar()
      showToast('Evento eliminado')
    } catch { showToast('Error eliminando evento') }
    finally { setDeletingEventId(null) }
  }

  const submitEditEvent = async () => {
    if (!editEvent) return
    if (!editEvent.title.trim()) { showToast('El título no puede estar vacío'); return }
    setEditSaving(true)
    try {
      const res = await fetch(`/api/calendar/events/${editEvent.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editEvent.title.trim(), date: editEvent.date, time: editEvent.time || undefined, calendarId: editEvent.calendarId, cuenta: editEvent.cuenta }),
      })
      if (!res.ok) { showToast('Error actualizando evento'); return }
      const updated = await res.json()
      setCalEvents(prev => prev.map(e => e.id === editEvent.id ? { ...e, title: updated.title, start: updated.start } : e))
      if (data.reloadCalendar) await data.reloadCalendar()
      setEditEvent(null)
      showToast('Evento actualizado')
    } catch { showToast('Error actualizando evento') }
    finally { setEditSaving(false) }
  }

  const submitEvent = async () => {
    if (!eventForm) return
    if (!eventForm.title.trim()) { showToast('Escribe el título del evento'); return }
    if (!eventForm.date) { showToast('Elige una fecha'); return }
    setEvSaving(true)
    try {
      const attendees = eventForm.guests.split(/[,\s]+/).map(s=>s.trim()).filter(s=>s.includes('@'))
      const res = await fetch('/api/calendar/events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: eventForm.title.trim(), date: eventForm.date, time: eventForm.time || undefined, description: eventForm.desc || undefined, attendees }),
      })
      if (res.status === 403) { showToast('Sin permiso de calendario — reconecta Gmail Personal'); return }
      if (!res.ok) {
        // La ruta valida la fecha y la hora antes de llamar a Google y explica en
        // `error` qué no entendió. «Error creando el evento» a secas mandaba a
        // buscar la avería en Google Calendar cuando estaba en lo que se envió.
        const j = await res.json().catch(()=>null)
        showToast(j?.error || 'Error creando el evento')
        return
      }
      setEventForm(null)
      showToast(attendees.length ? `✓ Evento creado · invitación a ${plural(attendees.length, 'invitado')}` : '✓ Evento creado en Google Calendar')
      if (data.reloadCalendar) await data.reloadCalendar()
    } catch { showToast('Error creando el evento') }
    finally { setEvSaving(false) }
  }

  const DAYS_ES = ['L','M','X','J','V','S','D']
  const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

  const firstDay = new Date(viewYear, viewMonth, 1)
  const lastDay = new Date(viewYear, viewMonth + 1, 0)
  // Monday-first: 0=Mon…6=Sun
  const startOffset = (firstDay.getDay() + 6) % 7
  const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7

  const irAlMes = (dir: -1 | 1) => {
    if (dir === -1) { if (viewMonth === 0) { setViewMonth(11); setViewYear(y=>y-1) } else setViewMonth(m=>m-1) }
    else { if (viewMonth === 11) { setViewMonth(0); setViewYear(y=>y+1) } else setViewMonth(m=>m+1) }
  }

  /**
   * Las flechas ← →, que en vista SEMANA no movían la semana.
   *
   * `prevMonth`/`nextMonth` solo tocaban `viewMonth`, y las siete columnas se
   * calculan a partir de `selectedDay`. O sea que en vista semana pulsabas la
   * flecha, las columnas no se movían ni una tarea, pero el título pasaba a decir
   * «Septiembre» y el contador de eventos cambiaba. La pantalla decía que te
   * habías movido y no te habías movido.
   */
  const mover = (dir: -1 | 1) => {
    if (calView !== 'semana') { irAlMes(dir); return }
    const base = selectedDay || today
    const destino = new Date(base)
    destino.setDate(base.getDate() + dir * 7)
    setSelectedDay(destino)
    // El mes de detrás va con la semana: si no, el rótulo y el chip de «mes no
    // cargado» siguen hablando del mes anterior.
    if (destino.getMonth() !== viewMonth || destino.getFullYear() !== viewYear) {
      setViewMonth(destino.getMonth()); setViewYear(destino.getFullYear())
    }
  }
  const prevMonth = () => mover(-1)
  const nextMonth = () => mover(1)

  const selectedDayRef = useRef<Date|null>(selectedDay)
  selectedDayRef.current = selectedDay
  const detailPanelRef = useRef<HTMLDivElement>(null)

  useEffect(()=>{
    if (selectedDay && isMobile) {
      setTimeout(()=>detailPanelRef.current?.scrollIntoView({behavior:'smooth',block:'start'}), 200)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay])

  useEffect(()=>{
    const handler = (e: KeyboardEvent) => {
      // Con un modal abierto el foco esta en BODY, asi que la guarda por tagName
      // de mas abajo no protege: escribir en el formulario ejecutaba estos atajos.
      if (hayModalAbierto()) return
      if (['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); prevMonth() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nextMonth() }
      else if (e.key === 't') { e.preventDefault(); setViewMonth(today.getMonth()); setViewYear(today.getFullYear()); setSelectedDay(today) }
      // Con la fecha del día seleccionado, igual que el botón «Tarea» del panel.
      // El atajo abría el modal con la fecha límite vacía, así que la tecla que el
      // encabezado anuncia como «N TAREA» hacía algo distinto que el botón.
      else if (e.key === 'n') { e.preventDefault(); onOpenModal('tarea', selectedDayRef.current ? { due_date: toKey(selectedDayRef.current) } : undefined) }
      else if (e.key === 'j' || e.key === 'k') {
        e.preventDefault()
        const base = selectedDayRef.current || today
        const next = new Date(base)
        next.setDate(base.getDate() + (e.key === 'j' ? 1 : -1))
        setSelectedDay(next)
        if (next.getMonth() !== viewMonth || next.getFullYear() !== viewYear) {
          setViewMonth(next.getMonth()); setViewYear(next.getFullYear())
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMonth, viewYear])

  // Helpers
  // Las casillas del mes se construyen con `new Date(año, mes, dia)`, o sea con
  // números de calendario: `getDate()` devuelve el mismo número que se le puso,
  // en cualquier zona. El riesgo estaba solo en el «hoy», y ya está resuelto
  // arriba. La constante que había aquí se llamaba `todayKey` y TAPABA al helper
  // del mismo nombre: quien lo importara en este fichero se llevaba el del
  // portátil sin enterarse.
  const toKey = (d: Date) => localDayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12))
  const todayKey = claveHoy
  const selKey = selectedDay ? toKey(selectedDay) : ''

  // Build event map by date
  const eventsByDay: Record<string, {type:string;label:string;color:string;raw:any}[]> = {}

  const addEvent = (key: string, ev: {type:string;label:string;color:string;raw:any}) => {
    if (!eventsByDay[key]) eventsByDay[key] = []
    eventsByDay[key].push(ev)
  }

  // Google Calendar events
  calEvents.forEach((e: any) => {
    const d = e.start?.split('T')[0] || e.start
    if (d) addEvent(d, {type:'gcal', label:e.title, color:'#a78bfa', raw:e})
  })

  // Content pieces by publish date
  data.agenda?.forEach((a: any) => {
    if (a.publish_date) {
      const platColors = PLATAFORMA_COLOR
      addEvent(a.publish_date, {type:'content', label:a.title, color:platColors[a.platform]||BLU, raw:a})
    }
  })

  // LAS TAREAS. Tres cosas que estaban mal aquí y se veían en pantalla:
  //
  // 1. `!t.done` las quitaba del calendario al completarlas. Pulsabas «marcar como
  //    hecha» y la ficha se esfumaba en el mismo instante: indistinguible de
  //    haberla borrado. Y peor a la larga — navegabas a julio para ver cómo fue el
  //    mes de una campaña y el mes salía EN BLANCO, como si nadie hubiera
  //    trabajado. Ahora salen, apagadas y tachadas, y no cuentan como carga.
  //
  // 2. El color salía de un ternario crudo y el panel del día pasa por
  //    `nivelTarea()`: dos caminos para lo mismo. Escribí que un `level` vacío se
  //    pintaba azul en uno y ámbar en el otro, y ERA FALSO — `schema.sql:83` tiene
  //    `check (level in ('urgent','high','normal'))`, así que de la base no sale
  //    un valor raro nunca. Lo corrijo aquí porque un comentario que afirma un bug
  //    que no existe se cree igual que uno que sí.
  //
  //    Lo que sí puede pasar, y es el motivo de verdad: `createTask` pinta la
  //    tarea ANTES de que conteste el servidor. Si Harvey emite «urgente» en
  //    español —el caso que CLAUDE.md documenta, con el INSERT rebotando después—
  //    ese valor llega al render durante esa ventana. `nivelTarea()` es la
  //    frontera que el repo ya usa para eso; aquí faltaba.
  //
  // 3. Nada distinguía una tarea vencida. No había una sola comparación contra hoy
  //    en todo el fichero.
  const tareasSinFecha: any[] = []
  let vencidas = 0
  data.tasks?.forEach((t: any) => {
    // Mías = asignadas a mí. Una tarea sin responsable no es de nadie, así que
    // tampoco es mía: si saliera, el «solo las mías» dejaría de significar algo.
    if (!tareasDeTodos && t.assigned_to !== profile?.id) return
    if (!t.due_date) { if (!t.done) tareasSinFecha.push(t); return }
    const nivel = nivelTarea(t.level)
    const dia = String(t.due_date).split('T')[0]
    const vencida = !t.done && dia < claveHoy
    if (vencida) vencidas++
    const assignee = data.team?.find((p: any) => p.id === t.assigned_to) || null
    addEvent(dia, {
      type: 'task',
      label: t.text,
      color: t.done ? 'rgba(255,255,255,0.28)' : NIVEL_TAREA[nivel].color,
      raw: { ...t, assignee, nivel, vencida, hecha: !!t.done },
    })
  })

  // Project deadlines
  data.projects?.forEach((p: any) => {
    if (p.deadline && p.deadline !== 'TBD' && p.status !== 'completado') {
      const d = dlDate(p.deadline)
      if (d.getTime() !== 8640000000000000) {
        const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
        addEvent(iso, {type:'project', label:p.name, color:p.color||GRN, raw:p})
      }
    }
  })

  // Selected day events
  const selEvents = selKey ? (eventsByDay[selKey]||[]) : []

  // Conflictos de horario: eventos con hora que se solapan entre sí.
  // Devuelve el conjunto de ids de eventos de Google Calendar en conflicto.
  const conflictIds = (() => {
    const timed = selEvents
      .filter((e:any) => e.type === 'gcal' && e.raw?.start?.includes('T'))
      .map((e:any) => {
        const start = new Date(e.raw.start).getTime()
        const end = e.raw.end?.includes('T') ? new Date(e.raw.end).getTime() : start + 30 * 60_000
        return { id: e.raw.id as string, start, end }
      })
      .filter((e: {start:number}) => !isNaN(e.start))
    const ids = new Set<string>()
    for (let i = 0; i < timed.length; i++) {
      for (let j = i + 1; j < timed.length; j++) {
        // Se solapan si cada uno empieza antes de que el otro acabe
        if (timed[i].start < timed[j].end && timed[j].start < timed[i].end) {
          ids.add(timed[i].id); ids.add(timed[j].id)
        }
      }
    }
    return ids
  })()

  // EL ORDEN DE CADA DÍA, antes de que nadie corte.
  //
  // Los cuatro orígenes se empujan al mismo array en orden fijo —Google, luego
  // contenido, luego tareas, luego proyectos— y los tres sitios que pintan cortan
  // por `slice(0,3)`. O sea que un jueves con tres reuniones escondía la entrega
  // urgente de un cliente detrás de un «+1 más». El calendario servía para
  // enterarse de las reuniones y para NO enterarse de lo urgente.
  //
  // Lo que se esconde detrás del «+N» tiene que ser siempre lo menos grave.
  const PESO_TIPO: Record<string, number> = { task: 0, project: 1, gcal: 2, content: 3 }
  for (const k of Object.keys(eventsByDay)) {
    eventsByDay[k].sort((a, b) => {
      // Lo hecho, al final: ya no reclama nada.
      const hechaA = a.raw?.hecha ? 1 : 0, hechaB = b.raw?.hecha ? 1 : 0
      if (hechaA !== hechaB) return hechaA - hechaB
      // Lo vencido, delante de todo.
      const venA = a.raw?.vencida ? 0 : 1, venB = b.raw?.vencida ? 0 : 1
      if (venA !== venB) return venA - venB
      // Por gravedad de la tarea.
      const gA = a.type === 'task' ? ['urgent', 'high', 'normal'].indexOf(a.raw?.nivel || 'normal') : 9
      const gB = b.type === 'task' ? ['urgent', 'high', 'normal'].indexOf(b.raw?.nivel || 'normal') : 9
      if (gA !== gB) return gA - gB
      return (PESO_TIPO[a.type] ?? 9) - (PESO_TIPO[b.type] ?? 9)
    })
  }

  // Get current week for week view
  const getWeekDays = () => {
    const d = selectedDay || today
    const dow = (d.getDay() + 6) % 7
    const mon = new Date(d); mon.setDate(d.getDate() - dow)
    return Array.from({length:7}, (_,i) => { const x = new Date(mon); x.setDate(mon.getDate()+i); return x })
  }
  const weekDays = getWeekDays()

  // Upcoming events (next 7 days) for the right sidebar if no day selected
  const upcoming: {key:string;date:Date;events:any[]}[] = []
  for (let i=0; i<14; i++) {
    const d = new Date(today); d.setDate(today.getDate()+i)
    const k = toKey(d)
    if (eventsByDay[k]?.length) upcoming.push({key:k, date:d, events:eventsByDay[k]})
  }

  const formatTime = (iso: string) => {
    if (!iso || !iso.includes('T')) return ''
    return new Date(iso).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})
  }

  return (
    <div className={isMobile ? 'flex flex-col h-full overflow-y-auto' : 'flex h-full overflow-hidden'}>
      {/* Left: Calendar */}
      <div className={isMobile ? 'flex flex-col flex-shrink-0' : 'flex flex-col overflow-hidden flex-1 min-w-0'}>
        {/* Header */}
        <div className={`flex items-center justify-between ${isMobile?'px-4':'px-8'} py-5 flex-shrink-0 flex-wrap gap-3`} style={{borderBottom:`1px solid ${BORDER}`}}>
          <div>
            <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-1.5" style={{color:'rgba(255,255,255,0.18)'}}>AGENDA</div>
            <h1 className="font-figtree text-[26px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Calendario</h1>
            <div className="nx-kbd-hints flex items-center gap-2 mt-1.5">
              <span className="font-syne text-[7.5px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.1)'}}>← → MES</span>
              <span className="font-syne text-[7.5px]" style={{color:'rgba(255,255,255,0.07)'}}>·</span>
              <span className="font-syne text-[7.5px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.1)'}}>J/K DÍA</span>
              <span className="font-syne text-[7.5px]" style={{color:'rgba(255,255,255,0.07)'}}>·</span>
              <span className="font-syne text-[7.5px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.1)'}}>T HOY</span>
              <span className="font-syne text-[7.5px]" style={{color:'rgba(255,255,255,0.07)'}}>·</span>
              <span className="font-syne text-[7.5px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.1)'}}>N TAREA</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* View toggle */}
            {!isMobile && (
              <div className="flex rounded-xl overflow-hidden" style={{border:`1px solid ${BORDER}`}}>
                {(['mes','semana'] as const).map(v=>(
                  <button key={v} onClick={()=>setCalView(v)} className="px-4 py-2 font-syne text-[9px] font-black tracking-wide transition-all capitalize" style={{background:calView===v?'rgba(27,95,250,0.12)':'transparent',color:calView===v?'white':'rgba(255,255,255,0.3)'}}>
                    {v.charAt(0).toUpperCase()+v.slice(1)}
                  </button>
                ))}
              </div>
            )}
            <button onClick={()=>openEventForm()} className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest transition-all hover:opacity-80" style={{background:'rgba(167,139,250,0.1)',border:'1px solid rgba(167,139,250,0.28)',color:'#a78bfa'}}>
              <LucideIcon name="calendar" size={12} color="#a78bfa"/> EVENTO
            </button>
            <button onClick={()=>onOpenModal('contenido')} className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest text-white transition-opacity hover:opacity-85" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
              + NUEVA PIEZA
            </button>
          </div>
        </div>

        {/* Month nav.
            En MÓVIL van dos filas, no una. Era una sola con `gap-4` y sin envolver
            ni desplazar, así que en un teléfono «HOY · 8 eventos · SOLO MÍAS · 3
            sin fecha» se salía por la derecha y el último chip aparecía cortado a
            la mitad. Y lo que se cortaba primero era justo lo que más informa: los
            contadores de lo que NO se pinta en ninguna casilla.
            La navegación arriba —que es lo que se pulsa— y los chips debajo, en
            una fila que se desplaza sola, con el mismo idioma que la del Inbox. */}
        <div className={`flex ${isMobile?'flex-col items-stretch gap-2.5 px-4':'items-center gap-4 px-8'} py-4 flex-shrink-0`} style={{borderBottom:`1px solid ${BORDER}`}}>
          <div className={isMobile ? 'flex items-center gap-3' : 'contents'}>
          <button onClick={prevMonth} className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5" style={{background:SURF2}} aria-label="Anterior"><LucideIcon name="chevron-left" size={14} color="rgba(255,255,255,0.4)"/></button>
          <span className="font-figtree text-[18px] font-black" style={{letterSpacing:'-0.02em'}}>{MONTHS_ES[viewMonth]} <span style={{color:'rgba(255,255,255,0.35)'}}>{viewYear}</span></span>
          <button onClick={nextMonth} className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5" style={{background:SURF2}} aria-label="Siguiente"><LucideIcon name="chevron-right" size={14} color="rgba(255,255,255,0.4)"/></button>
          <button onClick={()=>{setViewMonth(today.getMonth());setViewYear(today.getFullYear());setSelectedDay(today)}} className="ml-2 px-3 py-1.5 rounded-lg font-syne text-[8px] font-black tracking-wide transition-colors" style={{background:'rgba(27,95,250,0.1)',color:BLU}}>HOY</button>
          </div>
          {/* La fila de chips. `touchAction: pan-x` y sin barra, igual que la del
              Inbox: son cinco y no caben, pero se llega a todos arrastrando. */}
          <div className={isMobile ? 'flex items-center gap-2 overflow-x-auto' : 'contents'}
            style={isMobile ? {scrollbarWidth:'none',touchAction:'pan-x',overscrollBehavior:'contain',overflowY:'hidden',WebkitOverflowScrolling:'touch' as never} : undefined}>
          {/* «Vacío» y «no lo he traído» NO son lo mismo.
              Las flechas dejan navegar a cualquier mes y de Google solo se trae un
              tramo; fuera de él el mes salía en blanco, o sea que el calendario
              afirmaba «no tienes nada» de algo que ni había mirado.
              `mesCargado` usa la MISMA función que decide la ventana al pedirlos:
              escribir aquí el rango a mano sería el gemelo de siempre. */}
          {!mesCargado(viewYear, viewMonth) && (
            <span className="font-syne text-[8px] font-black px-2.5 py-1 rounded-full"
                  style={{background:'rgba(255,176,32,0.12)',color:AMBAR}}>
              MES NO CARGADO
            </span>
          )}
          {(()=>{
            const monthKey = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}`
            const monthEventCount = Object.keys(eventsByDay).filter(k=>k.startsWith(monthKey)).reduce((s,k)=>s+eventsByDay[k].length,0)
            return monthEventCount > 0 ? <span className="font-syne text-[8px] font-black px-2.5 py-1 rounded-full" style={{background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.25)'}}>{plural(monthEventCount, 'evento')}</span> : null
          })()}
          {/* LO QUE NO SE PINTA EN NINGÚN DÍA, dicho en voz alta.
              Una tarea vencida se queda en el día en que vencía —copiarla a hoy la
              multiplicaría por cada día de retraso y haría mentir al pasado—, así
              que si cambias de mes desaparece de la vista sin dejar rastro. Y una
              tarea sin fecha límite no se pinta en ninguna casilla: el mes se veía
              despejado mientras Tareas decía otra cosa. Dos pantallas del mismo
              dato dando respuestas opuestas. */}
          {vencidas > 0 && (
            <span className="font-syne text-[8px] font-black px-2.5 py-1 rounded-full flex items-center gap-1.5"
              style={{background:`${RED}18`,border:`1px solid ${RED}38`,color:RED}}>
              <span className="w-1 h-1 rounded-full" style={{background:RED}}/>
              {plural(vencidas, 'vencida')}
            </span>
          )}
          {/* Mías / Todas. Va aquí y no en un menú porque los dos contadores de al
              lado —vencidas y sin fecha— cambian con él, y hay que ver a la vez
              qué se está contando y de quién. */}
          <button onClick={()=>setTareasDeTodos(v=>!v)}
            title={tareasDeTodos ? 'Viendo las tareas de todo el equipo' : 'Viendo solo tus tareas'}
            className="font-syne text-[8px] font-black px-2.5 py-1 rounded-full flex items-center gap-1.5 transition-all active:scale-95"
            style={tareasDeTodos
              ? {background:`${BLU}18`,border:`1px solid ${BLU}38`,color:BLU}
              : {background:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.35)'}}>
            <LucideIcon name={tareasDeTodos ? 'users' : 'user'} size={9} color={tareasDeTodos ? BLU : 'rgba(255,255,255,0.35)'} />
            {tareasDeTodos ? 'TODO EL EQUIPO' : 'SOLO MÍAS'}
          </button>

          {tareasSinFecha.length > 0 && (
            <span title="No se pintan en ningún día porque no tienen fecha límite. Se les puede poner desde Tareas."
              className="font-syne text-[8px] font-black px-2.5 py-1 rounded-full"
              style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.35)'}}>
              {tareasSinFecha.length} sin fecha
            </span>
          )}

          {/* La leyenda va por FORMA, no por color.
              Decía «ámbar = Tarea, azul = Contenido» y ninguna de las dos era
              cierta: una tarea sale roja, ámbar o azul según su nivel, y una pieza
              sale del color de su plataforma —rosa TikTok, rojo YouTube—. Una
              leyenda que miente es peor que no tenerla, porque se cree.
              El icono sí es fijo, y es lo que la rejilla usa de verdad. */}
          {!isMobile && <div className="ml-auto flex items-center gap-4 text-[10px]" style={{color:'rgba(255,255,255,0.3)'}}>
            {[{i:'check-circle',l:'Tarea'},{i:'calendar',l:'Google Cal'},{i:'film',l:'Contenido'},{i:'folder-open',l:'Proyecto'}].map(x=>(
              <div key={x.l} className="flex items-center gap-1.5"><LucideIcon name={x.i} size={10} color="rgba(255,255,255,0.35)"/>{x.l}</div>
            ))}
          </div>}

          {/* SINCRONIZAR. La función estaba escrita entera, con su tratamiento de
              errores comentado al detalle, y no la llamaba nadie: `syncCalendar`
              aparecía UNA vez en el fichero, la definición. Es el tercer caso hoy
              de código escrito y nunca cableado. Recarga también las tareas: traer
              solo los eventos de Google deja media pantalla vieja. */}
          {!isMobile && (
            <button onClick={()=>{ syncCalendar(); data.reload?.() }} disabled={syncingCal}
              className="font-syne text-[8px] font-black px-2.5 py-1 rounded-full flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-40"
              style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.35)'}}>
              <LucideIcon name="refresh-cw" size={9} color="rgba(255,255,255,0.35)"/>
              {syncingCal ? 'SINCRONIZANDO…' : 'SINCRONIZAR'}
            </button>
          )}
          </div>
        </div>

        {/* Aviso: token sin permiso de Calendar (reconectar Gmail) */}
        {data.calendarScopeError && (
          <div className="mx-4 mt-3 px-4 py-3 rounded-xl flex items-center gap-3 flex-shrink-0" style={{background:'rgba(255,176,32,0.07)',border:'1px solid rgba(255,176,32,0.2)'}}>
            <LucideIcon name="alert-triangle" size={14} color="rgba(255,176,32,0.85)"/>
            <span className="text-[12px] leading-snug" style={{color:'rgba(255,176,32,0.85)'}}>
              Google Calendar necesita permiso nuevo: ve a <b>Operativa → Sincronización</b> y reconecta tu Gmail personal.
            </span>
          </div>
        )}
        {/* Calendar grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {calView === 'mes' ? (
            <div>
              {/* Day headers */}
              <div className="grid grid-cols-7 mb-2">
                {DAYS_ES.map(d=>(
                  <div key={d} className="text-center py-1 font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>{d}</div>
                ))}
              </div>
              {/* Grid cells */}
              <div className="grid grid-cols-7 gap-1">
                {Array.from({length:totalCells},(_,i)=>{
                  const dayN = i - startOffset + 1
                  if (dayN < 1 || dayN > lastDay.getDate()) return <div key={i} className={isMobile?'h-[52px]':'h-[90px]'}/>
                  const d = new Date(viewYear, viewMonth, dayN)
                  const k = toKey(d)
                  const evs = eventsByDay[k]||[]
                  const isToday = k === todayKey
                  const isSel = k === selKey
                  const isWeekend = (d.getDay()===0||d.getDay()===6)
                  if (isMobile) {
                    return (
                      <div key={i} onClick={()=>setSelectedDay(d)} className="cursor-pointer flex flex-col items-center justify-center py-1.5 rounded-xl transition-all" style={{background:isSel?`${BLU}18`:isToday?`${BLU}0a`:'transparent',border:`1px solid ${isSel?`${BLU}40`:isToday?`${BLU}20`:'transparent'}`,minHeight:'52px'}}>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center mb-0.5${isToday&&!isSel?' ring-1 ring-blue-500':''}`}
                          style={{background:isSel?BLU:isToday?`${BLU}28`:'transparent'}}>
                          <span className="font-figtree text-[14px] font-black leading-none" style={{color:isSel?'white':isToday?BLU:isWeekend?'rgba(255,255,255,0.3)':'rgba(255,255,255,0.65)'}}>{dayN}</span>
                        </div>
                        {evs.length > 0 && (
                          <div className="flex items-center gap-[2px]">
                            {evs.slice(0,3).map((e,ei)=>(
                              <div key={ei} className="w-[5px] h-[5px] rounded-full" style={{background:e.color}}/>
                            ))}
                            {evs.length > 3 && <div className="w-[5px] h-[5px] rounded-full" style={{background:'rgba(255,255,255,0.25)'}}/>}
                          </div>
                        )}
                        {evs.length === 0 && <div className="h-[5px]"/>}
                      </div>
                    )
                  }
                  return (
                    <div key={i} onClick={()=>setSelectedDay(d)} className="rounded-xl p-2 cursor-pointer transition-all hover:bg-white/3 min-h-[90px] flex flex-col" style={{background:isSel?'rgba(27,95,250,0.1)':isToday?'rgba(27,95,250,0.08)':'transparent',border:`1px solid ${isSel?'rgba(27,95,250,0.3)':isToday?'rgba(27,95,250,0.22)':BORDER}`}}>
                      <div className="flex items-center justify-between mb-1.5" style={{minHeight:'20px'}}>
                        <span className="font-figtree text-[14px] font-black leading-none" style={{color:isToday?BLU:isWeekend?'rgba(255,255,255,0.35)':'rgba(255,255,255,0.7)'}}>{dayN}</span>
                        {isToday && <span className="font-syne text-[7px] font-black px-1.5 rounded-full flex items-center" style={{background:`${BLU}22`,color:BLU,height:'16px',lineHeight:'16px'}}>HOY</span>}
                      </div>
                      {/* Event chips */}
                      <div className="flex-1 space-y-0.5 overflow-hidden">
                        {evs.slice(0,3).map((e,ei)=>(
                          <div key={ei} className="flex items-center gap-0.5 rounded-md overflow-hidden" style={{background:e.color+'18'}}>
                            {e.type==='content'&&e.raw?.cover_url
                              ? <SafeImg src={e.raw.cover_url} className="w-5 h-5 object-cover flex-shrink-0"/>
                              : e.type==='task'
                                ? <span className="flex-shrink-0 ml-1"><LucideIcon name="check-circle" size={9} color={e.color}/></span>
                                : e.type==='gcal'
                                  ? <span className="flex-shrink-0 ml-1"><LucideIcon name="calendar" size={8} color={e.color}/></span>
                                  : <div className="w-1 h-1 rounded-full flex-shrink-0 ml-1.5" style={{background:e.color}}/>
                            }
                            <span className="text-[9px] truncate font-medium px-1 py-0.5"
                              style={{color:e.color+'cc', textDecoration:e.raw?.hecha?'line-through':'none', opacity:e.raw?.hecha?0.55:1}}>{e.label}</span>
                          </div>
                        ))}
                        {evs.length > 3 && <div className="text-[8px] px-1.5" style={{color:'rgba(255,255,255,0.25)'}}>+{evs.length-3} más</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            /* Week view */
            <div>
              <div className="grid grid-cols-7 gap-2">
                {weekDays.map((d,i)=>{
                  const k = toKey(d)
                  const evs = eventsByDay[k]||[]
                  const isToday = k === todayKey
                  const isSel = k === selKey
                  return (
                    <div key={i} onClick={()=>setSelectedDay(d)} className="rounded-2xl overflow-hidden cursor-pointer transition-all hover:bg-white/2" style={{background:isSel?'rgba(27,95,250,0.08)':'transparent',border:`1px solid ${isSel?'rgba(27,95,250,0.25)':isToday?'rgba(27,95,250,0.12)':BORDER}`}}>
                      <div className="px-3 py-3" style={{borderBottom:`1px solid ${BORDER}`}}>
                        <div className="flex items-center justify-between mb-0.5">
                          <div className="font-syne text-[8px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.3)'}}>{DAYS_ES[i]}</div>
                          {evs.length > 0 && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full" style={{background:isToday?`${BLU}20`:'rgba(255,255,255,0.06)',color:isToday?BLU:'rgba(255,255,255,0.3)'}}>{evs.length}</span>}
                        </div>
                        <div className="font-figtree text-[22px] font-black" style={{color:isToday?BLU:'rgba(255,255,255,0.7)',letterSpacing:'-0.02em'}}>{d.getDate()}</div>
                      </div>
                      <div className="p-2 min-h-[160px] space-y-1">
                        {evs.map((e,ei)=>(
                          <div key={ei} className="rounded-lg overflow-hidden" style={{background:e.color+'15',border:`1px solid ${e.color}25`}}>
                            {e.type==='content'&&e.raw?.cover_url&&(
                              <SafeImg src={e.raw.cover_url} className="w-full object-cover" style={{height:'52px'}}/>
                            )}
                            <div className="px-2 py-1.5">
                              <div className="flex items-center gap-1 mb-0.5">
                                {e.type==='content'
                                  ? <><PlatformLogo platform={e.raw?.platform} size={9}/><span className="font-syne text-[7px] font-black tracking-wide" style={{color:e.color+'cc'}}>{e.raw?.platform}</span></>
                                  : e.type==='task'
                                    ? <><LucideIcon name="check-circle" size={8} color={e.color}/><span className="font-syne text-[7px] font-black tracking-wide" style={{color:e.color+'cc'}}>{e.raw?.level ? rotuloNivel(e.raw.level, true) : 'TAREA'}</span></>
                                    : <span className="font-syne text-[7px] font-black tracking-wide" style={{color:e.color+'cc'}}>{e.type==='gcal'?'GCAL':e.type==='project'?'PROY.':'—'}</span>
                                }
                              </div>
                              <div className="text-[10px] font-medium line-clamp-2 leading-tight" style={{color:'rgba(255,255,255,0.7)'}}>{e.label}</div>
                              {e.type==='gcal'&&e.raw?.start&&e.raw.start.includes('T') && <div className="text-[9px] mt-0.5" style={{color:'rgba(255,255,255,0.3)'}}>{formatTime(e.raw.start)}</div>}
                              {e.type==='task'&&e.raw?.assignee && (
                                <div className="flex items-center gap-1 mt-1">
                                  <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center font-syne text-[6px] font-black" style={{background:e.raw.assignee.avatar_color+'30',color:e.raw.assignee.avatar_color}}>{e.raw.assignee.initials}</div>
                                  <span className="text-[8px]" style={{color:'rgba(255,255,255,0.35)'}}>{e.raw.assignee.name.split(' ')[0]}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                        {evs.length===0 && <div className="text-center pt-4 text-[9px]" style={{color:'rgba(255,255,255,0.1)'}}>—</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Day detail / Upcoming */}
      <div ref={detailPanelRef} className={isMobile ? 'w-full flex-shrink-0 flex flex-col' : 'w-[320px] flex-shrink-0 flex flex-col overflow-hidden'} style={isMobile?{borderTop:`1px solid ${BORDER}`,background:'#050510'}:{borderLeft:`1px solid ${BORDER}`,background:'#050510'}}>
        {selectedDay ? (
          <>
            {isMobile ? (
              /* ── Mobile day header ──────────────────────── */
              <div className="px-4 pt-5 pb-4 flex-shrink-0" style={{borderBottom:`1px solid ${BORDER}`}}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="font-syne text-[8px] font-black tracking-widest mb-1" style={{color:'rgba(255,255,255,0.2)'}}>
                      {selKey===todayKey?<span style={{color:BLU}}>● HOY</span>:'DÍA SELECCIONADO'}
                    </div>
                    <div className="font-figtree text-[22px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>
                      {selectedDay.toLocaleDateString('es-ES',{weekday:'short',day:'numeric',month:'short'}).replace(/^\w/,c=>c.toUpperCase())}
                    </div>
                  </div>
                  {selEvents.length > 0 && (
                    <div className="w-10 h-10 rounded-2xl flex items-center justify-center font-syne text-[16px] font-black" style={{background:`${BLU}18`,color:BLU,border:`1px solid ${BLU}28`}}>
                      {selEvents.length}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={()=>openEventForm(selKey)} className="flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl font-syne text-[8px] font-black tracking-wide active:scale-95" style={{background:'rgba(167,139,250,0.12)',border:'1px solid rgba(167,139,250,0.25)',color:'#a78bfa'}}>
                    <LucideIcon name="calendar" size={11} color="#a78bfa"/>Evento
                  </button>
                  <button onClick={()=>{ onOpenModal('contenido', {fecha:selKey}) }} className="flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl font-syne text-[8px] font-black tracking-wide active:scale-95" style={{background:'rgba(27,95,250,0.10)',border:`1px solid rgba(27,95,250,0.18)`,color:BLU}}>
                    <LucideIcon name="film" size={11} color={BLU}/>Pieza
                  </button>
                  <button onClick={()=>{ onOpenModal('tarea', {due_date:selKey}) }} className="flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl font-syne text-[8px] font-black tracking-wide active:scale-95" style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.38)'}}>
                    <LucideIcon name="check-square" size={11} color="rgba(255,255,255,0.38)"/>Tarea
                  </button>
                </div>
              </div>
            ) : (
              /* ── Desktop day header ─────────────────────── */
              <div className="px-6 pt-5 pb-4 flex-shrink-0" style={{borderBottom:`1px solid ${BORDER}`}}>
                <div className="font-syne text-[8px] font-black tracking-widest mb-1" style={{color:'rgba(255,255,255,0.2)'}}>DÍA SELECCIONADO</div>
                <div className="font-figtree text-[20px] font-black text-white" style={{letterSpacing:'-0.025em'}}>
                  {selectedDay.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'}).replace(/^\w/,c=>c.toUpperCase())}
                </div>
                {selKey === todayKey && <div className="font-syne text-[8px] font-black mt-1" style={{color:BLU}}>● HOY</div>}
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button onClick={()=>openEventForm(selKey)} className="flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl font-syne text-[8.5px] font-black tracking-wide transition-all hover:opacity-80" style={{background:'rgba(167,139,250,0.1)',border:'1px solid rgba(167,139,250,0.22)',color:'#a78bfa'}}>
                    <LucideIcon name="calendar" size={11} color="#a78bfa"/>Evento
                  </button>
                  <button onClick={()=>{ onOpenModal('contenido', {fecha:selKey}) }} className="flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl font-syne text-[8.5px] font-black tracking-wide transition-all hover:opacity-80" style={{background:'rgba(27,95,250,0.08)',border:`1px solid rgba(27,95,250,0.15)`,color:BLU}}>
                    <LucideIcon name="film" size={11} color={BLU}/>Pieza
                  </button>
                  <button onClick={()=>{ onOpenModal('tarea', {due_date:selKey}) }} className="flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl font-syne text-[8.5px] font-black tracking-wide transition-all hover:opacity-80" style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.4)'}}>
                    <LucideIcon name="check-square" size={11} color="rgba(255,255,255,0.4)"/>Tarea
                  </button>
                </div>
              </div>
            )}
            <div className={`flex-1 overflow-y-auto ${isMobile?'p-4':'p-5'} space-y-${isMobile?'3':'4'}`}>
              {selEvents.length === 0 ? (
                <div className="text-center py-10">
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${BORDER}`}}><LucideIcon name="calendar" size={16} color="rgba(255,255,255,0.15)"/></div>
                  <div className="text-[12px]" style={{color:'rgba(255,255,255,0.2)'}}>Día libre · sin eventos</div>
                  <div className="mt-6 space-y-2">
                    <button onClick={()=>openEventForm(selKey)} className="w-full py-3 rounded-2xl font-syne text-[9px] font-black tracking-widest flex items-center justify-center gap-2 active:scale-98" style={{background:'rgba(167,139,250,0.08)',border:'1px solid rgba(167,139,250,0.2)',color:'#a78bfa'}}>
                      <LucideIcon name="calendar-plus" size={13} color="#a78bfa"/>AÑADIR EVENTO
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Group by type */}
                  {(['gcal','content','task','project'] as const).map(type=>{
                    const evs = selEvents.filter(e=>e.type===type)
                    if (!evs.length) return null
                    const typeLabel = type==='gcal'?'GOOGLE CALENDAR':type==='content'?'CONTENIDO A PUBLICAR':type==='project'?'DEADLINE PROYECTO':'TAREAS CON DEADLINE'
                    const typeColor = type==='gcal'?'#a78bfa':type==='content'?BLU:type==='project'?GRN:AMBAR
                    return (
                      <div key={type}>
                        <div className="font-syne text-[8px] font-black tracking-widest mb-3 flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full" style={{background:typeColor}}/>
                          <span style={{color:typeColor+'cc'}}>{typeLabel}</span>
                        </div>
                        <div className="space-y-2">
                          {evs.map((e,i)=>(
                            <div key={i} className="rounded-xl overflow-hidden" style={{background:e.color+'10',border:`1px solid ${e.color}20`}}>
                              {type==='content'&&e.raw?.cover_url&&(
                                <SafeImg src={e.raw.cover_url} className="w-full object-cover" style={{height:isMobile?'140px':'120px'}}/>
                              )}
                              <div className={isMobile?'p-4':'p-4'}>
                              {isMobile&&type==='gcal'&&e.raw?.start&&e.raw.start.includes('T')&&(
                                <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-xl" style={{background:`${typeColor}18`,width:'fit-content'}}>
                                  <LucideIcon name="clock" size={11} color={typeColor}/>
                                  <span className="font-syne text-[11px] font-black" style={{color:typeColor}}>{formatTime(e.raw.start)}{e.raw.end?.includes('T')&&` — ${formatTime(e.raw.end)}`}</span>
                                </div>
                              )}
                              <div className={`font-semibold mb-1 leading-snug ${isMobile?'text-[15px]':'text-[13px]'}`} style={{color:'rgba(255,255,255,0.85)'}}>{e.label}</div>
                              {type==='gcal' && (
                                <div className="space-y-2.5">
                                  <div className="flex items-center gap-3 flex-wrap">
                                    {e.raw?.start&&e.raw.start.includes('T') && (
                                      <span className="flex items-center gap-1 text-[10px]" style={{color:'rgba(255,255,255,0.4)'}}>
                                        <LucideIcon name="clock" size={10} color="rgba(255,255,255,0.3)"/>{formatTime(e.raw.start)}{e.raw.end&&e.raw.end.includes('T')&&` – ${formatTime(e.raw.end)}`}
                                      </span>
                                    )}
                                    {e.raw?.id && conflictIds.has(e.raw.id) && (
                                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg font-syne text-[8px] font-black tracking-wide"
                                        style={{background:'rgba(255,176,32,0.12)',border:'1px solid rgba(255,176,32,0.28)',color:'rgba(255,176,32,0.95)'}}>
                                        <LucideIcon name="alert-circle" size={9} color="rgba(255,176,32,0.95)"/>SE SOLAPA
                                      </span>
                                    )}
                                    {e.raw?.location && (
                                      <span className="flex items-center gap-1 text-[10px] truncate" style={{color:'rgba(255,255,255,0.35)'}}>
                                        <LucideIcon name="map-pin" size={10} color="rgba(255,255,255,0.3)"/>{e.raw.location.slice(0,40)}
                                      </span>
                                    )}
                                    {e.raw?.hangoutLink && (
                                      <a href={e.raw.hangoutLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-syne text-[8px] font-black" style={{background:'rgba(0,200,100,0.1)',border:'1px solid rgba(0,200,100,0.2)',color:'#00c864'}}>
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M15 10l4.553-2.277A1 1 0 0 1 21 8.649v6.7a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" stroke="#00c864" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                        UNIRSE A MEET
                                      </a>
                                    )}
                                    {e.raw?.htmlLink && (
                                      <a href={e.raw.htmlLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-syne text-[8px] font-black" style={{color:'rgba(255,255,255,0.25)'}}>VER EN CAL<LucideIcon name="external-link" size={9} color="rgba(255,255,255,0.25)"/></a>
                                    )}
                                  </div>
                                  {/* Edit/Delete actions */}
                                  {(()=>{ const ef = editEvent?.id===e.raw?.id ? editEvent : null; return ef ? (
                                    <div className="space-y-2" onKeyDown={ev=>{if(ev.key==='Enter'){ev.preventDefault();submitEditEvent()}}}>
                                      <input autoFocus value={ef.title} onChange={ev=>setEditEvent(f=>f&&{...f,title:ev.target.value})} className="w-full px-3 py-2 rounded-xl text-[13px] text-white outline-none" style={{background:'rgba(255,255,255,0.06)',border:'1.5px solid rgba(167,139,250,0.3)',caretColor:'#a78bfa'}}/>
                                      <div className="flex gap-2">
                                        <input type="date" value={ef.date} onChange={ev=>setEditEvent(f=>f&&{...f,date:ev.target.value})} className="flex-1 px-3 py-2 rounded-xl text-[12px] text-white outline-none" style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',colorScheme:'dark'}}/>
                                        <input type="time" value={ef.time} onChange={ev=>setEditEvent(f=>f&&{...f,time:ev.target.value})} className="w-[110px] px-3 py-2 rounded-xl text-[12px] text-white outline-none" style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',colorScheme:'dark'}}/>
                                      </div>
                                      <div className="flex gap-2">
                                        <button onClick={submitEditEvent} disabled={editSaving} className="flex-1 py-2 rounded-xl font-syne text-[8px] font-black tracking-wide text-white disabled:opacity-40" style={{background:'linear-gradient(135deg,#a78bfa,#7c5cf5)'}}>
                                          {editSaving?'GUARDANDO…':'GUARDAR'}
                                        </button>
                                        <button onClick={()=>setEditEvent(null)} className="px-4 py-2 rounded-xl font-syne text-[8px] font-black" style={{color:'rgba(255,255,255,0.35)',border:'1px solid rgba(255,255,255,0.08)'}}>CANCELAR</button>
                                      </div>
                                    </div>
                                  ) : e.raw?.editable === false ? (
                                    /* Calendario compartido en solo lectura (uno de
                                       cliente, el de festivos). Google devuelve 403:
                                       enseñar los botones era prometer algo que la
                                       cuenta no puede hacer. */
                                    <div className="font-syne text-[7.5px] font-black" style={{color:'rgba(255,255,255,0.25)'}}>
                                      SOLO LECTURA · ÁBRELO EN GOOGLE CALENDAR PARA EDITARLO
                                    </div>
                                  ) : (
                                    <div className="flex gap-1.5 flex-wrap">
                                      <button onClick={()=>setEditEvent({id:e.raw.id,calendarId:e.raw.calendarId,cuenta:e.raw.cuenta,title:e.label,date:e.raw.start?.split('T')[0]||selKey,time:e.raw.start?.includes('T')?formatTime(e.raw.start):''})}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-syne text-[7.5px] font-black transition-all hover:opacity-80"
                                        style={{background:'rgba(167,139,250,0.08)',border:'1px solid rgba(167,139,250,0.18)',color:'rgba(167,139,250,0.75)'}}>
                                        <LucideIcon name="pencil" size={9} color="rgba(167,139,250,0.75)"/>EDITAR
                                      </button>
                                      {confirmEventId===e.raw?.id ? (
                                        <div className="flex gap-1 flex-wrap">
                                          {/* El borrado no es local: se va de Google Calendar y de la agenda de
                                              los invitados. La confirmación lo dice, que «¿BORRAR?» a secas sonaba
                                              a quitarlo de esta pantalla. */}
                                          <button onClick={()=>deleteEvent(e.raw.id, e.raw.calendarId, e.raw.cuenta)} disabled={deletingEventId===e.raw?.id} className="px-3 py-1.5 rounded-xl font-syne text-[7.5px] font-black disabled:opacity-50" style={{background:`${RED}18`,color:RED,border:`1px solid ${RED}30`}}>
                                            {deletingEventId===e.raw?.id ? 'BORRANDO…' : '¿BORRAR DE GOOGLE CALENDAR?'}
                                          </button>
                                          <button onClick={()=>setConfirmEventId(null)} disabled={deletingEventId===e.raw?.id} className="px-2 py-1.5 rounded-xl font-syne text-[7.5px] font-black disabled:opacity-40" style={{color:'rgba(255,255,255,0.3)',border:'1px solid rgba(255,255,255,0.08)'}}>NO</button>
                                        </div>
                                      ) : (
                                        <button onClick={()=>setConfirmEventId(e.raw?.id)}
                                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-syne text-[7.5px] font-black transition-all hover:opacity-80"
                                          style={{background:`${RED}08`,border:`1px solid ${RED}18`,color:`${RED}80`}}>
                                          <LucideIcon name="trash-2" size={9} color={`${RED}80`}/>ELIMINAR
                                        </button>
                                      )}
                                    </div>
                                  )
                                  })()}
                                </div>
                              )}
                              {type==='content' && (
                                <>
                                  <div className="flex items-center gap-2 mt-1">
                                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full" style={{background:e.color+'20'}}>
                                      <PlatformLogo platform={e.raw?.platform} size={10}/>
                                      <span className="font-syne text-[8px] font-black" style={{color:e.color+'cc'}}>{e.raw?.platform}</span>
                                    </div>
                                    {e.raw?.client?.name && <span className="text-[10px]" style={{color:'rgba(255,255,255,0.3)'}}>{e.raw.client.name}</span>}
                                  </div>
                                  {/* LinkedIn boceto */}
                                  {e.raw?.platform==='LinkedIn' && (
                                    <div className="mt-3 rounded-xl overflow-hidden" style={{background:'#1b1f23',border:'1px solid rgba(10,102,194,0.3)'}}>
                                      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
                                        <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-[11px] flex-shrink-0" style={{background:'linear-gradient(135deg,#1B5FFA,#0a66c2)',border:'1.5px solid rgba(27,95,250,0.4)'}}>
                                          {(e.raw.account_name||'B').charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                          <div className="flex items-center gap-1">
                                            <span className="font-figtree text-[11px] font-bold text-white">{e.raw.account_name||'Brutal Studios'}</span>
                                            <span style={{color:'#0a66c2',fontSize:'10px'}}>✓</span>
                                            <span className="font-figtree text-[8px] px-1 rounded-full border" style={{color:'rgba(255,255,255,0.4)',borderColor:'rgba(255,255,255,0.2)'}}>1er</span>
                                          </div>
                                          <p className="font-figtree text-[9px]" style={{color:'rgba(255,255,255,0.4)'}}>Co-fundador · Brutal Studios</p>
                                          <p className="font-figtree text-[9px]" style={{color:'rgba(255,255,255,0.28)'}}>2 días · 🌐</p>
                                        </div>
                                      </div>
                                      <div className="px-3 pb-2">
                                        <p className="font-figtree text-[11.5px] leading-snug line-clamp-4" style={{color:'rgba(255,255,255,0.82)'}}>{e.label}</p>
                                      </div>
                                      {e.raw.cover_url && <SafeImg src={e.raw.cover_url} className="w-full" style={{maxHeight:'90px',objectFit:'cover'}}/>}
                                      <div className="flex items-center gap-1.5 px-3 py-1.5" style={{borderTop:'1px solid rgba(255,255,255,0.06)'}}>
                                        <span style={{fontSize:'11px'}}>👍</span><span style={{fontSize:'11px',marginLeft:'-4px'}}>❤️</span>
                                        <span className="font-figtree text-[9px]" style={{color:'rgba(255,255,255,0.25)'}}>35 · 3 comentarios</span>
                                      </div>
                                      <div className="flex border-t" style={{borderColor:'rgba(255,255,255,0.06)'}}>
                                        {[{icon:'👍',label:'Recomendar'},{icon:'💬',label:'Comentar'},{icon:'↗️',label:'Compartir'},{icon:'✉️',label:'Enviar'}].map(a=>(
                                          <button key={a.label} className="flex-1 flex flex-col items-center gap-0.5 py-1.5 transition-all hover:bg-white/[0.03]">
                                            <span style={{fontSize:'11px'}}>{a.icon}</span>
                                            <span className="font-syne text-[7px] font-black" style={{color:'rgba(255,255,255,0.28)'}}>{a.label}</span>
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {/* Instagram boceto */}
                                  {e.raw?.platform==='Instagram' && (
                                    <div className="mt-3 rounded-xl overflow-hidden" style={{border:'1px solid rgba(195,53,132,0.3)',background:'#0d0d14'}}>
                                      <div className="flex items-center gap-2 px-3 py-2" style={{borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
                                        <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center font-syne text-[11px] font-black text-white" style={{border:'2px solid transparent',backgroundImage:'linear-gradient(#0d0d14,#0d0d14),linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)',backgroundOrigin:'border-box',backgroundClip:'padding-box,border-box'}}>
                                          {(e.raw?.account_name||'B').charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                          <p className="font-figtree text-[11px] font-bold text-white">{e.raw.account_name||'brutalstudios'}</p>
                                          <p className="font-figtree text-[9px]" style={{color:'rgba(255,255,255,0.4)'}}>Brutal Studios</p>
                                        </div>
                                        <span className="ml-auto font-syne text-[8.5px] font-black" style={{color:'#C13584'}}>SEGUIR</span>
                                      </div>
                                      {e.raw.cover_url
                                        ? <SafeImg src={e.raw.cover_url} className="w-full" style={{maxHeight:'180px',objectFit:'cover'}}/>
                                        : <div className="flex items-center justify-center py-10" style={{background:'rgba(195,53,132,0.04)'}}>
                                            <PlatformLogo platform="Instagram" size={32}/>
                                          </div>
                                      }
                                      <div className="px-3 pt-2 pb-1.5">
                                        <div className="flex items-center gap-3 mb-2">
                                          <span style={{fontSize:'14px'}}>❤️</span>
                                          <span style={{fontSize:'14px'}}>💬</span>
                                          <span style={{fontSize:'14px'}}>↗️</span>
                                        </div>
                                        <p className="font-figtree text-[11.5px] leading-snug line-clamp-3" style={{color:'rgba(255,255,255,0.82)'}}>
                                          <span className="font-bold">{e.raw.account_name||'brutalstudios'}</span>{' '}{e.label}
                                        </p>
                                      </div>
                                    </div>
                                  )}
                                </>
                              )}
                              {type==='task' && (
                                <div className="mt-3 space-y-2.5">
                                  {/* Priority + assignee row */}
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {(()=>{
                                      const pri = { label: rotuloNivel(e.raw?.level, true), color: NIVEL_TAREA[nivelTarea(e.raw?.level)].color }
                                      return <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{color:pri.color,background:`${pri.color}15`,border:`1px solid ${pri.color}25`}}>{pri.label}</span>
                                    })()}
                                    {e.raw?.assignee && (
                                      <div className="flex items-center gap-1.5">
                                        <div className="w-5 h-5 rounded-full flex items-center justify-center font-syne text-[7px] font-black flex-shrink-0" style={{background:e.raw.assignee.avatar_color+'25',color:e.raw.assignee.avatar_color,border:`1px solid ${e.raw.assignee.avatar_color}30`}}>{e.raw.assignee.initials}</div>
                                        <span className="text-[10px]" style={{color:'rgba(255,255,255,0.4)'}}>{e.raw.assignee.name.split(' ')[0]}</span>
                                      </div>
                                    )}
                                    {e.raw?.co_assigned_to && (()=>{
                                      const co = data.team?.find((p: any) => p.id === e.raw.co_assigned_to)
                                      return co ? <div className="flex items-center gap-1.5">
                                        <div className="w-5 h-5 rounded-full flex items-center justify-center font-syne text-[7px] font-black flex-shrink-0" style={{background:co.avatar_color+'25',color:co.avatar_color,border:`1px solid ${co.avatar_color}30`}}>{co.initials}</div>
                                        <span className="text-[10px]" style={{color:'rgba(255,255,255,0.35)'}}>{co.name.split(' ')[0]}</span>
                                      </div> : null
                                    })()}
                                  </div>
                                  {/* Complete button */}
                                  <button onClick={()=>data.toggleTask&&data.toggleTask(e.raw.id).then(()=>showToast('Tarea completada')).catch(()=>showToast('No se pudo marcar como hecha — vuelve a intentarlo'))}
                                    className="flex items-center gap-2 px-3 py-2 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all w-full justify-center"
                                    style={{background:e.raw?.done?'rgba(34,197,94,0.10)':'rgba(255,255,255,0.04)',border:`1px solid ${e.raw?.done?'rgba(34,197,94,0.22)':'rgba(255,255,255,0.08)'}`,color:e.raw?.done?GRN:'rgba(255,255,255,0.45)'}}>
                                    <LucideIcon name={e.raw?.done?'check-circle':'circle'} size={11} color={e.raw?.done?GRN:'rgba(255,255,255,0.3)'}/>
                                    {e.raw?.done?'COMPLETADA — DESHACER':'MARCAR COMO HECHA'}
                                  </button>
                                </div>
                              )}
                              {type==='project' && (
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  {e.raw?.client?.name && (
                                    <span className="flex items-center gap-1 text-[10px]" style={{color:'rgba(255,255,255,0.4)'}}>
                                      <LucideIcon name="building-2" size={10} color="rgba(255,255,255,0.3)"/>{e.raw.client.name}
                                    </span>
                                  )}
                                  {e.raw?.progress !== undefined && (
                                    <span className="flex items-center gap-1.5 text-[9px] font-syne font-black" style={{color:GRN+'cc'}}>
                                      <div className="w-12 h-1 rounded-full" style={{background:'rgba(255,255,255,0.08)'}}><div className="h-full rounded-full" style={{background:GRN,width:`${e.raw.progress}%`}}/></div>
                                      {e.raw.progress}%
                                    </span>
                                  )}
                                </div>
                              )}
                              </div>{/* /p-4 */}
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div className={`${isMobile?'px-4':'px-6'} py-5 flex-shrink-0`} style={{borderBottom:`1px solid ${BORDER}`}}>
              <div className="font-syne text-[8px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>PRÓXIMOS 14 DÍAS</div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {upcoming.length === 0 ? (
                <div className="text-center py-12 text-[12px]" style={{color:'rgba(255,255,255,0.2)'}}>Sin eventos próximos</div>
              ) : upcoming.map(u=>(
                <div key={u.key} onClick={()=>setSelectedDay(u.date)} className="cursor-pointer">
                  <div className="font-syne text-[8px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>{u.key===todayKey?'HOY':u.date.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'short'}).toUpperCase()}</div>
                  {u.events.slice(0,3).map((e,i)=>(
                    <div key={i} className="flex items-center gap-2.5 py-2.5" style={{borderBottom:i<Math.min(u.events.length,3)-1?`1px solid ${BORDER}`:'none'}}>
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{background:e.color}}/>
                      <span className="text-[12px] flex-1 truncate" style={{color:'rgba(255,255,255,0.55)'}}>{e.label}</span>
                      {e.type==='gcal'&&e.raw?.start&&e.raw.start.includes('T') && <span className="font-syne text-[8px] font-black" style={{color:'rgba(255,255,255,0.25)'}}>{formatTime(e.raw.start)}</span>}
                      <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded" style={{background:e.color+'15',color:e.color+'cc'}}>{e.type==='gcal'?'CAL':e.type==='content'?'CTN':e.type==='project'?'PRY':'TSK'}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── MODAL: NUEVO EVENTO EN GOOGLE CALENDAR ─────────────────────────── */}
      {eventForm && (
        <div onClick={()=>!evSaving&&setEventForm(null)} className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{background:'rgba(2,2,10,0.8)',backdropFilter:'blur(8px)'}}>
          {/* El modal no acotaba su altura y el contorno lleva overflow-hidden: en un
              móvil apaisado (o un portátil corto con el zoom subido) el formulario medía
              más que la ventana, CREAR EVENTO quedaba por debajo del borde y no había
              forma de llegar a él, porque no scrolleaba ni el modal ni la página. Se
              acota a la ventana y scrollea solo el cuerpo, con cabecera y pie fijos.
              dvh y no vh: en móvil la barra del navegador se come los vh. */}
          <div onClick={e=>e.stopPropagation()} onKeyDown={e=>{ const tag=(e.target as HTMLElement).tagName; if(e.key==='Enter'&&tag!=='TEXTAREA'&&tag!=='BUTTON'&&!evSaving){ e.preventDefault(); submitEvent() } }}
            className="w-[440px] max-w-full rounded-3xl overflow-hidden flex flex-col" style={{background:'linear-gradient(180deg,#0D0D1E 0%,#080810 100%)',border:'1px solid rgba(167,139,250,0.28)',boxShadow:'0 40px 100px rgba(0,0,0,0.8)',maxHeight:'calc(100dvh - 2rem)'}}>
            <div className="h-[2px] flex-shrink-0" style={{background:'linear-gradient(90deg,transparent,#a78bfa,transparent)'}}/>
            <div className="flex items-center justify-between px-6 py-5 flex-shrink-0" style={{borderBottom:`1px solid ${BORDER}`}}>
              <div>
                <div className="font-syne text-[9px] font-black tracking-widest mb-1" style={{color:'rgba(167,139,250,0.7)'}}>GOOGLE CALENDAR</div>
                <h2 className="font-syne text-[20px] font-black text-white leading-none">Nuevo Evento</h2>
              </div>
              <button onClick={()=>!evSaving&&setEventForm(null)} className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white/5" style={{background:SURF2}}><LucideIcon name="x" size={16} color="rgba(240,240,248,0.45)"/></button>
            </div>
            <div className="px-6 py-5 space-y-4 flex-1 min-h-0 overflow-y-auto">
              <div>
                <label className="block font-syne text-[9px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.28)'}}>TÍTULO</label>
                <input autoFocus value={eventForm.title} onChange={e=>setEventForm(f=>f&&{...f,title:e.target.value})} placeholder="Ej: Rodaje del vídeo de Higgsfield" className="w-full px-4 py-3 rounded-2xl text-[14px] text-white placeholder-white/20 outline-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}}/>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block font-syne text-[9px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.28)'}}>FECHA</label>
                  <input type="date" value={eventForm.date} onChange={e=>setEventForm(f=>f&&{...f,date:e.target.value})} className="w-full px-4 py-3 rounded-2xl text-[14px] text-white outline-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU,colorScheme:'dark'}}/>
                </div>
                <div className="w-[130px]">
                  <label className="block font-syne text-[9px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.28)'}}>HORA</label>
                  <input type="time" value={eventForm.time} onChange={e=>setEventForm(f=>f&&{...f,time:e.target.value})} className="w-full px-4 py-3 rounded-2xl text-[14px] text-white outline-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU,colorScheme:'dark'}}/>
                </div>
              </div>
              <div>
                <label className="block font-syne text-[9px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.28)'}}>INVITADOS <span style={{color:'rgba(255,255,255,0.18)'}}>· emails separados por coma (opcional)</span></label>
                <input value={eventForm.guests} onChange={e=>setEventForm(f=>f&&{...f,guests:e.target.value})} placeholder="pablo@brutalstudios.es, cliente@nike.com" className="w-full px-4 py-3 rounded-2xl text-[14px] text-white placeholder-white/20 outline-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}}/>
                <div className="text-[10px] mt-1.5" style={{color:'rgba(255,255,255,0.25)'}}>Recibirán invitación y el evento aparecerá en su Google Calendar.</div>
              </div>
              <div>
                <label className="block font-syne text-[9px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.28)'}}>DESCRIPCIÓN <span style={{color:'rgba(255,255,255,0.18)'}}>· opcional</span></label>
                <textarea value={eventForm.desc} onChange={e=>setEventForm(f=>f&&{...f,desc:e.target.value})} rows={2} placeholder="Detalles del evento…" className="w-full px-4 py-3 rounded-2xl text-[14px] text-white placeholder-white/20 outline-none resize-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU,lineHeight:'1.5'}}/>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-5 flex-shrink-0" style={{borderTop:`1px solid ${BORDER}`}}>
              <button onClick={()=>!evSaving&&setEventForm(null)} className="px-5 py-3 rounded-2xl text-[13px] hover:text-white/70" style={{color:'rgba(255,255,255,0.4)',border:`1px solid ${BORDER}`}}>Cancelar</button>
              <button onClick={submitEvent} disabled={evSaving} className="px-6 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white disabled:opacity-50" style={{background:'linear-gradient(135deg,#a78bfa,#7c5cf5)'}}>{evSaving?'CREANDO…':'CREAR EVENTO'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default CalendarioSection
