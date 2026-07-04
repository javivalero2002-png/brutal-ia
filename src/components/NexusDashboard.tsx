'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNexusData } from '@/hooks/useNexusData'
import type { Profile, Task, Project, Client, Regla } from '@/types'
import { createClient } from '@/lib/supabase/client'

// ── Design tokens ──────────────────────────────────────────
const BLU = '#1B5FFA', RED = '#E51D2A', GRN = '#22c55e'
const SURFACE = '#0A0A14', SURF2 = '#0F0F1E'
const BORDER = 'rgba(255,255,255,0.06)'

// ── Helpers ─────────────────────────────────────────────────
const strColor = (s: string) => {
  const palette = ['#3B82F6','#8B5CF6','#EC4899','#F59E0B','#10B981','#EF4444','#06B6D4','#F97316','#6366F1','#84CC16']
  let h = 0; for (let i=0;i<s.length;i++) h = s.charCodeAt(i)+((h<<5)-h)
  return palette[Math.abs(h) % palette.length]
}
const relTime = (iso: string) => {
  const m = Math.floor((Date.now()-new Date(iso).getTime())/60000)
  if (m<2) return 'ahora'
  if (m<60) return `${m}m`
  if (m<1440) return `${Math.floor(m/60)}h`
  if (m<10080) return `${Math.floor(m/1440)}d`
  return new Date(iso).toLocaleDateString('es-ES',{day:'numeric',month:'short'})
}
const videoEmbed = (url: string) => {
  if (!url) return null
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/)
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`
  const vm = url.match(/vimeo\.com\/(\d+)/)
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`
  return null
}

type Section = 'hoy'|'inbox'|'tareas'|'clientes'|'proyectos'|'contenido'|'calendario'|'memoria'|'automatizaciones'|'chat'|'equipo'|'reportes'|'ajustes'

interface Props { profile: Profile }

export default function NexusDashboard({ profile }: Props) {
  const data = useNexusData(profile, (msg) => {
    const sender = msg.from_name || 'Alguien'
    const label = msg.source === 'internal' ? `💬 Mensaje de ${sender}` : `📩 Nuevo mensaje de ${sender}`
    setToast(label)
    setTimeout(() => setToast(null), 4000)
  })
  const [section, setSection] = useState<Section>('hoy')
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Auto-sync Gmail and show toast when redirected back after OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const gmailStatus = params.get('gmail')
    if (gmailStatus === 'connected') {
      window.history.replaceState({}, '', '/dashboard')
      setTimeout(() => {
        setToast('Gmail conectado correctamente')
        if (profile.gmail_connected) data.syncGmail()
      }, 800)
      setSection('inbox')
    } else if (gmailStatus === 'error' || gmailStatus === 'no_refresh_token') {
      window.history.replaceState({}, '', '/dashboard')
      setToast('Error al conectar Gmail. Inténtalo de nuevo.')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchIdx, setSearchIdx] = useState(-1)
  const [modal, setModal] = useState<string|null>(null)
  const [mf, setMf] = useState<Record<string,string>>({})
  const [modalSaving, setModalSaving] = useState(false)
  const [toast, setToast] = useState<string|null>(null)
  const [selectedClient, setSelectedClient] = useState<string|null>(null)
  const [selectedProject, setSelectedProject] = useState<string|null>(null)
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [projView, setProjView] = useState<'board'|'list'>('board')
  const [projStatusFilter, setProjStatusFilter] = useState('Todos')
  const [memFilter, setMemFilter] = useState('Todos')
  const searchRef = useRef<HTMLInputElement>(null)
  const sr = useRef<any[]>([])
  const supabase = createClient()

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true); setSearchQuery(''); setSearchIdx(-1) }
      if (e.key === 'Escape') { setSearchOpen(false); setModal(null) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Auto-sync Gmail on load + every 10 min
  useEffect(() => {
    if (profile.gmail_connected) data.syncGmail()
    const interval = setInterval(() => {
      if (profile.gmail_connected) data.syncGmail()
    }, 10 * 60 * 1000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.gmail_connected])

  // Show sync result as toast
  useEffect(() => {
    if (data.syncResult) {
      showToast(data.syncResult.message)
    }
  }, [data.syncResult, showToast])

  const handleSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSearchIdx(i => Math.min(i+1, sr.current.length-1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSearchIdx(i => Math.max(i-1, -1)) }
    else if (e.key === 'Enter' && searchIdx >= 0 && sr.current[searchIdx]) sr.current[searchIdx].act()
    else if (e.key === 'Escape') setSearchOpen(false)
  }

  const searchResults = (() => {
    const q = searchQuery.toLowerCase().trim()
    if (q.length < 2) return []
    return [
      ...data.clients.map(c => ({ type:'Cliente', title:c.name, sub:c.industry, act:()=>{ setSelectedClient(c.id); setSection('clientes'); setSearchOpen(false) }})),
      ...data.projects.map(p => ({ type:'Proyecto', title:p.name, sub:p.client?.name||'—', act:()=>{ setSelectedProject(p.id); setSection('proyectos'); setSearchOpen(false) }})),
      ...data.tasks.map(t => ({ type:'Tarea', title:t.text, sub:t.level, act:()=>{ setSection('hoy'); setSearchOpen(false) }})),
      ...data.memoria.map(m => ({ type:'Memoria', title:m.title, sub:m.category, act:()=>{ setSection('memoria'); setSearchOpen(false) }})),
    ].filter(r => r.title.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q)).slice(0, 8)
  })()
  sr.current = searchResults

  const typeColor: Record<string,string> = { Cliente:BLU, Proyecto:'rgba(255,176,32,0.9)', Tarea:RED, Memoria:'rgba(240,240,248,0.4)' }

  const saveModal = async () => {
    setModalSaving(true)
    try {
      if (modal === 'cliente') {
        if (!mf.name?.trim()) { showToast('Escribe el nombre del cliente'); return }
        await data.createClient({ name:mf.name.trim(), industry:mf.industria||'—', revenue:mf.facturacion||'—', color:BLU })
        showToast('Cliente creado: '+mf.name)
      } else if (modal === 'proyecto') {
        if (!mf.nombre?.trim()) { showToast('Escribe el nombre'); return }
        const client = data.clients.find(c => c.name.toLowerCase() === mf.cliente?.toLowerCase())
        await data.createProject({ name:mf.nombre.trim(), client_id:client?.id, status:'activo', progress:0, deadline:mf.deadline||'TBD', color:BLU })
        showToast('Proyecto creado: '+mf.nombre)
      } else if (modal === 'tarea') {
        if (!mf.text?.trim()) { showToast('Escribe la tarea'); return }
        const level: 'urgent'|'high'|'normal' = mf.priority==='urgente'?'urgent':mf.priority==='high'?'high':'normal'
        // mf.asignado stores the member NAME; find by name
        const assignee = data.team.find((m: Profile) => m.name === mf.asignado)
        await data.createTask({ text:mf.text.trim(), level, assigned_to:assignee?.id, source:'manual' })
        showToast('Tarea creada')
      } else if (modal === 'memoria') {
        if (!mf.titulo?.trim()) { showToast('Escribe el título'); return }
        await data.createMemoria({ title:mf.titulo.trim(), category:mf.categoria||'General', content:mf.contenido||'' })
        showToast('Entrada guardada')
      } else if (modal === 'regla') {
        if (!mf.nombre?.trim()) { showToast('Escribe el nombre'); return }
        await data.createRegla({ name:mf.nombre.trim(), condition_text:mf.condicion, action_text:mf.accion, active:true })
        showToast('Regla creada')
      } else if (modal === 'contenido') {
        if (!mf.titulo?.trim()) { showToast('Escribe el título'); return }
        await data.createAgenda({ title:mf.titulo.trim(), platform:mf.plataforma||'Instagram', content_type:'Post', status:'borrador', publish_date:mf.fecha })
        showToast('Pieza añadida')
      }
      setModal(null); setMf({})
    } catch (err: any) { showToast('Error: '+err.message) }
    finally { setModalSaving(false) }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const unreadCount = data.inbox.filter(m => !m.is_read).length
  const urgentCount = data.tasks.filter(t => !t.done && t.level === 'urgent').length
  const isOwner = profile.role === 'owner'

  const filteredProjects = projStatusFilter === 'Todos' ? data.projects : data.projects.filter(p => p.status === projStatusFilter)
  const kanbanCols = [
    { title:'Plan.', color:'rgba(240,240,248,0.25)', status:'plan.', items:filteredProjects.filter(p=>p.status==='plan.') },
    { title:'Progreso', color:BLU, status:'activo', items:filteredProjects.filter(p=>p.status==='activo') },
    { title:'Urgente', color:RED, status:'urgente', items:filteredProjects.filter(p=>p.status==='urgente') },
    { title:'Revisión', color:'rgba(255,176,32,0.7)', status:'revisión', items:filteredProjects.filter(p=>p.status==='revisión') },
  ]

  const dragRef = useRef<string|null>(null)

  const navItem = (id: Section, label: string, icon: string, badge?: number) => {
    const act = section === id
    return (
      <button key={id} onClick={()=>setSection(id)} className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-left transition-all" style={{ background:act?'rgba(27,95,250,0.1)':'transparent', color:act?'#F0F0F8':'rgba(240,240,248,0.38)', border:act?`1px solid rgba(27,95,250,0.2)`:'1px solid transparent', fontSize:'13.5px', fontWeight:act?'600':'400', marginBottom:'2px' }}>
        <LucideIcon name={icon} size={15} color={act?BLU:'rgba(240,240,248,0.2)'}/>
        <span className="flex-1 truncate">{label}</span>
        {badge !== undefined && badge > 0 && <span className="font-syne text-[8.5px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center" style={{background:act?BLU:'rgba(229,29,42,0.15)',color:act?'white':RED}}>{badge}</span>}
      </button>
    )
  }

  if (data.loading) {
    return (
      <div className="flex h-screen items-center justify-center" style={{background:'#030308'}}>
        <div className="text-center">
          <div className="font-syne text-[10px] font-black tracking-[0.3em] mb-6" style={{color:'rgba(27,95,250,0.5)'}}>BRUTAL.IA</div>
          <div className="flex gap-2 justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-dot1"/>
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-dot2"/>
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-dot3"/>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-full font-figtree overflow-hidden" style={{ background:'radial-gradient(ellipse 1400px 700px at 80% -10%,rgba(27,95,250,0.055) 0%,transparent 60%),radial-gradient(ellipse 500px 400px at 5% 95%,rgba(27,95,250,0.025) 0%,transparent 55%),#030308', color:'#F0F0F8' }}>

      {/* SIDEBAR */}
      <aside className="flex-shrink-0 flex flex-col overflow-hidden transition-all duration-200" style={{ width:sidebarOpen?'248px':'0', background:'rgba(8,8,18,0.95)', borderRight:`1px solid ${BORDER}` }}>
        {/* Logo */}
        <div className="px-5 pt-6 pb-5 flex-shrink-0">
          <div className="flex items-center gap-3">
            <img src="https://brutal.thehook-produccion.es/wp-content/themes/brutal-studios/assets/img/brutal-logo-white.svg" alt="Brutal Studios" className="h-5 opacity-90" />
            <div className="h-5 w-px" style={{background:BORDER}}/>
            <span className="font-syne text-[11px] font-black tracking-widest" style={{color:BLU}}>IA</span>
            <div className="ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0 animate-glowPulse" style={{background:BLU}}/>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 pb-2 space-y-0.5">
          <div className="mb-1 mt-1">
            {navItem('hoy','Hoy','sun',urgentCount)}
            {navItem('inbox','Inbox','inbox',unreadCount)}
            {navItem('calendario','Calendario','calendar')}
            {navItem('equipo','Equipo','users-2')}
          </div>
          <div className="my-2" style={{height:'1px',background:BORDER}}/>
          <div className="mb-1">
            {navItem('tareas','Tareas','check-square',data.tasks.filter((t:Task)=>!t.done&&t.level==='urgent').length||undefined)}
            {navItem('clientes','Clientes','users')}
            {navItem('proyectos','Proyectos','folder-open')}
            {navItem('contenido','Contenido','film')}
          </div>
          <div className="my-2" style={{height:'1px',background:BORDER}}/>
          <div className="mb-1">
            {navItem('memoria','Memoria','database')}
            {navItem('automatizaciones','Automatizaciones','zap',data.reglas.filter(r=>r.active).length||undefined)}
            {isOwner && navItem('reportes','Reportes','bar-chart-2')}
          </div>
          <div className="my-2" style={{height:'1px',background:BORDER}}/>
          <div>
            {navItem('chat','Brutal.IA','message-square')}
            {navItem('ajustes','Ajustes','settings')}
          </div>
        </nav>

        {/* Footer */}
        <div className="p-3 flex-shrink-0" style={{borderTop:`1px solid ${BORDER}`}}>
          {!profile.gmail_connected ? (
            <a href="/api/gmail/connect" className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl mb-2 font-syne text-[10px] font-black tracking-wide" style={{background:'rgba(27,95,250,0.07)',color:BLU,border:`1px solid rgba(27,95,250,0.18)`}}>
              <LucideIcon name="mail" size={13} color={BLU}/>Conectar Gmail
            </a>
          ) : (
            <button onClick={()=>data.syncGmail()} disabled={data.syncing} className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl mb-2 font-syne text-[10px] font-black tracking-wide disabled:opacity-30 transition-opacity" style={{background:SURF2,color:'rgba(240,240,248,0.3)'}}>
              <LucideIcon name="refresh-cw" size={12} color="rgba(27,95,250,0.45)"/>
              {data.syncing ? 'Sincronizando…' : 'Sync Gmail'}
            </button>
          )}
          <div className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-white/2 transition-colors cursor-default">
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 font-syne text-[11px] font-black" style={{background:profile.avatar_color+'18',border:`1.5px solid ${profile.avatar_color}35`,color:profile.avatar_color}}>{profile.initials}</div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-white/75 truncate leading-tight">{profile.name}</div>
              <div className="text-[10px] mt-0.5" style={{color:'rgba(255,255,255,0.2)'}}>{profile.role === 'owner' ? 'Propietario' : 'Equipo'}</div>
            </div>
            <button onClick={handleLogout} className="opacity-20 hover:opacity-50 transition-opacity flex-shrink-0"><LucideIcon name="log-out" size={14}/></button>
          </div>
          <button onClick={()=>setSidebarOpen(false)} className="flex items-center justify-center w-full py-1.5 mt-1 transition-colors" style={{color:'rgba(255,255,255,0.12)'}}>
            <LucideIcon name="panel-left-close" size={13}/>
          </button>
        </div>
      </aside>

      {!sidebarOpen && (
        <button onClick={()=>setSidebarOpen(true)} className="fixed top-5 left-4 z-50 w-8 h-8 flex items-center justify-center rounded-xl transition-all" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
          <LucideIcon name="panel-left-open" size={14} color="rgba(240,240,248,0.4)"/>
        </button>
      )}

      {/* MAIN */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {section === 'hoy' && <HoySection profile={profile} data={data} urgentCount={urgentCount} unreadCount={unreadCount} onOpenModal={setModal} showToast={showToast} isOwner={profile.role==='owner'} />}
          {section === 'inbox' && <InboxSection data={data} showToast={showToast} profile={profile} />}
          {section === 'tareas' && <TareasSection data={data} onOpenModal={setModal} showToast={showToast} isOwner={profile.role==='owner'} />}
          {section === 'equipo' && <EquipoSection data={data} profile={profile} showToast={showToast} />}
          {section === 'reportes' && <ReportesSection data={data} />}
          {section === 'clientes' && <ClientesSection data={data} selectedId={selectedClient} onSelect={setSelectedClient} onOpenModal={setModal} showToast={showToast} isOwner={profile.role==='owner'} />}
          {section === 'proyectos' && <ProyectosSection data={data} filteredProjects={filteredProjects} kanbanCols={kanbanCols} projView={projView} setProjView={setProjView} projStatusFilter={projStatusFilter} setProjStatusFilter={setProjStatusFilter} dragRef={dragRef} selectedId={selectedProject} onSelect={setSelectedProject} onOpenModal={setModal} showToast={showToast} isOwner={profile.role==='owner'} />}
          {section === 'contenido' && <ContenidoSection data={data} onOpenModal={setModal} showToast={showToast} />}
          {section === 'calendario' && <CalendarioSection data={data} profile={profile} showToast={showToast} onOpenModal={setModal} />}
          {section === 'memoria' && <MemoriaSection data={data} memFilter={memFilter} setMemFilter={setMemFilter} onOpenModal={setModal} showToast={showToast} />}
          {section === 'automatizaciones' && <AutomatizacionesSection data={data} onOpenModal={setModal} showToast={showToast} isOwner={profile.role==='owner'} />}
          {section === 'chat' && <ChatSection profile={profile} data={data} chatInput={chatInput} setChatInput={setChatInput} chatLoading={chatLoading} setChatLoading={setChatLoading} showToast={showToast} />}
          {section === 'ajustes' && <AjustesSection profile={profile} data={data} showToast={showToast} />}
        </div>
      </main>

      {/* SEARCH */}
      {searchOpen && (
        <div onClick={()=>setSearchOpen(false)} className="fixed inset-0 z-[110] flex items-start justify-center pt-[14vh]" style={{ background:'rgba(2,2,8,0.7)' }}>
          <div onClick={e=>e.stopPropagation()} className="w-[540px] max-w-[92vw] rounded-2xl overflow-hidden" style={{ background:'#0C0C1C', border:'1px solid rgba(27,95,250,0.25)', boxShadow:'0 32px 80px rgba(0,0,0,0.75)' }}>
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/6">
              <LucideIcon name="search" size={16} color="rgba(27,95,250,0.6)" />
              <input ref={searchRef} autoFocus value={searchQuery} onChange={e=>{setSearchQuery(e.target.value);setSearchIdx(-1)}} onKeyDown={handleSearchKey} placeholder="Busca clientes, proyectos, tareas…" className="flex-1 text-sm bg-transparent text-white placeholder-white/20 outline-none" style={{ caretColor:BLU }} />
              <kbd className="font-syne text-[9px] font-bold text-white/20 px-2 py-1 rounded border border-white/10">ESC</kbd>
            </div>
            <div className="max-h-[340px] overflow-y-auto p-1.5">
              {searchQuery.length >= 2 && searchResults.length === 0 && <div className="py-8 text-center text-white/25 text-sm">Sin resultados</div>}
              {searchResults.map((r,i) => (
                <button key={i} onClick={r.act} className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-left transition-colors" style={{ background:i===searchIdx?'rgba(27,95,250,0.14)':'transparent' }}>
                  <span className="font-syne text-[8px] font-black tracking-widest px-2 py-0.5 rounded" style={{ background:'rgba(255,255,255,0.05)', color:typeColor[r.type]||'rgba(240,240,248,0.4)' }}>{r.type}</span>
                  <span className="flex-1 text-[13px] text-white/85 truncate">{r.title}</span>
                  <span className="text-[11px] text-white/30 flex-shrink-0">{r.sub}</span>
                </button>
              ))}
              {searchQuery.length === 0 && <div className="px-3 py-3 text-[11px] text-white/20">Busca clientes, proyectos, tareas, memorias…</div>}
            </div>
            <div className="px-5 py-2.5 border-t border-white/5 text-[10px] text-white/20">↑↓ navegar · Enter seleccionar · Esc cerrar</div>
          </div>
        </div>
      )}

      {/* MODAL */}
      {modal && (
        <div onClick={()=>setModal(null)} className="fixed inset-0 z-[100] flex items-center justify-center" style={{background:'rgba(2,2,10,0.8)',backdropFilter:'blur(8px)'}}>
          <div onClick={e=>e.stopPropagation()} className="relative w-[480px] max-w-[94vw] rounded-3xl overflow-hidden" style={{background:'linear-gradient(180deg,#0D0D1E 0%,#080810 100%)',border:`1px solid rgba(27,95,250,0.25)`,boxShadow:'0 40px 100px rgba(0,0,0,0.8),0 0 0 1px rgba(27,95,250,0.05)'}}>
            {/* Top accent */}
            <div className="h-[2px] rounded-t-3xl" style={{background:`linear-gradient(90deg,transparent,${BLU},transparent)`}}/>
            {/* Header */}
            <div className="flex items-center justify-between px-7 py-6" style={{borderBottom:`1px solid ${BORDER}`}}>
              <div>
                <div className="font-syne text-[9px] font-black tracking-widest mb-1.5" style={{color:'rgba(100,140,255,0.6)'}}>{modalMeta[modal]?.eyebrow}</div>
                <h2 className="font-syne text-[22px] font-black text-white leading-none">{modalMeta[modal]?.title}</h2>
              </div>
              <button onClick={()=>setModal(null)} className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5" style={{background:SURF2}}>
                <LucideIcon name="x" size={16} color="rgba(240,240,248,0.45)"/>
              </button>
            </div>
            {/* Fields */}
            <div className="px-7 py-6 space-y-5">
              {modalFields(modal, data.team).map(f => (
                <div key={f.key}>
                  <label className="block font-syne text-[9px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.28)'}}>{f.label.toUpperCase()}</label>
                  {f.type === 'priority' ? (
                    <div className="flex gap-2">
                      {[{v:'urgente',l:'Urgente',c:RED},{v:'high',l:'Alta',c:'rgba(255,176,32,0.9)'},{v:'normal',l:'Normal',c:BLU}].map(p=>(
                        <button key={p.v} onClick={()=>setMf(m=>({...m,[f.key]:p.v}))} className="flex-1 py-3 rounded-2xl font-syne text-[10px] font-black tracking-wide transition-all" style={{background:mf[f.key]===p.v?p.c+'18':SURF2,border:`1.5px solid ${mf[f.key]===p.v?p.c+'70':BORDER}`,color:mf[f.key]===p.v?p.c:'rgba(255,255,255,0.35)'}}>
                          {p.l.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  ) : f.type === 'assignee' ? (
                    <div className="flex flex-wrap gap-2">
                      {data.team.map((m:Profile)=>(
                        <button key={m.id} onClick={()=>setMf(x=>({...x,[f.key]:x[f.key]===m.name?'':m.name}))} className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl transition-all" style={{background:mf[f.key]===m.name?m.avatar_color+'18':SURF2,border:`1.5px solid ${mf[f.key]===m.name?m.avatar_color+'55':BORDER}`}}>
                          <div className="w-7 h-7 rounded-full flex items-center justify-center font-syne text-[10px] font-black flex-shrink-0" style={{background:m.avatar_color+'25',color:m.avatar_color}}>{m.initials}</div>
                          <span className="text-[13px]" style={{color:mf[f.key]===m.name?'rgba(255,255,255,0.9)':'rgba(255,255,255,0.45)'}}>{m.name.split(' ')[0]}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input value={mf[f.key]||''} onChange={e=>setMf(m=>({...m,[f.key]:e.target.value}))} placeholder={f.placeholder} className="w-full px-5 py-3.5 rounded-2xl text-[14px] text-white placeholder-white/20 outline-none transition-all" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.45)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
                  )}
                </div>
              ))}
            </div>
            {/* Footer */}
            <div className="flex justify-end gap-3 px-7 py-5" style={{borderTop:`1px solid ${BORDER}`}}>
              <button onClick={()=>setModal(null)} className="px-5 py-3 rounded-2xl text-[13px] transition-colors hover:text-white/70" style={{color:'rgba(255,255,255,0.4)',border:`1px solid ${BORDER}`}}>Cancelar</button>
              <button onClick={saveModal} disabled={modalSaving} className="px-6 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white disabled:opacity-50 transition-all" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
                {modalSaving?'GUARDANDO…':modalMeta[modal]?.saveLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[90] flex items-center gap-3 px-5 py-3 rounded-xl animate-riseT" style={{ transform:'translateX(-50%)', background:'#14142A', border:'1px solid rgba(27,95,250,0.3)', boxShadow:'0 16px 44px rgba(0,0,0,0.55)' }}>
          <div className="w-1.5 h-1.5 rounded-full animate-pls" style={{ background:BLU }} />
          <span className="text-sm text-white/85">{toast}</span>
        </div>
      )}

      {/* Search shortcut button */}
      <button onClick={()=>setSearchOpen(true)} className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne text-[10px] font-bold tracking-widest text-white/30 opacity-60 hover:opacity-100 transition-opacity" style={{ background:'rgba(27,95,250,0.08)', border:'1px solid rgba(27,95,250,0.15)' }}>
        <LucideIcon name="search" size={12} color="rgba(27,95,250,0.5)" />
        <span>⌘K</span>
      </button>
    </div>
  )
}

// ── Modal config ────────────────────────────────────────────
const modalMeta: Record<string,{eyebrow:string;title:string;saveLabel:string}> = {
  cliente: { eyebrow:'GESTIÓN · CLIENTES', title:'Nuevo Cliente', saveLabel:'CREAR CLIENTE' },
  proyecto: { eyebrow:'GESTIÓN · PROYECTOS', title:'Nuevo Proyecto', saveLabel:'CREAR PROYECTO' },
  tarea: { eyebrow:'GESTIÓN · TAREAS', title:'Nueva Tarea', saveLabel:'CREAR TAREA' },
  memoria: { eyebrow:'BRUTAL.IA · MEMORIA', title:'Nueva Entrada', saveLabel:'GUARDAR' },
  regla: { eyebrow:'AUTOMATIZACIONES', title:'Nueva Regla', saveLabel:'CREAR REGLA' },
  contenido: { eyebrow:'CONTENIDO', title:'Nueva Pieza', saveLabel:'AÑADIR PIEZA' },
}

function modalFields(type: string, team: Profile[]) {
  const f = (label:string,key:string,placeholder:string,extra?:any) => ({label,key,placeholder,...extra})
  const maps: Record<string,any[]> = {
    cliente: [
      f('Nombre del cliente','name','Ej: Nike España'),
      f('Industria','industria','Ej: Fashion · Lifestyle'),
      f('Facturación mensual','facturacion','Ej: €12.000/mes'),
    ],
    proyecto: [
      f('Nombre del proyecto','nombre','Ej: Campaign Summer 2026'),
      f('Cliente','cliente','Ej: Nike España'),
      f('Deadline','deadline','Ej: 31 Jul 2026'),
    ],
    tarea: [
      f('Descripción de la tarea','text','Ej: Preparar deck propuesta Q3 para Nike'),
      { label:'Prioridad', key:'priority', type:'priority' },
      { label:'Asignar a', key:'asignado', type:'assignee' },
    ],
    memoria: [
      f('Título','titulo','Ej: Nike — Guía de tono de voz 2026'),
      f('Categoría','categoria','Clientes / Procesos / Decisiones / Aprendizajes'),
      f('Contenido','contenido','Escribe el contenido de esta entrada…'),
    ],
    regla: [
      f('Nombre de la regla','nombre','Ej: Alerta propuestas sin respuesta'),
      f('Condición','condicion','Ej: Email urgente de cliente sin tarea'),
      f('Acción automática','accion','Ej: Crear tarea de seguimiento urgente'),
    ],
    contenido: [
      f('Título de la pieza','titulo','Ej: Stories lanzamiento verano Nike'),
      f('Cliente','cliente','Ej: Nike España'),
      f('Plataforma','plataforma','TikTok / Instagram / LinkedIn / YouTube'),
      f('Fecha de publicación','fecha','Ej: 10 Jul 2026'),
    ],
  }
  return maps[type] || []
}


// ── Lucide Icon stub (replaced by actual lucide-react in prod) ──
function LucideIcon({ name, size=16, color='currentColor' }: {name:string;size?:number;color?:string}) {
  const icons: Record<string,string> = {
    sun:'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0-15v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42',
    inbox:'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 17.76 4H6.24a2 2 0 0 0-1.79 1.11z',
    users:'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    'folder-open':'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
    calendar:'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM16 2v4M8 2v4M3 10h18',
    database:'M12 2C6.48 2 2 4.24 2 7s4.48 5 10 5 10-2.24 10-5-4.48-5-10-5zM2 7v5c0 2.76 4.48 5 10 5s10-2.24 10-5V7M2 12v5c0 2.76 4.48 5 10 5s10-2.24 10-5v-5',
    zap:'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
    'message-square':'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    settings:'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
    mail:'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM22 6l-10 7L2 6',
    'refresh-cw':'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
    'log-out':'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    'panel-left-close':'M22 3H2M22 21H2M22 12H2M9 3v18',
    'panel-left-open':'M22 3H2M22 21H2M22 12H2M15 3v18',
    search:'M11 17.25a6.25 6.25 0 1 1 0-12.5 6.25 6.25 0 0 1 0 12.5zM16 16l4.5 4.5',
    x:'M18 6 6 18M6 6l12 12',
    'more-horizontal':'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
    check:'M20 6 9 17l-5-5',
    trash:'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
    'trash-2':'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
    plus:'M12 5v14M5 12h14',
    'arrow-left':'M19 12H5M12 5l-7 7 7 7',
    send:'M22 2 11 13M22 2 15 22 11 13 2 9l20-7z',
    printer:'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6v-8z',
    download:'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
    bell:'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
    'check-circle':'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3',
    alert:'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
    'external-link':'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
    'chevron-right':'M9 18l6-6-6-6',
    'chevron-up':'M18 15l-6-6-6 6',
    'chevron-left':'M15 18l-6-6 6-6',
    'chevron-down':'M6 9l6 6 6-6',
    'clock':'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-14v4l3 3',
    'map-pin':'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
    'users-2':'M14 19a6 6 0 0 0-12 0M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm3 7a5 5 0 0 0-5-5',
    'check-square':'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
    'film':'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM2 8h20M2 16h20M6 2v4M18 2v4M6 18v4M18 18v4',
  }
  const d = icons[name]
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
      {d && <path d={d}/>}
    </svg>
  )
}

// ── Helpers ─────────────────────────────────────────────────
function ProgressRing({ pct, size=52, stroke=3, color=BLU }: { pct:number, size?:number, stroke?:number, color?:string }) {
  const r = (size - stroke * 2) / 2
  const c = 2 * Math.PI * r
  const dash = Math.max(0, Math.min(1, pct / 100)) * c
  return (
    <svg width={size} height={size} style={{transform:'rotate(-90deg)',flexShrink:0}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={stroke}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${dash} ${c}`} strokeLinecap="round"/>
    </svg>
  )
}

// ── HOY SECTION ─────────────────────────────────────────────
// ── TAREAS SECTION ───────────────────────────────────────────
function TareasSection({data,onOpenModal,showToast,isOwner}: any) {
  const [filter, setFilter] = useState<'todas'|'urgente'|'high'|'normal'|'hecho'>('todas')
  const [assigneeFilter, setAssigneeFilter] = useState('Todos')
  const [activeTask, setActiveTask] = useState<Task|null>(null)
  const [editing, setEditing] = useState<Partial<Task>>({})
  const [saving, setSaving] = useState(false)

  const openTask = (t: Task) => {
    setActiveTask(t)
    setEditing({ text: t.text, level: t.level, assigned_to: t.assigned_to, done: t.done })
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

  const filtered = data.tasks.filter((t: Task) => {
    const byStatus = filter === 'todas' ? !t.done : filter === 'hecho' ? t.done : (!t.done && t.level === filter)
    const byAssignee = assigneeFilter === 'Todos' || t.assignee?.name === assigneeFilter
    return byStatus && byAssignee
  })

  const tabs: {id: 'todas'|'urgente'|'high'|'normal'|'hecho', label: string, color?: string}[] = [
    {id:'todas', label:'Todas'},
    {id:'urgente', label:'Urgente', color:RED},
    {id:'high', label:'Alta', color:'rgba(255,176,32,0.8)'},
    {id:'normal', label:'Normal', color:BLU},
    {id:'hecho', label:'Hechas'},
  ]

  const assignees = ['Todos', ...Array.from(new Set(data.tasks.map((t: Task) => t.assignee?.name).filter(Boolean)))] as string[]
  const levelColor = (l: string) => l==='urgent'?RED:l==='high'?'rgba(255,176,32,0.8)':BLU

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Task list */}
      <div className="flex flex-col overflow-hidden" style={{width:activeTask?'420px':'100%',flexShrink:0,borderRight:activeTask?`1px solid ${BORDER}`:'none'}}>
        <div className="p-8 pb-0 flex-shrink-0">
          <div className="flex items-end justify-between mb-8">
            <div>
              <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-2" style={{color:'rgba(255,255,255,0.18)'}}>GESTIÓN</div>
              <h1 className="font-figtree text-[28px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Tareas</h1>
            </div>
            <button onClick={()=>onOpenModal('tarea')} className="flex items-center gap-2 px-5 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>+ NUEVA</button>
          </div>
          <div className="flex items-center gap-3 mb-5 flex-wrap">
            <div className="flex gap-1 p-1 rounded-2xl" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
              {tabs.map(t=>(
                <button key={t.id} onClick={()=>setFilter(t.id)} className="px-3 py-2 rounded-xl font-syne text-[9px] font-black tracking-wide transition-all" style={{background:filter===t.id?t.color||SURF2:'transparent',color:filter===t.id?'white':t.color||'rgba(255,255,255,0.28)'}}>
                  {t.label.toUpperCase()}
                </button>
              ))}
            </div>
            {isOwner && assignees.length > 1 && (
              <select value={assigneeFilter} onChange={e=>setAssigneeFilter(e.target.value)} className="px-3 py-2 rounded-xl text-[12px] outline-none" style={{background:SURFACE,border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.5)'}}>
                {assignees.map(a=><option key={a} value={a}>{a}</option>)}
              </select>
            )}
            <span className="ml-auto font-syne text-[10px] font-black" style={{color:'rgba(255,255,255,0.2)'}}>{filtered.length}</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-8 pb-8">
          <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            {filtered.length === 0 && <div className="py-16 text-center text-[13px]" style={{color:'rgba(255,255,255,0.18)'}}>Sin tareas en este filtro</div>}
            {filtered.map((t: Task, i: number) => {
              const pc = t.done ? 'rgba(255,255,255,0.08)' : levelColor(t.level)
              return (
              <div key={t.id} onClick={()=>openTask(t)} className="flex items-start gap-3 px-5 py-4 cursor-pointer group hover:bg-white/[0.015] transition-all" style={{background:activeTask?.id===t.id?'rgba(27,95,250,0.06)':'transparent',borderBottom:i===filtered.length-1?'none':`1px solid ${BORDER}`,borderLeft:`3px solid ${activeTask?.id===t.id?BLU:t.done?'transparent':pc+'60'}`}}>
                <button onClick={e=>{e.stopPropagation();data.toggleTask(t.id)}} className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-1 transition-all" style={{background:t.done?pc:'transparent',border:`2px solid ${t.done?pc:pc+'60'}`}}>
                  {t.done && <LucideIcon name="check" size={8} color="white"/>}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="font-figtree text-[14px] font-semibold leading-snug mb-1.5" style={{color:t.done?'rgba(255,255,255,0.22)':'rgba(255,255,255,0.88)',textDecoration:t.done?'line-through':'none'}}>{t.text}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(t.client as any)?.name && <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full" style={{background:(t.client as any).color+'18',color:(t.client as any).color+'cc'}}>{(t.client as any).name}</span>}
                    {t.due_date && <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.35)'}}>{new Date(t.due_date).toLocaleDateString('es-ES',{day:'numeric',month:'short'})}</span>}
                    {!t.done && t.level==='urgent' && <span className="font-syne text-[8px] font-black" style={{color:RED}}>● URGENTE</span>}
                  </div>
                </div>
                {t.assignee && <div className="w-7 h-7 rounded-full flex items-center justify-center font-syne text-[9px] font-black flex-shrink-0 mt-0.5" style={{background:t.assignee.avatar_color+'18',border:`1.5px solid ${t.assignee.avatar_color}35`,color:t.assignee.avatar_color}}>{t.assignee.initials}</div>}
              </div>
            )})}

          </div>
        </div>
      </div>

      {/* Right: Task detail drawer */}
      {activeTask && (
        <div className="flex-1 overflow-y-auto min-w-0" style={{background:'#050510'}}>
          {/* Header */}
          <div className="flex items-center justify-between px-7 py-5 sticky top-0 z-10" style={{background:'rgba(5,5,16,0.95)',backdropFilter:'blur(12px)',borderBottom:`1px solid ${BORDER}`}}>
            <button onClick={()=>setActiveTask(null)} className="flex items-center gap-2 text-[13px] transition-colors hover:text-white/70" style={{color:'rgba(255,255,255,0.35)'}}>
              <LucideIcon name="arrow-left" size={14}/> Tareas
            </button>
            <div className="flex items-center gap-2">
              {isOwner && (
                <button onClick={async()=>{await data.deleteTask(activeTask.id);setActiveTask(null);showToast('Tarea eliminada')}} className="px-3 py-2 rounded-xl font-syne text-[9px] font-black tracking-wide transition-colors" style={{color:'rgba(229,29,42,0.5)',border:`1px solid rgba(229,29,42,0.15)`}}>ELIMINAR</button>
              )}
              <button onClick={saveTask} disabled={saving} className="px-5 py-2.5 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white disabled:opacity-40 transition-all" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
                {saving?'GUARDANDO…':'GUARDAR'}
              </button>
            </div>
          </div>

          <div className="p-7 space-y-6">
            {/* Title editable */}
            <div>
              <label className="block font-syne text-[9px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.25)'}}>DESCRIPCIÓN</label>
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
              <div className="flex items-center justify-between">
                <span className="font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>CREADA</span>
                <span className="text-[12px]" style={{color:'rgba(255,255,255,0.35)'}}>{new Date(activeTask.created_at).toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'})}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── EQUIPO SECTION ────────────────────────────────────────────
function EquipoSection({data, profile, showToast}: any) {
  const [compose, setCompose] = useState<Profile|null>(null)
  const [msgSubject, setMsgSubject] = useState('')
  const [msgBody, setMsgBody] = useState('')
  const [sending, setSending] = useState(false)

  const sendMessage = async () => {
    if (!compose || !msgBody.trim()) return
    setSending(true)
    try {
      await data.sendInternalMessage(compose.id, msgSubject||'Mensaje directo', msgBody, profile?.name||'Equipo')
      showToast(`Mensaje enviado a ${compose.name.split(' ')[0]}`)
      setCompose(null); setMsgSubject(''); setMsgBody('')
    } catch { showToast('Error enviando mensaje') }
    finally { setSending(false) }
  }

  return (
    <div className="p-8 max-w-[1100px] mx-auto">
      <div className="mb-10">
        <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-2" style={{color:'rgba(255,255,255,0.18)'}}>BRUTAL STUDIOS</div>
        <h1 className="font-figtree text-[28px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Equipo</h1>
      </div>
      {data.team.length === 0 ? (
        <div className="text-center py-16 text-[13px]" style={{color:'rgba(255,255,255,0.2)'}}>Sin datos de equipo</div>
      ) : (
        <div className="grid grid-cols-2 gap-5">
          {data.team.map((member: Profile) => {
            const memberTasks = data.tasks.filter((t: Task) => t.assignee?.name === member.name)
            const pending = memberTasks.filter((t: Task) => !t.done)
            const done = memberTasks.filter((t: Task) => t.done)
            const urgent = pending.filter((t: Task) => t.level === 'urgent')
            const completePct = memberTasks.length > 0 ? Math.round((done.length/memberTasks.length)*100) : 0
            const isMe = member.id === profile?.id
            return (
              <div key={member.id} className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
                <div className="flex items-center gap-4 p-6" style={{borderBottom:`1px solid ${BORDER}`}}>
                  <div className="relative flex-shrink-0">
                    <ProgressRing pct={completePct} size={52} stroke={3} color={member.avatar_color}/>
                    <div className="absolute inset-0 flex items-center justify-center font-syne text-[11px] font-black" style={{color:member.avatar_color}}>{member.initials}</div>
                  </div>
                  <div className="flex-1">
                    <div className="font-syne text-[16px] font-black text-white flex items-center gap-2">
                      {member.name}
                      {isMe && <span className="font-syne text-[7px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(27,95,250,0.1)',color:BLU}}>TÚ</span>}
                    </div>
                    <div className="text-[11px] mt-0.5" style={{color:'rgba(255,255,255,0.3)'}}>{member.role==='owner'?'Propietario':'Equipo'} · {member.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {urgent.length > 0 && <span className="font-syne text-[8px] font-black px-2.5 py-1 rounded-full" style={{background:'rgba(229,29,42,0.1)',color:RED}}>{urgent.length} URG</span>}
                    {!isMe && (
                      <button onClick={()=>setCompose(member)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-syne text-[9px] font-black tracking-wide transition-all hover:opacity-80" style={{background:'rgba(27,95,250,0.1)',color:BLU,border:`1px solid rgba(27,95,250,0.2)`}}>
                        <LucideIcon name="send" size={11} color={BLU}/>MENSAJE
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3" style={{borderBottom:`1px solid ${BORDER}`}}>
                  {[{v:pending.length,l:'Pendientes'},{v:done.length,l:'Completadas'},{v:`${completePct}%`,l:'Ratio'}].map((s,i)=>(
                    <div key={i} className="p-4 text-center" style={{borderRight:i<2?`1px solid ${BORDER}`:'none'}}>
                      <div className="font-figtree text-[24px] font-black mb-0.5" style={{color:i===0&&pending.length>0?BLU:'rgba(255,255,255,0.8)'}}>{s.v}</div>
                      <div className="text-[9px]" style={{color:'rgba(255,255,255,0.25)'}}>{s.l}</div>
                    </div>
                  ))}
                </div>
                <div className="px-5 py-4">
                  {pending.slice(0,3).map((t: Task) => (
                    <div key={t.id} className="flex items-center gap-3 py-2.5" style={{borderBottom:`1px solid ${BORDER}`}}>
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.7)':BLU}}/>
                      <span className="text-[12px] flex-1 truncate" style={{color:'rgba(255,255,255,0.55)'}}>{t.text}</span>
                    </div>
                  ))}
                  {pending.length===0 && <div className="text-center text-[11px] py-3" style={{color:'rgba(255,255,255,0.2)'}}>Sin tareas asignadas</div>}
                  {pending.length > 3 && <div className="text-center text-[11px] pt-2" style={{color:'rgba(255,255,255,0.25)'}}>+{pending.length-3} más</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Compose modal */}
      {compose && (
        <div onClick={()=>setCompose(null)} className="fixed inset-0 z-[100] flex items-center justify-center" style={{background:'rgba(2,2,10,0.8)',backdropFilter:'blur(8px)'}}>
          <div onClick={e=>e.stopPropagation()} className="w-[480px] max-w-[94vw] rounded-3xl overflow-hidden" style={{background:'linear-gradient(180deg,#0D0D1E 0%,#080810 100%)',border:`1px solid rgba(27,95,250,0.25)`,boxShadow:'0 40px 100px rgba(0,0,0,0.8)'}}>
            <div className="h-[2px] rounded-t-3xl" style={{background:`linear-gradient(90deg,transparent,${BLU},transparent)`}}/>
            <div className="flex items-center justify-between px-7 py-6" style={{borderBottom:`1px solid ${BORDER}`}}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full flex items-center justify-center font-syne text-[11px] font-black" style={{background:compose.avatar_color+'25',border:`1.5px solid ${compose.avatar_color}55`,color:compose.avatar_color}}>{compose.initials}</div>
                <div>
                  <div className="font-syne text-[9px] font-black tracking-widest mb-0.5" style={{color:'rgba(100,140,255,0.6)'}}>MENSAJE DIRECTO</div>
                  <div className="font-syne text-[18px] font-black text-white">{compose.name}</div>
                </div>
              </div>
              <button onClick={()=>setCompose(null)} className="w-9 h-9 rounded-xl flex items-center justify-center" style={{background:SURF2}}><LucideIcon name="x" size={16} color="rgba(240,240,248,0.45)"/></button>
            </div>
            <div className="px-7 py-6 space-y-4">
              <div>
                <label className="block font-syne text-[9px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>ASUNTO</label>
                <input value={msgSubject} onChange={e=>setMsgSubject(e.target.value)} placeholder="Ej: Revisión propuesta Nike" className="w-full px-5 py-3.5 rounded-2xl text-[14px] text-white placeholder-white/20 outline-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.45)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
              </div>
              <div>
                <label className="block font-syne text-[9px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>MENSAJE</label>
                <textarea value={msgBody} onChange={e=>setMsgBody(e.target.value)} placeholder="Escribe tu mensaje…" rows={5} className="w-full px-5 py-4 rounded-2xl text-[14px] text-white placeholder-white/20 outline-none resize-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.45)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-7 py-5" style={{borderTop:`1px solid ${BORDER}`}}>
              <button onClick={()=>setCompose(null)} className="px-5 py-3 rounded-2xl text-[13px]" style={{color:'rgba(255,255,255,0.4)',border:`1px solid ${BORDER}`}}>Cancelar</button>
              <button onClick={sendMessage} disabled={sending||!msgBody.trim()} className="flex items-center gap-2 px-6 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white disabled:opacity-40" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
                <LucideIcon name="send" size={12} color="white"/>{sending?'ENVIANDO…':'ENVIAR'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── REPORTES SECTION ─────────────────────────────────────────
function ReportesSection({data}: any) {
  const tasks: Task[] = data.tasks
  const projects: Project[] = data.projects
  const clients: Client[] = data.clients
  const inbox: any[] = data.inbox

  const totalTasks = tasks.length
  const doneTasks = tasks.filter(t=>t.done).length
  const pendingTasks = tasks.filter(t=>!t.done).length
  const urgentTasks = tasks.filter(t=>!t.done&&t.level==='urgent').length
  const completionRate = totalTasks > 0 ? Math.round((doneTasks/totalTasks)*100) : 0

  const projectsByStatus = [
    {label:'En progreso', count:projects.filter(p=>p.status==='activo').length, color:BLU},
    {label:'Urgente', count:projects.filter(p=>p.status==='urgente').length, color:RED},
    {label:'Revisión', count:projects.filter(p=>p.status==='revisión').length, color:'rgba(255,176,32,0.8)'},
    {label:'Planificación', count:projects.filter(p=>p.status==='plan.').length, color:'rgba(255,255,255,0.3)'},
  ]

  const tasksByMember = data.team.map((m: Profile) => ({
    name: m.name,
    initials: m.initials,
    color: m.avatar_color,
    pending: tasks.filter(t=>!t.done&&t.assignee?.name===m.name).length,
    done: tasks.filter(t=>t.done&&t.assignee?.name===m.name).length,
  }))

  const urgencyBreakdown = [
    {label:'Urgente', count:inbox.filter(m=>m.ai_urgency==='urgent').length, color:RED},
    {label:'Alta', count:inbox.filter(m=>m.ai_urgency==='high').length, color:'rgba(255,176,32,0.8)'},
    {label:'Normal', count:inbox.filter(m=>m.ai_urgency==='normal').length, color:BLU},
  ]

  const maxBar = Math.max(...tasksByMember.map((m: any)=>m.pending+m.done), 1)

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-figtree text-2xl font-black text-white" style={{letterSpacing:'-0.03em'}}>Reportes</h1>
        <button onClick={()=>{
          const printWin = window.open('','_blank','width=900,height=700')
          if(!printWin) return
          const now = new Date().toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'})
          const donePct = totalTasks>0?Math.round((doneTasks/totalTasks)*100):0
          const membersHtml = tasksByMember.map((m: any)=>`<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #eee"><div style="width:32px;height:32px;border-radius:50%;background:${m.color}22;color:${m.color};display:flex;align-items:center;justify-content:center;font-weight:900;font-size:11px;flex-shrink:0">${m.initials}</div><div style="flex:1"><strong>${m.name}</strong></div><div style="color:#666;font-size:13px">${m.pending} pendientes · ${m.done} completadas</div><div style="width:120px;height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden"><div style="width:${maxBar>0?((m.done/(m.done+m.pending||1))*100).toFixed(0):0}%;height:100%;background:${m.color}"></div></div></div>`).join('')
          const projHtml = projects.map((p: Project)=>`<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #eee"><div style="flex:1"><strong>${p.name}</strong> <span style="color:#999;font-size:12px">${p.client?.name||'—'}</span></div><span style="padding:2px 8px;background:#f5f5f5;border-radius:20px;font-size:11px;font-weight:700">${p.status}</span><div style="width:80px;height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden"><div style="width:${p.progress}%;height:100%;background:${p.color||'#1B5FFA'}"></div></div><span style="font-size:12px;color:#666;width:30px;text-align:right">${p.progress}%</span></div>`).join('')
          printWin.document.write(`<!DOCTYPE html><html><head><title>Reporte Brutal Studios — ${now}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;padding:40px;max-width:800px;margin:0 auto}.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #111;padding-bottom:20px;margin-bottom:30px}.logo-area h1{font-size:28px;font-weight:900;letter-spacing:-1px}.logo-area p{color:#666;font-size:13px;margin-top:4px}.date-area{text-align:right;color:#666;font-size:13px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:30px}.kpi{padding:16px;border:1px solid #e0e0e0;border-radius:8px;text-align:center}.kpi .num{font-size:36px;font-weight:900;color:#1B5FFA}.kpi .lbl{font-size:12px;color:#666;margin-top:4px}.section{margin-bottom:28px}.section h2{font-size:16px;font-weight:900;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;color:#333;padding-bottom:6px;border-bottom:1px solid #e0e0e0}.footer{margin-top:40px;padding-top:16px;border-top:1px solid #e0e0e0;color:#999;font-size:11px;display:flex;justify-content:space-between}@media print{body{padding:20px}}</style></head><body><div class="header"><div class="logo-area"><h1>Brutal Studios</h1><p>Informe de gestión</p></div><div class="date-area"><strong>${now}</strong><br>brutal.ia · sistema interno</div></div><div class="kpis"><div class="kpi"><div class="num">${donePct}%</div><div class="lbl">Tareas completadas</div></div><div class="kpi"><div class="num" style="color:${urgentTasks>0?'#E51D2A':'#1B5FFA'}">${urgentTasks}</div><div class="lbl">Urgentes pendientes</div></div><div class="kpi"><div class="num">${projects.length}</div><div class="lbl">Proyectos activos</div></div><div class="kpi"><div class="num">${clients.length}</div><div class="lbl">Clientes</div></div></div><div class="section"><h2>Carga de trabajo del equipo</h2>${membersHtml}</div><div class="section"><h2>Estado de proyectos</h2>${projHtml}</div><div class="footer"><span>Brutal Studios · brutal.ia</span><span>Generado: ${now}</span></div></body></html>`)
          printWin.document.close()
          setTimeout(()=>printWin.print(),500)
        }} className="flex items-center gap-2 px-4 py-2 rounded-xl font-syne text-[10px] font-black tracking-wide transition-colors" style={{background:'rgba(27,95,250,0.1)',color:BLU,border:'1px solid rgba(27,95,250,0.2)'}}>
          <LucideIcon name="download" size={13} color={BLU}/>EXPORTAR PDF
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          {v:`${completionRate}%`, l:'Tareas completadas', accent:completionRate>60?'#22c55e':BLU},
          {v:urgentTasks+'', l:'Urgentes pendientes', accent:urgentTasks>0?RED:BLU},
          {v:projects.length+'', l:'Proyectos totales', accent:null},
          {v:clients.length+'', l:'Clientes activos', accent:null},
        ].map((k,i)=>(
          <div key={i} className="rounded-xl p-4" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)',borderTop:`2px solid ${k.accent||'rgba(255,255,255,0.1)'}`}}>
            <div className="font-syne text-4xl font-black mb-1" style={{color:k.accent||'#F0F0F8'}}>{k.v}</div>
            <div className="text-xs text-white/35">{k.l}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_1fr] gap-4 mb-4">
        {/* Task completion bar */}
        <div className="rounded-xl p-5" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)'}}>
          <div className="font-syne text-[9px] font-bold tracking-widest text-white/25 uppercase mb-4">Estado de tareas</div>
          <div className="space-y-3">
            {[
              {l:'Completadas', v:doneTasks, total:totalTasks, color:'#22c55e'},
              {l:'Pendientes', v:pendingTasks, total:totalTasks, color:BLU},
              {l:'Urgentes', v:urgentTasks, total:totalTasks, color:RED},
            ].map((b,i)=>(
              <div key={i}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-white/50">{b.l}</span>
                  <span className="text-white/70 font-medium">{b.v} / {b.total}</span>
                </div>
                <div className="h-2 rounded-full" style={{background:'rgba(255,255,255,0.05)'}}>
                  <div className="h-full rounded-full transition-all" style={{width:`${b.total>0?(b.v/b.total)*100:0}%`,background:b.color}}/>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Projects by status */}
        <div className="rounded-xl p-5" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)'}}>
          <div className="font-syne text-[9px] font-bold tracking-widest text-white/25 uppercase mb-4">Proyectos por estado</div>
          <div className="space-y-3">
            {projectsByStatus.map((s,i)=>(
              <div key={i}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-white/50">{s.label}</span>
                  <span className="font-syne font-black" style={{color:s.color}}>{s.count}</span>
                </div>
                <div className="h-2 rounded-full" style={{background:'rgba(255,255,255,0.05)'}}>
                  <div className="h-full rounded-full" style={{width:`${projects.length>0?(s.count/projects.length)*100:0}%`,background:s.color}}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_320px] gap-4">
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
          <div className="space-y-3 mb-5">
            {urgencyBreakdown.map((u,i)=>(
              <div key={i}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-white/50">{u.label}</span>
                  <span className="font-syne font-black" style={{color:u.color}}>{u.count}</span>
                </div>
                <div className="h-2 rounded-full" style={{background:'rgba(255,255,255,0.05)'}}>
                  <div className="h-full rounded-full" style={{width:`${inbox.length>0?(u.count/inbox.length)*100:0}%`,background:u.color}}/>
                </div>
              </div>
            ))}
          </div>
          <div className="pt-4 border-t border-white/6">
            <div className="text-xs text-white/25 mb-2">Clientes con más proyectos</div>
            {clients.slice(0,3).map((c: Client,i: number)=>{
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
      </div>
    </div>
  )
}

function HoySection({profile,data,urgentCount,unreadCount,onOpenModal,showToast,isOwner}: any) {
  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 13 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches'
  const dateStr = now.toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long' })
  const myTasks = data.tasks.filter((t:Task) => !t.done && (t.assigned_to === profile.id || (!t.assigned_to && t.created_by === profile.id)))
  const otherTasks = isOwner ? data.tasks.filter((t:Task) => !t.done && t.assigned_to && t.assigned_to !== profile.id) : []
  const recentInbox = data.inbox.filter((m:any) => !m.is_read).slice(0, 4)
  const activeProjects = data.projects.filter((p:Project)=>p.status==='activo'||p.status==='urgente')

  return (
    <div className="p-8 max-w-[1240px] mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between mb-10">
        <div>
          <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-2" style={{color:'rgba(255,255,255,0.18)'}}>{dateStr.toUpperCase()}</div>
          <h1 className="font-figtree text-[32px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>{greeting}, <span style={{color:'rgba(240,240,248,0.55)'}}>{profile.name.split(' ')[0]}</span></h1>
        </div>
        <button onClick={()=>onOpenModal('tarea')} className="flex items-center gap-2 px-5 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white transition-all hover:opacity-90" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
          <LucideIcon name="plus" size={12} color="white"/> NUEVA TAREA
        </button>
      </div>

      {/* Stats row — inline, no cards */}
      <div className="grid grid-cols-4 gap-6 mb-10 pb-10" style={{borderBottom:`1px solid ${BORDER}`}}>
        {[
          { n: myTasks.length, label:'Mis tareas', color:'rgba(255,255,255,0.92)', sub:myTasks.filter((t:Task)=>t.level==='urgent').length > 0 ? `${myTasks.filter((t:Task)=>t.level==='urgent').length} urgentes` : 'Al día' },
          { n: urgentCount, label:'Urgentes', color:urgentCount>0?RED:'rgba(255,255,255,0.25)', sub: urgentCount>0?'Requieren atención':'Todo bajo control' },
          { n: unreadCount, label:'Sin leer', color:unreadCount>0?BLU:'rgba(255,255,255,0.25)', sub:'En inbox' },
          { n: activeProjects.length, label:'Proyectos activos', color:'rgba(255,255,255,0.92)', sub:`${data.projects.length} en total` },
        ].map((s,i)=>(
          <div key={i}>
            <div className="font-figtree font-black leading-none mb-2" style={{fontSize:'48px',color:s.color,letterSpacing:'-0.04em'}}>{s.n}</div>
            <div className="text-[14px] font-medium mb-0.5" style={{color:'rgba(255,255,255,0.5)'}}>{s.label}</div>
            <div className="font-syne text-[9px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.18)'}}>{s.sub.toUpperCase()}</div>
          </div>
        ))}
      </div>

      {/* Main grid */}
      <div className="grid gap-6" style={{gridTemplateColumns:'1fr 340px'}}>

        {/* Left — Focus */}
        <div className="space-y-5">
          {/* My tasks */}
          <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            <div className="flex items-center justify-between px-6 py-4" style={{borderBottom:`1px solid ${BORDER}`}}>
              <div>
                <div className="font-syne text-[8.5px] font-black tracking-widest mb-0.5" style={{color:'rgba(255,255,255,0.2)'}}>FOCUS</div>
                <span className="font-syne text-[15px] font-black text-white">Mis tareas</span>
              </div>
              <button onClick={()=>onOpenModal('tarea')} className="font-syne text-[10px] font-black tracking-wide px-3 py-1.5 rounded-xl transition-colors" style={{background:'rgba(27,95,250,0.1)',color:BLU}}>+ NUEVA</button>
            </div>
            {myTasks.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <div className="text-[13px] mb-3" style={{color:'rgba(255,255,255,0.18)'}}>Sin tareas asignadas</div>
                <button onClick={()=>onOpenModal('tarea')} className="font-syne text-[10px] font-black px-4 py-2 rounded-xl" style={{background:'rgba(27,95,250,0.08)',color:BLU}}>CREAR PRIMERA TAREA</button>
              </div>
            ) : myTasks.slice(0,7).map((t:Task)=>{
              const pc = t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.85)':BLU
              return (
              <div key={t.id} onClick={()=>data.toggleTask(t.id)} className="flex items-start gap-4 px-6 py-4 cursor-pointer transition-all group hover:bg-white/[0.015]" style={{borderBottom:`1px solid ${BORDER}`,borderLeft:`3px solid ${pc}`}}>
                <div className="w-4 h-4 rounded-full border-2 mt-1 flex-shrink-0 transition-all" style={{borderColor:pc+'70'}}/>
                <div className="flex-1 min-w-0">
                  <div className="font-figtree text-[14px] font-semibold leading-snug mb-1.5" style={{color:'rgba(255,255,255,0.88)'}}>{t.text}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {t.client && <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full" style={{background:(t.client as any).color+'18',color:(t.client as any).color+'cc'}}>{(t.client as any).name}</span>}
                    {t.due_date && <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.35)'}}>{new Date(t.due_date).toLocaleDateString('es-ES',{day:'numeric',month:'short'})}</span>}
                    {t.level==='urgent' && <span className="font-syne text-[8px] font-black" style={{color:RED}}>● URGENTE</span>}
                  </div>
                </div>
                {t.assignee && <div className="w-7 h-7 rounded-full flex items-center justify-center font-syne text-[9px] font-black flex-shrink-0 mt-0.5" style={{background:t.assignee.avatar_color+'20',border:`1.5px solid ${t.assignee.avatar_color}35`,color:t.assignee.avatar_color}}>{t.assignee.initials}</div>}
              </div>
            )})}

          </div>

          {/* Team tasks (owners) */}
          {isOwner && otherTasks.length > 0 && (
            <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
              <div className="flex items-center px-6 py-4" style={{borderBottom:`1px solid ${BORDER}`}}>
                <div className="font-syne text-[8.5px] font-black tracking-widest mr-3" style={{color:'rgba(255,255,255,0.2)'}}>EQUIPO</div>
                <span className="font-syne text-[15px] font-black text-white">Tareas del equipo</span>
              </div>
              {otherTasks.slice(0,4).map((t:Task)=>(
                <div key={t.id} onClick={()=>data.toggleTask(t.id)} className="flex items-center gap-4 px-6 py-4 cursor-pointer transition-all" style={{borderBottom:`1px solid ${BORDER}`}}>
                  {t.assignee && <div className="w-7 h-7 rounded-full flex items-center justify-center font-syne text-[9px] font-black flex-shrink-0" style={{background:t.assignee.avatar_color+'18',border:`1.5px solid ${t.assignee.avatar_color}30`,color:t.assignee.avatar_color}}>{t.assignee.initials}</div>}
                  <span className="flex-1 text-[13px]" style={{color:'rgba(240,240,248,0.65)'}}>{t.text}</span>
                  <span className="font-syne text-[8px] font-black px-2 py-1 rounded-lg flex-shrink-0" style={{background:t.level==='urgent'?'rgba(229,29,42,0.12)':SURF2,color:t.level==='urgent'?RED:'rgba(255,255,255,0.22)'}}>{t.level}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right — Signals */}
        <div className="space-y-5">
          {/* Inbox */}
          <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            <div className="flex items-center justify-between px-5 py-4" style={{borderBottom:`1px solid ${BORDER}`}}>
              <div>
                <div className="font-syne text-[8.5px] font-black tracking-widest mb-0.5" style={{color:'rgba(255,255,255,0.2)'}}>SEÑALES</div>
                <span className="font-syne text-[15px] font-black text-white">Inbox</span>
              </div>
              {unreadCount > 0 && <span className="font-syne text-[9px] font-black w-6 h-6 rounded-full flex items-center justify-center" style={{background:BLU,color:'white'}}>{unreadCount}</span>}
            </div>
            {recentInbox.length === 0 ? (
              <div className="px-5 py-8 text-center text-[12px]" style={{color:'rgba(255,255,255,0.2)'}}>Sin mensajes nuevos</div>
            ) : recentInbox.map((m:any)=>(
              <div key={m.id} className="px-5 py-4 transition-colors" style={{borderBottom:`1px solid ${BORDER}`}}>
                <div className="flex items-center gap-2.5 mb-1">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 font-syne text-[9px] font-black" style={{background:m.ai_urgency==='urgent'?'rgba(229,29,42,0.12)':'rgba(27,95,250,0.1)',color:m.ai_urgency==='urgent'?RED:BLU}}>{(m.from_name||'??').slice(0,2).toUpperCase()}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-semibold truncate" style={{color:'rgba(255,255,255,0.85)'}}>{m.from_name}</span>
                      {m.shared && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded flex-shrink-0" style={{background:'rgba(27,95,250,0.1)',color:'rgba(100,140,255,0.9)'}}>GENERAL</span>}
                      {m.ai_urgency==='urgent' && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded flex-shrink-0" style={{background:'rgba(229,29,42,0.1)',color:RED}}>URG</span>}
                    </div>
                    <div className="text-[11px] truncate mt-0.5" style={{color:'rgba(255,255,255,0.35)'}}>{m.subject||'Sin asunto'}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Quick actions */}
          <div className="rounded-2xl p-5" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            <div className="font-syne text-[8.5px] font-black tracking-widest mb-4" style={{color:'rgba(255,255,255,0.2)'}}>ACCIONES</div>
            {[
              {label:'Nueva tarea',icon:'check',act:()=>onOpenModal('tarea')},
              {label:'Nueva pieza',icon:'calendar',act:()=>onOpenModal('contenido')},
              ...(isOwner?[{label:'Nuevo cliente',icon:'users',act:()=>onOpenModal('cliente')},{label:'Nuevo proyecto',icon:'folder-open',act:()=>onOpenModal('proyecto')}]:[]),
            ].map(a=>(
              <button key={a.label} onClick={a.act} className="flex items-center gap-3 w-full px-3 py-3 rounded-xl text-left transition-all mb-1 hover:bg-white/3" style={{color:'rgba(240,240,248,0.55)'}}>
                <LucideIcon name={a.icon} size={14} color="rgba(27,95,250,0.5)"/><span className="text-[13px]">{a.label}</span>
              </button>
            ))}
          </div>

          {/* Projects */}
          {activeProjects.length > 0 && (
            <div className="rounded-2xl p-5" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
              <div className="font-syne text-[8.5px] font-black tracking-widest mb-4" style={{color:'rgba(255,255,255,0.2)'}}>PROYECTOS</div>
              {activeProjects.slice(0,3).map((p:Project)=>(
                <div key={p.id} className="flex items-center gap-3 mb-4">
                  <ProgressRing pct={p.progress} size={40} stroke={3} color={p.color||BLU}/>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate" style={{color:'rgba(240,240,248,0.8)'}}>{p.name}</div>
                    <div className="text-[10px] mt-0.5" style={{color:'rgba(255,255,255,0.25)'}}>{p.progress}% · {p.deadline}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── INBOX SECTION ────────────────────────────────────────────
function InboxSection({data,showToast,profile}: any) {
  const [filter, setFilter] = useState('Todos')
  const [selected, setSelected] = useState<any>(null)
  const [creatingTask, setCreatingTask] = useState(false)

  const allMsgs: any[] = data.inbox
  const unread = allMsgs.filter(m=>!m.is_read).length
  const urgent = allMsgs.filter(m=>m.ai_urgency==='urgent'&&!m.is_read).length
  const internal = allMsgs.filter(m=>m.source==='internal'&&!m.is_read).length
  const fromClients = allMsgs.filter(m=>m.ai_client&&m.ai_client!=='Desconocido'&&!m.is_read).length

  const filtered = allMsgs.filter((m: any) => {
    if (filter==='Todos') return true
    if (filter==='Sin leer') return !m.is_read
    if (filter==='Urgente') return m.ai_urgency==='urgent'
    if (filter==='Clientes') return m.ai_client&&m.ai_client!=='Desconocido'
    if (filter==='Interno') return m.source==='internal'
    if (filter==='Gmail') return m.source==='gmail'
    if (filter==='WhatsApp') return m.source==='whatsapp'
    return true
  })

  const handleSelect = (m: any) => {
    setSelected(m)
    if (!m.is_read) data.markRead(m.id)
  }

  const createTaskFromEmail = async (m: any, text?: string) => {
    const taskText = text || m.ai_action
    if (!taskText) return
    setCreatingTask(true)
    try {
      await data.createTask({ text: taskText, level: m.ai_urgency === 'urgent' ? 'urgent' : 'high', source: 'gmail' })
      showToast('Tarea creada')
    } catch { showToast('Error creando tarea') }
    finally { setCreatingTask(false) }
  }

  // Group by date label
  const getDateLabel = (dateStr: string) => {
    const d = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffDays === 0) return 'HOY'
    if (diffDays === 1) return 'AYER'
    if (diffDays < 7) return 'ESTA SEMANA'
    return 'ANTERIORES'
  }

  // Build grouped list
  const groups: {label:string; items:any[]}[] = []
  const labelOrder = ['HOY','AYER','ESTA SEMANA','ANTERIORES']
  const byLabel: Record<string,any[]> = {}
  filtered.forEach(m => {
    const l = getDateLabel(m.received_at)
    if (!byLabel[l]) byLabel[l] = []
    byLabel[l].push(m)
  })
  labelOrder.forEach(l => { if (byLabel[l]?.length) groups.push({label:l, items:byLabel[l]}) })

  // Find matching client in data for selected message
  const matchedClient = selected?.ai_client ? data.clients.find((c: any) => c.name.toLowerCase().includes(selected.ai_client.toLowerCase()) || selected.ai_client.toLowerCase().includes(c.name.toLowerCase().split(' ')[0])) : null
  const relatedTasks = matchedClient ? data.tasks.filter((t: any) => !t.done && t.client_id === matchedClient.id).slice(0, 4) : []

  const tabs = [
    {id:'Todos', n: allMsgs.length},
    {id:'Sin leer', n: unread, accent: BLU},
    {id:'Urgente', n: urgent, accent: RED},
    {id:'Clientes', n: fromClients, accent: GRN},
    {id:'Interno', n: internal, accent: 'rgba(255,176,32,0.8)'},
    {id:'Gmail', n: 0},
    {id:'WhatsApp', n: 0},
  ]

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── LIST COLUMN ── */}
      <div className="flex flex-col overflow-hidden flex-shrink-0" style={{width: selected?'380px':'100%', borderRight: selected?`1px solid ${BORDER}`:'none'}}>

        {/* Header with stats */}
        <div className="flex-shrink-0 px-6 py-5" style={{borderBottom:`1px solid ${BORDER}`}}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-1" style={{color:'rgba(255,255,255,0.18)'}}>SEÑALES</div>
              <h1 className="font-figtree text-[22px] font-black text-white" style={{letterSpacing:'-0.03em'}}>Inbox IA</h1>
            </div>
            <button onClick={()=>data.syncGmail()} disabled={data.syncing} className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne text-[9px] font-black disabled:opacity-40 transition-all" style={{background:SURF2,color:data.syncing?BLU:data.syncResult?.ok?GRN:'rgba(240,240,248,0.35)'}}>
              <LucideIcon name="refresh-cw" size={12} color={data.syncing?BLU:'rgba(255,255,255,0.3)'}/>{data.syncing?'Sincronizando…':'Sync Gmail'}
            </button>
          </div>
          {/* Intelligence stats strip */}
          <div className="grid grid-cols-4 gap-2">
            {[
              {n:unread, l:'Sin leer', c:BLU, act:()=>setFilter('Sin leer')},
              {n:urgent, l:'Urgentes', c:RED, act:()=>setFilter('Urgente')},
              {n:fromClients, l:'Clientes', c:GRN, act:()=>setFilter('Clientes')},
              {n:internal, l:'Mensajes', c:'rgba(255,176,32,0.8)', act:()=>setFilter('Interno')},
            ].map((s,i)=>(
              <button key={i} onClick={s.act} className="rounded-xl py-2.5 px-3 text-left transition-all hover:opacity-80" style={{background:SURF2,border:`1px solid ${BORDER}`}}>
                <div className="font-figtree text-[22px] font-black leading-none mb-0.5" style={{color:s.n>0?s.c:'rgba(255,255,255,0.2)'}}>{s.n}</div>
                <div className="font-syne text-[8px] font-black tracking-wide" style={{color:'rgba(255,255,255,0.3)'}}>{s.l.toUpperCase()}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 px-4 py-2.5 flex-shrink-0 overflow-x-auto" style={{borderBottom:`1px solid ${BORDER}`}}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setFilter(t.id)} className="px-3 py-1.5 rounded-xl font-syne text-[8.5px] font-black tracking-wide flex-shrink-0 transition-all" style={{background:filter===t.id?'rgba(27,95,250,0.12)':'transparent',color:filter===t.id?'#F0F0F8':'rgba(240,240,248,0.3)',border:filter===t.id?`1px solid rgba(27,95,250,0.2)`:'1px solid transparent'}}>
              {t.id}
            </button>
          ))}
        </div>

        {/* Message list with date groups */}
        <div className="flex-1 overflow-y-auto">
          {groups.length === 0 && (
            <div className="py-20 text-center">
              <div className="text-4xl mb-4">📭</div>
              <div className="font-syne text-[10px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.15)'}}>{allMsgs.length===0?'SIN CUENTA CONECTADA':'BANDEJA VACÍA'}</div>
              <div className="text-[12px]" style={{color:'rgba(255,255,255,0.2)'}}>{allMsgs.length===0?'Conecta Gmail en Ajustes para empezar':'No hay mensajes en este filtro'}</div>
            </div>
          )}
          {groups.map(group=>(
            <div key={group.label}>
              <div className="px-5 py-2 flex items-center gap-3 sticky top-0 z-10" style={{background:'rgba(5,5,16,0.92)',backdropFilter:'blur(8px)'}}>
                <span className="font-syne text-[8px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>{group.label}</span>
                <div className="flex-1 h-px" style={{background:BORDER}}/>
                <span className="font-syne text-[8px] font-black" style={{color:'rgba(255,255,255,0.15)'}}>{group.items.length}</span>
              </div>
              {group.items.map((m: any)=>{
                const urgColor = m.ai_urgency==='urgent'?RED:m.ai_urgency==='high'?'rgba(255,176,32,0.8)':BLU
                const isInternal = m.source==='internal'
                const isSelected = selected?.id===m.id
                const avatarColor = isInternal ? 'rgba(255,176,32,0.85)' : strColor(m.from_name||'?')
                const accentColor = !m.is_read ? (isInternal?'rgba(255,176,32,0.7)':urgColor) : 'transparent'
                return (
                  <div key={m.id} onClick={()=>handleSelect(m)} className="relative cursor-pointer group transition-all" style={{borderLeft:`3px solid ${accentColor}`,background:isSelected?'rgba(27,95,250,0.06)':'transparent'}}>
                    <div className="flex items-start gap-3 px-4 py-3.5" style={{borderBottom:`1px solid ${BORDER}`}}>
                      {/* Avatar */}
                      <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 font-syne text-[10px] font-black mt-0.5" style={{background:avatarColor+'22',border:`1.5px solid ${avatarColor}40`,color:avatarColor}}>
                        {isInternal ? '💬' : (m.from_name||'?').slice(0,2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        {/* Row 1: sender + time */}
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-syne text-[9px] font-black tracking-wide truncate flex-1" style={{color:m.is_read?'rgba(255,255,255,0.3)':avatarColor}}>{m.from_name}</span>
                          {isInternal && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:'rgba(255,176,32,0.1)',color:'rgba(255,176,32,0.7)'}}>DM</span>}
                          {m.ai_urgency==='urgent'&&!m.is_read && <span className="font-syne text-[7px] font-black flex-shrink-0" style={{color:RED}}>●</span>}
                          {!m.is_read && !isInternal && m.ai_urgency!=='urgent' && <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:urgColor}}/>}
                          <span className="font-syne text-[8px] flex-shrink-0" style={{color:'rgba(255,255,255,0.2)'}}>{relTime(m.received_at)}</span>
                        </div>
                        {/* Row 2: subject as hero */}
                        <div className="font-figtree text-[13px] font-semibold leading-snug mb-1.5 line-clamp-1" style={{color:m.is_read?'rgba(255,255,255,0.35)':'rgba(255,255,255,0.88)'}}>{m.subject||'Sin asunto'}</div>
                        {/* Row 3: AI insight */}
                        {m.ai_summary ? (
                          <div className="font-syne text-[9px] truncate" style={{color:'rgba(100,140,255,0.55)'}}>⚡ {m.ai_summary}</div>
                        ) : m.ai_client&&m.ai_client!=='Desconocido' ? (
                          <div className="font-syne text-[9px] truncate" style={{color:GRN+'99'}}>↗ {m.ai_client}</div>
                        ) : (
                          <div className="font-syne text-[9px] truncate" style={{color:'rgba(255,255,255,0.15)'}}>{m.body_preview?.slice(0,60)||'—'}</div>
                        )}
                      </div>
                      {/* Quick task button */}
                      {m.ai_action&&m.ai_action!=='Ninguna acción requerida' && (
                        <button onClick={e=>{e.stopPropagation();createTaskFromEmail(m)}} className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center mt-0.5 transition-all" style={{background:'rgba(27,95,250,0.12)',color:BLU}} title="Crear tarea IA">
                          <LucideIcon name="plus" size={12} color={BLU}/>
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ── DETAIL PANEL ── */}
      {selected && (
        <div className="flex-1 overflow-y-auto min-w-0" style={{background:'#050510'}}>
          {/* Sticky bar */}
          <div className="flex items-center justify-between px-6 py-4 sticky top-0 z-10" style={{background:'rgba(5,5,16,0.95)',backdropFilter:'blur(12px)',borderBottom:`1px solid ${BORDER}`}}>
            <button onClick={()=>setSelected(null)} className="flex items-center gap-2 text-[12px] transition-colors hover:text-white/70" style={{color:'rgba(255,255,255,0.35)'}}>
              <LucideIcon name="arrow-left" size={13}/> Bandeja
            </button>
            <div className="flex items-center gap-2">
              {selected.source==='internal' && (
                <span className="font-syne text-[8px] font-black px-3 py-1.5 rounded-xl" style={{background:'rgba(255,176,32,0.1)',color:'rgba(255,176,32,0.8)'}}>💬 MENSAJE INTERNO</span>
              )}
              {selected.ai_action&&selected.ai_action!=='Ninguna acción requerida' && (
                <button onClick={()=>createTaskFromEmail(selected)} disabled={creatingTask} className="flex items-center gap-2 px-4 py-2 rounded-xl font-syne text-[9px] font-black tracking-widest text-white disabled:opacity-40 transition-all" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
                  <LucideIcon name="plus" size={11} color="white"/>{creatingTask?'…':'CREAR TAREA'}
                </button>
              )}
            </div>
          </div>

          <div className="p-6 space-y-5">
            {/* Subject */}
            <div>
              <div className="flex items-start gap-3 mb-3">
                {selected.ai_urgency==='urgent' && <span className="font-syne text-[7px] font-black px-2.5 py-1 rounded-full flex-shrink-0 mt-1" style={{background:'rgba(229,29,42,0.12)',color:RED}}>🔴 URGENTE</span>}
                <h2 className="font-figtree text-[19px] font-black text-white leading-tight" style={{letterSpacing:'-0.025em'}}>{selected.subject||selected.from_phone||'Sin asunto'}</h2>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center font-syne text-[9px] font-black" style={{background:selected.source==='internal'?'rgba(255,176,32,0.1)':BLU+'15',color:selected.source==='internal'?'rgba(255,176,32,0.7)':BLU}}>{(selected.from_name||'??').slice(0,2).toUpperCase()}</div>
                  <span className="text-[13px] font-medium" style={{color:'rgba(255,255,255,0.7)'}}>{selected.from_name}</span>
                </div>
                {selected.from_email && <span className="text-[11px]" style={{color:'rgba(255,255,255,0.28)'}}>{selected.from_email}</span>}
                <span className="ml-auto text-[11px]" style={{color:'rgba(255,255,255,0.22)'}}>{new Date(selected.received_at).toLocaleDateString('es-ES',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
              </div>
            </div>

            {/* AI Analysis — PROMINENTE */}
            {(selected.ai_summary||selected.ai_action||selected.ai_urgency) && (
              <div className="rounded-2xl p-5" style={{background:'linear-gradient(135deg,rgba(27,95,250,0.09) 0%,rgba(20,64,204,0.04) 100%)',border:`1px solid rgba(27,95,250,0.2)`}}>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-5 h-5 rounded-lg flex items-center justify-center" style={{background:BLU+'20'}}><LucideIcon name="zap" size={11} color={BLU}/></div>
                  <span className="font-syne text-[8px] font-black tracking-widest" style={{color:'rgba(100,140,255,0.7)'}}>ANÁLISIS BRUTAL.IA</span>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="rounded-xl p-3.5" style={{background:'rgba(0,0,0,0.25)'}}>
                    <div className="font-syne text-[7px] font-black tracking-widest mb-1.5" style={{color:'rgba(255,255,255,0.2)'}}>URGENCIA</div>
                    <div className="font-syne text-[13px] font-black" style={{color:selected.ai_urgency==='urgent'?RED:selected.ai_urgency==='high'?'rgba(255,176,32,0.9)':BLU}}>{selected.ai_urgency==='urgent'?'🔴 Urgente':selected.ai_urgency==='high'?'🟡 Alta':'🔵 Normal'}</div>
                  </div>
                  <div className="rounded-xl p-3.5" style={{background:'rgba(0,0,0,0.25)'}}>
                    <div className="font-syne text-[7px] font-black tracking-widest mb-1.5" style={{color:'rgba(255,255,255,0.2)'}}>CLIENTE IA</div>
                    <div className="text-[13px] font-medium truncate" style={{color:matchedClient?matchedClient.color:'rgba(255,255,255,0.55)'}}>{selected.ai_client&&selected.ai_client!=='Desconocido'?selected.ai_client:'—'}</div>
                  </div>
                </div>
                {selected.ai_summary && (
                  <div className="mb-4">
                    <div className="font-syne text-[7px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.2)'}}>RESUMEN</div>
                    <p className="text-[13px] leading-relaxed" style={{color:'rgba(240,240,248,0.75)'}}>{selected.ai_summary}</p>
                  </div>
                )}
                {selected.ai_action&&selected.ai_action!=='Ninguna acción requerida' && (
                  <div className="rounded-xl p-4 cursor-pointer hover:opacity-80 transition-opacity" onClick={()=>createTaskFromEmail(selected)} style={{background:'rgba(27,95,250,0.1)',border:`1px solid rgba(27,95,250,0.18)`}}>
                    <div className="font-syne text-[7px] font-black tracking-widest mb-2" style={{color:'rgba(100,140,255,0.6)'}}>ACCIÓN SUGERIDA — CLICK PARA CREAR TAREA</div>
                    <div className="text-[13px]" style={{color:'rgba(240,240,248,0.7)'}}>{selected.ai_action}</div>
                  </div>
                )}
              </div>
            )}

            {/* Client context card */}
            {matchedClient && (
              <div className="rounded-2xl p-4" style={{background:SURFACE,border:`1px solid ${matchedClient.color}25`}}>
                <div className="font-syne text-[8px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.2)'}}>CLIENTE DETECTADO</div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center font-syne text-[11px] font-black flex-shrink-0" style={{background:matchedClient.color+'18',border:`1.5px solid ${matchedClient.color}30`,color:matchedClient.color}}>{matchedClient.initials}</div>
                  <div className="flex-1">
                    <div className="font-syne text-[14px] font-black text-white">{matchedClient.name}</div>
                    <div className="text-[11px] mt-0.5" style={{color:'rgba(255,255,255,0.3)'}}>{matchedClient.industry}</div>
                  </div>
                  <span className="font-syne text-[8px] font-black px-2 py-1 rounded-full" style={{background:matchedClient.status==='Activo'?'rgba(34,197,94,0.1)':'rgba(255,255,255,0.05)',color:matchedClient.status==='Activo'?GRN:'rgba(255,255,255,0.3)'}}>{matchedClient.status}</span>
                </div>
                <div className="flex gap-2 text-[10px]">
                  {[
                    {n:data.projects.filter((p: any)=>p.client_id===matchedClient.id).length, l:'proyectos'},
                    {n:data.tasks.filter((t: any)=>!t.done&&t.client_id===matchedClient.id).length, l:'tareas activas'},
                  ].map((s,i)=>(
                    <div key={i} className="flex-1 text-center rounded-lg py-2" style={{background:SURF2}}>
                      <div className="font-figtree text-[18px] font-black" style={{color:matchedClient.color}}>{s.n}</div>
                      <div style={{color:'rgba(255,255,255,0.3)'}}>{s.l}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Related tasks */}
            {relatedTasks.length > 0 && (
              <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
                <div className="px-5 py-3.5 font-syne text-[8px] font-black tracking-widest" style={{borderBottom:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.2)'}}>TAREAS RELACIONADAS · {matchedClient?.name}</div>
                {relatedTasks.map((t: any,i: number)=>(
                  <div key={t.id} className="flex items-center gap-3 px-5 py-3" style={{borderBottom:i<relatedTasks.length-1?`1px solid ${BORDER}`:'none'}}>
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.7)':BLU}}/>
                    <span className="text-[12px] flex-1 truncate" style={{color:'rgba(255,255,255,0.55)'}}>{t.text}</span>
                    {t.assignee && <div className="w-5 h-5 rounded-full flex items-center justify-center font-syne text-[7px] font-black flex-shrink-0" style={{background:t.assignee.avatar_color+'20',color:t.assignee.avatar_color}}>{t.assignee.initials}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* Email body */}
            {selected.body_preview && (
              <div className="rounded-2xl p-5" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
                <div className="font-syne text-[8px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.18)'}}>CONTENIDO</div>
                <p className="text-[12px] leading-relaxed whitespace-pre-wrap" style={{color:'rgba(255,255,255,0.4)'}}>{selected.body_preview}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── CLIENTES SECTION ─────────────────────────────────────────
function ClientesSection({data,selectedId,onSelect,onOpenModal,showToast,isOwner}: any) {
  const [aiAdvice, setAiAdvice] = useState<any[]|null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [expandedProject, setExpandedProject] = useState<string|null>(null)
  const [comments, setComments] = useState<any[]|null>(null)
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [postingComment, setPostingComment] = useState(false)

  const selected = selectedId ? data.clients.find((c: Client)=>c.id===selectedId) : null

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

  // Reset AI + comments when switching client
  const handleBack = () => { onSelect(null); setAiAdvice(null); setComments(null); setExpandedProject(null) }

  if (selected) {
    const clientProjects = data.projects.filter((p: Project)=>p.client_id===selected.id)
    const clientTasks = data.tasks.filter((t: Task)=>t.client_id===selected.id)
    const activeTasks = clientTasks.filter((t: Task)=>!t.done)
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

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center font-syne text-xl font-black flex-shrink-0" style={{background:selected.color+'18',border:`2px solid ${selected.color}35`,color:selected.color}}>{selected.initials}</div>
            <div>
              <div className="font-syne text-[9px] font-black tracking-widest mb-1" style={{color:'rgba(255,255,255,0.2)'}}>{selected.industry.toUpperCase()}</div>
              <h1 className="font-figtree text-[28px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>{selected.name}</h1>
              <span className="font-syne text-[8px] font-black px-3 py-1 rounded-full mt-2 inline-block" style={{background:selected.status==='Activo'?'rgba(34,197,94,0.1)':'rgba(255,255,255,0.05)',color:selected.status==='Activo'?GRN:'rgba(255,255,255,0.3)'}}>{selected.status.toUpperCase()}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={()=>{ if(!aiAdvice&&!aiLoading) loadAiAdvice(selected.id); setAiAdvice(null); loadAiAdvice(selected.id) }} disabled={aiLoading} className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest text-white disabled:opacity-50 transition-all" style={{background:`linear-gradient(135deg,rgba(139,92,246,0.3),rgba(27,95,250,0.2))`,border:`1px solid rgba(139,92,246,0.35)`}}>
              <LucideIcon name="zap" size={11} color="#A78BFA"/>{aiLoading?'Analizando…':'IA ESTRATÉGICA'}
            </button>
            {isOwner && (
              <button onClick={()=>data.deleteClient(selected.id).then(()=>{handleBack();showToast('Cliente eliminado')})} className="px-3 py-2 rounded-xl text-[11px] transition-colors" style={{color:'rgba(229,29,42,0.45)',border:'1px solid rgba(229,29,42,0.12)'}}>Eliminar</button>
            )}
          </div>
        </div>

        {/* AI Advice panel */}
        {aiAdvice && aiAdvice.length > 0 && (
          <div className="mb-8 rounded-2xl p-6" style={{background:'linear-gradient(135deg,rgba(139,92,246,0.08),rgba(27,95,250,0.04))',border:'1px solid rgba(139,92,246,0.2)'}}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-lg flex items-center justify-center" style={{background:'rgba(139,92,246,0.2)'}}><LucideIcon name="zap" size={11} color="#A78BFA"/></div>
                <span className="font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(167,139,250,0.8)'}}>BRUTAL.IA — PLAN ESTRATÉGICO 30 DÍAS</span>
              </div>
              <button onClick={()=>setAiAdvice(null)} className="text-[10px]" style={{color:'rgba(255,255,255,0.2)'}}>✕</button>
            </div>
            <div className="grid grid-cols-3 gap-4">
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

        {/* KPI grid */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            {v:selected.revenue||'—', l:'Facturación mensual', accent:selected.color, note:'Contrato activo'},
            {v:clientProjects.length, l:'Proyectos totales', accent:BLU, note:`${activeProjects.length} activos`},
            {v:activeTasks.length, l:'Tareas activas', accent:urgentTasks.length>0?RED:BLU, note:urgentTasks.length>0?`${urgentTasks.length} urgentes`:`${doneTasks.length} completadas`},
            {v:`${avgProgress}%`, l:'Progreso medio', accent:avgProgress>70?GRN:BLU, note:'De todos los proyectos'},
          ].map((k,i)=>(
            <div key={i} className="rounded-2xl p-5" style={{background:SURFACE,border:`1px solid ${BORDER}`,borderTop:`2px solid ${k.accent}40`}}>
              <div className="font-figtree text-[28px] font-black leading-none mb-1.5" style={{color:k.accent}}>{k.v}</div>
              <div className="text-[12px] font-medium mb-0.5" style={{color:'rgba(255,255,255,0.55)'}}>{k.l}</div>
              <div className="font-syne text-[8px] font-black tracking-wide" style={{color:'rgba(255,255,255,0.2)'}}>{k.note.toUpperCase()}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-5 mb-6" style={{gridTemplateColumns:'1fr 320px'}}>
          {/* Projects list — expandable */}
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
                      <div className="text-[10px] mt-0.5" style={{color:'rgba(255,255,255,0.25)'}}>{p.status} · hasta {p.deadline}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {projTasks.length > 0 && <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.3)'}}>{projTasks.length} tareas</span>}
                      <span className="font-syne text-[8px] font-black px-2.5 py-1 rounded-lg" style={{background:p.status==='urgente'?'rgba(229,29,42,0.1)':'rgba(27,95,250,0.07)',color:p.status==='urgente'?RED:BLU}}>{p.progress}%</span>
                      <LucideIcon name={isOpen?'chevron-up':'chevron-down'} size={13} color="rgba(255,255,255,0.25)"/>
                    </div>
                  </div>
                  {isOpen && projTasks.length > 0 && (
                    <div className="px-6 pb-3" style={{borderTop:`1px solid ${BORDER}`}}>
                      {projTasks.slice(0,6).map((t: Task,ti: number)=>(
                        <div key={t.id} className="flex items-center gap-3 py-2" style={{borderBottom:ti<Math.min(projTasks.length,6)-1?`1px solid rgba(255,255,255,0.03)`:'none'}}>
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.7)':BLU}}/>
                          <span className="text-[12px] flex-1 truncate" style={{color:'rgba(255,255,255,0.5)'}}>{t.text}</span>
                          <span className="font-syne text-[7px] font-black" style={{color:'rgba(255,255,255,0.2)'}}>{t.level}</span>
                        </div>
                      ))}
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

          {/* Right: tasks + content + notes */}
          <div className="space-y-4">
            <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
              <div className="px-5 py-4 font-syne text-[9px] font-black tracking-widest" style={{borderBottom:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.25)'}}>TAREAS ACTIVAS</div>
              {activeTasks.length===0 ? (
                <div className="px-5 py-6 text-center text-[12px]" style={{color:'rgba(255,255,255,0.2)'}}>Al día ✓</div>
              ) : activeTasks.slice(0,5).map((t: Task,i: number)=>(
                <div key={t.id} className="flex items-center gap-3 px-5 py-3" style={{borderBottom:i<Math.min(activeTasks.length,5)-1?`1px solid ${BORDER}`:'none',borderLeft:`2px solid ${t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.6)':BLU}40`}}>
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.7)':BLU}}/>
                  <span className="font-figtree text-[12px] font-medium flex-1 truncate" style={{color:'rgba(255,255,255,0.6)'}}>{t.text}</span>
                </div>
              ))}
              {activeTasks.length>5 && <div className="px-5 py-2 text-center text-[10px]" style={{color:'rgba(255,255,255,0.2)'}}>+{activeTasks.length-5} más</div>}
            </div>
            {clientContent.length>0 && (
              <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
                <div className="px-5 py-4 font-syne text-[9px] font-black tracking-widest" style={{borderBottom:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.25)'}}>CONTENIDO</div>
                {clientContent.slice(0,4).map((a: any,i: number)=>(
                  <div key={a.id} className="flex items-center gap-3 px-5 py-3" style={{borderBottom:i<Math.min(clientContent.length,4)-1?`1px solid ${BORDER}`:'none'}}>
                    <span className="text-[10px]" style={{color:'rgba(255,255,255,0.3)'}}>{a.platform}</span>
                    <span className="text-[12px] flex-1 truncate" style={{color:'rgba(255,255,255,0.55)'}}>{a.title}</span>
                    <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-lg" style={{background:a.status==='publicado'?'rgba(27,95,250,0.1)':a.status==='listo'?'rgba(34,197,94,0.1)':'rgba(255,255,255,0.04)',color:a.status==='publicado'?BLU:a.status==='listo'?GRN:'rgba(255,255,255,0.3)'}}>{a.status}</span>
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

        {/* Comment thread */}
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

  return (
    <div className="p-8 max-w-[1200px] mx-auto">
      <div className="flex items-end justify-between mb-10">
        <div>
          <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-2" style={{color:'rgba(255,255,255,0.18)'}}>GESTIÓN</div>
          <h1 className="font-figtree text-[28px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Clientes</h1>
        </div>
        {isOwner && <button onClick={()=>onOpenModal('cliente')} className="flex items-center gap-2 px-5 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>+ NUEVO CLIENTE</button>}
      </div>
      {data.clients.length === 0 ? (
        <div className="py-24 text-center">
          <div className="font-syne text-[11px] font-black tracking-widest mb-4" style={{color:'rgba(255,255,255,0.15)'}}>SIN CLIENTES</div>
          {isOwner && <button onClick={()=>onOpenModal('cliente')} className="font-syne text-[10px] font-black px-5 py-3 rounded-2xl" style={{background:'rgba(27,95,250,0.1)',color:BLU}}>CREAR PRIMER CLIENTE</button>}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-5">
          {data.clients.map((c: Client)=>{
            const nProj = data.projects.filter((p:Project)=>p.client_id===c.id).length
            const nTaskPending = data.tasks.filter((t:Task)=>t.client_id===c.id&&!t.done).length
            const nUrgent = data.tasks.filter((t:Task)=>t.client_id===c.id&&!t.done&&t.level==='urgent').length
            const activeProj = data.projects.filter((p:Project)=>p.client_id===c.id&&(p.status==='activo'||p.status==='urgente')).length
            return (
              <div key={c.id} onClick={()=>onSelect(c.id)} className="rounded-2xl overflow-hidden cursor-pointer transition-all group hover:border-white/10" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
                {/* Top accent bar */}
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

                  {/* Revenue big */}
                  {c.revenue && c.revenue !== '—' && (
                    <div className="mb-4 px-4 py-3 rounded-xl" style={{background:c.color+'08',border:`1px solid ${c.color}15`}}>
                      <div className="font-syne text-[8px] font-black tracking-widest mb-1" style={{color:'rgba(255,255,255,0.25)'}}>FACTURACIÓN MENSUAL</div>
                      <div className="font-figtree text-[22px] font-black leading-none" style={{color:c.color||'rgba(240,240,248,0.85)'}}>{c.revenue}</div>
                    </div>
                  )}

                  {/* Stats */}
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

                  {/* Urgent indicator */}
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

// ── PROYECTOS SECTION ────────────────────────────────────────
function ProyectosSection({data,filteredProjects,kanbanCols,projView,setProjView,projStatusFilter,setProjStatusFilter,dragRef,selectedId,onSelect,onOpenModal,showToast,isOwner}: any) {
  const statusTabs = ['Todos','plan.','activo','urgente','revisión']
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <h1 className="font-figtree text-2xl font-black text-white" style={{letterSpacing:'-0.03em'}}>Proyectos</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg overflow-hidden" style={{border:'1px solid rgba(255,255,255,0.08)'}}>
            {(['board','list'] as const).map(v=><button key={v} onClick={()=>setProjView(v)} className="px-3 py-1.5 text-xs transition-colors" style={{background:projView===v?'rgba(27,95,250,0.15)':'transparent',color:projView===v?'#F0F0F8':'rgba(240,240,248,0.4)'}}>{v==='board'?'Tablero':'Lista'}</button>)}
          </div>
          {isOwner && <button onClick={()=>onOpenModal('proyecto')} className="px-4 py-2 rounded-xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:BLU}}>+ PROYECTO</button>}
        </div>
      </div>
      <div className="flex gap-2 mb-5">
        {statusTabs.map(s=><button key={s} onClick={()=>setProjStatusFilter(s)} className="px-3 py-1.5 rounded-lg font-syne text-[9px] font-black tracking-wide capitalize transition-colors" style={{background:projStatusFilter===s?'rgba(27,95,250,0.12)':'transparent',color:projStatusFilter===s?'#F0F0F8':'rgba(240,240,248,0.35)'}}>{s}</button>)}
      </div>
      {projView === 'board' ? (
        <div className="grid grid-cols-4 gap-4">
          {kanbanCols.map((col: any)=>(
            <div key={col.status} className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}
              onDragOver={(e)=>e.preventDefault()}
              onDrop={()=>{ if(dragRef.current) { data.updateProject(dragRef.current,{status:col.status}).then(()=>showToast(`→ ${col.title}`)); dragRef.current=null }}}>
              <div className="flex items-center gap-2.5 px-5 py-4" style={{borderBottom:`1px solid ${BORDER}`}}>
                <div className="w-2 h-2 rounded-full" style={{background:col.color}}/>
                <span className="font-syne text-[9px] font-black tracking-widest uppercase flex-1" style={{color:'rgba(255,255,255,0.4)'}}>{col.title}</span>
                <span className="font-syne text-[13px] font-black" style={{color:'rgba(255,255,255,0.2)'}}>{col.items.length}</span>
              </div>
              <div className="p-3 space-y-2">
                {col.items.map((p: Project)=>(
                  <div key={p.id} draggable onDragStart={()=>dragRef.current=p.id} className="p-4 rounded-xl cursor-grab active:cursor-grabbing transition-all" style={{background:SURF2,border:`1px solid ${BORDER}`}}>
                    <div className="flex items-start gap-3 mb-3">
                      <div className="relative flex-shrink-0">
                        <ProgressRing pct={p.progress} size={38} stroke={2.5} color={p.color||BLU}/>
                        <div className="absolute inset-0 flex items-center justify-center font-syne text-[8px] font-black" style={{color:'rgba(255,255,255,0.5)'}}>{p.progress}</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold leading-snug mb-1" style={{color:'rgba(240,240,248,0.85)'}}>{p.name}</div>
                        <div className="text-[10px]" style={{color:'rgba(255,255,255,0.28)'}}>{p.client?.name||'—'}</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-syne text-[8px] font-black px-2 py-1 rounded-lg" style={{background:p.status==='urgente'?'rgba(229,29,42,0.1)':'rgba(27,95,250,0.07)',color:p.status==='urgente'?RED:'rgba(100,140,255,0.7)'}}>{p.status}</span>
                      <span className="text-[10px]" style={{color:p.deadline==='HOY'?RED:'rgba(255,255,255,0.22)'}}>{p.deadline}</span>
                    </div>
                  </div>
                ))}
                {col.items.length===0&&<div className="py-8 text-center text-[11px]" style={{color:'rgba(255,255,255,0.12)'}}>Arrastra aquí</div>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{border:'1px solid rgba(255,255,255,0.07)'}}>
          {filteredProjects.map((p: Project)=>(
            <div key={p.id} className="flex items-center gap-4 px-5 py-4 border-b border-white/4 hover:bg-white/2 transition-colors">
              <div className="flex-1"><div className="font-medium text-sm text-white/85">{p.name}</div><div className="text-xs text-white/30">{p.client?.name||'—'}</div></div>
              <span className="font-syne text-[9px] font-black px-2 py-1 rounded-full capitalize" style={{background:'rgba(27,95,250,0.08)',color:BLU}}>{p.status}</span>
              <div className="w-24 h-1 rounded-full bg-white/5"><div className="h-full rounded-full" style={{width:p.progress+'%',background:p.color||BLU}}/></div>
              <span className="text-xs text-white/30 w-8 text-right">{p.progress}%</span>
              <span className="text-xs text-white/30 w-12 text-right">{p.deadline}</span>
              {isOwner && <button onClick={()=>data.deleteProject(p.id).then(()=>showToast('Proyecto eliminado'))} className="opacity-20 hover:opacity-60 transition-opacity"><LucideIcon name="trash" size={13} color={RED}/></button>}
            </div>
          ))}
          {filteredProjects.length===0&&<div className="py-12 text-center text-white/20 text-sm">Sin proyectos</div>}
        </div>
      )}
    </div>
  )
}

// ── CONTENIDO SECTION ────────────────────────────────────────
function ContenidoSection({data,onOpenModal,showToast}: any) {
  const [activeItem, setActiveItem] = useState<any>(null)
  const [editNotes, setEditNotes] = useState('')
  const [editVideoUrl, setEditVideoUrl] = useState('')
  const [editFeedback, setEditFeedback] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  const platColor: Record<string,string> = {TikTok:'#ff0050',Instagram:'#C13584',LinkedIn:'#0A66C2',YouTube:'#FF0000',Twitter:'#1DA1F2',Pinterest:'#E60023'}
  const platIcon: Record<string,string> = {TikTok:'▶',Instagram:'◆',LinkedIn:'in',YouTube:'▶',Twitter:'✕',Pinterest:'P'}

  const cols = [
    { key:'borrador', label:'En bruto', emoji:'🎬', color:'rgba(255,255,255,0.3)', desc:'Material sin procesar' },
    { key:'pendiente', label:'En producción', emoji:'⚡', color:'rgba(255,176,32,0.8)', desc:'En edición activa' },
    { key:'listo', label:'Listo para publicar', emoji:'✅', color:GRN, desc:'Aprobado y preparado' },
    { key:'publicado', label:'Publicado', emoji:'🚀', color:BLU, desc:'Ya en plataformas' },
  ]

  const openItem = (item: any) => {
    setActiveItem(item)
    setEditNotes(item.notes||'')
    setEditVideoUrl(item.video_url||'')
    setEditFeedback(item.feedback||'')
  }

  const saveNotes = async () => {
    if (!activeItem) return
    setSavingNotes(true)
    try {
      const updates: any = { notes: editNotes, video_url: editVideoUrl, feedback: editFeedback }
      await data.updateAgenda(activeItem.id, updates)
      showToast('Guardado')
      setActiveItem((prev: any) => ({...prev, ...updates}))
    } catch { showToast('Error guardando') }
    finally { setSavingNotes(false) }
  }

  const changeStatus = async (item: any, newStatus: string) => {
    try {
      await data.updateAgenda(item.id, { status: newStatus })
      if (activeItem?.id === item.id) setActiveItem((prev: any)=>({...prev, status: newStatus}))
      showToast('Estado actualizado')
    } catch { showToast('Error') }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Kanban */}
      <div className="flex-1 overflow-hidden flex flex-col min-w-0">
        <div className="flex items-center justify-between px-8 py-6 flex-shrink-0" style={{borderBottom:`1px solid ${BORDER}`}}>
          <div>
            <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-1.5" style={{color:'rgba(255,255,255,0.18)'}}>PRODUCCIÓN</div>
            <h1 className="font-figtree text-[24px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Pipeline de Contenido</h1>
          </div>
          <button onClick={()=>onOpenModal('contenido')} className="px-5 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>+ NUEVA PIEZA</button>
        </div>

        {data.agenda.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-5xl mb-4">🎬</div>
              <div className="font-syne text-[11px] font-black tracking-widest mb-4" style={{color:'rgba(255,255,255,0.15)'}}>SIN CONTENIDO</div>
              <button onClick={()=>onOpenModal('contenido')} className="font-syne text-[10px] font-black px-5 py-3 rounded-2xl" style={{background:'rgba(27,95,250,0.1)',color:BLU}}>AÑADIR PRIMERA PIEZA</button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-x-auto overflow-y-hidden">
            <div className="flex h-full gap-4 p-6" style={{minWidth:'900px'}}>
              {cols.map(col=>{
                const items = data.agenda.filter((a: any)=>a.status===col.key)
                return (
                  <div key={col.key} className="flex flex-col rounded-2xl overflow-hidden flex-1 min-w-[220px]" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
                    {/* Column header */}
                    <div className="flex items-center gap-2.5 px-5 py-4 flex-shrink-0" style={{borderBottom:`1px solid ${BORDER}`}}>
                      <span>{col.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-syne text-[10px] font-black" style={{color:col.color}}>{col.label.toUpperCase()}</div>
                        <div className="text-[9px] mt-0.5" style={{color:'rgba(255,255,255,0.2)'}}>{col.desc}</div>
                      </div>
                      <span className="font-figtree text-[18px] font-black" style={{color:'rgba(255,255,255,0.2)'}}>{items.length}</span>
                    </div>
                    {/* Cards */}
                    <div className="flex-1 overflow-y-auto p-3 space-y-3"
                      onDragOver={e=>e.preventDefault()}
                      onDrop={(e)=>{
                        const id = e.dataTransfer.getData('text/plain')
                        const item = data.agenda.find((a: any)=>a.id===id)
                        if (item && item.status!==col.key) changeStatus(item, col.key)
                      }}>
                      {items.map((item: any)=>{
                        const pc = platColor[item.platform]||BLU
                        return (
                          <div key={item.id}
                            draggable
                            onDragStart={e=>e.dataTransfer.setData('text/plain',item.id)}
                            onClick={()=>openItem(item)}
                            className="rounded-xl p-4 cursor-pointer transition-all hover:scale-[1.01]"
                            style={{background:activeItem?.id===item.id?'rgba(27,95,250,0.1)':SURF2,border:`1px solid ${activeItem?.id===item.id?'rgba(27,95,250,0.3)':BORDER}`}}>
                            {/* Platform badge */}
                            <div className="flex items-center gap-2 mb-3">
                              <div className="w-6 h-6 rounded-lg flex items-center justify-center font-bold text-[10px] flex-shrink-0" style={{background:pc+'20',color:pc}}>{platIcon[item.platform]||'●'}</div>
                              <span className="font-syne text-[9px] font-black" style={{color:pc}}>{item.platform}</span>
                              <div className="ml-auto flex items-center gap-1">
                                {item.video_url && <div className="w-4 h-4 rounded-full flex items-center justify-center" style={{background:'rgba(255,0,0,0.12)'}} title="Tiene vídeo"><span style={{fontSize:'8px'}}>▶</span></div>}
                                {item.feedback && <div className="w-4 h-4 rounded-full flex items-center justify-center" style={{background:'rgba(255,176,32,0.12)'}} title="Tiene feedback"><span style={{fontSize:'8px'}}>💬</span></div>}
                                {item.notes && <div className="w-4 h-4 rounded-full flex items-center justify-center" style={{background:'rgba(255,255,255,0.08)'}} title="Tiene notas"><span style={{fontSize:'8px'}}>📝</span></div>}
                              </div>
                            </div>
                            {/* Title */}
                            <div className="font-syne text-[13px] font-black text-white mb-1.5 leading-snug line-clamp-2">{item.title}</div>
                            {/* Client + date */}
                            <div className="flex items-center justify-between">
                              <span className="text-[10px]" style={{color:'rgba(255,255,255,0.3)'}}>{item.client?.name||'—'}</span>
                              {item.publish_date && <span className="font-syne text-[9px] font-black px-2 py-0.5 rounded-lg" style={{background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.3)'}}>{item.publish_date}</span>}
                            </div>
                          </div>
                        )
                      })}
                      {items.length===0 && (
                        <div className="flex flex-col items-center py-8 text-center">
                          <div className="text-2xl mb-2 opacity-30">{col.emoji}</div>
                          <div className="text-[10px]" style={{color:'rgba(255,255,255,0.12)'}}>Arrastra aquí</div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Right: Detail panel */}
      {activeItem && (
        <div className="w-[360px] flex-shrink-0 flex flex-col overflow-hidden" style={{borderLeft:`1px solid ${BORDER}`,background:'#050510'}}>
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 flex-shrink-0" style={{borderBottom:`1px solid ${BORDER}`}}>
            <div className="font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(100,140,255,0.6)'}}>DETALLE</div>
            <button onClick={()=>setActiveItem(null)} className="w-8 h-8 rounded-xl flex items-center justify-center" style={{background:SURF2}}><LucideIcon name="x" size={14} color="rgba(240,240,248,0.45)"/></button>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Platform */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-[13px]" style={{background:(platColor[activeItem.platform]||BLU)+'20',color:platColor[activeItem.platform]||BLU}}>{platIcon[activeItem.platform]||'●'}</div>
              <div>
                <div className="font-syne text-[10px] font-black" style={{color:platColor[activeItem.platform]||BLU}}>{activeItem.platform}</div>
                <div className="text-[11px]" style={{color:'rgba(255,255,255,0.3)'}}>{activeItem.content_type||'Post'}</div>
              </div>
            </div>
            {/* Title */}
            <div>
              <div className="font-syne text-[18px] font-black text-white leading-snug">{activeItem.title}</div>
              {activeItem.client && <div className="text-[12px] mt-1" style={{color:'rgba(255,255,255,0.3)'}}>{activeItem.client.name}</div>}
              {activeItem.publish_date && <div className="text-[11px] mt-0.5" style={{color:'rgba(255,255,255,0.25)'}}>Publicación: {activeItem.publish_date}</div>}
            </div>
            {/* Status change */}
            <div>
              <div className="font-syne text-[9px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.25)'}}>MOVER A</div>
              <div className="space-y-2">
                {cols.map(col=>(
                  <button key={col.key} onClick={()=>changeStatus(activeItem, col.key)} className="flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-left transition-all" style={{background:activeItem.status===col.key?col.color+'15':SURF2,border:`1px solid ${activeItem.status===col.key?col.color+'40':BORDER}`,opacity:activeItem.status===col.key?1:0.6}}>
                    <span>{col.emoji}</span>
                    <span className="font-syne text-[10px] font-black flex-1" style={{color:activeItem.status===col.key?col.color:'rgba(255,255,255,0.5)'}}>{col.label}</span>
                    {activeItem.status===col.key && <LucideIcon name="check" size={12} color={col.color}/>}
                  </button>
                ))}
              </div>
            </div>
            {/* Video URL + embed */}
            <div>
              <div className="font-syne text-[9px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>LINK DE VÍDEO</div>
              <input value={editVideoUrl} onChange={e=>setEditVideoUrl(e.target.value)} placeholder="YouTube / Vimeo URL…" className="w-full px-4 py-2.5 rounded-xl text-[12px] text-white placeholder-white/20 outline-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.4)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
              {videoEmbed(editVideoUrl) && (
                <div className="mt-3 rounded-xl overflow-hidden" style={{aspectRatio:'16/9'}}>
                  <iframe src={videoEmbed(editVideoUrl)!} className="w-full h-full" allow="accelerometer;autoplay;encrypted-media;gyroscope;picture-in-picture" allowFullScreen/>
                </div>
              )}
              {activeItem.video_url && !videoEmbed(editVideoUrl) && videoEmbed(activeItem.video_url) && (
                <div className="mt-3 rounded-xl overflow-hidden" style={{aspectRatio:'16/9'}}>
                  <iframe src={videoEmbed(activeItem.video_url)!} className="w-full h-full" allow="accelerometer;autoplay;encrypted-media;gyroscope;picture-in-picture" allowFullScreen/>
                </div>
              )}
            </div>
            {/* Feedback */}
            <div>
              <div className="font-syne text-[9px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>FEEDBACK / REVISIONES</div>
              <textarea value={editFeedback} onChange={e=>setEditFeedback(e.target.value)} placeholder="Escribe aquí el feedback del cliente o del equipo…" rows={3} className="w-full px-4 py-3 rounded-xl text-[13px] text-white placeholder-white/20 outline-none resize-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU,lineHeight:'1.6'}} onFocus={e=>(e.target.style.borderColor='rgba(255,176,32,0.4)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
            </div>
            {/* Notes */}
            <div>
              <div className="font-syne text-[9px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>NOTAS DEL EQUIPO</div>
              <textarea value={editNotes} onChange={e=>setEditNotes(e.target.value)} placeholder="Añade notas de producción…" rows={4} className="w-full px-4 py-3.5 rounded-xl text-[13px] text-white placeholder-white/20 outline-none resize-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU,lineHeight:'1.6'}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.4)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
            </div>
            {/* Save + delete */}
            <div className="flex gap-2">
              <button onClick={saveNotes} disabled={savingNotes} className="flex-1 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-wide text-white disabled:opacity-40" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>{savingNotes?'GUARDANDO…':'GUARDAR CAMBIOS'}</button>
              <button onClick={async()=>{await data.deleteAgenda(activeItem.id);setActiveItem(null);showToast('Pieza eliminada')}} className="px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-wide transition-colors" style={{color:'rgba(229,29,42,0.4)',border:`1px solid rgba(229,29,42,0.1)`}}>✕</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── CALENDARIO SECTION ───────────────────────────────────────
function CalendarioSection({data, profile, showToast, onOpenModal}: any) {
  const today = new Date()
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [selectedDay, setSelectedDay] = useState<Date|null>(today)
  const [calView, setCalView] = useState<'mes'|'semana'>('mes')
  const [syncingCal, setSyncingCal] = useState(false)
  const [calEvents, setCalEvents] = useState<any[]>(data.calendarEvents || [])

  const syncCalendar = async () => {
    setSyncingCal(true)
    try {
      const events = await fetch('/api/calendar/events').then(r=>r.json())
      setCalEvents(events)
      showToast(`✓ ${events.length} eventos de Google Calendar`)
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
      const platColors: Record<string,string> = {TikTok:'#ff0050',Instagram:'#C13584',LinkedIn:'#0A66C2',YouTube:'#FF0000',Twitter:'#1DA1F2'}
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
    <div className="flex h-full overflow-hidden">
      {/* Left: Calendar */}
      <div className="flex flex-col overflow-hidden flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 flex-shrink-0" style={{borderBottom:`1px solid ${BORDER}`}}>
          <div>
            <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-1.5" style={{color:'rgba(255,255,255,0.18)'}}>AGENDA</div>
            <h1 className="font-figtree text-[24px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Calendario</h1>
          </div>
          <div className="flex items-center gap-3">
            {/* Calendar sync */}
            {profile?.gmail_connected ? (
              <button onClick={syncCalendar} disabled={syncingCal} className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-wide disabled:opacity-40 transition-all" style={{background:'rgba(167,139,250,0.1)',color:'#a78bfa',border:'1px solid rgba(167,139,250,0.2)'}}>
                <LucideIcon name="refresh-cw" size={12} color="#a78bfa"/>{syncingCal?'Sync…':'Sync Google Cal'}
              </button>
            ) : (
              <a href="/api/gmail/connect" className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-wide" style={{background:'rgba(167,139,250,0.1)',color:'#a78bfa',border:'1px solid rgba(167,139,250,0.2)'}}>
                <LucideIcon name="bell" size={12} color="#a78bfa"/>Conectar Google Cal
              </a>
            )}
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
          {/* Legend */}
          <div className="ml-auto flex items-center gap-4 text-[10px]" style={{color:'rgba(255,255,255,0.3)'}}>
            {[{c:'#a78bfa',l:'Google Cal'},{c:BLU,l:'Contenido'},{c:'rgba(255,176,32,0.8)',l:'Tarea'}].map(x=>(
              <div key={x.l} className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{background:x.c}}/>{x.l}</div>
            ))}
          </div>
        </div>

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
                    <div key={i} onClick={()=>setSelectedDay(d)} className="rounded-xl p-2 cursor-pointer transition-all hover:bg-white/3 min-h-[90px] flex flex-col" style={{background:isSel?'rgba(27,95,250,0.1)':isToday?'rgba(27,95,250,0.05)':'transparent',border:`1px solid ${isSel?'rgba(27,95,250,0.3)':isToday?'rgba(27,95,250,0.15)':BORDER}`}}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-figtree text-[14px] font-black leading-none" style={{color:isToday?BLU:isWeekend?'rgba(255,255,255,0.35)':'rgba(255,255,255,0.7)'}}>{dayN}</span>
                        {isToday && <div className="w-1.5 h-1.5 rounded-full" style={{background:BLU}}/>}
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
                        <div className="font-syne text-[8px] font-black tracking-widest mb-0.5" style={{color:'rgba(255,255,255,0.3)'}}>{DAYS_ES[i]}</div>
                        <div className="font-figtree text-[22px] font-black" style={{color:isToday?BLU:'rgba(255,255,255,0.7)',letterSpacing:'-0.02em'}}>{d.getDate()}</div>
                      </div>
                      <div className="p-2 min-h-[160px] space-y-1">
                        {evs.map((e,ei)=>(
                          <div key={ei} className="px-2 py-1.5 rounded-lg" style={{background:e.color+'15',border:`1px solid ${e.color}25`}}>
                            <div className="font-syne text-[7px] font-black tracking-wide mb-0.5" style={{color:e.color+'cc'}}>{e.type==='gcal'?'GCAL':e.type==='content'?'CONTENIDO':'TAREA'}</div>
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
      <div className="w-[320px] flex-shrink-0 flex flex-col overflow-hidden" style={{borderLeft:`1px solid ${BORDER}`,background:'#050510'}}>
        {selectedDay ? (
          <>
            <div className="px-6 py-5 flex-shrink-0" style={{borderBottom:`1px solid ${BORDER}`}}>
              <div className="font-syne text-[8px] font-black tracking-widest mb-1" style={{color:'rgba(255,255,255,0.2)'}}>DÍA SELECCIONADO</div>
              <div className="font-figtree text-[20px] font-black text-white" style={{letterSpacing:'-0.025em'}}>
                {selectedDay.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'}).replace(/^\w/,c=>c.toUpperCase())}
              </div>
              {selKey === todayKey && <div className="font-syne text-[8px] font-black mt-1" style={{color:BLU}}>● HOY</div>}
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {selEvents.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-3xl mb-3">📅</div>
                  <div className="text-[12px]" style={{color:'rgba(255,255,255,0.2)'}}>Día libre</div>
                  <button onClick={()=>onOpenModal('contenido')} className="mt-4 font-syne text-[8px] font-black px-3 py-2 rounded-lg" style={{background:'rgba(27,95,250,0.1)',color:BLU}}>+ AÑADIR PIEZA</button>
                </div>
              ) : (
                <>
                  {/* Group by type */}
                  {(['gcal','content','task'] as const).map(type=>{
                    const evs = selEvents.filter(e=>e.type===type)
                    if (!evs.length) return null
                    const typeLabel = type==='gcal'?'GOOGLE CALENDAR':type==='content'?'CONTENIDO A PUBLICAR':'TAREAS CON DEADLINE'
                    const typeColor = type==='gcal'?'#a78bfa':type==='content'?BLU:'rgba(255,176,32,0.8)'
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
                                    <a href={e.raw.htmlLink} target="_blank" rel="noopener noreferrer" className="font-syne text-[8px] font-black" style={{color:'#a78bfa'}}>VER →</a>
                                  )}
                                </div>
                              )}
                              {type==='content' && (
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full" style={{background:e.color+'20',color:e.color+'cc'}}>{e.raw?.platform}</span>
                                  {e.raw?.client?.name && <span className="text-[10px]" style={{color:'rgba(255,255,255,0.3)'}}>{e.raw.client.name}</span>}
                                </div>
                              )}
                              {type==='task' && e.raw?.assignee && (
                                <div className="flex items-center gap-2 mt-1">
                                  <div className="w-5 h-5 rounded-full flex items-center justify-center font-syne text-[7px] font-black" style={{background:e.raw.assignee.avatar_color+'25',color:e.raw.assignee.avatar_color}}>{e.raw.assignee.initials}</div>
                                  <span className="text-[10px]" style={{color:'rgba(255,255,255,0.35)'}}>{e.raw.assignee.name}</span>
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
                      <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded" style={{background:e.color+'15',color:e.color+'cc'}}>{e.type==='gcal'?'CAL':e.type==='content'?'CTN':'TSK'}</span>
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

// ── MEMORIA SECTION ──────────────────────────────────────────
function MemoriaSection({data,memFilter,setMemFilter,onOpenModal,showToast}: any) {
  const cats = ['Todos','Clientes','Procesos','Decisiones','Aprendizajes']
  const filtered = memFilter==='Todos' ? data.memoria : data.memoria.filter((m: any)=>m.category===memFilter)
  return (
    <div className="p-8 max-w-[900px] mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-2" style={{color:'rgba(255,255,255,0.18)'}}>CEREBRO</div>
          <h1 className="font-figtree text-[28px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Memoria</h1>
        </div>
        <button onClick={()=>onOpenModal('memoria')} className="px-5 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>+ ENTRADA</button>
      </div>
      <div className="flex gap-1 mb-6 p-1 rounded-2xl w-fit" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
        {cats.map(c=><button key={c} onClick={()=>setMemFilter(c)} className="px-4 py-2 rounded-xl font-syne text-[9px] font-black tracking-wide transition-all" style={{background:memFilter===c?SURF2:'transparent',color:memFilter===c?'#F0F0F8':'rgba(240,240,248,0.3)'}}>{c}</button>)}
      </div>
      <div className="space-y-2">
        {filtered.map((m: any)=>(
          <div key={m.id} className="flex items-start gap-4 p-5 rounded-2xl transition-all group" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:'rgba(27,95,250,0.08)',border:`1px solid rgba(27,95,250,0.12)`}}>
              <LucideIcon name="database" size={15} color="rgba(27,95,250,0.55)"/>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-syne text-[14px] font-black text-white">{m.title}</span>
                <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-lg" style={{background:SURF2,color:'rgba(255,255,255,0.25)'}}>{m.category}</span>
              </div>
              <div className="text-[12px] line-clamp-2" style={{color:'rgba(255,255,255,0.4)'}}>{m.content}</div>
            </div>
            <button onClick={()=>data.deleteMemoria(m.id).then(()=>showToast('Eliminado'))} className="opacity-0 group-hover:opacity-30 hover:!opacity-60 transition-opacity flex-shrink-0"><LucideIcon name="trash" size={14} color={RED}/></button>
          </div>
        ))}
        {filtered.length===0&&<div className="py-20 text-center text-[13px]" style={{color:'rgba(255,255,255,0.18)'}}>Sin entradas en esta categoría</div>}
      </div>
    </div>
  )
}

// ── AUTOMATIZACIONES SECTION ─────────────────────────────────
function AutomatizacionesSection({data,onOpenModal,showToast,isOwner}: any) {
  return (
    <div className="p-6 max-w-[900px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-figtree text-2xl font-black text-white" style={{letterSpacing:'-0.03em'}}>Automatizaciones</h1>
          <p className="text-sm text-white/30 mt-1">{data.reglas.filter((r: Regla)=>r.active).length} de {data.reglas.length} activas</p>
        </div>
        {isOwner && <button onClick={()=>onOpenModal('regla')} className="px-4 py-2 rounded-xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:BLU}}>+ REGLA</button>}
      </div>
      <div className="space-y-2">
        {data.reglas.map((r: Regla)=>(
          <div key={r.id} className="flex items-center gap-4 p-4 rounded-xl" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)',opacity:r.active?1:0.5}}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{background:'rgba(27,95,250,0.08)'}}><LucideIcon name="zap" size={14} color={BLU}/></div>
            <div className="flex-1">
              <div className="font-semibold text-sm text-white/85">{r.name}</div>
              {(r.condition_text||r.action_text) && <div className="text-xs text-white/35 mt-0.5">{r.condition_text} → {r.action_text}</div>}
            </div>
            <span className="font-syne text-[8px] font-black px-2 py-1 rounded-full" style={{background:r.active?'rgba(27,95,250,0.1)':'rgba(255,255,255,0.04)',color:r.active?BLU:'rgba(240,240,248,0.2)'}}>{r.active?'ACTIVO':'PAUSADO'}</span>
            {isOwner && <button onClick={()=>data.deleteRegla(r.id).then(()=>showToast('Regla eliminada'))} className="opacity-20 hover:opacity-60 transition-opacity"><LucideIcon name="trash" size={13} color={RED}/></button>}
          </div>
        ))}
        {data.reglas.length===0&&<div className="py-12 text-center text-white/20 text-sm">Sin reglas</div>}
      </div>
    </div>
  )
}

// ── CHAT SECTION ─────────────────────────────────────────────
function ChatSection({profile,data,chatInput,setChatInput,chatLoading,setChatLoading,showToast}: any) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:'smooth'}) },[data.chatMessages])

  const send = async () => {
    const txt = chatInput.trim()
    if (!txt || chatLoading) return
    setChatInput('')
    setChatLoading(true)
    try { await data.sendChatMessage(txt) }
    catch { showToast('Error enviando mensaje') }
    finally { setChatLoading(false) }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-white/5 flex-shrink-0">
        <h1 className="font-figtree text-xl font-black text-white" style={{letterSpacing:'-0.025em'}}>BRUTAL<span style={{color:'#1B5FFA'}}>.IA</span></h1>
        <p className="text-xs text-white/30 mt-0.5">IA con contexto de clientes, proyectos y tareas</p>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {data.chatMessages.length===0&&(
          <div className="py-12 text-center">
            <div className="font-syne text-sm text-white/25 mb-4">Buenos días. ¿En qué puedo ayudarte?</div>
            {['¿Qué proyectos tengo urgentes?','¿Cuántas tareas pendientes hay?','Resume el estado del equipo'].map(s=>(
              <button key={s} onClick={()=>{ setChatInput(s); }} className="block mx-auto mb-2 px-4 py-2 rounded-xl text-xs text-white/40 hover:text-white/60 transition-colors" style={{border:'1px solid rgba(255,255,255,0.07)'}}>{s}</button>
            ))}
          </div>
        )}
        {data.chatMessages.map((m: any)=>(
          <div key={m.id} className={`flex ${m.role==='user'?'justify-end':''}`}>
            {m.role==='ai'&&<div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mr-2 mt-1 overflow-hidden p-1" style={{background:'rgba(27,95,250,0.12)',border:'1px solid rgba(27,95,250,0.2)'}}><img src="https://brutal.thehook-produccion.es/wp-content/themes/brutal-studios/assets/img/brutal-logo-white.svg" className="w-full opacity-80" alt="Brutal.IA"/></div>}
            <div className="max-w-[75%] px-4 py-3 rounded-2xl text-sm leading-relaxed" style={{background:m.role==='user'?BLU:'#0C0C15',color:m.role==='user'?'white':'rgba(240,240,248,0.8)',border:m.role==='ai'?'1px solid rgba(255,255,255,0.07)':'none'}}>
              {m.content}
            </div>
          </div>
        ))}
        {chatLoading&&<div className="flex gap-1.5 px-4 py-3 w-fit rounded-2xl" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)'}}>
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-dot1"/><div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-dot2"/><div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-dot3"/>
        </div>}
        <div ref={bottomRef}/>
      </div>
      <div className="px-6 py-4 border-t border-white/5 flex-shrink-0">
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{background:'#0C0C15',border:'1px solid rgba(27,95,250,0.15)'}}>
          <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&(e.preventDefault(),send())} placeholder="Pregunta a Brutal.IA…" className="flex-1 bg-transparent text-sm text-white placeholder-white/25 outline-none" style={{caretColor:BLU}}/>
          <button onClick={send} disabled={!chatInput.trim()||chatLoading} className="w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-30 transition-opacity" style={{background:BLU}}>
            <LucideIcon name="send" size={13} color="white"/>
          </button>
        </div>
      </div>
    </div>
  )
}

// ── AJUSTES SECTION ──────────────────────────────────────────
function AjustesSection({profile,data,showToast}: any) {
  return (
    <div className="p-6 max-w-[700px] mx-auto">
      <h1 className="font-syne text-2xl font-black text-white mb-6">Ajustes</h1>
      <div className="space-y-4">
        <div className="p-5 rounded-xl" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)'}}>
          <div className="font-syne text-[9px] font-bold tracking-widest text-white/25 uppercase mb-4">Perfil</div>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center font-syne text-base font-black" style={{background:profile.avatar_color+'22',border:`2px solid ${profile.avatar_color}44`,color:profile.avatar_color}}>{profile.initials}</div>
            <div>
              <div className="font-semibold text-white">{profile.name}</div>
              <div className="text-sm text-white/40">{profile.email}</div>
              <div className="font-syne text-[8px] font-black mt-1 px-2 py-0.5 rounded-full inline-block" style={{background:profile.role==='owner'?'rgba(27,95,250,0.1)':'rgba(255,255,255,0.05)',color:profile.role==='owner'?BLU:'rgba(240,240,248,0.3)'}}>{profile.role==='owner'?'PROPIETARIO':'MIEMBRO'}</div>
            </div>
          </div>
        </div>
        <div className="p-5 rounded-xl" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)'}}>
          <div className="font-syne text-[9px] font-bold tracking-widest text-white/25 uppercase mb-4">Integraciones</div>
          <div className="flex items-center justify-between py-3 border-b border-white/5">
            <div className="flex items-center gap-3"><LucideIcon name="mail" size={16} color={BLU}/><span className="text-sm text-white/70">Gmail</span></div>
            {profile.gmail_connected ? (
              <span className="font-syne text-[8px] font-black px-3 py-1 rounded-full" style={{background:'rgba(27,95,250,0.1)',color:BLU}}>CONECTADO</span>
            ) : (
              <a href="/api/gmail/connect" className="font-syne text-[9px] font-black px-3 py-1.5 rounded-lg text-white" style={{background:BLU}}>CONECTAR</a>
            )}
          </div>
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              <span className="text-sm text-white/70">WhatsApp Bot</span>
            </div>
            <span className="text-xs text-white/25">Ver documentación</span>
          </div>
        </div>
        {profile.role === 'owner' && (
          <div className="p-5 rounded-xl" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)'}}>
            <div className="font-syne text-[9px] font-bold tracking-widest text-white/25 uppercase mb-4">Equipo</div>
            {data.team.map((m: Profile)=>(
              <div key={m.id} className="flex items-center gap-3 py-2.5 border-b border-white/4">
                <div className="w-7 h-7 rounded-full flex items-center justify-center font-syne text-[9px] font-black flex-shrink-0" style={{background:m.avatar_color+'22',color:m.avatar_color}}>{m.initials}</div>
                <div className="flex-1"><div className="text-sm text-white/70">{m.name}</div><div className="text-xs text-white/30">{m.email}</div></div>
                <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full" style={{background:m.role==='owner'?'rgba(27,95,250,0.1)':'rgba(255,255,255,0.04)',color:m.role==='owner'?BLU:'rgba(240,240,248,0.2)'}}>{m.role==='owner'?'OWNER':'MIEMBRO'}</span>
                <span className="text-[10px]" style={{color:m.gmail_connected?'#22c55e':'rgba(255,255,255,0.2)'}}>{m.gmail_connected?'Gmail ✓':'Sin Gmail'}</span>
              </div>
            ))}
          </div>
        )}
        <div className="p-5 rounded-xl" style={{background:'rgba(229,29,42,0.04)',border:'1px solid rgba(229,29,42,0.1)'}}>
          <div className="font-syne text-[9px] font-bold tracking-widest text-red-400/50 uppercase mb-3">Zona de peligro</div>
          <p className="text-[12px]" style={{color:'rgba(255,255,255,0.25)'}}>Para exportar reportes, accede a la sección Reportes desde el menú lateral.</p>
        </div>
      </div>
    </div>
  )
}
