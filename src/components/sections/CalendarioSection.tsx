'use client'

import { useState, useRef, useEffect } from 'react'
import { PLATAFORMA_COLOR, useIsMobile, BLU, RED, GRN, SURFACE, SURF2, BORDER, LucideIcon, SafeImg, dlDate, AMBAR } from '@/components/shared'
import { PlatformLogo } from '@/components/PlatformLogo'

function CalendarioSection({data, profile, showToast, onOpenModal}: any) {
  const isMobile = useIsMobile()
  const today = new Date()
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [selectedDay, setSelectedDay] = useState<Date|null>(today)
  const [calView, setCalView] = useState<'mes'|'semana'>('mes')
  const [syncingCal, setSyncingCal] = useState(false)
  const [calEvents, setCalEvents] = useState<any[]>(data.calendarEvents || [])
  // Alta rápida de evento en Google Calendar (usa POST /api/calendar/events)
  const [eventForm, setEventForm] = useState<null | { title: string; date: string; time: string; guests: string; desc: string }>(null)
  const [evSaving, setEvSaving] = useState(false)
  const [editEvent, setEditEvent] = useState<null|{id:string;title:string;date:string;time:string}>(null)
  const [editSaving, setEditSaving] = useState(false)
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
        showToast(`${events.length} eventos de Google Calendar`)
      }
    } catch { showToast('Error sincronizando calendario') }
    finally { setSyncingCal(false) }
  }

  const openEventForm = (dateKey?: string) => {
    if (!profile?.gmail_connected) { showToast('Conecta Gmail en Operativa → Sincronización para crear eventos'); return }
    setEventForm({ title: '', date: dateKey || toKey(selectedDay || today), time: '', guests: '', desc: '' })
  }

  const deleteEvent = async (eventId: string) => {
    setDeletingEventId(eventId)
    try {
      const res = await fetch(`/api/calendar/events/${eventId}`, { method: 'DELETE' })
      if (!res.ok) { showToast('Error eliminando evento'); return }
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
        body: JSON.stringify({ title: editEvent.title.trim(), date: editEvent.date, time: editEvent.time || undefined }),
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
      if (!res.ok) { showToast('Error creando el evento'); return }
      setEventForm(null)
      showToast(attendees.length ? `✓ Evento creado · invitación a ${attendees.length}` : '✓ Evento creado en Google Calendar')
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

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y=>y-1) } else setViewMonth(m=>m-1) }
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y=>y+1) } else setViewMonth(m=>m+1) }

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
      if (['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); prevMonth() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nextMonth() }
      else if (e.key === 't') { e.preventDefault(); setViewMonth(today.getMonth()); setViewYear(today.getFullYear()); setSelectedDay(today) }
      else if (e.key === 'n') { e.preventDefault(); onOpenModal('tarea') }
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
  const toKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  const todayKey = toKey(today)
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

  // Tasks with due_date — enrich with resolved assignee from team
  data.tasks?.forEach((t: any) => {
    if (t.due_date && !t.done) {
      const c = t.level==='urgent'?RED:t.level==='high'?AMBAR:BLU
      const assignee = data.team?.find((p: any) => p.id === t.assigned_to) || null
      addEvent(t.due_date.split('T')[0], {type:'task', label:t.text, color:c, raw:{...t, assignee}})
    }
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
            <h1 className="font-figtree text-[24px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Calendario</h1>
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
            <button onClick={()=>onOpenModal('contenido')} className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest text-white" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
              + NUEVA PIEZA
            </button>
          </div>
        </div>

        {/* Month nav */}
        <div className={`flex items-center gap-4 ${isMobile?'px-4':'px-8'} py-4 flex-shrink-0`} style={{borderBottom:`1px solid ${BORDER}`}}>
          <button onClick={prevMonth} className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5" style={{background:SURF2}} aria-label="Anterior"><LucideIcon name="chevron-left" size={14} color="rgba(255,255,255,0.4)"/></button>
          <span className="font-figtree text-[18px] font-black" style={{letterSpacing:'-0.02em'}}>{MONTHS_ES[viewMonth]} <span style={{color:'rgba(255,255,255,0.35)'}}>{viewYear}</span></span>
          <button onClick={nextMonth} className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5" style={{background:SURF2}} aria-label="Siguiente"><LucideIcon name="chevron-right" size={14} color="rgba(255,255,255,0.4)"/></button>
          <button onClick={()=>{setViewMonth(today.getMonth());setViewYear(today.getFullYear());setSelectedDay(today)}} className="ml-2 px-3 py-1.5 rounded-lg font-syne text-[8px] font-black tracking-wide transition-colors" style={{background:'rgba(27,95,250,0.1)',color:BLU}}>HOY</button>
          {(()=>{
            const monthKey = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}`
            const monthEventCount = Object.keys(eventsByDay).filter(k=>k.startsWith(monthKey)).reduce((s,k)=>s+eventsByDay[k].length,0)
            return monthEventCount > 0 ? <span className="font-syne text-[8px] font-black px-2.5 py-1 rounded-full" style={{background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.25)'}}>{monthEventCount} evento{monthEventCount>1?'s':''}</span> : null
          })()}
          {/* Legend — oculta en móvil, no cabe */}
          {!isMobile && <div className="ml-auto flex items-center gap-4 text-[10px]" style={{color:'rgba(255,255,255,0.3)'}}>
            {[{c:'#a78bfa',l:'Google Cal'},{c:BLU,l:'Contenido'},{c:'rgba(255,176,32,0.8)',l:'Tarea'},{c:GRN,l:'Proyecto'}].map(x=>(
              <div key={x.l} className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{background:x.c}}/>{x.l}</div>
            ))}
          </div>}
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
                            <span className="text-[9px] truncate font-medium px-1 py-0.5" style={{color:e.color+'cc'}}>{e.label}</span>
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
                                    ? <><LucideIcon name="check-circle" size={8} color={e.color}/><span className="font-syne text-[7px] font-black tracking-wide" style={{color:e.color+'cc'}}>{e.raw?.level==='urgent'?'URGENTE':e.raw?.level==='high'?'MEDIA':'TAREA'}</span></>
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
                                  ) : (
                                    <div className="flex gap-1.5">
                                      <button onClick={()=>setEditEvent({id:e.raw.id,title:e.label,date:e.raw.start?.split('T')[0]||selKey,time:e.raw.start?.includes('T')?formatTime(e.raw.start):''})}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-syne text-[7.5px] font-black transition-all hover:opacity-80"
                                        style={{background:'rgba(167,139,250,0.08)',border:'1px solid rgba(167,139,250,0.18)',color:'rgba(167,139,250,0.75)'}}>
                                        <LucideIcon name="pencil" size={9} color="rgba(167,139,250,0.75)"/>EDITAR
                                      </button>
                                      {deletingEventId===e.raw?.id ? (
                                        <div className="flex gap-1">
                                          <button onClick={()=>deleteEvent(e.raw.id)} className="px-3 py-1.5 rounded-xl font-syne text-[7.5px] font-black" style={{background:`${RED}18`,color:RED,border:`1px solid ${RED}30`}}>¿BORRAR?</button>
                                          <button onClick={()=>setDeletingEventId(null)} className="px-2 py-1.5 rounded-xl font-syne text-[7.5px] font-black" style={{color:'rgba(255,255,255,0.3)',border:'1px solid rgba(255,255,255,0.08)'}}>NO</button>
                                        </div>
                                      ) : (
                                        <button onClick={()=>setDeletingEventId(e.raw?.id)}
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
                                      const priMap: Record<string,{label:string,color:string}> = {urgent:{label:'ALTA',color:RED},high:{label:'MEDIA',color:'#FFB020'},normal:{label:'BAJA',color:BLU}}
                                      const pri = priMap[e.raw?.level] || priMap.normal
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
          <div onClick={e=>e.stopPropagation()} onKeyDown={e=>{ const tag=(e.target as HTMLElement).tagName; if(e.key==='Enter'&&tag!=='TEXTAREA'&&tag!=='BUTTON'&&!evSaving){ e.preventDefault(); submitEvent() } }}
            className="w-[440px] max-w-full rounded-3xl overflow-hidden" style={{background:'linear-gradient(180deg,#0D0D1E 0%,#080810 100%)',border:'1px solid rgba(167,139,250,0.28)',boxShadow:'0 40px 100px rgba(0,0,0,0.8)'}}>
            <div className="h-[2px]" style={{background:'linear-gradient(90deg,transparent,#a78bfa,transparent)'}}/>
            <div className="flex items-center justify-between px-6 py-5" style={{borderBottom:`1px solid ${BORDER}`}}>
              <div>
                <div className="font-syne text-[9px] font-black tracking-widest mb-1" style={{color:'rgba(167,139,250,0.7)'}}>GOOGLE CALENDAR</div>
                <h2 className="font-syne text-[20px] font-black text-white leading-none">Nuevo Evento</h2>
              </div>
              <button onClick={()=>!evSaving&&setEventForm(null)} className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white/5" style={{background:SURF2}}><LucideIcon name="x" size={16} color="rgba(240,240,248,0.45)"/></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block font-syne text-[9px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.28)'}}>TÍTULO</label>
                <input autoFocus value={eventForm.title} onChange={e=>setEventForm(f=>f&&{...f,title:e.target.value})} placeholder="Ej: Reunión con Nike" className="w-full px-4 py-3 rounded-2xl text-[14px] text-white placeholder-white/20 outline-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}}/>
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
            <div className="flex justify-end gap-3 px-6 py-5" style={{borderTop:`1px solid ${BORDER}`}}>
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
