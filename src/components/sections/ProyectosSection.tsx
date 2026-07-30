'use client'

import { useState, useRef, useEffect } from 'react'
import { useIsMobile, BLU, RED, GRN, SURFACE, SURF2, BORDER, LucideIcon, ProgressRing, dlDate } from '@/components/shared'
import type { Project, Task, Profile } from '@/types'

function ProyectosSection({data,filteredProjects,kanbanCols,projView,setProjView,projStatusFilter,setProjStatusFilter,dragRef,selectedId,onSelect,onOpenModal,onSetMf,showToast,isOwner,onNavigate,onSelectClient}: any) {
  const isMobile = useIsMobile()
  const [editProgress, setEditProgress] = useState<number|null>(null)
  const [savingProgress, setSavingProgress] = useState(false)
  const [confirmDeleteProjId, setConfirmDeleteProjId] = useState<string|null>(null)
  const [confirmDeleteDetail, setConfirmDeleteDetail] = useState(false)
  const [projSearch, setProjSearch] = useState('')
  const [projListSort, setProjListSort] = useState<'default'|'deadline'|'progress'|'status'>('default')
  const [quickProjTask, setQuickProjTask] = useState('')
  const [quickProjCreating, setQuickProjCreating] = useState(false)
  const selectedProject: Project|null = selectedId ? data.projects.find((p: Project)=>p.id===selectedId)||null : null
  const projViewRef = useRef<'board'|'list'>('board')
  projViewRef.current = projView
  const selectedProjectRef = useRef<Project|null>(null)
  selectedProjectRef.current = selectedProject
  const progressInputRef = useRef<HTMLInputElement>(null)

  // ── Documento IA (subir PDF + análisis + chat) ──
  const [pdfDoc, setPdfDoc] = useState<{name:string; b64:string}|null>(null)
  const [pdfAnalysis, setPdfAnalysis] = useState<any>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfChat, setPdfChat] = useState<{role:'user'|'ai'; content:string}[]>([])
  const [pdfQ, setPdfQ] = useState('')
  const [pdfChatBusy, setPdfChatBusy] = useState(false)
  const pdfInputRef = useRef<HTMLInputElement>(null)
  useEffect(()=>{ setPdfDoc(null); setPdfAnalysis(null); setPdfChat([]); setPdfQ('') }, [selectedId])
  const analyzePdf = async (b64: string) => {
    setPdfBusy(true)
    try {
      const res = await fetch('/api/projects/analyze-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pdf:b64,projectName:selectedProjectRef.current?.name}),signal:AbortSignal.timeout(60000)})
      const j = await res.json().catch(()=>({}))
      if (!res.ok) { showToast(j.error||'Error al analizar'); return }
      setPdfAnalysis(j.analysis)
    } catch { showToast('Error al analizar el PDF') }
    finally { setPdfBusy(false) }
  }
  const onPickPdf = (file: File) => {
    if (file.type !== 'application/pdf') { showToast('Solo archivos PDF'); return }
    if (file.size > 3_300_000) { showToast('PDF muy grande (máx. ~3MB)'); return }
    const reader = new FileReader()
    reader.onload = () => { const b64 = String(reader.result); setPdfDoc({name:file.name, b64}); setPdfAnalysis(null); setPdfChat([]); analyzePdf(b64) }
    reader.readAsDataURL(file)
  }
  const askPdf = async () => {
    const q = pdfQ.trim(); if (!q || !pdfDoc || pdfChatBusy) return
    setPdfQ(''); setPdfChat(c=>[...c,{role:'user',content:q}]); setPdfChatBusy(true)
    try {
      const res = await fetch('/api/projects/analyze-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pdf:pdfDoc.b64,question:q}),signal:AbortSignal.timeout(60000)})
      const j = await res.json().catch(()=>({}))
      setPdfChat(c=>[...c,{role:'ai',content: res.ok ? (j.answer||'—') : (j.error||'Error al responder')}])
    } catch { setPdfChat(c=>[...c,{role:'ai',content:'Error de conexión'}]) }
    finally { setPdfChatBusy(false) }
  }

  useEffect(() => { setEditProgress(null); setConfirmDeleteDetail(false); setQuickProjTask('') }, [selectedId])

  useEffect(()=>{
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedId) { onSelect(null); return }
      if (['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) || e.metaKey||e.ctrlKey||e.altKey) return
      if (e.key === 'n' && !selectedId) { e.preventDefault(); onOpenModal('proyecto') }
      if (e.key === 'v' && !selectedId) { e.preventDefault(); setProjView(projViewRef.current === 'board' ? 'list' : 'board') }
      if (e.key === 's' && selectedId) {
        e.preventDefault()
        const proj = selectedProjectRef.current
        if (!proj) return
        const statuses = ['plan.','activo','urgente','revisión','completado'] as const
        const curr = statuses.indexOf(proj.status as typeof statuses[number])
        const next = statuses[(curr+1)%statuses.length]
        data.updateProject(proj.id, {status:next}).then(()=>showToast(`Estado: ${next}`)).catch(()=>showToast('Error actualizando estado'))
      }
      if (e.key === 'p' && selectedId) { e.preventDefault(); progressInputRef.current?.focus() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, onSelect, onOpenModal])

  const saveProgress = async () => {
    if (!selectedProject || editProgress === null) return
    setSavingProgress(true)
    try {
      await data.updateProject(selectedProject.id, { progress: editProgress })
      showToast('Progreso actualizado')
    } catch { showToast('Error') }
    finally { setSavingProgress(false) }
  }

  const statusTabs: {id:string;label:string}[] = [
    {id:'Todos',label:'Todos'},
    {id:'plan.',label:'Planificación'},
    {id:'activo',label:'Activo'},
    {id:'urgente',label:'Urgente'},
    {id:'revisión',label:'Revisión'},
    {id:'completado',label:'Completado'},
  ]
  const fmtDate = (s: string) => {
    if (!s || s==='HOY') return s
    const d = new Date(s+'T00:00:00')
    if (isNaN(d.getTime())) return s
    return d.toLocaleDateString('es-ES',{day:'numeric',month:'short'})
  }
  const statusLabel = (s: string) => {
    const m: Record<string,string> = {'activo':'ACTIVO','urgente':'URGENTE','plan.':'PLANIF.','revisión':'REVISIÓN','completado':'COMPLETADO'}
    return m[s] || s.toUpperCase()
  }
  const statusColor = (s: string) => s==='urgente'?RED:s==='activo'?GRN:s==='revisión'?'rgba(167,139,250,0.9)':s==='completado'?'rgba(34,197,94,0.5)':BLU
  const listProjectsSorted: Project[] = (()=>{
    const baseL = filteredProjects.filter((p: Project)=>!projSearch.trim()||p.name.toLowerCase().includes(projSearch.toLowerCase())||(p.client as any)?.name?.toLowerCase().includes(projSearch.toLowerCase()))
    if (projListSort==='progress') return [...baseL].sort((a:Project,b:Project)=>b.progress-a.progress)
    if (projListSort==='deadline') return [...baseL].sort((a:Project,b:Project)=>{const da=a.deadline&&a.deadline!=='TBD'?dlDate(a.deadline).getTime():Infinity;const db=b.deadline&&b.deadline!=='TBD'?dlDate(b.deadline).getTime():Infinity;return da-db})
    if (projListSort==='status') return [...baseL].sort((a:Project,b:Project)=>{const o:Record<string,number>={urgente:0,activo:1,'revisión':2,'plan.':3,completado:4};return (o[a.status]??3)-(o[b.status]??3)})
    return baseL
  })()

  return (
    <div className="p-8">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-3">
        <div>
          <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-2" style={{color:'rgba(255,255,255,0.18)'}}>GESTIÓN</div>
          <h1 className="font-figtree text-[28px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Proyectos</h1>
          <div className="nx-kbd-hints flex items-center gap-2 mt-1.5">
            {(['V VISTA','N NUEVO'] as const).map((hint,i,arr)=>(
              <span key={hint} className="flex items-center gap-2">
                <span className="font-syne text-[7.5px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.1)'}}>{hint}</span>
                {i<arr.length-1&&<span className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.07)'}}>·</span>}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex p-1 rounded-xl" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            {(['board','list'] as const).map(v=>(
              <button key={v} onClick={()=>setProjView(v)} className="px-3 py-2 rounded-lg font-syne text-[9px] font-black tracking-wide transition-all" style={{background:projView===v?SURF2:'transparent',color:projView===v?'rgba(255,255,255,0.9)':'rgba(240,240,248,0.3)'}}>
                {v==='board'?'TABLERO':'LISTA'}
              </button>
            ))}
          </div>
          <button onClick={()=>onOpenModal('proyecto')} className="flex items-center gap-2 px-5 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>+ PROYECTO</button>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-1 p-1 rounded-2xl overflow-x-auto max-w-full" style={{background:SURFACE,border:`1px solid ${BORDER}`,scrollbarWidth:'none'}}>
          {statusTabs.map(s=>{
            const cnt = s.id==='Todos' ? data.projects.length : data.projects.filter((p: Project)=>p.status===s.id).length
            return (
            <button key={s.id} onClick={()=>setProjStatusFilter(s.id)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl font-syne text-[9px] font-black tracking-wide transition-all flex-shrink-0" style={{background:projStatusFilter===s.id?SURF2:'transparent',color:projStatusFilter===s.id?'rgba(255,255,255,0.9)':'rgba(240,240,248,0.28)'}}>
              {s.label.toUpperCase()}
              {cnt > 0 && <span className="text-[7.5px] font-black opacity-60">{cnt}</span>}
            </button>
          )})}
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-2xl" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
          <LucideIcon name="search" size={12} color="rgba(255,255,255,0.2)"/>
          <input value={projSearch} onChange={e=>setProjSearch(e.target.value)} placeholder="Busca proyecto…" className="bg-transparent text-[12px] outline-none w-36" style={{caretColor:BLU,color:'rgba(255,255,255,0.75)'}}/>
          {projSearch && <button onClick={()=>setProjSearch('')}><LucideIcon name="x" size={11} color="rgba(255,255,255,0.2)"/></button>}
        </div>
        {projView==='list'&&(
          <div className="flex items-center gap-0.5 p-1 rounded-xl" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            <span className="font-syne text-[7.5px] font-black tracking-wide px-2" style={{color:'rgba(255,255,255,0.15)'}}>ORDEN</span>
            {([['default','—'],['progress','Progreso'],['deadline','Deadline'],['status','Estado']] as [string,string][]).map(([v,l])=>(
              <button key={v} onClick={()=>setProjListSort(v as 'default'|'deadline'|'progress'|'status')} className="px-2.5 py-1.5 rounded-lg font-syne text-[8px] font-black tracking-wide transition-all" style={{background:projListSort===v?SURF2:'transparent',color:projListSort===v?'rgba(255,255,255,0.85)':'rgba(255,255,255,0.25)'}}>{l}</button>
            ))}
          </div>
        )}
      </div>
      {/* Quick project stats */}
      {data.projects.length > 0 && (()=>{
        const activeP = data.projects.filter((p: Project)=>p.status==='activo'||p.status==='urgente')
        const overdueP = data.projects.filter((p: Project)=>p.deadline&&p.deadline!=='TBD'&&p.status!=='completado'&&dlDate(p.deadline)<new Date())
        const avgProg = activeP.length ? Math.round(activeP.reduce((s: number,p: Project)=>s+p.progress,0)/activeP.length) : null
        return (
          <div className="flex items-center gap-4 mb-6 px-1">
            {avgProg !== null && (
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-24 rounded-full overflow-hidden" style={{background:'rgba(255,255,255,0.06)'}}>
                  <div className="h-full rounded-full" style={{width:`${avgProg}%`,background:`linear-gradient(90deg,${BLU}80,${BLU})`}}/>
                </div>
                <span className="font-syne text-[8.5px] font-black" style={{color:'rgba(255,255,255,0.3)'}}>{avgProg}% AVG ACTIVOS</span>
              </div>
            )}
            {overdueP.length > 0 && (
              <span className="flex items-center gap-1.5 font-syne text-[8.5px] font-black" style={{color:RED+'90'}}>
                <span>⚠</span>{overdueP.length} ATRASADO{overdueP.length>1?'S':''}
              </span>
            )}
            <span className="font-syne text-[8.5px] font-black" style={{color:'rgba(255,255,255,0.15)'}}>{data.projects.filter((p:Project)=>p.status==='completado').length} COMPLETADO{data.projects.filter((p:Project)=>p.status==='completado').length!==1?'S':''}</span>
          </div>
        )
      })()}
      {projView === 'board' ? (
        <div className="grid gap-4" style={{gridTemplateColumns:`repeat(${kanbanCols.length},${isMobile?'260px':'minmax(0,1fr)'})`,overflowX:isMobile?'auto':'visible',WebkitOverflowScrolling:'touch'}}>
          {kanbanCols.map((col: any)=>(
            <div key={col.status} className="rounded-2xl overflow-hidden" style={{background:col.status==='completado'?'rgba(255,255,255,0.01)':SURFACE,border:`1px solid ${col.status==='completado'?'rgba(255,255,255,0.04)':BORDER}`,opacity:col.status==='completado'?0.65:1}}
              onDragOver={(e)=>e.preventDefault()}
              onDrop={()=>{ if(dragRef.current) { const id=dragRef.current; dragRef.current=null; data.updateProject(id,{status:col.status}).then(()=>showToast(`Movido a ${col.title}`)).catch(()=>showToast('Error al mover')) }}}>
              <div style={{height:'2px',background:`linear-gradient(90deg,${col.color}70,transparent)`}}/>
              <div className="flex items-center gap-2.5 px-5 py-3.5" style={{borderBottom:`1px solid ${BORDER}`}}>
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:col.color,boxShadow:`0 0 6px ${col.color}80`}}/>
                <span className="font-syne text-[8.5px] font-black tracking-widest uppercase flex-1" style={{color:'rgba(255,255,255,0.38)'}}>{col.title}</span>
                <span className="font-syne text-[11px] font-black px-2 py-0.5 rounded-full" style={{background:col.color+'15',color:col.color+'99'}}>{projSearch.trim()?col.items.filter((p: Project)=>p.name.toLowerCase().includes(projSearch.toLowerCase())||(p.client as any)?.name?.toLowerCase().includes(projSearch.toLowerCase())).length:col.items.length}</span>
              </div>
              <div className="p-3 space-y-2">
                {col.items.filter((p: Project)=>!projSearch.trim()||p.name.toLowerCase().includes(projSearch.toLowerCase())||(p.client as any)?.name?.toLowerCase().includes(projSearch.toLowerCase())).map((p: Project)=>(
                  <div key={p.id} draggable onDragStart={()=>dragRef.current=p.id} onClick={()=>onSelect(selectedId===p.id?null:p.id)} className="rounded-xl cursor-pointer transition-all overflow-hidden" style={{background:selectedId===p.id?`rgba(27,95,250,0.06)`:SURF2,border:`1px solid ${selectedId===p.id?'rgba(27,95,250,0.35)':BORDER}`,boxShadow:selectedId===p.id?`0 0 16px ${p.color||BLU}1A`:'none'}}>
                    <div style={{height:'3px',background:`linear-gradient(90deg,${p.color||BLU}90,${p.color||BLU}20,transparent)`}}/>
                    <div className="p-4">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="relative flex-shrink-0">
                          <ProgressRing pct={p.progress} size={36} stroke={2.5} color={p.color||BLU}/>
                          <div className="absolute inset-0 flex items-center justify-center font-syne text-[7.5px] font-black" style={{color:p.color||'rgba(255,255,255,0.5)'}}>{p.progress}</div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-figtree text-[13px] font-semibold leading-snug mb-0.5" style={{color:'rgba(240,240,248,0.9)'}}>{p.name}</div>
                          <div className="text-[10px]" style={{color:'rgba(255,255,255,0.28)'}}>{p.client?.name||'—'}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {p.deadline && p.deadline!=='TBD' && (()=>{
                          const dOver = dlDate(p.deadline)<new Date()
                          const dSoon = !dOver && dlDate(p.deadline)<new Date(Date.now()+7*24*3600*1000)
                          const diffDays = Math.round(Math.abs(dlDate(p.deadline).getTime()-Date.now())/(1000*60*60*24))
                          const dLabel = dOver ? `−${diffDays}d` : diffDays===0 ? 'HOY' : `+${diffDays}d`
                          return <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full" style={{background:dOver?`${RED}18`:dSoon?'rgba(255,176,32,0.12)':'rgba(255,255,255,0.04)',color:dOver?RED:dSoon?'rgba(255,176,32,0.9)':'rgba(255,255,255,0.3)'}}>{dLabel}</span>
                        })()}
                        {(()=>{ const n=data.tasks.filter((t:Task)=>t.project_id===p.id&&!t.done).length; if(n>0) return <span className="font-syne text-[7.5px] font-black px-1.5 py-0.5 rounded-full" style={{background:'rgba(27,95,250,0.08)',color:'rgba(100,140,255,0.65)'}}>{n} tareas</span>; if(p.status!=='completado'&&p.status!=='plan.') return <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full" style={{background:'rgba(255,176,32,0.07)',color:'rgba(255,176,32,0.5)'}}>sin tareas</span>; return null })()}
                      </div>
                    </div>
                  </div>
                ))}
                {col.items.length===0&&<div className="py-8 text-center text-[11px]" style={{color:'rgba(255,255,255,0.12)'}}>Arrastra aquí</div>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
          {listProjectsSorted.map((p: Project, i: number, arr: Project[])=>(
            <div key={p.id} onClick={()=>onSelect(selectedId===p.id?null:p.id)} className={`group flex items-center gap-4 px-6 py-4 transition-colors cursor-pointer${isMobile?' flex-wrap gap-y-2':''}`} style={{borderBottom:i<arr.length-1?`1px solid ${BORDER}`:'none',borderLeft:`3px solid ${selectedId===p.id?p.color||BLU:(p.color||BLU)+'35'}`,background:selectedId===p.id?`${p.color||BLU}08`:'transparent'}}
              onMouseEnter={e=>{ if(selectedId!==p.id)(e.currentTarget.style.background='rgba(255,255,255,0.015)') }}
              onMouseLeave={e=>{ if(selectedId!==p.id)(e.currentTarget.style.background='transparent') }}>
              <div className="relative flex-shrink-0">
                <ProgressRing pct={p.progress} size={34} stroke={2.5} color={p.color||BLU}/>
                <div className="absolute inset-0 flex items-center justify-center font-syne text-[7.5px] font-black" style={{color:'rgba(255,255,255,0.5)'}}>{p.progress}</div>
              </div>
              <div className="flex-1 min-w-0" style={isMobile?{flexBasis:'calc(100% - 60px)'}:undefined}>
                <div className="font-figtree text-[14px] font-semibold text-white/88 truncate">{p.name}</div>
                <div className="text-[11px] mt-0.5 truncate" style={{color:'rgba(255,255,255,0.3)'}}>{p.client?.name||'—'}</div>
              </div>
              <span className="font-syne text-[8px] font-black px-2.5 py-1 rounded-full flex-shrink-0" style={{background:statusColor(p.status)+'14',color:statusColor(p.status)}}>{statusLabel(p.status)}</span>
              {p.deadline && p.deadline!=='TBD' && (()=>{
                const dOver = dlDate(p.deadline)<new Date()
                const dSoon = !dOver && dlDate(p.deadline)<new Date(Date.now()+7*24*3600*1000)
                const diffDays = Math.round(Math.abs(dlDate(p.deadline).getTime()-Date.now())/(1000*60*60*24))
                const dLabel = dOver ? `−${diffDays}d` : diffDays===0 ? 'HOY' : `${diffDays}d`
                return <span className="font-syne text-[9px] font-black flex-shrink-0 px-1.5 py-0.5 rounded-full" style={{background:dOver?`${RED}18`:dSoon?'rgba(255,176,32,0.1)':'transparent',color:dOver?RED:dSoon?'rgba(255,176,32,0.85)':'rgba(255,255,255,0.28)'}}>{dLabel}</span>
              })()}
              {(()=>{ const n=data.tasks.filter((t:Task)=>t.project_id===p.id&&!t.done).length; if(n>0) return <span className="font-syne text-[7.5px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:'rgba(27,95,250,0.08)',color:'rgba(100,140,255,0.55)'}}>{n}t</span>; if(p.status!=='completado'&&p.status!=='plan.') return <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:'rgba(255,176,32,0.07)',color:'rgba(255,176,32,0.5)'}}>SIN TAREAS</span>; return null })()}
              {isOwner && (
                confirmDeleteProjId === p.id
                  ? <div className="flex items-center gap-1 flex-shrink-0" onClick={e=>e.stopPropagation()}>
                      <button onClick={()=>{ data.deleteProject(p.id).then(()=>showToast('Proyecto eliminado')).catch(()=>showToast('Error al eliminar')); setConfirmDeleteProjId(null) }} className="px-2 py-1 rounded-lg font-syne text-[7.5px] font-black" style={{background:'rgba(229,29,42,0.15)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR?</button>
                      <button onClick={()=>setConfirmDeleteProjId(null)} className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/5" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={10} color="rgba(255,255,255,0.3)"/></button>
                    </div>
                  : <button onClick={e=>{e.stopPropagation();setConfirmDeleteProjId(p.id)}} className="opacity-0 group-hover:opacity-60 transition-opacity flex-shrink-0"><LucideIcon name="trash" size={13} color={RED}/></button>
              )}
            </div>
          ))}
          {listProjectsSorted.length===0&&<div className="py-16 text-center text-[13px]" style={{color:'rgba(255,255,255,0.18)'}}>{projSearch?'Sin resultados':' Sin proyectos en este filtro'}</div>}
        </div>
      )}

      {/* Project detail drawer */}
      {selectedProject && (
        <div className="mt-6 rounded-2xl p-6 transition-all" style={{background:SURFACE,border:`1px solid ${selectedProject.color||BLU}30`,boxShadow:`0 0 40px ${selectedProject.color||BLU}0D`}}>
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="relative flex-shrink-0">
                <ProgressRing pct={editProgress??selectedProject.progress} size={52} stroke={3} color={selectedProject.color||BLU}/>
                <div className="absolute inset-0 flex items-center justify-center font-syne text-[10px] font-black" style={{color:selectedProject.color||BLU}}>{editProgress??selectedProject.progress}%</div>
              </div>
              <div>
                <div className="font-figtree text-[18px] font-black text-white leading-none mb-1" style={{letterSpacing:'-0.02em'}}>{selectedProject.name}</div>
                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                  {selectedProject.client ? (
                    <button onClick={()=>{const cid=(selectedProject.client as any)?.id;if(cid){onSelectClient?.(cid);onNavigate?.('clientes')}}} className="text-[12px] transition-all hover:opacity-70" style={{color:'rgba(255,255,255,0.3)'}}>{(selectedProject.client as any).name}</button>
                  ) : (
                    <span className="text-[12px]" style={{color:'rgba(255,255,255,0.2)'}}>Sin cliente</span>
                  )}
                  {selectedProject.deadline&&selectedProject.deadline!=='TBD'&&(()=>{
                    const dl = dlDate(selectedProject.deadline)
                    const dOver = dl < new Date()
                    const dSoon = !dOver && dl < new Date(Date.now()+7*24*3600*1000)
                    const diffMs = dl.getTime() - Date.now()
                    const diffDays = Math.round(Math.abs(diffMs)/(1000*60*60*24))
                    const daysLabel = dOver ? `hace ${diffDays}d` : diffDays === 0 ? 'HOY' : `en ${diffDays}d`
                    return (
                      <span className="flex items-center gap-1.5 font-syne text-[8px] font-black px-2 py-1 rounded-full" style={{background:dOver?`${RED}18`:dSoon?'rgba(255,176,32,0.1)':'rgba(255,255,255,0.04)',color:dOver?RED:dSoon?'rgba(255,176,32,0.85)':'rgba(255,255,255,0.3)'}}>
                        {dOver&&'⚠ '}Deadline {fmtDate(selectedProject.deadline)}
                        <span className="font-black" style={{color:dOver?RED+'cc':dSoon?'rgba(255,176,32,0.7)':'rgba(255,255,255,0.2)',opacity:0.9}}>· {daysLabel}</span>
                      </span>
                    )
                  })()}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={()=>{ onSetMf?.({cliente:selectedProject.client?.name||''}); onOpenModal('tarea') }} className="flex items-center gap-2 px-3 py-2 rounded-xl font-syne text-[8.5px] font-black tracking-wide transition-all" style={{background:'rgba(27,95,250,0.08)',color:BLU,border:`1px solid rgba(27,95,250,0.18)`}}>
                <LucideIcon name="plus" size={11} color={BLU}/>TAREA
              </button>
              {isOwner && (
                confirmDeleteDetail
                  ? <div className="flex items-center gap-1">
                      <button onClick={()=>data.deleteProject(selectedProject.id).then(()=>{onSelect(null);showToast('Proyecto eliminado')}).catch(()=>showToast('Error al eliminar'))} className="px-2.5 py-2 rounded-xl font-syne text-[8px] font-black transition-all" style={{background:'rgba(229,29,42,0.15)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR?</button>
                      <button onClick={()=>setConfirmDeleteDetail(false)} className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={12} color="rgba(255,255,255,0.3)"/></button>
                    </div>
                  : <button onClick={()=>setConfirmDeleteDetail(true)} className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5" style={{background:'rgba(229,29,42,0.06)',color:'rgba(229,29,42,0.45)',border:`1px solid rgba(229,29,42,0.12)`}}>
                      <LucideIcon name="trash" size={12} color="rgba(229,29,42,0.45)"/>
                    </button>
              )}
              <button onClick={()=>onSelect(null)} className="w-8 h-8 rounded-xl flex items-center justify-center" style={{background:'rgba(255,255,255,0.05)'}}>
                <LucideIcon name="x" size={13} color="rgba(255,255,255,0.35)"/>
              </button>
            </div>
          </div>
          {/* Status pills */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <div className="font-syne text-[8px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.25)'}}>ESTADO</div>
              <span className="font-syne text-[7px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.08)'}}>S CICLAR</span>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {[{s:'plan.',l:'Planif.',c:'rgba(255,255,255,0.4)'},{s:'activo',l:'Activo',c:GRN},{s:'urgente',l:'Urgente',c:RED},{s:'revisión',l:'Revisión',c:'rgba(167,139,250,0.9)'},{s:'completado',l:'Completado',c:'rgba(34,197,94,0.6)'}].map(opt=>(
                <button key={opt.s} onClick={async()=>{ try{await data.updateProject(selectedProject.id,{status:opt.s});showToast(`Estado: ${opt.l}`)}catch{showToast('Error al actualizar')} }} className="px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all" style={{background:selectedProject.status===opt.s?opt.c+'18':SURF2,border:`1px solid ${selectedProject.status===opt.s?opt.c+'50':BORDER}`,color:selectedProject.status===opt.s?opt.c:'rgba(255,255,255,0.3)'}}>{opt.l.toUpperCase()}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-6 items-end">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="font-syne text-[8px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.25)'}}>PROGRESO</div>
                <span className="font-syne text-[10px] font-black" style={{color:selectedProject.color||BLU}}>{editProgress??selectedProject.progress}%</span>
              </div>
              <input ref={progressInputRef} type="range" min={0} max={100} step={5} value={editProgress??selectedProject.progress}
                onChange={e=>setEditProgress(Number(e.target.value))}
                className="w-full h-1.5 rounded-full outline-none cursor-pointer appearance-none"
                style={{accentColor:selectedProject.color||BLU,background:`linear-gradient(to right,${selectedProject.color||BLU} ${editProgress??selectedProject.progress}%,rgba(255,255,255,0.1) ${editProgress??selectedProject.progress}%)`}}
              />
            </div>
            <div className="flex gap-2">
              {(() => {
                const allPT = data.tasks.filter((t: Task) => t.project_id === selectedProject.id)
                const donePT = allPT.filter((t: Task) => t.done)
                const autoPct = allPT.length > 0 ? Math.round((donePT.length/allPT.length)*100) : null
                return autoPct !== null ? (
                  <button onClick={()=>setEditProgress(autoPct)} className="px-3 py-2 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all" style={{color:'rgba(255,255,255,0.4)',border:`1px solid ${BORDER}`}} title={`${donePT.length}/${allPT.length} tareas completadas`}>AUTO {autoPct}%</button>
                ) : null
              })()}
              {editProgress !== null && editProgress !== selectedProject.progress && (
                <button onClick={saveProgress} disabled={savingProgress} className="px-4 py-2 rounded-xl font-syne text-[9px] font-black tracking-widest text-white disabled:opacity-40" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>{savingProgress?'…':'GUARDAR'}</button>
              )}
            </div>
          </div>
          {/* Related tasks + quick add */}
          {(()=>{
            const projTasks = data.tasks.filter((t: Task) => !t.done && (t.project_id === selectedProject.id || t.client_id === selectedProject.client_id))
            return (
              <div className="mt-5 pt-5" style={{borderTop:`1px solid ${BORDER}`}}>
                <div className="font-syne text-[8px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.2)'}}>TAREAS ACTIVAS</div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3" style={{background:'rgba(255,255,255,0.02)',border:`1px dashed ${BORDER}`}}>
                  <LucideIcon name="plus-circle" size={11} color="rgba(255,255,255,0.15)"/>
                  <input value={quickProjTask} onChange={e=>setQuickProjTask(e.target.value)} onKeyDown={async e=>{if(e.key==='Enter'&&quickProjTask.trim()&&!quickProjCreating){setQuickProjCreating(true);try{await data.createTask({text:quickProjTask.trim(),level:'normal',project_id:selectedProject.id,client_id:selectedProject.client_id||undefined,source:'manual'});setQuickProjTask('');showToast('Tarea creada')}catch{showToast('Error')}finally{setQuickProjCreating(false)}}}} placeholder="Añadir tarea… (Enter)" disabled={quickProjCreating} className="flex-1 bg-transparent text-[11.5px] outline-none disabled:opacity-40" style={{caretColor:selectedProject.color||BLU,color:'rgba(255,255,255,0.55)'}}/>
                </div>
                {projTasks.length > 0 && (
                  <div className="space-y-2">
                    {projTasks.slice(0,6).map((t: Task)=>{
                      const tc = t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.85)':BLU
                      const ptodayStr = new Date().toISOString().split('T')[0]
                      const ptIsToday = t.due_date && t.due_date.slice(0,10) === ptodayStr
                      const ptOver = t.due_date && !ptIsToday && new Date(t.due_date+'T23:59:59') < new Date()
                      return (
                        <div key={t.id} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{background:tc+'10',border:`1px solid ${tc}25`}}>
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:tc}}/>
                          <span className="text-[11.5px] flex-1 truncate" style={{color:'rgba(255,255,255,0.65)'}}>{t.text}</span>
                          {t.due_date && <span className="font-syne text-[7.5px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:ptIsToday?'rgba(255,176,32,0.15)':ptOver?`${RED}18`:'rgba(255,255,255,0.05)',color:ptIsToday?'rgba(255,176,32,0.9)':ptOver?RED:'rgba(255,255,255,0.25)'}}>{ptIsToday?'HOY':new Date(t.due_date+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'})}</span>}
                          {t.assignee && <div className="w-5 h-5 rounded-full flex items-center justify-center font-syne text-[7px] font-black flex-shrink-0" style={{background:t.assignee.avatar_color+'22',color:t.assignee.avatar_color}}>{t.assignee.initials}</div>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })()}
          {/* Assignee avatars */}
          {(()=>{
            const seen = new Set<string>()
            const assignees: Profile[] = []
            data.tasks.filter((t: Task)=>t.project_id===selectedProject.id&&!t.done&&t.assignee).forEach((t: Task)=>{
              if (t.assignee && !seen.has(t.assignee.id)) { seen.add(t.assignee.id); assignees.push(t.assignee) }
            })
            if (!assignees.length) return null
            return (
              <div className="mt-4 pt-4 flex items-center gap-3" style={{borderTop:`1px solid ${BORDER}`}}>
                <span className="font-syne text-[8px] font-black tracking-widest flex-shrink-0" style={{color:'rgba(255,255,255,0.2)'}}>EQUIPO</span>
                <div className="flex items-center gap-2 flex-wrap">
                  {assignees.map((a: Profile)=>(
                    <div key={a.id} title={a.name} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl" style={{background:a.avatar_color+'12',border:`1px solid ${a.avatar_color}25`}}>
                      <div className="w-5 h-5 rounded-full flex items-center justify-center font-syne text-[7px] font-black flex-shrink-0" style={{background:a.avatar_color+'28',color:a.avatar_color}}>{a.initials}</div>
                      <span className="font-syne text-[8.5px] font-black" style={{color:a.avatar_color+'cc'}}>{a.name.split(' ')[0]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* ── DOCUMENTO · ANÁLISIS IA ── */}
          <div className="mt-5 pt-5" style={{borderTop:`1px solid ${BORDER}`}}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-syne text-[8px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>DOCUMENTO · ANÁLISIS IA</div>
              {pdfDoc && <span className="font-syne text-[7.5px] truncate ml-3" style={{color:'rgba(255,255,255,0.3)',maxWidth:'180px'}}>{pdfDoc.name}</span>}
            </div>
            <input ref={pdfInputRef} type="file" accept="application/pdf" className="hidden" onChange={e=>{const f=e.target.files?.[0]; if(f) onPickPdf(f); e.target.value=''}}/>
            {!pdfDoc ? (
              <button onClick={()=>pdfInputRef.current?.click()} className="w-full flex flex-col items-center gap-2 py-6 rounded-2xl transition-all hover:bg-white/[0.02]" style={{background:'rgba(255,255,255,0.02)',border:`1px dashed ${BORDER}`}}>
                <LucideIcon name="upload" size={18} color={BLU}/>
                <span className="font-figtree text-[12px]" style={{color:'rgba(255,255,255,0.5)'}}>Sube un PDF y la IA lo analiza</span>
                <span className="font-syne text-[7px] tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>RESUMEN · PUNTOS · ACCIONES · DATOS · CHAT</span>
              </button>
            ) : (
              <div className="space-y-3">
                {pdfBusy && !pdfAnalysis && (
                  <div className="flex items-center gap-2 py-5 justify-center">
                    <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{borderColor:'rgba(255,255,255,0.15)',borderTopColor:BLU}}/>
                    <span className="font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.4)'}}>ANALIZANDO DOCUMENTO…</span>
                  </div>
                )}
                {pdfAnalysis && (<>
                  {pdfAnalysis.summary && (
                    <div className="rounded-2xl p-4" style={{background:'rgba(27,95,250,0.05)',border:`1px solid rgba(27,95,250,0.15)`}}>
                      <div className="flex items-center gap-2 mb-2"><LucideIcon name="sparkles" size={12} color={BLU}/><span className="font-syne text-[8px] font-black tracking-widest" style={{color:'rgba(120,155,255,0.85)'}}>RESUMEN EJECUTIVO</span></div>
                      <p className="font-figtree text-[12.5px] leading-relaxed" style={{color:'rgba(255,255,255,0.72)'}}>{pdfAnalysis.summary}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    {pdfAnalysis.keyPoints?.length>0 && (
                      <div className="rounded-2xl p-4" style={{background:'rgba(255,255,255,0.02)',border:`1px solid ${BORDER}`}}>
                        <div className="font-syne text-[7.5px] font-black tracking-widest mb-2.5" style={{color:'rgba(255,255,255,0.25)'}}>PUNTOS CLAVE</div>
                        <div className="space-y-1.5">{pdfAnalysis.keyPoints.slice(0,6).map((k:string,i:number)=><div key={i} className="flex items-start gap-2"><div className="rounded-full flex-shrink-0" style={{width:5,height:5,marginTop:6,background:BLU}}/><span className="font-figtree text-[11.5px] leading-snug" style={{color:'rgba(255,255,255,0.6)'}}>{k}</span></div>)}</div>
                      </div>
                    )}
                    {pdfAnalysis.actions?.length>0 && (
                      <div className="rounded-2xl p-4" style={{background:'rgba(255,255,255,0.02)',border:`1px solid ${BORDER}`}}>
                        <div className="font-syne text-[7.5px] font-black tracking-widest mb-2.5" style={{color:'rgba(34,197,94,0.6)'}}>ACCIONES · toca para crear tarea</div>
                        <div className="space-y-1.5">{pdfAnalysis.actions.slice(0,6).map((a:string,i:number)=>(
                          <button key={i} onClick={async()=>{try{await data.createTask({text:a,level:'normal',project_id:selectedProject.id,client_id:selectedProject.client_id||undefined,source:'ai'});showToast('Tarea creada')}catch{showToast('Error')}}} className="w-full text-left flex items-start gap-2 transition-opacity hover:opacity-70">
                            <LucideIcon name="plus-circle" size={12} color="rgba(34,197,94,0.6)"/><span className="font-figtree text-[11.5px] leading-snug flex-1" style={{color:'rgba(255,255,255,0.6)'}}>{a}</span></button>
                        ))}</div>
                      </div>
                    )}
                  </div>
                  {pdfAnalysis.data && (pdfAnalysis.data.client||pdfAnalysis.data.budget||pdfAnalysis.data.dates||pdfAnalysis.data.deliverables?.length>0) && (
                    <div className="rounded-2xl p-4" style={{background:'rgba(255,255,255,0.02)',border:`1px solid ${BORDER}`}}>
                      <div className="font-syne text-[7.5px] font-black tracking-widest mb-2.5" style={{color:'rgba(255,255,255,0.25)'}}>DATOS DEL PROYECTO</div>
                      <div className="flex flex-wrap gap-2">
                        {pdfAnalysis.data.client && <span className="font-syne text-[9px] px-2.5 py-1 rounded-lg" style={{background:`${BLU}12`,color:`${BLU}dd`}}>Cliente: {pdfAnalysis.data.client}</span>}
                        {pdfAnalysis.data.budget && <span className="font-syne text-[9px] px-2.5 py-1 rounded-lg" style={{background:'rgba(34,197,94,0.1)',color:'rgba(34,197,94,0.85)'}}>Presupuesto: {pdfAnalysis.data.budget}</span>}
                        {pdfAnalysis.data.dates && <span className="font-syne text-[9px] px-2.5 py-1 rounded-lg" style={{background:'rgba(167,139,250,0.1)',color:'rgba(167,139,250,0.85)'}}>Fechas: {pdfAnalysis.data.dates}</span>}
                        {Array.isArray(pdfAnalysis.data.deliverables)&&pdfAnalysis.data.deliverables.map((d:string,i:number)=><span key={i} className="font-syne text-[9px] px-2.5 py-1 rounded-lg" style={{background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.5)'}}>{d}</span>)}
                      </div>
                    </div>
                  )}
                  <div className="rounded-2xl overflow-hidden" style={{background:'rgba(255,255,255,0.02)',border:`1px solid ${BORDER}`}}>
                    <div className="px-4 py-2.5 font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.25)',borderBottom:`1px solid ${BORDER}`}}>PREGUNTA AL DOCUMENTO</div>
                    {pdfChat.length>0 && (
                      <div className="px-4 py-3 space-y-2.5 overflow-y-auto" style={{maxHeight:'220px'}}>
                        {pdfChat.map((m,i)=>(
                          <div key={i} className={m.role==='user'?'flex justify-end':'flex justify-start'}>
                            <div className="px-3 py-2 rounded-xl font-figtree text-[12px] leading-relaxed whitespace-pre-wrap" style={m.role==='user'?{maxWidth:'85%',background:`${BLU}18`,color:'rgba(255,255,255,0.85)'}:{maxWidth:'85%',background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.7)'}}>{m.content}</div>
                          </div>
                        ))}
                        {pdfChatBusy && <div className="flex gap-1.5 px-1 py-1">{[0,1,2].map(i=><div key={i} className="w-1.5 h-1.5 rounded-full" style={{background:BLU,animation:`pulse ${0.6+i*0.1}s ease-in-out ${i*0.1}s infinite alternate`}}/>)}</div>}
                      </div>
                    )}
                    <form onSubmit={e=>{e.preventDefault();askPdf()}} className="flex items-center gap-2 px-3 py-2.5" style={{borderTop:pdfChat.length>0?`1px solid ${BORDER}`:'none'}}>
                      <input value={pdfQ} onChange={e=>setPdfQ(e.target.value)} disabled={pdfChatBusy} placeholder="¿Cuál es el presupuesto? ¿Qué plazos hay?…" className="flex-1 bg-transparent outline-none font-figtree text-[12.5px] disabled:opacity-40" style={{color:'rgba(255,255,255,0.75)',caretColor:BLU}}/>
                      <button type="submit" disabled={pdfChatBusy||!pdfQ.trim()} className="w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-30" style={{background:BLU}}><LucideIcon name="arrow-right" size={14} color="white"/></button>
                    </form>
                  </div>
                  <button onClick={()=>{setPdfDoc(null);setPdfAnalysis(null);setPdfChat([])}} className="w-full py-2 font-syne text-[8px] font-black tracking-widest transition-opacity hover:opacity-60" style={{color:'rgba(255,255,255,0.2)'}}>QUITAR DOCUMENTO</button>
                </>)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default ProyectosSection
