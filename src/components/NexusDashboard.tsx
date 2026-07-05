'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNexusData } from '@/hooks/useNexusData'
import type { Profile, Task, Project, Client, Regla } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { PlatformLogo } from '@/components/PlatformLogo'

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
    const label = msg.source === 'internal' ? `Mensaje de ${sender}` : `Nuevo mensaje de ${sender}`
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
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifData, setNotifData] = useState<{dmCount:number;urgentCount:number;total:number;dms:any[];urgent:any[]}>({dmCount:0,urgentCount:0,total:0,dms:[],urgent:[]})

  useEffect(() => {
    const fetchNotifs = () => fetch('/api/notifications').then(r=>r.ok?r.json():null).then(d=>{if(d)setNotifData(d)}).catch(()=>{})
    fetchNotifs()
    const iv = setInterval(fetchNotifs, 30000)
    return () => clearInterval(iv)
  }, [])
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
  const gPendingRef = useRef(false)
  const gTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null)
  useEffect(() => {
    const NAV: Record<string, Section> = { h:'hoy', t:'tareas', i:'inbox', c:'clientes', p:'proyectos', k:'contenido', a:'calendario', m:'memoria', e:'equipo', r:'reportes', s:'ajustes', v:'automatizaciones', n:'chat' }
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true); setSearchQuery(''); setSearchIdx(-1); return }
      if (e.key === 'Escape') { setSearchOpen(false); setModal(null); return }
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key.toLowerCase() === 'g' && !e.metaKey && !e.ctrlKey) {
        gPendingRef.current = true
        if (gTimerRef.current) clearTimeout(gTimerRef.current)
        gTimerRef.current = setTimeout(() => { gPendingRef.current = false }, 1000)
        return
      }
      if (gPendingRef.current && NAV[e.key.toLowerCase()]) {
        e.preventDefault()
        setSection(NAV[e.key.toLowerCase()])
        gPendingRef.current = false
        if (gTimerRef.current) clearTimeout(gTimerRef.current)
      }
    }
    window.addEventListener('keydown', handler)
    return () => { window.removeEventListener('keydown', handler); if (gTimerRef.current) clearTimeout(gTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      ...data.projects.map(p => ({ type:'Proyecto', title:p.name, sub:p.client?.name||'—', act:()=>{ setSelectedProject(p.id); setProjView('list'); setSection('proyectos'); setSearchOpen(false) }})),
      ...data.tasks.map(t => ({ type:'Tarea', title:t.text, sub:t.level==='urgent'?'Urgente':t.level==='high'?'Alta':'Normal', act:()=>{ setSection('tareas'); setSearchOpen(false) }})),
      ...data.memoria.map(m => ({ type:'Memoria', title:m.title, sub:m.category, act:()=>{ setSection('memoria'); setSearchOpen(false) }})),
      ...data.agenda.map((a: any) => ({ type:'Contenido', title:a.title, sub:a.platform, act:()=>{ setSection('contenido'); setSearchOpen(false) }})),
      ...data.inbox.map((m: any) => ({ type:'Inbox', title:m.subject||m.from_name||'Sin asunto', sub:m.from_name||'', act:()=>{ setSection('inbox'); setSearchOpen(false) }})),
      ...data.team.map((p: any) => ({ type:'Equipo', title:p.name, sub:p.role||'Miembro', act:()=>{ setSection('equipo'); setSearchOpen(false) }})),
    ].filter(r => r.title.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q)).slice(0, 9)
  })()
  sr.current = searchResults

  const typeColor: Record<string,string> = { Cliente:BLU, Proyecto:'rgba(255,176,32,0.9)', Tarea:RED, Memoria:'rgba(240,240,248,0.4)', Contenido:'#C13584', Inbox:'rgba(100,180,255,0.7)', Equipo:GRN }

  const ACCENT_COLORS = ['#1B5FFA','#E51D2A','#22c55e','#F97316','#A78BFA','#06B6D4','#EC4899','#84CC16','#F59E0B','#10B981']
  const overdueProjs = data.projects.filter((p: Project) => p.deadline && p.deadline !== 'TBD' && p.status !== 'completado' && new Date(p.deadline+'T23:59:59') < new Date())

  const saveModal = async () => {
    setModalSaving(true)
    try {
      if (modal === 'cliente') {
        if (!mf.name?.trim()) { showToast('Escribe el nombre del cliente'); return }
        const color = ACCENT_COLORS[data.clients.length % ACCENT_COLORS.length]
        await data.createClient({ name:mf.name.trim(), industry:mf.industria||'—', revenue:mf.facturacion||'—', color })
        showToast('Cliente creado: '+mf.name)
      } else if (modal === 'proyecto') {
        if (!mf.nombre?.trim()) { showToast('Escribe el nombre'); return }
        const client = mf.cliente?.trim()
          ? data.clients.find((c: Client) => c.name.toLowerCase().includes(mf.cliente.toLowerCase()) || mf.cliente.toLowerCase().includes(c.name.toLowerCase().split(' ')[0]))
          : null
        const color = client?.color || ACCENT_COLORS[data.projects.length % ACCENT_COLORS.length]
        const projStatus = (mf.estado || 'activo') as 'plan.'|'activo'|'urgente'|'revisión'|'completado'
        await data.createProject({ name:mf.nombre.trim(), client_id:client?.id, status:projStatus, progress:0, deadline:mf.deadline||'TBD', color })
        showToast('Proyecto creado: '+mf.nombre)
      } else if (modal === 'tarea') {
        if (!mf.text?.trim()) { showToast('Escribe la tarea'); return }
        const level: 'urgent'|'high'|'normal' = mf.priority==='urgente'?'urgent':mf.priority==='high'?'high':'normal'
        const assignee = data.team.find((m: Profile) => m.name === mf.asignado)
        const taskClient = mf.cliente?.trim()
          ? data.clients.find((c: Client) => c.name.toLowerCase().includes(mf.cliente.toLowerCase()) || mf.cliente.toLowerCase().includes(c.name.toLowerCase().split(' ')[0]))
          : null
        const taskProject = mf.proyecto?.trim()
          ? data.projects.find((p: Project) => p.name.toLowerCase().includes(mf.proyecto.toLowerCase()) || mf.proyecto.toLowerCase().includes(p.name.toLowerCase().split(' ')[0]))
          : null
        await data.createTask({ text:mf.text.trim(), level, assigned_to:assignee?.id, source:'manual', due_date:mf.due_date?.trim()||undefined, client_id:taskClient?.id, project_id:taskProject?.id })
        showToast('Tarea creada' + (taskProject ? ` · ${taskProject.name}` : taskClient ? ` · ${taskClient.name}` : ''))
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
        const contentClient = mf.cliente?.trim()
          ? data.clients.find((c: Client) => c.name.toLowerCase().includes(mf.cliente.toLowerCase()) || mf.cliente.toLowerCase().includes(c.name.toLowerCase().split(' ')[0]))
          : null
        await data.createAgenda({ title:mf.titulo.trim(), platform:mf.plataforma||'Instagram', account_name:mf.cuenta?.trim()||undefined, content_type:'Post', status:(mf.estado||'borrador') as 'borrador'|'pendiente'|'listo'|'publicado', publish_date:mf.fecha, client_id:contentClient?.id })
        showToast('Pieza añadida' + (contentClient ? ` · ${contentClient.name}` : ''))
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
  const todayCalCount = (data.calendarEvents||[]).filter((e: any) => e.start?.slice(0,10) === new Date().toISOString().slice(0,10)).length

  const filteredProjects = projStatusFilter === 'Todos' ? data.projects : data.projects.filter(p => p.status === projStatusFilter)
  const kanbanCols = [
    { title:'Plan.', color:'rgba(240,240,248,0.25)', status:'plan.', items:filteredProjects.filter(p=>p.status==='plan.') },
    { title:'Progreso', color:BLU, status:'activo', items:filteredProjects.filter(p=>p.status==='activo') },
    { title:'Urgente', color:RED, status:'urgente', items:filteredProjects.filter(p=>p.status==='urgente') },
    { title:'Revisión', color:'rgba(255,176,32,0.7)', status:'revisión', items:filteredProjects.filter(p=>p.status==='revisión') },
    { title:'Completado', color:GRN, status:'completado', items:filteredProjects.filter(p=>p.status==='completado') },
  ]

  const dragRef = useRef<string|null>(null)

  const NAV_SC: Partial<Record<Section,string>> = { hoy:'H', tareas:'T', inbox:'I', clientes:'C', proyectos:'P', contenido:'K', calendario:'A', memoria:'M', equipo:'E', reportes:'R', ajustes:'S', automatizaciones:'V', chat:'N' }

  const navItem = (id: Section, label: string, icon: string, badge?: number) => {
    const act = section === id
    const sc = NAV_SC[id]
    return (
      <button key={id} onClick={()=>setSection(id)}
        className="flex items-center gap-2.5 w-full py-2.5 rounded-lg text-left transition-all duration-150 group"
        style={{
          background: act ? 'rgba(27,95,250,0.1)' : 'transparent',
          color: act ? '#F0F0F8' : 'rgba(240,240,248,0.38)',
          borderLeft: act ? `2px solid ${BLU}` : '2px solid transparent',
          paddingLeft: act ? '10px' : '10px',
          paddingRight: '10px',
          fontSize: '13px',
          fontWeight: act ? '600' : '400',
          marginBottom: '1px',
          boxShadow: act ? `inset 0 0 20px rgba(27,95,250,0.05)` : 'none',
        }}>
        <LucideIcon name={icon} size={14} color={act ? BLU : 'rgba(240,240,248,0.2)'}/>
        <span className="flex-1 truncate">{label}</span>
        {badge !== undefined && badge > 0 && (
          <span className="font-syne text-[8px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center" style={{background: act ? BLU+'30' : 'rgba(229,29,42,0.15)', color: act ? BLU : RED}}>{badge}</span>
        )}
        {sc && !(badge && badge > 0) && (
          <span className="opacity-0 group-hover:opacity-100 transition-opacity font-syne text-[7px] font-black flex-shrink-0" style={{color:'rgba(255,255,255,0.15)'}}>G·{sc}</span>
        )}
      </button>
    )
  }

  const navLabel = (text: string) => (
    <div className="px-2 pt-3 pb-1">
      <span className="font-syne text-[8px] font-black tracking-[0.2em]" style={{color:'rgba(255,255,255,0.12)'}}>{text}</span>
    </div>
  )

  if (data.loading) {
    return (
      <div className="flex h-screen items-center justify-center" style={{background:'#030308'}}>
        <div className="text-center">
          <div className="font-syne text-[10px] font-black tracking-[0.3em] mb-6" style={{color:'rgba(27,95,250,0.5)'}}>BRUTAL.IA</div>
          <div className="flex gap-2 justify-center">
            <div className="w-1.5 h-1.5 rounded-full animate-dot1" style={{background:BLU}}/>
            <div className="w-1.5 h-1.5 rounded-full animate-dot2" style={{background:BLU}}/>
            <div className="w-1.5 h-1.5 rounded-full animate-dot3" style={{background:BLU}}/>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-full font-figtree overflow-hidden" style={{ background:'radial-gradient(ellipse 1400px 700px at 80% -10%,rgba(27,95,250,0.055) 0%,transparent 60%),radial-gradient(ellipse 500px 400px at 5% 95%,rgba(27,95,250,0.025) 0%,transparent 55%),#030308', color:'#F0F0F8' }}
      onClick={()=>notifOpen&&setNotifOpen(false)}>

      {/* SIDEBAR */}
      <aside className="flex-shrink-0 flex flex-col overflow-hidden transition-all duration-200" style={{ width:sidebarOpen?'248px':'0', background:'rgba(8,8,18,0.95)', borderRight:`1px solid ${BORDER}` }}>
        {/* Logo */}
        <div className="px-5 pt-6 pb-5 flex-shrink-0">
          <div className="flex items-center gap-3">
            <img src="https://brutal.thehook-produccion.es/wp-content/themes/brutal-studios/assets/img/brutal-logo-white.svg" alt="Brutal Studios" className="h-5 opacity-90" />
            <div className="h-5 w-px" style={{background:BORDER}}/>
            <span className="font-syne text-[11px] font-black tracking-widest" style={{color:BLU}}>IA</span>
            <div className="ml-auto flex items-center gap-2">
              {/* Notification bell */}
              <div className="relative">
                <button onClick={e=>{e.stopPropagation();setNotifOpen(o=>!o)}} className="w-7 h-7 rounded-xl flex items-center justify-center relative transition-all" style={{background:notifOpen?'rgba(27,95,250,0.15)':'transparent'}}>
                  <LucideIcon name="bell" size={13} color={(notifData.total+overdueProjs.length)>0?BLU:'rgba(255,255,255,0.2)'}/>
                  {(notifData.total+overdueProjs.length)>0 && <div className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center pointer-events-none" style={{background:RED,boxShadow:`0 0 6px ${RED}80`}}><span className="font-syne text-[7px] font-black text-white leading-none">{(notifData.total+overdueProjs.length)>9?'9+':(notifData.total+overdueProjs.length)}</span></div>}
                </button>
                {notifOpen && (
                  <div onClick={e=>e.stopPropagation()} className="rounded-2xl overflow-hidden z-[999]" style={{position:'fixed',top:'62px',left:'12px',width:'268px',background:'#0C0C1C',border:`1px solid rgba(255,255,255,0.1)`,boxShadow:'0 24px 64px rgba(0,0,0,0.8),0 0 0 1px rgba(255,255,255,0.04)'}}>
                    {/* Header */}
                    <div className="px-4 py-3 flex items-center justify-between" style={{borderBottom:`1px solid rgba(255,255,255,0.06)`}}>
                      <div className="flex items-center gap-2">
                        <LucideIcon name="bell" size={11} color={BLU}/>
                        <span className="font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.5)'}}>NOTIFICACIONES</span>
                      </div>
                      {(notifData.total+overdueProjs.length) > 0 && <span className="font-figtree text-[11px] font-black" style={{color:RED}}>{notifData.total+overdueProjs.length}</span>}
                    </div>
                    {(notifData.total+overdueProjs.length)===0 ? (
                      <div className="px-4 py-6 text-center">
                        <div className="font-syne text-[9px] font-black tracking-widest mb-1" style={{color:'rgba(255,255,255,0.18)'}}>SIN NOTIFICACIONES</div>
                        <div className="text-[11px]" style={{color:'rgba(255,255,255,0.2)'}}>Todo está al día</div>
                      </div>
                    ) : (
                      <div className="max-h-[320px] overflow-y-auto">
                        {notifData.dms.length > 0 && (
                          <div className="px-4 pt-3 pb-1">
                            <span className="font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>MENSAJES DIRECTOS</span>
                          </div>
                        )}
                        {notifData.dms.map((dm:any,i:number)=>(
                          <button key={i} onClick={()=>{setNotifOpen(false);setSection('inbox')}} className="w-full text-left px-4 py-2.5 transition-colors" style={{borderBottom:`1px solid rgba(255,255,255,0.04)`}} onMouseEnter={e=>(e.currentTarget.style.background='rgba(27,95,250,0.06)')} onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                            <div className="flex items-center gap-2.5">
                              <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center font-syne text-[8px] font-black" style={{background:BLU+'18',color:BLU}}>{(dm.from_name||'?').slice(0,2).toUpperCase()}</div>
                              <div className="min-w-0 flex-1">
                                <div className="font-syne text-[9px] font-black truncate" style={{color:'rgba(255,255,255,0.8)'}}>{dm.from_name}</div>
                                <div className="text-[10px] truncate mt-0.5" style={{color:'rgba(255,255,255,0.3)'}}>{dm.subject}</div>
                              </div>
                              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:BLU}}/>
                            </div>
                          </button>
                        ))}
                        {notifData.urgent.length > 0 && (
                          <div className="px-4 pt-3 pb-1">
                            <span className="font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(229,29,42,0.6)'}}>TAREAS URGENTES</span>
                          </div>
                        )}
                        {notifData.urgent.map((t:any,i:number)=>(
                          <button key={i} onClick={()=>{setNotifOpen(false);setSection('tareas')}} className="w-full text-left px-4 py-2.5 transition-colors" style={{borderBottom:i<notifData.urgent.length-1?`1px solid rgba(255,255,255,0.04)`:'none'}} onMouseEnter={e=>(e.currentTarget.style.background='rgba(229,29,42,0.05)')} onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                            <div className="flex items-center gap-2.5">
                              <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center" style={{background:`${RED}18`}}>
                                <div className="w-1.5 h-1.5 rounded-full" style={{background:RED}}/>
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-[10.5px] truncate" style={{color:'rgba(255,255,255,0.75)'}}>{t.text}</div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <div className="font-syne text-[8px] font-black" style={{color:`${RED}80`}}>URGENTE</div>
                                  {t.due_date && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full" style={{background:'rgba(229,29,42,0.1)',color:RED}}>{new Date(t.due_date+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'})}</span>}
                                </div>
                              </div>
                            </div>
                          </button>
                        ))}
                        {overdueProjs.length > 0 && (
                          <div className="px-4 pt-3 pb-1">
                            <span className="font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(255,176,32,0.6)'}}>PROYECTOS ATRASADOS</span>
                          </div>
                        )}
                        {overdueProjs.slice(0,3).map((p:any,i:number)=>{
                          const daysOver = Math.round((Date.now()-new Date(p.deadline+'T23:59:59').getTime())/86400000)
                          return (
                            <button key={i} onClick={()=>{setNotifOpen(false);setSection('proyectos')}} className="w-full text-left px-4 py-2.5 transition-colors" style={{borderBottom:i<Math.min(overdueProjs.length,3)-1?`1px solid rgba(255,255,255,0.04)`:'none'}} onMouseEnter={e=>(e.currentTarget.style.background='rgba(255,176,32,0.05)')} onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                              <div className="flex items-center gap-2.5">
                                <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center" style={{background:'rgba(255,176,32,0.12)',border:'1px solid rgba(255,176,32,0.2)'}}>
                                  <div className="w-1.5 h-1.5 rounded-full" style={{background:'rgba(255,176,32,0.9)'}}/>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-[10.5px] truncate" style={{color:'rgba(255,255,255,0.75)'}}>{p.name}</div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <div className="font-syne text-[8px] font-black" style={{color:'rgba(255,176,32,0.7)'}}>ATRASADO</div>
                                    <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full" style={{background:'rgba(255,176,32,0.1)',color:'rgba(255,176,32,0.9)'}}>{daysOver}d</span>
                                  </div>
                                </div>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {(notifData.total+overdueProjs.length) > 0 && (
                      <div className="px-4 py-2.5" style={{borderTop:`1px solid rgba(255,255,255,0.06)`}}>
                        <button onClick={()=>{setNotifOpen(false);setSection('inbox')}} className="w-full text-center font-syne text-[8.5px] font-black tracking-wide transition-opacity hover:opacity-60" style={{color:BLU}}>VER TODO EL INBOX</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="w-1.5 h-1.5 rounded-full animate-glowPulse" style={{background:BLU}}/>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {navLabel('TRABAJO')}
          {navItem('hoy','Hoy','sun',urgentCount)}
          {navItem('inbox','Inbox','inbox',unreadCount)}
          {navItem('calendario','Calendario','calendar',todayCalCount||undefined)}
          {navItem('equipo','Equipo','users-2')}

          {navLabel('GESTIÓN')}
          {navItem('tareas','Tareas','check-square',data.tasks.filter((t:Task)=>!t.done&&t.level==='urgent').length||undefined)}
          {navItem('clientes','Clientes','users')}
          {navItem('proyectos','Proyectos','folder-open', data.projects.filter((p: Project)=>p.deadline&&p.deadline!=='TBD'&&p.status!=='completado'&&new Date(p.deadline+'T23:59:59')<new Date()).length||undefined)}
          {navItem('contenido','Contenido','film')}
          {navItem('automatizaciones','Automatizaciones','zap')}

          {navLabel('ANÁLISIS')}
          {navItem('memoria','Memoria','database')}
          {navItem('reportes','Reportes','printer')}

          {navLabel('IA')}
          {navItem('chat','Brutal.IA','message-square')}
          {navItem('ajustes','Ajustes','settings')}
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
          {section === 'hoy' && <HoySection profile={profile} data={data} urgentCount={urgentCount} unreadCount={unreadCount} onOpenModal={setModal} showToast={showToast} isOwner={profile.role==='owner'} onNavigate={setSection} />}
          {section === 'inbox' && <InboxSection data={data} showToast={showToast} profile={profile} onNavigate={setSection} onSelectClient={setSelectedClient} />}
          {section === 'tareas' && <TareasSection data={data} onOpenModal={setModal} showToast={showToast} isOwner={profile.role==='owner'} onNavigate={setSection} onSelectProject={setSelectedProject} onSelectClient={setSelectedClient} />}
          {section === 'equipo' && <EquipoSection data={data} profile={profile} showToast={showToast} />}
          {section === 'reportes' && <ReportesSection data={data} onNavigate={setSection} />}
          {section === 'clientes' && <ClientesSection data={data} selectedId={selectedClient} onSelect={setSelectedClient} onOpenModal={setModal} onSetMf={setMf} showToast={showToast} isOwner={profile.role==='owner'} onNavigate={setSection} onSelectProject={setSelectedProject} />}
          {section === 'proyectos' && <ProyectosSection data={data} filteredProjects={filteredProjects} kanbanCols={kanbanCols} projView={projView} setProjView={setProjView} projStatusFilter={projStatusFilter} setProjStatusFilter={setProjStatusFilter} dragRef={dragRef} selectedId={selectedProject} onSelect={setSelectedProject} onOpenModal={setModal} onSetMf={setMf} showToast={showToast} isOwner={profile.role==='owner'} onNavigate={setSection} onSelectClient={setSelectedClient} />}
          {section === 'contenido' && <ContenidoSection data={data} onOpenModal={setModal} showToast={showToast} onNavigate={setSection} onSelectClient={setSelectedClient} />}
          {section === 'calendario' && <CalendarioSection data={data} profile={profile} showToast={showToast} onOpenModal={setModal} onSetMf={setMf} />}
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
              <input ref={searchRef} autoFocus value={searchQuery} onChange={e=>{setSearchQuery(e.target.value);setSearchIdx(-1)}} onKeyDown={handleSearchKey} placeholder="Busca clientes, proyectos, tareas, contenido…" className="flex-1 text-sm bg-transparent text-white placeholder-white/20 outline-none" style={{ caretColor:BLU }} />
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
              {searchQuery.length === 0 && (
                <div className="px-4 py-4">
                  <div className="font-syne text-[8px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.1)'}}>ATAJOS DE SECCIÓN · G + …</div>
                  <div className="flex flex-wrap gap-1.5">
                    {([['H','HOY'],['T','TAREAS'],['I','INBOX'],['C','CLIENTES'],['P','PROYECTOS'],['K','CONTENIDO'],['A','CALENDARIO'],['M','MEMORIA'],['E','EQUIPO'],['R','REPORTES'],['V','AUTOM.'],['N','CHAT'],['S','AJUSTES']] as [string,string][]).map(([k,l])=>(
                      <div key={k} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl" style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)'}}>
                        <kbd className="font-syne text-[9px] font-black" style={{color:BLU}}>G·{k}</kbd>
                        <span className="font-syne text-[8px] font-black tracking-wide" style={{color:'rgba(255,255,255,0.18)'}}>{l}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-2.5 border-t border-white/5 text-[10px] text-white/20">↑↓ navegar · Enter seleccionar · Esc cerrar</div>
          </div>
        </div>
      )}

      {/* MODAL */}
      {modal && (
        <div onClick={()=>setModal(null)} className="fixed inset-0 z-[100] flex items-center justify-center" style={{background:'rgba(2,2,10,0.8)',backdropFilter:'blur(8px)'}}>
          <div onClick={e=>e.stopPropagation()} onKeyDown={(e)=>{if(e.key==='Enter'&&(e.target as HTMLElement).tagName!=='TEXTAREA'&&!modalSaving){e.preventDefault();saveModal()}}} className="relative w-[480px] max-w-[94vw] rounded-3xl overflow-hidden" style={{background:'linear-gradient(180deg,#0D0D1E 0%,#080810 100%)',border:`1px solid rgba(27,95,250,0.25)`,boxShadow:'0 40px 100px rgba(0,0,0,0.8),0 0 0 1px rgba(27,95,250,0.05)'}}>
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
                  ) : f.type === 'status' ? (
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        {v:'borrador',l:'En bruto',c:'rgba(255,255,255,0.45)'},
                        {v:'pendiente',l:'En producción',c:'rgba(255,176,32,0.9)'},
                        {v:'listo',l:'Listo',c:'#22c55e'},
                        {v:'publicado',l:'Publicado',c:BLU},
                      ].map(s=>(
                        <button key={s.v} onClick={()=>setMf(m=>({...m,[f.key]:s.v}))}
                          className="flex items-center gap-2.5 px-4 py-3 rounded-2xl font-syne text-[10px] font-black tracking-wide transition-all"
                          style={{background:(mf[f.key]||'borrador')===s.v?s.c+'18':SURF2,border:`1.5px solid ${(mf[f.key]||'borrador')===s.v?s.c+'60':BORDER}`,color:(mf[f.key]||'borrador')===s.v?s.c:'rgba(255,255,255,0.3)'}}>
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:(mf[f.key]||'borrador')===s.v?s.c:'rgba(255,255,255,0.15)'}}/>
                          <span>{s.l.toUpperCase()}</span>
                        </button>
                      ))}
                    </div>
                  ) : f.type === 'platform' ? (
                    <div className="flex gap-1.5 flex-wrap">
                      {(['Instagram','TikTok','YouTube','LinkedIn','Twitter','Pinterest'] as const).map(p=>{
                        const platC: Record<string,string> = {TikTok:'#ff0050',Instagram:'#C13584',LinkedIn:'#0A66C2',YouTube:'#FF0000',Twitter:'#1DA1F2',Pinterest:'#E60023'}
                        const pc = platC[p]
                        const isActive = (mf[f.key]||'Instagram') === p
                        return (
                          <button key={p} onClick={()=>setMf(m=>({...m,[f.key]:p}))} className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl font-syne text-[9px] font-black tracking-wide transition-all" style={{background:isActive?pc+'18':SURF2,border:`1.5px solid ${isActive?pc+'50':BORDER}`,color:isActive?pc:'rgba(255,255,255,0.3)'}}>
                            <PlatformLogo platform={p} size={14}/>
                            {p}
                          </button>
                        )
                      })}
                    </div>
                  ) : f.type === 'category' ? (
                    <div className="flex flex-wrap gap-2">
                      {(['Clientes','Procesos','Decisiones','Aprendizajes','General'] as const).map(cat=>{
                        const catC: Record<string,string> = {Clientes:BLU,Procesos:'rgba(255,176,32,0.9)',Decisiones:'rgba(229,29,42,0.9)',Aprendizajes:'rgba(34,197,94,0.9)',General:'rgba(167,139,250,0.8)'}
                        const isActive = (mf[f.key]||'General')===cat
                        const cc = catC[cat]
                        return (
                          <button key={cat} onClick={()=>setMf(m=>({...m,[f.key]:cat}))} className="flex items-center gap-2 px-4 py-2.5 rounded-2xl font-syne text-[10px] font-black tracking-wide transition-all" style={{background:isActive?cc+'18':SURF2,border:`1.5px solid ${isActive?cc+'55':BORDER}`,color:isActive?cc:'rgba(255,255,255,0.35)'}}>
                            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:isActive?cc:'rgba(255,255,255,0.15)'}}/>
                            {cat}
                          </button>
                        )
                      })}
                    </div>
                  ) : f.type === 'proj-status' ? (
                    <div className="flex gap-2">
                      {[
                        {v:'plan.',l:'Plan.',c:'rgba(167,139,250,0.85)'},
                        {v:'activo',l:'Activo',c:BLU},
                        {v:'urgente',l:'Urgente',c:RED},
                        {v:'revisión',l:'Revisión',c:'rgba(255,176,32,0.9)'},
                      ].map(s=>(
                        <button key={s.v} onClick={()=>setMf(m=>({...m,[f.key]:s.v}))} className="flex-1 py-3 rounded-2xl font-syne text-[9px] font-black tracking-wide transition-all" style={{background:(mf[f.key]||'activo')===s.v?s.c+'18':SURF2,border:`1.5px solid ${(mf[f.key]||'activo')===s.v?s.c+'60':BORDER}`,color:(mf[f.key]||'activo')===s.v?s.c:'rgba(255,255,255,0.3)'}}>
                          {s.l.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  ) : f.type === 'date-input' ? (
                    <input type="date" value={mf[f.key]||''} onChange={e=>setMf(m=>({...m,[f.key]:e.target.value}))} className="w-full px-5 py-3.5 rounded-2xl text-[14px] text-white outline-none transition-all" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU,colorScheme:'dark'}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.45)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
                  ) : f.type === 'textarea' ? (
                    <textarea value={mf[f.key]||''} onChange={e=>setMf(m=>({...m,[f.key]:e.target.value}))} placeholder={f.placeholder} rows={4} className="w-full px-5 py-3.5 rounded-2xl text-[14px] text-white placeholder-white/20 outline-none resize-none transition-all" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU,lineHeight:'1.6'}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.45)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
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
      {toast && (() => {
        const isErr = /^error/i.test(toast)||toast.toLowerCase().includes(' error')
        const isOk = /^✓|creado|guardado|actualizado|eliminado|leído|enviado|añadid|salvo|pieza/i.test(toast)&&!isErr
        const tc = isErr ? RED : isOk ? GRN : BLU
        return (
          <div className="fixed bottom-6 left-1/2 z-[90] flex items-center gap-3 px-5 py-3 rounded-xl animate-riseT" style={{ transform:'translateX(-50%)', background:'#14142A', border:`1px solid ${tc}35`, boxShadow:`0 16px 44px rgba(0,0,0,0.55),0 0 0 1px ${tc}10` }}>
            <div className="w-1.5 h-1.5 rounded-full animate-pls" style={{ background:tc }} />
            <span className="text-sm" style={{color:'rgba(255,255,255,0.88)'}}>{toast}</span>
          </div>
        )
      })()}

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
      { label:'Estado inicial', key:'estado', type:'proj-status', placeholder:'' },
      { label:'Deadline', key:'deadline', type:'date-input', placeholder:'' },
    ],
    tarea: [
      f('Descripción de la tarea','text','Ej: Preparar deck propuesta Q3 para Nike'),
      { label:'Prioridad', key:'priority', type:'priority' },
      { label:'Asignar a', key:'asignado', type:'assignee' },
      f('Cliente (opcional)','cliente','Ej: Nike España'),
      f('Proyecto (opcional)','proyecto','Ej: Campaign Summer 2026'),
      { label:'Fecha límite', key:'due_date', type:'date-input', placeholder:'' },
    ],
    memoria: [
      f('Título','titulo','Ej: Nike — Guía de tono de voz 2026'),
      { label:'Categoría', key:'categoria', type:'category', placeholder:'' },
      { label:'Contenido', key:'contenido', type:'textarea', placeholder:'Escribe el contenido de esta entrada…' },
    ],
    regla: [
      f('Nombre de la regla','nombre','Ej: Alerta propuestas sin respuesta'),
      f('Condición','condicion','Ej: Email urgente de cliente sin tarea'),
      f('Acción automática','accion','Ej: Crear tarea de seguimiento urgente'),
    ],
    contenido: [
      f('Título de la pieza','titulo','Ej: Stories lanzamiento verano Nike'),
      f('Cliente','cliente','Ej: Nike España'),
      { label:'Plataforma', key:'plataforma', type:'platform' },
      f('Cuenta / Perfil','cuenta','Ej: Brutal Studios, Pablo, Julio Flores'),
      { label:'Fecha de publicación', key:'fecha', type:'date-input', placeholder:'' },
      { label:'Estado', key:'estado', type:'status' },
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
    link:'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
    copy:'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
    'sparkles':'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z',
    pencil:'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
    'building-2':'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18M2 22h20M14 12h2M14 6h2M8 12h2M8 6h2M6 22h12',
    brain:'M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.04-4.54A3 3 0 0 1 2 12a3 3 0 0 1 3-3A2.5 2.5 0 0 1 9.5 2zM14.5 2A2.5 2.5 0 0 1 19 9a3 3 0 0 1 3 3 3 3 0 0 1-3.5 2.96A2.5 2.5 0 0 1 12 19.5v-15A2.5 2.5 0 0 1 14.5 2z',
    lightbulb:'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4',
    paperclip:'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
    flag:'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
    layers:'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    target:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-6a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0-2a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
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
function TareasSection({data,onOpenModal,showToast,isOwner,onNavigate,onSelectProject,onSelectClient}: any) {
  const [filter, setFilter] = useState<'todas'|'urgente'|'high'|'normal'|'hecho'|'hoy'|'semana'|'sin_fecha'>('todas')
  const [assigneeFilter, setAssigneeFilter] = useState('Todos')
  const [taskSort, setTaskSort] = useState<'prioridad'|'fecha'>('prioridad')
  const [taskGroup, setTaskGroup] = useState<'none'|'proyecto'|'prioridad'>('none')
  const [activeTask, setActiveTask] = useState<Task|null>(null)
  const [editing, setEditing] = useState<Partial<Task>>({})
  const [saving, setSaving] = useState(false)
  const [confirmDeleteTask, setConfirmDeleteTask] = useState(false)
  const [confirmLimpiar, setConfirmLimpiar] = useState(false)
  const filteredTasksRef = useRef<Task[]>([])

  useEffect(()=>{
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeTask) { setActiveTask(null); return }
      if ((e.key === 'j' || e.key === 'k') && activeTask && !['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault()
        const tasks = filteredTasksRef.current
        const idx = tasks.findIndex(t=>t.id===activeTask.id)
        const next = e.key==='j' ? Math.min(idx+1, tasks.length-1) : Math.max(idx-1, 0)
        const t = tasks[next]
        if (t) { setActiveTask(t); setEditing({ text:t.text, level:t.level, assigned_to:t.assigned_to, done:t.done, due_date:t.due_date, project_id:t.project_id }); setConfirmDeleteTask(false) }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeTask])

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

  const levelPriority = (l: string) => l==='urgent'?0:l==='high'?1:2
  const weekEnd = new Date(Date.now() + 7*24*60*60*1000)
  const filtered = data.tasks.filter((t: Task) => {
    const todayKey = new Date().toISOString().split('T')[0]
    const byStatus = filter === 'todas' ? !t.done : filter === 'hecho' ? t.done : filter === 'hoy' ? (!t.done && !!t.due_date && new Date(t.due_date+'T23:59:59') <= new Date(todayKey+'T23:59:59')) : filter === 'semana' ? (!t.done && !!t.due_date && new Date(t.due_date+'T23:59:59') <= weekEnd) : filter === 'sin_fecha' ? (!t.done && !t.due_date) : (!t.done && t.level === filter)
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
    hoy: data.tasks.filter((t: Task)=>!t.done&&!!t.due_date&&new Date(t.due_date+'T23:59:59')<=new Date(todayFilterKey+'T23:59:59')).length,
    semana: data.tasks.filter((t: Task)=>!t.done&&!!t.due_date&&new Date(t.due_date+'T23:59:59')<=weekEnd).length,
    sin_fecha: data.tasks.filter((t: Task)=>!t.done&&!t.due_date).length,
  }
  const tabs: {id: 'todas'|'urgente'|'high'|'normal'|'hecho'|'hoy'|'semana'|'sin_fecha', label: string, color?: string}[] = [
    {id:'todas', label:'Todas'},
    {id:'urgente', label:'Urgente', color:RED},
    {id:'high', label:'Alta', color:'rgba(255,176,32,0.8)'},
    {id:'normal', label:'Normal', color:BLU},
    {id:'hoy', label:'Hoy', color:'rgba(229,29,42,0.85)'},
    {id:'semana', label:'Esta sem.', color:'rgba(167,139,250,0.85)'},
    {id:'sin_fecha', label:'Sin fecha', color:'rgba(255,255,255,0.3)'},
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
            <div className="flex items-center gap-2">
              <div className="flex p-1 rounded-xl" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
                {([{id:'prioridad',icon:'arrow-up-narrow-wide'},{id:'fecha',icon:'calendar-clock'}] as const).map(s=>(
                  <button key={s.id} onClick={()=>setTaskSort(s.id)} title={s.id==='prioridad'?'Ordenar por prioridad':'Ordenar por fecha límite'} className="px-2.5 py-2 rounded-lg transition-all" style={{background:taskSort===s.id?SURF2:'transparent'}}>
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
            <div className="flex gap-1 p-1 rounded-2xl" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
              {tabs.map(t=>(
                <button key={t.id} onClick={()=>setFilter(t.id)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-syne text-[9px] font-black tracking-wide transition-all" style={{background:filter===t.id?t.color||SURF2:'transparent',color:filter===t.id?'white':t.color||'rgba(255,255,255,0.28)'}}>
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
                    <button onClick={async()=>{await Promise.all(filtered.map((t: Task)=>data.deleteTask(t.id)));showToast('Tareas eliminadas');setConfirmLimpiar(false)}} className="font-syne text-[8px] font-black px-3 py-1.5 rounded-xl transition-all" style={{background:'rgba(229,29,42,0.12)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR {filtered.length}?</button>
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
                  <button onClick={e=>{e.stopPropagation();data.toggleTask(t.id)}} className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-1 transition-all" style={{background:t.done?pc:'transparent',border:`2px solid ${t.done?pc:pc+'60'}`}}>
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
                      <div key={k} className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
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
                {key:'urgent' as const,label:'URGENTE',color:RED},
                {key:'high' as const,label:'ALTA',color:'rgba(255,176,32,0.85)'},
                {key:'normal' as const,label:'NORMAL',color:BLU},
              ]
              if (filtered.length === 0) return <div className="rounded-2xl py-16 text-center text-[13px]" style={{background:SURFACE,border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.18)'}}>Sin tareas en este filtro</div>
              return (
                <div className="space-y-3">
                  {prioGroups.map(g => {
                    const gTasks = filtered.filter((t: Task)=>t.level===g.key)
                    if (!gTasks.length) return null
                    return (
                      <div key={g.key} className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
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
                      <button onClick={async()=>{await data.deleteTask(activeTask.id);setActiveTask(null);showToast('Tarea eliminada')}} className="px-3 py-2 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all" style={{background:'rgba(229,29,42,0.15)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR?</button>
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
              <label className="block font-syne text-[9px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.25)'}}>FECHA LÍMITE</label>
              <input type="date" value={editing.due_date||''} onChange={e=>setEditing(x=>({...x,due_date:e.target.value||undefined}))} className="w-full px-5 py-3 rounded-2xl text-[13px] text-white outline-none transition-all" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU,colorScheme:'dark'}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.4)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
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
                const pdl = proj.deadline && proj.deadline!=='TBD' ? new Date(proj.deadline+'T23:59:59') : null
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
            <div className="flex items-center justify-center gap-4 pt-2">
              <span className="font-syne text-[7.5px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.1)'}}>⌘+ENTER GUARDAR</span>
              <span className="font-syne text-[7px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.07)'}}>·</span>
              <span className="font-syne text-[7.5px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.1)'}}>J ↓  K ↑ NAVEGAR</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── EQUIPO SECTION ────────────────────────────────────────────
function EquipoSection({data, profile, showToast}: any) {
  const [selected, setSelected] = useState<Profile|null>(null)
  const [thread, setThread] = useState<any[]>([])
  const [loadingThread, setLoadingThread] = useState(false)
  const [msgBody, setMsgBody] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(()=>{
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && selected) setSelected(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selected])

  const allActive: Profile[] = data.team.some((m: Profile) => m.id === profile?.id)
    ? data.team
    : (profile ? [profile, ...data.team] : data.team)

  const PENDING = [
    { name: 'Javi', role: 'Propietario', initials: 'JV', avatar_color: BLU, email: 'javivalero2002@gmail.com' },
    { name: 'Fer', role: 'Becario', initials: 'FE', avatar_color: '#F97316', email: 'pendiente de registro' },
  ].filter(p => !allActive.some((m: Profile) =>
    m.name.toLowerCase().includes(p.name.toLowerCase()) ||
    (p.email !== 'pendiente de registro' && m.email?.toLowerCase() === p.email.toLowerCase())
  ))

  const openThread = async (member: Profile) => {
    if (member.id === profile?.id) return
    setSelected(member)
    setLoadingThread(true)
    try {
      const msgs = await fetch(`/api/inbox/thread?withUserId=${member.id}&withName=${encodeURIComponent(member.name)}`).then(r=>r.json())
      setThread(Array.isArray(msgs) ? msgs : [])
    } catch { setThread([]) }
    finally { setLoadingThread(false) }
  }

  const sendMessage = async () => {
    if (!selected || !msgBody.trim()) return
    setSending(true)
    try {
      await data.sendInternalMessage(selected.id, 'Mensaje directo', msgBody, profile?.name||'Equipo')
      const optimistic = {id:Date.now()+'',_dir:'sent',subject:'Mensaje directo',body_preview:msgBody,received_at:new Date().toISOString(),from_name:profile?.name}
      setThread(prev=>[...prev, optimistic])
      setMsgBody('')
      showToast(`Enviado a ${selected.name.split(' ')[0]}`)
    } catch { showToast('Error enviando') }
    finally { setSending(false) }
  }

  const isMe = (m: Profile) => m.id === profile?.id

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: team list */}
      <div className="flex flex-col overflow-hidden" style={{width:'360px',flexShrink:0,borderRight:`1px solid ${BORDER}`}}>
        <div className="px-6 pt-6 pb-4 flex-shrink-0" style={{borderBottom:`1px solid ${BORDER}`}}>
          <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-1" style={{color:'rgba(255,255,255,0.18)'}}>BRUTAL STUDIOS</div>
          <h1 className="font-figtree text-[22px] font-black text-white leading-none mb-3" style={{letterSpacing:'-0.03em'}}>Equipo</h1>
          {(()=>{
            const teamPending = data.tasks.filter((t: Task)=>!t.done&&!!t.assignee).length
            const teamOverdue = data.tasks.filter((t: Task)=>!t.done&&!!t.assignee&&!!t.due_date&&new Date(t.due_date+'T23:59:59')<new Date()).length
            const teamUrgent = data.tasks.filter((t: Task)=>!t.done&&!!t.assignee&&t.level==='urgent').length
            const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate()-7); weekAgo.setHours(0,0,0,0)
            const teamCompletedWeek = data.tasks.filter((t: Task)=>t.done&&!!t.assignee&&new Date(t.updated_at||t.created_at)>=weekAgo).length
            if (teamPending === 0 && teamCompletedWeek === 0) return null
            return (
              <div className="flex items-center gap-3">
                {teamPending > 0 && <div className="text-center">
                  <div className="font-figtree text-[22px] font-black leading-none" style={{color:'rgba(255,255,255,0.75)',letterSpacing:'-0.03em'}}>{teamPending}</div>
                  <div className="font-syne text-[7px] font-black tracking-widest mt-0.5" style={{color:'rgba(255,255,255,0.2)'}}>PENDIENTES</div>
                </div>}
                {teamUrgent > 0 && (
                  <div className="text-center">
                    <div className="font-figtree text-[22px] font-black leading-none" style={{color:RED,letterSpacing:'-0.03em'}}>{teamUrgent}</div>
                    <div className="font-syne text-[7px] font-black tracking-widest mt-0.5" style={{color:'rgba(255,255,255,0.2)'}}>URGENTES</div>
                  </div>
                )}
                {teamOverdue > 0 && (
                  <div className="text-center">
                    <div className="font-figtree text-[22px] font-black leading-none" style={{color:'rgba(255,176,32,0.9)',letterSpacing:'-0.03em'}}>{teamOverdue}</div>
                    <div className="font-syne text-[7px] font-black tracking-widest mt-0.5" style={{color:'rgba(255,255,255,0.2)'}}>ATRASADAS</div>
                  </div>
                )}
                {teamCompletedWeek > 0 && (
                  <div className="text-center">
                    <div className="font-figtree text-[22px] font-black leading-none" style={{color:GRN,letterSpacing:'-0.03em'}}>{teamCompletedWeek}</div>
                    <div className="font-syne text-[7px] font-black tracking-widest mt-0.5" style={{color:'rgba(255,255,255,0.2)'}}>ESTA SEMANA</div>
                  </div>
                )}
              </div>
            )
          })()}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {allActive.map((member: Profile) => {
            const memberTasks = data.tasks.filter((t: Task) => t.assignee?.name === member.name)
            const pending = memberTasks.filter((t: Task) => !t.done)
            const done = memberTasks.filter((t: Task) => t.done)
            const completePct = memberTasks.length > 0 ? Math.round((done.length/memberTasks.length)*100) : 0
            const urgent = pending.filter((t: Task) => t.level === 'urgent')
            const high = pending.filter((t: Task) => t.level === 'high')
            const mOverdue = pending.filter((t: Task) => t.due_date && new Date(t.due_date+'T23:59:59') < new Date())
            const mDueToday = pending.filter((t: Task) => t.due_date && t.due_date.slice(0,10) === new Date().toISOString().slice(0,10))
            const workload = urgent.length*3 + high.length*2 + (pending.length-urgent.length-high.length)
            const sel = selected?.id === member.id
            return (
              <button key={member.id} onClick={()=>openThread(member)}
                className="w-full text-left rounded-2xl p-4 transition-all duration-150"
                style={{background:sel?`linear-gradient(135deg,${member.avatar_color}0F,rgba(255,255,255,0.02))`:'rgba(255,255,255,0.02)',border:`1px solid ${sel?member.avatar_color+'30':BORDER}`,cursor:isMe(member)?'default':'pointer'}}>
                <div className="flex items-center gap-3">
                  <div className="relative flex-shrink-0">
                    <ProgressRing pct={completePct} size={44} stroke={2.5} color={member.avatar_color}/>
                    <div className="absolute inset-0 flex items-center justify-center font-syne text-[10px] font-black" style={{color:member.avatar_color}}>{member.initials}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-figtree text-[14px] font-semibold text-white truncate">{member.name}</span>
                      {isMe(member) && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:'rgba(27,95,250,0.1)',color:BLU}}>TÚ</span>}
                      {urgent.length > 0 && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:'rgba(229,29,42,0.1)',color:RED}}>{urgent.length} URG</span>}
                    </div>
                    <div className="text-[11px] mt-0.5 truncate" style={{color:'rgba(255,255,255,0.3)'}}>{member.role==='owner'?'Propietario':'Equipo'} · {pending.length} tareas{mOverdue.length>0?<span style={{color:RED+'aa'}}> · {mOverdue.length} atrasada{mOverdue.length>1?'s':''}</span>:null}{mDueToday.length>0&&mOverdue.length===0?<span style={{color:'rgba(255,176,32,0.75)'}}> · {mDueToday.length} hoy</span>:null}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    {!isMe(member) && <LucideIcon name="message-square" size={13} color={sel?member.avatar_color:'rgba(255,255,255,0.15)'}/>}
                    {workload > 0 && (
                      <div className="flex items-center gap-1" title={`Carga: ${workload} (urgentes×3 + altas×2 + normales×1)`}>
                        <div className="font-figtree text-[11px] font-black leading-none" style={{color:workload>8?RED:workload>4?'rgba(255,176,32,0.85)':'rgba(255,255,255,0.3)'}}>{workload}</div>
                        <div className="font-syne text-[6.5px] font-black tracking-wide" style={{color:'rgba(255,255,255,0.15)'}}>CARGA</div>
                      </div>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
          {PENDING.length > 0 && (
            <div className="pt-3">
              <div className="font-syne text-[8px] font-black tracking-widest px-2 pb-2" style={{color:'rgba(255,255,255,0.15)'}}>PENDIENTES</div>
              {PENDING.map((p,i)=>(
                <div key={i} className="rounded-2xl p-4 opacity-50" style={{background:'rgba(255,255,255,0.015)',border:`1px dashed ${BORDER}`}}>
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full flex items-center justify-center font-syne text-[11px] font-black flex-shrink-0" style={{background:p.avatar_color+'18',border:`1.5px dashed ${p.avatar_color}40`,color:p.avatar_color}}>{p.initials}</div>
                    <div>
                      <div className="font-figtree text-[14px] font-semibold text-white flex items-center gap-2">{p.name}<span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full" style={{background:'rgba(255,176,32,0.1)',color:'rgba(255,176,32,0.6)'}}>SIN CUENTA</span></div>
                      <div className="text-[10px]" style={{color:'rgba(255,255,255,0.2)'}}>{p.role}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: DM panel */}
      {selected ? (
        <div className="flex-1 flex flex-col overflow-hidden" style={{background:'#050510'}}>
          {/* Header */}
          <div className="flex items-center gap-4 px-6 py-5 flex-shrink-0" style={{borderBottom:`1px solid ${BORDER}`,background:`linear-gradient(135deg,${selected.avatar_color}0C,transparent)`}}>
            <div className="relative flex-shrink-0">
              <ProgressRing pct={Math.round((data.tasks.filter((t:Task)=>t.assignee?.name===selected.name&&t.done).length/Math.max(1,data.tasks.filter((t:Task)=>t.assignee?.name===selected.name).length))*100)} size={40} stroke={2} color={selected.avatar_color}/>
              <div className="absolute inset-0 flex items-center justify-center font-syne text-[9px] font-black" style={{color:selected.avatar_color}}>{selected.initials}</div>
            </div>
            <div className="flex-1">
              <div className="font-figtree text-[17px] font-semibold text-white">{selected.name}</div>
              <div className="text-[11px]" style={{color:'rgba(255,255,255,0.3)'}}>{selected.email} · {selected.role==='owner'?'Propietario':'Equipo'}</div>
            </div>
            <div className="flex items-center gap-3">
              {/* Task stats */}
              {(() => {
                const mt = data.tasks.filter((t:Task)=>t.assignee?.name===selected.name)
                const pend = mt.filter((t:Task)=>!t.done)
                const urg = pend.filter((t:Task)=>t.level==='urgent')
                return (
                  <div className="flex gap-3">
                    {urg.length>0 && <div className="text-center"><div className="font-figtree text-[18px] font-black" style={{color:RED}}>{urg.length}</div><div className="font-syne text-[7.5px]" style={{color:'rgba(255,255,255,0.25)'}}>URG</div></div>}
                    <div className="text-center"><div className="font-figtree text-[18px] font-black" style={{color:BLU}}>{pend.length}</div><div className="font-syne text-[7.5px]" style={{color:'rgba(255,255,255,0.25)'}}>PENDIENTES</div></div>
                  </div>
                )
              })()}
              <button onClick={()=>{setSelected(null);setThread([])}} className="w-8 h-8 rounded-xl flex items-center justify-center" style={{background:'rgba(255,255,255,0.05)'}}><LucideIcon name="x" size={13} color="rgba(240,240,248,0.4)"/></button>
            </div>
          </div>

          {/* Tasks list */}
          <div className="flex-shrink-0 px-6 py-4 flex-shrink-0" style={{borderBottom:`1px solid ${BORDER}`}}>
            <div className="font-syne text-[8.5px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.2)'}}>TAREAS ASIGNADAS</div>
            <div className="flex gap-2 flex-wrap">
              {data.tasks.filter((t:Task)=>t.assignee?.name===selected.name&&!t.done).slice(0,4).map((t:Task)=>(
                <div key={t.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl" style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${t.level==='urgent'?RED+'25':t.level==='high'?'rgba(255,176,32,0.15)':BORDER}`}}>
                  <div className="w-1 h-1 rounded-full flex-shrink-0" style={{background:t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.8)':BLU}}/>
                  <span className="text-[11px] truncate max-w-[180px]" style={{color:'rgba(255,255,255,0.5)'}}>{t.text}</span>
                  {t.due_date && (()=>{
                    const todayStr = new Date().toISOString().split('T')[0]
                    const isToday = t.due_date.slice(0,10)===todayStr
                    const over = !isToday && new Date(t.due_date+'T23:59:59')<new Date()
                    return <span className="font-syne text-[7px] font-black px-1 py-0.5 rounded flex-shrink-0" style={{background:isToday?'rgba(255,176,32,0.15)':over?`${RED}15`:'rgba(255,255,255,0.04)',color:isToday?'rgba(255,176,32,0.9)':over?RED:'rgba(255,255,255,0.2)'}}>{isToday?'HOY':new Date(t.due_date+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'})}</span>
                  })()}
                </div>
              ))}
              {data.tasks.filter((t:Task)=>t.assignee?.name===selected.name&&!t.done).length===0 && (
                <span className="text-[11px]" style={{color:'rgba(255,255,255,0.2)'}}>Sin tareas pendientes</span>
              )}
            </div>
          </div>

          {/* Thread */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            <div className="font-syne text-[8.5px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.18)'}}>CONVERSACIÓN</div>
            {loadingThread && <div className="text-center py-8 text-[12px]" style={{color:'rgba(255,255,255,0.2)'}}>Cargando mensajes…</div>}
            {!loadingThread && thread.length===0 && (
              <div className="flex flex-col items-center py-12 text-center">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center mb-3" style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`}}><LucideIcon name="message-square" size={16} color="rgba(255,255,255,0.2)"/></div>
                <div className="text-[13px] text-white mb-1">Sin mensajes aún</div>
                <div className="text-[11px]" style={{color:'rgba(255,255,255,0.25)'}}>Empieza la conversación abajo</div>
              </div>
            )}
            {thread.map((msg: any) => {
              const isSent = msg._dir === 'sent'
              return (
                <div key={msg.id} className={`flex ${isSent?'justify-end':'justify-start'}`}>
                  <div className="max-w-[75%]">
                    <div className="px-4 py-3 rounded-2xl" style={{background:isSent?`linear-gradient(135deg,${BLU},#1440CC)`:'rgba(255,255,255,0.06)',borderBottomRightRadius:isSent?'4px':'16px',borderBottomLeftRadius:isSent?'16px':'4px'}}>
                      <p className="text-[13px] leading-relaxed" style={{color:isSent?'white':'rgba(255,255,255,0.8)'}}>{msg.body_preview}</p>
                    </div>
                    <div className={`text-[10px] mt-1 px-1 ${isSent?'text-right':''}`} style={{color:'rgba(255,255,255,0.2)'}}>
                      {relTime(msg.received_at)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Compose */}
          <div className="flex-shrink-0 p-4" style={{borderTop:`1px solid ${BORDER}`}}>
            <div className="flex gap-2 items-end">
              <textarea
                value={msgBody}
                onChange={e=>setMsgBody(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){sendMessage()}}}
                placeholder={`Mensaje a ${selected.name.split(' ')[0]}…`}
                rows={1}
                className="flex-1 px-4 py-3 rounded-2xl text-[13px] text-white outline-none resize-none"
                style={{background:'rgba(255,255,255,0.05)',border:`1.5px solid ${BORDER}`,caretColor:BLU,maxHeight:'120px',lineHeight:'1.5'}}
                onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.35)')}
                onBlur={e=>(e.target.style.borderColor=BORDER)}
              />
              <button onClick={sendMessage} disabled={sending||!msgBody.trim()}
                className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 disabled:opacity-30 transition-all"
                style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
                <LucideIcon name="send" size={14} color="white"/>
              </button>
            </div>
            <div className="text-center text-[9px] mt-2" style={{color:'rgba(255,255,255,0.15)'}}>⌘↵ para enviar</div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center" style={{background:'#050510'}}>
          <div className="text-center">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${BORDER}`}}><LucideIcon name="message-square" size={22} color="rgba(255,255,255,0.15)"/></div>
            <div className="font-figtree text-[16px] font-semibold text-white mb-1">Selecciona un compañero</div>
            <div className="text-[12px]" style={{color:'rgba(255,255,255,0.3)'}}>Haz clic en su nombre para ver la conversación</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── REPORTES SECTION ─────────────────────────────────────────
function ReportesSection({data, onNavigate}: any) {
  const tasks: Task[] = data.tasks
  const projects: Project[] = data.projects
  const clients: Client[] = data.clients
  const inbox: any[] = data.inbox
  const agendaItems: any[] = data.agenda || []

  const totalTasks = tasks.length
  const doneTasks = tasks.filter(t=>t.done).length
  const pendingTasks = tasks.filter(t=>!t.done).length
  const urgentTasks = tasks.filter(t=>!t.done&&t.level==='urgent').length
  const completionRate = totalTasks > 0 ? Math.round((doneTasks/totalTasks)*100) : 0

  const activeClients = clients.filter(c=>c.status==='Activo')
  const parseMRR = (s: string) => { if(!s||s==='—')return 0; return parseFloat(s.replace(/[€$£\s]/g,'').replace(/\./g,'').replace(',','.').replace(/\/.*$/,''))||0 }
  const totalMRR = activeClients.reduce((sum: number,c: Client)=>sum+parseMRR(c.revenue||''),0)
  const overdueProjects = projects.filter(p=>p.deadline&&p.deadline!=='TBD'&&p.status!=='completado'&&new Date(p.deadline+'T23:59:59')<new Date())
  const projectsByStatus = [
    {label:'En progreso', count:projects.filter(p=>p.status==='activo').length, color:BLU},
    {label:'Urgente', count:projects.filter(p=>p.status==='urgente').length, color:RED},
    {label:'Revisión', count:projects.filter(p=>p.status==='revisión').length, color:'rgba(255,176,32,0.8)'},
    {label:'Planificación', count:projects.filter(p=>p.status==='plan.').length, color:'rgba(255,255,255,0.3)'},
    {label:'Completado', count:projects.filter(p=>p.status==='completado').length, color:'rgba(34,197,94,0.5)'},
    {label:'Atrasados', count:overdueProjects.length, color:overdueProjects.length>0?RED:'rgba(255,255,255,0.15)'},
  ]

  const weekAgoReport = new Date(); weekAgoReport.setDate(weekAgoReport.getDate()-7); weekAgoReport.setHours(0,0,0,0)
  const tasksByMember = data.team.map((m: Profile) => {
    const memberPending = tasks.filter(t=>!t.done&&t.assignee?.name===m.name)
    const memberDone = tasks.filter(t=>t.done&&t.assignee?.name===m.name)
    const urgentCount = memberPending.filter(t=>t.level==='urgent').length
    const highCount = memberPending.filter(t=>t.level==='high').length
    const normalCount = memberPending.length - urgentCount - highCount
    const doneThisWeek = memberDone.filter(t=>new Date(t.updated_at||t.created_at)>=weekAgoReport).length
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
    {label:'Alta', count:inbox.filter(m=>m.ai_urgency==='high').length, color:'rgba(255,176,32,0.8)'},
    {label:'Normal', count:inbox.filter(m=>m.ai_urgency==='normal').length, color:BLU},
  ]

  const maxBar = Math.max(...tasksByMember.map((m: any)=>m.pending+m.done), 1)

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-2" style={{color:'rgba(255,255,255,0.18)'}}>RENDIMIENTO</div>
          <h1 className="font-figtree text-[28px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Reportes</h1>
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
        }} className="flex items-center gap-2 px-4 py-2 rounded-xl font-syne text-[10px] font-black tracking-wide transition-colors" style={{background:'rgba(27,95,250,0.1)',color:BLU,border:'1px solid rgba(27,95,250,0.2)'}}>
          <LucideIcon name="download" size={13} color={BLU}/>EXPORTAR PDF
        </button>
      </div>

      {/* 7-day team productivity sparkline */}
      {(()=>{
        const last7 = Array.from({length:7},(_,i)=>{
          const d = new Date(); d.setDate(d.getDate()-(6-i))
          return {key:d.toISOString().slice(0,10),label:d.toLocaleDateString('es-ES',{weekday:'short'})}
        })
        const counts = last7.map(({key})=>tasks.filter(t=>t.done&&(t.updated_at||t.created_at).slice(0,10)===key).length)
        const mx = Math.max(...counts,1)
        const total7 = counts.reduce((a,b)=>a+b,0)
        if (total7 === 0) return null
        return (
          <div className="flex items-end gap-4 mb-5 px-1 py-4 rounded-xl" style={{background:'rgba(27,95,250,0.04)',border:'1px solid rgba(27,95,250,0.1)'}}>
            <div className="flex items-end gap-1.5 flex-1 h-12">
              {last7.map(({label},i)=>{
                const pct = Math.max((counts[i]/mx)*100,4)
                const isToday = i === 6
                return (
                  <div key={i} className="flex flex-col items-center gap-1 flex-1" title={`${label}: ${counts[i]} completadas`}>
                    <div className="w-full flex items-end" style={{height:'32px'}}>
                      <div className="w-full rounded-sm" style={{height:`${pct}%`,background:isToday?GRN:counts[i]>0?BLU+'60':'rgba(255,255,255,0.04)',transition:'height 0.4s'}}/>
                    </div>
                    <span className="font-syne text-[6.5px] font-black" style={{color:isToday?'rgba(255,255,255,0.45)':'rgba(255,255,255,0.18)'}}>{label.slice(0,2).toUpperCase()}</span>
                  </div>
                )
              })}
            </div>
            <div className="flex-shrink-0 text-right pr-1">
              <div className="font-figtree text-[22px] font-black leading-none" style={{color:GRN,letterSpacing:'-0.03em'}}>{total7}</div>
              <div className="font-syne text-[7px] font-black tracking-widest mt-0.5" style={{color:'rgba(255,255,255,0.2)'}}>EQUIPO · 7D</div>
            </div>
          </div>
        )
      })()}

      {/* KPIs */}
      <div className="grid gap-3 mb-6" style={{gridTemplateColumns:totalMRR>0?'repeat(6,minmax(0,1fr))':'repeat(5,minmax(0,1fr))'}}>
        {[
          {v:`${completionRate}%`, l:'Tareas completadas', accent:completionRate>60?'#22c55e':BLU, nav:'tareas'},
          {v:urgentTasks+'', l:'Urgentes pendientes', accent:urgentTasks>0?RED:BLU, nav:'tareas'},
          {v:overdueProjects.length+'', l:'Proy. atrasados', accent:overdueProjects.length>0?RED:null, nav:'proyectos'},
          {v:activeClients.length+'', l:'Clientes activos', accent:null, nav:'clientes'},
          {v:agendaItems.filter((a:any)=>a.status!=='publicado').length+'', l:'En pipeline', accent:agendaItems.filter((a:any)=>a.status!=='publicado').length>0?'rgba(193,53,132,0.9)':null, nav:'contenido'},
          ...(totalMRR>0?[{v:`€${totalMRR.toLocaleString('es-ES')}`, l:'MRR activos', accent:GRN, nav:'clientes'}]:[]),
        ].map((k,i)=>(
          <button key={i} onClick={()=>onNavigate?.(k.nav)} className="rounded-xl p-4 text-left transition-all hover:opacity-80" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)',borderTop:`2px solid ${k.accent||'rgba(255,255,255,0.1)'}`}}>
            <div className="font-syne text-4xl font-black mb-1 leading-none" style={{color:k.accent||'#F0F0F8',fontSize:totalMRR>0?'clamp(20px,2.2vw,36px)':'36px'}}>{k.v}</div>
            <div className="text-xs text-white/35">{k.l}</div>
          </button>
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
                  {m.doneThisWeek > 0 && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full flex-shrink-0" style={{background:'rgba(34,197,94,0.08)',color:'rgba(34,197,94,0.65)'}} title="Completadas en los últimos 7 días">+{m.doneThisWeek} sem.</span>}
                  {m.workload > 0 && (
                    <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full flex-shrink-0" style={{background:m.workload>8?'rgba(229,29,42,0.12)':m.workload>4?'rgba(255,176,32,0.1)':'rgba(255,255,255,0.04)',color:m.workload>8?RED:m.workload>4?'rgba(255,176,32,0.8)':'rgba(255,255,255,0.3)'}} title="Índice de carga (urgentes×3 + altas×2 + normales×1)">{m.workload}pts</span>
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
          <div className="pt-4 pb-4 border-t border-white/6">
            <div className="text-xs text-white/25 mb-3">Por fuente</div>
            <div className="flex gap-2 flex-wrap">
              {[
                {label:'Gmail', n:inbox.filter(m=>m.source==='gmail').length, color:'rgba(27,95,250,0.8)'},
                {label:'WhatsApp', n:inbox.filter(m=>m.source==='whatsapp').length, color:'rgba(37,211,102,0.8)'},
                {label:'Interno', n:inbox.filter(m=>m.source==='internal').length, color:'rgba(255,176,32,0.8)'},
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
            <div className="text-xs text-white/25 mb-2">Clientes con más proyectos</div>
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
      </div>

      {/* Content pipeline */}
      {agendaItems.length > 0 && (
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
          .filter((p:Project)=>p.deadline&&p.deadline!=='TBD'&&p.status!=='completado'&&new Date(p.deadline+'T23:59:59')<=horizon)
          .sort((a:Project,b:Project)=>new Date(a.deadline+'T23:59:59').getTime()-new Date(b.deadline+'T23:59:59').getTime())
          .slice(0,8)
        if (!upcoming.length) return null
        return (
          <div className="mt-4 rounded-xl p-5" style={{background:'#0C0C15',border:'1px solid rgba(255,255,255,0.07)'}}>
            <div className="font-syne text-[9px] font-bold tracking-widest text-white/25 uppercase mb-4">Próximos vencimientos</div>
            <div className="space-y-1">
              {upcoming.map((p:Project,i:number)=>{
                const daysLeft = Math.ceil((new Date(p.deadline+'T23:59:59').getTime()-Date.now())/86400000)
                const isOver = daysLeft < 0
                const isSoon = !isOver && daysLeft <= 7
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
                    <span className="font-syne text-[8px] text-white/25 flex-shrink-0">{new Date(p.deadline+'T00:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'})}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function HoySection({profile,data,urgentCount,unreadCount,onOpenModal,showToast,isOwner,onNavigate}: any) {
  const [quickText, setQuickText] = useState('')
  const [quickCreating, setQuickCreating] = useState(false)
  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 13 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches'
  const dateStr = now.toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long' })
  const taskUrgencyOrder = (t: Task) => { const lp = t.level==='urgent'?0:t.level==='high'?1:2; const over = t.due_date && new Date(t.due_date+'T23:59:59')<new Date() ? -10 : 0; return lp + over }
  const myTasks = data.tasks.filter((t:Task) => !t.done && (t.assigned_to === profile.id || (!t.assigned_to && t.created_by === profile.id))).sort((a:Task,b:Task)=>taskUrgencyOrder(a)-taskUrgencyOrder(b))
  const otherTasks = isOwner ? data.tasks.filter((t:Task) => !t.done && t.assigned_to && t.assigned_to !== profile.id).sort((a:Task,b:Task)=>taskUrgencyOrder(a)-taskUrgencyOrder(b)) : []
  const myOverdue = myTasks.filter((t:Task)=>t.due_date&&new Date(t.due_date+'T23:59:59')<new Date()).length
  const myUrgent = myTasks.filter((t:Task)=>t.level==='urgent').length
  const completedToday = data.tasks.filter((t:Task)=>t.done&&(t.updated_at||t.created_at).slice(0,10)===new Date().toISOString().slice(0,10)&&(t.assigned_to===profile.id||t.created_by===profile.id)).length
  const recentInbox = data.inbox.filter((m:any) => !m.is_read).slice(0, 4)
  const activeProjects = data.projects.filter((p:Project)=>p.status==='activo'||p.status==='urgente').sort((a:Project,b:Project)=>{
    const da = a.deadline&&a.deadline!=='TBD'?new Date(a.deadline+'T23:59:59').getTime():Infinity
    const db = b.deadline&&b.deadline!=='TBD'?new Date(b.deadline+'T23:59:59').getTime():Infinity
    return da - db
  })
  const todayStr = new Date().toISOString().split('T')[0]
  const todayContent = (data.agenda||[]).filter((a:any)=>{
    if (!a.publish_date) return false
    return a.publish_date.toString().slice(0,10) === todayStr
  })
  const todayCalEvents = (data.calendarEvents||[]).filter((e: any)=>{
    if (!e.start) return false
    return e.start.slice(0,10) === todayStr
  }).sort((a: any, b: any)=>{
    if (a.allDay && !b.allDay) return -1
    if (!a.allDay && b.allDay) return 1
    return (a.start||'').localeCompare(b.start||'')
  })
  const platC: Record<string,string> = {TikTok:'#ff0050',Instagram:'#C13584',LinkedIn:'#0A66C2',YouTube:'#FF0000',Twitter:'#1DA1F2',Pinterest:'#E60023'}

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

      {/* 7-day productivity sparkline */}
      {(()=>{
        const last7 = Array.from({length:7},(_,i)=>{
          const d = new Date(); d.setDate(d.getDate()-(6-i))
          return {key:d.toISOString().slice(0,10), label:d.toLocaleDateString('es-ES',{weekday:'short'})}
        })
        const counts = last7.map(({key})=>data.tasks.filter((t:Task)=>t.done&&(t.updated_at||t.created_at).slice(0,10)===key&&(t.assigned_to===profile.id||t.created_by===profile.id)).length)
        const mx = Math.max(...counts, 1)
        const total = counts.reduce((a:number,b:number)=>a+b,0)
        if (total === 0) return null
        const todayIdx = 6
        let streak = 0
        for (let si = 0; si < 30; si++) {
          const sd = new Date(); sd.setDate(sd.getDate()-si)
          const sk = sd.toISOString().slice(0,10)
          const sc = data.tasks.filter((t:Task)=>t.done&&(t.updated_at||t.created_at).slice(0,10)===sk&&(t.assigned_to===profile.id||t.created_by===profile.id)).length
          if (sc === 0) break
          streak++
        }
        return (
          <div className="flex items-end gap-4 mb-8">
            <div className="flex items-end gap-1.5 flex-1">
              {last7.map(({label},i)=>{
                const pct = Math.max((counts[i]/mx)*100,4)
                const isToday = i === todayIdx
                return (
                  <div key={i} className="flex flex-col items-center gap-1.5 flex-1" title={`${label}: ${counts[i]} completadas`}>
                    <div className="w-full rounded-t-sm transition-all" style={{height:'40px',display:'flex',alignItems:'flex-end'}}>
                      <div className="w-full rounded-t-sm" style={{height:`${pct}%`,background:isToday?GRN:counts[i]>0?BLU+'50':'rgba(255,255,255,0.04)',transition:'height 0.4s ease'}}/>
                    </div>
                    <span className="font-syne text-[7.5px] font-black" style={{color:isToday?'rgba(255,255,255,0.5)':'rgba(255,255,255,0.2)'}}>{label.slice(0,2).toUpperCase()}</span>
                  </div>
                )
              })}
            </div>
            <div className="flex items-end gap-4 flex-shrink-0">
              {streak >= 2 && (
                <div className="text-right">
                  <div className="font-figtree text-[22px] font-black leading-none" style={{color:'rgba(255,176,32,0.9)',letterSpacing:'-0.03em'}}>{streak}d</div>
                  <div className="font-syne text-[7px] font-black tracking-widest mt-0.5" style={{color:'rgba(255,255,255,0.2)'}}>RACHA</div>
                </div>
              )}
              <div className="text-right">
                <div className="font-figtree text-[22px] font-black leading-none" style={{color:GRN,letterSpacing:'-0.03em'}}>{total}</div>
                <div className="font-syne text-[7.5px] font-black tracking-widest mt-0.5" style={{color:'rgba(255,255,255,0.2)'}}>ESTA SEMANA</div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Stats row — clickable, navigate to section */}
      <div className="grid grid-cols-5 gap-6 mb-10 pb-10" style={{borderBottom:`1px solid ${BORDER}`}}>
        {[
          { n: myTasks.length, label:'Mis tareas', color:myOverdue>0?RED:'rgba(255,255,255,0.92)', sub:myOverdue>0?`${myOverdue} atrasada${myOverdue>1?'s':''}`:myUrgent>0?`${myUrgent} urgente${myUrgent>1?'s':''}` :'Al día', nav:'tareas' },
          { n: urgentCount, label:'Urgentes', color:urgentCount>0?RED:'rgba(255,255,255,0.25)', sub: urgentCount>0?'Requieren atención':'Todo bajo control', nav:'tareas' },
          { n: completedToday, label:'Completadas hoy', color:completedToday>0?GRN:'rgba(255,255,255,0.25)', sub: completedToday>0?'Buen trabajo':'Pendiente de arrancar', nav:'tareas' },
          { n: unreadCount, label:'Sin leer', color:unreadCount>0?BLU:'rgba(255,255,255,0.25)', sub:'En inbox', nav:'inbox' },
          { n: activeProjects.length, label:'Proyectos activos', color:'rgba(255,255,255,0.92)', sub:`${data.projects.length} en total`, nav:'proyectos' },
        ].map((s,i)=>(
          <button key={i} onClick={()=>onNavigate?.(s.nav)} className="text-left group transition-opacity hover:opacity-80">
            <div className="font-figtree font-black leading-none mb-2" style={{fontSize:'48px',color:s.color,letterSpacing:'-0.04em'}}>{s.n}</div>
            <div className="text-[14px] font-medium mb-0.5" style={{color:'rgba(255,255,255,0.5)'}}>{s.label}</div>
            <div className="font-syne text-[9px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.18)'}}>{s.sub.toUpperCase()}</div>
          </button>
        ))}
      </div>

      {/* Overdue alerts */}
      {myOverdue > 0 && (
        <div className="mb-3 flex items-center gap-3 px-5 py-3.5 rounded-2xl" style={{background:'rgba(229,29,42,0.05)',border:'1px solid rgba(229,29,42,0.18)'}}>
          <div className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse" style={{background:RED}}/>
          <span className="font-syne text-[9px] font-black tracking-wide flex-1" style={{color:'rgba(229,29,42,0.85)'}}>
            {myOverdue} tarea{myOverdue!==1?'s':''} vencida{myOverdue!==1?'s':''} — requiere{myOverdue!==1?'n':''} atención inmediata
          </span>
          <button onClick={()=>onNavigate?.('tareas')} className="font-syne text-[8px] font-black px-3 py-1.5 rounded-xl transition-all hover:opacity-80" style={{background:'rgba(229,29,42,0.12)',color:RED}}>VER TAREAS →</button>
        </div>
      )}
      {(()=>{
        const overdueProj = data.projects.filter((p: Project)=>p.deadline&&p.deadline!=='TBD'&&p.status!=='completado'&&new Date(p.deadline+'T23:59:59')<new Date())
        if (overdueProj.length===0) return null
        return (
          <div className="mb-6 flex items-center gap-3 px-5 py-3.5 rounded-2xl" style={{background:'rgba(255,176,32,0.04)',border:'1px solid rgba(255,176,32,0.18)'}}>
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{background:'rgba(255,176,32,0.9)'}}/>
            <span className="font-syne text-[9px] font-black tracking-wide flex-1" style={{color:'rgba(255,176,32,0.85)'}}>
              {overdueProj.length} proyecto{overdueProj.length!==1?'s':''} atrasado{overdueProj.length!==1?'s':''} — deadline{overdueProj.length!==1?'s':''} vencido{overdueProj.length!==1?'s':''}
            </span>
            <button onClick={()=>onNavigate?.('proyectos')} className="font-syne text-[8px] font-black px-3 py-1.5 rounded-xl transition-all hover:opacity-80" style={{background:'rgba(255,176,32,0.1)',color:'rgba(255,176,32,0.9)'}}>VER PROYECTOS →</button>
          </div>
        )
      })()}

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
            <div className="flex items-center gap-2.5 px-6 py-2.5" style={{borderBottom:`1px solid ${BORDER}`}}>
              <LucideIcon name="plus-circle" size={12} color="rgba(255,255,255,0.15)"/>
              <input value={quickText} onChange={e=>setQuickText(e.target.value)} onKeyDown={async e=>{if(e.key==='Enter'&&quickText.trim()&&!quickCreating){setQuickCreating(true);try{await data.createTask({text:quickText.trim(),level:'normal',due_date:new Date().toISOString().split('T')[0],source:'manual'});setQuickText('');showToast('Tarea creada')}catch{showToast('Error')}finally{setQuickCreating(false)}}}} placeholder="Captura rápida… (Enter para crear)" disabled={quickCreating} className="flex-1 bg-transparent text-[12px] outline-none disabled:opacity-40" style={{caretColor:BLU,color:'rgba(255,255,255,0.65)'}}/>
            </div>
            {myTasks.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <div className="text-[13px] mb-3" style={{color:'rgba(255,255,255,0.18)'}}>Sin tareas asignadas</div>
                <button onClick={()=>onOpenModal('tarea')} className="font-syne text-[10px] font-black px-4 py-2 rounded-xl" style={{background:'rgba(27,95,250,0.08)',color:BLU}}>CREAR PRIMERA TAREA</button>
              </div>
            ) : (<>{myTasks.slice(0,7).map((t:Task)=>{
              const pc = t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.85)':BLU
              return (
              <div key={t.id} onClick={()=>data.toggleTask(t.id)} className="flex items-start gap-4 px-6 py-4 cursor-pointer transition-all group hover:bg-white/[0.015]" style={{borderBottom:`1px solid ${BORDER}`,borderLeft:`3px solid ${pc}`}}>
                <div className="w-4 h-4 rounded-full border-2 mt-1 flex-shrink-0 transition-all" style={{borderColor:pc+'70'}}/>
                <div className="flex-1 min-w-0">
                  <div className="font-figtree text-[14px] font-semibold leading-snug mb-1.5" style={{color:'rgba(255,255,255,0.88)'}}>{t.text}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {t.client && <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full" style={{background:(t.client as any).color+'18',color:(t.client as any).color+'cc'}}>{(t.client as any).name}</span>}
                    {t.project_id && (()=>{ const proj=data.projects.find((p:Project)=>p.id===t.project_id); return proj?<span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded" style={{background:(proj.color||BLU)+'12',color:(proj.color||BLU)+'90'}}>{proj.name}</span>:null })()}
                    {t.due_date && (() => {
                      const todayStr = new Date().toISOString().split('T')[0]
                      const isToday = t.due_date.slice(0,10) === todayStr
                      const overdue = !isToday && new Date(t.due_date+'T23:59:59') < new Date()
                      const label = isToday ? 'HOY' : new Date(t.due_date+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'})
                      return <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full" style={{background:isToday?'rgba(255,176,32,0.15)':overdue?'rgba(229,29,42,0.1)':'rgba(255,255,255,0.05)',color:isToday?'rgba(255,176,32,0.95)':overdue?RED:'rgba(255,255,255,0.35)'}}>{overdue?'● ':''}{label}</span>
                    })()}
                    {t.level==='urgent' && <span className="font-syne text-[8px] font-black" style={{color:RED}}>● URGENTE</span>}
                  </div>
                </div>
                {t.assignee && <div className="w-7 h-7 rounded-full flex items-center justify-center font-syne text-[9px] font-black flex-shrink-0 mt-0.5" style={{background:t.assignee.avatar_color+'20',border:`1.5px solid ${t.assignee.avatar_color}35`,color:t.assignee.avatar_color}}>{t.assignee.initials}</div>}
              </div>
            )})}
            {myTasks.length > 7 && (
              <button onClick={()=>onNavigate('tareas')} className="w-full py-3 text-center font-syne text-[8.5px] font-black tracking-widest transition-colors" style={{color:'rgba(255,255,255,0.2)',borderTop:`1px solid ${BORDER}`}} onMouseEnter={e=>(e.currentTarget.style.color=BLU)} onMouseLeave={e=>(e.currentTarget.style.color='rgba(255,255,255,0.2)')}>
                +{myTasks.length-7} MÁS · VER TODAS
              </button>
            )}
            </>)}

          </div>

          {/* Tomorrow tasks */}
          {(() => {
            const tomorrowStr = new Date(Date.now()+86400000).toISOString().split('T')[0]
            const tomorrowTasks = myTasks.filter((t:Task)=>t.due_date&&t.due_date.slice(0,10)===tomorrowStr)
            if (tomorrowTasks.length === 0) return null
            return (
              <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
                <div className="flex items-center justify-between px-6 py-3.5" style={{borderBottom:`1px solid ${BORDER}`}}>
                  <div>
                    <div className="font-syne text-[8.5px] font-black tracking-widest mb-0.5" style={{color:'rgba(255,255,255,0.2)'}}>MAÑANA</div>
                    <span className="font-syne text-[15px] font-black text-white">Próximas</span>
                  </div>
                  <span className="font-syne text-[9px] font-black w-6 h-6 rounded-full flex items-center justify-center" style={{background:'rgba(255,176,32,0.1)',color:'rgba(255,176,32,0.7)'}}>{tomorrowTasks.length}</span>
                </div>
                {tomorrowTasks.slice(0,3).map((t:Task)=>{
                  const pc = t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.85)':BLU
                  return (
                    <div key={t.id} className="flex items-center gap-3 px-6 py-3" style={{borderBottom:`1px solid ${BORDER}`}}>
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:pc}}/>
                      <span className="flex-1 text-[12.5px] truncate" style={{color:'rgba(255,255,255,0.6)'}}>{t.text}</span>
                      {t.client && <span className="font-syne text-[7.5px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:(t.client as any).color+'14',color:(t.client as any).color+'bb'}}>{(t.client as any).name}</span>}
                      {t.project_id && (()=>{ const proj=data.projects.find((p:Project)=>p.id===t.project_id); return proj?<span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded flex-shrink-0" style={{background:(proj.color||BLU)+'12',color:(proj.color||BLU)+'90'}}>{proj.name}</span>:null })()}
                      {t.level!=='normal' && <span className="font-syne text-[7.5px] font-black flex-shrink-0" style={{color:pc}}>{t.level==='urgent'?'URG':'ALTA'}</span>}
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {/* Active projects mini-panel */}
          {activeProjects.length > 0 && (
            <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
              <div className="flex items-center justify-between px-6 py-4" style={{borderBottom:`1px solid ${BORDER}`}}>
                <div>
                  <div className="font-syne text-[8.5px] font-black tracking-widest mb-0.5" style={{color:'rgba(255,255,255,0.2)'}}>PIPELINE</div>
                  <span className="font-syne text-[15px] font-black text-white">Proyectos activos</span>
                </div>
                <button onClick={()=>onNavigate('proyectos')} className="font-syne text-[8px] font-black px-3 py-1.5 rounded-xl transition-all hover:opacity-80" style={{background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.3)',border:`1px solid ${BORDER}`}}>VER TODOS</button>
              </div>
              {activeProjects.slice(0,4).map((p: Project, i: number)=>{
                const dl = p.deadline && p.deadline!=='TBD' ? new Date(p.deadline+'T23:59:59') : null
                const dOver = dl && dl < new Date()
                const dSoon = dl && !dOver && dl < new Date(Date.now()+7*24*3600*1000)
                const daysLeft = dl ? Math.round(Math.abs(dl.getTime()-Date.now())/(1000*60*60*24)) : null
                const pendingTasks = data.tasks.filter((t: Task)=>!t.done&&t.project_id===p.id).length
                return (
                  <div key={p.id} className="px-6 py-4 transition-all hover:bg-white/[0.015]" style={{borderBottom:i<Math.min(activeProjects.length,4)-1?`1px solid ${BORDER}`:'none',borderLeft:`3px solid ${p.color||BLU}60`}}>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="font-figtree text-[13px] font-semibold flex-1 truncate" style={{color:'rgba(255,255,255,0.82)'}}>{p.name}</span>
                      {dOver && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:`${RED}15`,color:RED}}>−{daysLeft}d</span>}
                      {dSoon && !dOver && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:'rgba(255,176,32,0.12)',color:'rgba(255,176,32,0.85)'}}>{daysLeft}d</span>}
                      {pendingTasks > 0 && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:'rgba(27,95,250,0.08)',color:'rgba(100,140,255,0.55)'}}>{pendingTasks}t</span>}
                    </div>
                    <div className="h-1 rounded-full" style={{background:'rgba(255,255,255,0.05)'}}>
                      <div className="h-full rounded-full transition-all" style={{width:`${p.progress}%`,background:p.color||BLU}}/>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Team tasks (owners) */}
          {isOwner && otherTasks.length > 0 && (
            <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
              <div className="flex items-center px-6 py-4" style={{borderBottom:`1px solid ${BORDER}`}}>
                <div className="font-syne text-[8.5px] font-black tracking-widest mr-3" style={{color:'rgba(255,255,255,0.2)'}}>EQUIPO</div>
                <span className="font-syne text-[15px] font-black text-white">Tareas del equipo</span>
              </div>
              {otherTasks.slice(0,4).map((t:Task)=>{
                const ttodayStr = new Date().toISOString().split('T')[0]
                const tIsToday = t.due_date && t.due_date.slice(0,10) === ttodayStr
                const tOver = t.due_date && !tIsToday && new Date(t.due_date+'T23:59:59') < new Date()
                return (
                <div key={t.id} onClick={()=>data.toggleTask(t.id)} className="flex items-center gap-3 px-6 py-4 cursor-pointer transition-all" style={{borderBottom:`1px solid ${BORDER}`}}>
                  {t.assignee && <div className="w-7 h-7 rounded-full flex items-center justify-center font-syne text-[9px] font-black flex-shrink-0" style={{background:t.assignee.avatar_color+'18',border:`1.5px solid ${t.assignee.avatar_color}30`,color:t.assignee.avatar_color}}>{t.assignee.initials}</div>}
                  <span className="flex-1 text-[13px] truncate" style={{color:'rgba(240,240,248,0.65)'}}>{t.text}</span>
                  {(t as any).client && <span className="font-syne text-[7.5px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:(t as any).client.color+'14',color:(t as any).client.color+'bb'}}>{(t as any).client.name}</span>}
                  {t.due_date && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full flex-shrink-0" style={{background:tIsToday?'rgba(255,176,32,0.15)':tOver?`${RED}14`:'rgba(255,255,255,0.04)',color:tIsToday?'rgba(255,176,32,0.9)':tOver?RED:'rgba(255,255,255,0.22)'}}>{tIsToday?'HOY':new Date(t.due_date+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'})}</span>}
                  <span className="font-syne text-[8px] font-black px-2 py-1 rounded-lg flex-shrink-0" style={{background:t.level==='urgent'?'rgba(229,29,42,0.12)':t.level==='high'?'rgba(255,176,32,0.1)':SURF2,color:t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.85)':'rgba(255,255,255,0.22)'}}>{t.level==='urgent'?'URGENTE':t.level==='high'?'ALTA':'NORMAL'}</span>
                </div>
              )})}

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
              <button key={m.id} onClick={()=>onNavigate('inbox')} className="w-full text-left px-5 py-4 transition-colors" style={{borderBottom:`1px solid ${BORDER}`}} onMouseEnter={e=>(e.currentTarget.style.background='rgba(255,255,255,0.025)')} onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
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
                  <LucideIcon name="chevron-right" size={11} color="rgba(255,255,255,0.1)"/>
                </div>
              </button>
            ))}
          </div>

          {/* Today's Google Calendar events */}
          {todayCalEvents.length > 0 && (
            <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
              <div className="flex items-center justify-between px-5 py-4" style={{borderBottom:`1px solid ${BORDER}`}}>
                <div>
                  <div className="font-syne text-[8.5px] font-black tracking-widest mb-0.5" style={{color:'rgba(255,255,255,0.2)'}}>AGENDA HOY</div>
                  <span className="font-syne text-[15px] font-black text-white">Calendario</span>
                </div>
                <span className="font-syne text-[9px] font-black w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{background:'rgba(167,139,250,0.15)',color:'#a78bfa'}}>{todayCalEvents.length}</span>
              </div>
              {todayCalEvents.slice(0,4).map((ev:any,i:number)=>{
                const timeStr = ev.allDay ? 'Todo el día' : new Date(ev.start).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})
                return (
                  <div key={ev.id||i} className="flex items-center gap-3 px-5 py-3.5" style={{borderBottom:i<Math.min(todayCalEvents.length,4)-1?`1px solid ${BORDER}`:'none'}}>
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:'#a78bfa'}}/>
                    <span className="font-figtree text-[12px] font-medium flex-1 truncate" style={{color:'rgba(255,255,255,0.75)'}}>{ev.title}</span>
                    <span className="font-syne text-[8px] font-black flex-shrink-0" style={{color:'rgba(167,139,250,0.6)'}}>{timeStr}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Today's content */}
          {todayContent.length > 0 && (
            <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
              <div className="flex items-center justify-between px-5 py-4" style={{borderBottom:`1px solid ${BORDER}`}}>
                <div>
                  <div className="font-syne text-[8.5px] font-black tracking-widest mb-0.5" style={{color:'rgba(255,255,255,0.2)'}}>PUBLICAR HOY</div>
                  <span className="font-syne text-[15px] font-black text-white">Contenido</span>
                </div>
                <span className="font-syne text-[9px] font-black w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{background:'rgba(255,176,32,0.15)',color:'rgba(255,176,32,0.9)'}}>{todayContent.length}</span>
              </div>
              {todayContent.slice(0,3).map((a:any)=>{
                const pc = platC[a.platform] || BLU
                return (
                  <div key={a.id} className="px-5 py-3.5" style={{borderBottom:`1px solid ${BORDER}`,borderLeft:`3px solid ${pc}55`}}>
                    <div className="text-[12px] font-semibold line-clamp-1 mb-0.5" style={{color:'rgba(255,255,255,0.82)'}}>{a.title}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <PlatformLogo platform={a.platform} size={10}/>
                      <span className="font-syne text-[7.5px] font-black" style={{color:`${pc}99`}}>{a.platform}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Quick actions */}
          <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            <div className="px-5 py-4 font-syne text-[8.5px] font-black tracking-widest" style={{borderBottom:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.2)'}}>ACCIONES</div>
            {[
              {label:'Nueva tarea', sub:'Asignar y priorizar', icon:'check-square', c:BLU, act:()=>onOpenModal('tarea')},
              {label:'Nueva pieza', sub:'Contenido · social', icon:'film', c:'#C13584', act:()=>onOpenModal('contenido')},
              {label:'Nueva memoria', sub:'Conocimiento · base', icon:'brain', c:'rgba(167,139,250,0.9)', act:()=>onOpenModal('memoria')},
              ...(isOwner?[
                {label:'Nuevo cliente', sub:'CRM · gestión', icon:'users', c:GRN, act:()=>onOpenModal('cliente')},
                {label:'Nuevo proyecto', sub:'Pipeline · kanban', icon:'folder-open', c:'rgba(255,176,32,0.9)', act:()=>onOpenModal('proyecto')},
              ]:[]),
            ].map((a,i,arr)=>(
              <button key={a.label} onClick={a.act} className="flex items-center gap-3.5 w-full px-5 py-4 text-left transition-all group" style={{borderBottom:i<arr.length-1?`1px solid ${BORDER}`:'none'}}
                onMouseEnter={e=>(e.currentTarget.style.background='rgba(255,255,255,0.025)')}
                onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:a.c+'14',border:`1px solid ${a.c}25`}}>
                  <LucideIcon name={a.icon} size={14} color={a.c+'cc'}/>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium leading-snug" style={{color:'rgba(255,255,255,0.82)'}}>{a.label}</div>
                  <div className="font-syne text-[8px] font-black tracking-wide" style={{color:'rgba(255,255,255,0.2)'}}>{a.sub.toUpperCase()}</div>
                </div>
                <LucideIcon name="chevron-right" size={12} color="rgba(255,255,255,0.12)"/>
              </button>
            ))}
          </div>

          {/* Projects */}
          {activeProjects.length > 0 && (
            <div className="rounded-2xl p-5" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
              <div className="font-syne text-[8.5px] font-black tracking-widest mb-4" style={{color:'rgba(255,255,255,0.2)'}}>PROYECTOS</div>
              {activeProjects.slice(0,3).map((p:Project)=>{
                const isOverdue = p.deadline && p.deadline!=='TBD' && new Date(p.deadline+'T23:59:59') < new Date()
                const isSoon = p.deadline && p.deadline!=='TBD' && !isOverdue && new Date(p.deadline+'T23:59:59') < new Date(Date.now()+7*24*3600*1000)
                return (
                <div key={p.id} className="flex items-center gap-3 mb-4">
                  <ProgressRing pct={p.progress} size={40} stroke={3} color={isOverdue?RED:p.color||BLU}/>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate" style={{color:'rgba(240,240,248,0.8)'}}>{p.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px]" style={{color:'rgba(255,255,255,0.25)'}}>{p.progress}%</span>
                      {p.deadline && p.deadline!=='TBD' && (()=>{
                        const dl = new Date(p.deadline+'T23:59:59')
                        const diffDays = Math.round(Math.abs(dl.getTime()-Date.now())/(1000*60*60*24))
                        const dlLabel = isOverdue ? `−${diffDays}d` : diffDays===0 ? 'HOY' : `${diffDays}d`
                        return (
                          <span className="font-syne text-[8px] font-black px-1.5 py-0.5 rounded-full" style={{background:isOverdue?`${RED}18`:isSoon?'rgba(255,176,32,0.1)':'transparent',color:isOverdue?RED:isSoon?'rgba(255,176,32,0.8)':'rgba(255,255,255,0.25)'}}>
                            {dlLabel}
                          </span>
                        )
                      })()}
                    </div>
                  </div>
                </div>
              )})}

            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── INBOX SECTION ────────────────────────────────────────────
function InboxSection({data,showToast,profile,onNavigate,onSelectClient}: any) {
  const [filter, setFilter] = useState('Todos')
  const [selected, setSelected] = useState<any>(null)
  const [creatingTask, setCreatingTask] = useState(false)
  const filteredRef = useRef<any[]>([])

  useEffect(()=>{
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selected) { setSelected(null); return }
      if (e.key === 'e' && selected && !['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault()
        if (selected.is_read) { data.markUnread(selected.id); setSelected((s: any)=>s?{...s,is_read:false,is_unread:true}:s) }
        else { data.markRead(selected.id); setSelected((s: any)=>s?{...s,is_read:true,is_unread:false}:s) }
        return
      }
      if ((e.key === 'j' || e.key === 'k') && !['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault()
        const msgs = filteredRef.current
        setSelected((sel: any) => {
          const idx = sel ? msgs.findIndex((m: any)=>m.id===sel.id) : -1
          const next = e.key==='j' ? Math.min(idx+1, msgs.length-1) : Math.max(idx-1, 0)
          const m = msgs[next]
          if (m && !m.is_read) data.markRead(m.id)
          return m || sel
        })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selected])

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
  filteredRef.current = filtered

  const handleSelect = (m: any) => {
    setSelected(m)
    if (!m.is_read) data.markRead(m.id)
  }

  const createTaskFromEmail = async (m: any) => {
    if (!m.ai_action) return
    setCreatingTask(true)
    try {
      const client = m.ai_client && m.ai_client !== 'Desconocido'
        ? data.clients.find((c: any) => c.name.toLowerCase().includes(m.ai_client.toLowerCase()) || m.ai_client.toLowerCase().includes(c.name.toLowerCase().split(' ')[0]))
        : null
      await data.createTask({ text: m.ai_action, level: m.ai_urgency==='urgent'?'urgent':'high', source:'gmail', client_id: client?.id })
      showToast('Tarea creada' + (client ? ` · ${client.name}` : ''))
    } catch { showToast('Error') }
    finally { setCreatingTask(false) }
  }

  const getDateLabel = (dateStr: string) => {
    const diffDays = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
    if (diffDays === 0) return 'HOY'
    if (diffDays === 1) return 'AYER'
    if (diffDays < 7) return 'ESTA SEMANA'
    return 'ANTERIORES'
  }

  const groups: {label:string; items:any[]}[] = []
  const byLabel: Record<string,any[]> = {}
  filtered.forEach(m => { const l = getDateLabel(m.received_at); if (!byLabel[l]) byLabel[l] = []; byLabel[l].push(m) })
  ;['HOY','AYER','ESTA SEMANA','ANTERIORES'].forEach(l => { if (byLabel[l]?.length) groups.push({label:l, items:byLabel[l]}) })

  const matchedClient = selected?.ai_client
    ? data.clients.find((c: any) => c.name.toLowerCase().includes(selected.ai_client.toLowerCase()) || selected.ai_client.toLowerCase().includes(c.name.toLowerCase().split(' ')[0]))
    : null
  const relatedTasks = matchedClient ? data.tasks.filter((t: any) => !t.done && t.client_id===matchedClient.id).slice(0, 4) : []

  const uc = (u: string) => u==='urgent'?RED:u==='high'?'rgba(255,176,32,0.9)':BLU
  const ul = (u: string) => u==='urgent'?'URGENTE':u==='high'?'ALTA':'NORMAL'

  const tabs = [
    {id:'Todos', label:'Todos', n: allMsgs.length, accent:'rgba(255,255,255,0.35)'},
    {id:'Sin leer', label:'Sin leer', n: unread, accent: BLU},
    {id:'Urgente', label:'Urgente', n: urgent, accent: RED},
    {id:'Clientes', label:'Clientes', n: fromClients, accent: GRN},
    {id:'Interno', label:'Interno', n: internal, accent: 'rgba(255,176,32,0.8)'},
    ...(allMsgs.some((m:any)=>m.source==='gmail') ? [{id:'Gmail', label:'Gmail', n: allMsgs.filter((m:any)=>m.source==='gmail').length, accent:'rgba(255,255,255,0.25)'}] : []),
    ...(allMsgs.some((m:any)=>m.source==='whatsapp') ? [{id:'WhatsApp', label:'WhatsApp', n: allMsgs.filter((m:any)=>m.source==='whatsapp').length, accent:'rgba(37,211,102,0.8)'}] : []),
  ]

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── LIST PANEL ─────────────────────────────────────────── */}
      <div className="flex flex-col overflow-hidden flex-shrink-0" style={{width:selected?'360px':'100%',borderRight:selected?`1px solid ${BORDER}`:'none',maxWidth:selected?'360px':'none'}}>

        {/* Header */}
        <div className="flex-shrink-0 px-6 pt-6 pb-4" style={{borderBottom:`1px solid ${BORDER}`}}>
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-1.5" style={{color:'rgba(255,255,255,0.18)'}}>SEÑALES</div>
              <h1 className="font-figtree text-[26px] font-black text-white leading-none" style={{letterSpacing:'-0.04em'}}>Inbox</h1>
            </div>
            <div className="flex items-center gap-2">
              {data.inbox.filter((m: any)=>!m.is_read).length > 0 && (
                <button onClick={()=>{ const unread = data.inbox.filter((m: any)=>!m.is_read); Promise.all(unread.map((m: any)=>data.markRead(m.id))); showToast(`${unread.length} mensajes marcados como leídos`) }} className="font-syne text-[8px] font-black px-2.5 py-2 rounded-xl transition-all" style={{color:'rgba(255,255,255,0.3)',border:`1px solid ${BORDER}`}} onMouseEnter={e=>(e.currentTarget.style.color='rgba(255,255,255,0.6)')} onMouseLeave={e=>(e.currentTarget.style.color='rgba(255,255,255,0.3)')}>TODO LEÍDO · {data.inbox.filter((m: any)=>!m.is_read).length}</button>
              )}
              <button onClick={()=>data.syncGmail()} disabled={data.syncing} className="flex items-center gap-2 px-3.5 py-2 rounded-xl font-syne text-[8.5px] font-black disabled:opacity-40 transition-all" style={{background:SURF2,color:data.syncing?BLU:data.syncResult?.ok?GRN:'rgba(240,240,248,0.35)',border:`1px solid ${BORDER}`}}>
                <LucideIcon name="refresh-cw" size={11} color={data.syncing?BLU:'rgba(255,255,255,0.25)'}/>{data.syncing?'Sync…':'Sync'}
              </button>
            </div>
          </div>
          {/* Stats row */}
          <div className="flex gap-2">
            {[
              {n:unread, l:'Sin leer', c:BLU, f:'Sin leer'},
              {n:urgent, l:'Urgentes', c:RED, f:'Urgente'},
              {n:fromClients, l:'Clientes', c:GRN, f:'Clientes'},
              {n:internal, l:'Internos', c:'rgba(255,176,32,0.8)', f:'Interno'},
            ].map((s,i)=>(
              <button key={i} onClick={()=>setFilter(s.f)} className="flex-1 rounded-2xl py-3 px-2 text-center transition-all" style={{background:filter===s.f?s.c+'15':SURF2,border:filter===s.f?`1px solid ${s.c}30`:`1px solid ${BORDER}`}} onMouseEnter={e=>{ if(filter!==s.f)(e.currentTarget.style.background='rgba(255,255,255,0.04)') }} onMouseLeave={e=>{ if(filter!==s.f)(e.currentTarget.style.background=SURF2) }}>
                <div className="font-figtree text-[20px] font-black leading-none mb-1" style={{color:s.n>0?s.c:'rgba(255,255,255,0.15)'}}>{s.n}</div>
                <div className="font-syne text-[7.5px] font-black tracking-wide" style={{color:'rgba(255,255,255,0.25)'}}>{s.l.toUpperCase()}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 px-4 py-2 flex-shrink-0 overflow-x-auto" style={{borderBottom:`1px solid ${BORDER}`}}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setFilter(t.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-wide flex-shrink-0 whitespace-nowrap transition-all" style={{background:filter===t.id?'rgba(27,95,250,0.12)':'transparent',color:filter===t.id?'rgba(255,255,255,0.9)':'rgba(255,255,255,0.3)',border:filter===t.id?`1px solid rgba(27,95,250,0.2)`:'1px solid transparent'}}>
              {t.n > 0 && filter!==t.id && <span className="font-figtree text-[9px] font-black" style={{color:t.accent}}>{t.n}</span>}
              {t.label}
            </button>
          ))}
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto">
          {groups.length === 0 && (
            <div className="py-20 text-center px-6">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{background:SURF2,border:`1px solid ${BORDER}`}}>
                <LucideIcon name="inbox" size={22} color="rgba(255,255,255,0.15)"/>
              </div>
              <div className="font-syne text-[10px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.15)'}}>{allMsgs.length===0?'SIN CUENTA CONECTADA':'BANDEJA VACÍA'}</div>
              <div className="text-[12px] leading-relaxed" style={{color:'rgba(255,255,255,0.2)'}}>{allMsgs.length===0?'Conecta Gmail en Ajustes para empezar':'No hay mensajes con este filtro'}</div>
            </div>
          )}
          {selected && filtered.length > 1 && (
            <div className="flex items-center justify-center gap-3 py-2 sticky top-0 z-20" style={{background:'rgba(5,5,16,0.9)',backdropFilter:'blur(8px)',borderBottom:`1px solid ${BORDER}`}}>
              <span className="font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.12)'}}>
                <kbd className="px-1 py-0.5 rounded" style={{background:'rgba(255,255,255,0.06)',fontFamily:'inherit'}}>J</kbd> siguiente
                {' · '}
                <kbd className="px-1 py-0.5 rounded" style={{background:'rgba(255,255,255,0.06)',fontFamily:'inherit'}}>K</kbd> anterior
              </span>
            </div>
          )}
          {groups.map(group=>(
            <div key={group.label}>
              <div className="px-5 py-2 flex items-center gap-3 sticky top-0 z-10" style={{background:'rgba(5,5,16,0.94)',backdropFilter:'blur(10px)'}}>
                <span className="font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.18)'}}>{group.label}</span>
                <div className="flex-1 h-px" style={{background:BORDER}}/>
                <span className="font-syne text-[8px]" style={{color:'rgba(255,255,255,0.12)'}}>{group.items.length}</span>
              </div>
              {group.items.map((m: any)=>{
                const isInternal = m.source==='internal'
                const isSelected = selected?.id===m.id
                const isUnread = !m.is_read
                const avatarBg = isInternal ? 'rgba(255,176,32,0.85)' : strColor(m.from_name||'?')
                const leftBar = isUnread ? (m.ai_urgency==='urgent' ? RED : isInternal ? 'rgba(255,176,32,0.7)' : BLU) : 'transparent'
                return (
                  <div key={m.id} onClick={()=>handleSelect(m)} className="relative cursor-pointer transition-colors group"
                    style={{borderLeft:`2.5px solid ${leftBar}`,background:isSelected?'rgba(27,95,250,0.07)':isUnread?'rgba(255,255,255,0.014)':'transparent',borderBottom:`1px solid ${BORDER}`}}
                    onMouseEnter={e=>{ if(!isSelected)(e.currentTarget.style.background='rgba(255,255,255,0.02)') }}
                    onMouseLeave={e=>{ if(!isSelected)(e.currentTarget.style.background=isUnread?'rgba(255,255,255,0.014)':'transparent') }}>
                    <div className="flex items-start gap-3 px-4 py-3.5">
                      {/* Avatar */}
                      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 font-syne text-[9px] font-black mt-0.5" style={{background:avatarBg+'20',color:avatarBg}}>
                        {isInternal
                          ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={avatarBg} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                          : (m.from_name||'?').slice(0,2).toUpperCase()
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        {/* Row 1 */}
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-syne text-[9px] font-black truncate flex-1" style={{color:isUnread?'rgba(255,255,255,0.88)':'rgba(255,255,255,0.32)'}}>{m.from_name||'Desconocido'}</span>
                          {isInternal && <span className="font-syne text-[6.5px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:'rgba(255,176,32,0.1)',color:'rgba(255,176,32,0.75)'}}>DM</span>}
                          {m.source==='whatsapp' && <span className="font-syne text-[6.5px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:'rgba(37,211,102,0.08)',color:'rgba(37,211,102,0.7)'}}>WA</span>}
                          {isUnread && m.ai_urgency==='urgent' && <span className="font-syne text-[6.5px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:`${RED}16`,color:RED,border:`1px solid ${RED}30`}}>URG</span>}
                          {m.attachments?.length>0 && <LucideIcon name="paperclip" size={9} color="rgba(255,255,255,0.2)"/>}
                          <span className="font-syne text-[7.5px] flex-shrink-0" style={{color:'rgba(255,255,255,0.2)'}}>{relTime(m.received_at)}</span>
                        </div>
                        {/* Row 2: subject */}
                        <div className="font-figtree text-[12.5px] font-semibold leading-snug truncate mb-1" style={{color:isUnread?'rgba(255,255,255,0.85)':'rgba(255,255,255,0.3)'}}>{m.subject||'Sin asunto'}</div>
                        {/* Row 3: AI summary or preview */}
                        <div className="text-[9px] truncate" style={{color:m.ai_summary?'rgba(100,140,255,0.5)':'rgba(255,255,255,0.18)'}}>
                          {m.ai_summary || m.body_preview?.slice(0,60) || '—'}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ── DETAIL PANEL ───────────────────────────────────────── */}
      {selected && (
        <div className="flex-1 overflow-y-auto min-w-0" style={{background:'#050510'}}>

          {/* Sticky top bar */}
          <div className="flex items-center justify-between px-6 py-3.5 sticky top-0 z-10" style={{background:'rgba(5,5,16,0.96)',backdropFilter:'blur(12px)',borderBottom:`1px solid ${BORDER}`}}>
            <button onClick={()=>setSelected(null)} className="flex items-center gap-1.5 transition-opacity hover:opacity-60" style={{color:'rgba(255,255,255,0.35)'}}>
              <LucideIcon name="chevron-left" size={14} color="rgba(255,255,255,0.35)"/>
              <span className="font-syne text-[9px] font-black tracking-wide">VOLVER</span>
            </button>
            <div className="flex items-center gap-2">
              {selected.source==='internal' && (
                <span className="font-syne text-[7.5px] font-black px-2.5 py-1 rounded-full" style={{background:'rgba(255,176,32,0.1)',color:'rgba(255,176,32,0.75)',border:'1px solid rgba(255,176,32,0.15)'}}>MENSAJE INTERNO</span>
              )}
              {selected.is_read && (
                <button onClick={()=>{ data.markUnread(selected.id); setSelected((s: any)=>({...s,is_read:false})) }} className="font-syne text-[7.5px] font-black px-3 py-1.5 rounded-xl transition-all hover:bg-white/5" style={{color:'rgba(255,255,255,0.3)',border:`1px solid ${BORDER}`}}>
                  NO LEÍDO
                </button>
              )}
              {selected.from_email && selected.source==='gmail' && (
                <a href={`mailto:${selected.from_email}?subject=${encodeURIComponent('Re: '+(selected.subject||''))}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all hover:opacity-80" style={{color:'rgba(255,255,255,0.45)',border:`1px solid ${BORDER}`}}>
                  <LucideIcon name="corner-up-left" size={10} color="rgba(255,255,255,0.45)"/>RESPONDER
                </a>
              )}
              {selected.ai_action&&selected.ai_action!=='Ninguna acción requerida' && (
                <button onClick={()=>createTaskFromEmail(selected)} disabled={creatingTask} className="flex items-center gap-1.5 px-4 py-2 rounded-xl font-syne text-[8.5px] font-black tracking-widest text-white disabled:opacity-40 transition-opacity" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
                  <LucideIcon name="plus" size={10} color="white"/>{creatingTask?'…':'CREAR TAREA'}
                </button>
              )}
            </div>
          </div>

          <div className="p-6 space-y-5">

            {/* Subject + sender */}
            <div>
              <div className="flex items-start gap-2.5 mb-4">
                {selected.ai_urgency==='urgent' && (
                  <span className="flex items-center gap-1.5 font-syne text-[7px] font-black px-2.5 py-1 rounded-full flex-shrink-0 mt-1" style={{background:`${RED}14`,color:RED,border:`1px solid ${RED}28`}}>
                    <div className="w-1.5 h-1.5 rounded-full" style={{background:RED}}/>URGENTE
                  </span>
                )}
                <h2 className="font-figtree text-[20px] font-black text-white leading-tight" style={{letterSpacing:'-0.025em'}}>{selected.subject||selected.from_phone||'Sin asunto'}</h2>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center font-syne text-[10px] font-black flex-shrink-0" style={{background:selected.source==='internal'?'rgba(255,176,32,0.12)':strColor(selected.from_name||'?')+'20',color:selected.source==='internal'?'rgba(255,176,32,0.75)':strColor(selected.from_name||'?')}}>{(selected.from_name||'?').slice(0,2).toUpperCase()}</div>
                  <span className="text-[13px] font-semibold" style={{color:'rgba(255,255,255,0.75)'}}>{selected.from_name}</span>
                </div>
                {selected.from_email && <span className="text-[11px]" style={{color:'rgba(255,255,255,0.28)'}}>{selected.from_email}</span>}
                <span className="ml-auto text-[11px]" style={{color:'rgba(255,255,255,0.22)'}}>{new Date(selected.received_at).toLocaleDateString('es-ES',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
              </div>
            </div>

            {/* ── AI ANALYSIS BLOCK ── */}
            {(selected.ai_summary||selected.ai_action||selected.ai_urgency) && (
              <div className="rounded-2xl overflow-hidden" style={{border:`1px solid rgba(27,95,250,0.18)`}}>
                {/* AI block header with urgency in it */}
                <div className="flex items-center gap-2.5 px-5 py-3.5" style={{background:'rgba(27,95,250,0.08)',borderBottom:`1px solid rgba(27,95,250,0.12)`}}>
                  <div className="w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:`${BLU}28`}}>
                    <LucideIcon name="sparkles" size={11} color={BLU}/>
                  </div>
                  <span className="font-syne text-[8.5px] font-black tracking-widest flex-1" style={{color:'rgba(120,155,255,0.85)'}}>BRUTAL.IA — ANÁLISIS</span>
                  {/* Urgency badge — no emoji, dot + label */}
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{background:uc(selected.ai_urgency)+'14',border:`1px solid ${uc(selected.ai_urgency)}28`}}>
                    <div className="w-1.5 h-1.5 rounded-full" style={{background:uc(selected.ai_urgency)}}/>
                    <span className="font-syne text-[7.5px] font-black" style={{color:uc(selected.ai_urgency)}}>{ul(selected.ai_urgency)}</span>
                  </div>
                </div>

                <div className="p-5 space-y-4" style={{background:'rgba(0,0,0,0.18)'}}>
                  {/* Summary */}
                  {selected.ai_summary && (
                    <div>
                      <div className="font-syne text-[7.5px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.2)'}}>RESUMEN</div>
                      <p className="text-[13px] leading-relaxed" style={{color:'rgba(235,235,250,0.78)'}}>{selected.ai_summary}</p>
                    </div>
                  )}
                  {/* Client + source row */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-xl p-3.5" style={{background:'rgba(255,255,255,0.04)',border:`1px solid rgba(255,255,255,0.06)`}}>
                      <div className="font-syne text-[7px] font-black tracking-widest mb-1.5" style={{color:'rgba(255,255,255,0.18)'}}>CLIENTE</div>
                      <div className="text-[12px] font-semibold truncate" style={{color:matchedClient?matchedClient.color:'rgba(255,255,255,0.45)'}}>{selected.ai_client&&selected.ai_client!=='Desconocido'?selected.ai_client:'—'}</div>
                    </div>
                    <div className="rounded-xl p-3.5" style={{background:'rgba(255,255,255,0.04)',border:`1px solid rgba(255,255,255,0.06)`}}>
                      <div className="font-syne text-[7px] font-black tracking-widest mb-1.5" style={{color:'rgba(255,255,255,0.18)'}}>CANAL</div>
                      <div className="text-[12px] font-semibold capitalize" style={{color:'rgba(255,255,255,0.5)'}}>{selected.source==='gmail'?'Gmail':selected.source==='internal'?'Interno':selected.source||'—'}</div>
                    </div>
                  </div>
                  {/* Action suggestion */}
                  {selected.ai_action&&selected.ai_action!=='Ninguna acción requerida' && (
                    <button onClick={()=>createTaskFromEmail(selected)} className="w-full text-left rounded-xl p-4 transition-opacity hover:opacity-75" style={{background:'rgba(27,95,250,0.1)',border:`1px solid rgba(27,95,250,0.2)`}}>
                      <div className="font-syne text-[7px] font-black tracking-widest mb-2" style={{color:'rgba(100,140,255,0.6)'}}>ACCIÓN SUGERIDA — CLICK PARA CREAR TAREA</div>
                      <div className="text-[12.5px]" style={{color:'rgba(235,235,250,0.7)'}}>{selected.ai_action}</div>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Client context */}
            {matchedClient && (
              <div className="rounded-2xl p-4" style={{background:SURFACE,border:`1px solid ${matchedClient.color}25`}}>
                <div className="font-syne text-[8px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.2)'}}>CLIENTE</div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center font-syne text-[11px] font-black flex-shrink-0" style={{background:matchedClient.color+'18',border:`1.5px solid ${matchedClient.color}30`,color:matchedClient.color}}>{matchedClient.initials}</div>
                  <div className="flex-1">
                    <div className="font-syne text-[13px] font-black text-white">{matchedClient.name}</div>
                    <div className="text-[11px] mt-0.5" style={{color:'rgba(255,255,255,0.3)'}}>{matchedClient.industry}</div>
                  </div>
                  <span className="font-syne text-[8px] font-black px-2 py-1 rounded-full" style={{background:matchedClient.status==='Activo'?`${GRN}12`:'rgba(255,255,255,0.05)',color:matchedClient.status==='Activo'?GRN:'rgba(255,255,255,0.3)'}}>{matchedClient.status}</span>
                </div>
                <div className="flex gap-2 mb-3">
                  {[
                    {n:data.projects.filter((p: any)=>p.client_id===matchedClient.id).length, l:'proyectos'},
                    {n:data.tasks.filter((t: any)=>!t.done&&t.client_id===matchedClient.id).length, l:'tareas activas'},
                  ].map((s,i)=>(
                    <div key={i} className="flex-1 text-center rounded-xl py-2.5" style={{background:SURF2}}>
                      <div className="font-figtree text-[18px] font-black" style={{color:matchedClient.color}}>{s.n}</div>
                      <div className="font-syne text-[8px]" style={{color:'rgba(255,255,255,0.28)'}}>{s.l}</div>
                    </div>
                  ))}
                </div>
                {onNavigate && onSelectClient && (
                  <button onClick={()=>{onSelectClient(matchedClient.id);onNavigate('clientes')}} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-syne text-[8.5px] font-black tracking-widest transition-all hover:opacity-80" style={{background:`${matchedClient.color}10`,border:`1px solid ${matchedClient.color}28`,color:`${matchedClient.color}bb`}}>
                    VER CLIENTE
                    <LucideIcon name="arrow-right" size={10} color={`${matchedClient.color}bb`}/>
                  </button>
                )}
              </div>
            )}

            {/* Related tasks */}
            {relatedTasks.length > 0 && (
              <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
                <div className="px-5 py-3.5 font-syne text-[8px] font-black tracking-widest" style={{borderBottom:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.2)'}}>TAREAS ACTIVAS — {matchedClient?.name}</div>
                {relatedTasks.map((t: any,i: number)=>(
                  <div key={t.id} className="flex items-center gap-3 px-5 py-3" style={{borderBottom:i<relatedTasks.length-1?`1px solid ${BORDER}`:'none'}}>
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.7)':BLU}}/>
                    <span className="text-[12px] flex-1 truncate" style={{color:'rgba(255,255,255,0.5)'}}>{t.text}</span>
                    {t.assignee && <div className="w-5 h-5 rounded-full flex items-center justify-center font-syne text-[7px] font-black flex-shrink-0" style={{background:t.assignee.avatar_color+'20',color:t.assignee.avatar_color}}>{t.assignee.initials}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* Attachments */}
            {selected.attachments && selected.attachments.length > 0 && (
              <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
                <div className="px-5 py-3.5 font-syne text-[8px] font-black tracking-widest" style={{borderBottom:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.2)'}}>ADJUNTOS — {selected.attachments.length}</div>
                {selected.attachments.map((att: any, i: number) => {
                  const ext = att.filename.split('.').pop()?.toUpperCase() || '?'
                  const sizeKb = Math.round(att.size / 1024)
                  const downloadUrl = `/api/inbox/attachment?msgId=${selected.gmail_id}&attId=${encodeURIComponent(att.attachmentId)}&filename=${encodeURIComponent(att.filename)}`
                  return (
                    <a key={i} href={downloadUrl} download={att.filename} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-3 px-5 py-3 group"
                      style={{borderBottom:i<selected.attachments.length-1?`1px solid ${BORDER}`:'none',textDecoration:'none'}}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center font-syne text-[9px] font-black flex-shrink-0" style={{background:'rgba(27,95,250,0.1)',color:BLU}}>{ext}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-medium truncate" style={{color:'rgba(255,255,255,0.72)'}}>{att.filename}</div>
                        <div className="font-syne text-[9px]" style={{color:'rgba(255,255,255,0.25)'}}>{sizeKb > 0 ? `${sizeKb} KB` : att.mimeType}</div>
                      </div>
                      <LucideIcon name="download" size={13} color="rgba(27,95,250,0.5)"/>
                    </a>
                  )
                })}
              </div>
            )}

            {/* Email body */}
            {selected.body_preview && (
              <div className="rounded-2xl p-5" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
                <div className="font-syne text-[8px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.18)'}}>CONTENIDO</div>
                <p className="text-[12px] leading-relaxed whitespace-pre-wrap" style={{color:'rgba(255,255,255,0.38)'}}>{selected.body_preview}</p>
              </div>
            )}
            <div className="flex items-center justify-center gap-3 py-1">
              <span className="font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.1)'}}>
                <kbd className="px-1 py-0.5 rounded" style={{background:'rgba(255,255,255,0.06)',fontFamily:'inherit'}}>J</kbd> siguiente
                {' · '}
                <kbd className="px-1 py-0.5 rounded" style={{background:'rgba(255,255,255,0.06)',fontFamily:'inherit'}}>K</kbd> anterior
                {' · '}
                <kbd className="px-1 py-0.5 rounded" style={{background:'rgba(255,255,255,0.06)',fontFamily:'inherit'}}>E</kbd> leído/no leído
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── CLIENTES SECTION ─────────────────────────────────────────
function ClientesSection({data,selectedId,onSelect,onOpenModal,onSetMf,showToast,isOwner,onNavigate,onSelectProject}: any) {
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

  const selected = selectedId ? data.clients.find((c: Client)=>c.id===selectedId) : null

  useEffect(() => { setClientEditOpen(false); setConfirmDeleteClient(false) }, [selectedId])

  useEffect(()=>{
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && clientEditOpen) setClientEditOpen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [clientEditOpen])

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

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center font-syne text-xl font-black flex-shrink-0" style={{background:selected.color+'18',border:`2px solid ${selected.color}35`,color:selected.color}}>{selected.initials}</div>
            <div>
              <div className="font-syne text-[9px] font-black tracking-widest mb-1" style={{color:'rgba(255,255,255,0.2)'}}>{selected.industry.toUpperCase()}</div>
              <h1 className="font-figtree text-[28px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>{selected.name}</h1>
              {isOwner ? (
                <div className="flex items-center gap-1.5 mt-2">
                  {([{s:'Activo',c:GRN},{s:'Pausado',c:'rgba(255,176,32,0.85)'},{s:'Archivado',c:'rgba(255,255,255,0.35)'}] as {s:'Activo'|'Pausado'|'Archivado';c:string}[]).map(opt=>(
                    <button key={opt.s} onClick={async()=>{await data.updateClient(selected.id,{status:opt.s});showToast(`Estado: ${opt.s}`)}} className="px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all" style={{background:selected.status===opt.s?opt.c+'18':'rgba(255,255,255,0.03)',border:`1px solid ${selected.status===opt.s?opt.c+'50':'rgba(255,255,255,0.08)'}`,color:selected.status===opt.s?opt.c:'rgba(255,255,255,0.3)'}}>{opt.s.toUpperCase()}</button>
                  ))}
                </div>
              ) : (
                <span className="font-syne text-[8px] font-black px-3 py-1 rounded-full mt-2 inline-block" style={{background:selected.status==='Activo'?'rgba(34,197,94,0.1)':'rgba(255,255,255,0.05)',color:selected.status==='Activo'?GRN:'rgba(255,255,255,0.3)'}}>{selected.status.toUpperCase()}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
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
                    <button onClick={()=>data.deleteClient(selected.id).then(()=>{handleBack();showToast('Cliente eliminado')})} className="px-3 py-2 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all" style={{background:'rgba(229,29,42,0.15)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR?</button>
                    <button onClick={()=>setConfirmDeleteClient(false)} className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-white/5" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={12} color="rgba(255,255,255,0.3)"/></button>
                  </div>
                : <button onClick={()=>setConfirmDeleteClient(true)} className="px-3 py-2 rounded-xl text-[11px] transition-all hover:bg-red-900/10" style={{color:'rgba(229,29,42,0.45)',border:'1px solid rgba(229,29,42,0.12)'}}>Eliminar</button>
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
              <button onClick={()=>setAiAdvice(null)} className="flex items-center justify-center w-6 h-6 rounded-lg transition-colors hover:bg-white/5" style={{color:'rgba(255,255,255,0.2)'}}><LucideIcon name="x" size={12} color="rgba(255,255,255,0.3)"/></button>
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

        {/* Client edit form */}
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

        {selected.notes && (
          <div className="mb-6 px-5 py-4 rounded-2xl" style={{background:'rgba(255,255,255,0.02)',border:`1px solid ${BORDER}`}}>
            <div className="font-syne text-[8px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.2)'}}>NOTAS INTERNAS</div>
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{color:'rgba(255,255,255,0.5)'}}>{selected.notes}</p>
          </div>
        )}
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
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[10px]" style={{color:'rgba(255,255,255,0.25)'}}>{(({'activo':'Activo','urgente':'Urgente','plan.':'Plan.','revisión':'Revisión','completado':'Completado'} as Record<string,string>)[p.status]||p.status)}</span>
                        {p.deadline && p.deadline!=='TBD' && (()=>{
                          const dOver = new Date(p.deadline+'T23:59:59')<new Date()
                          const dSoon = !dOver && new Date(p.deadline+'T23:59:59')<new Date(Date.now()+7*24*3600*1000)
                          return <span className="font-syne text-[8px] font-black px-1.5 py-0.5 rounded-full" style={{background:dOver?`${RED}15`:dSoon?'rgba(255,176,32,0.1)':'transparent',color:dOver?RED:dSoon?'rgba(255,176,32,0.8)':'rgba(255,255,255,0.25)'}}>{dOver&&'⚠ '}{new Date(p.deadline+'T00:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'})}</span>
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

          {/* Right: tasks + content + notes */}
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

  const [clientSearch, setClientSearch] = useState('')
  const [clientStatusFilter, setClientStatusFilter] = useState('Todos')

  // Parse revenue string → number (handles "€12.000/mes", "12000", "12.000€", etc.)
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

  return (
    <div className="p-8 max-w-[1200px] mx-auto">
      <div className="flex items-end justify-between mb-6">
        <div>
          <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-2" style={{color:'rgba(255,255,255,0.18)'}}>GESTIÓN</div>
          <h1 className="font-figtree text-[28px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Clientes</h1>
        </div>
        {isOwner && <button onClick={()=>onOpenModal('cliente')} className="flex items-center gap-2 px-5 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>+ NUEVO CLIENTE</button>}
      </div>
      {/* MRR Summary */}
      {totalMRR > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="col-span-1 rounded-2xl p-5" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            <div className="font-syne text-[8.5px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.2)'}}>MRR TOTAL</div>
            <div className="font-figtree text-[32px] font-black leading-none text-white" style={{letterSpacing:'-0.02em'}}>€{totalMRR.toLocaleString('es-ES')}</div>
            <div className="text-[11px] mt-1.5" style={{color:'rgba(255,255,255,0.3)'}}>{activeClients.length} clientes activos</div>
          </div>
          <div className="col-span-2 rounded-2xl p-5" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
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
        <div className="flex items-center gap-3 mb-6">
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl flex-1 max-w-xs" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            <LucideIcon name="search" size={13} color="rgba(255,255,255,0.2)"/>
            <input value={clientSearch} onChange={e=>setClientSearch(e.target.value)} placeholder="Busca cliente o sector…" className="flex-1 bg-transparent text-[12px] outline-none" style={{caretColor:BLU,color:'rgba(255,255,255,0.75)'}}/>
            {clientSearch && <button onClick={()=>setClientSearch('')}><LucideIcon name="x" size={11} color="rgba(255,255,255,0.2)"/></button>}
          </div>
          <div className="flex gap-1 p-1 rounded-2xl" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            {([{v:'Todos',c:'rgba(255,255,255,0.9)'},{v:'Activo',c:GRN},{v:'Pausado',c:'rgba(255,176,32,0.85)'},{v:'Archivado',c:'rgba(255,255,255,0.35)'}] as const).map(s=>(
              <button key={s.v} onClick={()=>setClientStatusFilter(s.v)} className="px-3.5 py-2 rounded-xl font-syne text-[8.5px] font-black tracking-wide transition-all" style={{background:clientStatusFilter===s.v?SURF2:'transparent',color:clientStatusFilter===s.v?s.c:'rgba(255,255,255,0.28)'}}>
                {s.v.toUpperCase()}
              </button>
            ))}
          </div>
          {(clientSearch||clientStatusFilter!=='Todos') && <span className="font-syne text-[9px] font-black" style={{color:'rgba(255,255,255,0.25)'}}>{visibleClients.length}</span>}
        </div>
      )}
      {data.clients.length === 0 ? (
        <div className="py-24 text-center">
          <div className="font-syne text-[11px] font-black tracking-widest mb-4" style={{color:'rgba(255,255,255,0.15)'}}>SIN CLIENTES</div>
          {isOwner && <button onClick={()=>onOpenModal('cliente')} className="font-syne text-[10px] font-black px-5 py-3 rounded-2xl" style={{background:'rgba(27,95,250,0.1)',color:BLU}}>CREAR PRIMER CLIENTE</button>}
        </div>
      ) : visibleClients.length === 0 ? (
        <div className="py-16 text-center">
          <div className="font-syne text-[10px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.15)'}}>SIN RESULTADOS</div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-5">
          {visibleClients.map((c: Client)=>{
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

                  {/* Last contact + unread badge */}
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
function ProyectosSection({data,filteredProjects,kanbanCols,projView,setProjView,projStatusFilter,setProjStatusFilter,dragRef,selectedId,onSelect,onOpenModal,onSetMf,showToast,isOwner,onNavigate,onSelectClient}: any) {
  const [editProgress, setEditProgress] = useState<number|null>(null)
  const [savingProgress, setSavingProgress] = useState(false)
  const [confirmDeleteProjId, setConfirmDeleteProjId] = useState<string|null>(null)
  const [confirmDeleteDetail, setConfirmDeleteDetail] = useState(false)
  const [projSearch, setProjSearch] = useState('')
  const [quickProjTask, setQuickProjTask] = useState('')
  const [quickProjCreating, setQuickProjCreating] = useState(false)
  const selectedProject: Project|null = selectedId ? data.projects.find((p: Project)=>p.id===selectedId)||null : null

  useEffect(() => { setEditProgress(null); setConfirmDeleteDetail(false); setQuickProjTask('') }, [selectedId])

  useEffect(()=>{
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && selectedId) onSelect(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedId, onSelect])

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
  return (
    <div className="p-8">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-2" style={{color:'rgba(255,255,255,0.18)'}}>GESTIÓN</div>
          <h1 className="font-figtree text-[28px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Proyectos</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex p-1 rounded-xl" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            {(['board','list'] as const).map(v=>(
              <button key={v} onClick={()=>setProjView(v)} className="px-3 py-2 rounded-lg font-syne text-[9px] font-black tracking-wide transition-all" style={{background:projView===v?SURF2:'transparent',color:projView===v?'rgba(255,255,255,0.9)':'rgba(240,240,248,0.3)'}}>
                {v==='board'?'TABLERO':'LISTA'}
              </button>
            ))}
          </div>
          {isOwner && <button onClick={()=>onOpenModal('proyecto')} className="flex items-center gap-2 px-5 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>+ PROYECTO</button>}
        </div>
      </div>
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-1 p-1 rounded-2xl" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
          {statusTabs.map(s=>{
            const cnt = s.id==='Todos' ? data.projects.length : data.projects.filter((p: Project)=>p.status===s.id).length
            return (
            <button key={s.id} onClick={()=>setProjStatusFilter(s.id)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl font-syne text-[9px] font-black tracking-wide transition-all" style={{background:projStatusFilter===s.id?SURF2:'transparent',color:projStatusFilter===s.id?'rgba(255,255,255,0.9)':'rgba(240,240,248,0.28)'}}>
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
      </div>
      {/* Quick project stats */}
      {data.projects.length > 0 && (()=>{
        const activeP = data.projects.filter((p: Project)=>p.status==='activo'||p.status==='urgente')
        const overdueP = data.projects.filter((p: Project)=>p.deadline&&p.deadline!=='TBD'&&p.status!=='completado'&&new Date(p.deadline+'T23:59:59')<new Date())
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
        <div className="grid gap-4" style={{gridTemplateColumns:`repeat(${kanbanCols.length},minmax(0,1fr))`}}>
          {kanbanCols.map((col: any)=>(
            <div key={col.status} className="rounded-2xl overflow-hidden" style={{background:col.status==='completado'?'rgba(255,255,255,0.01)':SURFACE,border:`1px solid ${col.status==='completado'?'rgba(255,255,255,0.04)':BORDER}`,opacity:col.status==='completado'?0.7:1}}
              onDragOver={(e)=>e.preventDefault()}
              onDrop={()=>{ if(dragRef.current) { data.updateProject(dragRef.current,{status:col.status}).then(()=>showToast(`Movido a ${col.title}`)); dragRef.current=null }}}>
              <div className="flex items-center gap-2.5 px-5 py-4" style={{borderBottom:`1px solid ${BORDER}`}}>
                <div className="w-2 h-2 rounded-full" style={{background:col.color}}/>
                <span className="font-syne text-[9px] font-black tracking-widest uppercase flex-1" style={{color:'rgba(255,255,255,0.4)'}}>{col.title}</span>
                <span className="font-syne text-[13px] font-black" style={{color:'rgba(255,255,255,0.2)'}}>{projSearch.trim()?col.items.filter((p: Project)=>p.name.toLowerCase().includes(projSearch.toLowerCase())||(p.client as any)?.name?.toLowerCase().includes(projSearch.toLowerCase())).length:col.items.length}</span>
              </div>
              <div className="p-3 space-y-2">
                {col.items.filter((p: Project)=>!projSearch.trim()||p.name.toLowerCase().includes(projSearch.toLowerCase())||(p.client as any)?.name?.toLowerCase().includes(projSearch.toLowerCase())).map((p: Project)=>(
                  <div key={p.id} draggable onDragStart={()=>dragRef.current=p.id} onClick={()=>onSelect(selectedId===p.id?null:p.id)} className="p-4 rounded-xl cursor-pointer transition-all" style={{background:selectedId===p.id?`rgba(27,95,250,0.08)`:SURF2,border:`1px solid ${selectedId===p.id?'rgba(27,95,250,0.3)':BORDER}`,boxShadow:selectedId===p.id?`0 0 0 1px rgba(27,95,250,0.15)`:'none'}}>
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
                      <span className="font-syne text-[8px] font-black px-2 py-1 rounded-lg" style={{background:statusColor(p.status)+'14',color:statusColor(p.status)}}>{statusLabel(p.status)}</span>
                      {p.deadline && p.deadline!=='TBD' && (()=>{
                        const dOver = new Date(p.deadline+'T23:59:59')<new Date()
                        const dSoon = !dOver && new Date(p.deadline+'T23:59:59')<new Date(Date.now()+7*24*3600*1000)
                        const diffDays = Math.round(Math.abs(new Date(p.deadline+'T23:59:59').getTime()-Date.now())/(1000*60*60*24))
                        const dLabel = dOver ? `−${diffDays}d` : diffDays===0 ? 'HOY' : `${diffDays}d`
                        return <span className="font-syne text-[8px] font-black px-1.5 py-0.5 rounded-full" style={{background:dOver?`${RED}18`:dSoon?'rgba(255,176,32,0.1)':'transparent',color:dOver?RED:dSoon?'rgba(255,176,32,0.85)':'rgba(255,255,255,0.25)'}}>{dLabel}</span>
                      })()}
                      {(()=>{ const n=data.tasks.filter((t:Task)=>t.project_id===p.id&&!t.done).length; if(n>0) return <span className="font-syne text-[7.5px] font-black px-1.5 py-0.5 rounded-full" style={{background:'rgba(27,95,250,0.08)',color:'rgba(100,140,255,0.6)'}}>{n}t</span>; if(p.status!=='completado'&&p.status!=='plan.') return <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full" style={{background:'rgba(255,176,32,0.07)',color:'rgba(255,176,32,0.5)'}}>SIN TAREAS</span>; return null })()}
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
          {filteredProjects.filter((p: Project)=>!projSearch.trim()||p.name.toLowerCase().includes(projSearch.toLowerCase())||(p.client as any)?.name?.toLowerCase().includes(projSearch.toLowerCase())).map((p: Project, i: number, arr: Project[])=>(
            <div key={p.id} onClick={()=>onSelect(selectedId===p.id?null:p.id)} className="group flex items-center gap-4 px-6 py-4 transition-colors cursor-pointer" style={{borderBottom:i<arr.length-1?`1px solid ${BORDER}`:'none',borderLeft:`3px solid ${selectedId===p.id?statusColor(p.status):statusColor(p.status)+'40'}`,background:selectedId===p.id?'rgba(27,95,250,0.06)':'transparent'}}
              onMouseEnter={e=>{ if(selectedId!==p.id)(e.currentTarget.style.background='rgba(255,255,255,0.015)') }}
              onMouseLeave={e=>{ if(selectedId!==p.id)(e.currentTarget.style.background='transparent') }}>
              <div className="relative flex-shrink-0">
                <ProgressRing pct={p.progress} size={34} stroke={2.5} color={p.color||BLU}/>
                <div className="absolute inset-0 flex items-center justify-center font-syne text-[7.5px] font-black" style={{color:'rgba(255,255,255,0.5)'}}>{p.progress}</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-figtree text-[14px] font-semibold text-white/88 truncate">{p.name}</div>
                <div className="text-[11px] mt-0.5" style={{color:'rgba(255,255,255,0.3)'}}>{p.client?.name||'—'}</div>
              </div>
              <span className="font-syne text-[8px] font-black px-2.5 py-1 rounded-full flex-shrink-0" style={{background:statusColor(p.status)+'14',color:statusColor(p.status)}}>{statusLabel(p.status)}</span>
              {p.deadline && p.deadline!=='TBD' && (()=>{
                const dOver = new Date(p.deadline+'T23:59:59')<new Date()
                const dSoon = !dOver && new Date(p.deadline+'T23:59:59')<new Date(Date.now()+7*24*3600*1000)
                const diffDays = Math.round(Math.abs(new Date(p.deadline+'T23:59:59').getTime()-Date.now())/(1000*60*60*24))
                const dLabel = dOver ? `−${diffDays}d` : diffDays===0 ? 'HOY' : `${diffDays}d`
                return <span className="font-syne text-[9px] font-black flex-shrink-0 px-1.5 py-0.5 rounded-full" style={{background:dOver?`${RED}18`:dSoon?'rgba(255,176,32,0.1)':'transparent',color:dOver?RED:dSoon?'rgba(255,176,32,0.85)':'rgba(255,255,255,0.28)'}}>{dLabel}</span>
              })()}
              {(()=>{ const n=data.tasks.filter((t:Task)=>t.project_id===p.id&&!t.done).length; if(n>0) return <span className="font-syne text-[7.5px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:'rgba(27,95,250,0.08)',color:'rgba(100,140,255,0.55)'}}>{n}t</span>; if(p.status!=='completado'&&p.status!=='plan.') return <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:'rgba(255,176,32,0.07)',color:'rgba(255,176,32,0.5)'}}>SIN TAREAS</span>; return null })()}
              {isOwner && (
                confirmDeleteProjId === p.id
                  ? <div className="flex items-center gap-1 flex-shrink-0" onClick={e=>e.stopPropagation()}>
                      <button onClick={()=>{ data.deleteProject(p.id).then(()=>showToast('Proyecto eliminado')); setConfirmDeleteProjId(null) }} className="px-2 py-1 rounded-lg font-syne text-[7.5px] font-black" style={{background:'rgba(229,29,42,0.15)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR?</button>
                      <button onClick={()=>setConfirmDeleteProjId(null)} className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/5" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={10} color="rgba(255,255,255,0.3)"/></button>
                    </div>
                  : <button onClick={e=>{e.stopPropagation();setConfirmDeleteProjId(p.id)}} className="opacity-0 group-hover:opacity-60 transition-opacity flex-shrink-0"><LucideIcon name="trash" size={13} color={RED}/></button>
              )}
            </div>
          ))}
          {filteredProjects.filter((p: Project)=>!projSearch.trim()||p.name.toLowerCase().includes(projSearch.toLowerCase())||(p.client as any)?.name?.toLowerCase().includes(projSearch.toLowerCase())).length===0&&<div className="py-16 text-center text-[13px]" style={{color:'rgba(255,255,255,0.18)'}}>{projSearch?'Sin resultados':' Sin proyectos en este filtro'}</div>}
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
                    const dl = new Date(selectedProject.deadline+'T23:59:59')
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
                      <button onClick={()=>data.deleteProject(selectedProject.id).then(()=>{onSelect(null);showToast('Proyecto eliminado')})} className="px-2.5 py-2 rounded-xl font-syne text-[8px] font-black transition-all" style={{background:'rgba(229,29,42,0.15)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR?</button>
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
            <div className="font-syne text-[8px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>ESTADO</div>
            <div className="flex gap-1.5 flex-wrap">
              {[{s:'plan.',l:'Planif.',c:'rgba(255,255,255,0.4)'},{s:'activo',l:'Activo',c:GRN},{s:'urgente',l:'Urgente',c:RED},{s:'revisión',l:'Revisión',c:'rgba(167,139,250,0.9)'},{s:'completado',l:'Completado',c:'rgba(34,197,94,0.6)'}].map(opt=>(
                <button key={opt.s} onClick={async()=>{ await data.updateProject(selectedProject.id,{status:opt.s}); showToast(`Estado: ${opt.l}`) }} className="px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all" style={{background:selectedProject.status===opt.s?opt.c+'18':SURF2,border:`1px solid ${selectedProject.status===opt.s?opt.c+'50':BORDER}`,color:selectedProject.status===opt.s?opt.c:'rgba(255,255,255,0.3)'}}>{opt.l.toUpperCase()}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-6 items-end">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="font-syne text-[8px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.25)'}}>PROGRESO</div>
                <span className="font-syne text-[10px] font-black" style={{color:selectedProject.color||BLU}}>{editProgress??selectedProject.progress}%</span>
              </div>
              <input type="range" min={0} max={100} step={5} value={editProgress??selectedProject.progress}
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
        </div>
      )}
    </div>
  )
}

// ── CONTENIDO SECTION ────────────────────────────────────────
function ContenidoSection({data,onOpenModal,showToast,onNavigate,onSelectClient}: any) {
  const [activeItem, setActiveItem] = useState<any>(null)
  const [editNotes, setEditNotes] = useState('')
  const [editVideoUrl, setEditVideoUrl] = useState('')
  const [editFeedback, setEditFeedback] = useState('')
  const [editAccountName, setEditAccountName] = useState('')
  const [editPublishDate, setEditPublishDate] = useState('')
  const [editPublishTime, setEditPublishTime] = useState('')
  const [accountFilter, setAccountFilter] = useState('Todas')
  const [clientFilter, setClientFilter] = useState('Todos')
  const [contentSearch, setContentSearch] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [confirmDeleteContent, setConfirmDeleteContent] = useState(false)

  useEffect(()=>{
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && activeItem) setActiveItem(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeItem])

  const platColor: Record<string,string> = {TikTok:'#ff0050',Instagram:'#C13584',LinkedIn:'#0A66C2',YouTube:'#FF0000',Twitter:'#1DA1F2',Pinterest:'#E60023'}

  const cols = [
    { key:'borrador', label:'En bruto', color:'rgba(255,255,255,0.42)' },
    { key:'pendiente', label:'En producción', color:'rgba(255,176,32,0.9)' },
    { key:'listo', label:'Listo', color:GRN },
    { key:'publicado', label:'Publicado', color:BLU },
  ]

  const openItem = (item: any) => {
    setActiveItem(item)
    setEditNotes(item.notes||'')
    setEditVideoUrl(item.video_url||'')
    setEditFeedback(item.feedback||'')
    setEditAccountName(item.account_name||'')
    setEditPublishDate(item.publish_date||'')
    setEditPublishTime(item.publish_time||'')
    setConfirmDeleteContent(false)
  }

  const saveNotes = async () => {
    if (!activeItem) return
    setSavingNotes(true)
    try {
      const updates: any = { notes: editNotes, video_url: editVideoUrl, feedback: editFeedback, account_name: editAccountName, publish_date: editPublishDate||undefined, publish_time: editPublishTime||undefined }
      await data.updateAgenda(activeItem.id, updates)
      showToast('Guardado')
      setActiveItem((prev: any) => ({...prev, ...updates}))
    } catch { showToast('Error guardando') }
    finally { setSavingNotes(false) }
  }

  const allAccounts: string[] = ['Todas', ...Array.from(new Set<string>(data.agenda.filter((a: any)=>a.account_name).map((a: any)=>a.account_name as string)))]
  const allContentClients: string[] = ['Todos', ...Array.from(new Set<string>(data.agenda.filter((a: any)=>a.client?.name||a.client_id).map((a: any)=>a.client?.name||(data.clients.find((c: any)=>c.id===a.client_id)?.name)||'').filter(Boolean)))]
  const filteredByClient = clientFilter === 'Todos' ? data.agenda : data.agenda.filter((a: any) => (a.client?.name||data.clients.find((c: any)=>c.id===a.client_id)?.name) === clientFilter)
  const filteredByAccount = accountFilter === 'Todas' ? filteredByClient : filteredByClient.filter((a: any)=>a.account_name===accountFilter)
  const filteredAgenda = !contentSearch.trim() ? filteredByAccount : filteredByAccount.filter((a: any)=>a.title?.toLowerCase().includes(contentSearch.toLowerCase()))

  const changeStatus = async (item: any, newStatus: string) => {
    try {
      await data.updateAgenda(item.id, { status: newStatus })
      if (activeItem?.id === item.id) setActiveItem((prev: any)=>({...prev, status: newStatus}))
      showToast('Estado actualizado')
    } catch { showToast('Error') }
  }

  const pc = activeItem ? (platColor[activeItem.platform]||BLU) : BLU

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── KANBAN ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex flex-col min-w-0">

        {/* Header */}
        <div className="px-8 pt-6 pb-5 flex-shrink-0" style={{borderBottom:`1px solid ${BORDER}`}}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-1.5" style={{color:'rgba(255,255,255,0.18)'}}>PRODUCCIÓN</div>
              <div className="flex items-baseline gap-3">
                <h1 className="font-figtree text-[26px] font-black text-white leading-none" style={{letterSpacing:'-0.04em'}}>Pipeline</h1>
                {(()=>{
                  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0)
                  const publishedThisMonth = data.agenda.filter((a: any)=>a.status==='publicado'&&a.publish_date&&new Date(a.publish_date+'T00:00:00')>=monthStart).length
                  return publishedThisMonth > 0 ? <span className="font-syne text-[8.5px] font-black" style={{color:'rgba(27,95,250,0.7)'}}>{publishedThisMonth} publicado{publishedThisMonth>1?'s':''} este mes</span> : null
                })()}
              </div>
              {data.agenda.length > 0 && (
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  {cols.map((col: any) => { const cnt = filteredAgenda.filter((a: any)=>a.status===col.key).length; return cnt > 0 ? <span key={col.key} className="font-syne text-[8.5px] font-black" style={{color:col.color+'80'}}>{cnt} {col.label.toLowerCase()}</span> : null })}
                  {data.agenda.length > 0 && (() => {
                    const platCounts: Record<string,number> = {}
                    filteredAgenda.forEach((a: any)=>{ if(a.platform) platCounts[a.platform]=(platCounts[a.platform]||0)+1 })
                    const platColors: Record<string,string> = {TikTok:'#ff0050',Instagram:'#C13584',LinkedIn:'#0A66C2',YouTube:'#FF0000',Twitter:'#1DA1F2',Pinterest:'#E60023'}
                    return Object.entries(platCounts).length > 0 ? (
                      <>
                        <span className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.12)'}}>·</span>
                        {Object.entries(platCounts).map(([p,n])=>(
                          <span key={p} className="flex items-center gap-1 font-syne text-[7.5px] font-black" style={{color:(platColors[p]||BLU)+'85'}}>
                            <PlatformLogo platform={p} size={9}/>{n as number}
                          </span>
                        ))}
                      </>
                    ) : null
                  })()}
                </div>
              )}
            </div>
            <button onClick={()=>onOpenModal('contenido')} className="flex items-center gap-2 px-5 py-2.5 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white transition-opacity hover:opacity-85" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
              + NUEVA PIEZA
            </button>
          </div>
          {/* Content search */}
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl mb-3" style={{background:SURFACE,border:`1px solid ${BORDER}`,maxWidth:'320px'}}>
            <LucideIcon name="search" size={12} color="rgba(255,255,255,0.2)"/>
            <input value={contentSearch} onChange={e=>setContentSearch(e.target.value)} placeholder="Busca por título…" className="flex-1 bg-transparent text-[12px] outline-none" style={{caretColor:BLU,color:'rgba(255,255,255,0.75)'}}/>
            {contentSearch && <button onClick={()=>setContentSearch('')}><LucideIcon name="x" size={11} color="rgba(255,255,255,0.2)"/></button>}
          </div>
          {/* Client filter */}
          {allContentClients.length > 1 && (
            <div className="flex gap-1.5 flex-wrap mb-2">
              {allContentClients.map((cl: string)=>{
                const isAll = cl === 'Todos'
                const isActive = clientFilter === cl
                const client = data.clients.find((c: any)=>c.name===cl)
                const clColor = client?.color || BLU
                return (
                  <button key={cl} onClick={()=>setClientFilter(cl)} className="font-syne text-[8.5px] font-black px-3 py-1.5 rounded-xl transition-all" style={{
                    background: isActive ? (isAll ? 'rgba(27,95,250,0.15)' : clColor+'18') : 'rgba(255,255,255,0.04)',
                    color: isActive ? (isAll ? BLU : clColor) : 'rgba(255,255,255,0.3)',
                    border: isActive ? `1px solid ${isAll ? 'rgba(27,95,250,0.3)' : clColor+'35'}` : '1px solid transparent',
                  }}>{cl}</button>
                )
              })}
            </div>
          )}
          {/* Account filter with platform icons */}
          {allAccounts.length > 1 && (
            <div className="flex gap-1.5 flex-wrap">
              {allAccounts.map((acc: string)=>{
                const isAll = acc === 'Todas'
                const isActive = accountFilter === acc
                const firstItem = data.agenda.find((a: any)=>a.account_name===acc)
                const accColor = firstItem ? (platColor[firstItem.platform]||BLU) : BLU
                return (
                  <button key={acc} onClick={()=>setAccountFilter(acc)} className="flex items-center gap-1.5 font-syne text-[8.5px] font-black px-3 py-1.5 rounded-xl transition-all" style={{
                    background: isActive ? (isAll ? 'rgba(27,95,250,0.15)' : accColor+'18') : 'rgba(255,255,255,0.04)',
                    color: isActive ? (isAll ? BLU : accColor) : 'rgba(255,255,255,0.3)',
                    border: isActive ? `1px solid ${isAll ? 'rgba(27,95,250,0.3)' : accColor+'35'}` : '1px solid transparent',
                  }}>
                    {!isAll && firstItem && <PlatformLogo platform={firstItem.platform} size={10} />}
                    {acc}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Empty state */}
        {data.agenda.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-xs">
              <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-8" style={{background:'rgba(27,95,250,0.06)',border:`1px solid rgba(27,95,250,0.1)`}}>
                <div className="flex items-end gap-1">
                  {[12,20,16,24].map((h,i)=>(
                    <div key={i} className="w-1.5 rounded-sm" style={{height:h,background:`rgba(27,95,250,${0.2+i*0.15})`}}/>
                  ))}
                </div>
              </div>
              <div className="font-figtree text-[22px] font-black text-white mb-2.5" style={{letterSpacing:'-0.03em'}}>Sin contenido aún</div>
              <div className="text-[13px] mb-8 leading-relaxed" style={{color:'rgba(255,255,255,0.28)'}}>Añade tu primera pieza para empezar el pipeline de producción</div>
              <button onClick={()=>onOpenModal('contenido')} className="font-syne text-[10px] font-black px-7 py-3.5 rounded-2xl text-white" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>+ NUEVA PIEZA</button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-x-auto overflow-y-hidden">
            <div className="flex h-full gap-4 p-6" style={{minWidth:'920px'}}>
              {cols.map(col=>{
                const items = filteredAgenda.filter((a: any)=>a.status===col.key)
                return (
                  <div key={col.key} className="flex flex-col flex-1 min-w-[218px] rounded-2xl overflow-hidden"
                    style={{background:'rgba(255,255,255,0.02)',border:`1px solid rgba(255,255,255,0.055)`}}>
                    {/* Column header */}
                    <div className="px-4 pt-4 pb-3.5 flex-shrink-0 flex items-center justify-between" style={{borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{background:col.color}}/>
                        <span className="font-syne text-[10px] font-black tracking-wide" style={{color:'rgba(255,255,255,0.62)'}}>{col.label}</span>
                      </div>
                      {items.length > 0 && (
                        <span className="font-figtree text-[12px] font-black" style={{color:col.color+'70'}}>{items.length}</span>
                      )}
                    </div>
                    {/* Cards */}
                    <div className="flex-1 overflow-y-auto p-3 space-y-2.5"
                      onDragOver={e=>e.preventDefault()}
                      onDrop={e=>{
                        const id = e.dataTransfer.getData('text/plain')
                        const item = data.agenda.find((a: any)=>a.id===id)
                        if (item && item.status!==col.key) changeStatus(item, col.key)
                      }}>
                      {items.map((item: any)=>{
                        const ipc = platColor[item.platform]||BLU
                        const isActive = activeItem?.id===item.id
                        return (
                          <div key={item.id}
                            draggable
                            onDragStart={e=>e.dataTransfer.setData('text/plain',item.id)}
                            onClick={()=>openItem(item)}
                            className="group rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 hover:-translate-y-0.5"
                            style={{
                              background: isActive ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.035)',
                              border: `1px solid ${isActive ? ipc+'40' : 'rgba(255,255,255,0.08)'}`,
                              boxShadow: isActive ? `0 0 28px ${ipc}16, 0 6px 20px rgba(0,0,0,0.4)` : '0 2px 8px rgba(0,0,0,0.2)',
                            }}>
                            {/* Platform strip */}
                            <div className="flex items-center gap-2 px-3.5 py-2.5" style={{
                              background:`linear-gradient(90deg,${ipc}1A,${ipc}08)`,
                              borderBottom:`1px solid ${ipc}16`,
                            }}>
                              <PlatformLogo platform={item.platform} size={14} />
                              <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
                                <span className="font-syne text-[8px] font-black tracking-widest flex-shrink-0" style={{color:ipc}}>{item.platform.toUpperCase()}</span>
                                {item.account_name && <span className="font-syne text-[7.5px] truncate" style={{color:`${ipc}65`}}>@{item.account_name}</span>}
                              </div>
                              <div className="flex gap-1 flex-shrink-0">
                                {item.video_url && <div className="w-1.5 h-1.5 rounded-full" style={{background:'rgba(255,80,80,0.6)'}}/>}
                                {item.feedback && <div className="w-1.5 h-1.5 rounded-full" style={{background:'rgba(255,176,32,0.6)'}}/>}
                                {item.notes && <div className="w-1.5 h-1.5 rounded-full" style={{background:'rgba(255,255,255,0.22)'}}/>}
                              </div>
                            </div>
                            {/* Card body */}
                            <div className="px-3.5 pt-3 pb-3.5">
                              <div className="font-figtree text-[13px] font-semibold leading-snug line-clamp-2 mb-3" style={{color:'rgba(255,255,255,0.9)'}}>{item.title}</div>
                              <div className="flex items-center gap-2">
                                {(() => { const ic = item.client || (item.client_id ? data.clients.find((c: any)=>c.id===item.client_id) : null); return ic ? <button onClick={e=>{e.stopPropagation();onSelectClient?.(ic.id);onNavigate?.('clientes')}} className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full truncate max-w-[100px] transition-all hover:opacity-75" style={{background:(ic.color||BLU)+'15',color:(ic.color||BLU)+'cc'}}>{ic.name}</button> : null })()}
                                {item.publish_date && item.status!=='publicado' && (()=>{
                                  const todayStr2 = new Date().toISOString().split('T')[0]
                                  const isToday2 = item.publish_date.slice(0,10)===todayStr2
                                  const dOver = !isToday2 && new Date(item.publish_date+'T23:59:59')<new Date()
                                  const dSoon = !dOver && !isToday2 && new Date(item.publish_date+'T23:59:59')<new Date(Date.now()+3*24*3600*1000)
                                  const label = isToday2 ? (item.publish_time?`HOY ${item.publish_time.slice(0,5)}`:'HOY') : new Date(item.publish_date+'T00:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'})
                                  return <span className="font-syne text-[8px] ml-auto flex-shrink-0 px-1.5 py-0.5 rounded-full" style={{background:isToday2?`rgba(255,176,32,0.18)`:dOver?`${RED}15`:dSoon?'rgba(255,176,32,0.1)':'transparent',color:isToday2?'rgba(255,176,32,0.95)':dOver?RED:dSoon?'rgba(255,176,32,0.8)':'rgba(255,255,255,0.22)'}}>{label}</span>
                                })()}
                                {!item.publish_date && item.status!=='publicado' && (
                                  <span className="font-syne text-[7px] font-black ml-auto flex-shrink-0 px-1.5 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.18)',border:'1px dashed rgba(255,255,255,0.1)'}}>SIN FECHA</span>
                                )}
                                {(()=>{
                                  const nextMap: Record<string,string> = {borrador:'pendiente',pendiente:'listo',listo:'publicado'}
                                  const nextStatus = nextMap[item.status]
                                  const nextLabel: Record<string,string> = {pendiente:'En prod.',listo:'Listo',publicado:'Publicado'}
                                  if (!nextStatus) return null
                                  return (
                                    <button onClick={e=>{e.stopPropagation();changeStatus(item, nextStatus)}} className="ml-auto flex-shrink-0 opacity-0 group-hover:opacity-100 font-syne text-[7px] font-black px-2 py-1 rounded-lg transition-all" style={{background:col.color+'18',color:col.color+'cc',border:`1px solid ${col.color}30`}}>
                                      → {nextLabel[nextStatus]}
                                    </button>
                                  )
                                })()}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                      {/* Empty drop target */}
                      {items.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-10 rounded-xl" style={{border:`1px dashed ${col.color}22`,minHeight:80}}>
                          <div className="w-4 h-4 rounded-full mb-2" style={{background:col.color+'0D',border:`1px solid ${col.color}28`}}/>
                          <div className="font-syne text-[7.5px] font-black tracking-[0.2em]" style={{color:'rgba(255,255,255,0.1)'}}>ARRASTRA AQUÍ</div>
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

      {/* ── DETAIL PANEL ─────────────────────────────────────────── */}
      {activeItem && (
        <div className="w-[390px] flex-shrink-0 flex flex-col overflow-hidden" style={{borderLeft:`1px solid ${BORDER}`,background:'#050510'}}>
          {/* Panel header */}
          <div className="flex-shrink-0" style={{borderBottom:`1px solid ${BORDER}`}}>
            <div className="px-6 pt-6 pb-4" style={{background:`linear-gradient(160deg,${pc}16 0%,transparent 60%)`}}>
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {/* Big platform logo */}
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{background:`${pc}18`,border:`1px solid ${pc}28`}}>
                    <PlatformLogo platform={activeItem.platform} size={26} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <span className="font-syne text-[9px] font-black tracking-widest" style={{color:pc}}>{activeItem.platform.toUpperCase()}</span>
                      {activeItem.account_name && <span className="font-syne text-[8px]" style={{color:'rgba(255,255,255,0.28)'}}>@{activeItem.account_name}</span>}
                    </div>
                    <div className="font-figtree text-[15px] font-bold text-white leading-snug line-clamp-2" style={{letterSpacing:'-0.01em'}}>{activeItem.title}</div>
                  </div>
                </div>
                <button onClick={()=>setActiveItem(null)} className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ml-3" style={{background:'rgba(255,255,255,0.05)'}}>
                  <LucideIcon name="x" size={13} color="rgba(255,255,255,0.35)"/>
                </button>
              </div>
              {/* Status track */}
              <div className="flex gap-1.5">
                {cols.map(col=>(
                  <button key={col.key} onClick={()=>changeStatus(activeItem, col.key)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl font-syne text-[7.5px] font-black tracking-wide transition-all"
                    style={{
                      background: activeItem.status===col.key ? col.color+'1A' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${activeItem.status===col.key ? col.color+'50' : 'rgba(255,255,255,0.06)'}`,
                      color: activeItem.status===col.key ? col.color : 'rgba(255,255,255,0.22)',
                    }}>
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:activeItem.status===col.key ? col.color : 'rgba(255,255,255,0.12)'}}/>
                    <span className="truncate">{col.label.toUpperCase()}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Scrollable fields */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5" onKeyDown={(e)=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!savingNotes){e.preventDefault();saveNotes()}}}>
            <div>
              <div className="font-syne text-[9px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.22)'}}>FECHA DE PUBLICACIÓN</div>
              <div className="flex gap-2">
                <input type="date" value={editPublishDate} onChange={e=>setEditPublishDate(e.target.value)} className="flex-1 px-4 py-2.5 rounded-xl text-[12px] text-white outline-none transition-all" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU,colorScheme:'dark'}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.35)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
                <input type="time" value={editPublishTime} onChange={e=>setEditPublishTime(e.target.value)} className="w-[112px] px-3 py-2.5 rounded-xl text-[12px] text-white outline-none transition-all" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU,colorScheme:'dark'}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.35)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
              </div>
            </div>
            <div>
              <div className="font-syne text-[9px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.22)'}}>CUENTA / PERFIL</div>
              <input value={editAccountName} onChange={e=>setEditAccountName(e.target.value)} placeholder="Ej: Brutal Studios, Pablo, Julio Flores…" className="w-full px-4 py-2.5 rounded-xl text-[12px] text-white placeholder-white/20 outline-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.35)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
            </div>
            <div>
              <div className="font-syne text-[9px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.22)'}}>LINK DE VÍDEO</div>
              <input value={editVideoUrl} onChange={e=>setEditVideoUrl(e.target.value)} placeholder="YouTube / Vimeo URL…" className="w-full px-4 py-2.5 rounded-xl text-[12px] text-white placeholder-white/20 outline-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.35)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
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
            <div>
              <div className="font-syne text-[9px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.22)'}}>FEEDBACK DEL CLIENTE</div>
              <textarea value={editFeedback} onChange={e=>setEditFeedback(e.target.value)} placeholder="Revisiones o comentarios del cliente…" rows={3} className="w-full px-4 py-3 rounded-xl text-[12px] text-white placeholder-white/20 outline-none resize-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU,lineHeight:'1.65'}} onFocus={e=>(e.target.style.borderColor='rgba(255,176,32,0.35)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
            </div>
            <div>
              <div className="font-syne text-[9px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.22)'}}>NOTAS DE PRODUCCIÓN</div>
              <textarea value={editNotes} onChange={e=>setEditNotes(e.target.value)} placeholder="Añade notas del equipo…" rows={4} className="w-full px-4 py-3.5 rounded-xl text-[12px] text-white placeholder-white/20 outline-none resize-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU,lineHeight:'1.65'}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.35)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
            </div>
            <div>
              <div className="font-syne text-[9px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.22)'}}>REVISIÓN DE CLIENTE</div>
              <button onClick={()=>{
                const url = `${window.location.origin}/review/${activeItem.id}`
                navigator.clipboard.writeText(url).then(()=>showToast('Link copiado al portapapeles'))
              }} className="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-wide transition-opacity hover:opacity-70" style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.45)'}}>
                <LucideIcon name="link" size={12} color="rgba(255,255,255,0.35)"/>
                <span>Compartir con cliente</span>
                <span className="ml-auto"><LucideIcon name="copy" size={10} color="rgba(255,255,255,0.2)"/></span>
              </button>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={saveNotes} disabled={savingNotes} className="flex-1 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-wide text-white disabled:opacity-40 transition-opacity" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>{savingNotes?'GUARDANDO…':'GUARDAR CAMBIOS'}</button>
              {confirmDeleteContent
                ? <div className="flex items-center gap-1">
                    <button onClick={async()=>{await data.deleteAgenda(activeItem.id);setActiveItem(null);showToast('Pieza eliminada')}} className="px-3 py-2.5 rounded-xl font-syne text-[8px] font-black transition-all" style={{background:'rgba(229,29,42,0.15)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR?</button>
                    <button onClick={()=>setConfirmDeleteContent(false)} className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={12} color="rgba(255,255,255,0.3)"/></button>
                  </div>
                : <button onClick={()=>setConfirmDeleteContent(true)} className="px-4 py-2.5 rounded-xl font-syne text-[9px] font-black transition-all" style={{color:'rgba(229,29,42,0.45)',border:`1px solid rgba(229,29,42,0.12)`}}>
                    <LucideIcon name="trash" size={12} color="rgba(229,29,42,0.45)"/>
                  </button>
              }
            </div>
            <div className="font-syne text-[7.5px] font-bold tracking-widest text-center" style={{color:'rgba(255,255,255,0.1)'}}>⌘+ENTER PARA GUARDAR</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── CALENDARIO SECTION ───────────────────────────────────────
function CalendarioSection({data, profile, showToast, onOpenModal, onSetMf}: any) {
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
      showToast(`${events.length} eventos de Google Calendar sincronizados`)
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
      const d = new Date(p.deadline+'T00:00:00')
      if (!isNaN(d.getTime())) addEvent(p.deadline, {type:'project', label:p.name, color:p.color||GRN, raw:p})
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
          {(()=>{
            const monthKey = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}`
            const monthEventCount = Object.keys(eventsByDay).filter(k=>k.startsWith(monthKey)).reduce((s,k)=>s+eventsByDay[k].length,0)
            return monthEventCount > 0 ? <span className="font-syne text-[8px] font-black px-2.5 py-1 rounded-full" style={{background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.25)'}}>{monthEventCount} evento{monthEventCount>1?'s':''}</span> : null
          })()}
          {/* Legend */}
          <div className="ml-auto flex items-center gap-4 text-[10px]" style={{color:'rgba(255,255,255,0.3)'}}>
            {[{c:'#a78bfa',l:'Google Cal'},{c:BLU,l:'Contenido'},{c:'rgba(255,176,32,0.8)',l:'Tarea'},{c:GRN,l:'Proyecto'}].map(x=>(
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
      <div className="w-[320px] flex-shrink-0 flex flex-col overflow-hidden" style={{borderLeft:`1px solid ${BORDER}`,background:'#050510'}}>
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

// ── MEMORIA SECTION ──────────────────────────────────────────
function MemoriaSection({data,memFilter,setMemFilter,onOpenModal,showToast}: any) {
  const [memSearch, setMemSearch] = useState('')
  const [expanded, setExpanded] = useState<string|null>(null)
  const [editing, setEditing] = useState<string|null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [confirmDeleteMemId, setConfirmDeleteMemId] = useState<string|null>(null)
  const [copiedId, setCopiedId] = useState<string|null>(null)
  const [memSort, setMemSort] = useState<'reciente'|'az'>('reciente')
  const [memClientFilter, setMemClientFilter] = useState<string>('Todos')
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(()=>{
    try { return new Set(JSON.parse(localStorage.getItem('pinned_memoria')||'[]')) } catch { return new Set() }
  })

  const togglePin = (id: string) => {
    setPinnedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      try { localStorage.setItem('pinned_memoria', JSON.stringify([...next])) } catch {}
      return next
    })
  }

  useEffect(()=>{
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && editing) { setEditing(null); return }
      if (e.key === 'n' && !editing && !['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) && !(e.metaKey||e.ctrlKey||e.altKey)) {
        e.preventDefault(); onOpenModal('memoria')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editing, onOpenModal])
  const cats = ['Todos','Clientes','Procesos','Decisiones','Aprendizajes','General']
  const catColor: Record<string,string> = { Clientes:BLU, Procesos:'rgba(255,176,32,0.9)', Decisiones:RED, Aprendizajes:GRN, General:'rgba(167,139,250,0.8)' }
  const memoryClients = data.clients.filter((c: Client)=>data.memoria.some((m: any)=>m.client?.id===c.id))
  const byFilter = memFilter==='Todos' ? data.memoria : data.memoria.filter((m: any)=>m.category===memFilter)
  const byClientFilter = memClientFilter==='Todos' ? byFilter : byFilter.filter((m: any)=>m.client?.id===memClientFilter)
  const filtered = (memSearch.trim()
    ? byClientFilter.filter((m: any)=>(m.title+' '+m.content).toLowerCase().includes(memSearch.toLowerCase()))
    : byClientFilter).sort((a: any, b: any) => {
      const pinDiff = (pinnedIds.has(b.id)?1:0) - (pinnedIds.has(a.id)?1:0)
      if (pinDiff !== 0) return pinDiff
      if (memSort === 'az') return (a.title||'').localeCompare(b.title||'', 'es', {sensitivity:'base'})
      return new Date(b.created_at||0).getTime() - new Date(a.created_at||0).getTime()
    })
  return (
    <div className="p-8 max-w-[900px] mx-auto">
      <div className="flex items-end justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="font-syne text-[9px] font-black tracking-[0.25em]" style={{color:'rgba(255,255,255,0.18)'}}>CEREBRO</div>
            {data.memoria.length > 0 && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.2)'}}>{data.memoria.length}</span>}
          </div>
          <h1 className="font-figtree text-[28px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Memoria</h1>
          {data.memoria.length > 0 && (()=>{
            const wordCount = data.memoria.reduce((s: number, m: any)=>s+(m.content||'').split(/\s+/).filter(Boolean).length,0)
            return <div className="font-syne text-[8px] font-black tracking-widest mt-1" style={{color:'rgba(255,255,255,0.15)'}}>{wordCount.toLocaleString('es-ES')} PALABRAS</div>
          })()}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex p-1 rounded-xl" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            {([{id:'reciente',label:'↓',title:'Más recientes primero'},{id:'az',label:'A·Z',title:'Orden alfabético'}] as const).map(s=>(
              <button key={s.id} onClick={()=>setMemSort(s.id)} title={s.title} className="px-3 py-2 rounded-lg font-syne text-[9px] font-black tracking-wide transition-all" style={{background:memSort===s.id?SURF2:'transparent',color:memSort===s.id?'rgba(255,255,255,0.8)':'rgba(255,255,255,0.25)'}}>
                {s.label}
              </button>
            ))}
          </div>
          <button onClick={()=>{
            const md = data.memoria.map((m: any)=>`# ${m.title}\n**Categoría:** ${m.category}\n**Fecha:** ${m.created_at?.slice(0,10)||''}\n\n${m.content}`).join('\n\n---\n\n')
            const blob = new Blob([md], {type:'text/markdown'})
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = `memoria-${new Date().toISOString().slice(0,10)}.md`
            a.click()
            URL.revokeObjectURL(a.href)
            showToast(`${data.memoria.length} entradas exportadas`)
          }} className="flex items-center gap-2 px-4 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest" style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.35)'}} title="Exportar como Markdown">
            <LucideIcon name="download" size={13} color="rgba(255,255,255,0.35)"/>
            <span>MD</span>
          </button>
          <button onClick={()=>onOpenModal('memoria')} className="flex items-center gap-2 px-5 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>+ ENTRADA</button>
        </div>
      </div>
      {/* Search */}
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl mb-5" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
        <LucideIcon name="search" size={13} color="rgba(255,255,255,0.2)"/>
        <input value={memSearch} onChange={e=>setMemSearch(e.target.value)} placeholder="Busca en la memoria…" className="flex-1 bg-transparent text-[13px] outline-none" style={{caretColor:BLU,color:'rgba(255,255,255,0.8)'}}/>
        {memSearch && <button onClick={()=>setMemSearch('')} className="flex-shrink-0"><LucideIcon name="x" size={12} color="rgba(255,255,255,0.2)"/></button>}
      </div>
      {/* Category filter */}
      <div className="flex gap-1 mb-3 p-1 rounded-2xl w-fit" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
        {cats.map(c=>{
          const cnt = c==='Todos' ? data.memoria.length : data.memoria.filter((m:any)=>m.category===c).length
          return (
            <button key={c} onClick={()=>setMemFilter(c)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl font-syne text-[9px] font-black tracking-wide transition-all" style={{background:memFilter===c?(c==='Todos'?SURF2:(catColor[c]||'rgba(255,255,255,0.3)')+'14'):'transparent',color:memFilter===c?(c==='Todos'?'#F0F0F8':(catColor[c]||'rgba(240,240,248,0.7)')):'rgba(240,240,248,0.3)'}}>
              {c}
              {cnt > 0 && <span className="text-[7px] font-black px-1 rounded-sm" style={{background:memFilter===c?'rgba(255,255,255,0.1)':'transparent',color:memFilter===c?'rgba(255,255,255,0.5)':'rgba(255,255,255,0.2)'}}>{cnt}</span>}
            </button>
          )
        })}
      </div>
      {/* Client filter chips */}
      {memoryClients.length > 0 && (
        <div className="flex items-center gap-1 mb-5 flex-wrap">
          <button onClick={()=>setMemClientFilter('Todos')} className="flex items-center gap-1 px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all" style={{background:memClientFilter==='Todos'?SURF2:'transparent',border:`1px solid ${memClientFilter==='Todos'?'rgba(255,255,255,0.12)':BORDER}`,color:memClientFilter==='Todos'?'rgba(255,255,255,0.7)':'rgba(255,255,255,0.25)'}}>Todos</button>
          {memoryClients.map((c: Client)=>{
            const cnt = byFilter.filter((m: any)=>m.client?.id===c.id).length
            return (
              <button key={c.id} onClick={()=>setMemClientFilter(memClientFilter===c.id?'Todos':c.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all" style={{background:memClientFilter===c.id?c.color+'14':'transparent',border:`1px solid ${memClientFilter===c.id?c.color+'40':BORDER}`,color:memClientFilter===c.id?c.color+'cc':'rgba(255,255,255,0.25)'}}>
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:memClientFilter===c.id?c.color:c.color+'60'}}/>
                {c.name}
                <span className="text-[6.5px]" style={{opacity:0.6}}>{cnt}</span>
              </button>
            )
          })}
        </div>
      )}
      <div className="space-y-2">
        {filtered.map((m: any)=>{
          const isExp = expanded===m.id
          const isLong = (m.content||'').length > 120
          return (
          <div key={m.id} className="rounded-2xl transition-all group" style={{background:SURFACE,border:`1px solid ${isExp?'rgba(27,95,250,0.2)':BORDER}`}}>
            <div className="flex items-start gap-4 p-5 cursor-pointer" onClick={()=>setExpanded(isExp?null:m.id)}>
              {(()=>{ const cc=catColor[m.category]||'rgba(167,139,250,0.8)'; const ci:Record<string,string>={Clientes:'users-2',Procesos:'layers',Decisiones:'flag',Aprendizajes:'lightbulb',General:'brain'}; const ic=ci[m.category]||'brain'; return (<div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5" style={{background:cc+'14',border:`1px solid ${cc}25`}}><LucideIcon name={ic} size={15} color={cc+'bb'}/></div>) })()}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="font-figtree text-[14px] font-semibold text-white">{m.title}</span>
                  <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-lg" style={{background:(catColor[m.category]||'rgba(255,255,255,0.3)')+'18',color:(catColor[m.category]||'rgba(255,255,255,0.3)')+'99'}}>{m.category}</span>
                  {m.created_at && <span className="font-syne text-[7.5px]" style={{color:'rgba(255,255,255,0.18)'}}>{new Date(m.created_at).toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'})}</span>}
                  {m.created_at && Date.now()-new Date(m.created_at).getTime() < 7*24*60*60*1000 && <span className="font-syne text-[6.5px] font-black px-1.5 py-0.5 rounded-full" style={{background:'rgba(34,197,94,0.12)',color:'rgba(34,197,94,0.65)'}}>NUEVO</span>}
                  {pinnedIds.has(m.id) && <span className="font-syne text-[6.5px] font-black px-1.5 py-0.5 rounded-full" style={{background:'rgba(255,176,32,0.1)',color:'rgba(255,176,32,0.7)'}}>FIJADA</span>}
                  {m.client?.name && <span className="font-syne text-[7px] font-black px-2 py-0.5 rounded-full flex-shrink-0" style={{background:(m.client.color||BLU)+'14',color:(m.client.color||BLU)+'bb'}}>{m.client.name}</span>}
                </div>
                <div className={`text-[12px] leading-relaxed ${isExp?'':'line-clamp-2'}`} style={{color:'rgba(255,255,255,0.45)'}}>{m.content}</div>
                {!isExp && isLong && <div className="font-syne text-[8px] font-black mt-1.5 transition-colors" style={{color:'rgba(27,95,250,0.5)'}}>VER MÁS</div>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {isLong && <LucideIcon name={isExp?'chevron-up':'chevron-down'} size={13} color="rgba(255,255,255,0.2)"/>}
                <button onClick={e=>{e.stopPropagation();togglePin(m.id)}} className={`transition-opacity ${pinnedIds.has(m.id)?'opacity-60':'opacity-0 group-hover:opacity-30 hover:!opacity-60'}`} title={pinnedIds.has(m.id)?'Desfijar':'Fijar arriba'}><LucideIcon name="pin" size={12} color={pinnedIds.has(m.id)?'rgba(255,176,32,0.9)':'rgba(255,255,255,0.6)'}/></button>
                <button onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(`# ${m.title}\n\n${m.content||''}`).then(()=>{setCopiedId(m.id);setTimeout(()=>setCopiedId(null),2000)})}} className="opacity-0 group-hover:opacity-30 hover:!opacity-60 transition-opacity"><LucideIcon name={copiedId===m.id?'check':'copy'} size={12} color={copiedId===m.id?GRN:BLU}/></button>
                <button onClick={e=>{e.stopPropagation();if(editing===m.id){setEditing(null)}else{setEditing(m.id);setEditTitle(m.title);setEditContent(m.content||'');setEditCategory(m.category||'General');setExpanded(m.id)}}} className="opacity-0 group-hover:opacity-30 hover:!opacity-60 transition-opacity"><LucideIcon name="pencil" size={13} color={BLU}/></button>
                {confirmDeleteMemId === m.id
                  ? <div className="flex items-center gap-1" onClick={e=>e.stopPropagation()}>
                      <button onClick={e=>{e.stopPropagation();data.deleteMemoria(m.id).then(()=>showToast('Eliminado'));setConfirmDeleteMemId(null)}} className="px-2 py-1 rounded-lg font-syne text-[7.5px] font-black transition-all" style={{background:'rgba(229,29,42,0.15)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR?</button>
                      <button onClick={e=>{e.stopPropagation();setConfirmDeleteMemId(null)}} className="w-6 h-6 rounded-lg flex items-center justify-center transition-colors hover:bg-white/5" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={10} color="rgba(255,255,255,0.3)"/></button>
                    </div>
                  : <button onClick={e=>{e.stopPropagation();setConfirmDeleteMemId(m.id)}} className="opacity-0 group-hover:opacity-30 hover:!opacity-60 transition-opacity"><LucideIcon name="trash" size={14} color={RED}/></button>
                }
              </div>
            </div>
            {isExp && editing===m.id && (
              <div className="px-5 pb-5 pt-0 space-y-3" onClick={e=>e.stopPropagation()}>
                <input value={editTitle} onChange={e=>setEditTitle(e.target.value)} className="w-full px-3 py-2 rounded-xl text-[13px] text-white placeholder-white/20 outline-none" style={{background:SURF2,border:`1.5px solid rgba(27,95,250,0.25)`,caretColor:BLU}}/>
                <div className="flex flex-wrap gap-1.5">
                  {(['Clientes','Procesos','Decisiones','Aprendizajes','General'] as const).map(cat=>{
                    const cc = catColor[cat]||'rgba(255,255,255,0.3)'
                    const isAct = editCategory===cat
                    return <button key={cat} onClick={()=>setEditCategory(cat)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-syne text-[8.5px] font-black tracking-wide transition-all" style={{background:isAct?cc+'18':SURF2,border:`1.5px solid ${isAct?cc+'55':BORDER}`,color:isAct?cc:'rgba(255,255,255,0.3)'}}>
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:isAct?cc:'rgba(255,255,255,0.15)'}}/>
                      {cat}
                    </button>
                  })}
                </div>
                <div>
                  <textarea value={editContent} onChange={e=>setEditContent(e.target.value)} rows={4} className="w-full px-3 py-2.5 rounded-xl text-[12px] text-white placeholder-white/20 outline-none resize-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU,lineHeight:'1.65'}}/>
                  <div className="flex justify-end mt-1">
                    <span className="font-syne text-[8px] font-black" style={{color:'rgba(255,255,255,0.15)'}}>{editContent.length} car · {editContent.split(/\s+/).filter(Boolean).length} pal.</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={async()=>{setSavingEdit(true);try{await data.updateMemoria(m.id,{title:editTitle.trim(),content:editContent.trim(),category:editCategory});showToast('Actualizado');setEditing(null)}catch{showToast('Error')}finally{setSavingEdit(false)}}} disabled={savingEdit||!editTitle.trim()} className="px-4 py-2 rounded-xl font-syne text-[8.5px] font-black tracking-widest text-white disabled:opacity-40" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>{savingEdit?'GUARDANDO…':'GUARDAR'}</button>
                  <button onClick={()=>setEditing(null)} className="px-4 py-2 rounded-xl font-syne text-[8.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.3)',background:SURF2}}>CANCELAR</button>
                </div>
              </div>
            )}
          </div>
        )})}
        {filtered.length===0 && (
          <div className="py-20 text-center">
            <div className="font-syne text-[11px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.12)'}}>
              {memSearch ? 'SIN RESULTADOS' : 'SIN ENTRADAS'}
            </div>
            {!memSearch && <button onClick={()=>onOpenModal('memoria')} className="font-syne text-[9px] font-black px-4 py-2 rounded-xl" style={{background:'rgba(27,95,250,0.08)',color:BLU}}>CREAR PRIMERA ENTRADA</button>}
          </div>
        )}
      </div>
    </div>
  )
}

// ── AUTOMATIZACIONES SECTION ─────────────────────────────────
function AutomatizacionesSection({data,onOpenModal,showToast,isOwner}: any) {
  const activeCount = data.reglas.filter((r: Regla)=>r.active).length
  const totalFired = data.reglas.reduce((s: number, r: Regla)=>s+(r.trigger_count||0),0)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string|null>(null)
  return (
    <div className="p-8 max-w-[900px] mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-2" style={{color:'rgba(255,255,255,0.18)'}}>SISTEMA</div>
          <h1 className="font-figtree text-[28px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Automatizaciones</h1>
        </div>
        <div className="flex items-center gap-6">
          {totalFired > 0 && (
            <div className="text-right">
              <div className="font-figtree text-[28px] font-black leading-none" style={{color:'rgba(167,139,250,0.8)',letterSpacing:'-0.04em'}}>{totalFired}</div>
              <div className="font-syne text-[8px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>EJECUCIONES</div>
            </div>
          )}
          <div className="text-right">
            <div className="font-figtree text-[28px] font-black leading-none" style={{color:activeCount>0?BLU:'rgba(255,255,255,0.25)',letterSpacing:'-0.04em'}}>{activeCount}</div>
            <div className="font-syne text-[8px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>DE {data.reglas.length} ACTIVAS</div>
          </div>
          {isOwner && <button onClick={()=>onOpenModal('regla')} className="flex items-center gap-2 px-5 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>+ REGLA</button>}
        </div>
      </div>
      <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
        {data.reglas.map((r: Regla, i: number)=>(
          <div key={r.id} className="group flex items-center gap-4 px-5 py-4 transition-all" style={{borderBottom:i<data.reglas.length-1?`1px solid ${BORDER}`:'none',borderLeft:`3px solid ${r.active?BLU+'60':'transparent'}`,opacity:r.active?1:0.45}}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:r.active?'rgba(27,95,250,0.08)':'rgba(255,255,255,0.03)',border:`1px solid ${r.active?'rgba(27,95,250,0.18)':BORDER}`}}>
              <LucideIcon name="zap" size={14} color={r.active?BLU:'rgba(255,255,255,0.2)'}/>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <span className="font-figtree text-[14px] font-semibold" style={{color:r.active?'rgba(240,240,248,0.9)':'rgba(240,240,248,0.4)'}}>{r.name}</span>
                {r.trigger_count > 0 && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(27,95,250,0.08)',color:'rgba(100,140,255,0.6)'}}>{r.trigger_count}× ejecutada</span>}
              </div>
              {(r.condition_text||r.action_text) && (
                <div className="flex items-center gap-1.5 text-[11px]" style={{color:'rgba(255,255,255,0.28)'}}>
                  {r.condition_text && <span>{r.condition_text}</span>}
                  {r.condition_text && r.action_text && <span style={{color:'rgba(255,255,255,0.15)'}}>›</span>}
                  {r.action_text && <span>{r.action_text}</span>}
                </div>
              )}
            </div>
            {isOwner && (
              <button onClick={()=>data.updateRegla(r.id, {active:!r.active}).then(()=>showToast(r.active?'Regla pausada':'Regla activada'))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-syne text-[7.5px] font-black transition-all flex-shrink-0"
                style={{background:r.active?'rgba(27,95,250,0.1)':'rgba(255,255,255,0.04)',color:r.active?BLU:'rgba(240,240,248,0.2)',border:`1px solid ${r.active?'rgba(27,95,250,0.2)':'transparent'}`}}>
                <div className="w-1.5 h-1.5 rounded-full" style={{background:r.active?BLU:'rgba(255,255,255,0.2)'}}/>
                {r.active?'ACTIVO':'PAUSADO'}
              </button>
            )}
            {!isOwner && <span className="font-syne text-[7.5px] font-black px-2.5 py-1 rounded-full flex-shrink-0" style={{background:r.active?'rgba(27,95,250,0.1)':'rgba(255,255,255,0.04)',color:r.active?BLU:'rgba(240,240,248,0.2)',border:`1px solid ${r.active?'rgba(27,95,250,0.2)':'transparent'}`}}>{r.active?'ACTIVO':'PAUSADO'}</span>}
            {isOwner && (
              confirmDeleteId === r.id
                ? <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={()=>{ data.deleteRegla(r.id).then(()=>showToast('Regla eliminada')); setConfirmDeleteId(null) }} className="px-2.5 py-1.5 rounded-lg font-syne text-[8px] font-black transition-all" style={{background:'rgba(229,29,42,0.15)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR?</button>
                    <button onClick={()=>setConfirmDeleteId(null)} className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-white/5 flex-shrink-0" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={11} color="rgba(255,255,255,0.3)"/></button>
                  </div>
                : <button onClick={()=>setConfirmDeleteId(r.id)} className="opacity-0 group-hover:opacity-60 transition-opacity flex-shrink-0"><LucideIcon name="trash" size={13} color={RED}/></button>
            )}
          </div>
        ))}
        {data.reglas.length===0&&(
          <div className="py-10 px-6">
            <div className="text-center text-[12px] mb-6" style={{color:'rgba(255,255,255,0.2)'}}>Sin reglas · empieza con una plantilla</div>
            <div className="space-y-2">
              {[
                {name:'Seguimiento de propuesta',condicion:'Email de cliente sin respuesta en 48h',accion:'Crear tarea urgente de seguimiento al cliente'},
                {name:'Alerta deadline próximo',condicion:'Proyecto con deadline en menos de 7 días',accion:'Notificar al equipo y crear tarea de revisión final'},
                {name:'Cliente inactivo',condicion:'Sin contacto con cliente en más de 30 días',accion:'Programar llamada de check-in con el cliente'},
              ].map((tpl,i)=>(
                <div key={i} className="flex items-center gap-4 px-5 py-4 rounded-2xl transition-all" style={{background:'rgba(27,95,250,0.03)',border:'1px solid rgba(27,95,250,0.1)'}}>
                  <div className="flex-1 min-w-0">
                    <div className="font-figtree text-[13px] font-semibold text-white mb-1">{tpl.name}</div>
                    <div className="flex items-center gap-1.5 text-[11px]" style={{color:'rgba(255,255,255,0.28)'}}>
                      <span>{tpl.condicion}</span>
                      <span style={{color:'rgba(255,255,255,0.12)'}}>›</span>
                      <span>{tpl.accion}</span>
                    </div>
                  </div>
                  {isOwner && <button onClick={async()=>{try{await data.createRegla({name:tpl.name,condition_text:tpl.condicion,action_text:tpl.accion,active:true});showToast('Regla creada')}catch{showToast('Error')}}} className="flex-shrink-0 px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all hover:opacity-80" style={{background:'rgba(27,95,250,0.12)',color:BLU,border:'1px solid rgba(27,95,250,0.2)'}}>+ USAR</button>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Markdown renderer (inline) ───────────────────────────────
function MarkdownMsg({ text }: { text: string }) {
  const lines = text.split('\n')
  const result: React.ReactNode[] = []
  let listItems: string[] = []
  let numberedItems: string[] = []

  const formatInline = (s: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = []
    const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
    let last = 0, m: RegExpExecArray|null
    while ((m = regex.exec(s)) !== null) {
      if (m.index > last) parts.push(s.slice(last, m.index))
      const raw = m[0]
      if (raw.startsWith('**')) parts.push(<strong key={m.index} style={{color:'rgba(255,255,255,0.95)',fontWeight:700}}>{raw.slice(2,-2)}</strong>)
      else if (raw.startsWith('*')) parts.push(<em key={m.index} style={{color:'rgba(240,240,248,0.85)'}}>{raw.slice(1,-1)}</em>)
      else parts.push(<code key={m.index} className="px-1 py-0.5 rounded text-[11px] font-mono" style={{background:'rgba(27,95,250,0.12)',color:'rgba(100,140,255,0.9)'}}>{raw.slice(1,-1)}</code>)
      last = m.index + raw.length
    }
    if (last < s.length) parts.push(s.slice(last))
    return parts
  }

  const flushList = (key: string) => {
    if (listItems.length === 0) return
    result.push(
      <ul key={key} className="my-1.5 space-y-0.5 list-none pl-3">
        {listItems.map((item, i) => (
          <li key={i} className="flex gap-2 items-start text-[12.5px] leading-relaxed" style={{color:'rgba(240,240,248,0.78)'}}>
            <span className="mt-1.5 w-1 h-1 rounded-full flex-shrink-0" style={{background:'rgba(27,95,250,0.7)'}}/>
            <span>{formatInline(item)}</span>
          </li>
        ))}
      </ul>
    )
    listItems = []
  }

  const flushNumbered = (key: string) => {
    if (numberedItems.length === 0) return
    result.push(
      <ol key={key} className="my-1.5 space-y-0.5 list-none pl-3">
        {numberedItems.map((item, i) => (
          <li key={i} className="flex gap-2 items-start text-[12.5px] leading-relaxed" style={{color:'rgba(240,240,248,0.78)'}}>
            <span className="mt-0.5 font-syne text-[9px] font-black flex-shrink-0 w-4 text-right" style={{color:'rgba(27,95,250,0.7)'}}>{i+1}.</span>
            <span>{formatInline(item)}</span>
          </li>
        ))}
      </ol>
    )
    numberedItems = []
  }

  lines.forEach((line, i) => {
    const trimmed = line.trimStart()
    const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('• ') || trimmed.startsWith('* ')
    const numberedMatch = trimmed.match(/^\d+\.\s(.+)/)
    if (isBullet) {
      flushNumbered(`num-${i}`)
      listItems.push(trimmed.slice(2))
    } else if (numberedMatch) {
      flushList(`list-${i}`)
      numberedItems.push(numberedMatch[1])
    } else {
      flushList(`list-${i}`)
      flushNumbered(`num-${i}`)
      if (trimmed === '') {
        if (i < lines.length - 1) result.push(<div key={`br-${i}`} className="h-2"/>)
      } else if (trimmed.startsWith('### ')) {
        result.push(<div key={i} className="font-syne text-[9px] font-black tracking-widest mt-3 mb-1" style={{color:'rgba(255,255,255,0.45)'}}>{trimmed.slice(4).toUpperCase()}</div>)
      } else if (trimmed.startsWith('## ')) {
        result.push(<div key={i} className="font-figtree text-[13px] font-black mt-3 mb-1" style={{color:'rgba(255,255,255,0.9)'}}>{trimmed.slice(3)}</div>)
      } else {
        result.push(<p key={i} className="text-[13px] leading-relaxed" style={{color:'rgba(240,240,248,0.78)'}}>{formatInline(trimmed)}</p>)
      }
    }
  })
  flushList('list-end')
  flushNumbered('num-end')
  return <div className="space-y-0.5">{result}</div>
}

// ── CHAT SECTION ─────────────────────────────────────────────
function ChatSection({profile,data,chatInput,setChatInput,chatLoading,setChatLoading,showToast}: any) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [copiedId, setCopiedId] = useState<string|null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:'smooth'}) },[data.chatMessages])

  const copyMsg = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(()=>{
      setCopiedId(id)
      setTimeout(()=>setCopiedId(null), 1800)
    }).catch(()=>{})
  }

  const sendText = async (txt: string) => {
    if (!txt || chatLoading) return
    setChatInput('')
    if (inputRef.current) { inputRef.current.style.height = 'auto' }
    setChatLoading(true)
    try { await data.sendChatMessage(txt) }
    catch { showToast('Error enviando mensaje') }
    finally { setChatLoading(false) }
  }

  const send = () => sendText(chatInput.trim())

  const urgentN = data.tasks.filter((t: Task)=>!t.done&&t.level==='urgent').length
  const overdueN = data.projects.filter((p: Project)=>p.deadline&&p.deadline!=='TBD'&&p.status!=='completado'&&new Date(p.deadline+'T23:59:59')<new Date()).length
  const unreadN = data.inbox.filter((m: any)=>!m.is_read).length
  const PROMPTS = [
    urgentN > 0
      ? {text:`Tengo ${urgentN} tarea${urgentN>1?'s':''} urgente${urgentN>1?'s':''}, ¿cuál priorizo primero?`, cat:'URGENTE'}
      : {text:'¿Qué proyectos urgentes tengo?', cat:'URGENTE'},
    {text:'¿Cuántas tareas pendientes hay?', cat:'TAREAS'},
    {text:'Resume el estado del equipo', cat:'EQUIPO'},
    overdueN > 0
      ? {text:`${overdueN} proyecto${overdueN>1?'s':''} atrasado${overdueN>1?'s':''}, ¿cómo lo${overdueN>1?'s':''} gestiono?`, cat:'PROYECTOS'}
      : {text:'¿Qué contenido hay que publicar esta semana?', cat:'CONTENIDO'},
    unreadN > 0
      ? {text:`Tengo ${unreadN} mensaje${unreadN>1?'s':''} sin leer, ¿cuáles necesitan respuesta?`, cat:'INBOX'}
      : {text:'¿Qué clientes no tienen proyectos activos?', cat:'CLIENTES'},
    {text:'Dame prioridades para hoy', cat:'HOY'},
  ]

  const isEmpty = data.chatMessages.length === 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-5" style={{borderBottom:`1px solid ${BORDER}`}}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0 overflow-hidden p-1.5" style={{background:'rgba(27,95,250,0.1)',border:'1px solid rgba(27,95,250,0.2)'}}>
              <img src="https://brutal.thehook-produccion.es/wp-content/themes/brutal-studios/assets/img/brutal-logo-white.svg" className="w-full opacity-80" alt=""/>
            </div>
            <div>
              <div className="font-figtree text-[16px] font-black text-white leading-none" style={{letterSpacing:'-0.025em'}}>BRUTAL<span style={{color:BLU}}>.IA</span></div>
              <div className="font-syne text-[7.5px] font-bold tracking-widest mt-0.5" style={{color:'rgba(255,255,255,0.2)'}}>ASISTENTE CON CONTEXTO COMPLETO</div>
            </div>
          </div>
          {!isEmpty && (
            confirmClear
              ? <div className="flex items-center gap-1">
                  <button onClick={()=>{data.clearChat?.();setConfirmClear(false)}} className="font-syne text-[8px] font-black px-3 py-1.5 rounded-xl transition-all" style={{background:'rgba(229,29,42,0.12)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR?</button>
                  <button onClick={()=>setConfirmClear(false)} className="w-6 h-6 rounded-lg flex items-center justify-center" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={10} color="rgba(255,255,255,0.3)"/></button>
                </div>
              : <button onClick={()=>setConfirmClear(true)} className="font-syne text-[8px] font-black tracking-widest px-3 py-1.5 rounded-xl transition-all hover:bg-white/5" style={{color:'rgba(255,255,255,0.2)',border:`1px solid ${BORDER}`}}>LIMPIAR</button>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {[
            {n:data.clients?.length||0, l:'clientes'},
            {n:data.tasks?.filter((t:any)=>!t.done).length||0, l:'tareas activas'},
            {n:data.projects?.filter((p:any)=>p.status==='activo').length||0, l:'proyectos'},
            {n:data.inbox?.filter((m:any)=>!m.is_read).length||0, l:'sin leer'},
            ...(data.chatMessages?.length > 0 ? [{n:data.chatMessages.length, l:'mensajes'}] : []),
          ].map((c,i)=>(
            <span key={i} className="font-syne text-[7.5px] font-black px-2 py-1 rounded-lg" style={{background:SURF2,color:'rgba(255,255,255,0.28)'}}>
              <span style={{color:'rgba(255,255,255,0.75)'}}>{c.n}</span> {c.l}
            </span>
          ))}
          <span className="font-syne text-[7px] font-black tracking-widest px-2 py-1 rounded-lg" style={{background:'rgba(27,95,250,0.08)',color:BLU}}>SONNET 4.6</span>
        </div>
      </div>

      {/* Messages / Empty state */}
      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full px-6 py-10">
            <div className="relative mb-7">
              <div className="w-16 h-16 rounded-3xl flex items-center justify-center" style={{background:'rgba(27,95,250,0.08)',border:'1px solid rgba(27,95,250,0.16)'}}>
                <LucideIcon name="sparkles" size={22} color={BLU}/>
              </div>
              <div className="absolute inset-0 rounded-3xl pointer-events-none" style={{background:'radial-gradient(circle,rgba(27,95,250,0.10) 0%,transparent 70%)'}}/>
            </div>
            <div className="font-figtree text-[15px] font-black text-white mb-1" style={{letterSpacing:'-0.02em'}}>¿En qué puedo ayudarte?</div>
            <div className="font-syne text-[8.5px] font-bold tracking-widest mb-7" style={{color:'rgba(255,255,255,0.18)'}}>TENGO ACCESO A TODOS TUS DATOS</div>
            <div className="grid grid-cols-2 gap-2 w-full max-w-[340px]">
              {PROMPTS.map(p=>(
                <button key={p.text} onClick={()=>sendText(p.text)} className="text-left p-4 rounded-2xl transition-all" style={{background:SURF2,border:`1px solid ${BORDER}`}}
                  onMouseEnter={e=>(e.currentTarget.style.borderColor='rgba(27,95,250,0.3)')}
                  onMouseLeave={e=>(e.currentTarget.style.borderColor=BORDER)}>
                  <div className="font-syne text-[7px] font-black tracking-widest mb-1.5" style={{color:'rgba(27,95,250,0.65)'}}>{p.cat}</div>
                  <div className="text-[11.5px] leading-snug" style={{color:'rgba(255,255,255,0.48)'}}>{p.text}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="px-5 py-5 space-y-4">
            {data.chatMessages.map((m: any, mi: number)=>{
              const prev = data.chatMessages[mi-1]
              const mDay = m.created_at ? new Date(m.created_at).toDateString() : null
              const prevDay = prev?.created_at ? new Date(prev.created_at).toDateString() : null
              const showDateSep = mDay && mDay !== prevDay
              const todayD = new Date().toDateString()
              const yesterD = new Date(Date.now()-86400000).toDateString()
              const dayLabel = !mDay ? null : mDay===todayD ? 'HOY' : mDay===yesterD ? 'AYER' : new Date(m.created_at).toLocaleDateString('es-ES',{day:'numeric',month:'short'})
              return (
              <div key={m.id}>
                {showDateSep && dayLabel && (
                  <div className="flex items-center gap-3 py-2 mb-2">
                    <div className="flex-1 h-px" style={{background:BORDER}}/>
                    <span className="font-syne text-[7.5px] font-black tracking-widest px-2" style={{color:'rgba(255,255,255,0.18)'}}>{dayLabel}</span>
                    <div className="flex-1 h-px" style={{background:BORDER}}/>
                  </div>
                )}
              <div className={`flex gap-2.5 group/msg ${m.role==='user'?'justify-end':'items-start'}`} style={{flexDirection:m.role==='user'?'row-reverse':'row'}}>
                {m.role==='ai' && (
                  <div className="w-7 h-7 rounded-xl flex-shrink-0 flex items-center justify-center overflow-hidden mt-0.5 p-1" style={{background:'rgba(27,95,250,0.12)',border:'1px solid rgba(27,95,250,0.2)'}}>
                    <img src="https://brutal.thehook-produccion.es/wp-content/themes/brutal-studios/assets/img/brutal-logo-white.svg" className="w-full opacity-80" alt=""/>
                  </div>
                )}
                <div className="max-w-[76%] relative" style={{display:'flex',flexDirection:'column',alignItems:m.role==='user'?'flex-end':'flex-start'}}>
                  <div className="px-4 py-3" style={{
                    background:m.role==='user'?`linear-gradient(135deg,${BLU},#1440CC)`:'rgba(12,12,22,0.95)',
                    border:m.role==='ai'?`1px solid ${BORDER}`:'none',
                    borderRadius:'16px',
                    borderTopLeftRadius:m.role==='ai'?'5px':'16px',
                    borderTopRightRadius:m.role==='user'?'5px':'16px',
                  }}>
                    {m.role==='user'
                      ? <span className="text-[13px] leading-relaxed text-white whitespace-pre-wrap">{m.content}</span>
                      : <MarkdownMsg text={m.content}/>
                    }
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {m.created_at && <span className="opacity-0 group-hover/msg:opacity-100 transition-opacity font-syne text-[7px]" style={{color:'rgba(255,255,255,0.18)'}}>{new Date(m.created_at).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}</span>}
                    {m.role==='ai' && (
                      <button onClick={()=>copyMsg(m.id, m.content)} className="opacity-0 group-hover/msg:opacity-100 transition-opacity flex items-center gap-1 px-2 py-1 rounded-lg" style={{color:copiedId===m.id?GRN:'rgba(255,255,255,0.25)',background:'transparent'}}>
                        <LucideIcon name={copiedId===m.id?'check':'copy'} size={10} color={copiedId===m.id?GRN:'rgba(255,255,255,0.25)'}/>
                        <span className="font-syne text-[7px] font-black tracking-wide">{copiedId===m.id?'COPIADO':'COPIAR'}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
              </div>
            )})}
            {chatLoading && (
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-xl flex items-center justify-center overflow-hidden p-1" style={{background:'rgba(27,95,250,0.12)',border:'1px solid rgba(27,95,250,0.2)'}}>
                  <img src="https://brutal.thehook-produccion.es/wp-content/themes/brutal-studios/assets/img/brutal-logo-white.svg" className="w-full opacity-80" alt=""/>
                </div>
                <div className="flex gap-1 px-4 py-3.5 rounded-2xl" style={{background:'rgba(12,12,22,0.95)',border:`1px solid ${BORDER}`}}>
                  <div className="w-1.5 h-1.5 rounded-full animate-dot1" style={{background:BLU}}/>
                  <div className="w-1.5 h-1.5 rounded-full animate-dot2" style={{background:BLU}}/>
                  <div className="w-1.5 h-1.5 rounded-full animate-dot3" style={{background:BLU}}/>
                </div>
              </div>
            )}
            <div ref={bottomRef}/>
          </div>
        )}
      </div>

      {/* Context-aware quick prompts (when chat has messages) */}
      {!isEmpty && !chatLoading && (()=>{
        const urgentTasks = data.tasks?.filter((t:any)=>!t.done&&t.level==='urgent').length||0
        const unread = data.inbox?.filter((m:any)=>!m.is_read).length||0
        const overdueProjs = data.projects?.filter((p:any)=>p.deadline&&p.deadline!=='TBD'&&p.status!=='completado'&&new Date(p.deadline+'T23:59:59')<new Date()).length||0
        const suggestions: {text:string; hint:string}[] = []
        if (urgentTasks > 0) suggestions.push({text:`¿Cómo resolver mis ${urgentTasks} tarea${urgentTasks>1?'s':''} urgente${urgentTasks>1?'s':''}?`, hint:'URGENTE'})
        if (unread > 0) suggestions.push({text:`Resume los ${unread} mensajes sin leer`, hint:'INBOX'})
        if (overdueProjs > 0) suggestions.push({text:`¿Qué hago con los ${overdueProjs} proyecto${overdueProjs>1?'s':''} atrasado${overdueProjs>1?'s':''}?`, hint:'PROYECTOS'})
        suggestions.push({text:'¿Qué debería priorizar ahora mismo?', hint:'FOCUS'})
        suggestions.push({text:'Dame un resumen del estado general', hint:'RESUMEN'})
        const shown = suggestions.slice(0, 3)
        return shown.length > 0 ? (
          <div className="px-5 pb-2 flex gap-2 overflow-x-auto" style={{scrollbarWidth:'none'}}>
            {shown.map((s,i)=>(
              <button key={i} onClick={()=>sendText(s.text)} className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-syne text-[7.5px] font-black tracking-wide transition-all hover:opacity-80" style={{background:SURF2,border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.4)'}}>
                <span style={{color:BLU}}>{s.hint}</span>
                <span className="truncate max-w-[200px]">{s.text}</span>
              </button>
            ))}
          </div>
        ) : null
      })()}

      {/* Input */}
      <div className="flex-shrink-0 px-5 py-4" style={{borderTop:`1px solid ${BORDER}`}}>
        <div className="flex items-end gap-2.5 px-4 py-3 rounded-2xl" style={{background:SURF2,border:`1.5px solid rgba(27,95,250,0.12)`}}>
          <textarea
            ref={inputRef}
            value={chatInput}
            onChange={e=>setChatInput(e.target.value)}
            onInput={e=>{e.currentTarget.style.height='auto';e.currentTarget.style.height=Math.min(e.currentTarget.scrollHeight,120)+'px'}}
            onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}}
            onFocus={e=>(e.currentTarget.parentElement!.style.borderColor='rgba(27,95,250,0.35)')}
            onBlur={e=>(e.currentTarget.parentElement!.style.borderColor='rgba(27,95,250,0.12)')}
            placeholder="Pregunta a Brutal.IA…"
            rows={1}
            className="flex-1 bg-transparent text-[13px] outline-none resize-none leading-relaxed"
            style={{caretColor:BLU,color:'rgba(255,255,255,0.88)',maxHeight:'120px'}}
          />
          <button onClick={send} disabled={!chatInput.trim()||chatLoading} className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 disabled:opacity-25 transition-all" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
            <LucideIcon name="send" size={13} color="white"/>
          </button>
        </div>
        <div className="font-syne text-[7.5px] font-bold tracking-widest text-center mt-2" style={{color:'rgba(255,255,255,0.1)'}}>ENTER para enviar · SHIFT+ENTER nueva línea</div>
      </div>
    </div>
  )
}

// ── AJUSTES SECTION ──────────────────────────────────────────
function AjustesSection({profile,data,showToast}: any) {
  const [editName, setEditName] = useState(profile?.name||'')
  const [editInitials, setEditInitials] = useState(profile?.initials||'')
  const [editAvatarColor, setEditAvatarColor] = useState(profile?.avatar_color||BLU)
  const [savingProfile, setSavingProfile] = useState(false)
  // New member form
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState<'member'|'owner'>('member')
  const [addingMember, setAddingMember] = useState(false)
  const [lastCreated, setLastCreated] = useState<{email:string;tempPassword?:string}|null>(null)
  // Edit member name
  const [editingMember, setEditingMember] = useState<Profile|null>(null)
  const [editMemberName, setEditMemberName] = useState('')
  const [editMemberInitials, setEditMemberInitials] = useState('')

  const saveOwnProfile = async () => {
    if (!editName.trim()) return
    setSavingProfile(true)
    try {
      const res = await fetch('/api/admin/team', {
        method:'PATCH',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email: profile.email, name: editName.trim(), initials: editInitials.trim().toUpperCase().slice(0,2)||editName.trim().split(' ').map((n:string)=>n[0]).join('').toUpperCase().slice(0,2), avatar_color: editAvatarColor })
      })
      if (res.ok) { showToast('Perfil actualizado — recarga para ver los cambios'); }
      else { showToast('Error actualizando perfil') }
    } catch { showToast('Error') }
    finally { setSavingProfile(false) }
  }

  const addMember = async () => {
    if (!newEmail.trim() || !newName.trim()) return
    setAddingMember(true)
    try {
      const res = await fetch('/api/admin/team', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email: newEmail.trim(), name: newName.trim(), role: newRole })
      })
      const json = await res.json()
      if (res.ok) {
        setLastCreated({ email: newEmail.trim(), tempPassword: json.tempPassword })
        setNewEmail(''); setNewName(''); setNewRole('member')
        showToast(`${json.action==='created'?'Cuenta creada':'Perfil actualizado'}: ${newName}`)
      } else { showToast(json.error||'Error') }
    } catch { showToast('Error') }
    finally { setAddingMember(false) }
  }

  const saveMemberName = async () => {
    if (!editingMember || !editMemberName.trim()) return
    try {
      const res = await fetch('/api/admin/team', {
        method:'PATCH',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email: editingMember.email, name: editMemberName.trim(), initials: editMemberInitials.trim().toUpperCase().slice(0,2)||editMemberName.trim().split(' ').map((n:string)=>n[0]).join('').toUpperCase().slice(0,2) })
      })
      if (res.ok) { showToast('Nombre actualizado'); setEditingMember(null) }
      else { showToast('Error') }
    } catch { showToast('Error') }
  }

  const cardStyle = {background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:'16px'}

  return (
    <div className="p-8 max-w-[680px] mx-auto">
      <div className="mb-8">
        <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-1.5" style={{color:'rgba(255,255,255,0.18)'}}>CONFIGURACIÓN</div>
        <h1 className="font-figtree text-[28px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Ajustes</h1>
      </div>
      <div className="space-y-4">

        {/* Mi perfil */}
        <div className="p-6" style={cardStyle}>
          <div className="font-syne text-[9px] font-black tracking-[0.2em] mb-5" style={{color:'rgba(255,255,255,0.2)'}}>MI PERFIL</div>
          <div className="flex items-center gap-4 mb-5">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center font-syne text-base font-black flex-shrink-0" style={{background:profile.avatar_color+'22',border:`1.5px solid ${profile.avatar_color}40`,color:profile.avatar_color}}>{profile.initials}</div>
            <div>
              <div className="font-figtree text-[16px] font-semibold text-white">{profile.name}</div>
              <div className="text-[12px] mt-0.5" style={{color:'rgba(255,255,255,0.3)'}}>{profile.email}</div>
              <span className="font-syne text-[7.5px] font-black mt-1.5 px-2 py-0.5 rounded-full inline-block" style={{background:profile.role==='owner'?'rgba(27,95,250,0.1)':'rgba(255,255,255,0.05)',color:profile.role==='owner'?BLU:'rgba(240,240,248,0.3)'}}>{profile.role==='owner'?'PROPIETARIO':'MIEMBRO'}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <div className="font-syne text-[8.5px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>NOMBRE PARA MOSTRAR</div>
              <input value={editName} onChange={e=>setEditName(e.target.value)} className="w-full px-4 py-2.5 rounded-xl text-[13px] text-white outline-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.4)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
            </div>
            <div className="w-24">
              <div className="font-syne text-[8.5px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>INICIALES</div>
              <input value={editInitials} onChange={e=>setEditInitials(e.target.value.toUpperCase().slice(0,2))} maxLength={2} className="w-full px-4 py-2.5 rounded-xl text-[13px] text-white outline-none text-center tracking-widest" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.4)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
            </div>
          </div>
          <div className="mt-4 pt-4 flex items-start gap-4" style={{borderTop:`1px solid ${BORDER}`}}>
            <div className="flex-1">
              <div className="font-syne text-[8.5px] font-black tracking-widest mb-2.5" style={{color:'rgba(255,255,255,0.25)'}}>COLOR DE AVATAR</div>
              <div className="flex items-center gap-2 flex-wrap">
                {['#1B5FFA','#E51D2A','#22c55e','#F97316','#A78BFA','#06B6D4','#EC4899','#84CC16','#F59E0B','#10B981'].map(c=>(
                  <button key={c} onClick={()=>setEditAvatarColor(c)} title={c} className="w-7 h-7 rounded-full transition-all" style={{background:c,outline:editAvatarColor===c?`2px solid white`:'none',outlineOffset:'2px',opacity:editAvatarColor===c?1:0.5}}/>
                ))}
              </div>
            </div>
          </div>
          <button onClick={saveOwnProfile} disabled={savingProfile} className="mt-4 px-5 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest text-white disabled:opacity-40" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>{savingProfile?'GUARDANDO…':'GUARDAR PERFIL'}</button>
        </div>

        {/* Integraciones */}
        <div className="p-6" style={cardStyle}>
          <div className="font-syne text-[9px] font-black tracking-[0.2em] mb-5" style={{color:'rgba(255,255,255,0.2)'}}>INTEGRACIONES</div>
          <div className="flex items-center justify-between py-3" style={{borderBottom:`1px solid ${BORDER}`}}>
            <div className="flex items-center gap-3"><LucideIcon name="mail" size={15} color={BLU}/><span className="text-[13px]" style={{color:'rgba(255,255,255,0.7)'}}>Gmail</span></div>
            {profile.gmail_connected ? (
              <span className="font-syne text-[8px] font-black px-3 py-1 rounded-full" style={{background:'rgba(27,95,250,0.1)',color:BLU}}>CONECTADO</span>
            ) : (
              <a href="/api/gmail/connect" className="font-syne text-[9px] font-black px-3 py-1.5 rounded-xl text-white" style={{background:BLU}}>CONECTAR</a>
            )}
          </div>
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              <span className="text-[13px]" style={{color:'rgba(255,255,255,0.7)'}}>WhatsApp Bot</span>
            </div>
            <span className="text-[11px]" style={{color:'rgba(255,255,255,0.2)'}}>Ver documentación</span>
          </div>
        </div>

        {/* Atajos de teclado */}
        <div className="p-6" style={cardStyle}>
          <div className="font-syne text-[9px] font-black tracking-[0.2em] mb-5" style={{color:'rgba(255,255,255,0.2)'}}>ATAJOS DE TECLADO</div>
          <div className="grid grid-cols-2 gap-3">
            {[
              {key:'⌘+K', label:'Búsqueda global'},
              {key:'G·H', label:'Hoy'},
              {key:'G·T', label:'Tareas'},
              {key:'G·I', label:'Inbox'},
              {key:'G·C', label:'Clientes'},
              {key:'G·P', label:'Proyectos'},
              {key:'G·K', label:'Contenido'},
              {key:'G·A', label:'Calendario'},
              {key:'G·M', label:'Memoria'},
              {key:'G·E', label:'Equipo'},
              {key:'G·R', label:'Reportes'},
              {key:'G·V', label:'Automatizaciones'},
              {key:'G·S', label:'Ajustes'},
              {key:'G·N', label:'Chat IA'},
              {key:'N', label:'Nueva entrada (Memoria)'},
              {key:'J / K', label:'Navegar lista (Tareas, Inbox)'},
              {key:'Esc', label:'Cerrar modal / panel'},
              {key:'Enter', label:'Enviar en Chat'},
            ].map((s,i)=>(
              <div key={i} className="flex items-center gap-3">
                <kbd className="font-syne text-[9px] font-black px-2.5 py-1.5 rounded-lg flex-shrink-0" style={{background:SURF2,color:BLU,border:`1px solid rgba(27,95,250,0.2)`,minWidth:'52px',textAlign:'center'}}>{s.key}</kbd>
                <span className="text-[12px]" style={{color:'rgba(255,255,255,0.45)'}}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Gestión de equipo — owner only */}
        {profile.role === 'owner' && (
          <div className="p-6" style={cardStyle}>
            <div className="font-syne text-[9px] font-black tracking-[0.2em] mb-5" style={{color:'rgba(255,255,255,0.2)'}}>GESTIÓN DE EQUIPO</div>

            {/* Member list with edit */}
            <div className="space-y-0 mb-6">
              {data.team.map((m: Profile)=>(
                <div key={m.id}>
                  {editingMember?.id === m.id ? (
                    <div className="py-3 flex items-center gap-2" style={{borderBottom:`1px solid ${BORDER}`}}>
                      <input value={editMemberName} onChange={e=>setEditMemberName(e.target.value)} placeholder="Nombre" className="flex-1 px-3 py-2 rounded-xl text-[12px] text-white outline-none" style={{background:SURF2,border:`1.5px solid rgba(27,95,250,0.3)`,caretColor:BLU}}/>
                      <input value={editMemberInitials} onChange={e=>setEditMemberInitials(e.target.value.toUpperCase().slice(0,2))} maxLength={2} placeholder="XX" className="w-14 px-2 py-2 rounded-xl text-[12px] text-white outline-none text-center" style={{background:SURF2,border:`1.5px solid rgba(27,95,250,0.3)`,caretColor:BLU}}/>
                      <button onClick={saveMemberName} className="px-3 py-2 rounded-xl font-syne text-[8.5px] font-black text-white" style={{background:BLU}}>OK</button>
                      <button onClick={()=>setEditingMember(null)} className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={13} color="rgba(255,255,255,0.3)"/></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 py-3 group" style={{borderBottom:`1px solid ${BORDER}`}}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center font-syne text-[10px] font-black flex-shrink-0" style={{background:m.avatar_color+'22',color:m.avatar_color}}>{m.initials}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-white truncate">{m.name}</div>
                        <div className="text-[11px] truncate" style={{color:'rgba(255,255,255,0.3)'}}>{m.email}</div>
                      </div>
                      <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full flex-shrink-0" style={{background:m.role==='owner'?'rgba(27,95,250,0.1)':'rgba(255,255,255,0.04)',color:m.role==='owner'?BLU:'rgba(240,240,248,0.2)'}}>{m.role==='owner'?'OWNER':'MIEMBRO'}</span>
                      <button onClick={()=>{setEditingMember(m);setEditMemberName(m.name);setEditMemberInitials(m.initials)}} className="opacity-0 group-hover:opacity-100 px-2 py-1 rounded-lg font-syne text-[8px] font-black transition-opacity" style={{color:'rgba(255,255,255,0.3)',border:`1px solid ${BORDER}`}}>EDITAR</button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Add new member */}
            <div className="font-syne text-[8.5px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.2)'}}>AÑADIR MIEMBRO</div>
            <div className="space-y-2.5">
              <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Nombre (ej: Fer)" className="w-full px-4 py-2.5 rounded-xl text-[12px] text-white outline-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.4)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
              <input value={newEmail} onChange={e=>setNewEmail(e.target.value)} placeholder="Email" type="email" className="w-full px-4 py-2.5 rounded-xl text-[12px] text-white outline-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.4)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
              <div className="flex gap-2">
                {(['member','owner'] as const).map(r=>(
                  <button key={r} onClick={()=>setNewRole(r)} className="flex-1 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-wide transition-all" style={{background:newRole===r?'rgba(27,95,250,0.1)':SURF2,border:`1.5px solid ${newRole===r?'rgba(27,95,250,0.3)':BORDER}`,color:newRole===r?BLU:'rgba(255,255,255,0.3)'}}>
                    {r==='owner'?'PROPIETARIO':'MIEMBRO'}
                  </button>
                ))}
              </div>
              <button onClick={addMember} disabled={addingMember||!newEmail.trim()||!newName.trim()} className="w-full py-3 rounded-xl font-syne text-[9px] font-black tracking-widest text-white disabled:opacity-40" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>{addingMember?'CREANDO…':'CREAR CUENTA'}</button>
            </div>
            {lastCreated && (
              <div className="mt-4 p-4 rounded-xl" style={{background:'rgba(27,95,250,0.08)',border:`1px solid rgba(27,95,250,0.2)`}}>
                <div className="font-syne text-[8.5px] font-black tracking-widest mb-2" style={{color:BLU}}>CUENTA CREADA</div>
                <div className="text-[12px] text-white/70">Email: <span className="text-white">{lastCreated.email}</span></div>
                {lastCreated.tempPassword && <div className="text-[12px] text-white/70 mt-1">Contraseña temporal: <span className="font-mono text-white">{lastCreated.tempPassword}</span></div>}
                <div className="text-[10px] mt-2" style={{color:'rgba(255,255,255,0.3)'}}>El usuario puede cambiar su contraseña desde la pantalla de login</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
