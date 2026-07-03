'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNexusData } from '@/hooks/useNexusData'
import type { Profile, Task, Project, Client, Regla } from '@/types'
import { createClient } from '@/lib/supabase/client'

// ── Icons (inline to avoid import issues) ──────────────────
const BLU = '#1B5FFA', RED = '#E51D2A'

type Section = 'hoy'|'inbox'|'tareas'|'clientes'|'proyectos'|'contenido'|'memoria'|'automatizaciones'|'chat'|'equipo'|'reportes'|'ajustes'

interface Props { profile: Profile }

export default function NexusDashboard({ profile }: Props) {
  const data = useNexusData(profile)
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

  // Auto-sync Gmail on load
  useEffect(() => {
    if (profile.gmail_connected) data.syncGmail()
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
        const level = mf.priority?.toLowerCase().includes('urgent') ? 'urgent' : 'high'
        const assignee = data.team.find(m => m.name.toLowerCase().includes(mf.asignado?.toLowerCase()||''))
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
      <button key={id} onClick={()=>setSection(id)} className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-left transition-all" style={{ background:act?'rgba(27,95,250,0.12)':'transparent', color:act?'#F0F0F8':'rgba(240,240,248,0.4)', borderLeft:`2px solid ${act?BLU:'transparent'}`, fontSize:'13px', fontWeight:act?'600':'400', marginBottom:'1px' }}>
        <LucideIcon name={icon} size={14} color={act?BLU:'rgba(240,240,248,0.18)'} />
        <span className="flex-1">{label}</span>
        {badge !== undefined && badge > 0 && <span className="font-syne text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background:act?BLU:'rgba(27,95,250,0.15)', color:act?'white':'rgba(27,95,250,0.8)' }}>{badge}</span>}
      </button>
    )
  }

  if (data.loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-nexus-bg">
        <div className="flex gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-500 animate-dot1"/>
          <div className="w-2 h-2 rounded-full bg-blue-500 animate-dot2"/>
          <div className="w-2 h-2 rounded-full bg-blue-500 animate-dot3"/>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-full font-figtree overflow-hidden" style={{ background:'radial-gradient(ellipse 900px 600px at 75% -5%,rgba(27,95,250,0.06) 0%,transparent 65%),#040409', color:'#F0F0F8' }}>

      {/* SIDEBAR */}
      <aside className="flex-shrink-0 flex flex-col overflow-hidden transition-all duration-200" style={{ width:sidebarOpen?'224px':'0', background:'linear-gradient(180deg,#0C0C1C 0%,#07070F 60%,#050510 100%)', borderRight:'1px solid rgba(27,95,250,0.1)' }}>
        {/* Header */}
        <div className="px-4 py-5 border-b border-white/5 relative flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <img src="https://brutal.thehook-produccion.es/wp-content/themes/brutal-studios/assets/img/brutal-logo-white.svg" alt="Brutal Studios" className="h-4 mb-1" />
              <div className="font-syne text-[10px] font-black tracking-widest text-white">BRUTAL<span style={{color:'#1B5FFA'}}>.IA</span></div>
            </div>
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-glowPulse flex-shrink-0" />
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
          <div>
            <div className="font-syne text-[8px] font-black tracking-widest text-white/15 px-2 mb-2">WORKSPACE</div>
            {navItem('hoy','Hoy','sun',urgentCount)}
            {navItem('inbox','Inbox IA','inbox',unreadCount)}
            {profile.role==='owner' && navItem('equipo','Equipo','users-2')}
          </div>
          <div>
            <div className="font-syne text-[8px] font-black tracking-widest text-white/15 px-2 mb-2">GESTIÓN</div>
            {navItem('tareas','Tareas','check-square',data.tasks.filter((t:Task)=>!t.done&&t.level==='urgent').length||undefined)}
            {navItem('clientes','Clientes','users')}
            {navItem('proyectos','Proyectos','folder-open')}
            {navItem('contenido','Contenido','calendar')}
          </div>
          <div>
            <div className="font-syne text-[8px] font-black tracking-widest text-white/15 px-2 mb-2">CEREBRO</div>
            {navItem('memoria','Memoria','database')}
            {navItem('automatizaciones','Automatizaciones','zap',data.reglas.filter(r=>r.active).length)}
            {profile.role==='owner' && navItem('reportes','Reportes','bar-chart-2')}
          </div>
          <div>
            <div className="font-syne text-[8px] font-black tracking-widest text-white/15 px-2 mb-2">IA</div>
            {navItem('chat','Brutal.IA Chat','message-square')}
            {navItem('ajustes','Ajustes','settings')}
          </div>
        </nav>

        {/* Profile */}
        <div className="p-3 border-t border-white/5 flex-shrink-0">
          {!profile.gmail_connected && (
            <a href="/api/gmail/connect" className="flex items-center gap-2 w-full px-3 py-2 rounded-lg mb-2 text-xs font-syne font-bold tracking-wide" style={{ background:'rgba(27,95,250,0.08)', color:'rgba(27,95,250,0.7)', border:'1px solid rgba(27,95,250,0.15)' }}>
              <LucideIcon name="mail" size={12} color={BLU} />
              Conectar Gmail
            </a>
          )}
          {profile.gmail_connected && (
            <button onClick={()=>data.syncGmail()} disabled={data.syncing} className="flex items-center gap-2 w-full px-3 py-2 rounded-lg mb-2 text-xs font-syne font-bold tracking-wide disabled:opacity-40" style={{ background:'rgba(27,95,250,0.06)', color:'rgba(240,240,248,0.3)', border:'1px solid rgba(255,255,255,0.05)' }}>
              <LucideIcon name="refresh-cw" size={12} color="rgba(27,95,250,0.5)" />
              {data.syncing ? 'Sincronizando…' : 'Sincronizar Gmail'}
            </button>
          )}
          <div className="flex items-center gap-2 px-1.5 py-1.5 rounded-lg">
            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 font-syne text-[10px] font-black" style={{ background:profile.avatar_color+'22', border:`1.5px solid ${profile.avatar_color}44`, color:profile.avatar_color }}>{profile.initials}</div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-white/70 truncate">{profile.name}</div>
              <div className="text-[9px] text-white/20">{profile.role === 'owner' ? 'Director' : 'Equipo'}</div>
            </div>
            <button onClick={handleLogout} className="opacity-30 hover:opacity-60 transition-opacity"><LucideIcon name="log-out" size={13} /></button>
          </div>
          <button onClick={()=>setSidebarOpen(false)} className="flex items-center justify-center w-full py-2 mt-1 text-white/15 hover:text-white/30 transition-colors">
            <LucideIcon name="panel-left-close" size={13} />
          </button>
        </div>
      </aside>

      {/* Sidebar reopen */}
      {!sidebarOpen && (
        <button onClick={()=>setSidebarOpen(true)} className="fixed top-4 left-3 z-50 w-8 h-8 flex items-center justify-center rounded-lg" style={{ background:'#0C0C1C', border:'1px solid rgba(27,95,250,0.2)' }}>
          <LucideIcon name="panel-left-open" size={14} color="rgba(240,240,248,0.5)" />
        </button>
      )}

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Ticker */}
        <div className="overflow-hidden py-1.5 flex-shrink-0" style={{ background:'linear-gradient(90deg,#1440CC,#1B5FFA,#1440CC)' }}>
          <div className="flex whitespace-nowrap animate-ticker">
            {[0,1].map(i=>(
              <span key={i} className="font-syne text-[9px] font-bold tracking-[0.2em] text-white/90 pr-12">
                BRUTAL STUDIOS · BRUTAL.IA · {urgentCount} URGENTES HOY · {data.projects.length} PROYECTOS · {unreadCount} MENSAJES
              </span>
            ))}
          </div>
        </div>

        {/* Section Content */}
        <div className="flex-1 overflow-y-auto">
          {section === 'hoy' && <HoySection profile={profile} data={data} urgentCount={urgentCount} unreadCount={unreadCount} onOpenModal={setModal} showToast={showToast} isOwner={profile.role==='owner'} />}
          {section === 'inbox' && <InboxSection data={data} showToast={showToast} />}
          {section === 'tareas' && <TareasSection data={data} onOpenModal={setModal} showToast={showToast} isOwner={profile.role==='owner'} />}
          {section === 'equipo' && <EquipoSection data={data} showToast={showToast} />}
          {section === 'reportes' && <ReportesSection data={data} />}
          {section === 'clientes' && <ClientesSection data={data} selectedId={selectedClient} onSelect={setSelectedClient} onOpenModal={setModal} showToast={showToast} isOwner={profile.role==='owner'} />}
          {section === 'proyectos' && <ProyectosSection data={data} filteredProjects={filteredProjects} kanbanCols={kanbanCols} projView={projView} setProjView={setProjView} projStatusFilter={projStatusFilter} setProjStatusFilter={setProjStatusFilter} dragRef={dragRef} selectedId={selectedProject} onSelect={setSelectedProject} onOpenModal={setModal} showToast={showToast} isOwner={profile.role==='owner'} />}
          {section === 'contenido' && <ContenidoSection data={data} onOpenModal={setModal} showToast={showToast} />}
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
        <div onClick={()=>setModal(null)} className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background:'rgba(2,2,8,0.75)' }}>
          <div onClick={e=>e.stopPropagation()} className="relative w-[440px] max-w-[92vw] rounded-2xl overflow-hidden" style={{ background:'linear-gradient(180deg,#0C0C1C 0%,#07070F 100%)', border:'1px solid rgba(27,95,250,0.2)', boxShadow:'0 28px 70px rgba(0,0,0,0.7)' }}>
            <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl" style={{ background:BLU }} />
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/6">
              <div>
                <div className="font-syne text-[8px] font-bold tracking-widest text-blue-400/70 uppercase mb-1">{modalMeta[modal]?.eyebrow}</div>
                <h2 className="font-syne text-xl font-black text-white">{modalMeta[modal]?.title}</h2>
              </div>
              <button onClick={()=>setModal(null)} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background:'rgba(255,255,255,0.06)' }}>
                <LucideIcon name="x" size={15} color="rgba(240,240,248,0.5)" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {modalFields(modal, data.team).map(f => (
                <div key={f.key}>
                  <label className="block font-syne text-[8.5px] font-bold tracking-widest text-white/30 uppercase mb-2">{f.label}</label>
                  {f.type === 'select' ? (
                    <select value={mf[f.key]||''} onChange={e=>setMf(m=>({...m,[f.key]:e.target.value}))} className="w-full px-4 py-3 rounded-xl text-sm text-white bg-blue-500/4 outline-none" style={{ border:'1px solid rgba(27,95,250,0.15)' }}>
                      <option value="">Selecciona…</option>
                      {f.options?.map((o:{value:string;label:string})=><option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input value={mf[f.key]||''} onChange={e=>setMf(m=>({...m,[f.key]:e.target.value}))} placeholder={f.placeholder} className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/20 outline-none" style={{ background:'rgba(27,95,250,0.04)', border:'1px solid rgba(27,95,250,0.15)', caretColor:BLU }} />
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/6">
              <button onClick={()=>setModal(null)} className="px-5 py-2.5 rounded-lg text-sm text-white/50" style={{ border:'1px solid rgba(255,255,255,0.1)' }}>Cancelar</button>
              <button onClick={saveModal} disabled={modalSaving} className="px-5 py-2.5 rounded-lg font-syne text-[10.5px] font-black tracking-wide text-white disabled:opacity-60" style={{ background:BLU }}>
                {modalSaving ? 'GUARDANDO…' : modalMeta[modal]?.saveLabel}
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
    cliente: [f('Nombre','name','Ej: Apple España'),f('Industria','industria','Ej: Tecnología · Consumer'),f('Facturación mensual','facturacion','Ej: €8.500/mes')],
    proyecto: [f('Nombre','nombre','Ej: Campaign Summer 26'),f('Cliente','cliente','Ej: Coca-Cola'),f('Deadline','deadline','Ej: 31 Jul')],
    tarea: [
      f('Descripción','text','Ej: Preparar deck propuesta Iberia'),
      f('Prioridad','priority','urgente / high'),
      { label:'Asignar a', key:'asignado', placeholder:'Selecciona miembro', type:'select', options:team.map(m=>({value:m.name,label:`${m.name} (${m.role})`})) },
    ],
    memoria: [f('Título','titulo','Ej: Nike Jordan — Guía de tono 2026'),f('Categoría','categoria','Clientes / Procesos / Decisiones'),f('Contenido','contenido','Resumen de la entrada…')],
    regla: [f('Nombre','nombre','Ej: Alerta propuestas sin respuesta'),f('Condición','condicion','Ej: Propuesta >3 días sin respuesta'),f('Acción','accion','Ej: Crear tarea de seguimiento')],
    contenido: [f('Título','titulo','Ej: Stories lanzamiento verano'),f('Cliente','cliente','Ej: Coca-Cola'),f('Plataforma','plataforma','TikTok / Instagram / LinkedIn'),f('Fecha','fecha','Ej: 10 Jul')],
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
  }
  const d = icons[name]
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
      {d && <path d={d}/>}
    </svg>
  )
}

// ── HOY SECTION ─────────────────────────────────────────────
// ── TAREAS SECTION ───────────────────────────────────────────
function TareasSection({data,onOpenModal,showToast,isOwner}: any) {
  const [filter, setFilter] = useState<'todas'|'urgente'|'high'|'normal'|'hecho'>('todas')
  const [assigneeFilter, setAssigneeFilter] = useState('Todos')

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

  return (
    <div className="p-6 max-w-[900px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-syne text-2xl font-black text-white">Tareas</h1>
        {isOwner && <button onClick={()=>onOpenModal('tarea')} className="flex items-center gap-2 px-4 py-2 rounded-xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:BLU}}>+ NUEVA TAREA</button>}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex gap-1 p-1 rounded-xl" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.06)'}}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setFilter(t.id)} className="px-3 py-1.5 rounded-lg font-syne text-[9px] font-black tracking-wide transition-all" style={{background:filter===t.id?t.color||'rgba(255,255,255,0.08)':'transparent', color:filter===t.id?'white':t.color||'rgba(255,255,255,0.3)'}}>
              {t.label.toUpperCase()}
            </button>
          ))}
        </div>
        {isOwner && assignees.length > 1 && (
          <select value={assigneeFilter} onChange={e=>setAssigneeFilter(e.target.value)} className="px-3 py-2 rounded-xl text-xs text-white/60 outline-none" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.06)'}}>
            {assignees.map(a=><option key={a} value={a}>{a}</option>)}
          </select>
        )}
        <span className="text-xs text-white/25 ml-auto">{filtered.length} tarea{filtered.length!==1?'s':''}</span>
      </div>

      {/* Task list */}
      <div className="rounded-xl overflow-hidden" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)'}}>
        {filtered.length === 0 && (
          <div className="px-5 py-12 text-center text-white/20 text-sm">Sin tareas en este filtro</div>
        )}
        {filtered.map((t: Task, i: number) => (
          <div key={t.id} className="flex items-center gap-4 px-5 py-3.5 border-b border-white/4 hover:bg-white/2 transition-colors group" style={{borderBottom:i===filtered.length-1?'none':undefined}}>
            <button onClick={()=>data.toggleTask(t.id)} className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all" style={{background:t.done?BLU:'transparent',border:`1.5px solid ${t.done?BLU:'rgba(255,255,255,0.15)'}`}}>
              {t.done && <LucideIcon name="check" size={10} color="white"/>}
            </button>
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.8)':BLU}}/>
            <span className="flex-1 text-sm transition-colors" style={{color:t.done?'rgba(255,255,255,0.2)':'rgba(255,255,255,0.8)',textDecoration:t.done?'line-through':'none'}}>{t.text}</span>
            {t.assignee && (
              <div className="w-6 h-6 rounded-full flex items-center justify-center font-syne text-[8px] font-black flex-shrink-0" style={{background:t.assignee.avatar_color+'22',color:t.assignee.avatar_color,border:`1px solid ${t.assignee.avatar_color}44`}}>
                {t.assignee.initials}
              </div>
            )}
            {t.source && t.source !== 'manual' && (
              <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded" style={{background:t.source==='gmail'?'rgba(27,95,250,0.1)':'rgba(37,211,102,0.1)',color:t.source==='gmail'?BLU:'#25D366'}}>{t.source.toUpperCase()}</span>
            )}
            {isOwner && <button onClick={()=>data.deleteTask(t.id)} className="opacity-0 group-hover:opacity-30 hover:!opacity-60 transition-opacity"><LucideIcon name="trash-2" size={12} color="rgba(229,29,42,0.8)"/></button>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── EQUIPO SECTION ────────────────────────────────────────────
function EquipoSection({data}: any) {
  return (
    <div className="p-6 max-w-[1000px] mx-auto">
      <h1 className="font-syne text-2xl font-black text-white mb-6">Equipo</h1>

      <div className="grid grid-cols-2 gap-4">
        {data.team.map((member: Profile) => {
          const memberTasks = data.tasks.filter((t: Task) => t.assignee?.name === member.name)
          const pending = memberTasks.filter((t: Task) => !t.done)
          const done = memberTasks.filter((t: Task) => t.done)
          const urgent = pending.filter((t: Task) => t.level === 'urgent')

          return (
            <div key={member.id} className="rounded-xl overflow-hidden" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)'}}>
              {/* Header */}
              <div className="flex items-center gap-3 p-5 border-b border-white/5">
                <div className="w-10 h-10 rounded-full flex items-center justify-center font-syne text-sm font-black flex-shrink-0" style={{background:member.avatar_color+'22',border:`2px solid ${member.avatar_color}33`,color:member.avatar_color}}>{member.initials}</div>
                <div className="flex-1">
                  <div className="font-semibold text-white text-sm">{member.name}</div>
                  <div className="text-[10px] text-white/30">{member.role === 'owner' ? 'Director' : 'Equipo'} · {member.email}</div>
                </div>
                {urgent.length > 0 && <span className="font-syne text-[8px] font-black px-2 py-1 rounded-full" style={{background:'rgba(229,29,42,0.1)',color:RED}}>{urgent.length} URGENTE{urgent.length>1?'S':''}</span>}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 divide-x divide-white/5">
                {[{v:pending.length,l:'Pendientes'},{v:done.length,l:'Hechas'},{v:urgent.length,l:'Urgentes'}].map((s,i)=>(
                  <div key={i} className="p-3 text-center">
                    <div className="font-syne text-xl font-black" style={{color:i===2&&s.v>0?RED:'rgba(255,255,255,0.8)'}}>{s.v}</div>
                    <div className="text-[9px] text-white/25">{s.l}</div>
                  </div>
                ))}
              </div>

              {/* Tasks */}
              <div className="px-4 pb-4">
                {pending.slice(0,4).map((t: Task) => (
                  <div key={t.id} className="flex items-center gap-2 py-2 border-b border-white/4">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.7)':BLU}}/>
                    <span className="text-xs text-white/60 flex-1 truncate">{t.text}</span>
                  </div>
                ))}
                {pending.length === 0 && <div className="text-center text-white/15 text-xs py-4">Sin tareas asignadas</div>}
                {pending.length > 4 && <div className="text-center text-white/25 text-xs pt-2">+{pending.length-4} más</div>}
              </div>
            </div>
          )
        })}
      </div>

      {data.team.length === 0 && (
        <div className="text-center text-white/20 py-16 text-sm">Sin datos de equipo. Accede como Owner para verlos.</div>
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
        <h1 className="font-syne text-2xl font-black text-white">Reportes</h1>
        <button onClick={()=>window.print()} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-white/40 hover:text-white/70 transition-colors" style={{border:'1px solid rgba(255,255,255,0.1)'}}>
          <LucideIcon name="printer" size={13}/>Exportar PDF
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
  const dateStr = now.toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long' })

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="font-syne text-[9px] font-bold tracking-widest text-white/20 uppercase mb-1">{dateStr.toUpperCase()}</div>
          <h1 className="font-syne text-2xl font-black text-white">Buenos días, {profile.name.split(' ')[0]} 👋</h1>
        </div>
        <div className="flex gap-2">
          {isOwner && <button onClick={()=>onOpenModal('tarea')} className="flex items-center gap-2 px-4 py-2 rounded-xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:BLU}}>+ TAREA</button>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { value:urgentCount+'', label:'Urgentes hoy', accent:RED, glow:urgentCount>0 },
          { value:unreadCount+'', label:'Mensajes', accent:BLU, glow:false },
          { value:data.projects.length+'', label:'Proyectos', accent:null, glow:false },
          { value:data.tasks.filter((t:Task)=>!t.done).length+'', label:'Tareas pendientes', accent:null, glow:false },
        ].map((s,i) => (
          <div key={i} className="rounded-xl p-4" style={{ background:s.accent?`linear-gradient(135deg,${s.accent}18 0%,#0C0C15 100%)`:'#0C0C15', border:`1px solid ${s.accent?s.accent+'33':'rgba(255,255,255,0.07)'}`, borderTop:`2px solid ${s.accent||'rgba(255,255,255,0.1)'}`, boxShadow:s.glow?`0 0 24px ${s.accent}22`:'none' }}>
            <div className="font-syne text-4xl font-black text-white mb-1" style={{ color:s.glow&&s.accent?s.accent:'#F0F0F8' }}>{s.value}</div>
            <div className="text-[11px] text-white/40">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Priorities */}
      <div className="grid grid-cols-[1fr_300px] gap-4">
        <div className="rounded-xl overflow-hidden" style={{ background:'#0C0C15', border:'1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
            <span className="font-syne text-[9px] font-bold tracking-widest text-white/30 uppercase">Prioridades del día</span>
            {isOwner && <button onClick={()=>onOpenModal('tarea')} className="font-syne text-[9px] font-black tracking-wide text-blue-400/70 hover:text-blue-400">+ NUEVA</button>}
          </div>
          {data.tasks.filter((t:Task)=>!t.done).slice(0,8).map((t:Task)=>(
            <div key={t.id} className="flex items-center gap-3 px-5 py-3 border-b border-white/4 hover:bg-white/2 cursor-pointer transition-colors" onClick={()=>data.toggleTask(t.id)}>
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background:t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.7)':BLU }} />
              <span className="flex-1 text-sm text-white/80">{t.text}</span>
              {t.assignee && <span className="font-syne text-[8px] font-black text-white/25 px-2 py-0.5 rounded" style={{background:'rgba(255,255,255,0.04)'}}>{t.assignee.initials}</span>}
              {t.source !== 'manual' && <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded" style={{background:t.source==='gmail'?'rgba(27,95,250,0.1)':'rgba(37,211,102,0.1)',color:t.source==='gmail'?BLU:'#25D366'}}>{t.source.toUpperCase()}</span>}
            </div>
          ))}
          {data.tasks.filter((t:Task)=>!t.done).length === 0 && <div className="px-5 py-8 text-center text-white/20 text-sm">Sin tareas pendientes 🎉</div>}
        </div>

        {/* Quick actions */}
        <div className="space-y-3">
          <div className="rounded-xl p-4" style={{ background:'#0C0C15', border:'1px solid rgba(255,255,255,0.07)' }}>
            <div className="font-syne text-[9px] font-bold tracking-widest text-white/25 uppercase mb-3">Acciones rápidas</div>
            {[
              {label:'Nuevo cliente',icon:'plus',act:()=>onOpenModal('cliente'),owner:true},
              {label:'Nuevo proyecto',icon:'folder-open',act:()=>onOpenModal('proyecto'),owner:true},
              {label:'Nueva tarea',icon:'check',act:()=>onOpenModal('tarea'),owner:true},
              {label:'Nueva pieza',icon:'calendar',act:()=>onOpenModal('contenido'),owner:false},
            ].filter(a=>isOwner||!a.owner).map(a=>(
              <button key={a.label} onClick={a.act} className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-left text-sm text-white/60 hover:text-white/90 hover:bg-white/4 transition-colors mb-1">
                <LucideIcon name={a.icon} size={13} color="rgba(27,95,250,0.6)" />
                {a.label}
              </button>
            ))}
          </div>
          <div className="rounded-xl p-4" style={{ background:'#0C0C15', border:'1px solid rgba(255,255,255,0.07)' }}>
            <div className="font-syne text-[9px] font-bold tracking-widest text-white/25 uppercase mb-3">Proyectos activos</div>
            {data.projects.filter((p:Project)=>p.status==='activo'||p.status==='urgente').slice(0,3).map((p:Project)=>(
              <div key={p.id} className="mb-3">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-white/70 truncate">{p.name}</span>
                  <span className="text-white/30 flex-shrink-0 ml-2">{p.progress}%</span>
                </div>
                <div className="h-1 rounded-full bg-white/5">
                  <div className="h-full rounded-full transition-all" style={{width:p.progress+'%',background:p.color||BLU}}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── INBOX SECTION ────────────────────────────────────────────
function InboxSection({data,showToast}: any) {
  const [filter, setFilter] = useState('Todos')
  const [selected, setSelected] = useState<any>(null)
  const msgs = data.inbox.filter((m: any) => {
    if (filter==='Todos') return true
    if (filter==='No leídos') return !m.is_read
    if (filter==='General') return m.shared
    return m.source===filter.toLowerCase()
  })

  const handleSelect = (m: any) => {
    setSelected(m)
    if (!m.is_read) data.markRead(m.id)
  }

  const createTaskFromEmail = async (m: any) => {
    if (!m.ai_action) return
    await data.createTask({ text: m.ai_action, level: m.ai_urgency === 'urgent' ? 'urgent' : 'high', source: 'gmail' })
    showToast('Tarea creada desde email')
  }

  return (
    <div className="flex h-full">
      {/* List */}
      <div className="flex flex-col overflow-hidden" style={{width: selected ? '360px' : '100%', flexShrink: 0, borderRight: selected ? '1px solid rgba(255,255,255,0.06)' : 'none'}}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/5 flex-shrink-0">
          <h1 className="font-syne text-xl font-black text-white">Inbox IA</h1>
          <button onClick={()=>data.syncGmail()} disabled={data.syncing} title={data.syncResult?.message || ''} className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs disabled:opacity-40 hover:text-white/70 transition-colors" style={{border:'1px solid rgba(255,255,255,0.08)', color: data.syncResult ? (data.syncResult.ok ? '#4ade80' : '#ef4444') : 'rgba(240,240,248,0.4)'}}>
            <LucideIcon name="refresh-cw" size={12}/>{data.syncing?'Sync…':'Sync'}
          </button>
        </div>
        <div className="flex gap-1 px-4 pt-3 pb-2 flex-shrink-0">
          {['Todos','No leídos','General','Gmail','WhatsApp'].map(f=>(
            <button key={f} onClick={()=>setFilter(f)} className="px-3 py-1.5 rounded-lg text-[10px] font-syne font-bold tracking-wide transition-colors" style={{background:filter===f?'rgba(27,95,250,0.12)':'transparent',color:filter===f?'#F0F0F8':'rgba(240,240,248,0.35)'}}>
              {f}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {msgs.map((m: any)=>(
            <div key={m.id} onClick={()=>handleSelect(m)} className="flex items-start gap-3 px-3 py-3 rounded-xl cursor-pointer transition-all mb-1" style={{background:selected?.id===m.id?'rgba(27,95,250,0.1)':m.is_read?'transparent':'rgba(12,12,21,0.8)',border:`1px solid ${selected?.id===m.id?'rgba(27,95,250,0.3)':m.is_read?'transparent':'rgba(27,95,250,0.08)'}` }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 font-syne text-[10px] font-black mt-0.5" style={{background:m.source==='gmail'?'rgba(27,95,250,0.12)':'rgba(37,211,102,0.12)',color:m.source==='gmail'?BLU:'#25D366'}}>
                {m.from_name?.slice(0,2).toUpperCase()||'??'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-semibold truncate" style={{color:m.is_read?'rgba(255,255,255,0.5)':'rgba(255,255,255,0.9)'}}>{m.from_name}</span>
                  {!m.is_read && <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:BLU}}/>}
                  {m.shared && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded flex-shrink-0" style={{background:'rgba(27,95,250,0.1)',color:'rgba(27,95,250,0.7)'}}>GENERAL</span>}
                  {m.ai_urgency==='urgent' && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded flex-shrink-0" style={{background:'rgba(229,29,42,0.12)',color:RED}}>URG</span>}
                </div>
                <div className="text-xs truncate" style={{color:m.is_read?'rgba(255,255,255,0.3)':'rgba(255,255,255,0.55)'}}>{m.subject||m.from_phone||'Sin asunto'}</div>
                {m.ai_summary && <div className="text-[10px] mt-1 truncate" style={{color:'rgba(27,95,250,0.6)'}}>{m.ai_summary}</div>}
              </div>
            </div>
          ))}
          {msgs.length === 0 && (
            <div className="py-16 text-center text-white/20 text-sm">
              {data.inbox.length===0 ? 'Conecta Gmail para ver tus mensajes' : 'Sin mensajes en esta categoría'}
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="flex-1 overflow-y-auto p-6 min-w-0">
          <div className="flex items-center justify-between mb-6">
            <button onClick={()=>setSelected(null)} className="flex items-center gap-2 text-sm text-white/40 hover:text-white/70 transition-colors">
              <LucideIcon name="arrow-left" size={14}/> Volver
            </button>
            <div className="flex gap-2">
              <button onClick={()=>createTaskFromEmail(selected)} className="flex items-center gap-2 px-4 py-2 rounded-xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:BLU}}>
                <LucideIcon name="plus" size={12} color="white"/> CREAR TAREA
              </button>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="font-syne text-xl font-black text-white mb-2">{selected.subject || 'Sin asunto'}</h2>
            <div className="flex items-center gap-3 text-sm text-white/40">
              <span className="font-medium text-white/60">{selected.from_name}</span>
              {selected.from_email && <span>{selected.from_email}</span>}
              {selected.received_at && <span>{new Date(selected.received_at).toLocaleDateString('es-ES',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span>}
              <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded ml-auto" style={{background:selected.source==='gmail'?'rgba(27,95,250,0.1)':'rgba(37,211,102,0.1)',color:selected.source==='gmail'?BLU:'#25D366'}}>{selected.source?.toUpperCase()}</span>
            </div>
          </div>

          {/* AI Analysis */}
          <div className="rounded-xl p-4 mb-5" style={{background:'rgba(27,95,250,0.05)',border:'1px solid rgba(27,95,250,0.12)'}}>
            <div className="font-syne text-[8px] font-black tracking-widest text-blue-400/60 mb-3">BRUTAL.IA · ANÁLISIS</div>
            {selected.ai_urgency && (
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-white/40">Urgencia:</span>
                <span className="font-syne text-[9px] font-black px-2 py-0.5 rounded" style={{background:selected.ai_urgency==='urgent'?'rgba(229,29,42,0.12)':'rgba(255,255,255,0.06)',color:selected.ai_urgency==='urgent'?RED:'rgba(255,255,255,0.4)'}}>{selected.ai_urgency.toUpperCase()}</span>
              </div>
            )}
            {selected.ai_client && selected.ai_client !== 'Desconocido' && (
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-white/40">Cliente:</span>
                <span className="text-xs text-white/70">{selected.ai_client}</span>
              </div>
            )}
            {selected.ai_summary && <p className="text-sm text-white/70 leading-relaxed mb-2">{selected.ai_summary}</p>}
            {selected.ai_action && selected.ai_action !== 'Ninguna acción requerida' && (
              <div className="flex items-start gap-2 mt-3 pt-3 border-t border-white/6">
                <LucideIcon name="zap" size={12} color={BLU}/>
                <span className="text-xs text-white/60">{selected.ai_action}</span>
              </div>
            )}
          </div>

          {/* Email body */}
          {selected.body_preview && (
            <div className="rounded-xl p-5" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)'}}>
              <div className="font-syne text-[8px] font-black tracking-widest text-white/20 mb-3">CONTENIDO</div>
              <p className="text-sm text-white/50 leading-relaxed whitespace-pre-wrap">{selected.body_preview}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── CLIENTES SECTION ─────────────────────────────────────────
function ClientesSection({data,selectedId,onSelect,onOpenModal,showToast,isOwner}: any) {
  const selected = selectedId ? data.clients.find((c: Client)=>c.id===selectedId) : null

  if (selected) {
    const clientProjects = data.projects.filter((p: Project)=>p.client_id===selected.id)
    const clientTasks = data.tasks.filter((t: Task)=>t.client_id===selected.id)
    return (
      <div className="p-6 max-w-[900px] mx-auto">
        <button onClick={()=>onSelect(null)} className="flex items-center gap-2 text-sm text-white/40 hover:text-white/70 mb-6 transition-colors">
          <LucideIcon name="arrow-left" size={14}/> Todos los clientes
        </button>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-syne text-lg font-black" style={{background:selected.color+'22',border:`2px solid ${selected.color}44`,color:selected.color}}>{selected.initials}</div>
            <div>
              <h1 className="font-syne text-2xl font-black text-white">{selected.name}</h1>
              <div className="text-sm text-white/40">{selected.industry}</div>
            </div>
          </div>
          {isOwner && <button onClick={()=>data.deleteClient(selected.id).then(()=>{onSelect(null);showToast('Cliente eliminado')})} className="px-3 py-2 rounded-lg text-xs text-red-400/60 hover:text-red-400 transition-colors" style={{border:'1px solid rgba(229,29,42,0.15)'}}>Eliminar</button>}
        </div>
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[{label:'Facturación',value:selected.revenue},{label:'Proyectos',value:clientProjects.length+''},{label:'Tareas activas',value:clientTasks.filter((t: Task)=>!t.done).length+''}].map(s=>(
            <div key={s.label} className="p-4 rounded-xl" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)'}}>
              <div className="font-syne text-2xl font-black text-white mb-1">{s.value}</div>
              <div className="text-xs text-white/30">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="rounded-xl overflow-hidden" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)'}}>
          <div className="px-5 py-3 border-b border-white/5 font-syne text-[9px] font-bold tracking-widest text-white/25 uppercase">Proyectos</div>
          {clientProjects.map((p: Project)=>(
            <div key={p.id} className="flex items-center gap-4 px-5 py-3 border-b border-white/4">
              <div className="flex-1"><div className="text-sm text-white/80">{p.name}</div><div className="text-xs text-white/30">{p.status} · {p.deadline}</div></div>
              <div className="w-20 h-1 rounded-full bg-white/5"><div className="h-full rounded-full" style={{width:p.progress+'%',background:p.color||BLU}}/></div>
              <span className="text-xs text-white/30">{p.progress}%</span>
            </div>
          ))}
          {clientProjects.length===0&&<div className="px-5 py-6 text-sm text-white/20">Sin proyectos</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-syne text-2xl font-black text-white">Clientes</h1>
        {isOwner && <button onClick={()=>onOpenModal('cliente')} className="flex items-center gap-2 px-4 py-2 rounded-xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:BLU}}>+ NUEVO CLIENTE</button>}
      </div>
      <div className="rounded-xl overflow-hidden" style={{border:'1px solid rgba(255,255,255,0.07)'}}>
        <div className="grid grid-cols-[2fr_2fr_1fr_1fr] gap-4 px-5 py-3 border-b border-white/5">
          {['Cliente','Industria','Estado','Facturación'].map(h=><span key={h} className="font-syne text-[8px] font-bold tracking-widest text-white/20 uppercase">{h}</span>)}
        </div>
        {data.clients.map((c: Client)=>(
          <div key={c.id} onClick={()=>onSelect(c.id)} className="grid grid-cols-[2fr_2fr_1fr_1fr] gap-4 px-5 py-4 border-b border-white/4 hover:bg-white/2 cursor-pointer transition-colors items-center">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center font-syne text-[10px] font-black flex-shrink-0" style={{background:c.color+'22',color:c.color}}>{c.initials}</div>
              <span className="font-semibold text-sm text-white/85">{c.name}</span>
            </div>
            <span className="text-sm text-white/40">{c.industry}</span>
            <span className="font-syne text-[9px] font-black px-2 py-1 rounded-full w-fit" style={{background:'rgba(27,95,250,0.1)',color:BLU}}>{c.status}</span>
            <span className="text-sm text-white/50">{c.revenue}</span>
          </div>
        ))}
        {data.clients.length===0&&<div className="px-5 py-12 text-center text-white/20 text-sm">Sin clientes aún. Crea el primero →</div>}
      </div>
    </div>
  )
}

// ── PROYECTOS SECTION ────────────────────────────────────────
function ProyectosSection({data,filteredProjects,kanbanCols,projView,setProjView,projStatusFilter,setProjStatusFilter,dragRef,selectedId,onSelect,onOpenModal,showToast,isOwner}: any) {
  const statusTabs = ['Todos','plan.','activo','urgente','revisión']
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <h1 className="font-syne text-2xl font-black text-white">Proyectos</h1>
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
        <div className="grid grid-cols-4 gap-3">
          {kanbanCols.map((col: any)=>(
            <div key={col.status} className="rounded-xl overflow-hidden" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)'}}
              onDragOver={(e)=>e.preventDefault()}
              onDrop={()=>{ if(dragRef.current) { data.updateProject(dragRef.current,{status:col.status}).then(()=>showToast(`→ ${col.title}`)); dragRef.current=null }}}>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
                <div className="w-2 h-2 rounded-full" style={{background:col.color}}/>
                <span className="font-syne text-[9.5px] font-black tracking-widest uppercase flex-1 text-white/50">{col.title}</span>
                <span className="font-syne text-sm font-black text-white/20">{col.items.length}</span>
              </div>
              <div className="p-2">
                {col.items.map((p: Project)=>(
                  <div key={p.id} draggable onDragStart={()=>dragRef.current=p.id} className="p-3 rounded-xl mb-2 cursor-grab active:cursor-grabbing" style={{background:'linear-gradient(180deg,rgba(27,95,250,0.05) 0%,#0C0C15 100%)',border:`1px solid rgba(255,255,255,0.08)`,borderTop:`2px solid ${p.color||BLU}60`}}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="text-[13px] font-semibold text-white/85 leading-tight">{p.name}</span>
                      <span className="font-syne text-[9px] font-black flex-shrink-0" style={{color:p.deadline==='HOY'?RED:'rgba(240,240,248,0.3)'}}>{p.deadline}</span>
                    </div>
                    <div className="text-[11px] text-white/30 mb-2">{p.client?.name||'—'}</div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-0.5 rounded-full bg-white/5"><div className="h-full rounded-full" style={{width:p.progress+'%',background:p.color||BLU}}/></div>
                      <span className="font-syne text-[9px] text-white/25">{p.progress}%</span>
                    </div>
                  </div>
                ))}
                {col.items.length===0&&<div className="py-6 text-center text-[11px] text-white/15">Arrastra aquí</div>}
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
  const platColors: Record<string,string> = {TikTok:'#010101',Instagram:'linear-gradient(135deg,#833AB4,#E1306C)',LinkedIn:'#0A66C2'}
  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-syne text-2xl font-black text-white">Contenido</h1>
        <button onClick={()=>onOpenModal('contenido')} className="px-4 py-2 rounded-xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:BLU}}>+ NUEVA PIEZA</button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {data.agenda.map((item: any,i: number)=>(
          <div key={item.id||i} className="rounded-xl overflow-hidden" style={{border:'1px solid rgba(255,255,255,0.07)'}}>
            <div className="flex items-center gap-3 px-4 py-3" style={{background:platColors[item.platform]||'rgba(255,255,255,0.03)'}}>
              <span className="text-white font-bold text-sm">{item.platform}</span>
              <span className="ml-auto font-syne text-[8px] font-black text-white/50">{item.publish_date}</span>
            </div>
            <div className="p-4" style={{background:'#0C0C15'}}>
              <div className="font-semibold text-sm text-white/85 mb-1">{item.title}</div>
              <div className="text-xs text-white/30">{item.client?.name||'—'}</div>
              <span className="inline-block mt-3 font-syne text-[8px] font-black px-2 py-1 rounded-full capitalize" style={{background:'rgba(255,255,255,0.05)',color:'rgba(240,240,248,0.4)'}}>{item.status}</span>
            </div>
          </div>
        ))}
        {data.agenda.length===0&&<div className="col-span-3 py-16 text-center text-white/20 text-sm">Sin piezas de contenido</div>}
      </div>
    </div>
  )
}

// ── MEMORIA SECTION ──────────────────────────────────────────
function MemoriaSection({data,memFilter,setMemFilter,onOpenModal,showToast}: any) {
  const cats = ['Todos','Clientes','Procesos','Decisiones','Aprendizajes']
  const filtered = memFilter==='Todos' ? data.memoria : data.memoria.filter((m: any)=>m.category===memFilter)
  return (
    <div className="p-6 max-w-[900px] mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="font-syne text-2xl font-black text-white">Memoria</h1>
        <button onClick={()=>onOpenModal('memoria')} className="px-4 py-2 rounded-xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:BLU}}>+ ENTRADA</button>
      </div>
      <div className="flex gap-2 mb-5">
        {cats.map(c=><button key={c} onClick={()=>setMemFilter(c)} className="px-3 py-1.5 rounded-lg text-xs font-syne font-bold tracking-wide transition-colors" style={{background:memFilter===c?'rgba(27,95,250,0.12)':'transparent',color:memFilter===c?'#F0F0F8':'rgba(240,240,248,0.35)'}}>{c}</button>)}
      </div>
      <div className="space-y-2">
        {filtered.map((m: any)=>(
          <div key={m.id} className="flex items-start gap-4 p-4 rounded-xl transition-colors hover:bg-white/2 group" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.06)'}}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:'rgba(27,95,250,0.08)'}}>
              <LucideIcon name="database" size={14} color="rgba(27,95,250,0.6)"/>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-sm text-white/85">{m.title}</span>
                <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded" style={{background:'rgba(255,255,255,0.04)',color:'rgba(240,240,248,0.25)'}}>{m.category}</span>
              </div>
              <div className="text-xs text-white/40 line-clamp-2">{m.content}</div>
            </div>
            <button onClick={()=>data.deleteMemoria(m.id).then(()=>showToast('Eliminado'))} className="opacity-0 group-hover:opacity-40 hover:!opacity-70 transition-opacity"><LucideIcon name="trash" size={13} color={RED}/></button>
          </div>
        ))}
        {filtered.length===0&&<div className="py-16 text-center text-white/20 text-sm">Sin entradas</div>}
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
          <h1 className="font-syne text-2xl font-black text-white">Automatizaciones</h1>
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
        <h1 className="font-syne text-xl font-black text-white">BRUTAL<span style={{color:'#1B5FFA'}}>.IA</span></h1>
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
          <button onClick={()=>window.print()} className="flex items-center gap-2 text-sm text-white/50 hover:text-white/70 transition-colors mb-2"><LucideIcon name="printer" size={14}/>Exportar PDF</button>
        </div>
      </div>
    </div>
  )
}
