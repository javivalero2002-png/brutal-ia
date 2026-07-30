'use client'
import { useState, useEffect } from 'react'
import { BLU, RED, GRN, SURFACE, SURF2, BORDER } from '@/components/shared/design-tokens'
import { useIsMobile } from '@/components/shared/hooks'
import { dlDate, dlLabel, strColor, relTime } from '@/components/shared/helpers'
import { ProgressRing } from '@/components/shared/ui'
import LucideIcon from '@/components/shared/LucideIcon'
import { PlatformLogo } from '@/components/PlatformLogo'
import type { Client, Project, Task } from '@/types'

export default function ClientesSection({data,selectedId,onSelect,onOpenModal,onSetMf,showToast,isOwner,onNavigate,onSelectProject}: any) {
  const isMobile = useIsMobile()
  const [aiAdvice, setAiAdvice] = useState<any[]|null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [expandedProject, setExpandedProject] = useState<string|null>(null)
  const [comments, setComments] = useState<any[]|null>(null)
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [postingComment, setPostingComment] = useState(false)
  const [clientEditOpen, setClientEditOpen] = useState(false)
  const [editRevenue, setEditRevenue] = useState('')
  const [editIndustry, setEditIndustry] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [savingClient, setSavingClient] = useState(false)
  const [confirmDeleteClient, setConfirmDeleteClient] = useState(false)
  const [clientSearch, setClientSearch] = useState('')
  const [clientStatusFilter, setClientStatusFilter] = useState('Todos')
  const [clientSort, setClientSort] = useState<'default'|'revenue'|'tareas'|'proyectos'>('default')

  const selected = selectedId ? data.clients.find((c: Client)=>c.id===selectedId) : null

  useEffect(() => { setClientEditOpen(false); setConfirmDeleteClient(false) }, [selectedId])

  useEffect(()=>{
    const handler = (e: KeyboardEvent) => {
      if (['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) || e.metaKey||e.ctrlKey||e.altKey) return
      if (e.key === 'Escape') { if (clientEditOpen) { setClientEditOpen(false); return } if (selected) { onSelect(null); return } }
      if (e.key === 'n' && !selected && isOwner) { e.preventDefault(); onOpenModal('cliente') }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientEditOpen, selected, isOwner])

  const loadComments = async (id: string) => {
    setCommentsLoading(true)
    try {
      const r = await fetch(`/api/clients/${id}/comments`)
      setComments(await r.json())
    } catch { setComments([]) }
    finally { setCommentsLoading(false) }
  }

  const postComment = async () => {
    if (!newComment.trim() || !selected) return
    setPostingComment(true)
    try {
      const r = await fetch(`/api/clients/${selected.id}/comments`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:newComment.trim()})})
      const c = await r.json()
      setComments(prev => [...(prev||[]), c])
      setNewComment('')
    } catch { showToast('Error al publicar') }
    finally { setPostingComment(false) }
  }

  const loadAiAdvice = async (id: string) => {
    setAiLoading(true)
    try {
      const r = await fetch(`/api/clients/${id}/ai-advice`, {method:'POST'})
      const d = await r.json()
      setAiAdvice(d.recommendations || [])
    } catch { showToast('Error generando recomendaciones') }
    finally { setAiLoading(false) }
  }

  const handleBack = () => { onSelect(null); setAiAdvice(null); setComments(null); setExpandedProject(null) }

  if (selected) {
    const clientProjects = data.projects.filter((p: Project)=>p.client_id===selected.id)
    const clientTasks = data.tasks.filter((t: Task)=>t.client_id===selected.id)
    const activeTasks = clientTasks.filter((t: Task)=>!t.done).sort((a: Task,b: Task)=>{ const lp=(l: string)=>l==='urgent'?0:l==='high'?1:2; return lp(a.level)-lp(b.level) })
    const doneTasks = clientTasks.filter((t: Task)=>t.done)
    const urgentTasks = activeTasks.filter((t: Task)=>t.level==='urgent')
    const activeProjects = clientProjects.filter((p: Project)=>p.status==='activo'||p.status==='urgente')
    const avgProgress = clientProjects.length ? Math.round(clientProjects.reduce((s: number,p: Project)=>s+p.progress,0)/clientProjects.length) : 0
    const clientContent = data.agenda.filter((a: any)=>a.client?.id===selected.id||a.client_id===selected.id)

    return (
      <div className="p-8 max-w-[1100px] mx-auto">
        <button onClick={handleBack} className="flex items-center gap-2 text-[12px] mb-8 transition-colors hover:text-white/70" style={{color:'rgba(255,255,255,0.35)'}}>
          <LucideIcon name="arrow-left" size={14}/> Todos los clientes
        </button>

        <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
          <div className="flex items-center gap-5 min-w-0">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center font-syne text-xl font-black flex-shrink-0" style={{background:selected.color+'18',border:`2px solid ${selected.color}35`,color:selected.color}}>{selected.initials}</div>
            <div>
              <div className="font-syne text-[9px] font-black tracking-widest mb-1" style={{color:'rgba(255,255,255,0.2)'}}>{(selected.industry||'').toUpperCase()}</div>
              <h1 className="font-figtree text-[28px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>{selected.name}</h1>
              {isOwner ? (
                <div className="flex items-center gap-1.5 mt-2">
                  {([{s:'Activo',c:GRN},{s:'Pausado',c:'rgba(255,176,32,0.85)'},{s:'Archivado',c:'rgba(255,255,255,0.35)'}] as {s:'Activo'|'Pausado'|'Archivado';c:string}[]).map(opt=>(
                    <button key={opt.s} onClick={async()=>{try{await data.updateClient(selected.id,{status:opt.s});showToast(`Estado: ${opt.s}`)}catch{showToast('Error al actualizar')}}} className="px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all" style={{background:selected.status===opt.s?opt.c+'18':'rgba(255,255,255,0.03)',border:`1px solid ${selected.status===opt.s?opt.c+'50':'rgba(255,255,255,0.08)'}`,color:selected.status===opt.s?opt.c:'rgba(255,255,255,0.3)'}}>{opt.s.toUpperCase()}</button>
                  ))}
                </div>
              ) : (
                <span className="font-syne text-[8px] font-black px-3 py-1 rounded-full mt-2 inline-block" style={{background:selected.status==='Activo'?'rgba(34,197,94,0.1)':'rgba(255,255,255,0.05)',color:selected.status==='Activo'?GRN:'rgba(255,255,255,0.3)'}}>{selected.status.toUpperCase()}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={()=>{ onSetMf?.({cliente:selected.name}); onOpenModal('tarea') }} className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-wide transition-all" style={{background:'rgba(27,95,250,0.08)',color:BLU,border:`1px solid rgba(27,95,250,0.18)`}}>
              <LucideIcon name="check-square" size={11} color={BLU}/>+ TAREA
            </button>
            {isOwner && <button onClick={()=>{ onSetMf?.({cliente:selected.name}); onOpenModal('proyecto') }} className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-wide transition-all" style={{background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.4)',border:`1px solid ${BORDER}`}}>
              <LucideIcon name="folder-open" size={11} color="rgba(255,255,255,0.4)"/>+ PROYECTO
            </button>}
            <button onClick={()=>{ setAiAdvice(null); loadAiAdvice(selected.id) }} disabled={aiLoading} className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest text-white disabled:opacity-50 transition-all" style={{background:`linear-gradient(135deg,rgba(139,92,246,0.3),rgba(27,95,250,0.2))`,border:`1px solid rgba(139,92,246,0.35)`}}>
              <LucideIcon name="zap" size={11} color="#A78BFA"/>{aiLoading?'Analizando…':'IA ESTRATÉGICA'}
            </button>
            {isOwner && (
              <button onClick={()=>{ setClientEditOpen(o=>!o); setEditRevenue(selected.revenue||''); setEditIndustry(selected.industry||''); setEditNotes(selected.notes||'') }} className="px-3 py-2 rounded-xl font-syne text-[9px] font-black tracking-widest transition-all" style={{color:clientEditOpen?BLU:'rgba(255,255,255,0.4)',background:clientEditOpen?'rgba(27,95,250,0.1)':'transparent',border:`1px solid ${clientEditOpen?'rgba(27,95,250,0.3)':BORDER}`}}>EDITAR</button>
            )}
            {isOwner && (
              confirmDeleteClient
                ? <div className="flex items-center gap-1">
                    <button onClick={()=>data.deleteClient(selected.id).then(()=>{handleBack();showToast('Cliente eliminado')}).catch(()=>showToast('Error al eliminar'))} className="px-3 py-2 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all" style={{background:'rgba(229,29,42,0.15)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR?</button>
                    <button onClick={()=>setConfirmDeleteClient(false)} className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-white/5" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={12} color="rgba(255,255,255,0.3)"/></button>
                  </div>
                : <button onClick={()=>setConfirmDeleteClient(true)} className="px-3 py-2 rounded-xl text-[11px] transition-all hover:bg-red-900/10" style={{color:'rgba(229,29,42,0.45)',border:'1px solid rgba(229,29,42,0.12)'}}>Eliminar</button>
            )}
          </div>
        </div>

        {aiAdvice && aiAdvice.length > 0 && (
          <div className="mb-8 rounded-2xl p-6" style={{background:'linear-gradient(135deg,rgba(139,92,246,0.08),rgba(27,95,250,0.04))',border:'1px solid rgba(139,92,246,0.2)'}}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-lg flex items-center justify-center" style={{background:'rgba(139,92,246,0.2)'}}><LucideIcon name="zap" size={11} color="#A78BFA"/></div>
                <span className="font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(167,139,250,0.8)'}}>BRUTAL.IA — PLAN ESTRATÉGICO 30 DÍAS</span>
              </div>
              <button onClick={()=>setAiAdvice(null)} className="flex items-center justify-center w-6 h-6 rounded-lg transition-colors hover:bg-white/5" style={{color:'rgba(255,255,255,0.2)'}}><LucideIcon name="x" size={12} color="rgba(255,255,255,0.3)"/></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {aiAdvice.map((rec: any, i: number)=>{
                const pc = rec.priority==='alta'?RED:rec.priority==='media'?'rgba(255,176,32,0.85)':BLU
                return (
                  <div key={i} className="rounded-xl p-4" style={{background:'rgba(0,0,0,0.25)',borderLeft:`3px solid ${pc}60`}}>
                    <div className="font-syne text-[7px] font-black tracking-widest mb-2" style={{color:pc}}>{rec.priority.toUpperCase()}</div>
                    <div className="font-figtree text-[14px] font-bold text-white mb-2 leading-snug">{rec.title}</div>
                    <p className="text-[11px] leading-relaxed" style={{color:'rgba(255,255,255,0.5)'}}>{rec.body}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {clientEditOpen && isOwner && (
          <div className="mb-8 rounded-2xl p-6" style={{background:'rgba(27,95,250,0.05)',border:'1px solid rgba(27,95,250,0.15)'}}>
            <div className="font-syne text-[8.5px] font-black tracking-widest mb-4" style={{color:'rgba(100,140,255,0.6)'}}>EDITAR CLIENTE</div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block font-syne text-[8px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>INDUSTRIA</label>
                <input value={editIndustry} onChange={e=>setEditIndustry(e.target.value)} placeholder="Ej: Fashion · Lifestyle" className="w-full px-4 py-3 rounded-xl text-[13px] text-white placeholder-white/20 outline-none transition-all" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.4)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
              </div>
              <div>
                <label className="block font-syne text-[8px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>FACTURACIÓN MENSUAL</label>
                <input value={editRevenue} onChange={e=>setEditRevenue(e.target.value)} placeholder="Ej: €12.000/mes" className="w-full px-4 py-3 rounded-xl text-[13px] text-white placeholder-white/20 outline-none transition-all" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.4)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
              </div>
            </div>
            <div className="mb-4">
              <label className="block font-syne text-[8px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>NOTAS INTERNAS</label>
              <textarea value={editNotes} onChange={e=>setEditNotes(e.target.value)} placeholder="Contexto del cliente, preferencias, acuerdos…" rows={3} className="w-full px-4 py-3 rounded-xl text-[13px] text-white placeholder-white/20 outline-none transition-all resize-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.4)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
            </div>
            <div className="flex gap-2">
              <button onClick={async()=>{ setSavingClient(true); try { await data.updateClient(selected.id,{industry:editIndustry,revenue:editRevenue,notes:editNotes}); showToast('Cliente actualizado'); setClientEditOpen(false) } catch { showToast('Error') } finally { setSavingClient(false) } }} disabled={savingClient} className="px-5 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest text-white disabled:opacity-40" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>{savingClient?'GUARDANDO…':'GUARDAR'}</button>
              <button onClick={()=>setClientEditOpen(false)} className="px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest transition-colors" style={{color:'rgba(255,255,255,0.3)',border:`1px solid ${BORDER}`}}>CANCELAR</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            {v:(selected.revenue||'—').split('/')[0].trim(), l:'Facturación mensual', accent:selected.color, note:(selected.revenue||'').includes('/')?'Al mes · contrato activo':'Contrato activo'},
            {v:clientProjects.length, l:'Proyectos totales', accent:BLU, note:`${activeProjects.length} activos`},
            {v:activeTasks.length, l:'Tareas activas', accent:urgentTasks.length>0?RED:BLU, note:urgentTasks.length>0?`${urgentTasks.length} urgentes`:`${doneTasks.length} completadas`},
            {v:`${avgProgress}%`, l:'Progreso medio', accent:avgProgress>70?GRN:BLU, note:'De todos los proyectos'},
          ].map((k,i)=>(
            <div key={i} className="rounded-2xl p-5 min-w-0" style={{background:SURFACE,border:`1px solid ${BORDER}`,borderTop:`2px solid ${k.accent}40`}}>
              <div className="font-figtree font-black leading-none mb-1.5" style={{color:k.accent,fontSize:'clamp(17px,5.5vw,28px)',overflowWrap:'anywhere'}}>{k.v}</div>
              <div className="text-[12px] font-medium mb-0.5" style={{color:'rgba(255,255,255,0.55)'}}>{k.l}</div>
              <div className="font-syne text-[8px] font-black tracking-wide" style={{color:'rgba(255,255,255,0.2)'}}>{k.note.toUpperCase()}</div>
            </div>
          ))}
        </div>

        {selected.notes && (
          <div className="mb-6 px-5 py-4 rounded-2xl" style={{background:'rgba(255,255,255,0.02)',border:`1px solid ${BORDER}`}}>
            <div className="font-syne text-[8px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.2)'}}>NOTAS INTERNAS</div>
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{color:'rgba(255,255,255,0.5)'}}>{selected.notes}</p>
          </div>
        )}
        <div className="grid gap-5 mb-6" style={{gridTemplateColumns:isMobile?'1fr':'1fr 320px'}}>
          <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            <div className="flex items-center justify-between px-6 py-4" style={{borderBottom:`1px solid ${BORDER}`}}>
              <div className="font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.25)'}}>PROYECTOS</div>
              <span className="font-syne text-[10px] font-black" style={{color:'rgba(255,255,255,0.2)'}}>{clientProjects.length}</span>
            </div>
            {clientProjects.length===0 ? (
              <div className="px-6 py-10 text-center text-[13px]" style={{color:'rgba(255,255,255,0.2)'}}>Sin proyectos para este cliente</div>
            ) : clientProjects.map((p: Project,i: number)=>{
              const isOpen = expandedProject===p.id
              const projTasks = data.tasks.filter((t: Task)=>t.project_id===p.id&&!t.done)
              return (
                <div key={p.id} style={{borderBottom:i<clientProjects.length-1?`1px solid ${BORDER}`:'none'}}>
                  <div onClick={()=>setExpandedProject(isOpen?null:p.id)} className="flex items-center gap-4 px-6 py-4 cursor-pointer hover:bg-white/[0.015] transition-all group">
                    <ProgressRing pct={p.progress} size={38} stroke={2.5} color={p.color||BLU}/>
                    <div className="flex-1 min-w-0">
                      <div className="font-figtree text-[14px] font-semibold truncate" style={{color:'rgba(240,240,248,0.85)'}}>{p.name}</div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[10px]" style={{color:'rgba(255,255,255,0.25)'}}>{(({'activo':'Activo','urgente':'Urgente','plan.':'Plan.','revisión':'Revisión','completado':'Completado'} as Record<string,string>)[p.status]||p.status)}</span>
                        {p.deadline && p.deadline!=='TBD' && (()=>{
                          const dOver = dlDate(p.deadline)<new Date()
                          const dSoon = !dOver && dlDate(p.deadline)<new Date(Date.now()+7*24*3600*1000)
                          return <span className="font-syne text-[8px] font-black px-1.5 py-0.5 rounded-full" style={{background:dOver?`${RED}15`:dSoon?'rgba(255,176,32,0.1)':'transparent',color:dOver?RED:dSoon?'rgba(255,176,32,0.8)':'rgba(255,255,255,0.25)'}}>{dOver&&'⚠ '}{dlLabel(p.deadline)}</span>
                        })()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {projTasks.length > 0 && <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.3)'}}>{projTasks.length} tareas</span>}
                      <span className="font-syne text-[8px] font-black px-2.5 py-1 rounded-lg" style={{background:p.status==='urgente'?'rgba(229,29,42,0.1)':'rgba(27,95,250,0.07)',color:p.status==='urgente'?RED:BLU}}>{p.progress}%</span>
                      {onNavigate && onSelectProject && <button onClick={e=>{e.stopPropagation();onSelectProject(p.id);onNavigate('proyectos')}} className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-7 h-7 rounded-xl" style={{background:'rgba(27,95,250,0.1)',color:BLU}} title="Ver en Proyectos"><LucideIcon name="arrow-right" size={11} color={BLU}/></button>}
                      <LucideIcon name={isOpen?'chevron-up':'chevron-down'} size={13} color="rgba(255,255,255,0.25)"/>
                    </div>
                  </div>
                  {isOpen && projTasks.length > 0 && (
                    <div className="px-6 pb-3" style={{borderTop:`1px solid ${BORDER}`}}>
                      {projTasks.slice(0,6).map((t: Task,ti: number)=>{
                        const cTodayStr = new Date().toISOString().split('T')[0]
                        const cIsToday = t.due_date && t.due_date.slice(0,10)===cTodayStr
                        const cOver = t.due_date && !cIsToday && new Date(t.due_date+'T23:59:59')<new Date()
                        return (
                        <div key={t.id} className="flex items-center gap-3 py-2" style={{borderBottom:ti<Math.min(projTasks.length,6)-1?`1px solid rgba(255,255,255,0.03)`:'none'}}>
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.7)':BLU}}/>
                          <span className="text-[12px] flex-1 truncate" style={{color:'rgba(255,255,255,0.5)'}}>{t.text}</span>
                          {t.due_date && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:cIsToday?'rgba(255,176,32,0.15)':cOver?`${RED}15`:'rgba(255,255,255,0.04)',color:cIsToday?'rgba(255,176,32,0.9)':cOver?RED:'rgba(255,255,255,0.2)'}}>{cIsToday?'HOY':new Date(t.due_date+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'})}</span>}
                        </div>
                      )})}
                      {projTasks.length===0 && <div className="py-2 text-[11px]" style={{color:'rgba(255,255,255,0.2)'}}>Sin tareas activas</div>}
                    </div>
                  )}
                  {isOpen && projTasks.length===0 && (
                    <div className="px-6 pb-3 pt-2" style={{borderTop:`1px solid ${BORDER}`}}>
                      <div className="text-[11px]" style={{color:'rgba(255,255,255,0.2)'}}>Sin tareas activas en este proyecto</div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
              <div className="px-5 py-4 font-syne text-[9px] font-black tracking-widest" style={{borderBottom:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.25)'}}>TAREAS ACTIVAS</div>
              {activeTasks.length===0 ? (
                <div className="px-5 py-6 flex items-center justify-center gap-2 text-[12px]" style={{color:'rgba(255,255,255,0.2)'}}><LucideIcon name="check-circle" size={13} color="rgba(34,197,94,0.4)"/>Al día</div>
              ) : activeTasks.slice(0,5).map((t: Task,i: number)=>(
                <div key={t.id} className="flex items-center gap-3 px-5 py-3" style={{borderBottom:i<Math.min(activeTasks.length,5)-1?`1px solid ${BORDER}`:'none',borderLeft:`2px solid ${t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.6)':BLU}40`}}>
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.7)':BLU}}/>
                  <span className="font-figtree text-[12px] font-medium flex-1 truncate" style={{color:'rgba(255,255,255,0.6)'}}>{t.text}</span>
                  {t.due_date && (()=>{
                    const todayStr = new Date().toISOString().split('T')[0]
                    const isToday = t.due_date.slice(0,10)===todayStr
                    const over = !isToday && new Date(t.due_date+'T23:59:59')<new Date()
                    return <span className="font-syne text-[7.5px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:isToday?'rgba(255,176,32,0.15)':over?`${RED}15`:'rgba(255,255,255,0.04)',color:isToday?'rgba(255,176,32,0.9)':over?RED:'rgba(255,255,255,0.25)'}}>{isToday?'HOY':new Date(t.due_date+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'})}</span>
                  })()}
                </div>
              ))}
              {activeTasks.length>5 && <div className="px-5 py-2 text-center text-[10px]" style={{color:'rgba(255,255,255,0.2)'}}>+{activeTasks.length-5} más</div>}
            </div>
            {clientContent.length>0 && (
              <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
                <div className="px-5 py-4 font-syne text-[9px] font-black tracking-widest" style={{borderBottom:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.25)'}}>CONTENIDO</div>
                {clientContent.slice(0,4).map((a: any,i: number)=>(
                  <div key={a.id} className="flex items-center gap-3 px-5 py-3" style={{borderBottom:i<Math.min(clientContent.length,4)-1?`1px solid ${BORDER}`:'none'}}>
                    <PlatformLogo platform={a.platform} size={13}/>
                    <span className="text-[12px] flex-1 truncate" style={{color:'rgba(255,255,255,0.55)'}}>{a.title}</span>
                    <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-lg" style={{background:a.status==='publicado'?'rgba(27,95,250,0.1)':a.status==='listo'?'rgba(34,197,94,0.1)':'rgba(255,255,255,0.04)',color:a.status==='publicado'?BLU:a.status==='listo'?GRN:'rgba(255,255,255,0.3)'}}>
                      {(({'borrador':'EN BRUTO','pendiente':'EN PROD.','listo':'LISTO','publicado':'PUBLICADO'} as Record<string,string>)[a.status])||a.status?.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {selected.notes && (
              <div className="rounded-2xl p-5" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
                <div className="font-syne text-[9px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.25)'}}>NOTAS</div>
                <p className="text-[12px] leading-relaxed" style={{color:'rgba(255,255,255,0.45)'}}>{selected.notes}</p>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
          <div className="flex items-center justify-between px-6 py-4" style={{borderBottom:`1px solid ${BORDER}`}}>
            <div className="font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.25)'}}>CONVERSACIÓN INTERNA</div>
            {comments===null && (
              <button onClick={()=>loadComments(selected.id)} className="font-syne text-[8px] font-black px-3 py-1.5 rounded-xl transition-all" style={{background:'rgba(27,95,250,0.1)',color:BLU}}>VER COMENTARIOS</button>
            )}
          </div>
          {commentsLoading && <div className="px-6 py-8 text-center text-[12px]" style={{color:'rgba(255,255,255,0.2)'}}>Cargando…</div>}
          {comments !== null && !commentsLoading && (
            <div>
              {comments.length===0 && <div className="px-6 py-6 text-center text-[12px]" style={{color:'rgba(255,255,255,0.2)'}}>Sin comentarios aún. Sé el primero.</div>}
              {comments.map((c: any)=>(
                <div key={c.id} className="flex gap-3 px-6 py-4" style={{borderBottom:`1px solid ${BORDER}`}}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center font-syne text-[9px] font-black flex-shrink-0 mt-0.5" style={{background:strColor(c.profile?.name||'?')+'22',border:`1.5px solid ${strColor(c.profile?.name||'?')}40`,color:strColor(c.profile?.name||'?')}}>{(c.profile?.initials||'??').slice(0,2)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-syne text-[9px] font-black" style={{color:strColor(c.profile?.name||'?')}}>{c.profile?.name||'Alguien'}</span>
                      <span className="font-syne text-[8px]" style={{color:'rgba(255,255,255,0.2)'}}>{relTime(c.created_at)}</span>
                    </div>
                    <p className="text-[13px] leading-relaxed" style={{color:'rgba(255,255,255,0.65)'}}>{c.body}</p>
                  </div>
                </div>
              ))}
              <div className="flex gap-3 p-4">
                <input value={newComment} onChange={e=>setNewComment(e.target.value)} onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&postComment()} placeholder="Escribe un comentario…" className="flex-1 px-4 py-2.5 rounded-xl text-[13px] outline-none" style={{background:SURF2,border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.8)',caretColor:BLU}}/>
                <button onClick={postComment} disabled={postingComment||!newComment.trim()} className="px-4 py-2.5 rounded-xl font-syne text-[9px] font-black text-white disabled:opacity-40" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>{postingComment?'…':'ENVIAR'}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  const parseRevenue = (s: string): number => {
    if (!s || s === '—') return 0
    return parseFloat(s.replace(/[€$£\s]/g,'').replace(/\./g,'').replace(',','.').replace(/\/.*$/,'')) || 0
  }
  const activeClients = data.clients.filter((c: Client)=>c.status==='Activo')
  const totalMRR = activeClients.reduce((sum: number, c: Client) => sum + parseRevenue(c.revenue||''), 0)
  const maxRevenue = Math.max(...data.clients.map((c: Client)=>parseRevenue(c.revenue||'')), 1)
  const visibleClients = data.clients.filter((c: Client) => {
    const matchStatus = clientStatusFilter === 'Todos' || c.status === clientStatusFilter
    const matchSearch = !clientSearch.trim() || c.name.toLowerCase().includes(clientSearch.toLowerCase()) || c.industry?.toLowerCase().includes(clientSearch.toLowerCase())
    return matchStatus && matchSearch
  })
  const sortedClients: Client[] = clientSort === 'revenue'
    ? [...visibleClients].sort((a:Client,b:Client)=>parseRevenue(b.revenue||'')-parseRevenue(a.revenue||''))
    : clientSort === 'tareas'
    ? [...visibleClients].sort((a:Client,b:Client)=>data.tasks.filter((t:Task)=>t.client_id===b.id&&!t.done).length-data.tasks.filter((t:Task)=>t.client_id===a.id&&!t.done).length)
    : clientSort === 'proyectos'
    ? [...visibleClients].sort((a:Client,b:Client)=>data.projects.filter((p:Project)=>p.client_id===b.id&&(p.status==='activo'||p.status==='urgente')).length-data.projects.filter((p:Project)=>p.client_id===a.id&&(p.status==='activo'||p.status==='urgente')).length)
    : visibleClients

  return (
    <div className="p-8 max-w-[1200px] mx-auto">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-2" style={{color:'rgba(255,255,255,0.18)'}}>GESTIÓN</div>
          <h1 className="font-figtree text-[28px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Clientes</h1>
        </div>
        <button onClick={()=>onOpenModal('cliente')} className="flex items-center gap-2 px-5 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>+ NUEVO CLIENTE</button>
      </div>
      {totalMRR > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="col-span-1 rounded-2xl p-5" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            <div className="font-syne text-[8.5px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.2)'}}>MRR TOTAL</div>
            <div className="font-figtree text-[32px] font-black leading-none text-white" style={{letterSpacing:'-0.02em'}}>€{totalMRR.toLocaleString('es-ES')}</div>
            <div className="text-[11px] mt-1.5" style={{color:'rgba(255,255,255,0.3)'}}>{activeClients.length} clientes activos</div>
          </div>
          <div className="col-span-1 md:col-span-2 rounded-2xl p-5" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            <div className="font-syne text-[8.5px] font-black tracking-widest mb-4" style={{color:'rgba(255,255,255,0.2)'}}>REVENUE POR CLIENTE</div>
            <div className="space-y-2.5">
              {data.clients.filter((c: Client)=>parseRevenue(c.revenue||'')>0).sort((a: Client,b: Client)=>parseRevenue(b.revenue||'')-parseRevenue(a.revenue||'')).slice(0,4).map((c: Client)=>{
                const rev = parseRevenue(c.revenue||'')
                const pct = Math.round((rev/maxRevenue)*100)
                return (
                  <div key={c.id} className="flex items-center gap-3">
                    <div className="font-syne text-[10px] font-black w-20 truncate" style={{color:'rgba(255,255,255,0.5)'}}>{c.name.split(' ')[0]}</div>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{background:'rgba(255,255,255,0.05)'}}>
                      <div className="h-full rounded-full transition-all" style={{width:`${pct}%`,background:`linear-gradient(90deg,${c.color},${c.color}88)`}}/>
                    </div>
                    <div className="font-syne text-[9px] font-black w-16 text-right" style={{color:c.color}}>€{rev.toLocaleString('es-ES')}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
      {data.clients.length > 0 && (
        <div className="flex items-center flex-wrap gap-3 mb-6">
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl flex-1 max-w-xs" style={{minWidth:'200px',background:SURFACE,border:`1px solid ${BORDER}`}}>
            <LucideIcon name="search" size={13} color="rgba(255,255,255,0.2)"/>
            <input value={clientSearch} onChange={e=>setClientSearch(e.target.value)} placeholder="Busca cliente o sector…" className="flex-1 bg-transparent text-[12px] outline-none" style={{caretColor:BLU,color:'rgba(255,255,255,0.75)'}}/>
            {clientSearch && <button onClick={()=>setClientSearch('')}><LucideIcon name="x" size={11} color="rgba(255,255,255,0.2)"/></button>}
          </div>
          <div className="flex gap-1 p-1 rounded-2xl overflow-x-auto max-w-full" style={{background:SURFACE,border:`1px solid ${BORDER}`,scrollbarWidth:'none'}}>
            {([{v:'Todos',c:'rgba(255,255,255,0.9)'},{v:'Activo',c:GRN},{v:'Pausado',c:'rgba(255,176,32,0.85)'},{v:'Archivado',c:'rgba(255,255,255,0.35)'}] as const).map(s=>(
              <button key={s.v} onClick={()=>setClientStatusFilter(s.v)} className="px-3.5 py-2 rounded-xl font-syne text-[8.5px] font-black tracking-wide transition-all flex-shrink-0" style={{background:clientStatusFilter===s.v?SURF2:'transparent',color:clientStatusFilter===s.v?s.c:'rgba(255,255,255,0.28)'}}>
                {s.v.toUpperCase()}
              </button>
            ))}
          </div>
          {(clientSearch||clientStatusFilter!=='Todos') && <span className="font-syne text-[9px] font-black" style={{color:'rgba(255,255,255,0.25)'}}>{visibleClients.length}</span>}
          <div className="flex items-center gap-0.5 p-1 rounded-xl ml-auto" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            <span className="font-syne text-[7.5px] font-black tracking-wide px-2" style={{color:'rgba(255,255,255,0.15)'}}>ORDEN</span>
            {([['default','—'],['revenue','Revenue'],['tareas','Tareas'],['proyectos','Proyectos']] as [string,string][]).map(([v,l])=>(
              <button key={v} onClick={()=>setClientSort(v as 'default'|'revenue'|'tareas'|'proyectos')} className="px-2.5 py-1.5 rounded-lg font-syne text-[8px] font-black tracking-wide transition-all" style={{background:clientSort===v?SURF2:'transparent',color:clientSort===v?'rgba(255,255,255,0.85)':'rgba(255,255,255,0.25)'}}>{l}</button>
            ))}
          </div>
        </div>
      )}
      {data.clients.length === 0 ? (
        <div className="py-24 text-center">
          <div className="font-syne text-[11px] font-black tracking-widest mb-4" style={{color:'rgba(255,255,255,0.15)'}}>SIN CLIENTES</div>
          <button onClick={()=>onOpenModal('cliente')} className="font-syne text-[10px] font-black px-5 py-3 rounded-2xl" style={{background:'rgba(27,95,250,0.1)',color:BLU}}>CREAR PRIMER CLIENTE</button>
        </div>
      ) : visibleClients.length === 0 ? (
        <div className="py-16 text-center">
          <div className="font-syne text-[10px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.15)'}}>SIN RESULTADOS</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
          {sortedClients.map((c: Client)=>{
            const nProj = data.projects.filter((p:Project)=>p.client_id===c.id).length
            const nTaskPending = data.tasks.filter((t:Task)=>t.client_id===c.id&&!t.done).length
            const nUrgent = data.tasks.filter((t:Task)=>t.client_id===c.id&&!t.done&&t.level==='urgent').length
            const activeProj = data.projects.filter((p:Project)=>p.client_id===c.id&&(p.status==='activo'||p.status==='urgente')).length
            return (
              <div key={c.id} onClick={()=>onSelect(c.id)} className="rounded-2xl overflow-hidden cursor-pointer transition-all group hover:border-white/10" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
                <div className="h-1" style={{background:`linear-gradient(90deg,${c.color}60,transparent)`}}/>
                <div className="p-6">
                  <div className="flex items-center gap-4 mb-5">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center font-syne text-base font-black flex-shrink-0" style={{background:c.color+'18',border:`2px solid ${c.color}25`,color:c.color}}>{c.initials}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-syne text-[15px] font-black text-white truncate">{c.name}</div>
                      <div className="text-[11px] mt-0.5 truncate" style={{color:'rgba(255,255,255,0.3)'}}>{c.industry}</div>
                    </div>
                    <span className="font-syne text-[8px] font-black px-2.5 py-1 rounded-full flex-shrink-0" style={{background:c.status==='Activo'?'rgba(34,197,94,0.08)':'rgba(255,255,255,0.04)',color:c.status==='Activo'?GRN:'rgba(255,255,255,0.3)'}}>{c.status.toUpperCase()}</span>
                  </div>

                  {c.revenue && c.revenue !== '—' && (
                    <div className="mb-4 px-4 py-3 rounded-xl" style={{background:c.color+'08',border:`1px solid ${c.color}15`}}>
                      <div className="font-syne text-[8px] font-black tracking-widest mb-1" style={{color:'rgba(255,255,255,0.25)'}}>FACTURACIÓN MENSUAL</div>
                      <div className="font-figtree text-[22px] font-black leading-none" style={{color:c.color||'rgba(240,240,248,0.85)'}}>{c.revenue}</div>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {[
                      {v:nProj, l:'proyectos', accent:BLU},
                      {v:activeProj, l:'activos', accent:activeProj>0?GRN:'rgba(255,255,255,0.3)'},
                      {v:nTaskPending, l:'tareas', accent:nUrgent>0?RED:BLU},
                    ].map((s,i)=>(
                      <div key={i} className="rounded-xl p-3 text-center" style={{background:SURF2}}>
                        <div className="font-figtree text-[20px] font-black leading-none mb-0.5" style={{color:s.accent}}>{s.v}</div>
                        <div className="text-[9px]" style={{color:'rgba(255,255,255,0.25)'}}>{s.l}</div>
                      </div>
                    ))}
                  </div>

                  {(() => {
                    const clientMsgs = data.inbox.filter((m: any)=>m.ai_client&&(m.ai_client.toLowerCase().includes(c.name.toLowerCase().split(' ')[0])||c.name.toLowerCase().includes(m.ai_client.toLowerCase().split(' ')[0])))
                    const lm = clientMsgs.sort((a: any,b: any)=>new Date(b.received_at).getTime()-new Date(a.received_at).getTime())[0]
                    const unreadN = clientMsgs.filter((m: any)=>!m.is_read).length
                    if (!lm) return null
                    const dd = Math.floor((Date.now()-new Date(lm.received_at).getTime())/86400000)
                    return (
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-syne text-[7.5px] font-black tracking-wide" style={{color:'rgba(255,255,255,0.15)'}}>ÚLTIMO CONTACTO · {dd===0?'HOY':dd===1?'AYER':`HACE ${dd}D`}</div>
                        {unreadN > 0 && <span className="font-syne text-[7px] font-black px-2 py-0.5 rounded-full" style={{background:`${BLU}18`,color:`${BLU}cc`,border:`1px solid ${BLU}25`}}>{unreadN} SIN LEER</span>}
                      </div>
                    )
                  })()}

                  {nUrgent > 0 && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{background:'rgba(229,29,42,0.07)',border:'1px solid rgba(229,29,42,0.12)'}}>
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:RED}}/>
                      <span className="font-syne text-[9px] font-black" style={{color:RED}}>{nUrgent} TAREA{nUrgent!==1?'S':''} URGENTE{nUrgent!==1?'S':''}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
