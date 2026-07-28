'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNexusData } from '@/hooks/useNexusData'
import type { Profile, Task, Project, Client } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { PlatformLogo } from '@/components/PlatformLogo'

import { BLU, RED, GRN, SURFACE, SURF2, BORDER, ACCENT_COLORS } from '@/components/shared/design-tokens'
import { useIsMobile } from '@/components/shared/hooks'
import { dlDate } from '@/components/shared/helpers'
import LucideIcon from '@/components/shared/LucideIcon'
import { SectionErrorBoundary } from '@/components/shared/ErrorBoundary'
import { unlockAudio } from '@/components/shared/audio'

import HoySection from '@/components/sections/HoySection'
import InboxSection from '@/components/sections/InboxSection'
import TareasSection from '@/components/sections/TareasSection'
import ClientesSection from '@/components/sections/ClientesSection'
import ProyectosSection from '@/components/sections/ProyectosSection'
import ContenidoSection from '@/components/sections/ContenidoSection'
import CalendarioSection from '@/components/sections/CalendarioSection'
import MemoriaSection from '@/components/sections/MemoriaSection'
import AutomatizacionesSection from '@/components/sections/AutomatizacionesSection'
import ChatSection from '@/components/sections/ChatSection'
import HarveySection from '@/components/sections/HarveySection'
import EquipoSection from '@/components/sections/EquipoSection'
import ReportesSection from '@/components/sections/ReportesSection'
import AjustesSection from '@/components/sections/AjustesSection'

type Section = 'hoy'|'inbox'|'tareas'|'clientes'|'proyectos'|'contenido'|'calendario'|'memoria'|'automatizaciones'|'chat'|'equipo'|'reportes'|'ajustes'|'harvey'

interface Props { profile: Profile }

export default function NexusDashboard({ profile }: Props) {
  const data = useNexusData(profile, (msg) => {
    const sender = msg.from_name || 'Alguien'
    const label = msg.source === 'internal' ? `Mensaje de ${sender}` : `Nuevo mensaje de ${sender}`
    setToast(label)
    setTimeout(() => setToast(null), 4000)
  })
  const [section, setSection] = useState<Section>('hoy')
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [lightMode, setLightMode] = useState(false)
  useEffect(() => {
    try {
      if (localStorage.getItem('nx_theme') === 'light') {
        setLightMode(true)
        document.documentElement.classList.add('theme-light')
      }
    } catch {}
  }, [])
  const toggleTheme = () => {
    setLightMode(v => {
      const next = !v
      document.documentElement.classList.toggle('theme-light', next)
      try { localStorage.setItem('nx_theme', next ? 'light' : 'dark') } catch {}
      return next
    })
  }

  useEffect(() => { if (isMobile) setSidebarOpen(false) }, [isMobile])

  useEffect(() => {
    if (!isMobile) return
    const reset = () => setTimeout(() => window.scrollTo(0, 0), 60)
    document.addEventListener('focusout', reset)
    return () => document.removeEventListener('focusout', reset)
  }, [isMobile])

  const [offline, setOffline] = useState(false)
  useEffect(() => {
    const on = () => setOffline(false), off = () => setOffline(true)
    setOffline(!navigator.onLine)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  useEffect(() => {
    if (!isMobile) return
    let startX = 0, startY = 0, fromEdge = false, tracking = false
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      startX = t.clientX; startY = t.clientY
      fromEdge = t.clientX < 28
      tracking = true
    }
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return
      tracking = false
      const t = e.changedTouches[0]
      const dx = t.clientX - startX, dy = t.clientY - startY
      if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.8) return
      if (dx > 0 && fromEdge) setSidebarOpen(true)
      else if (dx < 0) setSidebarOpen(o => o ? false : o)
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    return () => { window.removeEventListener('touchstart', onStart); window.removeEventListener('touchend', onEnd) }
  }, [isMobile])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const gmailStatus = params.get('gmail')
    if (gmailStatus === 'connected' || gmailStatus === 'colabs_connected') {
      window.history.replaceState({}, '', '/dashboard')
      setTimeout(() => {
        setToast(gmailStatus === 'colabs_connected' ? 'Colaboraciones conectado' : 'Gmail personal conectado')
        setSection('ajustes')
      }, 400)
    } else if (gmailStatus === 'denied') {
      window.history.replaceState({}, '', '/dashboard')
      setToast('Google bloqueó esta cuenta. Debe estar autorizada en la pantalla de consentimiento de Google Cloud (o usa una cuenta @brutalstudios.es).')
      setTimeout(() => setSection('ajustes'), 400)
    } else if (gmailStatus === 'error' || gmailStatus === 'no_refresh_token') {
      window.history.replaceState({}, '', '/dashboard')
      setToast('Error al conectar. Inténtalo de nuevo desde Operativa → Sincronización.')
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
  const [quickCreateOpen, setQuickCreateOpen] = useState(false)
  const [notifData, setNotifData] = useState<{dmCount:number;urgentCount:number;total:number;dms:any[];urgent:any[]}>({dmCount:0,urgentCount:0,total:0,dms:[],urgent:[]})

  useEffect(() => {
    const fetchNotifs = () => fetch('/api/notifications').then(r=>r.ok?r.json():null).then(d=>{if(d)setNotifData(d)}).catch(()=>{})
    fetchNotifs()
    const iv = setInterval(fetchNotifs, 30000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    let alive = true
    const LS_AUTO = 'colabs_auto_sync_at'
    const autoSync = async () => {
      try {
        const last = Number(localStorage.getItem(LS_AUTO) || 0)
        if (Date.now() - last < 3 * 60 * 1000) return
        localStorage.setItem(LS_AUTO, String(Date.now()))
        const r = await fetch('/api/gmail/colabs-sync', { method: 'POST' })
        if (r.ok && alive) { const d = await r.json(); if (d?.synced > 0) data.reloadInbox?.() }
      } catch {}
    }
    autoSync()
    const iv = setInterval(autoSync, 3 * 60 * 1000)
    const onVis = () => { if (document.visibilityState === 'visible') autoSync() }
    document.addEventListener('visibilitychange', onVis)
    return () => { alive = false; clearInterval(iv); document.removeEventListener('visibilitychange', onVis) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [selectedClient, setSelectedClient] = useState<string|null>(null)
  const [selectedProject, setSelectedProject] = useState<string|null>(null)
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [harveyPreload, setHarveyPreload] = useState<string|null>(null)
  const [projView, setProjView] = useState<'board'|'list'>('board')
  const [projStatusFilter, setProjStatusFilter] = useState('Todos')
  const [memFilter, setMemFilter] = useState('Todos')
  const [showShortcuts, setShowShortcuts] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const sr = useRef<any[]>([])
  const showShortcutsRef = useRef(false)
  const sectionRef = useRef<Section>('hoy')
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }, [])

  const popNavRef = useRef(false)
  useEffect(() => {
    if (!window.history.state?.nxSection) {
      window.history.replaceState({ nxSection: 'hoy' }, '', '#hoy')
    }
    const onPop = (e: PopStateEvent) => {
      const s = e.state?.nxSection
      if (s) {
        popNavRef.current = true
        setModal(null)
        setSearchOpen(false)
        setSidebarOpen(open => open && window.matchMedia('(max-width: 767px)').matches ? false : open)
        setSection(s)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (popNavRef.current) { popNavRef.current = false; return }
    if (window.history.state?.nxSection !== section) {
      window.history.pushState({ nxSection: section }, '', '#' + section)
    }
  }, [section])

  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('touchend', unlock, { passive: true })
    window.addEventListener('click', unlock)
    return () => { window.removeEventListener('touchend', unlock); window.removeEventListener('click', unlock) }
  }, [])

  const gPendingRef = useRef(false)
  const gTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null)
  useEffect(() => {
    const NAV: Record<string, Section> = { h:'hoy', t:'tareas', i:'inbox', c:'clientes', p:'proyectos', k:'contenido', a:'calendario', m:'memoria', e:'equipo', r:'reportes', s:'ajustes', v:'automatizaciones', n:'chat', y:'harvey' }
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true); setSearchQuery(''); setSearchIdx(-1); return }
      if (e.key === 'Escape') { if (showShortcutsRef.current) { setShowShortcuts(false); return } setSearchOpen(false); setModal(null); return }
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setShowShortcuts(s => !s); return }
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

  useEffect(() => {
    if (profile.gmail_connected) data.syncGmail().catch(()=>{})
    const interval = setInterval(() => {
      if (profile.gmail_connected) data.syncGmail().catch(()=>{})
    }, 15 * 60 * 1000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.gmail_connected])

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
    ].filter(r => r.title.toLowerCase().includes(q) || (r.sub||'').toLowerCase().includes(q)).slice(0, 9)
  })()
  sr.current = searchResults

  const typeColor: Record<string,string> = { Cliente:BLU, Proyecto:'rgba(255,176,32,0.9)', Tarea:RED, Memoria:'rgba(240,240,248,0.4)', Contenido:'#C13584', Inbox:'rgba(100,180,255,0.7)', Equipo:GRN }

  const overdueProjs = data.projects.filter((p: Project) => p.deadline && p.deadline !== 'TBD' && p.status !== 'completado' && dlDate(p.deadline) < new Date())

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
  showShortcutsRef.current = showShortcuts
  sectionRef.current = section

  const NAV_SC: Partial<Record<Section,string>> = { hoy:'H', tareas:'T', inbox:'I', clientes:'C', proyectos:'P', contenido:'K', calendario:'A', memoria:'M', equipo:'E', reportes:'R', ajustes:'S', automatizaciones:'V', chat:'N', harvey:'Y' }

  const navItem = (id: Section, label: string, icon: string, badge?: number) => {
    const act = section === id
    const sc = NAV_SC[id]
    return (
      <button key={id} onClick={()=>{setSection(id); if (isMobile) setSidebarOpen(false)}}
        className="flex items-center gap-3 w-full py-2.5 px-3 rounded-xl text-left transition-all duration-150 group"
        style={{
          background: act ? 'rgba(84,116,232,0.13)' : 'transparent',
          border: act ? '1px solid rgba(124,152,255,0.16)' : '1px solid transparent',
          color: act ? '#eef1fb' : 'rgba(230,235,247,0.5)',
          fontSize: '14px',
          fontWeight: act ? 600 : 450,
          marginBottom: '2px',
          boxShadow: act ? '0 0 22px rgba(70,100,225,0.10), inset 0 1px 0 rgba(255,255,255,0.04)' : 'none',
        }}
        onMouseEnter={e=>{ if(!act) e.currentTarget.style.background='rgba(255,255,255,0.032)' }}
        onMouseLeave={e=>{ if(!act) e.currentTarget.style.background='transparent' }}>
        <LucideIcon name={icon} size={17} color={act ? '#93b4ff' : 'rgba(206,216,240,0.42)'}/>
        <span className="flex-1 truncate">{label}</span>
        {badge !== undefined && badge > 0 && (
          <span className="font-figtree text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center" style={{background:'rgba(214,172,102,0.16)', color:'#e2b877'}}>{badge}</span>
        )}
        {sc && !(badge && badge > 0) && (
          <span className="opacity-0 group-hover:opacity-100 transition-opacity font-syne text-[7px] font-black flex-shrink-0" style={{color:'rgba(255,255,255,0.15)'}}>G·{sc}</span>
        )}
      </button>
    )
  }

  const navLabel = (text: string) => (
    <div className="px-3 pt-4 pb-1.5">
      <span className="font-syne font-black" style={{fontSize:'8.5px',letterSpacing:'0.22em',color:'rgba(230,235,250,0.24)'}}>{text}</span>
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
    <div className="flex h-screen w-full font-figtree overflow-hidden nx-app-root" style={{ background:'radial-gradient(ellipse 1400px 700px at 80% -10%,rgba(27,95,250,0.055) 0%,transparent 60%),radial-gradient(ellipse 500px 400px at 5% 95%,rgba(27,95,250,0.025) 0%,transparent 55%),#030308', color:'#F0F0F8' }}
      onClick={()=>notifOpen&&setNotifOpen(false)}>

      {/* SIDEBAR */}
      {isMobile && sidebarOpen && (
        <div onClick={()=>setSidebarOpen(false)} className="fixed inset-0 z-[85]" style={{background:'rgba(0,0,0,0.65)',backdropFilter:'blur(2px)'}}/>
      )}
      <aside className="flex-shrink-0 flex flex-col overflow-hidden transition-all duration-200"
        style={isMobile
          ? { position:'fixed', top:0, bottom:0, left:0, zIndex:90, width:'280px', maxWidth:'85vw', paddingTop:'env(safe-area-inset-top)', paddingBottom:'env(safe-area-inset-bottom)', transform:sidebarOpen?'translateX(0)':'translateX(-105%)', background:'rgba(8,8,18,0.98)', borderRight:`1px solid ${BORDER}`, boxShadow:sidebarOpen?'8px 0 40px rgba(0,0,0,0.6)':'none' }
          : { width:sidebarOpen?'248px':'0', background:'rgba(8,8,18,0.95)', borderRight:`1px solid ${BORDER}` }}>
        {/* Logo */}
        <div className="px-5 pt-6 pb-5 flex-shrink-0">
          <div className="flex items-center gap-3">
            <img src="/brutal-logo.svg" alt="Brutal Studios" style={{height:'22px',opacity:0.88,filter:`drop-shadow(0 0 8px ${BLU}40)`}} />
            <div className="h-5 w-px" style={{background:BORDER}}/>
            <span className="font-syne text-[10px] font-black tracking-widest" style={{color:BLU,textShadow:`0 0 10px ${BLU}60`}}>IA</span>
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
                          <button key={i} onClick={()=>{setNotifOpen(false);setSection('inbox'); if (isMobile) setSidebarOpen(false)}} className="w-full text-left px-4 py-2.5 transition-colors" style={{borderBottom:`1px solid rgba(255,255,255,0.04)`}} onMouseEnter={e=>(e.currentTarget.style.background='rgba(27,95,250,0.06)')} onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
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
                          <button key={i} onClick={()=>{setNotifOpen(false);setSection('tareas'); if (isMobile) setSidebarOpen(false)}} className="w-full text-left px-4 py-2.5 transition-colors" style={{borderBottom:i<notifData.urgent.length-1?`1px solid rgba(255,255,255,0.04)`:'none'}} onMouseEnter={e=>(e.currentTarget.style.background='rgba(229,29,42,0.05)')} onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
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
                          const daysOver = Math.round((Date.now()-dlDate(p.deadline).getTime())/86400000)
                          return (
                            <button key={i} onClick={()=>{setNotifOpen(false);setSection('proyectos'); if (isMobile) setSidebarOpen(false)}} className="w-full text-left px-4 py-2.5 transition-colors" style={{borderBottom:i<Math.min(overdueProjs.length,3)-1?`1px solid rgba(255,255,255,0.04)`:'none'}} onMouseEnter={e=>(e.currentTarget.style.background='rgba(255,176,32,0.05)')} onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
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
                        <button onClick={()=>{setNotifOpen(false);setSection('inbox'); if (isMobile) setSidebarOpen(false)}} className="w-full text-center font-syne text-[8.5px] font-black tracking-wide transition-opacity hover:opacity-60" style={{color:BLU}}>VER TODO EL INBOX</button>
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
        <nav className="flex-1 overflow-y-auto px-2.5 pb-2">
          {navLabel('TRABAJO')}
          {navItem('hoy','Hoy','sun',urgentCount)}
          {navItem('inbox','Inbox','inbox',unreadCount)}
          {navItem('calendario','Calendario','calendar',todayCalCount||undefined)}

          {navLabel('GESTIÓN')}
          {navItem('tareas','Tareas','check-square',data.tasks.filter((t:Task)=>!t.done&&t.level==='urgent').length||undefined)}
          {navItem('clientes','Clientes','users')}
          {navItem('proyectos','Proyectos','folder-open', data.projects.filter((p: Project)=>p.deadline&&p.deadline!=='TBD'&&p.status!=='completado'&&dlDate(p.deadline)<new Date()).length||undefined)}
          {navItem('contenido','Contenido','film')}

          {navLabel('IA')}
          {navItem('chat','Brutal.IA','message-square')}
          {profile.role==='owner' && (
            <button onClick={()=>{setSection('harvey'); if (isMobile) setSidebarOpen(false)}}
              className="flex items-center gap-3 w-full py-2.5 px-3 rounded-xl text-left transition-all duration-150"
              style={{
                background: section==='harvey' ? 'rgba(84,116,232,0.15)' : 'rgba(84,116,232,0.05)',
                border: `1px solid ${section==='harvey' ? 'rgba(124,152,255,0.2)' : 'rgba(124,152,255,0.1)'}`,
                color: section==='harvey' ? '#eef1fb' : 'rgba(147,180,255,0.7)',
                fontSize:'14px', fontWeight:section==='harvey'?600:500, marginBottom:'2px',
                boxShadow: section==='harvey' ? '0 0 22px rgba(70,100,225,0.12)' : 'none',
              }}>
              <LucideIcon name="cpu" size={17} color={section==='harvey'?'#93b4ff':'rgba(147,180,255,0.6)'}/>
              <span className="flex-1 truncate">Harvey</span>
              <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:'rgba(124,152,255,0.14)',color:'rgba(147,180,255,0.7)',letterSpacing:'0.1em'}}>AI</span>
            </button>
          )}
          {navItem('ajustes','Operativa','settings')}
        </nav>

        {/* Footer */}
        <div className="p-3 flex-shrink-0" style={{borderTop:`1px solid ${BORDER}`}}>
          {!profile.gmail_connected && (
            <button onClick={()=>{setSection('ajustes'); if (isMobile) setSidebarOpen(false)}} className="flex items-center gap-2 w-full px-3 py-2 rounded-xl mb-2 font-syne text-[9px] font-black tracking-wide transition-all hover:opacity-80" style={{background:'rgba(27,95,250,0.06)',color:'rgba(27,95,250,0.6)',border:`1px solid rgba(27,95,250,0.14)`}}>
              <LucideIcon name="link-2" size={11} color="rgba(27,95,250,0.5)"/>Conectar cuentas
            </button>
          )}
          <div className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-white/2 transition-colors cursor-default">
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 font-syne text-[11px] font-black" style={{background:profile.avatar_color+'18',border:`1.5px solid ${profile.avatar_color}35`,color:profile.avatar_color}}>{profile.initials}</div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-white/75 truncate leading-tight">{profile.name}</div>
              <div className="text-[10px] mt-0.5" style={{color:'rgba(255,255,255,0.2)'}}>{profile.role === 'owner' ? 'Propietario' : 'Equipo'}</div>
            </div>
            <button onClick={toggleTheme} title={lightMode?'Modo oscuro':'Modo claro'} className="opacity-20 hover:opacity-50 transition-opacity flex-shrink-0"><LucideIcon name={lightMode?'moon':'sun'} size={14}/></button>
            <button onClick={handleLogout} className="opacity-20 hover:opacity-50 transition-opacity flex-shrink-0"><LucideIcon name="log-out" size={14}/></button>
          </div>
          <button onClick={()=>setSidebarOpen(false)} className="flex items-center justify-center w-full py-1.5 mt-1 transition-colors" style={{color:'rgba(255,255,255,0.12)'}}>
            <LucideIcon name="panel-left-close" size={13}/>
          </button>
        </div>
      </aside>

      {!sidebarOpen && !isMobile && (
        <button onClick={()=>setSidebarOpen(true)} className="fixed top-5 left-4 z-50 w-8 h-8 flex items-center justify-center rounded-xl transition-all" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
          <LucideIcon name="panel-left-open" size={14} color="rgba(240,240,248,0.4)"/>
        </button>
      )}

      {/* MAIN */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {isMobile && (
          <div className="flex items-center gap-3 px-3 flex-shrink-0" style={{height:'calc(50px + env(safe-area-inset-top))',paddingTop:'env(safe-area-inset-top)',borderBottom:`1px solid ${BORDER}`,background:'rgba(8,8,18,0.92)'}}>
            <button onClick={()=>setSidebarOpen(true)} className="w-9 h-9 flex items-center justify-center rounded-xl flex-shrink-0" style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${BORDER}`}}>
              <LucideIcon name="menu" size={16} color="rgba(240,240,248,0.55)"/>
            </button>
            {section !== 'hoy' && (
              <button onClick={()=>window.history.back()} className="w-9 h-9 flex items-center justify-center rounded-xl flex-shrink-0" style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${BORDER}`}}>
                <LucideIcon name="arrow-left" size={16} color="rgba(240,240,248,0.55)"/>
              </button>
            )}
            <span className="font-syne text-[10px] font-black tracking-[0.25em] truncate" style={{color:'rgba(255,255,255,0.55)'}}>
              {({hoy:'HOY',inbox:'INBOX',calendario:'CALENDARIO',tareas:'TAREAS',clientes:'CLIENTES',proyectos:'PROYECTOS',contenido:'CONTENIDO',chat:'BRUTAL.IA',harvey:'HARVEY',ajustes:'OPERATIVA',memoria:'MEMORIA',equipo:'EQUIPO',reportes:'REPORTES',automatizaciones:'AUTOMATIZACIONES'} as Record<string,string>)[section] || 'BRUTAL.IA'}
            </span>
            {isOwner && (
              <div className="relative ml-auto">
                <button onClick={()=>setQuickCreateOpen(!quickCreateOpen)} className="w-9 h-9 flex items-center justify-center rounded-xl" style={{background:quickCreateOpen?'rgba(27,95,250,0.15)':'rgba(255,255,255,0.03)',border:`1px solid ${quickCreateOpen?'rgba(27,95,250,0.3)':BORDER}`}}>
                  <LucideIcon name="plus" size={16} color={quickCreateOpen?BLU:'rgba(240,240,248,0.55)'}/>
                </button>
                {quickCreateOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={()=>setQuickCreateOpen(false)}/>
                    <div className="absolute right-0 top-full mt-2 z-50 rounded-2xl py-2 min-w-[180px] animate-fadeUp" style={{background:'#12122A',border:`1px solid ${BORDER}`,boxShadow:'0 12px 40px rgba(0,0,0,0.6)'}}>
                      {([{icon:'check-square',label:'Tarea',modal:'tarea'},{icon:'users',label:'Cliente',modal:'cliente'},{icon:'folder-open',label:'Proyecto',modal:'proyecto'},{icon:'film',label:'Pieza',modal:'contenido'},{icon:'zap',label:'Regla',modal:'regla'}] as const).map(item=>(
                        <button key={item.modal} onClick={()=>{setQuickCreateOpen(false);setModal(item.modal);setMf({})}} className="flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors hover:bg-white/5">
                          <LucideIcon name={item.icon} size={14} color="rgba(240,240,248,0.4)"/>
                          <span className="font-syne text-[10px] font-black tracking-wide" style={{color:'rgba(240,240,248,0.7)'}}>{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <button onClick={()=>{setSearchOpen(true);setSearchQuery('');setSearchIdx(-1)}} className={isOwner?'w-9 h-9 flex items-center justify-center rounded-xl':'ml-auto w-9 h-9 flex items-center justify-center rounded-xl'} style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${BORDER}`}}>
              <LucideIcon name="search" size={15} color="rgba(240,240,248,0.45)"/>
            </button>
          </div>
        )}
        {offline && (
          <div className="flex items-center justify-center gap-2 px-4 py-2 flex-shrink-0" style={{background:'rgba(229,29,42,0.12)',borderBottom:'1px solid rgba(229,29,42,0.25)'}}>
            <div className="w-1.5 h-1.5 rounded-full" style={{background:RED}}/>
            <span className="font-syne text-[8px] font-black tracking-widest" style={{color:RED}}>SIN CONEXIÓN — LOS CAMBIOS NO SE GUARDARÁN</span>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {section === 'hoy' && <SectionErrorBoundary section="hoy"><HoySection profile={profile} data={data} urgentCount={urgentCount} unreadCount={unreadCount} onOpenModal={setModal} showToast={showToast} isOwner={isOwner} onNavigate={setSection} /></SectionErrorBoundary>}
          {section === 'inbox' && <SectionErrorBoundary section="inbox"><InboxSection data={data} showToast={showToast} profile={profile} onNavigate={setSection} onSelectClient={setSelectedClient} onAskHarvey={(msg: string)=>{ setHarveyPreload(msg); setSection('harvey') }} /></SectionErrorBoundary>}
          {section === 'tareas' && <SectionErrorBoundary section="tareas"><TareasSection data={data} onOpenModal={setModal} showToast={showToast} isOwner={isOwner} onNavigate={setSection} onSelectProject={setSelectedProject} onSelectClient={setSelectedClient} /></SectionErrorBoundary>}
          {section === 'equipo' && <SectionErrorBoundary section="equipo"><EquipoSection data={data} profile={profile} showToast={showToast} /></SectionErrorBoundary>}
          {section === 'reportes' && <SectionErrorBoundary section="reportes">{isOwner ? <ReportesSection data={data} onNavigate={setSection} /> : <div className="h-full flex items-center justify-center"><div className="text-center"><div className="font-syne text-[10px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.2)'}}>SECCIÓN RESTRINGIDA</div><div className="text-[12px]" style={{color:'rgba(255,255,255,0.3)'}}>Solo disponible para propietarios</div></div></div>}</SectionErrorBoundary>}
          {section === 'clientes' && <SectionErrorBoundary section="clientes"><ClientesSection data={data} selectedId={selectedClient} onSelect={setSelectedClient} onOpenModal={setModal} onSetMf={setMf} showToast={showToast} isOwner={isOwner} onNavigate={setSection} onSelectProject={setSelectedProject} /></SectionErrorBoundary>}
          {section === 'proyectos' && <SectionErrorBoundary section="proyectos"><ProyectosSection data={data} filteredProjects={filteredProjects} kanbanCols={kanbanCols} projView={projView} setProjView={setProjView} projStatusFilter={projStatusFilter} setProjStatusFilter={setProjStatusFilter} dragRef={dragRef} selectedId={selectedProject} onSelect={setSelectedProject} onOpenModal={setModal} onSetMf={setMf} showToast={showToast} isOwner={isOwner} onNavigate={setSection} onSelectClient={setSelectedClient} /></SectionErrorBoundary>}
          {section === 'contenido' && <SectionErrorBoundary section="contenido"><ContenidoSection data={data} onOpenModal={setModal} showToast={showToast} onNavigate={setSection} onSelectClient={setSelectedClient} profile={profile} /></SectionErrorBoundary>}
          {section === 'calendario' && <SectionErrorBoundary section="calendario"><CalendarioSection data={data} profile={profile} showToast={showToast} onOpenModal={setModal} onSetMf={setMf} /></SectionErrorBoundary>}
          {section === 'memoria' && <SectionErrorBoundary section="memoria"><MemoriaSection data={data} memFilter={memFilter} setMemFilter={setMemFilter} onOpenModal={setModal} showToast={showToast} /></SectionErrorBoundary>}
          {section === 'automatizaciones' && <SectionErrorBoundary section="automatizaciones"><AutomatizacionesSection data={data} onOpenModal={setModal} showToast={showToast} isOwner={isOwner} /></SectionErrorBoundary>}
          {section === 'chat' && <SectionErrorBoundary section="chat"><ChatSection profile={profile} data={data} chatInput={chatInput} setChatInput={setChatInput} chatLoading={chatLoading} setChatLoading={setChatLoading} showToast={showToast} onNavigate={setSection} /></SectionErrorBoundary>}
          {section === 'harvey' && <SectionErrorBoundary section="harvey"><HarveySection data={data} profile={profile} showToast={showToast} onNavigate={setSection} preloadMessage={harveyPreload} onClearPreload={()=>setHarveyPreload(null)} /></SectionErrorBoundary>}
          {section === 'ajustes' && <SectionErrorBoundary section="ajustes"><AjustesSection profile={profile} data={data} showToast={showToast} memFilter={memFilter} setMemFilter={setMemFilter} onOpenModal={setModal} isOwner={isOwner} /></SectionErrorBoundary>}
        </div>

        {/* Tab bar inferior móvil */}
        {isMobile && (
          <nav className="flex items-stretch flex-shrink-0" style={{borderTop:`1px solid ${BORDER}`,background:'#080812',backdropFilter:'blur(14px)',paddingBottom:'max(env(safe-area-inset-bottom), 4px)'}}>
            {([
              {id:'hoy' as Section, icon:'sun', label:'HOY'},
              {id:'inbox' as Section, icon:'inbox', label:'INBOX', badge: unreadCount},
              {id:'tareas' as Section, icon:'check-square', label:'TAREAS', badge: urgentCount},
              {id:'proyectos' as Section, icon:'folder-open', label:'PROY.'},
              {id:'chat' as Section, icon:'message-square', label:'IA'},
            ]).map(t => {
              const act = section === t.id
              return (
                <button key={t.id} onClick={()=>{setSection(t.id); setSidebarOpen(false)}} className="flex-1 flex flex-col items-center justify-center gap-1 pt-2.5 pb-2 relative transition-colors">
                  <div style={{height:'2px',width:'26px',borderRadius:'2px',background:act?BLU:'transparent',position:'absolute',top:0}}/>
                  <div className="relative">
                    <LucideIcon name={t.icon} size={18} color={act?BLU:'rgba(240,240,248,0.28)'}/>
                    {(t as any).badge > 0 && (
                      <div className="absolute -top-1.5 -right-2 min-w-[14px] h-[14px] px-0.5 rounded-full flex items-center justify-center" style={{background:RED}}>
                        <span className="font-syne text-[7px] font-black text-white leading-none">{(t as any).badge>9?'9+':(t as any).badge}</span>
                      </div>
                    )}
                  </div>
                  <span className="font-syne text-[6.5px] font-black tracking-[0.15em]" style={{color:act?BLU:'rgba(240,240,248,0.22)'}}>{t.label}</span>
                </button>
              )
            })}
          </nav>
        )}
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
                    {([['H','HOY'],['T','TAREAS'],['I','INBOX'],['C','CLIENTES'],['P','PROYECTOS'],['K','CONTENIDO'],['A','CALENDARIO'],['M','MEMORIA'],['E','EQUIPO'],['R','REPORTES'],['V','AUTOM.'],['N','CHAT'],['S','OPERATIVA']] as [string,string][]).map(([k,l])=>(
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
        <div onClick={()=>setModal(null)} className="fixed inset-0 z-[100] flex items-center justify-center" style={{background:'rgba(2,2,10,0.8)',backdropFilter:'blur(8px)',touchAction:'none'}}>
          <div onClick={e=>e.stopPropagation()} onKeyDown={(e)=>{if(e.key==='Enter'&&(e.target as HTMLElement).tagName!=='TEXTAREA'&&!modalSaving){e.preventDefault();saveModal()}}}
            className={isMobile ? 'relative w-full flex flex-col' : 'relative w-[480px] max-w-[94vw] rounded-3xl'}
            style={isMobile
              ? {background:'linear-gradient(180deg,#0D0D1E 0%,#080810 100%)',height:'100dvh',paddingTop:'env(safe-area-inset-top)',paddingBottom:'env(safe-area-inset-bottom)',touchAction:'pan-y'}
              : {background:'linear-gradient(180deg,#0D0D1E 0%,#080810 100%)',border:`1px solid rgba(27,95,250,0.25)`,boxShadow:'0 40px 100px rgba(0,0,0,0.8),0 0 0 1px rgba(27,95,250,0.05)',maxHeight:'94dvh',overflowY:'auto'}}>
            {/* Top accent */}
            <div className="h-[2px] rounded-t-3xl" style={{background:`linear-gradient(90deg,transparent,${BLU},transparent)`}}/>
            {/* Header */}
            <div className={isMobile ? 'flex items-center justify-between px-5 py-4 flex-shrink-0' : 'flex items-center justify-between px-7 py-6'} style={{borderBottom:`1px solid ${BORDER}`}}>
              <div>
                <div className="font-syne text-[9px] font-black tracking-widest mb-1.5" style={{color:'rgba(100,140,255,0.6)'}}>{modalMeta[modal]?.eyebrow}</div>
                <h2 className="font-syne text-[22px] font-black text-white leading-none">{modalMeta[modal]?.title}</h2>
              </div>
              <button onClick={()=>setModal(null)} className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5" style={{background:SURF2}}>
                <LucideIcon name="x" size={16} color="rgba(240,240,248,0.45)"/>
              </button>
            </div>
            {/* Fields */}
            <div className={isMobile ? 'px-5 py-4 space-y-3.5 flex-1 overflow-y-auto' : 'px-7 py-6 space-y-5'} style={isMobile?{overscrollBehavior:'contain'}:undefined}>
              {modalFields(modal, data.team).map(f => (
                <div key={f.key}>
                  <label className={isMobile ? 'block font-syne text-[9px] font-black tracking-widest mb-2' : 'block font-syne text-[9px] font-black tracking-widest mb-3'} style={{color:'rgba(255,255,255,0.28)'}}>{f.label.toUpperCase()}</label>
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
                  ) : f.type === 'account' ? (
                    <div className="flex gap-2 flex-wrap">
                      {['Brutal Studios','Julio','Pablo'].map(acc=>{
                        const isActive = mf[f.key]===acc
                        return (
                          <button key={acc} onClick={()=>setMf(m=>({...m,[f.key]:acc}))} className="flex-1 py-3 px-3.5 rounded-2xl font-syne text-[9px] font-black tracking-wide transition-all" style={{background:isActive?BLU+'18':SURF2,border:`1.5px solid ${isActive?BLU+'55':BORDER}`,color:isActive?BLU:'rgba(255,255,255,0.3)'}}>
                            {acc}
                          </button>
                        )
                      })}
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
            <div className={isMobile ? 'flex gap-3 px-5 py-4 flex-shrink-0' : 'flex justify-end gap-3 px-7 py-5'} style={{borderTop:`1px solid ${BORDER}`}}>
              <button onClick={()=>setModal(null)} className="px-5 py-3 rounded-2xl text-[13px] transition-colors hover:text-white/70" style={{color:'rgba(255,255,255,0.4)',border:`1px solid ${BORDER}`}}>Cancelar</button>
              <button onClick={saveModal} disabled={modalSaving} className={isMobile ? 'flex-1 px-6 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white disabled:opacity-50 transition-all' : 'px-6 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white disabled:opacity-50 transition-all'} style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
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

      {/* SHORTCUTS OVERLAY */}
      {showShortcuts && (() => {
        const SECTION_HINTS: Partial<Record<Section,{key:string;label:string}[]>> = {
          hoy: [{key:'N',label:'Nueva tarea'}],
          tareas: [{key:'J / K',label:'Navegar lista'},{key:'N',label:'Nueva tarea'},{key:'C',label:'Completar tarea'},{key:'L',label:'Ciclar nivel'},{key:'D',label:'Establecer fecha'},{key:'S',label:'Guardar cambios'},{key:'1–8',label:'Filtrar por estado'}],
          inbox: [{key:'J / K',label:'Navegar mensajes'},{key:'E',label:'Marcar leído'},{key:'T',label:'Crear tarea desde msg'},{key:'A',label:'Todo leído'},{key:'ESC',label:'Cerrar detalle'}],
          clientes: [{key:'N',label:'Nuevo cliente'},{key:'ESC',label:'Cerrar detalle'}],
          proyectos: [{key:'N',label:'Nuevo proyecto'},{key:'V',label:'Cambiar vista'},{key:'S',label:'Ciclar estado'},{key:'P',label:'Editar progreso'}],
          contenido: [{key:'J / K',label:'Navegar pipeline'},{key:'S',label:'Ciclar estado'},{key:'F',label:'Buscar pieza'},{key:'N',label:'Nueva pieza'}],
          memoria: [{key:'N',label:'Nueva entrada'},{key:'E',label:'Editar'},{key:'P',label:'Anclar/desanclar'},{key:'F',label:'Buscar'}],
          equipo: [{key:'J / K',label:'Navegar equipo'},{key:'M',label:'Escribir mensaje'},{key:'ESC',label:'Cerrar perfil'}],
          chat: [{key:'N',label:'Enfocar input'},{key:'1–6',label:'Enviar prompt rápido'}],
          automatizaciones: [{key:'J / K',label:'Navegar reglas'},{key:'E',label:'Activar/pausar'},{key:'N',label:'Nueva regla'}],
        }
        const sectionHints = SECTION_HINTS[section] || []
        const sectionLabels: Record<Section,string> = {hoy:'Hoy',tareas:'Tareas',inbox:'Inbox',clientes:'Clientes',proyectos:'Proyectos',contenido:'Contenido',calendario:'Calendario',memoria:'Memoria',equipo:'Equipo',chat:'Chat IA',automatizaciones:'Automatizaciones',reportes:'Reportes',ajustes:'Operativa',harvey:'Harvey'}
        return (
          <div onClick={()=>setShowShortcuts(false)} className="fixed inset-0 z-[120] flex items-center justify-center" style={{background:'rgba(2,2,8,0.75)',backdropFilter:'blur(6px)'}}>
            <div onClick={e=>e.stopPropagation()} className="w-[560px] max-w-[94vw] rounded-3xl" style={{background:'linear-gradient(180deg,#0D0D1E 0%,#080810 100%)',border:`1px solid rgba(27,95,250,0.2)`,boxShadow:'0 40px 100px rgba(0,0,0,0.85),0 0 0 1px rgba(27,95,250,0.04)',maxHeight:'94dvh',overflowY:'auto'}}>
              <div className="h-[2px]" style={{background:`linear-gradient(90deg,transparent,${BLU},transparent)`}}/>
              <div className="flex items-center justify-between px-7 py-5" style={{borderBottom:`1px solid ${BORDER}`}}>
                <div>
                  <div className="font-syne text-[8.5px] font-black tracking-widest mb-1.5" style={{color:'rgba(100,140,255,0.5)'}}>ATAJOS DE TECLADO</div>
                  <h2 className="font-figtree text-[22px] font-black text-white leading-none">{sectionLabels[section]}</h2>
                </div>
                <div className="flex items-center gap-2.5">
                  <kbd className="font-syne text-[9px] font-black px-2.5 py-1.5 rounded-lg" style={{background:SURF2,color:BLU,border:'1px solid rgba(27,95,250,0.2)'}}>?</kbd>
                  <button onClick={()=>setShowShortcuts(false)} className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5" style={{background:SURF2}}>
                    <LucideIcon name="x" size={14} color="rgba(240,240,248,0.4)"/>
                  </button>
                </div>
              </div>
              <div className="px-7 py-6 grid grid-cols-2 gap-x-8">
                <div>
                  <div className="font-syne text-[7.5px] font-black tracking-widest mb-4" style={{color:'rgba(255,255,255,0.14)'}}>NAVEGACIÓN GLOBAL</div>
                  <div className="space-y-2.5">
                    {([['⌘K','Búsqueda global'],['G·H','Hoy'],['G·T','Tareas'],['G·I','Inbox'],['G·C','Clientes'],['G·P','Proyectos'],['G·K','Contenido'],['G·A','Calendario'],['G·M','Memoria'],['G·E','Equipo'],['G·R','Reportes'],['G·V','Automatizaciones'],['G·N','Chat IA'],['G·S','Operativa'],['?','Mostrar esta ayuda'],['ESC','Cerrar paneles']] as [string,string][]).map(([k,l])=>(
                      <div key={k} className="flex items-center gap-3">
                        <kbd className="font-syne text-[8px] font-black px-2 py-1 rounded-lg flex-shrink-0 text-center" style={{background:SURF2,color:BLU,border:'1px solid rgba(27,95,250,0.15)',minWidth:'46px'}}>{k}</kbd>
                        <span className="text-[11.5px]" style={{color:'rgba(255,255,255,0.38)'}}>{l}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="font-syne text-[7.5px] font-black tracking-widest mb-4" style={{color:'rgba(255,255,255,0.14)'}}>EN {sectionLabels[section].toUpperCase()}</div>
                  {sectionHints.length > 0 ? (
                    <div className="space-y-2.5">
                      {sectionHints.map(h=>(
                        <div key={h.key} className="flex items-center gap-3">
                          <kbd className="font-syne text-[8px] font-black px-2 py-1 rounded-lg flex-shrink-0 text-center" style={{background:SURF2,color:'rgba(240,240,248,0.55)',border:`1px solid rgba(255,255,255,0.09)`,minWidth:'46px'}}>{h.key}</kbd>
                          <span className="text-[11.5px]" style={{color:'rgba(255,255,255,0.38)'}}>{h.label}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[12px]" style={{color:'rgba(255,255,255,0.14)'}}>Sin atajos específicos</div>
                  )}
                </div>
              </div>
              <div className="px-7 py-3.5 flex items-center gap-2" style={{borderTop:`1px solid ${BORDER}`}}>
                <span className="text-[10px]" style={{color:'rgba(255,255,255,0.14)'}}>Presiona</span>
                <kbd className="font-syne font-black text-[8.5px] px-1.5 py-0.5 rounded" style={{background:SURF2,color:'rgba(255,255,255,0.28)',border:`1px solid ${BORDER}`}}>?</kbd>
                <span className="text-[10px]" style={{color:'rgba(255,255,255,0.14)'}}>o</span>
                <kbd className="font-syne font-black text-[8.5px] px-1.5 py-0.5 rounded" style={{background:SURF2,color:'rgba(255,255,255,0.28)',border:`1px solid ${BORDER}`}}>ESC</kbd>
                <span className="text-[10px]" style={{color:'rgba(255,255,255,0.14)'}}>para cerrar</span>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Search shortcut button — solo escritorio */}
      {!isMobile && <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2">
        <button onClick={()=>setShowShortcuts(s=>!s)} className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl font-syne text-[10px] font-bold tracking-widest opacity-50 hover:opacity-100 transition-opacity" style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', color:'rgba(255,255,255,0.25)' }}>
          <span>?</span>
        </button>
        <button onClick={()=>setSearchOpen(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne text-[10px] font-bold tracking-widest opacity-60 hover:opacity-100 transition-opacity" style={{ background:'rgba(27,95,250,0.08)', border:'1px solid rgba(27,95,250,0.15)', color:'rgba(255,255,255,0.3)' }}>
          <LucideIcon name="search" size={12} color="rgba(27,95,250,0.5)" />
          <span>⌘K</span>
        </button>
      </div>}
    </div>
  )
}

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
      { label:'Cuenta / Perfil', key:'cuenta', type:'account', placeholder:'' },
      { label:'Fecha de publicación', key:'fecha', type:'date-input', placeholder:'' },
      { label:'Estado', key:'estado', type:'status' },
    ],
  }
  return maps[type] || []
}
