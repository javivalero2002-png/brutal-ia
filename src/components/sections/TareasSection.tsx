'use client'
import { useState, useEffect, useRef } from 'react'
import type { Task, Project, Profile } from '@/types'
import { useIsMobile, useBackClosable, BLU, RED, GRN, SURFACE, SURF2, BORDER, LucideIcon, dlDate } from '@/components/shared'

function TareasSection({data,onOpenModal,showToast,isOwner,onNavigate,onSelectProject,onSelectClient}: any) {
  const isMobile = useIsMobile()
  const [filter, setFilter] = useState<'todas'|'urgente'|'high'|'normal'|'hecho'|'hoy'|'semana'|'sin_fecha'|'atrasadas'>('todas')
  const [assigneeFilter, setAssigneeFilter] = useState('Todos')
  const [taskSort, setTaskSort] = useState<'prioridad'|'fecha'>('prioridad')
  const [taskGroup, setTaskGroup] = useState<'none'|'proyecto'|'prioridad'>('none')
  const [activeTask, setActiveTask] = useState<Task|null>(null)
  useBackClosable(!!activeTask, () => setActiveTask(null))
  const [editing, setEditing] = useState<Partial<Task>>({})
  const [saving, setSaving] = useState(false)
  const [confirmDeleteTask, setConfirmDeleteTask] = useState(false)
  const [confirmLimpiar, setConfirmLimpiar] = useState(false)
  const filteredTasksRef = useRef<Task[]>([])
  const dueDateRef = useRef<HTMLInputElement>(null)
  const saveTaskRef = useRef<()=>void>(()=>{})
  const savingRef = useRef(false)

  useEffect(()=>{
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeTask) { setActiveTask(null); return }
      if (e.key === 'n' && !activeTask && !['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) && !(e.metaKey||e.ctrlKey||e.altKey)) {
        e.preventDefault()
        onOpenModal('tarea')
        return
      }
      if ((e.key === 'j' || e.key === 'k') && !['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault()
        const tasks = filteredTasksRef.current
        const idx = activeTask ? tasks.findIndex(t=>t.id===activeTask.id) : -1
        const next = e.key==='j' ? Math.min(idx+1, tasks.length-1) : Math.max(idx-1, 0)
        const t = tasks[next]
        if (t) { setActiveTask(t); setEditing({ text:t.text, level:t.level, assigned_to:t.assigned_to, done:t.done, due_date:t.due_date, project_id:t.project_id }); setConfirmDeleteTask(false) }
      }
      if (e.key === 'c' && activeTask && !['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) && !(e.metaKey||e.ctrlKey||e.altKey)) {
        e.preventDefault()
        setEditing(x => ({...x, done: !x.done}))
      }
      if (e.key === 'd' && activeTask && !['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) && !(e.metaKey||e.ctrlKey||e.altKey)) {
        e.preventDefault()
        dueDateRef.current?.focus()
      }
      if (e.key === 'l' && activeTask && !['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) && !(e.metaKey||e.ctrlKey||e.altKey)) {
        e.preventDefault()
        setEditing(x => {
          const levels = ['normal','high','urgent'] as const
          const curr = levels.indexOf(x.level as 'normal'|'high'|'urgent')
          return {...x, level: levels[(curr+1)%levels.length]}
        })
      }
      if (e.key === 's' && activeTask && !savingRef.current && !['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) && !(e.metaKey||e.ctrlKey||e.altKey)) {
        e.preventDefault()
        saveTaskRef.current()
      }
      if (!activeTask && !['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) && !(e.metaKey||e.ctrlKey||e.altKey)) {
        const fmap: Record<string,'todas'|'urgente'|'high'|'normal'|'hoy'|'semana'|'sin_fecha'|'atrasadas'> = {'1':'todas','2':'urgente','3':'high','4':'normal','5':'hoy','6':'semana','7':'sin_fecha','8':'atrasadas'}
        if (fmap[e.key]) { e.preventDefault(); setFilter(fmap[e.key]) }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeTask, onOpenModal])

  const openTask = (t: Task) => {
    setActiveTask(t)
    setEditing({ text: t.text, level: t.level, assigned_to: t.assigned_to, done: t.done, due_date: t.due_date, project_id: t.project_id })
    setConfirmDeleteTask(false)
  }

  const saveTask = async () => {
    if (!activeTask) return
    setSaving(true)
    try {
      await data.updateTask(activeTask.id, editing)
      showToast('Tarea actualizada')
      setActiveTask(null)
    } catch { showToast('Error al guardar') }
    finally { setSaving(false) }
  }
  saveTaskRef.current = saveTask
  savingRef.current = saving

  const levelPriority = (l: string) => l==='urgent'?0:l==='high'?1:2
  const weekEnd = new Date(Date.now() + 7*24*60*60*1000)
  const filtered = data.tasks.filter((t: Task) => {
    const todayKey = new Date().toISOString().split('T')[0]
    const byStatus = filter === 'todas' ? !t.done : filter === 'hecho' ? t.done : filter === 'hoy' ? (!t.done && !!t.due_date && t.due_date.slice(0,10) === todayKey) : filter === 'atrasadas' ? (!t.done && !!t.due_date && new Date(t.due_date+'T23:59:59') < new Date(todayKey+'T00:00:00')) : filter === 'semana' ? (!t.done && !!t.due_date && new Date(t.due_date+'T23:59:59') <= weekEnd) : filter === 'sin_fecha' ? (!t.done && !t.due_date) : (!t.done && t.level === filter)
    const byAssignee = assigneeFilter === 'Todos' || t.assignee?.name === assigneeFilter
    return byStatus && byAssignee
  }).sort((a: Task, b: Task) => {
    if (filter === 'hecho') return new Date(b.updated_at||b.created_at).getTime() - new Date(a.updated_at||a.created_at).getTime()
    if (taskSort === 'fecha') {
      const aT = a.due_date ? new Date(a.due_date+'T23:59:59').getTime() : Infinity
      const bT = b.due_date ? new Date(b.due_date+'T23:59:59').getTime() : Infinity
      return aT - bT
    }
    const aOver = a.due_date && new Date(a.due_date+'T23:59:59') < new Date() ? -1 : 0
    const bOver = b.due_date && new Date(b.due_date+'T23:59:59') < new Date() ? -1 : 0
    if (aOver !== bOver) return aOver - bOver
    return levelPriority(a.level) - levelPriority(b.level)
  })
  filteredTasksRef.current = filtered

  const todayFilterKey = new Date().toISOString().split('T')[0]
  const completedTodayCount = data.tasks.filter((t: Task)=>t.done&&(t.updated_at||t.created_at).slice(0,10)===todayFilterKey).length
  const tabCounts: Record<string,number> = {
    todas: data.tasks.filter((t: Task)=>!t.done).length,
    urgente: data.tasks.filter((t: Task)=>!t.done&&t.level==='urgent').length,
    high: data.tasks.filter((t: Task)=>!t.done&&t.level==='high').length,
    normal: data.tasks.filter((t: Task)=>!t.done&&t.level==='normal').length,
    hecho: data.tasks.filter((t: Task)=>t.done).length,
    atrasadas: data.tasks.filter((t: Task)=>!t.done&&!!t.due_date&&new Date(t.due_date+'T23:59:59')<new Date(todayFilterKey+'T00:00:00')).length,
    hoy: data.tasks.filter((t: Task)=>!t.done&&!!t.due_date&&t.due_date.slice(0,10)===todayFilterKey).length,
    semana: data.tasks.filter((t: Task)=>!t.done&&!!t.due_date&&new Date(t.due_date+'T23:59:59')<=weekEnd).length,
    sin_fecha: data.tasks.filter((t: Task)=>!t.done&&!t.due_date).length,
  }
  const tabs: {id: 'todas'|'urgente'|'high'|'normal'|'hecho'|'hoy'|'semana'|'sin_fecha'|'atrasadas', label: string, color?: string}[] = [
    {id:'todas', label:'Todas'},
    {id:'urgente', label:'Urgente', color:RED},
    {id:'high', label:'Alta', color:'rgba(255,176,32,0.8)'},
    {id:'normal', label:'Normal', color:BLU},
    ...(tabCounts.atrasadas > 0 ? [{id:'atrasadas' as const, label:'Atrasadas', color:RED}] : []),
    {id:'hoy', label:'Hoy', color:'rgba(255,176,32,0.85)'},
    {id:'semana', label:'Esta sem.', color:'rgba(167,139,250,0.85)'},
    {id:'sin_fecha', label:'Sin fecha', color:'rgba(255,255,255,0.3)'},
    {id:'hecho', label:'Hechas'},
  ]

  // Todo el equipo, tenga o no tareas — y cualquier asignado que ya no esté en el equipo
  const assignees = ['Todos', ...Array.from(new Set([...(data.team||[]).map((p: Profile) => p.name), ...data.tasks.map((t: Task) => t.assignee?.name)].filter(Boolean)))] as string[]
  const levelColor = (l: string) => l==='urgent'?RED:l==='high'?'rgba(255,176,32,0.8)':BLU

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Task list — en movil se oculta cuando hay tarea abierta */}
      <div className="flex flex-col overflow-hidden" style={isMobile
        ? {width:'100%',flexShrink:0,display:activeTask?'none':'flex'}
        : {width:activeTask?'420px':'100%',flexShrink:0,borderRight:activeTask?`1px solid ${BORDER}`:'none'}}>
        <div className="p-8 pb-0 flex-shrink-0">
          <div className="flex items-end justify-between mb-8 flex-wrap gap-3">
            <div>
              <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-2" style={{color:'rgba(255,255,255,0.18)'}}>GESTION</div>
              <h1 className="font-figtree text-[28px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Tareas</h1>
              <div className="nx-kbd-hints flex items-center gap-2 mt-1.5">
                {(['1-8 FILTROS','J/K NAVEGAR','N NUEVA'] as const).map((hint,i,arr)=>(
                  <span key={hint} className="flex items-center gap-2">
                    <span className="font-syne text-[7.5px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.1)'}}>{hint}</span>
                    {i<arr.length-1&&<span className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.07)'}}>·</span>}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex p-1 rounded-xl" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
                {([{id:'prioridad',icon:'arrow-up-narrow-wide'},{id:'fecha',icon:'calendar-clock'}] as const).map(s=>(
                  <button key={s.id} onClick={()=>setTaskSort(s.id)} title={s.id==='prioridad'?'Ordenar por prioridad':'Ordenar por fecha limite'} className="px-2.5 py-2 rounded-lg transition-all" style={{background:taskSort===s.id?SURF2:'transparent'}}>
                    <LucideIcon name={s.icon} size={12} color={taskSort===s.id?'rgba(255,255,255,0.8)':'rgba(255,255,255,0.25)'}/>
                  </button>
                ))}
                <button onClick={()=>setTaskGroup(g=>g==='none'?'proyecto':g==='proyecto'?'prioridad':'none')} title={taskGroup==='none'?'Agrupar por proyecto':taskGroup==='proyecto'?'Agrupar por prioridad':'Sin agrupar'} className="px-2.5 py-2 rounded-lg transition-all" style={{background:taskGroup!=='none'?SURF2:'transparent'}}>
                  <LucideIcon name={taskGroup==='prioridad'?'flag':'layers'} size={12} color={taskGroup!=='none'?BLU:'rgba(255,255,255,0.25)'}/>
                </button>
              </div>
              <button onClick={()=>onOpenModal('tarea')} className="flex items-center gap-2 px-5 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>+ NUEVA</button>
            </div>
          </div>
          {/* Completion micro-bar */}
          {data.tasks.length > 0 && (
            <div className="mb-5">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-syne text-[8px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.18)'}}>COMPLETADAS</span>
                  {completedTodayCount > 0 && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full" style={{background:`${GRN}14`,color:`${GRN}99`}}>+{completedTodayCount} HOY</span>}
                </div>
                <span className="font-syne text-[8px] font-black" style={{color:tabCounts.hecho>0?GRN:'rgba(255,255,255,0.2)'}}>{tabCounts.hecho} / {data.tasks.length}</span>
              </div>
              <div className="h-1.5 rounded-full" style={{background:'rgba(255,255,255,0.04)'}}>
                <div className="h-full rounded-full transition-all duration-700" style={{width:`${data.tasks.length>0?(tabCounts.hecho/data.tasks.length)*100:0}%`,background:`linear-gradient(90deg,${GRN}80,${GRN})`}}/>
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 mb-5 flex-wrap">
            <div className="flex gap-1 p-1 rounded-2xl overflow-x-auto max-w-full" style={{background:SURFACE,border:`1px solid ${BORDER}`,scrollbarWidth:'none'}}>
              {tabs.map(t=>(
                <button key={t.id} onClick={()=>setFilter(t.id)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-syne text-[9px] font-black tracking-wide transition-all flex-shrink-0 whitespace-nowrap" style={{background:filter===t.id?t.color||SURF2:'transparent',color:filter===t.id?'white':t.color||'rgba(255,255,255,0.28)'}}>
                  {t.label.toUpperCase()}
                  {tabCounts[t.id] > 0 && <span className="text-[7.5px] font-black opacity-70">{tabCounts[t.id]}</span>}
                </button>
              ))}
            </div>
            {isOwner && assignees.length > 1 && (
              <div className="flex gap-1 flex-wrap">
                {assignees.map(a=>{
                  const cnt = a === 'Todos' ? data.tasks.filter((t: Task)=>!t.done).length : data.tasks.filter((t: Task)=>!t.done&&t.assignee?.name===a).length
                  return (
                    <button key={a} onClick={()=>setAssigneeFilter(a)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-syne text-[9px] font-black tracking-wide transition-all" style={{background:assigneeFilter===a?BLU+'18':SURFACE,border:`1px solid ${assigneeFilter===a?BLU+'50':BORDER}`,color:assigneeFilter===a?BLU:'rgba(255,255,255,0.28)'}}>
                      {a.toUpperCase()}
                      {cnt > 0 && <span className="text-[7.5px] font-black opacity-60">{cnt}</span>}
                    </button>
                  )
                })}
              </div>
            )}
            {filter === 'hecho' && filtered.length > 0 && isOwner && (
              confirmLimpiar
                ? <div className="flex items-center gap-1">
                    <button onClick={async()=>{try{await Promise.all(filtered.map((t: Task)=>data.deleteTask(t.id)));showToast('Tareas eliminadas')}catch{showToast('Error al eliminar')}finally{setConfirmLimpiar(false)}}} className="font-syne text-[8px] font-black px-3 py-1.5 rounded-xl transition-all" style={{background:'rgba(229,29,42,0.12)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR {filtered.length}?</button>
                    <button onClick={()=>setConfirmLimpiar(false)} className="w-6 h-6 rounded-lg flex items-center justify-center" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={10} color="rgba(255,255,255,0.3)"/></button>
                  </div>
                : <button onClick={()=>setConfirmLimpiar(true)} className="font-syne text-[8px] font-black px-3 py-1.5 rounded-xl transition-all" style={{color:'rgba(229,29,42,0.5)',border:`1px solid rgba(229,29,42,0.15)`}}>LIMPIAR</button>
            )}
            <span className="ml-auto font-syne text-[10px] font-black" style={{color:'rgba(255,255,255,0.2)'}}>{filtered.length}</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-8 pb-8">
          {(()=>{
            const TaskRow = ({t,i,arr}: {t:Task,i:number,arr:Task[]}) => {
              const pc = t.done ? 'rgba(255,255,255,0.08)' : levelColor(t.level)
              return (
                <div key={t.id} onClick={()=>openTask(t)} className="flex items-start gap-3 px-5 py-4 cursor-pointer group hover:bg-white/[0.015] transition-all" style={{background:activeTask?.id===t.id?'rgba(27,95,250,0.06)':'transparent',borderBottom:i===arr.length-1?'none':`1px solid ${BORDER}`,borderLeft:`3px solid ${activeTask?.id===t.id?BLU:t.done?'transparent':pc+'60'}`}}>
                  <button onClick={e=>{e.stopPropagation();data.toggleTask(t.id).catch(()=>{})}} className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-1 transition-all" style={{background:t.done?pc:'transparent',border:`2px solid ${t.done?pc:pc+'60'}`}}>
                    {t.done && <LucideIcon name="check" size={8} color="white"/>}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="font-figtree text-[14px] font-semibold leading-snug mb-1.5" style={{color:t.done?'rgba(255,255,255,0.22)':'rgba(255,255,255,0.88)',textDecoration:t.done?'line-through':'none'}}>{t.text}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {(t.client as any)?.name && <button onClick={e=>{e.stopPropagation();onSelectClient?.((t.client as any).id);onNavigate?.('clientes')}} className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full transition-all hover:opacity-75" style={{background:(t.client as any).color+'18',color:(t.client as any).color+'cc'}}>{(t.client as any).name}</button>}
                      {t.due_date && (() => {
                        const todayStr = new Date().toISOString().split('T')[0]
                        const isToday = t.due_date.slice(0,10) === todayStr
                        const overdue = !t.done && !isToday && new Date(t.due_date+'T23:59:59') < new Date()
                        const label = isToday ? 'HOY' : new Date(t.due_date+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'})
                        return <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full" style={{background:isToday?'rgba(255,176,32,0.15)':overdue?'rgba(229,29,42,0.1)':'rgba(255,255,255,0.05)',color:isToday?'rgba(255,176,32,0.95)':overdue?RED:'rgba(255,255,255,0.35)'}}>{overdue?'● ':''}{label}</span>
                      })()}
                      {taskGroup === 'none' && t.project_id && (() => { const proj = data.projects.find((p: Project)=>p.id===t.project_id); return proj ? <button onClick={e=>{e.stopPropagation();onSelectProject?.(proj.id);onNavigate?.('proyectos')}} className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded transition-all hover:opacity-75" style={{background:(proj.color||BLU)+'12',color:(proj.color||BLU)+'99'}}>{proj.name}</button> : null })()}
                      {!t.done && t.level==='urgent' && <span className="font-syne text-[8px] font-black" style={{color:RED}}>● URGENTE</span>}
                      {t.source==='gmail' && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded" style={{background:'rgba(27,95,250,0.08)',color:'rgba(100,140,255,0.55)'}}>GMAIL</span>}
                      {t.source==='whatsapp' && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded" style={{background:'rgba(37,211,102,0.06)',color:'rgba(37,211,102,0.55)'}}>WA</span>}
                    </div>
                  </div>
                  {t.assignee && <div className="w-7 h-7 rounded-full flex items-center justify-center font-syne text-[9px] font-black flex-shrink-0 mt-0.5" style={{background:t.assignee.avatar_color+'18',border:`1.5px solid ${t.assignee.avatar_color}35`,color:t.assignee.avatar_color}}>{t.assignee.initials}</div>}
                </div>
              )
            }

            if (taskGroup === 'proyecto' && filter !== 'hecho') {
              const projMap: Record<string,Task[]> = {}
              filtered.forEach((t: Task) => { const k = t.project_id||'__none__'; if(!projMap[k])projMap[k]=[]; projMap[k].push(t) })
              const projKeys = Object.keys(projMap).sort(k=>k==='__none__'?1:-1)
              if (filtered.length === 0) return <div className="rounded-2xl py-16 text-center text-[13px]" style={{background:SURFACE,border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.18)'}}>Sin tareas en este filtro</div>
              return (
                <div className="space-y-3">
                  {projKeys.map(k => {
                    const proj = k!=='__none__' ? data.projects.find((p: Project)=>p.id===k) : null
                    const tasks = projMap[k]
                    return (
                      <div key={k} className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`,borderTop:`2px solid ${proj?(proj.color||BLU)+'25':'rgba(255,255,255,0.07)'}`}}>
                        <div className="flex items-center gap-2.5 px-5 py-3" style={{borderBottom:`1px solid ${BORDER}`,borderLeft:`3px solid ${proj?proj.color||BLU:'rgba(255,255,255,0.12)'}`}}>
                          {proj ? (
                            <>
                              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{background:proj.color||BLU}}/>
                              <button onClick={()=>{onSelectProject?.(proj.id);onNavigate?.('proyectos')}} className="font-syne text-[9px] font-black tracking-widest flex-1 text-left transition-all hover:opacity-75" style={{color:'rgba(255,255,255,0.5)'}}>{proj.name.toUpperCase()}</button>
                              <span className="font-syne text-[8px] font-black" style={{color:'rgba(255,255,255,0.2)'}}>{tasks.length}</span>
                            </>
                          ) : (
                            <>
                              <span className="font-syne text-[9px] font-black tracking-widest flex-1" style={{color:'rgba(255,255,255,0.25)'}}>SIN PROYECTO</span>
                              <span className="font-syne text-[8px] font-black" style={{color:'rgba(255,255,255,0.2)'}}>{tasks.length}</span>
                            </>
                          )}
                        </div>
                        {tasks.map((t,i)=><TaskRow key={t.id} t={t} i={i} arr={tasks}/>)}
                      </div>
                    )
                  })}
                </div>
              )
            }

            if (taskGroup === 'prioridad' && filter !== 'hecho') {
              const prioGroups = [
                {key:'urgent' as const,label:'URGENTE',color:RED,topC:RED+'25'},
                {key:'high' as const,label:'ALTA',color:'rgba(255,176,32,0.85)',topC:'rgba(255,176,32,0.22)'},
                {key:'normal' as const,label:'NORMAL',color:BLU,topC:BLU+'25'},
              ]
              if (filtered.length === 0) return <div className="rounded-2xl py-16 text-center text-[13px]" style={{background:SURFACE,border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.18)'}}>Sin tareas en este filtro</div>
              return (
                <div className="space-y-3">
                  {prioGroups.map(g => {
                    const gTasks = filtered.filter((t: Task)=>t.level===g.key)
                    if (!gTasks.length) return null
                    return (
                      <div key={g.key} className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`,borderTop:`2px solid ${g.topC}`}}>
                        <div className="flex items-center gap-2.5 px-5 py-3" style={{borderBottom:`1px solid ${BORDER}`,borderLeft:`3px solid ${g.color}`}}>
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{background:g.color}}/>
                          <span className="font-syne text-[9px] font-black tracking-widest flex-1" style={{color:'rgba(255,255,255,0.45)'}}>{g.label}</span>
                          <span className="font-syne text-[8px] font-black" style={{color:'rgba(255,255,255,0.2)'}}>{gTasks.length}</span>
                        </div>
                        {gTasks.map((t: Task,i: number)=><TaskRow key={t.id} t={t} i={i} arr={gTasks}/>)}
                      </div>
                    )
                  })}
                </div>
              )
            }

            return (
              <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
                {filtered.length === 0 && <div className="py-16 text-center text-[13px]" style={{color:'rgba(255,255,255,0.18)'}}>Sin tareas en este filtro</div>}
                {filtered.map((t: Task, i: number) => <TaskRow key={t.id} t={t} i={i} arr={filtered}/>)}
              </div>
            )
          })()}
          {activeTask && filtered.length > 1 && (
            <div className="flex items-center justify-center gap-3 py-2.5">
              <span className="font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.1)'}}>
                <kbd className="px-1 py-0.5 rounded" style={{background:'rgba(255,255,255,0.06)',fontFamily:'inherit'}}>J</kbd> siguiente
                {' · '}
                <kbd className="px-1 py-0.5 rounded" style={{background:'rgba(255,255,255,0.06)',fontFamily:'inherit'}}>K</kbd> anterior
              </span>
            </div>
          )}
          {!activeTask && (
            <div className="flex items-center justify-center py-2">
              <span className="font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.08)'}}>
                <kbd className="px-1 py-0.5 rounded" style={{background:'rgba(255,255,255,0.05)',fontFamily:'inherit'}}>N</kbd> nueva tarea
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Right: Task detail drawer */}
      {activeTask && (
        <div className="flex-1 overflow-y-auto min-w-0" style={{background:'#050510'}} onKeyDown={(e)=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!saving){saveTask()}}}>
          {/* Header */}
          <div className="flex items-center justify-between px-7 py-5 sticky top-0 z-10" style={{background:'rgba(5,5,16,0.95)',backdropFilter:'blur(12px)',borderBottom:`1px solid ${BORDER}`}}>
            <button onClick={()=>setActiveTask(null)} className="flex items-center gap-2 text-[13px] transition-colors hover:text-white/70" style={{color:'rgba(255,255,255,0.35)'}}>
              <LucideIcon name="arrow-left" size={14}/> Tareas
            </button>
            <div className="flex items-center gap-2">
              {isOwner && (
                confirmDeleteTask
                  ? <div className="flex items-center gap-1">
                      <button onClick={async()=>{try{await data.deleteTask(activeTask.id);setActiveTask(null);showToast('Tarea eliminada')}catch{showToast('Error al eliminar')}}} className="px-3 py-2 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all" style={{background:'rgba(229,29,42,0.15)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR?</button>
                      <button onClick={()=>setConfirmDeleteTask(false)} className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-white/5" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={11} color="rgba(255,255,255,0.3)"/></button>
                    </div>
                  : <button onClick={()=>setConfirmDeleteTask(true)} className="px-3 py-2 rounded-xl font-syne text-[9px] font-black tracking-wide transition-colors" style={{color:'rgba(229,29,42,0.5)',border:`1px solid rgba(229,29,42,0.15)`}}>ELIMINAR</button>
              )}
              <button onClick={async()=>{
                const copy = await data.createTask({text:`${activeTask.text} (copia)`,level:activeTask.level,assigned_to:activeTask.assigned_to,due_date:activeTask.due_date,project_id:activeTask.project_id,client_id:activeTask.client_id,source:'manual'})
                showToast('Tarea duplicada')
                setActiveTask(copy)
                setEditing({text:copy.text,level:copy.level,assigned_to:copy.assigned_to,done:copy.done,due_date:copy.due_date,project_id:copy.project_id})
              }} className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-all hover:opacity-80" style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`}} title="Duplicar tarea">
                <LucideIcon name="copy" size={13} color="rgba(255,255,255,0.35)"/>
              </button>
              <button onClick={saveTask} disabled={saving} className="px-5 py-2.5 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white disabled:opacity-40 transition-all" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
                {saving?'GUARDANDO…':'GUARDAR'}
              </button>
            </div>
          </div>
          {!isMobile && <div className="flex items-center justify-center gap-2 py-2" style={{borderBottom:`1px solid ${BORDER}`}}>
            {(['J/K NAVEGAR','C COMPLETAR','L NIVEL','D FECHA','S GUARDAR'] as const).map((hint,i,arr)=>(
              <span key={hint} className="flex items-center gap-2">
                <span className="font-syne text-[6.5px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.08)'}}>{hint}</span>
                {i<arr.length-1&&<span className="font-syne text-[6px]" style={{color:'rgba(255,255,255,0.05)'}}>·</span>}
              </span>
            ))}
          </div>}

          <div className="p-7 space-y-6">
            {/* Title editable */}
            <div>
              <label className="block font-syne text-[9px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.25)'}}>DESCRIPCION</label>
              <textarea value={editing.text||''} onChange={e=>setEditing(x=>({...x,text:e.target.value}))} rows={3} className="w-full px-5 py-4 rounded-2xl text-[15px] text-white font-medium resize-none outline-none transition-all" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU,lineHeight:'1.5'}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.4)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
            </div>

            {/* Priority */}
            <div>
              <label className="block font-syne text-[9px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.25)'}}>PRIORIDAD</label>
              <div className="flex gap-2">
                {[{v:'urgent',l:'Urgente',c:RED},{v:'high',l:'Alta',c:'rgba(255,176,32,0.9)'},{v:'normal',l:'Normal',c:BLU}].map(p=>(
                  <button key={p.v} onClick={()=>setEditing(x=>({...x,level:p.v as any}))} className="flex-1 py-3 rounded-2xl font-syne text-[10px] font-black tracking-wide transition-all" style={{background:editing.level===p.v?p.c+'18':SURF2,border:`1.5px solid ${editing.level===p.v?p.c+'70':BORDER}`,color:editing.level===p.v?p.c:'rgba(255,255,255,0.3)'}}>
                    {p.l.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Assignee */}
            <div>
              <label className="block font-syne text-[9px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.25)'}}>ASIGNAR A</label>
              <div className="flex flex-wrap gap-2">
                {data.team.map((m: Profile)=>(
                  <button key={m.id} onClick={()=>setEditing(x=>({...x,assigned_to:x.assigned_to===m.id?undefined:m.id}))} className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl transition-all" style={{background:editing.assigned_to===m.id?m.avatar_color+'18':SURF2,border:`1.5px solid ${editing.assigned_to===m.id?m.avatar_color+'55':BORDER}`}}>
                    <div className="w-7 h-7 rounded-full flex items-center justify-center font-syne text-[10px] font-black flex-shrink-0" style={{background:m.avatar_color+'25',color:m.avatar_color}}>{m.initials}</div>
                    <span className="text-[13px]" style={{color:editing.assigned_to===m.id?'rgba(255,255,255,0.9)':'rgba(255,255,255,0.4)'}}>{m.name.split(' ')[0]}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Status */}
            <div>
              <label className="block font-syne text-[9px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.25)'}}>ESTADO</label>
              <div className="flex gap-2">
                {[{v:false,l:'Pendiente',c:'rgba(255,255,255,0.3)'},{v:true,l:'Completada',c:GRN}].map(s=>(
                  <button key={s.l} onClick={()=>setEditing(x=>({...x,done:s.v}))} className="flex-1 py-3 rounded-2xl font-syne text-[10px] font-black tracking-wide transition-all" style={{background:editing.done===s.v?s.c+'18':SURF2,border:`1.5px solid ${editing.done===s.v?s.c+'55':BORDER}`,color:editing.done===s.v?s.c:'rgba(255,255,255,0.3)'}}>
                    {s.l.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Project */}
            {data.projects.length > 0 && (
              <div>
                <label className="block font-syne text-[9px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.25)'}}>PROYECTO</label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={()=>setEditing(x=>({...x,project_id:undefined}))} className="px-3 py-2 rounded-2xl font-syne text-[9px] font-black tracking-wide transition-all" style={{background:!editing.project_id?BLU+'18':SURF2,border:`1.5px solid ${!editing.project_id?BLU+'60':BORDER}`,color:!editing.project_id?BLU:'rgba(255,255,255,0.3)'}}>—</button>
                  {data.projects.filter((p: Project)=>p.status!=='completado').slice(0,8).map((p: Project)=>(
                    <button key={p.id} onClick={()=>setEditing(x=>({...x,project_id:x.project_id===p.id?undefined:p.id}))} className="px-3 py-2 rounded-2xl font-syne text-[9px] font-black tracking-wide transition-all max-w-[160px] truncate" style={{background:editing.project_id===p.id?(p.color||BLU)+'18':SURF2,border:`1.5px solid ${editing.project_id===p.id?(p.color||BLU)+'60':BORDER}`,color:editing.project_id===p.id?(p.color||BLU):'rgba(255,255,255,0.3)'}}>{p.name}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Due date */}
            <div>
              <label className="block font-syne text-[9px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.25)'}}>FECHA LIMITE</label>
              <input ref={dueDateRef} type="date" value={editing.due_date||''} onChange={e=>setEditing(x=>({...x,due_date:e.target.value||undefined}))} className="w-full px-5 py-3 rounded-2xl text-[13px] text-white outline-none transition-all" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU,colorScheme:'dark'}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.4)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
            </div>

            {/* Meta info */}
            <div className="rounded-2xl p-5 space-y-3" style={{background:SURF2,border:`1px solid ${BORDER}`}}>
              {activeTask.source && (
                <div className="flex items-center justify-between">
                  <span className="font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>ORIGEN</span>
                  <span className="font-syne text-[9px] font-black px-2.5 py-1 rounded-lg" style={{background:activeTask.source==='gmail'?'rgba(27,95,250,0.1)':activeTask.source==='whatsapp'?'rgba(37,211,102,0.08)':SURFACE,color:activeTask.source==='gmail'?BLU:activeTask.source==='whatsapp'?'#25D366':'rgba(255,255,255,0.3)'}}>{activeTask.source.toUpperCase()}</span>
                </div>
              )}
              {activeTask.client && (
                <div className="flex items-center justify-between">
                  <span className="font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>CLIENTE</span>
                  <span className="text-[13px]" style={{color:'rgba(255,255,255,0.55)'}}>{activeTask.client.name}</span>
                </div>
              )}
              {activeTask.project_id && (() => { const proj = data.projects.find((p: Project)=>p.id===activeTask.project_id); if (!proj) return null
                const pdl = proj.deadline && proj.deadline!=='TBD' ? dlDate(proj.deadline) : null
                const pdDiff = pdl ? Math.round((pdl.getTime()-Date.now())/86400000) : null
                const pdLabel = pdDiff===null?null:pdDiff<0?`−${Math.abs(pdDiff)}d`:pdDiff===0?'HOY':`${pdDiff}d`
                const pdColor = pdDiff===null?null:pdDiff<0?RED:pdDiff<=7?'rgba(255,176,32,0.9)':'rgba(255,255,255,0.28)'
                return (
                  <div className="flex items-center justify-between">
                    <span className="font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>PROYECTO</span>
                    <div className="flex items-center gap-2">
                      {pdLabel && <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-lg" style={{background:(pdColor||'')+'18',color:pdColor||''}}>{pdLabel}</span>}
                      <span className="text-[12px]" style={{color:(proj.color||BLU)+'cc'}}>{proj.name}</span>
                    </div>
                  </div>
                )
              })()}
              <div className="flex items-center justify-between">
                <span className="font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>CREADA</span>
                <span className="text-[12px]" style={{color:'rgba(255,255,255,0.35)'}}>{new Date(activeTask.created_at).toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'})}</span>
              </div>
            </div>
            <div className="nx-kbd-hints flex items-center justify-center gap-4 pt-2">
              <span className="font-syne text-[7.5px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.1)'}}>⌘+ENTER GUARDAR</span>
              <span className="font-syne text-[7px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.07)'}}>·</span>
              <span className="font-syne text-[7.5px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.1)'}}>J/K NAVEGAR</span>
              <span className="font-syne text-[7px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.07)'}}>·</span>
              <span className="font-syne text-[7.5px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.1)'}}>C ESTADO · D FECHA · L NIVEL</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default TareasSection
