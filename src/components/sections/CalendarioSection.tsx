'use client'

import { useState, useRef, useEffect } from 'react'
import { useIsMobile, BLU, RED, GRN, SURFACE, SURF2, BORDER, LucideIcon, dlDate } from '@/components/shared'
import { PlatformLogo } from '@/components/PlatformLogo'

function CalendarioSection({data, profile, showToast, onOpenModal, onSetMf}: any) {
  const isMobile = useIsMobile()
  const today = new Date()
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [selectedDay, setSelectedDay] = useState<Date|null>(today)
  const [calView, setCalView] = useState<'mes'|'semana'>('mes')
  const [syncingCal, setSyncingCal] = useState(false)
  const [calEvents, setCalEvents] = useState<any[]>(data.calendarEvents || [])

  // Sync local state when the parent data hook loads calendar events asynchronously
  useEffect(() => {
    if (Array.isArray(data.calendarEvents)) setCalEvents(data.calendarEvents)
  }, [data.calendarEvents])

  const syncCalendar = async () => {
    setSyncingCal(true)
    try {
      const res = await fetch('/api/calendar/events').then(r=>r.json())
      if (res?.__error === 'no_scope') { showToast('Sin permisos de calendario — reconecta Gmail Personal'); return }
      const events = Array.isArray(res) ? res : []
      setCalEvents(events)
      showToast(`${events.length} eventos de Google Calendar`)
    } catch { showToast('Error sincronizando calendario') }
    finally { setSyncingCal(false) }
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
      const platColors: Record<string,string> = {TikTok:'#ff0050',Instagram:'#C13584',LinkedIn:'#0A66C2',YouTube:'#FF0000',Twitter:'#1DA1F2',Pinterest:'#E60023'}
      addEvent(a.publish_date, {type:'content', label:a.title, color:platColors[a.platform]||BLU, raw:a})
    }
  })

  // Tasks with due_date
  data.tasks?.forEach((t: any) => {
    if (t.due_date && !t.done) {
      const c = t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.9)':BLU
      addEvent(t.due_date.split('T')[0], {type:'task', label:t.text, color:c, raw:t})
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
        <div className="flex items-center justify-between px-8 py-5 flex-shrink-0 flex-wrap gap-3" style={{borderBottom:`1px solid ${BORDER}`}}>
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
            <div className="flex rounded-xl overflow-hidden" style={{border:`1px solid ${BORDER}`}}>
              {(['mes','semana'] as const).map(v=>(
                <button key={v} onClick={()=>setCalView(v)} className="px-4 py-2 font-syne text-[9px] font-black tracking-wide transition-all capitalize" style={{background:calView===v?'rgba(27,95,250,0.12)':'transparent',color:calView===v?'white':'rgba(255,255,255,0.3)'}}>
                  {v.charAt(0).toUpperCase()+v.slice(1)}
                </button>
              ))}
            </div>
            <button onClick={()=>onOpenModal('contenido')} className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest text-white" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
              + NUEVA PIEZA
            </button>
          </div>
        </div>

        {/* Month nav */}
        <div className="flex items-center gap-4 px-8 py-4 flex-shrink-0" style={{borderBottom:`1px solid ${BORDER}`}}>
          <button onClick={prevMonth} className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5" style={{background:SURF2}}>
            <LucideIcon name="chevron-left" size={14} color="rgba(255,255,255,0.4)"/>
          </button>
          <span className="font-figtree text-[18px] font-black" style={{letterSpacing:'-0.02em'}}>{MONTHS_ES[viewMonth]} <span style={{color:'rgba(255,255,255,0.35)'}}>{viewYear}</span></span>
          <button onClick={nextMonth} className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5" style={{background:SURF2}}>
            <LucideIcon name="chevron-right" size={14} color="rgba(255,255,255,0.4)"/>
          </button>
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
                  if (dayN < 1 || dayN > lastDay.getDate()) return <div key={i} className="h-[90px]"/>
                  const d = new Date(viewYear, viewMonth, dayN)
                  const k = toKey(d)
                  const evs = eventsByDay[k]||[]
                  const isToday = k === todayKey
                  const isSel = k === selKey
                  const isWeekend = (d.getDay()===0||d.getDay()===6)
                  return (
                    <div key={i} onClick={()=>setSelectedDay(d)} className="rounded-xl p-2 cursor-pointer transition-all hover:bg-white/3 min-h-[90px] flex flex-col" style={{background:isSel?'rgba(27,95,250,0.1)':isToday?'rgba(27,95,250,0.08)':'transparent',border:`1px solid ${isSel?'rgba(27,95,250,0.3)':isToday?'rgba(27,95,250,0.22)':BORDER}`}}>
                      <div className="flex items-center justify-between mb-1.5" style={{minHeight:'20px'}}>
                        <span className="font-figtree text-[14px] font-black leading-none" style={{color:isToday?BLU:isWeekend?'rgba(255,255,255,0.35)':'rgba(255,255,255,0.7)'}}>{dayN}</span>
                        {isToday && <span className="font-syne text-[7px] font-black px-1.5 rounded-full flex items-center" style={{background:`${BLU}22`,color:BLU,height:'16px',lineHeight:'16px'}}>HOY</span>}
                      </div>
                      {/* Event dots & chips */}
                      <div className="flex-1 space-y-0.5 overflow-hidden">
                        {evs.slice(0,3).map((e,ei)=>(
                          <div key={ei} className="flex items-center gap-1 px-1.5 py-0.5 rounded-md" style={{background:e.color+'18'}}>
                            <div className="w-1 h-1 rounded-full flex-shrink-0" style={{background:e.color}}/>
                            <span className="text-[9px] truncate font-medium" style={{color:e.color+'cc'}}>{e.label}</span>
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
                          <div key={ei} className="px-2 py-1.5 rounded-lg" style={{background:e.color+'15',border:`1px solid ${e.color}25`}}>
                            <div className="flex items-center gap-1 mb-0.5">
                              {e.type==='content'
                                ? <><PlatformLogo platform={e.raw?.platform} size={9}/><span className="font-syne text-[7px] font-black tracking-wide" style={{color:e.color+'cc'}}>{e.raw?.platform}</span></>
                                : <span className="font-syne text-[7px] font-black tracking-wide" style={{color:e.color+'cc'}}>{e.type==='gcal'?'GCAL':e.type==='project'?'PROY.':'TAREA'}</span>
                              }
                            </div>
                            <div className="text-[10px] font-medium line-clamp-2 leading-tight" style={{color:'rgba(255,255,255,0.7)'}}>{e.label}</div>
                            {e.type==='gcal'&&e.raw?.start&&e.raw.start.includes('T') && <div className="text-[9px] mt-0.5" style={{color:'rgba(255,255,255,0.3)'}}>{formatTime(e.raw.start)}</div>}
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
      <div className={isMobile ? 'w-full flex-shrink-0 flex flex-col' : 'w-[320px] flex-shrink-0 flex flex-col overflow-hidden'} style={isMobile?{borderTop:`1px solid ${BORDER}`,background:'#050510'}:{borderLeft:`1px solid ${BORDER}`,background:'#050510'}}>
        {selectedDay ? (
          <>
            <div className="px-6 pt-5 pb-4 flex-shrink-0" style={{borderBottom:`1px solid ${BORDER}`}}>
              <div className="font-syne text-[8px] font-black tracking-widest mb-1" style={{color:'rgba(255,255,255,0.2)'}}>DÍA SELECCIONADO</div>
              <div className="font-figtree text-[20px] font-black text-white" style={{letterSpacing:'-0.025em'}}>
                {selectedDay.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'}).replace(/^\w/,c=>c.toUpperCase())}
              </div>
              {selKey === todayKey && <div className="font-syne text-[8px] font-black mt-1" style={{color:BLU}}>● HOY</div>}
              <div className="mt-3 flex gap-2">
                <button onClick={()=>{ onSetMf?.({fecha:selKey}); onOpenModal('contenido') }} className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-wide transition-all hover:opacity-80" style={{background:'rgba(27,95,250,0.08)',border:`1px solid rgba(27,95,250,0.15)`,color:BLU}}>
                  <LucideIcon name="film" size={11} color={BLU}/>
                  Añadir pieza
                </button>
                <button onClick={()=>{ onSetMf?.({due_date:selKey}); onOpenModal('tarea') }} className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-wide transition-all hover:opacity-80" style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.4)'}}>
                  <LucideIcon name="check-square" size={11} color="rgba(255,255,255,0.4)"/>
                  Nueva tarea
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {selEvents.length === 0 ? (
                <div className="text-center py-10">
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${BORDER}`}}><LucideIcon name="calendar" size={16} color="rgba(255,255,255,0.15)"/></div>
                  <div className="text-[12px]" style={{color:'rgba(255,255,255,0.2)'}}>Día libre · sin eventos</div>
                </div>
              ) : (
                <>
                  {/* Group by type */}
                  {(['gcal','content','task','project'] as const).map(type=>{
                    const evs = selEvents.filter(e=>e.type===type)
                    if (!evs.length) return null
                    const typeLabel = type==='gcal'?'GOOGLE CALENDAR':type==='content'?'CONTENIDO A PUBLICAR':type==='project'?'DEADLINE PROYECTO':'TAREAS CON DEADLINE'
                    const typeColor = type==='gcal'?'#a78bfa':type==='content'?BLU:type==='project'?GRN:'rgba(255,176,32,0.8)'
                    return (
                      <div key={type}>
                        <div className="font-syne text-[8px] font-black tracking-widest mb-3 flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full" style={{background:typeColor}}/>
                          <span style={{color:typeColor+'cc'}}>{typeLabel}</span>
                        </div>
                        <div className="space-y-2">
                          {evs.map((e,i)=>(
                            <div key={i} className="rounded-xl p-4" style={{background:e.color+'10',border:`1px solid ${e.color}20`}}>
                              <div className="text-[13px] font-semibold mb-1 leading-snug" style={{color:'rgba(255,255,255,0.8)'}}>{e.label}</div>
                              {type==='gcal' && (
                                <div className="flex items-center gap-3 flex-wrap">
                                  {e.raw?.start&&e.raw.start.includes('T') && (
                                    <span className="flex items-center gap-1 text-[10px]" style={{color:'rgba(255,255,255,0.4)'}}>
                                      <LucideIcon name="clock" size={10} color="rgba(255,255,255,0.3)"/>{formatTime(e.raw.start)}{e.raw.end&&e.raw.end.includes('T')&&` – ${formatTime(e.raw.end)}`}
                                    </span>
                                  )}
                                  {e.raw?.location && (
                                    <span className="flex items-center gap-1 text-[10px] truncate" style={{color:'rgba(255,255,255,0.35)'}}>
                                      <LucideIcon name="map-pin" size={10} color="rgba(255,255,255,0.3)"/>{e.raw.location.slice(0,40)}
                                    </span>
                                  )}
                                  {e.raw?.htmlLink && (
                                    <a href={e.raw.htmlLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-syne text-[8px] font-black" style={{color:'#a78bfa'}}>VER<LucideIcon name="external-link" size={9} color="#a78bfa"/></a>
                                  )}
                                </div>
                              )}
                              {type==='content' && (
                                <div className="flex items-center gap-2 mt-1">
                                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full" style={{background:e.color+'20'}}>
                                    <PlatformLogo platform={e.raw?.platform} size={10}/>
                                    <span className="font-syne text-[8px] font-black" style={{color:e.color+'cc'}}>{e.raw?.platform}</span>
                                  </div>
                                  {e.raw?.client?.name && <span className="text-[10px]" style={{color:'rgba(255,255,255,0.3)'}}>{e.raw.client.name}</span>}
                                </div>
                              )}
                              {type==='task' && e.raw?.assignee && (
                                <div className="flex items-center gap-2 mt-1">
                                  <div className="w-5 h-5 rounded-full flex items-center justify-center font-syne text-[7px] font-black" style={{background:e.raw.assignee.avatar_color+'25',color:e.raw.assignee.avatar_color}}>{e.raw.assignee.initials}</div>
                                  <span className="text-[10px]" style={{color:'rgba(255,255,255,0.35)'}}>{e.raw.assignee.name}</span>
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
            <div className="px-6 py-5 flex-shrink-0" style={{borderBottom:`1px solid ${BORDER}`}}>
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
    </div>
  )
}

export default CalendarioSection
