'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { BLU, RED, GRN, SURFACE, SURF2, BORDER } from '@/components/shared'
import { useIsMobile, useBackClosable } from '@/components/shared'
import { strColor, relTime, todayKey } from '@/components/shared'
import { LucideIcon } from '@/components/shared'

// Empareja el "cliente" detectado por la IA con un cliente real.
// La primera palabra del nombre solo se usa como match parcial si es distintiva
// (≥4 caracteres) para no asociar por error emails a clientes cuyo nombre empieza
// por "El", "La", "De", etc. (p. ej. "El Corte" no debe casar con "Manuel").
function matchClientByName(clients: any[], aiClient?: string | null) {
  if (!aiClient || aiClient === 'Desconocido') return null
  const ai = aiClient.toLowerCase()
  return clients.find((c: any) => {
    const name = (c.name || '').toLowerCase()
    if (!name) return false
    if (name.includes(ai)) return true
    const firstWord = name.split(' ')[0]
    return firstWord.length >= 4 && ai.includes(firstWord)
  }) || null
}

function EmailBodyBlock({preview, gmailId}: {preview:string; gmailId?:string}) {
  const [expanded, setExpanded] = useState(false)
  const SURFACE = '#0A0A14'
  const BORDER = 'rgba(255,255,255,0.06)'
  const short = preview.slice(0, 280)
  const needsMore = preview.length > 280
  return (
    <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
      <div className="flex items-center justify-between px-5 py-3" style={{borderBottom:`1px solid ${BORDER}`}}>
        <div className="font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.18)'}}>CONTENIDO DEL EMAIL</div>
        {gmailId && (
          <a href={`/api/inbox/gmail-open?id=${gmailId}`} target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 font-syne text-[7.5px] font-black tracking-wide transition-opacity hover:opacity-60"
            style={{color:'rgba(234,67,53,0.7)',textDecoration:'none'}}>
            <svg viewBox="0 0 24 24" width={10} height={10}><path fill="#EA4335" d="M22.5 12.5c0-.83-.07-1.64-.2-2.42H12v4.59h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.25z"/><path fill="#4285F4" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            VER EN GMAIL ↗
          </a>
        )}
      </div>
      <div className="p-5">
        <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap" style={{color:'rgba(255,255,255,0.42)'}}>
          {expanded ? preview : short}{needsMore&&!expanded&&'…'}
        </p>
        {needsMore && (
          <button onClick={()=>setExpanded(v=>!v)} className="mt-3 font-syne text-[8px] font-black tracking-wide transition-opacity hover:opacity-60" style={{color:'rgba(255,255,255,0.2)'}}>
            {expanded?'VER MENOS ↑':'VER MÁS ↓'}
          </button>
        )}
      </div>
    </div>
  )
}

function InboxSection({data,showToast,profile,onNavigate,onSelectClient,onAskHarvey}: any) {
  const isMobile = useIsMobile()
  const [filter, setFilter] = useState('Todos')
  const [selected, setSelected] = useState<any>(null)
  useBackClosable(!!selected, () => setSelected(null))
  const [creatingTask, setCreatingTask] = useState(false)
  const creatingTaskRef = useRef(false)
  // Harvey reply draft
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyDraft, setReplyDraft] = useState('')
  const [replyLoading, setReplyLoading] = useState(false)
  const [replyCopied, setReplyCopied] = useState(false)
  const [activeSender, setActiveSender] = useState<string|null>(null)
  const [archivedIds, setArchivedIds] = useState<Set<string>>(()=>{
    try { return new Set(JSON.parse(localStorage.getItem('nexus_archived_ids')||'[]')) } catch { return new Set() }
  })

  const archiveMessage = (m: any) => {
    const next = new Set(archivedIds)
    next.add(m.id)
    setArchivedIds(next)
    try { localStorage.setItem('nexus_archived_ids', JSON.stringify([...next])) } catch {}
    setSelected(null)
    showToast('Mensaje archivado')
  }

  const unarchiveMessage = (m: any) => {
    const next = new Set(archivedIds)
    next.delete(m.id)
    setArchivedIds(next)
    try { localStorage.setItem('nexus_archived_ids', JSON.stringify([...next])) } catch {}
    setSelected(null)
    showToast('Mensaje restaurado')
  }
  const filteredRef = useRef<any[]>([])
  const allInboxRef = useRef<any[]>([])

  useEffect(()=>{
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selected) { setSelected(null); return }
      if (e.key === 'e' && selected && !['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault()
        if (selected.is_read) { data.markUnread(selected.id).catch(()=>{}); setSelected((s: any)=>s?{...s,is_read:false,is_unread:true}:s) }
        else { data.markRead(selected.id).catch(()=>{}); setSelected((s: any)=>s?{...s,is_read:true,is_unread:false}:s) }
        return
      }
      if (e.key === 't' && selected && selected.ai_action && !['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) && !(e.metaKey||e.ctrlKey||e.altKey)) {
        e.preventDefault(); createTaskFromEmail(selected); return
      }
      if ((e.key === 'j' || e.key === 'k') && !['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault()
        const msgs = filteredRef.current
        setSelected((sel: any) => {
          const idx = sel ? msgs.findIndex((m: any)=>m.id===sel.id) : -1
          const next = e.key==='j' ? Math.min(idx+1, msgs.length-1) : Math.max(idx-1, 0)
          const m = msgs[next]
          if (m && !m.is_read) data.markRead(m.id).catch(()=>{})
          return m || sel
        })
      }
      if (e.key === 'a' && !selected && !['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) && !(e.metaKey||e.ctrlKey||e.altKey)) {
        e.preventDefault()
        const unreadMsgs = allInboxRef.current.filter((m: any) => !m.is_read)
        if (unreadMsgs.length > 0) {
          Promise.all(unreadMsgs.map((m: any) => data.markRead(m.id))).catch(()=>{})
          showToast(`${unreadMsgs.length} mensajes marcados como leídos`)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selected])

  const allMsgs: any[] = data.inbox as any[]
  const activeMsgs = allMsgs.filter((m:any)=>!archivedIds.has(m.id))
  allInboxRef.current = activeMsgs
  const unread = activeMsgs.filter(m=>!m.is_read).length
  const urgent = activeMsgs.filter(m=>m.ai_urgency==='urgent'&&!m.is_read).length
  const internal = activeMsgs.filter(m=>m.source==='internal'&&!m.is_read).length
  const fromClients = activeMsgs.filter(m=>m.ai_client&&m.ai_client!=='Desconocido'&&!m.is_read).length

  const calEvents = ((data.calendarEvents||[]) as any[]).sort((a:any,b:any)=>(a.start||'').localeCompare(b.start||''))
  const filtered = filter==='Archivados'
    ? allMsgs.filter((m:any)=>archivedIds.has(m.id))
    : activeMsgs.filter((m: any) => {
        if (filter==='Calendar') return false
        if (filter==='Todos') return true
        if (filter==='Sin leer') return !m.is_read
        if (filter==='Urgente') return m.ai_urgency==='urgent'
        if (filter==='Clientes') return m.ai_client&&m.ai_client!=='Desconocido'
        if (filter==='Interno') return m.source==='internal'
        if (filter==='Personal') return m.source==='gmail'&&!m.shared
        if (filter==='Colabs') return m.source==='gmail'&&m.shared
        if (filter==='Gmail') return m.source==='gmail'
        if (filter==='WhatsApp') return m.source==='whatsapp'
        return true
      })
  filteredRef.current = filtered

  const personalGmailCount  = activeMsgs.filter((m:any)=>m.source==='gmail'&&!m.shared).length
  const personalGmailUnread = activeMsgs.filter((m:any)=>m.source==='gmail'&&!m.shared&&!m.is_read).length
  const colabsGmailCount    = activeMsgs.filter((m:any)=>m.source==='gmail'&&m.shared).length
  const colabsGmailUnread   = activeMsgs.filter((m:any)=>m.source==='gmail'&&m.shared&&!m.is_read).length
  const archivedCount       = archivedIds.size

  const handleSelect = (m: any) => {
    setSelected(m)
    setReplyOpen(false)
    setReplyDraft('')
    setReplyCopied(false)
    if (!m.is_read) data.markRead(m.id).catch(()=>{})
  }

  const openHarveyReply = useCallback(async (m: any) => {
    setReplyOpen(true)
    setReplyDraft('')
    setReplyCopied(false)
    setReplyLoading(true)
    try {
      const res = await fetch('/api/inbox/harvey-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromName: m.from_name,
          fromEmail: m.from_email,
          subject: m.subject,
          summary: m.ai_summary,
          aiAction: m.ai_action,
          senderLanguage: 'español',
        }),
      })
      const json = await res.json()
      setReplyDraft(json.draft || '')
    } catch { setReplyDraft('Error al generar borrador.') }
    finally { setReplyLoading(false) }
  }, [])

  const createTaskFromEmail = async (m: any) => {
    if (!m.ai_action || creatingTaskRef.current) return
    creatingTaskRef.current = true
    setCreatingTask(true)
    try {
      const client = matchClientByName(data.clients, m.ai_client)
      await data.createTask({ text: m.ai_action, level: m.ai_urgency==='urgent'?'urgent':'high', source:'gmail', client_id: client?.id })
      showToast('Tarea creada' + (client ? ` · ${client.name}` : ''))
    } catch { showToast('Error') }
    finally { creatingTaskRef.current = false; setCreatingTask(false) }
  }

  const getDateLabel = (dateStr: string) => {
    const now = new Date()
    const d = new Date(dateStr)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const diffDays = Math.round((todayStart.getTime() - msgDay.getTime()) / 86400000)
    if (diffDays === 0) return 'HOY'
    if (diffDays === 1) return 'AYER'
    if (diffDays < 7) return 'ESTA SEMANA'
    return 'ANTERIORES'
  }

  const groups: {label:string; items:any[]}[] = []
  const byLabel: Record<string,any[]> = {}
  filtered.forEach(m => { const l = getDateLabel(m.received_at); if (!byLabel[l]) byLabel[l] = []; byLabel[l].push(m) })
  ;['HOY','AYER','ESTA SEMANA','ANTERIORES'].forEach(l => { if (byLabel[l]?.length) groups.push({label:l, items:byLabel[l]}) })

  const matchedClient = matchClientByName(data.clients, selected?.ai_client)
  const relatedTasks = matchedClient ? data.tasks.filter((t: any) => !t.done && t.client_id===matchedClient.id).slice(0, 4) : []

  const uc = (u: string) => u==='urgent'?RED:u==='high'?'rgba(255,176,32,0.9)':BLU
  const ul = (u: string) => u==='urgent'?'URGENTE':u==='high'?'ALTA':'NORMAL'

  const tabs = [
    {id:'Todos', label:'Todos', n: allMsgs.length, accent:'rgba(255,255,255,0.35)'},
    {id:'Sin leer', label:'Sin leer', n: unread, accent: BLU},
    {id:'Urgente', label:'Urgente', n: urgent, accent: RED},
    {id:'Personal', label:'Personal', n: personalGmailCount, accent:'rgba(234,67,53,0.8)'},
    {id:'Colabs', label:'Colabs', n: colabsGmailCount, accent: GRN},
    {id:'Clientes', label:'Clientes', n: fromClients, accent:'rgba(255,176,32,0.8)'},
    {id:'Interno', label:'Equipo', n: internal, accent: 'rgba(167,139,250,0.8)'},
    ...(allMsgs.some((m:any)=>m.source==='whatsapp') ? [{id:'WhatsApp', label:'WhatsApp', n: allMsgs.filter((m:any)=>m.source==='whatsapp').length, accent:'rgba(37,211,102,0.8)'}] : []),
  ]

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── LEFT: cuentas y carpetas ── */}
      {!isMobile && (
        <div className="flex-shrink-0 flex flex-col overflow-y-auto py-4 px-3" style={{width:'214px',borderRight:`1px solid ${BORDER}`,background:'rgba(255,255,255,0.012)'}}>
          {(()=>{
            const wa = allMsgs.some((m:any)=>m.source==='whatsapp')
            const cuentas = [
              {id:'Personal', label:'Gmail Personal', n:personalGmailUnread, c:'#EA4335', ic:'mail'},
              {id:'Colabs', label:'Colaboraciones', n:colabsGmailUnread, c:GRN, ic:'users-2'},
              ...(wa?[{id:'WhatsApp', label:'WhatsApp', n:allMsgs.filter((m:any)=>m.source==='whatsapp'&&!m.is_read).length, c:'#25D366', ic:'message-circle'}]:[]),
              {id:'Calendar', label:'Calendario', n:0, c:'#A78BFA', ic:'calendar'},
            ]
            const carpetas = [
              {id:'Todos', label:'Bandeja unificada', n:activeMsgs.length, c:'rgba(255,255,255,0.5)', ic:'inbox'},
              {id:'Sin leer', label:'Sin leer', n:unread, c:BLU, ic:'mail'},
              {id:'Urgente', label:'Prioridad', n:urgent, c:'rgba(255,176,32,0.9)', ic:'zap'},
              {id:'Clientes', label:'Clientes', n:fromClients, c:'rgba(255,176,32,0.8)', ic:'user'},
              {id:'Interno', label:'Equipo', n:internal, c:'rgba(167,139,250,0.85)', ic:'users'},
              {id:'Archivados', label:'Archivados', n:archivedCount, c:'rgba(255,255,255,0.3)', ic:'archive'},
            ]
            const item = (f:any)=>{
              const act = filter===f.id
              return (
                <button key={f.id} onClick={()=>{ setFilter(f.id); setActiveSender(null); setSelected(null) }}
                  className="flex items-center gap-2.5 w-full py-2 px-2.5 rounded-xl text-left transition-all mb-0.5"
                  style={{background:act?'rgba(84,116,232,0.13)':'transparent',border:act?'1px solid rgba(124,152,255,0.16)':'1px solid transparent'}}
                  onMouseEnter={e=>{if(!act)e.currentTarget.style.background='rgba(255,255,255,0.03)'}} onMouseLeave={e=>{if(!act)e.currentTarget.style.background='transparent'}}>
                  <LucideIcon name={f.ic} size={15} color={act?f.c:'rgba(200,210,230,0.4)'}/>
                  <span className="flex-1 truncate font-figtree text-[12.5px]" style={{color:act?'#eef1fb':'rgba(230,235,247,0.5)',fontWeight:act?600:450}}>{f.label}</span>
                  {f.n>0 && <span className="font-figtree text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{background:act?`${f.c==='rgba(255,255,255,0.5)'?BLU:f.c}22`:'rgba(214,172,102,0.16)',color:act?(f.c==='rgba(255,255,255,0.5)'?BLU:f.c):'#e2b877'}}>{f.n}</span>}
                </button>
              )
            }
            return (<>
              <div className="font-syne text-[7.5px] font-black tracking-[0.2em] px-2 pb-2" style={{color:'rgba(255,255,255,0.22)'}}>CUENTAS</div>
              {cuentas.map(item)}
              <div className="font-syne text-[7.5px] font-black tracking-[0.2em] px-2 pt-4 pb-2" style={{color:'rgba(255,255,255,0.22)'}}>BANDEJA</div>
              {carpetas.map(item)}
            </>)
          })()}
        </div>
      )}

      {/* ── LIST PANEL ─────────────────────────────────────────── */}
      <div className="flex flex-col overflow-hidden" style={isMobile
        ? {width:'100%',display:selected?'none':'flex'}
        : selected ? {width:'360px',flexShrink:0,borderRight:`1px solid ${BORDER}`,maxWidth:'360px'} : {flex:1,minWidth:0}}>

        {/* Header */}
        <div className={`flex-shrink-0 ${isMobile?'px-4':'px-6'} pt-5 pb-4`} style={{borderBottom:`1px solid ${BORDER}`}}>
          {filter === 'hub' ? (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-1" style={{color:'rgba(255,255,255,0.18)'}}>SEÑALES</div>
                  <h1 className="font-figtree text-[26px] font-black text-white leading-none" style={{letterSpacing:'-0.04em'}}>Inbox</h1>
                </div>
                <div className="flex items-center gap-2">
                  {unread > 0 && (
                    <button onClick={()=>{ const u=data.inbox.filter((m:any)=>!m.is_read); data.markManyRead(u.map((m:any)=>m.id)).catch(()=>{}); showToast(`${u.length} mensajes marcados como leídos`) }} className="font-syne text-[8px] font-black px-2.5 py-2 rounded-xl transition-all" style={{color:'rgba(255,255,255,0.3)',border:`1px solid ${BORDER}`}} onMouseEnter={e=>(e.currentTarget.style.color='rgba(255,255,255,0.6)')} onMouseLeave={e=>(e.currentTarget.style.color='rgba(255,255,255,0.3)')}>TODO LEÍDO · {unread}</button>
                  )}
                </div>
              </div>
              {/* Live stats strip */}
              <div className="flex items-center gap-0 rounded-xl overflow-hidden" style={{border:`1px solid ${BORDER}`}}>
                {[
                  {label:'TOTAL', value:allMsgs.length, color:'rgba(255,255,255,0.4)', mobileOnly:false},
                  {label:'SIN LEER', value:unread, color: unread>0?BLU:'rgba(255,255,255,0.2)', mobileOnly:false},
                  {label:'URGENTES', value:urgent, color: urgent>0?RED:'rgba(255,255,255,0.2)', mobileOnly:false},
                  {label:'PERSONAL', value:personalGmailCount, color:'rgba(234,67,53,0.7)', mobileOnly:true},
                  {label:'COLABS', value:colabsGmailCount, color:GRN, mobileOnly:true},
                ].filter(s=>!isMobile||!s.mobileOnly).map((s,i,arr)=>(
                  <div key={s.label} className="flex-1 flex flex-col items-center py-2" style={{borderRight:i<arr.length-1?`1px solid ${BORDER}`:'none',background:SURF2}}>
                    <span className="font-figtree text-[14px] font-black leading-none" style={{color:s.color}}>{s.value}</span>
                    <span className="font-syne text-[6.5px] font-black tracking-wide mt-0.5" style={{color:'rgba(255,255,255,0.18)'}}>{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <button onClick={()=>{ setFilter('hub'); setActiveSender(null); setSelected(null) }} className="flex items-center gap-1.5 transition-opacity hover:opacity-60 mt-1" style={{color:'rgba(255,255,255,0.4)'}}>
                <LucideIcon name="chevron-left" size={16} color="rgba(255,255,255,0.4)"/>
              </button>
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                {(filter==='Gmail'||filter==='Personal') && <svg viewBox="0 0 24 24" width={18} height={18}><path fill="#EA4335" d="M22.5 12.5c0-.83-.07-1.64-.2-2.42H12v4.59h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.25z"/><path fill="#4285F4" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>}
                {filter==='Colabs' && <div className="relative flex-shrink-0"><svg viewBox="0 0 24 24" width={18} height={18}><path fill="#EA4335" d="M22.5 12.5c0-.83-.07-1.64-.2-2.42H12v4.59h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.25z"/><path fill="#4285F4" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg><div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center" style={{background:SURFACE,border:`1px solid ${GRN}50`}}><span className="font-syne text-[4.5px] font-black" style={{color:GRN}}>BS</span></div></div>}
                {filter==='WhatsApp' && <svg viewBox="0 0 24 24" width={18} height={18} fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>}
                {filter==='Calendar' && <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="#A78BFA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
                {filter==='Interno' && <LucideIcon name="users-2" size={18} color="rgba(167,139,250,0.8)"/>}
                {(filter==='Todos'||filter==='Sin leer'||filter==='Urgente'||filter==='Clientes') && <LucideIcon name="inbox" size={18} color="rgba(255,255,255,0.5)"/>}
                <div className="flex-1 min-w-0">
                  <h1 className="font-figtree text-[20px] font-black text-white leading-none truncate" style={{letterSpacing:'-0.03em'}}>
                    {filter==='Personal'?'Gmail Personal':filter==='Colabs'?'Colaboraciones':filter==='Gmail'?'Gmail':filter==='WhatsApp'?'WhatsApp':filter==='Calendar'?'Calendario':filter==='Interno'?'Equipo':filter==='Urgente'?'Urgentes':filter==='Sin leer'?'Sin leer':filter==='Clientes'?'Clientes':'Todos'}
                  </h1>
                  {filter==='Personal' && profile?.gmail_account && (
                    <div className="font-syne text-[7.5px] truncate mt-0.5" style={{color:'rgba(255,255,255,0.22)'}}>{profile.gmail_account}</div>
                  )}
                  {filter==='Colabs' && (
                    <div className="font-syne text-[7.5px] truncate mt-0.5" style={{color:`${GRN}60`}}>Visible para todo el equipo</div>
                  )}
                </div>
                {/* Mark all read for current filter */}
                {(filter==='Personal'||filter==='Colabs'||filter==='Sin leer') && filtered.filter((m:any)=>!m.is_read).length > 0 && (
                  <button
                    onClick={()=>{ const u=filtered.filter((m:any)=>!m.is_read); data.markManyRead(u.map((m:any)=>m.id)).catch(()=>{}); showToast(`${u.length} marcados como leídos`) }}
                    className="font-syne text-[7px] font-black px-2 py-1.5 rounded-lg flex-shrink-0 transition-all hover:opacity-80"
                    style={{color:'rgba(255,255,255,0.3)',border:`1px solid ${BORDER}`}}
                  >TODO LEÍDO</button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Tarjetas de estado (estilo referencia) */}
        {!isMobile && !selected && filter!=='hub' && filter!=='Calendar' && (
          <div className="flex gap-3 px-6 py-3.5 flex-shrink-0" style={{borderBottom:`1px solid ${BORDER}`}}>
            {[
              {n:unread, l:'Sin leer', c:unread>0?'#e2b877':'rgba(255,255,255,0.3)', ic:'mail'},
              {n:allMsgs.filter((m:any)=>m.ai_urgency==='high'||m.ai_urgency==='urgent').filter((m:any)=>!m.is_read).length, l:'Prioridad', c:'rgba(255,176,32,0.9)', ic:'zap'},
              {n:colabsGmailCount, l:'Colaboraciones', c:GRN, ic:'users-2'},
              {n:urgent, l:'Urgentes', c:urgent>0?RED:'rgba(255,255,255,0.3)', ic:'alert-circle'},
            ].map((s,i)=>(
              <div key={i} className="flex-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl" style={{background:'rgba(255,255,255,0.025)',border:`1px solid rgba(255,255,255,0.05)`}}>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:`${s.c}18`}}><LucideIcon name={s.ic} size={14} color={s.c}/></div>
                <div className="min-w-0"><div className="font-figtree text-[20px] font-black leading-none" style={{color:s.c}}>{s.n}</div><div className="font-figtree text-[10px] mt-0.5 truncate" style={{color:'rgba(255,255,255,0.4)'}}>{s.l}</div></div>
              </div>
            ))}
          </div>
        )}

        {/* Message list */}
        {(()=>{
          // ── HUB VIEW ─────────────────────────────────────────
          if (filter==='hub') {
            const waCount     = allMsgs.filter((m:any)=>m.source==='whatsapp').length
            const teamCount   = allMsgs.filter((m:any)=>m.source==='internal').length
            const teamUnread  = allMsgs.filter((m:any)=>m.source==='internal'&&!m.is_read).length
            const todayStr    = todayKey()
            const todayEvents = calEvents.filter((e:any)=>e.start?.slice(0,10)===todayStr).length
            const GmailSvg = ({opacity=1}:{opacity?:number}) => (
              <svg viewBox="0 0 24 24" width={36} height={36} style={{opacity}}>
                <path fill="#EA4335" d="M22.5 12.5c0-.83-.07-1.64-.2-2.42H12v4.59h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.25z"/>
                <path fill="#4285F4" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
            )
            const cards = [
              {
                id:'Personal', label:'Gmail Personal', sub: personalGmailCount===0?'Conectar en Operativa':personalGmailUnread>0?`${personalGmailUnread} sin leer · ${personalGmailCount} total`:`${personalGmailCount} mensajes`,
                color:'#EA4335', active: personalGmailCount>0,
                icon: <GmailSvg opacity={personalGmailCount>0?1:0.35}/>,
                badge: personalGmailUnread > 0 ? personalGmailUnread : null,
                hint: 'Tu cuenta personal',
              },
              {
                id:'Colabs', label:'Colaboraciones', sub: colabsGmailCount===0?'Sin emails compartidos':colabsGmailUnread>0?`${colabsGmailUnread} sin leer · equipo`:`${colabsGmailCount} emails compartidos`,
                color:'#22c55e', active: colabsGmailCount>0,
                icon: <div className="relative"><GmailSvg opacity={colabsGmailCount>0?1:0.35}/><div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center font-syne text-[6.5px] font-black" style={{background:SURFACE,border:'1px solid rgba(34,197,94,0.3)',color:'rgba(34,197,94,0.8)'}}>BS</div></div>,
                badge: colabsGmailUnread > 0 ? colabsGmailUnread : null,
                hint: 'Visible para todo el equipo',
              },
              {
                id:'Calendar', label:'Calendario', sub: calEvents.length===0?'Sin eventos':todayEvents>0?`${todayEvents} eventos hoy`:`${calEvents.length} próximos`,
                color:'#A78BFA', active: calEvents.length>0,
                icon: <svg viewBox="0 0 24 24" width={36} height={36} fill="none" stroke="#A78BFA" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2.5" ry="2.5"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="8" cy="15" r="1" fill="#A78BFA"/><circle cx="12" cy="15" r="1" fill="#A78BFA"/><circle cx="16" cy="15" r="1" fill="#A78BFA"/></svg>,
                badge: todayEvents > 0 ? todayEvents : null,
                hint: 'Tu Google Calendar',
              },
              {
                id:'WhatsApp', label:'WhatsApp', sub: waCount===0?'Webhook pendiente':`${waCount} mensajes`,
                color:'#25D366', active: waCount>0,
                icon: <svg viewBox="0 0 24 24" width={36} height={36} fill="#25D366" style={{opacity:waCount>0?1:0.35}}><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>,
                badge: null,
                hint: 'Mensajes de clientes',
              },
              {
                id:'Interno', label:'Equipo', sub: teamCount===0?'Sin mensajes internos':teamUnread>0?`${teamUnread} sin leer`:`${teamCount} mensajes`,
                color:'rgba(167,139,250,0.9)', active: teamCount>0,
                icon: <svg viewBox="0 0 24 24" width={36} height={36} fill="none" stroke="rgba(167,139,250,0.9)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{opacity:teamCount>0?1:0.35}}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
                badge: teamUnread > 0 ? teamUnread : null,
                hint: 'Mensajes internos',
              },
            ]
            return (
              <div className="flex-1 overflow-y-auto p-5">
                <div className="grid grid-cols-2 gap-3 mb-3">
                  {/* First two cards (Personal + Colabs) always first row */}
                  {cards.slice(0,2).map(card=>(
                    <button key={card.id} onClick={()=>{ setFilter(card.id); setActiveSender(null); setSelected(null) }}
                      className="relative rounded-2xl p-4 text-left transition-all duration-200 group"
                      style={{background:`linear-gradient(145deg,${card.color}0e 0%,rgba(10,10,20,0.9) 100%)`,border:`1px solid ${card.color}22`,minHeight:'130px'}}
                      onMouseEnter={e=>{ e.currentTarget.style.border=`1px solid ${card.color}45`; e.currentTarget.style.background=`linear-gradient(145deg,${card.color}18 0%,rgba(10,10,20,0.9) 100%)` }}
                      onMouseLeave={e=>{ e.currentTarget.style.border=`1px solid ${card.color}22`; e.currentTarget.style.background=`linear-gradient(145deg,${card.color}0e 0%,rgba(10,10,20,0.9) 100%)` }}
                    >
                      <div className="absolute top-0 left-4 right-4 h-px" style={{background:`linear-gradient(90deg,transparent,${card.color}40,transparent)`}}/>
                      {card.badge != null && (
                        <div className="absolute top-3 right-3 min-w-[22px] h-[22px] px-1.5 rounded-full flex items-center justify-center font-figtree text-[11px] font-black" style={{background:card.color,color:'#fff'}}>
                          {(card.badge as number) > 99 ? '99+' : card.badge}
                        </div>
                      )}
                      <div className="mb-2.5">{card.icon}</div>
                      <div className="font-figtree text-[15px] font-black leading-none mb-1" style={{color:'rgba(255,255,255,0.9)',letterSpacing:'-0.02em'}}>{card.label}</div>
                      <div className="font-syne text-[8px] font-bold tracking-wide mb-0.5" style={{color: card.active ? `${card.color}cc` : 'rgba(255,255,255,0.18)'}}>{(card.sub as string).toUpperCase()}</div>
                      {'hint' in card && <div className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.15)'}}>{(card as any).hint}</div>}
                      <div className={`absolute bottom-3.5 right-3.5 transition-opacity ${isMobile?'opacity-60':'opacity-0 group-hover:opacity-100'}`}>
                        <LucideIcon name="arrow-right" size={13} color={card.color}/>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {/* Remaining cards (Calendar, WhatsApp, Equipo) */}
                  {cards.slice(2).map(card=>(
                    <button key={card.id} onClick={()=>{ setFilter(card.id); setActiveSender(null); setSelected(null) }}
                      className="relative rounded-2xl p-4 text-left transition-all duration-200 group"
                      style={{background:`linear-gradient(145deg,${card.color}0e 0%,rgba(10,10,20,0.9) 100%)`,border:`1px solid ${card.color}22`,minHeight:'110px'}}
                      onMouseEnter={e=>{ e.currentTarget.style.border=`1px solid ${card.color}45`; e.currentTarget.style.background=`linear-gradient(145deg,${card.color}18 0%,rgba(10,10,20,0.9) 100%)` }}
                      onMouseLeave={e=>{ e.currentTarget.style.border=`1px solid ${card.color}22`; e.currentTarget.style.background=`linear-gradient(145deg,${card.color}0e 0%,rgba(10,10,20,0.9) 100%)` }}
                    >
                      <div className="absolute top-0 left-3 right-3 h-px" style={{background:`linear-gradient(90deg,transparent,${card.color}40,transparent)`}}/>
                      {card.badge != null && (
                        <div className="absolute top-2.5 right-2.5 min-w-[20px] h-[20px] px-1 rounded-full flex items-center justify-center font-figtree text-[10px] font-black" style={{background:card.color,color:'#fff'}}>
                          {(card.badge as number) > 99 ? '99+' : card.badge}
                        </div>
                      )}
                      <div className="mb-2">{card.icon}</div>
                      <div className="font-figtree text-[13px] font-black leading-none mb-1" style={{color:'rgba(255,255,255,0.85)',letterSpacing:'-0.02em'}}>{card.label}</div>
                      <div className="font-syne text-[7.5px] font-bold tracking-wide" style={{color: card.active ? `${card.color}cc` : 'rgba(255,255,255,0.18)'}}>{(card.sub as string).toUpperCase()}</div>
                    </button>
                  ))}
                </div>

                {/* Harvey Briefing CTA */}
                {onAskHarvey && (
                  <button
                    onClick={()=>{
                      const unreadList = allMsgs.filter((m:any)=>!m.is_read).slice(0,8)
                      const emailSummary = unreadList.length > 0
                        ? unreadList.map((m:any)=>`• ${m.from_name||'?'}: "${m.subject||'sin asunto'}"${m.ai_summary?` → ${m.ai_summary}`:''}`).join('\n')
                        : 'ningún email sin leer'
                      const todayEvts = calEvents.filter((e:any)=>e.start?.slice(0,10)===todayKey())
                      const evtSummary = todayEvts.length > 0 ? todayEvts.map((e:any)=>e.title).join(', ') : 'sin eventos hoy'
                      onAskHarvey(`Dame un briefing rápido de mi inbox y calendario de hoy.\n\nEmails sin leer (${unreadList.length}):\n${emailSummary}\n\nEventos de hoy: ${evtSummary}\n\n¿Cuáles son las prioridades más urgentes y qué debería atender primero?`)
                    }}
                    className="w-full mt-1 flex items-center gap-3 rounded-2xl px-4 py-3.5 transition-all duration-200 group"
                    style={{background:`linear-gradient(135deg,${BLU}0a,${BLU}04)`,border:`1px solid ${BLU}20`}}
                    onMouseEnter={e=>{ e.currentTarget.style.background=`linear-gradient(135deg,${BLU}16,${BLU}0a)`; e.currentTarget.style.border=`1px solid ${BLU}40` }}
                    onMouseLeave={e=>{ e.currentTarget.style.background=`linear-gradient(135deg,${BLU}0a,${BLU}04)`; e.currentTarget.style.border=`1px solid ${BLU}20` }}
                  >
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:`${BLU}14`}}>
                      <LucideIcon name="cpu" size={16} color={BLU}/>
                    </div>
                    <div className="flex-1 text-left">
                      <div className="font-syne text-[8px] font-black tracking-widest mb-0.5" style={{color:`${BLU}aa`}}>BRIEFING CON HARVEY</div>
                      <div className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.2)'}}>Resumen de emails + calendario hablado por Harvey</div>
                    </div>
                    <div className={`transition-opacity ${isMobile?'opacity-60':'opacity-0 group-hover:opacity-100'}`}>
                      <LucideIcon name="arrow-right" size={13} color={BLU}/>
                    </div>
                  </button>
                )}
              </div>
            )
          }

          // ── CALENDAR TAB ──────────────────────────────────────
          if (filter==='Calendar') {
            if (calEvents.length===0) return (
              <div className="flex-1 overflow-y-auto">
                <div className="py-20 flex flex-col items-center gap-5 px-6 text-center">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{background:'rgba(167,139,250,0.07)',border:'1px solid rgba(167,139,250,0.15)'}}>
                    <svg viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="#A78BFA" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  </div>
                  <div>
                    <div className="font-syne text-[9px] font-black tracking-widest mb-2" style={{color:'rgba(167,139,250,0.45)'}}>SIN EVENTOS</div>
                    <div className="font-figtree text-[15px] font-black mb-2" style={{color:'rgba(255,255,255,0.4)'}}>Google Calendar</div>
                    <div className="text-[11.5px] leading-relaxed" style={{color:'rgba(255,255,255,0.2)'}}>Conecta Google Calendar en Operativa para sincronizar tus eventos y reuniones aquí.</div>
                  </div>
                </div>
              </div>
            )
            const todayStr2 = todayKey()
            const calGroups = [
              ...(calEvents.filter((e:any)=>e.start?.slice(0,10)===todayStr2).length ? [{label:'HOY', items:calEvents.filter((e:any)=>e.start?.slice(0,10)===todayStr2)}] : []),
              ...(calEvents.filter((e:any)=>e.start?.slice(0,10)>todayStr2).length ? [{label:'PRÓXIMOS', items:calEvents.filter((e:any)=>e.start?.slice(0,10)>todayStr2)}] : []),
              ...(calEvents.filter((e:any)=>e.start?.slice(0,10)<todayStr2).length ? [{label:'PASADOS', items:calEvents.filter((e:any)=>e.start?.slice(0,10)<todayStr2).reverse()}] : []),
            ]
            return (
              <div className="flex-1 overflow-y-auto">
                {calGroups.map(grp=>(
                  <div key={grp.label}>
                    <div className="px-5 py-2 flex items-center gap-3 sticky top-0 z-10" style={{background:'rgba(5,5,16,0.94)',backdropFilter:'blur(10px)'}}>
                      <span className="font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.18)'}}>{grp.label}</span>
                      <div className="flex-1 h-px" style={{background:BORDER}}/>
                      <span className="font-syne text-[8px]" style={{color:'rgba(255,255,255,0.12)'}}>{grp.items.length}</span>
                    </div>
                    {grp.items.map((ev:any,i:number)=>{
                      const timeStr = ev.allDay ? 'Todo el día' : new Date(ev.start).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})
                      const isPast = ev.start && new Date(ev.start)<new Date() && !ev.allDay
                      return (
                        <div key={ev.id||i} className="flex items-center gap-3.5 px-4 py-4" style={{borderBottom:`1px solid ${BORDER}`,opacity:isPast?0.45:1,borderLeft:'2.5px solid rgba(167,139,250,0.4)'}}>
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:'rgba(167,139,250,0.08)',border:'1px solid rgba(167,139,250,0.15)'}}>
                            <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="#A78BFA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-figtree text-[13px] font-semibold truncate mb-0.5" style={{color:'rgba(255,255,255,0.85)'}}>{ev.title}</div>
                            <div className="flex items-center gap-2">
                              <span className="font-syne text-[8px] font-black" style={{color:'rgba(167,139,250,0.7)'}}>{timeStr}</span>
                              {ev.location && <span className="text-[10px] truncate" style={{color:'rgba(255,255,255,0.25)'}}>{ev.location}</span>}
                            </div>
                          </div>
                          <span className="font-syne text-[7.5px] font-black flex-shrink-0" style={{color:'rgba(255,255,255,0.2)'}}>{new Date((ev.start?.split('T')[0]||'')+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'})}</span>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )
          }

          // ── WHATSAPP COMING SOON ──────────────────────────────
          if (filter==='WhatsApp' && allMsgs.filter((m:any)=>m.source==='whatsapp').length===0) return (
            <div className="flex-1 overflow-y-auto">
              <div className="py-20 flex flex-col items-center gap-5 px-6 text-center">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{background:'rgba(37,211,102,0.06)',border:'1px solid rgba(37,211,102,0.12)'}}>
                  <svg viewBox="0 0 24 24" width={24} height={24} fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                </div>
                <div>
                  <div className="font-syne text-[9px] font-black tracking-widest mb-2" style={{color:'rgba(37,211,102,0.5)'}}>PRÓXIMAMENTE</div>
                  <div className="font-figtree text-[15px] font-black mb-2" style={{color:'rgba(255,255,255,0.4)'}}>WhatsApp Business</div>
                  <div className="text-[11.5px] leading-relaxed" style={{color:'rgba(255,255,255,0.2)'}}>La integración con WhatsApp Business estará disponible próximamente. Gestiona mensajes de clientes directamente desde aquí.</div>
                </div>
              </div>
            </div>
          )

          // ── SOURCE GROUPS VIEW (Gmail / Equipo with senders) ──
          const isSourceView = filter==='Gmail'||filter==='WhatsApp'||filter==='Interno'
          const displayMsgs = activeSender ? filtered.filter((m:any)=>m.from_name===activeSender||m.from_email===activeSender) : filtered
          filteredRef.current = displayMsgs

          if (isSourceView && !activeSender) {
            const senderMap: Record<string,{msgs:any[];unread:number;urgent:number;latest:any}> = {}
            filtered.forEach((m:any)=>{
              const key = m.from_name||m.from_email||m.from_phone||'Desconocido'
              if (!senderMap[key]) senderMap[key] = {msgs:[],unread:0,urgent:0,latest:m}
              senderMap[key].msgs.push(m)
              if (!m.is_read) senderMap[key].unread++
              if (!m.is_read && m.ai_urgency==='urgent') senderMap[key].urgent++
              if (new Date(m.received_at)>new Date(senderMap[key].latest.received_at)) senderMap[key].latest = m
            })
            const senders = Object.entries(senderMap).sort((a,b)=>new Date(b[1].latest.received_at).getTime()-new Date(a[1].latest.received_at).getTime())
            const srcColor = filter==='Gmail'?'#EA4335':filter==='WhatsApp'?'#25D366':'rgba(255,176,32,0.8)'
            return (
              <div className="flex-1 overflow-y-auto">
                {senders.length===0 ? (
                  <div className="py-20 text-center px-6">
                    <div className="font-syne text-[10px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.15)'}}>SIN MENSAJES</div>
                    <div className="text-[12px]" style={{color:'rgba(255,255,255,0.2)'}}>No hay mensajes en esta fuente</div>
                  </div>
                ) : senders.map(([senderName, sg])=>{
                  const avatarColor = strColor(senderName)
                  return (
                    <button key={senderName} onClick={()=>{ setActiveSender(senderName); setSelected(null) }} className="w-full text-left flex items-center gap-3.5 px-4 py-4 transition-all" style={{borderBottom:`1px solid ${BORDER}`}} onMouseEnter={e=>(e.currentTarget.style.background='rgba(255,255,255,0.025)')} onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                      <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-syne text-[11px] font-black" style={{background:avatarColor+'20',color:avatarColor,border:`1.5px solid ${avatarColor}30`}}>
                        {senderName.slice(0,2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-syne text-[10px] font-black truncate flex-1" style={{color:sg.unread>0?'rgba(255,255,255,0.9)':'rgba(255,255,255,0.45)'}}>{senderName}</span>
                          {sg.urgent>0 && <span className="font-syne text-[6.5px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:`${RED}18`,color:RED,border:`1px solid ${RED}30`}}>URG</span>}
                          {sg.unread>0 && <span className="font-figtree text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{background:srcColor+'20',color:srcColor}}>{sg.unread}</span>}
                          <span className="font-syne text-[7px] flex-shrink-0" style={{color:'rgba(255,255,255,0.2)'}}>{relTime(sg.latest.received_at)}</span>
                        </div>
                        <div className="text-[11.5px] truncate mb-0.5" style={{color:sg.unread>0?'rgba(255,255,255,0.6)':'rgba(255,255,255,0.25)'}}>{sg.latest.subject||sg.latest.body_preview?.slice(0,50)||'Sin asunto'}</div>
                        <div className="font-syne text-[7.5px] font-black" style={{color:'rgba(255,255,255,0.2)'}}>{sg.msgs.length} {sg.msgs.length===1?'MENSAJE':'MENSAJES'}</div>
                      </div>
                      <LucideIcon name="chevron-right" size={12} color="rgba(255,255,255,0.12)"/>
                    </button>
                  )
                })}
              </div>
            )
          }

          // ── TODOS / NORMAL LIST ───────────────────────────────
          const displayGroups: {label:string;items:any[]}[] = []
          const byLabel2: Record<string,any[]> = {}
          displayMsgs.forEach((m:any)=>{ const l=getDateLabel(m.received_at); if(!byLabel2[l])byLabel2[l]=[]; byLabel2[l].push(m) })
          ;['HOY','AYER','ESTA SEMANA','ANTERIORES'].forEach(l=>{ if(byLabel2[l]?.length) displayGroups.push({label:l,items:byLabel2[l]}) })

          const gmailN2 = allMsgs.filter((m:any)=>m.source==='gmail').length
          const waaN2 = allMsgs.filter((m:any)=>m.source==='whatsapp').length
          const teamN2 = allMsgs.filter((m:any)=>m.source==='internal').length

          return (
            <div className="flex-1 overflow-y-auto">
              {/* Todos header strip — source breakdown */}
              {filter==='Todos' && !activeSender && allMsgs.length>0 && (
                <div className="flex items-center gap-2 px-4 py-3 flex-wrap" style={{borderBottom:`1px solid ${BORDER}`,background:'rgba(255,255,255,0.012)'}}>
                  {unread>0 && <span className="flex items-center gap-1.5 font-syne text-[7px] font-black px-2 py-1 rounded-full" style={{background:`${BLU}18`,color:BLU,border:`1px solid ${BLU}28`}}><div className="w-1 h-1 rounded-full" style={{background:BLU}}/>{unread} SIN LEER</span>}
                  {urgent>0 && <span className="flex items-center gap-1.5 font-syne text-[7px] font-black px-2 py-1 rounded-full" style={{background:`${RED}12`,color:RED,border:`1px solid ${RED}22`}}><div className="w-1 h-1 rounded-full" style={{background:RED}}/>{urgent} URGENTE{urgent>1?'S':''}</span>}
                  {gmailN2>0 && <span className="flex items-center gap-1.5 font-syne text-[7px] font-black px-2 py-1 rounded-full" style={{background:'rgba(234,67,53,0.08)',color:'#EA4335',border:'1px solid rgba(234,67,53,0.18)'}}><svg viewBox="0 0 24 24" width={8} height={8}><path fill="#EA4335" d="M22.5 12.5c0-.83-.07-1.64-.2-2.42H12v4.59h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.25z"/><path fill="#4285F4" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> Gmail {gmailN2}</span>}
                  {waaN2>0 && <span className="font-syne text-[7px] font-black px-2 py-1 rounded-full" style={{background:'rgba(37,211,102,0.07)',color:'#25D366',border:'1px solid rgba(37,211,102,0.18)'}}>WA {waaN2}</span>}
                  {teamN2>0 && <span className="font-syne text-[7px] font-black px-2 py-1 rounded-full" style={{background:'rgba(255,176,32,0.07)',color:'rgba(255,176,32,0.8)',border:'1px solid rgba(255,176,32,0.15)'}}>Equipo {teamN2}</span>}
                </div>
              )}
              {/* Back to senders button */}
              {activeSender && (
                <button onClick={()=>{ setActiveSender(null); setSelected(null) }} className="w-full flex items-center gap-2 px-4 py-3 text-left" style={{borderBottom:`1px solid ${BORDER}`,background:'rgba(27,95,250,0.04)'}}>
                  <LucideIcon name="chevron-left" size={13} color="rgba(255,255,255,0.3)"/>
                  <span className="font-syne text-[8.5px] font-black tracking-wide" style={{color:'rgba(255,255,255,0.4)'}}>TODOS LOS CONTACTOS</span>
                  <span className="font-syne text-[8.5px] font-black truncate ml-1" style={{color:'rgba(255,255,255,0.7)'}}>{activeSender}</span>
                </button>
              )}
              {displayGroups.length===0 && (()=>{
                const isPersonalEmpty = filter==='Personal' && personalGmailCount===0
                const isColabsEmpty = filter==='Colabs' && colabsGmailCount===0
                if (isPersonalEmpty) return (
                  <div className="py-16 px-6 flex flex-col items-center gap-4 text-center">
                    <div className="relative">
                      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto" style={{background:'rgba(234,67,53,0.07)',border:'1px solid rgba(234,67,53,0.18)'}}>
                        <svg viewBox="0 0 24 24" width={30} height={30}><path fill="#EA4335" d="M22.5 12.5c0-.83-.07-1.64-.2-2.42H12v4.59h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.25z"/><path fill="#4285F4" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                      </div>
                      <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center" style={{background:'rgba(229,29,42,0.15)',border:'1px solid rgba(229,29,42,0.25)'}}>
                        <LucideIcon name="lock" size={10} color={RED}/>
                      </div>
                    </div>
                    <div>
                      <div className="font-syne text-[9px] font-black tracking-widest mb-2" style={{color:'rgba(234,67,53,0.5)'}}>GMAIL PERSONAL</div>
                      <div className="font-figtree text-[15px] font-black mb-2" style={{color:'rgba(255,255,255,0.5)'}}>Tu cuenta personal</div>
                      <div className="text-[11.5px] leading-relaxed mb-4" style={{color:'rgba(255,255,255,0.22)'}}>Conecta tu Gmail personal para ver tus emails aquí. Cada miembro del equipo conecta su propia cuenta — solo tú la ves.</div>
                      <button onClick={()=>onNavigate?.('ajustes')} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-syne text-[8.5px] font-black tracking-widest transition-all hover:opacity-80" style={{background:'rgba(234,67,53,0.1)',border:'1px solid rgba(234,67,53,0.22)',color:'#EA4335'}}>
                        <LucideIcon name="settings" size={10} color="#EA4335"/>CONECTAR EN OPERATIVA
                      </button>
                    </div>
                  </div>
                )
                if (isColabsEmpty) return (
                  <div className="py-16 px-6 flex flex-col items-center gap-4 text-center">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{background:`${GRN}08`,border:`1px solid ${GRN}20`}}>
                      <LucideIcon name="users-2" size={22} color={GRN}/>
                    </div>
                    <div>
                      <div className="font-syne text-[9px] font-black tracking-widest mb-2" style={{color:`${GRN}70`}}>COLABORACIONES</div>
                      <div className="font-figtree text-[15px] font-black mb-2" style={{color:'rgba(255,255,255,0.5)'}}>Sin emails compartidos</div>
                      <div className="text-[11.5px] leading-relaxed" style={{color:'rgba(255,255,255,0.22)'}}>Los emails de colaboraciones@brutalstudios.es aparecen aquí y son visibles para todo el equipo. Haz sync en Operativa.</div>
                    </div>
                  </div>
                )
                return (
                  <div className="py-20 text-center px-6">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{background:SURF2,border:`1px solid ${BORDER}`}}>
                      <LucideIcon name="inbox" size={22} color="rgba(255,255,255,0.15)"/>
                    </div>
                    <div className="font-syne text-[10px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.15)'}}>{allMsgs.length===0?'SIN CUENTA CONECTADA':'BANDEJA VACÍA'}</div>
                    <div className="text-[12px] leading-relaxed" style={{color:'rgba(255,255,255,0.2)'}}>{allMsgs.length===0?'Conecta Gmail en Operativa para empezar':'No hay mensajes con este filtro'}</div>
                  </div>
                )
              })()}
              {selected && displayMsgs.length>1 && !isMobile && (
                <div className="flex items-center justify-center gap-3 py-2 sticky top-0 z-20" style={{background:'rgba(5,5,16,0.9)',backdropFilter:'blur(8px)',borderBottom:`1px solid ${BORDER}`}}>
                  <span className="font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.12)'}}>
                    <kbd className="px-1 py-0.5 rounded" style={{background:'rgba(255,255,255,0.06)',fontFamily:'inherit'}}>J</kbd> siguiente · <kbd className="px-1 py-0.5 rounded" style={{background:'rgba(255,255,255,0.06)',fontFamily:'inherit'}}>K</kbd> anterior
                  </span>
                </div>
              )}
              {displayGroups.map(group=>(
                <div key={group.label}>
                  <div className="px-5 py-2 flex items-center gap-3 sticky top-0 z-10" style={{background:'rgba(5,5,16,0.94)',backdropFilter:'blur(10px)'}}>
                    <span className="font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.18)'}}>{group.label}</span>
                    <div className="flex-1 h-px" style={{background:BORDER}}/>
                    <span className="font-syne text-[8px]" style={{color:'rgba(255,255,255,0.12)'}}>{group.items.length}</span>
                  </div>
                  {group.items.map((m:any)=>{
                    const isInternal = m.source==='internal'
                    const isGmail = m.source==='gmail'
                    const isWA = m.source==='whatsapp'
                    const isColabs = isGmail && !!m.shared
                    const isSelected = selected?.id===m.id
                    const isUnread = !m.is_read
                    const avatarBg = isInternal ? 'rgba(255,176,32,0.85)' : strColor(m.from_name||'?')
                    const leftBar = isUnread ? (m.ai_urgency==='urgent'?RED:isColabs?GRN:isInternal?'rgba(255,176,32,0.7)':isGmail?'#EA433570':isWA?'#25D36670':BLU) : 'transparent'
                    return (
                      <div key={m.id} onClick={()=>handleSelect(m)} className="relative cursor-pointer transition-colors"
                        style={{borderLeft:`2.5px solid ${leftBar}`,background:isSelected?'rgba(27,95,250,0.07)':isUnread?'rgba(255,255,255,0.014)':'transparent',borderBottom:`1px solid ${BORDER}`}}
                        onMouseEnter={e=>{ if(!isSelected)(e.currentTarget.style.background='rgba(255,255,255,0.02)') }}
                        onMouseLeave={e=>{ if(!isSelected)(e.currentTarget.style.background=isUnread?'rgba(255,255,255,0.014)':'transparent') }}>
                        <div className="flex items-start gap-3 px-4 py-3.5">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 font-syne text-[9px] font-black mt-0.5" style={{background:avatarBg+'20',color:avatarBg}}>
                            {isInternal ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={avatarBg} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> : (m.from_name||'?').slice(0,2).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="font-syne text-[9px] font-black truncate flex-1" style={{color:isUnread?'rgba(255,255,255,0.88)':'rgba(255,255,255,0.32)'}}>{m.from_name||'Desconocido'}</span>
                              {(filter==='Todos'||filter==='Sin leer'||filter==='Urgente') && isColabs && <span className="font-syne text-[6px] font-black px-1 py-0.5 rounded-full flex-shrink-0" style={{background:`${GRN}14`,color:GRN}}>COLABS</span>}
                              {(filter==='Todos'||filter==='Sin leer'||filter==='Urgente') && isGmail && !isColabs && <svg viewBox="0 0 24 24" width={9} height={9} className="flex-shrink-0"><path fill="#EA4335" d="M22.5 12.5c0-.83-.07-1.64-.2-2.42H12v4.59h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.25z"/><path fill="#4285F4" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>}
                              {(filter==='Todos'||filter==='Sin leer'||filter==='Urgente') && isWA && <svg viewBox="0 0 24 24" width={9} height={9} fill="#25D366" className="flex-shrink-0"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>}
                              {(filter==='Todos'||filter==='Sin leer'||filter==='Urgente') && isInternal && <span className="font-syne text-[6px] font-black px-1 py-0.5 rounded flex-shrink-0" style={{background:'rgba(167,139,250,0.1)',color:'rgba(167,139,250,0.75)'}}>DM</span>}
                              {isUnread && m.ai_urgency==='urgent' && <span className="font-syne text-[6px] font-black px-1 py-0.5 rounded-full flex-shrink-0" style={{background:`${RED}14`,color:RED}}>URG</span>}
                              {m.attachments?.length>0 && <LucideIcon name="paperclip" size={9} color="rgba(255,255,255,0.2)"/>}
                              <span className="font-syne text-[7.5px] flex-shrink-0" style={{color:'rgba(255,255,255,0.2)'}}>{relTime(m.received_at)}</span>
                            </div>
                            <div className="font-figtree text-[12.5px] font-semibold leading-snug truncate mb-0.5" style={{color:isUnread?'rgba(255,255,255,0.85)':'rgba(255,255,255,0.3)'}}>{m.subject||'Sin asunto'}</div>
                            <div className="text-[9px] truncate" style={{color:m.ai_summary?'rgba(100,140,255,0.5)':'rgba(255,255,255,0.18)'}}>{m.ai_summary||m.body_preview?.slice(0,60)||'—'}</div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )
        })()}
      </div>

      {/* ── DETAIL PANEL ───────────────────────────────────────── */}
      {selected && (
        <div className="flex-1 overflow-y-auto min-w-0" style={{background:'#050510'}}>

          {/* Sticky top bar */}
          <div className={`flex items-center justify-between ${isMobile?'px-4':'px-6'} py-3.5 sticky top-0 z-10`} style={{background:'rgba(5,5,16,0.96)',backdropFilter:'blur(12px)',borderBottom:`1px solid ${BORDER}`}}>
            <button onClick={()=>setSelected(null)} className="flex items-center gap-1.5 transition-opacity hover:opacity-60" style={{color:'rgba(255,255,255,0.35)'}}>
              <LucideIcon name="chevron-left" size={14} color="rgba(255,255,255,0.35)"/>
              <span className="font-syne text-[9px] font-black tracking-wide">VOLVER</span>
            </button>
            <div className="flex items-center gap-2">
              {selected.source==='internal' && !isMobile && (
                <span className="font-syne text-[7.5px] font-black px-2.5 py-1 rounded-full" style={{background:'rgba(255,176,32,0.1)',color:'rgba(255,176,32,0.75)',border:'1px solid rgba(255,176,32,0.15)'}}>MENSAJE INTERNO</span>
              )}
              {selected.is_read && (
                <button onClick={()=>{ data.markUnread(selected.id).catch(()=>{}); setSelected((s: any)=>({...s,is_read:false})) }} className="flex items-center gap-1.5 font-syne text-[7.5px] font-black px-2.5 py-1.5 rounded-xl transition-all hover:bg-white/5" style={{color:'rgba(255,255,255,0.3)',border:`1px solid ${BORDER}`}}>
                  <LucideIcon name="mail" size={11} color="rgba(255,255,255,0.3)"/>
                  {!isMobile && 'NO LEÍDO'}
                </button>
              )}
              {filter==='Archivados' ? (
                <button onClick={()=>unarchiveMessage(selected)} className="flex items-center gap-1.5 font-syne text-[7.5px] font-black px-2.5 py-1.5 rounded-xl transition-all hover:bg-white/5" style={{color:BLU,border:`1px solid rgba(27,95,250,0.25)`}}>
                  <LucideIcon name="archive-restore" size={11} color={BLU}/>
                  {!isMobile && 'RESTAURAR'}
                </button>
              ) : (
                <button onClick={()=>archiveMessage(selected)} className="flex items-center gap-1.5 font-syne text-[7.5px] font-black px-2.5 py-1.5 rounded-xl transition-all hover:bg-white/5" style={{color:'rgba(255,255,255,0.3)',border:`1px solid ${BORDER}`}}>
                  <LucideIcon name="archive" size={11} color="rgba(255,255,255,0.3)"/>
                  {!isMobile && 'ARCHIVAR'}
                </button>
              )}
              {selected.from_email && selected.source==='gmail' && (
                <button onClick={()=>replyOpen?setReplyOpen(false):openHarveyReply(selected)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all hover:opacity-80" style={{color:replyOpen?BLU:'rgba(255,255,255,0.45)',border:`1px solid ${replyOpen?BLU+'50':BORDER}`,background:replyOpen?`${BLU}12`:'transparent'}}>
                  <LucideIcon name="corner-up-left" size={10} color={replyOpen?BLU:'rgba(255,255,255,0.45)'}/>RESPONDER
                </button>
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
                  <span className="text-[13px] font-semibold" style={{color:'rgba(255,255,255,0.75)'}}>{selected.from_name||'Desconocido'}</span>
                </div>
                {selected.from_email && <span className="text-[11px]" style={{color:'rgba(255,255,255,0.28)'}}>{selected.from_email}</span>}
                <span className="ml-auto text-[11px]" style={{color:'rgba(255,255,255,0.22)'}}>{new Date(selected.received_at).toLocaleDateString('es-ES',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
              </div>
            </div>

            {/* ── AI ANALYSIS BLOCK ── */}
            {(selected.ai_summary||selected.ai_action||selected.ai_urgency) && (
              <div className="rounded-2xl overflow-hidden" style={{border:`1px solid rgba(27,95,250,0.18)`}}>
                <div className="flex items-center gap-2.5 px-5 py-3.5" style={{background:'rgba(27,95,250,0.08)',borderBottom:`1px solid rgba(27,95,250,0.12)`}}>
                  <div className="w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:`${BLU}28`}}>
                    <LucideIcon name="sparkles" size={11} color={BLU}/>
                  </div>
                  <span className="font-syne text-[8.5px] font-black tracking-widest flex-1" style={{color:'rgba(120,155,255,0.85)'}}>BRUTAL.IA — ANÁLISIS</span>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{background:uc(selected.ai_urgency)+'14',border:`1px solid ${uc(selected.ai_urgency)}28`}}>
                    <div className="w-1.5 h-1.5 rounded-full" style={{background:uc(selected.ai_urgency)}}/>
                    <span className="font-syne text-[7.5px] font-black" style={{color:uc(selected.ai_urgency)}}>{ul(selected.ai_urgency)}</span>
                  </div>
                </div>

                <div className="p-5 space-y-4" style={{background:'rgba(0,0,0,0.18)'}}>
                  {selected.ai_summary && (
                    <p className="text-[13.5px] leading-relaxed" style={{color:'rgba(235,235,250,0.82)'}}>{selected.ai_summary}</p>
                  )}

                  {/* Action cards */}
                  {selected.ai_action&&selected.ai_action!=='Ninguna acción requerida' ? (
                    <div className="space-y-2">
                      <div className="font-syne text-[7.5px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.2)'}}>ACCIONES SUGERIDAS</div>
                      {/* Primary: create task */}
                      <button onClick={()=>createTaskFromEmail(selected)} disabled={creatingTask} className="w-full text-left flex items-center gap-3 rounded-xl px-4 py-3.5 transition-all hover:opacity-80 disabled:opacity-40" style={{background:`${BLU}12`,border:`1px solid ${BLU}28`}}>
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:`${BLU}20`}}>
                          <LucideIcon name="check-square" size={13} color={BLU}/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-syne text-[7.5px] font-black tracking-wide mb-0.5" style={{color:BLU}}>CREAR TAREA</div>
                          <div className="text-[12.5px] leading-snug" style={{color:'rgba(235,235,250,0.75)'}}>{selected.ai_action}</div>
                        </div>
                        <LucideIcon name={creatingTask?'loader':'plus'} size={14} color={`${BLU}80`}/>
                      </button>
                      {/* Secondary: Harvey reply draft */}
                      {selected.from_email && selected.source==='gmail' && (
                        <button onClick={()=>replyOpen?setReplyOpen(false):openHarveyReply(selected)} className="w-full flex items-center gap-3 rounded-xl px-4 py-3 transition-all hover:opacity-80" style={{background:replyOpen?`${BLU}10`:'rgba(255,255,255,0.04)',border:`1px solid ${replyOpen?BLU+'30':'rgba(255,255,255,0.07)'}`}}>
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:replyOpen?`${BLU}20`:'rgba(255,255,255,0.06)'}}>
                            <LucideIcon name="sparkles" size={13} color={replyOpen?BLU:'rgba(255,255,255,0.45)'}/>
                          </div>
                          <div className="flex-1 text-left">
                            <div className="font-syne text-[7.5px] font-black tracking-wide mb-0.5" style={{color:replyOpen?BLU:'rgba(255,255,255,0.35)'}}>BORRADOR IA</div>
                            <div className="text-[11.5px]" style={{color:'rgba(255,255,255,0.45)'}}>Harvey redacta la respuesta</div>
                          </div>
                          <LucideIcon name={replyLoading?'loader':'corner-up-left'} size={13} color={replyOpen?BLU:'rgba(255,255,255,0.25)'}/>
                        </button>
                      )}
                      {/* Tertiary: ask Harvey */}
                      {onAskHarvey && (
                        <button onClick={()=>onAskHarvey(`Tengo un email de "${selected.from_name||'?'}" con asunto "${selected.subject||'sin asunto'}". ${selected.ai_summary?`Resumen: ${selected.ai_summary}. `:''}${selected.ai_action&&selected.ai_action!=='Ninguna acción requerida'?`Acción sugerida: ${selected.ai_action}. `:''}¿Cómo debería manejar esta comunicación?`)} className="w-full flex items-center gap-3 rounded-xl px-4 py-3 transition-all hover:opacity-80" style={{background:`${BLU}08`,border:`1px solid ${BLU}18`}}>
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:`${BLU}14`}}>
                            <LucideIcon name="cpu" size={13} color={`${BLU}cc`}/>
                          </div>
                          <div className="flex-1 text-left">
                            <div className="font-syne text-[7.5px] font-black tracking-wide mb-0.5" style={{color:`${BLU}99`}}>PREGUNTAR A HARVEY</div>
                            <div className="text-[11.5px]" style={{color:'rgba(255,255,255,0.35)'}}>Consúltale a Harvey sobre este email</div>
                          </div>
                          <LucideIcon name="arrow-right" size={11} color={`${BLU}50`}/>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl px-4 py-3" style={{background:'rgba(34,197,94,0.07)',border:'1px solid rgba(34,197,94,0.15)'}}>
                      <LucideIcon name="check-circle" size={14} color={GRN}/>
                      <span className="font-syne text-[9px] font-black tracking-wide" style={{color:GRN}}>SIN ACCIÓN REQUERIDA</span>
                    </div>
                  )}

                  {/* Client + source row */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl p-3" style={{background:'rgba(255,255,255,0.04)',border:`1px solid rgba(255,255,255,0.06)`}}>
                      <div className="font-syne text-[6.5px] font-black tracking-widest mb-1" style={{color:'rgba(255,255,255,0.18)'}}>CLIENTE</div>
                      <div className="text-[12px] font-semibold truncate" style={{color:matchedClient?matchedClient.color:'rgba(255,255,255,0.35)'}}>{selected.ai_client&&selected.ai_client!=='Desconocido'?selected.ai_client:'—'}</div>
                    </div>
                    <div className="rounded-xl p-3" style={{background:'rgba(255,255,255,0.04)',border:`1px solid rgba(255,255,255,0.06)`}}>
                      <div className="font-syne text-[6.5px] font-black tracking-widest mb-1" style={{color:'rgba(255,255,255,0.18)'}}>CANAL</div>
                      <div className="text-[12px] font-semibold capitalize" style={{color:'rgba(255,255,255,0.5)'}}>{selected.source==='gmail'?'Gmail':selected.source==='internal'?'Interno':selected.source||'—'}</div>
                    </div>
                  </div>
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

            {/* ── HARVEY REPLY DRAFT ── */}
            {replyOpen && selected.from_email && selected.source==='gmail' && (
              <div className="rounded-2xl overflow-hidden" style={{border:`1px solid ${BLU}30`,background:`${BLU}06`}}>
                <div className="flex items-center gap-2.5 px-5 py-3" style={{borderBottom:`1px solid ${BLU}18`,background:`${BLU}10`}}>
                  <div className="w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:`${BLU}28`}}>
                    <LucideIcon name="sparkles" size={11} color={BLU}/>
                  </div>
                  <div className="flex-1">
                    <div className="font-syne text-[8px] font-black tracking-widest" style={{color:`rgba(120,155,255,0.9)`}}>BORRADOR IA — Para: {selected.from_email}</div>
                    <div className="font-syne text-[7px] tracking-wide mt-0.5" style={{color:'rgba(255,255,255,0.25)'}}>Re: {selected.subject}</div>
                  </div>
                  <button onClick={()=>setReplyOpen(false)} className="w-6 h-6 rounded-lg flex items-center justify-center transition-colors hover:bg-white/5">
                    <LucideIcon name="x" size={11} color="rgba(255,255,255,0.3)"/>
                  </button>
                </div>
                <div className="p-4">
                  {replyLoading ? (
                    <div className="flex items-center gap-2 py-6 justify-center">
                      <div className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{borderColor:`${BLU}30`,borderTopColor:BLU}}/>
                      <span className="font-syne text-[9px] font-black tracking-widest" style={{color:`rgba(120,155,255,0.7)`}}>HARVEY REDACTANDO…</span>
                    </div>
                  ) : (
                    <>
                      <textarea
                        value={replyDraft}
                        onChange={e=>setReplyDraft(e.target.value)}
                        rows={6}
                        className="w-full text-[13px] leading-relaxed resize-none outline-none rounded-xl px-4 py-3"
                        style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${BLU}20`,color:'rgba(255,255,255,0.8)',caretColor:BLU}}
                      />
                      <div className="flex items-center gap-2 mt-3">
                        <button
                          onClick={()=>{ navigator.clipboard.writeText(replyDraft).then(()=>{ setReplyCopied(true); setTimeout(()=>setReplyCopied(false),2000) }) }}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all"
                          style={{background:replyCopied?`${GRN}14`:`${BLU}14`,color:replyCopied?GRN:BLU,border:`1px solid ${replyCopied?GRN:BLU}30`}}>
                          <LucideIcon name={replyCopied?'check':'copy'} size={11} color={replyCopied?GRN:BLU}/>
                          {replyCopied?'COPIADO':'COPIAR'}
                        </button>
                        <a
                          href={`mailto:${selected.from_email}?subject=${encodeURIComponent('Re: '+(selected.subject||''))}&body=${encodeURIComponent(replyDraft)}`}
                          target="_blank" rel="noreferrer"
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all no-underline"
                          style={{background:'rgba(234,67,53,0.1)',color:'rgba(234,67,53,0.85)',border:'1px solid rgba(234,67,53,0.2)'}}>
                          <LucideIcon name="external-link" size={11} color="rgba(234,67,53,0.85)"/>
                          ABRIR EN GMAIL
                        </a>
                        <button onClick={()=>openHarveyReply(selected)} disabled={replyLoading} className="ml-auto flex items-center gap-1.5 px-2.5 py-2 rounded-xl transition-all" style={{color:'rgba(255,255,255,0.25)',border:`1px solid ${BORDER}`}}>
                          <LucideIcon name="refresh-cw" size={10} color="rgba(255,255,255,0.25)"/>
                          <span className="font-syne text-[7.5px] font-black">REGENERAR</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Email body preview — collapsed, expandable */}
            {selected.body_preview && (
              <EmailBodyBlock preview={selected.body_preview} gmailId={selected.gmail_id}/>
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

      {/* ── RIGHT: Resumen IA ── */}
      {!isMobile && !selected && (
        <div className="flex-shrink-0 flex flex-col overflow-y-auto p-4 gap-4" style={{width:'300px',borderLeft:`1px solid ${BORDER}`,background:'rgba(255,255,255,0.012)'}}>
          {(()=>{
            const upcoming = calEvents.filter((e:any)=>{ const d=new Date(e.start); return d >= new Date(new Date().toDateString()) }).slice(0,4)
            const suggested = allMsgs.filter((m:any)=>!m.is_read && m.ai_action && m.ai_action!=='Ninguna acción requerida').slice(0,3)
            const brief = `Dame un briefing rápido de mi inbox: ${unread} correos sin leer, ${urgent} urgentes${fromClients>0?`, ${fromClients} de clientes`:''}. ¿Qué debería atender primero y en qué orden?`
            return (<>
              <div className="rounded-2xl p-4" style={{background:'rgba(255,255,255,0.02)',border:`1px solid ${BORDER}`}}>
                <div className="flex items-center gap-2 mb-2.5"><LucideIcon name="sparkles" size={14} color={BLU}/><span className="font-figtree text-[13px] font-semibold text-white">Resumen IA</span></div>
                <div className="font-figtree text-[12px] leading-relaxed" style={{color:'rgba(255,255,255,0.52)'}}>Tienes <b style={{color:'#fff'}}>{unread}</b> sin leer{urgent>0&&<>, <b style={{color:RED}}>{urgent}</b> urgente{urgent>1?'s':''}</>}{fromClients>0&&<>, <b style={{color:'#fff'}}>{fromClients}</b> de clientes</>}.</div>
                <button onClick={()=>onAskHarvey?.(brief)} className="mt-3 w-full py-2 rounded-xl font-syne text-[8px] font-black tracking-widest transition-all hover:opacity-80" style={{background:`${BLU}14`,border:`1px solid ${BLU}30`,color:BLU}}>GENERAR BRIEFING</button>
              </div>
              {suggested.length>0 && (
                <div>
                  <div className="font-syne text-[7.5px] font-black tracking-[0.2em] px-1 pb-2" style={{color:'rgba(255,255,255,0.22)'}}>ACCIONES SUGERIDAS</div>
                  <div className="space-y-2">
                    {suggested.map((m:any)=>(
                      <button key={m.id} onClick={()=>handleSelect(m)} className="w-full text-left flex items-start gap-2.5 p-3 rounded-xl transition-all" style={{background:'rgba(255,255,255,0.02)',border:`1px solid ${BORDER}`}} onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.04)'} onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,0.02)'}>
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:`${uc(m.ai_urgency)}18`}}><LucideIcon name="corner-up-left" size={11} color={uc(m.ai_urgency)}/></div>
                        <div className="min-w-0 flex-1"><div className="font-figtree text-[12px] font-semibold truncate" style={{color:'rgba(255,255,255,0.8)'}}>{m.ai_action}</div><div className="font-syne text-[8px] truncate mt-0.5" style={{color:'rgba(255,255,255,0.28)'}}>{m.from_name||'?'}{m.ai_client&&m.ai_client!=='Desconocido'?' · '+m.ai_client:''}</div></div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {upcoming.length>0 && (
                <div>
                  <div className="font-syne text-[7.5px] font-black tracking-[0.2em] px-1 pb-2" style={{color:'rgba(255,255,255,0.22)'}}>PRÓXIMOS EVENTOS</div>
                  <div className="space-y-2">
                    {upcoming.map((e:any,i:number)=>{ const d=new Date(e.start); const hasT=!!e.start?.includes('T'); return (
                      <div key={i} className="flex items-center gap-3 p-3 rounded-xl" style={{background:'rgba(255,255,255,0.02)',border:`1px solid ${BORDER}`}}>
                        <div className="flex flex-col items-center flex-shrink-0" style={{minWidth:'40px'}}><span className="font-figtree text-[13px] font-black" style={{color:'#A78BFA'}}>{hasT?e.start.slice(11,16):'—'}</span><span className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.25)'}}>{d.toLocaleDateString('es-ES',{day:'numeric',month:'short'})}</span></div>
                        <div className="min-w-0 flex-1"><div className="font-figtree text-[12px] font-semibold truncate" style={{color:'rgba(255,255,255,0.75)'}}>{e.title}</div>{e.location&&<div className="font-syne text-[8px] truncate mt-0.5" style={{color:'rgba(255,255,255,0.28)'}}>{e.location}</div>}</div>
                      </div>
                    )})}
                  </div>
                </div>
              )}
              <button onClick={()=>onNavigate?.('chat')} className="mt-auto w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-syne text-[8.5px] font-black tracking-widest transition-all hover:opacity-80" style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.45)'}}><LucideIcon name="message-square" size={12} color="rgba(255,255,255,0.4)"/>ABRIR BRUTAL.IA</button>
            </>)
          })()}
        </div>
      )}
    </div>
  )
}

export default InboxSection
