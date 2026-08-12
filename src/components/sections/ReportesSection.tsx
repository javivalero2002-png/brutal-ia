'use client'
import { useEffect, useRef, useMemo } from 'react'
import type { Task, Project, Client, Profile } from '@/types'
import { useIsMobile, BLU, RED, GRN, BORDER, LucideIcon, dlDate, dlLabel, estadoDeadline, Donut, Gauge, AreaChart, localDayKey } from '@/components/shared'

function ReportesSection({data, onNavigate}: any) {
  const isMobile = useIsMobile()
  const printBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(()=>{
    const handler = (e: KeyboardEvent) => {
      if (['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) || e.metaKey||e.ctrlKey||e.altKey) return
      if (e.key === 'p') { e.preventDefault(); printBtnRef.current?.click() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const tasks: Task[] = data.tasks
  const projects: Project[] = data.projects
  const clients: Client[] = data.clients
  const inbox: any[] = data.inbox
  const agendaItems: any[] = data.agenda || []

  const stats = useMemo(() => {
    const totalTasks = tasks.length
    const doneTasks = tasks.filter(t=>t.done).length
    const pendingTasks = tasks.filter(t=>!t.done).length
    const urgentTasks = tasks.filter(t=>!t.done&&t.level==='urgent').length
    const completionRate = totalTasks > 0 ? Math.round((doneTasks/totalTasks)*100) : 0

    const activeClients = clients.filter(c=>c.status==='Activo')
    const parseMRR = (s: string) => { if(!s||s==='—')return 0; return parseFloat(s.replace(/[€$£\s]/g,'').replace(/\./g,'').replace(',','.').replace(/\/.*$/,''))||0 }
    const totalMRR = activeClients.reduce((sum: number,c: Client)=>sum+parseMRR(c.revenue||''),0)
    const overdueProjects = projects.filter(p=>p.deadline&&p.deadline!=='TBD'&&p.status!=='completado'&&dlDate(p.deadline)<new Date())
    const projectsByStatus = [
      {label:'En progreso', count:projects.filter(p=>p.status==='activo').length, color:BLU},
      {label:'Urgente', count:projects.filter(p=>p.status==='urgente').length, color:RED},
      {label:'Revisión', count:projects.filter(p=>p.status==='revisión').length, color:'#FFB020'},
      {label:'Planificación', count:projects.filter(p=>p.status==='plan.').length, color:'#FFFFFF'},
      {label:'Completado', count:projects.filter(p=>p.status==='completado').length, color:'#22C55E'},
    ]

    const weekAgoReport = new Date(); weekAgoReport.setDate(weekAgoReport.getDate()-7); weekAgoReport.setHours(0,0,0,0)
    const tasksByMember = ((data.team || []) as Profile[]).map((m: Profile) => {
      const memberPending = tasks.filter(t=>!t.done&&t.assignee?.name===m.name)
      const memberDone = tasks.filter(t=>t.done&&t.assignee?.name===m.name)
      const urgentCount = memberPending.filter(t=>t.level==='urgent').length
      const highCount = memberPending.filter(t=>t.level==='high').length
      const normalCount = memberPending.length - urgentCount - highCount
      const doneThisWeek = memberDone.filter(t=>new Date(t.completed_at||t.updated_at||t.created_at)>=weekAgoReport).length
      return {
        name: m.name,
        initials: m.initials,
        color: m.avatar_color,
        pending: memberPending.length,
        done: memberDone.length,
        doneThisWeek,
        workload: urgentCount*3 + highCount*2 + normalCount,
      }
    })

    const urgencyBreakdown = [
      {label:'Urgente', count:inbox.filter(m=>m.ai_urgency==='urgent').length, color:RED},
      {label:'Alta', count:inbox.filter(m=>m.ai_urgency==='high').length, color:'#FFB020'},
      {label:'Normal', count:inbox.filter(m=>m.ai_urgency==='normal').length, color:BLU},
    ]

    const maxBar = Math.max(...tasksByMember.map((m: any)=>m.pending+m.done), 1)

    return { totalTasks, doneTasks, pendingTasks, urgentTasks, completionRate, activeClients, totalMRR, overdueProjects, projectsByStatus, tasksByMember, urgencyBreakdown, maxBar }
  }, [tasks, projects, clients, inbox, data.team])

  const { totalTasks, doneTasks, pendingTasks, urgentTasks, completionRate, activeClients, totalMRR, overdueProjects, projectsByStatus, tasksByMember, urgencyBreakdown, maxBar } = stats

  return (
    <div className={isMobile ? 'h-full overflow-y-auto p-4' : 'p-6 max-w-[1100px] mx-auto h-full overflow-y-auto'}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3 flex-shrink-0">
        <div>
          <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-2" style={{color:'rgba(255,255,255,0.18)'}}>RENDIMIENTO</div>
          <h1 className="font-figtree text-[24px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Reportes</h1>
        </div>
        <button onClick={()=>{
          const printWin = window.open('','_blank','width=900,height=700')
          if(!printWin) return
          const now = new Date().toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'})
          const donePct = totalTasks>0?Math.round((doneTasks/totalTasks)*100):0
          const membersHtml = tasksByMember.map((m: any)=>`<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #eee"><div style="width:32px;height:32px;border-radius:50%;background:${m.color}22;color:${m.color};display:flex;align-items:center;justify-content:center;font-weight:900;font-size:11px;flex-shrink:0">${m.initials}</div><div style="flex:1"><strong>${m.name}</strong></div><div style="color:#666;font-size:13px">${m.pending} pendientes · ${m.done} completadas</div><div style="width:120px;height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden"><div style="width:${maxBar>0?((m.done/(m.done+m.pending||1))*100).toFixed(0):0}%;height:100%;background:${m.color}"></div></div></div>`).join('')
          const statusEs = (s: string) => ({'activo':'Activo','urgente':'Urgente','plan.':'Planificación','revisión':'Revisión'} as Record<string,string>)[s]||s
          const projHtml = projects.map((p: Project)=>`<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #eee"><div style="flex:1"><strong>${p.name}</strong> <span style="color:#999;font-size:12px">${p.client?.name||'—'}</span></div><span style="padding:2px 8px;background:#f5f5f5;border-radius:20px;font-size:11px;font-weight:700">${statusEs(p.status)}</span><div style="width:80px;height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden"><div style="width:${p.progress}%;height:100%;background:${p.color||'#1B5FFA'}"></div></div><span style="font-size:12px;color:#666;width:30px;text-align:right">${p.progress}%</span></div>`).join('')
          printWin.document.write(`<!DOCTYPE html><html><head><title>Reporte Brutal Studios — ${now}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;padding:40px;max-width:800px;margin:0 auto}.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #111;padding-bottom:20px;margin-bottom:30px}.logo-area h1{font-size:28px;font-weight:900;letter-spacing:-1px}.logo-area p{color:#666;font-size:13px;margin-top:4px}.date-area{text-align:right;color:#666;font-size:13px}.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:16px;margin-bottom:30px}.kpi{padding:16px;border:1px solid #e0e0e0;border-radius:8px;text-align:center}.kpi .num{font-size:36px;font-weight:900;color:#1B5FFA}.kpi .lbl{font-size:11px;color:#666;margin-top:4px}.section{margin-bottom:28px}.section h2{font-size:16px;font-weight:900;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;color:#333;padding-bottom:6px;border-bottom:1px solid #e0e0e0}.footer{margin-top:40px;padding-top:16px;border-top:1px solid #e0e0e0;color:#999;font-size:11px;display:flex;justify-content:space-between}@media print{body{padding:20px}}</style></head><body><div class="header"><div class="logo-area"><h1>Brutal Studios</h1><p>Informe de gestión</p></div><div class="date-area"><strong>${now}</strong><br>brutal.ia · sistema interno</div></div><div class="kpis"><div class="kpi"><div class="num">${donePct}%</div><div class="lbl">Tareas completadas</div></div><div class="kpi"><div class="num" style="color:${urgentTasks>0?'#E51D2A':'#1B5FFA'}">${urgentTasks}</div><div class="lbl">Urgentes pendientes</div></div><div class="kpi"><div class="num" style="color:${overdueProjects.length>0?'#E51D2A':'#1B5FFA'}">${overdueProjects.length}</div><div class="lbl">Proyectos atrasados</div></div><div class="kpi"><div class="num">${projects.length}</div><div class="lbl">Proyectos totales</div></div><div class="kpi"><div class="num">${clients.length}</div><div class="lbl">Clientes</div></div></div><div class="section"><h2>Carga de trabajo del equipo</h2>${membersHtml}</div><div class="section"><h2>Estado de proyectos</h2>${projHtml}</div><div class="footer"><span>Brutal Studios · brutal.ia</span><span>Generado: ${now}</span></div></body></html>`)
          printWin.document.close()
          setTimeout(()=>printWin.print(),500)
        }} ref={printBtnRef} className="flex items-center gap-2 px-4 py-2 rounded-xl font-syne text-[10px] font-black tracking-wide transition-colors" style={{background:'rgba(27,95,250,0.1)',color:BLU,border:'1px solid rgba(27,95,250,0.2)'}}>
          <LucideIcon name="download" size={13} color={BLU}/>EXPORTAR PDF
          {!isMobile && <span className="font-syne text-[7px] font-black ml-1 px-1.5 py-0.5 rounded" style={{background:'rgba(27,95,250,0.2)',color:BLU+'bb'}}>P</span>}
        </button>
      </div>

      {/* 7-day team productivity sparkline */}
      {(()=>{
        const last7 = Array.from({length:7},(_,i)=>{
          const d = new Date(); d.setDate(d.getDate()-(6-i))
          return {key:localDayKey(d),label:d.toLocaleDateString('es-ES',{weekday:'short'})}
        })
        // completed_at es el momento REAL de completado; updated_at solo es un
        // apaño para tareas anteriores a la migración.
        const counts = last7.map(({key})=>tasks.filter(t=>{
          if (!t.done) return false
          const when = (t as any).completed_at || t.updated_at || t.created_at
          return localDayKey(when) === key
        }).length)
        const mx = Math.max(...counts,1)
        const total7 = counts.reduce((a,b)=>a+b,0)
        if (total7 === 0) return null
        return (
          <div className="flex items-stretch gap-4 mb-5 px-4 py-3.5 rounded-xl" style={{background:'rgba(27,95,250,0.04)',border:'1px solid rgba(27,95,250,0.1)'}}>
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <div className="font-syne text-[7px] font-black tracking-widest mb-1" style={{color:'rgba(255,255,255,0.2)'}}>TAREAS COMPLETADAS · ÚLTIMOS 7 DÍAS</div>
              <AreaChart values={counts} color={GRN} height={52}/>
              <div className="flex justify-between mt-1">
                {last7.map(({label},i)=>(
                  <span key={i} className="font-syne text-[6.5px] font-black flex-1 text-center" style={{color:i===6?'rgba(255,255,255,0.45)':'rgba(255,255,255,0.16)'}}>{label.slice(0,2).toUpperCase()}</span>
                ))}
              </div>
            </div>
            <div className="flex-shrink-0 text-right pr-1 flex flex-col justify-center border-l pl-4" style={{borderColor:'rgba(255,255,255,0.06)'}}>
              <div className="font-figtree text-[26px] font-black leading-none" style={{color:GRN,letterSpacing:'-0.03em'}}>{total7}</div>
              <div className="font-syne text-[7px] font-black tracking-widest mt-1" style={{color:'rgba(255,255,255,0.2)'}}>EQUIPO · 7D</div>
            </div>
          </div>
        )
      })()}

      {/* KPIs */}
      <div className="grid gap-2 mb-4 flex-shrink-0" style={{gridTemplateColumns:isMobile?'repeat(3,minmax(0,1fr))':totalMRR>0?'repeat(6,minmax(0,1fr))':'repeat(5,minmax(0,1fr))'}}>
        {[
          {v:`${completionRate}%`, l:'Tareas completadas', accent:completionRate>60?'#22c55e':BLU, nav:'tareas'},
          {v:urgentTasks+'', l:'Urgentes pendientes', accent:urgentTasks>0?RED:BLU, nav:'tareas'},
          {v:overdueProjects.length+'', l:'Proy. atrasados', accent:overdueProjects.length>0?RED:null, nav:'proyectos'},
          {v:activeClients.length+'', l:'Clientes activos', accent:null, nav:'clientes'},
          {v:agendaItems.filter((a:any)=>a.status!=='publicado').length+'', l:'En pipeline', accent:agendaItems.filter((a:any)=>a.status!=='publicado').length>0?'rgba(193,53,132,0.9)':null, nav:'contenido'},
          ...(totalMRR>0?[{v:`€${totalMRR.toLocaleString('es-ES')}`, l:'MRR activos', accent:GRN, nav:'clientes'}]:[]),
        ].map((k,i)=>(
          <button key={i} onClick={()=>onNavigate?.(k.nav)} className={isMobile ? 'rounded-xl p-2.5 text-left transition-all hover:opacity-80' : 'rounded-xl p-4 text-left transition-all hover:opacity-80'} style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)',borderTop:`2px solid ${k.accent||'rgba(255,255,255,0.1)'}`}}>
            <div className="font-syne font-black mb-1 leading-none" style={{color:k.accent||'#F0F0F8',fontSize:isMobile?'clamp(15px,5vw,22px)':totalMRR>0?'clamp(20px,2.2vw,36px)':'36px',overflowWrap:'anywhere'}}>{k.v}</div>
            <div className={isMobile ? 'text-[10px] text-white/35 leading-tight' : 'text-xs text-white/35'}>{k.l}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-[1fr_1fr] gap-2 md:gap-4 mb-4 flex-shrink-0">
        {/* Task completion — radial gauge */}
        <div className="rounded-xl p-5" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)'}}>
          <div className="font-syne text-[9px] font-bold tracking-widest text-white/25 uppercase mb-3">Estado de tareas</div>
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0">
              <Gauge value={completionRate} size={isMobile?104:120} color={completionRate>60?GRN:BLU} sub="COMPLETADO"/>
            </div>
            <div className="flex-1 min-w-0 space-y-2.5">
              {[
                {l:'Completadas', v:doneTasks, color:GRN},
                {l:'Pendientes', v:pendingTasks, color:BLU},
                {l:'Urgentes', v:urgentTasks, color:RED},
              ].map((b,i)=>(
                <div key={i} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{background:b.color}}/>
                  <span className="text-[11px] text-white/45 flex-1 truncate">{b.l}</span>
                  <span className="font-syne text-[13px] font-black" style={{color:b.color}}>{b.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Projects by status — donut */}
        <div className="rounded-xl p-5" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)'}}>
          <div className="font-syne text-[9px] font-bold tracking-widest text-white/25 uppercase mb-3">Proyectos por estado</div>
          {projects.length === 0 ? (
            <div className="text-center text-white/20 text-sm py-6">Sin proyectos</div>
          ) : (
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0">
                <Donut segments={projectsByStatus.filter(s=>s.count>0)} size={isMobile?104:120} centerLabel={String(projects.length)} centerSub="TOTAL"/>
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                {projectsByStatus.filter(s=>s.count>0).map((s,i)=>(
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{background:s.color}}/>
                    <span className="text-[11px] text-white/45 flex-1 truncate">{s.label}</span>
                    <span className="font-syne text-[12px] font-black" style={{color:s.color}}>{s.count}</span>
                  </div>
                ))}
                {/* Fuera del donut a propósito: estar atrasado NO es un estado,
                    es un atributo que se cruza con ellos. Metido como un segmento
                    más, un proyecto urgente Y atrasado contaba dos veces: la
                    leyenda sumaba 5 con el centro diciendo 4. */}
                {overdueProjects.length > 0 && (
                  <div className="flex items-center gap-2 pt-1.5 mt-1.5" style={{borderTop:`1px solid ${BORDER}`}}>
                    <LucideIcon name="alert-triangle" size={10} color={RED}/>
                    <span className="text-[11px] flex-1 truncate" style={{color:'rgba(255,255,255,0.45)'}}>
                      {overdueProjects.length === 1 ? 'de ellos, 1 atrasado' : `de ellos, ${overdueProjects.length} atrasados`}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Carga del equipo e inbox: solo escritorio (en movil la pagina es estatica y compacta) */}
      {!isMobile && <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-4 flex-shrink-0">
        {/* Team workload */}
        <div className="rounded-xl p-5" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)'}}>
          <div className="font-syne text-[9px] font-bold tracking-widest text-white/25 uppercase mb-5">Carga de trabajo por persona</div>
          <div className="space-y-4">
            {tasksByMember.map((m: any,i: number)=>(
              <div key={i}>
                <div className="flex items-center gap-3 mb-1.5">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center font-syne text-[9px] font-black flex-shrink-0" style={{background:m.color+'22',color:m.color}}>{m.initials}</div>
                  <span className="text-sm text-white/60 flex-1">{m.name}</span>
                  <span className="text-xs text-white/40">{m.pending} pend. · {m.done} hechas</span>
                  {m.doneThisWeek > 0 && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full flex-shrink-0" style={{background:'rgba(34,197,94,0.08)',color:'rgba(34,197,94,0.65)'}} title="Completadas en los ultimos 7 dias">+{m.doneThisWeek} sem.</span>}
                  {m.workload > 0 && (
                    <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full flex-shrink-0" style={{background:m.workload>8?'rgba(229,29,42,0.12)':m.workload>4?'rgba(255,176,32,0.1)':'rgba(255,255,255,0.04)',color:m.workload>8?RED:m.workload>4?'rgba(255,176,32,0.8)':'rgba(255,255,255,0.3)'}} title="Indice de carga (urgentes×3 + altas×2 + normales×1)">{m.workload}pts</span>
                  )}
                </div>
                <div className="h-2 rounded-full ml-9" style={{background:'rgba(255,255,255,0.04)'}}>
                  <div className="h-full rounded-full flex overflow-hidden">
                    <div style={{width:`${((m.done)/(maxBar))*100}%`,background:'rgba(34,197,94,0.6)',transition:'width 0.5s'}}/>
                    <div style={{width:`${((m.pending)/(maxBar))*100}%`,background:m.color+'80',transition:'width 0.5s'}}/>
                  </div>
                </div>
              </div>
            ))}
            {tasksByMember.length===0&&<div className="text-center text-white/20 text-sm py-4">Sin datos de equipo</div>}
          </div>
        </div>

        {/* Inbox urgency */}
        <div className="rounded-xl p-5" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)'}}>
          <div className="font-syne text-[9px] font-bold tracking-widest text-white/25 uppercase mb-4">Inbox por urgencia</div>
          {inbox.length === 0 ? (
            <div className="text-center text-white/20 text-sm py-4 mb-3">Inbox vacío</div>
          ) : (
            <div className="flex items-center gap-4 mb-5">
              <div className="flex-shrink-0">
                <Donut segments={urgencyBreakdown.filter(u=>u.count>0)} size={104} thickness={13} centerLabel={String(inbox.length)} centerSub="EMAILS"/>
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                {urgencyBreakdown.map((u,i)=>(
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{background:u.color}}/>
                    <span className="text-[11px] text-white/45 flex-1">{u.label}</span>
                    <span className="font-syne text-[12px] font-black" style={{color:u.color}}>{u.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="pt-4 pb-4 border-t border-white/6">
            <div className="text-xs text-white/25 mb-3">Por fuente</div>
            <div className="flex gap-2 flex-wrap">
              {[
                {label:'Gmail', n:inbox.filter(m=>m.source==='gmail').length, color:'#1B5FFA'},
                {label:'WhatsApp', n:inbox.filter(m=>m.source==='whatsapp').length, color:'#25D366'},
                {label:'Interno', n:inbox.filter(m=>m.source==='internal').length, color:'#FFB020'},
              ].filter(s=>s.n>0).map((s,i)=>(
                <div key={i} className="flex-1 text-center px-3 py-2 rounded-xl" style={{background:s.color+'0A',border:`1px solid ${s.color}22`}}>
                  <div className="font-figtree text-[18px] font-black" style={{color:s.color}}>{s.n}</div>
                  <div className="font-syne text-[7.5px] font-black tracking-wide" style={{color:'rgba(255,255,255,0.25)'}}>{s.label.toUpperCase()}</div>
                </div>
              ))}
              {inbox.filter(m=>!['gmail','whatsapp','internal'].includes(m.source)).length > 0 && (
                <div className="flex-1 text-center px-3 py-2 rounded-xl" style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)'}}>
                  <div className="font-figtree text-[18px] font-black" style={{color:'rgba(255,255,255,0.4)'}}>{inbox.filter(m=>!['gmail','whatsapp','internal'].includes(m.source)).length}</div>
                  <div className="font-syne text-[7.5px] font-black tracking-wide" style={{color:'rgba(255,255,255,0.2)'}}>OTROS</div>
                </div>
              )}
            </div>
          </div>
          <div className="pt-4 border-t border-white/6">
            <div className="text-xs text-white/25 mb-2">Clientes con mas proyectos</div>
            {[...clients].sort((a,b)=>projects.filter((p:Project)=>p.client_id===b.id).length-projects.filter((p:Project)=>p.client_id===a.id).length).slice(0,3).map((c: Client,i: number)=>{
              const n = projects.filter((p: Project)=>p.client_id===c.id).length
              return (
                <div key={i} className="flex items-center gap-2 py-1.5">
                  <div className="w-5 h-5 rounded flex items-center justify-center font-syne text-[8px] font-black flex-shrink-0" style={{background:c.color+'22',color:c.color}}>{c.initials}</div>
                  <span className="text-xs text-white/50 flex-1 truncate">{c.name}</span>
                  <span className="font-syne text-[9px] font-black text-white/30">{n} proy.</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>}

      {/* Content pipeline: solo escritorio */}
      {!isMobile && agendaItems.length > 0 && (
        <div className="mt-4 rounded-xl p-5" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)'}}>
          <div className="font-syne text-[9px] font-bold tracking-widest text-white/25 uppercase mb-4">Pipeline de contenido</div>
          <div className="grid grid-cols-4 gap-6 mb-5">
            {([{k:'borrador',l:'En bruto',c:'rgba(255,255,255,0.42)'},{k:'pendiente',l:'En prod.',c:'rgba(255,176,32,0.9)'},{k:'listo',l:'Listo',c:GRN},{k:'publicado',l:'Publicado',c:BLU}] as const).map((s)=>{
              const cnt = agendaItems.filter((a:any)=>a.status===s.k).length
              return (
                <div key={s.k} className="text-center">
                  <div className="font-figtree text-4xl font-black mb-1" style={{color:cnt>0?s.c:'rgba(255,255,255,0.12)',letterSpacing:'-0.04em'}}>{cnt}</div>
                  <div className="font-syne text-[8.5px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.22)'}}>{s.l.toUpperCase()}</div>
                  <div className="h-1.5 rounded-full" style={{background:'rgba(255,255,255,0.04)'}}>
                    <div className="h-full rounded-full" style={{width:`${agendaItems.length>0?(cnt/agendaItems.length)*100:0}%`,background:s.c}}/>
                  </div>
                </div>
              )
            })}
          </div>
          {(()=>{
            const platColors: Record<string,string> = {TikTok:'#ff0050',Instagram:'#C13584',LinkedIn:'#0A66C2',YouTube:'#FF0000',Twitter:'#1DA1F2',Pinterest:'#E60023'}
            const platCounts: Record<string,number> = {}
            agendaItems.filter((a:any)=>a.status!=='publicado').forEach((a:any)=>{ if(a.platform) platCounts[a.platform]=(platCounts[a.platform]||0)+1 })
            const entries = Object.entries(platCounts).sort((a,b)=>b[1]-a[1])
            if (entries.length === 0) return null
            const maxN = entries[0][1]
            return (
              <div className="pt-4" style={{borderTop:'1px solid rgba(255,255,255,0.05)'}}>
                <div className="font-syne text-[8.5px] font-bold tracking-widest text-white/20 uppercase mb-3">Por plataforma (en pipeline)</div>
                <div className="space-y-2">
                  {entries.map(([plat,n])=>(
                    <div key={plat} className="flex items-center gap-3">
                      <span className="font-syne text-[8px] font-black w-20 text-right flex-shrink-0" style={{color:(platColors[plat]||BLU)+'bb'}}>{plat}</span>
                      <div className="flex-1 h-1.5 rounded-full" style={{background:'rgba(255,255,255,0.04)'}}>
                        <div className="h-full rounded-full" style={{width:`${(n/maxN)*100}%`,background:platColors[plat]||BLU}}/>
                      </div>
                      <span className="font-syne text-[8px] font-black w-5 flex-shrink-0" style={{color:'rgba(255,255,255,0.3)'}}>{n}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* Upcoming deadlines */}
      {(()=>{
        const horizon = new Date(Date.now()+30*24*60*60*1000)
        const upcoming = projects
          .filter((p:Project)=>p.deadline&&p.deadline!=='TBD'&&p.status!=='completado'&&dlDate(p.deadline)<=horizon)
          .sort((a:Project,b:Project)=>dlDate(a.deadline).getTime()-dlDate(b.deadline).getTime())
          .slice(0,8)
        if (!upcoming.length) return null
        return (
          <div className="mt-4 rounded-xl p-5" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)'}}>
            <div className="font-syne text-[9px] font-bold tracking-widest text-white/25 uppercase mb-4">Próximos vencimientos</div>
            <div className="space-y-1">
              {upcoming.map((p:Project,i:number)=>{
                // estadoDeadline y no una resta de instantes. dlDate() devuelve el
                // deadline a las 23:59:59, asi que a las 09:00 del dia en que vence
                // la resta daba 0,62 -> Math.ceil -> 1 -> "1d" para algo que vence
                // HOY; y lo vencido ayer daba Math.ceil(-0,37) = -0 -> decia HOY.
                // Es el mismo fallo que ya se corrigio en Proyectos, con la misma
                // funcion: un deadline es un DIA, no un instante.
                const dl = estadoDeadline(p.deadline)!
                const daysLeft = dl.dias
                const isOver = dl.vencido
                const isSoon = dl.pronto
                return (
                  <div key={p.id} className="flex items-center gap-3 py-2" style={{borderBottom:i<upcoming.length-1?'1px solid rgba(255,255,255,0.04)':'none'}}>
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{background:p.color||BLU}}/>
                    <div className="flex-1 min-w-0">
                      <span className="text-[12px] text-white/70 truncate block">{p.name}</span>
                      {(p as any).client?.name && <span className="text-[10px] text-white/30">{(p as any).client.name}</span>}
                    </div>
                    <span className="font-syne text-[9px] font-black flex-shrink-0 mr-2" style={{color:isOver?RED:isSoon?'rgba(255,176,32,0.9)':'rgba(255,255,255,0.3)'}}>
                      {isOver?`⚠ hace ${Math.abs(daysLeft)}d`:daysLeft===0?'HOY':`${daysLeft}d`}
                    </span>
                    <span className="font-syne text-[8px] text-white/25 flex-shrink-0">{dlLabel(p.deadline)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Per-client breakdown */}
      {(()=>{
        const rows = clients
          .map((c: Client) => {
            const cProj = projects.filter((p: Project)=>p.client_id===c.id)
            const activeCProj = cProj.filter((p: Project)=>p.status==='activo'||p.status==='urgente')
            const pendingT = tasks.filter((t: Task)=>!t.done&&t.client_id===c.id).length
            const avgProg = activeCProj.length ? Math.round(activeCProj.reduce((s: number,p: Project)=>s+p.progress,0)/activeCProj.length) : null
            return { c, nProj: cProj.length, pendingT, avgProg }
          })
          .filter((r: any) => r.nProj > 0 || r.pendingT > 0)
          .sort((a: any, b: any) => b.pendingT - a.pendingT)
        if (!rows.length) return null
        return (
          <div className="mt-4 rounded-xl p-5" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)'}}>
            <div className="font-syne text-[9px] font-bold tracking-widest text-white/25 uppercase mb-4">Resumen por cliente</div>
            <div className="space-y-1">
              {rows.map(({c,nProj,pendingT,avgProg}: any, i: number) => (
                <div key={c.id} className="flex items-center gap-3 py-2.5" style={{borderBottom:i<rows.length-1?'1px solid rgba(255,255,255,0.04)':'none'}}>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center font-syne text-[9px] font-black flex-shrink-0" style={{background:c.color+'18',color:c.color}}>{c.initials}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[12px] text-white/70 font-medium truncate">{c.name}</span>
                      <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:c.status==='Activo'?'rgba(34,197,94,0.08)':'rgba(255,255,255,0.04)',color:c.status==='Activo'?GRN:'rgba(255,255,255,0.25)'}}>{c.status.toUpperCase()}</span>
                    </div>
                    {avgProg !== null && (
                      <div className="h-1 rounded-full" style={{background:'rgba(255,255,255,0.05)'}}>
                        <div className="h-full rounded-full transition-all" style={{width:`${avgProg}%`,background:`linear-gradient(90deg,${c.color}70,${c.color})`}}/>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {avgProg !== null && <span className="font-syne text-[8px] font-black w-9 text-right" style={{color:c.color+'aa'}}>{avgProg}%</span>}
                    <span className="font-syne text-[8px] font-black w-14 text-right" style={{color:'rgba(255,255,255,0.25)'}}>{nProj} proy.</span>
                    <span className="font-syne text-[8px] font-black w-6 text-right" style={{color:pendingT>0?'rgba(100,140,255,0.65)':'rgba(255,255,255,0.15)'}}>{pendingT}t</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default ReportesSection
