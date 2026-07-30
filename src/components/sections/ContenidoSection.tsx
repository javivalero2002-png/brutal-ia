'use client'

import { useState, useRef, useEffect } from 'react'
import { useIsMobile, useBackClosable, BLU, RED, GRN, SURFACE, SURF2, BORDER, LucideIcon, videoEmbed } from '@/components/shared'
import { PlatformLogo } from '@/components/PlatformLogo'

function ContenidoSection({data,onOpenModal,showToast,onNavigate,onSelectClient,profile}: any) {
  const isMobile = useIsMobile()
  const [activeItem, setActiveItem] = useState<any>(null)
  useBackClosable(!!activeItem, () => setActiveItem(null))
  const [editNotes, setEditNotes] = useState('')
  const [editVideoUrl, setEditVideoUrl] = useState('')
  const [editAccountName, setEditAccountName] = useState('')
  const [editPublishDate, setEditPublishDate] = useState('')
  const [editPublishTime, setEditPublishTime] = useState('')
  const [pendingEmoji, setPendingEmoji] = useState('')
  const [pendingNote, setPendingNote] = useState('')
  const [savingOpinion, setSavingOpinion] = useState(false)
  const [accountFilter, setAccountFilter] = useState('Todas')
  const [clientFilter, setClientFilter] = useState('Todos')
  const [contentSearch, setContentSearch] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [confirmDeleteContent, setConfirmDeleteContent] = useState(false)
  const [uploadingVideo, setUploadingVideo] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [editCoverUrl, setEditCoverUrl] = useState('')
  const [bocetoPlatform, setBocetoPlatform] = useState<'instagram'|'linkedin'|null>(null)
  const [bocetoCaption, setBocetoCaption] = useState<string|null>(null)
  useEffect(()=>{ setBocetoPlatform(null); setBocetoCaption(null) }, [activeItem?.id])
  const coverFileInputRef = useRef<HTMLInputElement>(null)
  const filteredAgendaRef = useRef<any[]>([])
  const contentSearchInputRef = useRef<HTMLInputElement>(null)
  const videoFileInputRef = useRef<HTMLInputElement>(null)

  const uploadVideo = async (file: File) => {
    if (!activeItem) return
    setUploadingVideo(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch(`/api/agenda/${activeItem.id}/upload-video`, { method:'POST', body:fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error||'Error')
      setEditVideoUrl(json.url)
      setActiveItem((prev: any) => ({...prev, video_url: json.url}))
      data.updateAgenda && data.updateAgenda(activeItem.id, { video_url: json.url }).catch(()=>{})
      showToast(json.warning || 'Vídeo subido correctamente')
    } catch (err: any) { showToast('Error: '+err.message) }
    finally { setUploadingVideo(false) }
  }

  const uploadCover = async (file: File) => {
    if (!activeItem) return
    setUploadingCover(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch(`/api/agenda/${activeItem.id}/upload-cover`, { method:'POST', body:fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error||'Error')
      setEditCoverUrl(json.url)
      setActiveItem((prev: any) => ({...prev, cover_url: json.url}))
      data.updateAgenda && data.updateAgenda(activeItem.id, { cover_url: json.url }).catch(()=>{})
      showToast(json.warning || 'Portada subida correctamente')
    } catch (err: any) { showToast('Error: '+err.message) }
    finally { setUploadingCover(false) }
  }

  useEffect(()=>{
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeItem) { setActiveItem(null); return }
      if (['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) || e.metaKey||e.ctrlKey||e.altKey) return
      if (e.key === 'n' && !activeItem) { e.preventDefault(); onOpenModal('contenido') }
      if (e.key === 'f' && !activeItem) { e.preventDefault(); contentSearchInputRef.current?.focus() }
      if (e.key === 's' && activeItem) {
        e.preventDefault()
        const statuses = ['borrador','pendiente','listo','publicado']
        const curr = statuses.indexOf(activeItem.status)
        const next = statuses[(curr+1)%statuses.length]
        const prev = activeItem.status
        setActiveItem((p: any) => ({...p, status: next}))
        data.updateAgenda?.(activeItem.id, {status:next}).catch(() => {
          setActiveItem((p: any) => ({...p, status: prev}))
          showToast('Error actualizando estado')
        })
      }
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault()
        const items = filteredAgendaRef.current
        const idx = activeItem ? items.findIndex((a: any)=>a.id===activeItem.id) : -1
        const next = e.key==='j' ? Math.min(idx+1, items.length-1) : Math.max(idx-1, 0)
        const item = items[next]
        if (item) openItem(item)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItem, onOpenModal])

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
    setEditCoverUrl(item.cover_url||'')
    setEditAccountName(item.account_name||'')
    setEditPublishDate(item.publish_date||'')
    setEditPublishTime(item.publish_time||'')
    setConfirmDeleteContent(false)
    const ops = (() => { try { const p = JSON.parse(item.feedback||'[]'); return Array.isArray(p) ? p : [] } catch { return [] } })()
    const myOp = ops.find((o: any) => o.userId === profile?.id)
    setPendingEmoji(myOp?.emoji || '')
    setPendingNote(myOp?.note || '')
  }

  const saveOpinion = async () => {
    if (!activeItem || (!pendingEmoji && !pendingNote.trim())) return
    setSavingOpinion(true)
    try {
      const existing = (() => { try { const p = JSON.parse(activeItem.feedback||'[]'); return Array.isArray(p) ? p : [] } catch { return [] } })()
      const filtered = existing.filter((o: any) => o.userId !== profile?.id)
      const name = profile?.name || 'Equipo'
      const initials = profile?.initials || name.split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase() || 'YO'
      filtered.push({ userId: profile?.id, name, initials, color: profile?.avatar_color || BLU, emoji: pendingEmoji, note: pendingNote.trim(), at: new Date().toISOString() })
      const feedback = JSON.stringify(filtered)
      await data.updateAgenda(activeItem.id, { feedback })
      setActiveItem((prev: any) => ({...prev, feedback}))
      showToast('Opinión publicada')
    } catch { showToast('Error al guardar opinión') }
    finally { setSavingOpinion(false) }
  }

  const saveNotes = async () => {
    if (!activeItem) return
    setSavingNotes(true)
    try {
      const updates: any = { notes: editNotes, video_url: editVideoUrl, cover_url: editCoverUrl || null, account_name: editAccountName, publish_date: editPublishDate || null, publish_time: editPublishTime || null }
      await data.updateAgenda(activeItem.id, updates)
      showToast('Guardado')
      setActiveItem((prev: any) => ({...prev, ...updates}))
    } catch { showToast('Error guardando') }
    finally { setSavingNotes(false) }
  }

  const PREDEFINED_ACCOUNTS = ['Brutal Studios','Julio','Pablo']
  // Dedup insensible a mayúsculas/espacios (evita "Brutal Studios" duplicado por variantes en la BD)
  const _accSeen = new Map<string,string>()
  for (const raw of [...PREDEFINED_ACCOUNTS, ...data.agenda.filter((a: any)=>a.account_name).map((a: any)=>String(a.account_name).trim())]) {
    const key = raw.toLowerCase()
    if (raw && !_accSeen.has(key)) _accSeen.set(key, raw)
  }
  const allAccounts: string[] = ['Todas', ..._accSeen.values()]
  const allContentClients: string[] = ['Todos', ...Array.from(new Set<string>(data.agenda.filter((a: any)=>a.client?.name||a.client_id).map((a: any)=>a.client?.name||(data.clients.find((c: any)=>c.id===a.client_id)?.name)||'').filter(Boolean)))]
  const filteredByClient = clientFilter === 'Todos' ? data.agenda : data.agenda.filter((a: any) => (a.client?.name||data.clients.find((c: any)=>c.id===a.client_id)?.name) === clientFilter)
  const filteredByAccount = accountFilter === 'Todas' ? filteredByClient : filteredByClient.filter((a: any)=>String(a.account_name||'').trim().toLowerCase()===accountFilter.trim().toLowerCase())
  const filteredAgenda = !contentSearch.trim() ? filteredByAccount : filteredByAccount.filter((a: any)=>a.title?.toLowerCase().includes(contentSearch.toLowerCase()))
  filteredAgendaRef.current = filteredAgenda

  const changeStatus = async (item: any, newStatus: string) => {
    try {
      await data.updateAgenda(item.id, { status: newStatus })
      if (activeItem?.id === item.id) setActiveItem((prev: any)=>({...prev, status: newStatus}))
      showToast('Estado actualizado')
    } catch { showToast('Error') }
  }

  const pc = activeItem ? (platColor[activeItem.platform]||BLU) : BLU

  return (
    <div className="h-full overflow-hidden">

      {/* ── KANBAN ─────────────────────────────────────────────── */}
      <div className="flex flex-col h-full overflow-hidden">

        {/* Header */}
        <div className="px-8 pt-6 pb-5 flex-shrink-0" style={{borderBottom:`1px solid ${BORDER}`}}>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div className="min-w-0">
              <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-1.5" style={{color:'rgba(255,255,255,0.18)'}}>PRODUCCIÓN</div>
              <div className="flex items-baseline gap-3 flex-wrap">
                <h1 className="font-figtree text-[26px] font-black text-white leading-none" style={{letterSpacing:'-0.04em'}}>Pipeline</h1>
                {!isMobile && <div className="flex items-center gap-2">
                  {(['J/K NAVEGAR','S ESTADO','F BUSCAR','N NUEVA'] as const).map((hint,i,arr)=>(
                    <span key={hint} className="flex items-center gap-2">
                      <span className="font-syne text-[7px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.1)'}}>{hint}</span>
                      {i<arr.length-1&&<span className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.07)'}}>·</span>}
                    </span>
                  ))}
                </div>}
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
            <button onClick={()=>onOpenModal('contenido')} className="flex items-center gap-2 px-5 py-2.5 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white transition-opacity hover:opacity-85 flex-shrink-0 whitespace-nowrap" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
              + NUEVA PIEZA
            </button>
          </div>
          {/* Content search */}
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl mb-3" style={{background:SURFACE,border:`1px solid ${BORDER}`,maxWidth:'320px'}}>
            <LucideIcon name="search" size={12} color="rgba(255,255,255,0.2)"/>
            <input ref={contentSearchInputRef} value={contentSearch} onChange={e=>setContentSearch(e.target.value)} placeholder="Busca por título…" className="flex-1 bg-transparent text-[12px] outline-none" style={{caretColor:BLU,color:'rgba(255,255,255,0.75)'}}/>
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
          {allAccounts.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {allAccounts.map((acc: string)=>{
                const isAll = acc === 'Todas'
                const isActive = accountFilter === acc
                const firstItem = data.agenda.find((a: any)=>String(a.account_name||'').trim().toLowerCase()===acc.toLowerCase())
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
                    <div style={{height:'2px',background:`linear-gradient(90deg,${col.color}60,transparent)`}}/>
                    <div className="px-4 pt-3.5 pb-3.5 flex-shrink-0 flex items-center justify-between" style={{borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:col.color,boxShadow:`0 0 5px ${col.color}80`}}/>
                        <span className="font-syne text-[8.5px] font-black tracking-widest uppercase" style={{color:'rgba(255,255,255,0.38)'}}>{col.label}</span>
                      </div>
                      <span className="font-syne text-[10px] font-black px-2 py-0.5 rounded-full" style={{background:col.color+'15',color:col.color+'90'}}>{items.length}</span>
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
                            {/* Video thumbnail — publicado with video_url */}
                            {col.key==='publicado' && item.video_url && (()=>{
                              const ytId = item.video_url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/)?.[1]
                              return ytId ? (
                                <div className="relative overflow-hidden flex-shrink-0" style={{aspectRatio:'16/9',borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
                                  <img src={`https://img.youtube.com/vi/${ytId}/mqdefault.jpg`} alt="video" className="w-full h-full object-cover" style={{opacity:0.75}}/>
                                  <div className="absolute inset-0 flex items-center justify-center" style={{background:'rgba(0,0,0,0.28)'}}>
                                    <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{background:'rgba(229,29,42,0.9)',boxShadow:'0 0 18px rgba(229,29,42,0.5)'}}>
                                      <svg viewBox="0 0 24 24" width={13} height={13} fill="white"><path d="M5 3l14 9-14 9V3z"/></svg>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center justify-center gap-2 py-3" style={{borderBottom:`1px solid rgba(255,255,255,0.05)`,background:'rgba(27,95,250,0.04)'}}>
                                  <LucideIcon name="film" size={13} color="rgba(27,95,250,0.5)"/>
                                  <span className="font-syne text-[7.5px] font-black tracking-wide" style={{color:'rgba(27,95,250,0.5)'}}>VÍDEO</span>
                                </div>
                              )
                            })()}
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
                                  return <span className="font-syne text-[8px] ml-auto flex-shrink-0 px-1.5 py-0.5 rounded-full" style={{background:isToday2?`rgba(255,176,32,0.18)`:dOver?`${BLU}15`:dSoon?'rgba(255,176,32,0.1)':'transparent',color:isToday2?'rgba(255,176,32,0.95)':dOver?BLU:dSoon?'rgba(255,176,32,0.8)':'rgba(255,255,255,0.22)'}}>{label}</span>
                                })()}
                                {item.publish_date && item.status==='publicado' && (
                                  <span className="font-syne text-[7.5px] font-black ml-auto flex-shrink-0" style={{color:'rgba(27,95,250,0.5)'}}>
                                    {new Date(item.publish_date+'T00:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'})}
                                  </span>
                                )}
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

      {/* ── CONTENT MODAL OVERLAY ─────────────────────────────────── */}
      {activeItem && (
        <div
          className={isMobile ? "fixed inset-0 z-50 flex" : "fixed inset-0 z-50 flex items-center justify-center p-6"}
          style={{background:'rgba(0,0,0,0.72)',backdropFilter:'blur(14px)'}}
          onClick={()=>setActiveItem(null)}
        >
          <div
            className={isMobile ? "relative w-full flex flex-col overflow-y-auto" : "relative w-full flex overflow-hidden"}
            style={{
              maxWidth: isMobile ? '100%' : '940px',
              maxHeight: isMobile ? '100dvh' : 'calc(100vh - 48px)',
              borderRadius: isMobile ? '0px' : '28px',
              paddingTop: isMobile ? 'env(safe-area-inset-top)' : undefined,
              paddingBottom: isMobile ? 'env(safe-area-inset-bottom)' : undefined,
              background:'linear-gradient(160deg,#0E0E20 0%,#07070F 100%)',
              border:`1px solid ${pc}22`,
              boxShadow:`0 60px 120px rgba(0,0,0,0.85),0 0 0 1px rgba(255,255,255,0.04),inset 0 1px 0 rgba(255,255,255,0.05)`,
            }}
            onClick={e=>e.stopPropagation()}
          >
            {/* Ambient glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 pointer-events-none" style={{width:'60%',height:'180px',background:`radial-gradient(ellipse,${pc}1A 0%,transparent 70%)`,filter:'blur(50px)'}}/>

            {/* ── LEFT COLUMN: Video + Info ── */}
            <div className={isMobile ? "relative flex flex-col flex-shrink-0" : "relative flex flex-col flex-shrink-0 overflow-y-auto"} style={isMobile?{width:'100%',borderBottom:`1px solid rgba(255,255,255,0.06)`}:{width:'52%',borderRight:`1px solid rgba(255,255,255,0.06)`}}>
              {/* Header */}
              <div className="flex-shrink-0 px-7 pt-7 pb-5" style={{borderBottom:`1px solid rgba(255,255,255,0.06)`}}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <div className="w-13 h-13 rounded-2xl flex items-center justify-center flex-shrink-0" style={{background:`${pc}15`,border:`1px solid ${pc}25`,width:48,height:48}}>
                      <PlatformLogo platform={activeItem.platform} size={26} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-syne text-[9px] font-black tracking-widest" style={{color:pc}}>{activeItem.platform.toUpperCase()}</span>
                        {activeItem.account_name && <span className="font-syne text-[8px]" style={{color:'rgba(255,255,255,0.25)'}} >@{activeItem.account_name}</span>}
                        {activeItem.client && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:(activeItem.client.color||BLU)+'12',color:(activeItem.client.color||BLU)+'bb'}}>{activeItem.client.name}</span>}
                      </div>
                      <div className="font-figtree text-[16px] font-bold text-white leading-snug" style={{letterSpacing:'-0.02em'}}>{activeItem.title}</div>
                    </div>
                  </div>
                  <button onClick={()=>setActiveItem(null)} className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:'rgba(255,255,255,0.05)',border:`1px solid rgba(255,255,255,0.08)`}}>
                    <LucideIcon name="x" size={13} color="rgba(255,255,255,0.35)"/>
                  </button>
                </div>
                {/* Status pills */}
                <div className="flex gap-1.5 mt-4 overflow-x-auto" style={{scrollbarWidth:'none'}}>
                  {cols.map(col=>(
                    <button key={col.key} onClick={()=>changeStatus(activeItem, col.key)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl font-syne text-[7.5px] font-black tracking-wide transition-all flex-shrink-0 whitespace-nowrap"
                      style={{
                        background: activeItem.status===col.key ? col.color+'1A' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${activeItem.status===col.key ? col.color+'45' : 'rgba(255,255,255,0.06)'}`,
                        color: activeItem.status===col.key ? col.color : 'rgba(255,255,255,0.22)',
                      }}>
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:activeItem.status===col.key ? col.color : 'rgba(255,255,255,0.12)'}}/>
                      {col.label.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Video section */}
              <div className="p-6 space-y-4" onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!savingNotes){e.preventDefault();saveNotes()}}}>
                <input ref={videoFileInputRef} type="file" accept="video/*" className="hidden" onChange={e=>{ const f=e.target.files?.[0]; if(f) uploadVideo(f); e.target.value='' }}/>
                <div>
                  <div className="font-syne text-[8.5px] font-black tracking-widest mb-2.5" style={{color:'rgba(255,255,255,0.2)'}}>VÍDEO</div>
                  <div className="flex gap-2 mb-2.5">
                    <input value={editVideoUrl} onChange={e=>setEditVideoUrl(e.target.value)} placeholder="YouTube / Vimeo URL…" className="flex-1 px-3 py-2.5 rounded-xl text-[12px] text-white placeholder-white/20 outline-none" style={{background:'rgba(255,255,255,0.04)',border:`1.5px solid rgba(255,255,255,0.07)`,caretColor:BLU,minWidth:0}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.3)')} onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.07)')}/>
                    <button onClick={()=>videoFileInputRef.current?.click()} disabled={uploadingVideo} className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-syne text-[8px] font-black tracking-wide flex-shrink-0 disabled:opacity-40 transition-all hover:opacity-80" style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.45)',border:`1px solid rgba(255,255,255,0.07)`}}>
                      {uploadingVideo ? <><div className="w-3 h-3 border-2 rounded-full animate-spin flex-shrink-0" style={{borderColor:'rgba(255,255,255,0.3)',borderTopColor:'white'}}/><span>SUBIENDO…</span></> : <><LucideIcon name="upload" size={11} color="rgba(255,255,255,0.4)"/><span>SUBIR</span></>}
                    </button>
                  </div>
                  {videoEmbed(editVideoUrl) && (
                    <div className="rounded-2xl overflow-hidden" style={{aspectRatio:'16/9',background:'#000'}}>
                      <iframe src={videoEmbed(editVideoUrl)!} className="w-full h-full" allow="accelerometer;autoplay;encrypted-media;gyroscope;picture-in-picture" allowFullScreen/>
                    </div>
                  )}
                  {!videoEmbed(editVideoUrl) && editVideoUrl && (
                    <div className="rounded-2xl overflow-hidden" style={{background:'#000'}}>
                      <video src={editVideoUrl} controls className="w-full rounded-2xl" style={{maxHeight:'240px',objectFit:'contain'}} preload="metadata"/>
                    </div>
                  )}
                  {!editVideoUrl && activeItem.video_url && (
                    <div className="rounded-2xl overflow-hidden" style={{background:'#000'}}>
                      {videoEmbed(activeItem.video_url)
                        ? <div style={{aspectRatio:'16/9'}}><iframe src={videoEmbed(activeItem.video_url)!} className="w-full h-full" allow="accelerometer;autoplay;encrypted-media;gyroscope;picture-in-picture" allowFullScreen/></div>
                        : <video src={activeItem.video_url} controls className="w-full rounded-2xl" style={{maxHeight:'240px',objectFit:'contain'}} preload="metadata"/>
                      }
                    </div>
                  )}
                  {!editVideoUrl && !activeItem.video_url && (
                    <div className="flex items-center gap-2 rounded-xl p-4" style={{background:'rgba(255,255,255,0.02)',border:`1px dashed rgba(255,255,255,0.07)`}}>
                      <LucideIcon name="film" size={14} color="rgba(255,255,255,0.12)"/>
                      <span className="font-syne text-[9px]" style={{color:'rgba(255,255,255,0.18)'}}>Sin vídeo — pega una URL o sube un archivo</span>
                    </div>
                  )}
                </div>

                {/* Cover / Portada */}
                <div>
                  <input ref={coverFileInputRef} type="file" accept="image/*" className="hidden" onChange={e=>{ const f=e.target.files?.[0]; if(f) uploadCover(f); e.target.value='' }}/>
                  <div className="font-syne text-[8.5px] font-black tracking-widest mb-2.5" style={{color:'rgba(255,255,255,0.2)'}}>PORTADA</div>
                  <div className="flex gap-2 mb-2.5">
                    <input value={editCoverUrl} onChange={e=>setEditCoverUrl(e.target.value)} placeholder="URL de portada…" className="flex-1 px-3 py-2.5 rounded-xl text-[12px] text-white placeholder-white/20 outline-none" style={{background:'rgba(255,255,255,0.04)',border:`1.5px solid rgba(255,255,255,0.07)`,caretColor:BLU,minWidth:0}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.3)')} onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.07)')}/>
                    <button onClick={()=>coverFileInputRef.current?.click()} disabled={uploadingCover} className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-syne text-[8px] font-black tracking-wide flex-shrink-0 disabled:opacity-40 transition-all hover:opacity-80" style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.45)',border:`1px solid rgba(255,255,255,0.07)`}}>
                      {uploadingCover ? <><div className="w-3 h-3 border-2 rounded-full animate-spin flex-shrink-0" style={{borderColor:'rgba(255,255,255,0.3)',borderTopColor:'white'}}/><span>SUBIENDO…</span></> : <><LucideIcon name="image" size={11} color="rgba(255,255,255,0.4)"/><span>SUBIR</span></>}
                    </button>
                  </div>
                  {(editCoverUrl || activeItem.cover_url) && (
                    <div className="rounded-2xl overflow-hidden" style={{background:'#000'}}>
                      <img src={editCoverUrl || activeItem.cover_url} alt="cover" className="w-full rounded-2xl" style={{maxHeight:'200px',objectFit:'cover'}}/>
                    </div>
                  )}
                  {!editCoverUrl && !activeItem.cover_url && (
                    <div className="flex items-center gap-2 rounded-xl p-4" style={{background:'rgba(255,255,255,0.02)',border:`1px dashed rgba(255,255,255,0.07)`}}>
                      <LucideIcon name="image" size={14} color="rgba(255,255,255,0.12)"/>
                      <span className="font-syne text-[9px]" style={{color:'rgba(255,255,255,0.18)'}}>Sin portada — pega una URL o sube una imagen</span>
                    </div>
                  )}
                </div>

                {/* Date + Account */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="font-syne text-[8.5px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.2)'}}>FECHA</div>
                    <input type="date" value={editPublishDate} onChange={e=>setEditPublishDate(e.target.value)} className="w-full px-3 py-2.5 rounded-xl text-[12px] text-white outline-none" style={{background:'rgba(255,255,255,0.04)',border:`1.5px solid rgba(255,255,255,0.07)`,caretColor:BLU,colorScheme:'dark'}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.3)')} onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.07)')}/>
                  </div>
                  <div>
                    <div className="font-syne text-[8.5px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.2)'}}>HORA</div>
                    <input type="time" value={editPublishTime} onChange={e=>setEditPublishTime(e.target.value)} className="w-full px-3 py-2.5 rounded-xl text-[12px] text-white outline-none" style={{background:'rgba(255,255,255,0.04)',border:`1.5px solid rgba(255,255,255,0.07)`,caretColor:BLU,colorScheme:'dark'}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.3)')} onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.07)')}/>
                  </div>
                </div>
                <div>
                  <div className="font-syne text-[8.5px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.2)'}}>CUENTA / PERFIL</div>
                  <select value={editAccountName} onChange={e=>setEditAccountName(e.target.value)} className="w-full px-3 py-2.5 rounded-xl text-[12px] text-white outline-none appearance-none" style={{background:'rgba(255,255,255,0.04)',border:`1.5px solid rgba(255,255,255,0.07)`,colorScheme:'dark'}}>
                    <option value="">Sin asignar</option>
                    {PREDEFINED_ACCOUNTS.map(acc=><option key={acc} value={acc}>{acc}</option>)}
                  </select>
                </div>

                {/* Save + Delete */}
                <div className="flex gap-2 pt-1">
                  <button onClick={saveNotes} disabled={savingNotes} className="flex-1 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-wide text-white disabled:opacity-40 transition-opacity" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>{savingNotes?'GUARDANDO…':'GUARDAR'}</button>
                  {confirmDeleteContent
                    ? <div className="flex items-center gap-1">
                        <button onClick={async()=>{try{await data.deleteAgenda(activeItem.id);setActiveItem(null);showToast('Pieza eliminada')}catch{showToast('Error al eliminar')}}} className="px-3 py-2.5 rounded-xl font-syne text-[8px] font-black" style={{background:'rgba(229,29,42,0.15)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR?</button>
                        <button onClick={()=>setConfirmDeleteContent(false)} className="w-8 h-8 rounded-xl flex items-center justify-center" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={12} color="rgba(255,255,255,0.3)"/></button>
                      </div>
                    : <button onClick={()=>setConfirmDeleteContent(true)} className="px-4 py-2.5 rounded-xl font-syne text-[9px] font-black transition-all" style={{color:'rgba(229,29,42,0.4)',border:`1px solid rgba(229,29,42,0.1)`}}>
                        <LucideIcon name="trash" size={12} color="rgba(229,29,42,0.4)"/>
                      </button>
                  }
                </div>
                <div className="nx-kbd-hints flex items-center justify-center gap-2 pb-1">
                  {[['⌘+ENTER','GUARDAR'],['S','ESTADO'],['ESC','CERRAR']].map(([k,l],i,a)=><span key={k} className="flex items-center gap-1.5"><span className="font-syne text-[7px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.09)'}}>{k}</span><span className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.08)'}}>{l}</span>{i<a.length-1&&<span style={{color:'rgba(255,255,255,0.06)'}}>·</span>}</span>)}
                </div>
              </div>
            </div>

            {/* ── RIGHT COLUMN: Notes + Team Opinions ── */}
            <div className={isMobile ? "flex-1 flex flex-col" : "flex-1 flex flex-col overflow-y-auto"}>
              {/* Boceto / Vista previa del post — interactivo */}
              {(()=>{
                const plat = String(activeItem.platform||'').toLowerCase()
                const isLinkedin = bocetoPlatform ? bocetoPlatform==='linkedin' : plat.includes('linkedin')
                const account = editAccountName || activeItem.account_name || 'Brutal Studios'
                const initial = (account.trim().charAt(0)||'B').toUpperCase()
                const media = editCoverUrl || activeItem.cover_url || ''
                const caption = bocetoCaption ?? (activeItem.title || '')
                const dirty = bocetoCaption!==null && bocetoCaption.trim() && bocetoCaption.trim()!==(activeItem.title||'')
                const igIcon = (d:string)=><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={d}/></svg>
                return (
                  <div className="px-7 pt-7 pb-5 flex-shrink-0" style={{borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="font-syne text-[8.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>BOCETO EN VIVO</div>
                      <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.06)'}}>
                        {(['instagram','linkedin'] as const).map(p=>{
                          const on = isLinkedin ? p==='linkedin' : p==='instagram'
                          return <button key={p} onClick={()=>setBocetoPlatform(p)} className="px-2.5 py-1 rounded-md font-syne text-[7.5px] font-black tracking-wide transition-all" style={{background:on?(p==='linkedin'?'#0a66c2':'#dc2743')+'22':'transparent',color:on?(p==='linkedin'?'#4a9fe0':'#ff6ba0'):'rgba(255,255,255,0.3)'}}>{p==='linkedin'?'LINKEDIN':'INSTAGRAM'}</button>
                        })}
                      </div>
                    </div>
                    <div className="flex justify-center">
                    {isLinkedin ? (
                      <div className="w-full rounded-xl overflow-hidden" style={{maxWidth:'340px',background:'#1b1f23',border:'1px solid rgba(255,255,255,0.1)'}}>
                        <div className="flex items-center gap-2.5 px-3 pt-3 pb-2">
                          <div className="w-9 h-9 rounded-full flex items-center justify-center font-figtree text-[13px] font-bold text-white flex-shrink-0" style={{background:'#0a66c2'}}>{initial}</div>
                          <div className="flex-1 min-w-0"><div className="text-white text-[12.5px] font-semibold leading-tight truncate">{account}</div><div className="text-[10px] leading-tight" style={{color:'rgba(255,255,255,0.4)'}}>Agencia creativa · Ahora · 🌐</div></div>
                          <span style={{color:'rgba(255,255,255,0.4)'}}>···</span>
                        </div>
                        <div className="px-3 pb-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap" style={{color:'rgba(255,255,255,0.85)'}}>{caption}</div>
                        {media
                          ? <img src={media} alt="" className="w-full" style={{maxHeight:'220px',objectFit:'cover'}}/>
                          : <div style={{height:'160px',background:'linear-gradient(135deg,#243b55,#141e30)'}} className="flex items-center justify-center"><PlatformLogo platform={activeItem.platform} size={30}/></div>}
                        <div className="flex items-center gap-1.5 px-3 py-2" style={{borderTop:'1px solid rgba(255,255,255,0.08)'}}>
                          <span className="text-[13px]">👍</span><span className="text-[13px] -ml-1.5">❤️</span><span className="text-[10px] ml-1" style={{color:'rgba(255,255,255,0.4)'}}>42</span>
                          <div className="flex-1"/>
                          {['Recomendar','Comentar','Compartir'].map(l=><span key={l} className="font-figtree text-[10px] px-1.5" style={{color:'rgba(255,255,255,0.45)'}}>{l}</span>)}
                        </div>
                      </div>
                    ) : (
                      <div className="w-full rounded-xl overflow-hidden" style={{maxWidth:'300px',background:'#000',border:'1px solid rgba(255,255,255,0.12)'}}>
                        <div className="flex items-center gap-2.5 px-3 py-2.5">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{background:'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)',padding:'2px'}}>
                            <div className="w-full h-full rounded-full flex items-center justify-center font-figtree text-[11px] font-bold text-white" style={{background:'#000'}}>{initial}</div>
                          </div>
                          <span className="flex-1 text-white text-[12px] font-semibold truncate">{account}</span>
                          <span className="text-white text-[15px] leading-none">···</span>
                        </div>
                        {media
                          ? <img src={media} alt="" style={{aspectRatio:'1/1',width:'100%',objectFit:'cover'}}/>
                          : <div style={{aspectRatio:'1/1',background:'linear-gradient(135deg,#1a1a2e,#0f1230)'}} className="flex flex-col items-center justify-center gap-3 p-5"><PlatformLogo platform={activeItem.platform} size={34}/><span className="text-center font-figtree text-[13px] font-semibold leading-snug" style={{color:'rgba(255,255,255,0.55)'}}>{caption}</span></div>}
                        <div className="flex items-center gap-3.5 px-3 pt-2.5">
                          {igIcon('M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z')}
                          {igIcon('M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z')}
                          {igIcon('M22 2 11 13M22 2 15 22 11 13 2 9l20-7z')}
                          <div className="flex-1"/>
                          {igIcon('M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z')}
                        </div>
                        <div className="px-3 pt-1.5 pb-3">
                          <div className="text-white text-[11px] font-semibold">128 Me gusta</div>
                          <div className="text-white text-[12px] leading-snug mt-0.5"><span className="font-semibold">{account}</span> {caption}</div>
                        </div>
                      </div>
                    )}
                    </div>
                    {/* Editor de copy en vivo */}
                    <div className="mt-3">
                      <textarea value={caption} onChange={e=>setBocetoCaption(e.target.value)} rows={2} placeholder="Escribe el copy del post — se actualiza en el boceto…" className="w-full px-3 py-2.5 rounded-xl text-[12px] text-white placeholder-white/20 outline-none resize-none" style={{background:'rgba(255,255,255,0.03)',border:'1.5px solid rgba(255,255,255,0.07)',caretColor:BLU,lineHeight:'1.5'}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.3)')} onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.07)')}/>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.15)'}}>{caption.length} caracteres · edita para ver cómo queda</span>
                        {dirty && <button onClick={async()=>{ try{ await data.updateAgenda(activeItem.id,{title:(bocetoCaption||'').trim()}); setActiveItem((a:any)=>a?{...a,title:(bocetoCaption||'').trim()}:a); setBocetoCaption(null); showToast('Copy guardado') }catch{ showToast('Error al guardar') } }} className="font-syne text-[7.5px] font-black tracking-widest px-2.5 py-1 rounded-lg transition-all hover:opacity-80" style={{background:`${BLU}14`,color:BLU,border:`1px solid ${BLU}28`}}>GUARDAR COPY</button>}
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Notes */}
              <div className="px-7 pt-7 pb-5 flex-shrink-0" style={{borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
                <div className="font-syne text-[8.5px] font-black tracking-widest mb-2.5" style={{color:'rgba(255,255,255,0.2)'}}>NOTAS DE PRODUCCIÓN</div>
                <textarea value={editNotes} onChange={e=>setEditNotes(e.target.value)} placeholder="Añade notas del equipo, brief de producción, referencias…" rows={5} className="w-full px-4 py-3 rounded-xl text-[12px] text-white placeholder-white/20 outline-none resize-none" style={{background:'rgba(255,255,255,0.03)',border:`1.5px solid rgba(255,255,255,0.07)`,caretColor:BLU,lineHeight:'1.65'}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.3)')} onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.07)')} onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!savingNotes){e.preventDefault();saveNotes()}}}/>
              </div>

              {/* Team opinions */}
              <div className="flex-1 px-7 py-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="font-syne text-[8.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>OPINIONES DEL EQUIPO</div>
                  {(()=>{ try { const ops = JSON.parse(activeItem.feedback||'[]'); return Array.isArray(ops)&&ops.length>0 ? <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full" style={{background:`${BLU}15`,color:`${BLU}bb`}}>{ops.length}</span> : null } catch { return null } })()}
                </div>

                {/* Existing opinions */}
                {(()=>{ try { const ops = JSON.parse(activeItem.feedback||'[]'); return Array.isArray(ops)&&ops.length>0 ? (
                  <div className="space-y-2">
                    {(ops as any[]).map((op: any, i: number) => (
                      <div key={i} className="flex items-start gap-3 p-3.5 rounded-2xl transition-all" style={{background:'rgba(255,255,255,0.03)',border:`1px solid rgba(255,255,255,0.06)`}}>
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center font-syne text-[9px] font-black flex-shrink-0" style={{background:`${op.color||BLU}18`,color:op.color||BLU}}>{op.initials}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="font-figtree text-[12px] font-bold" style={{color:'rgba(255,255,255,0.8)'}}>{op.name}</span>
                            {op.emoji && <span className="text-[16px] leading-none">{op.emoji}</span>}
                            <span className="font-syne text-[7px] ml-auto flex-shrink-0" style={{color:'rgba(255,255,255,0.18)'}}>{op.at?new Date(op.at).toLocaleDateString('es-ES',{day:'numeric',month:'short'}):''}</span>
                          </div>
                          {op.note && <p className="font-syne text-[10px] leading-relaxed" style={{color:'rgba(255,255,255,0.42)'}}>{op.note}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null } catch { return null } })()}

                {/* Add / Edit my opinion */}
                {(()=>{
                  const existing = (() => { try { const p = JSON.parse(activeItem.feedback||'[]'); return Array.isArray(p) ? p : [] } catch { return [] } })()
                  const myOp = existing.find((o: any) => o.userId === profile?.id)
                  return (
                    <div className="rounded-2xl overflow-hidden" style={{background:'rgba(255,255,255,0.02)',border:`1px solid rgba(255,255,255,0.07)`}}>
                      <div className="p-4">
                        <div className="font-syne text-[7.5px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.18)'}}>{myOp ? 'TU OPINIÓN — EDITAR' : 'AÑADE TU OPINIÓN'}</div>
                        {/* Emoji picker */}
                        <div className="flex gap-2 mb-3 flex-wrap">
                          {([['🔥','Love it'],['👍','Bien'],['🤔','Dudas'],['✏️','Cambios'],['❌','No va']] as const).map(([em, label])=>(
                            <button key={em} onClick={()=>setPendingEmoji(em===pendingEmoji?'':em)} className="flex flex-col items-center gap-0.5 px-2.5 py-2 rounded-xl transition-all" style={{background:pendingEmoji===em?'rgba(255,255,255,0.1)':'rgba(255,255,255,0.03)',border:`1px solid ${pendingEmoji===em?'rgba(255,255,255,0.2)':'rgba(255,255,255,0.06)'}`,transform:pendingEmoji===em?'scale(1.1)':'scale(1)'}}>
                              <span className="text-[16px] leading-none">{em}</span>
                              <span className="font-syne text-[6.5px] font-black tracking-wide mt-0.5" style={{color:pendingEmoji===em?'rgba(255,255,255,0.55)':'rgba(255,255,255,0.22)'}}>{label}</span>
                            </button>
                          ))}
                        </div>
                        <textarea value={pendingNote} onChange={e=>setPendingNote(e.target.value)} placeholder="¿Qué opinas del enfoque, la dirección, el contenido…?" rows={2} className="w-full px-3.5 py-2.5 rounded-xl text-[12px] text-white placeholder-white/20 outline-none resize-none" style={{background:'rgba(255,255,255,0.03)',border:`1px solid rgba(255,255,255,0.07)`,caretColor:BLU,lineHeight:'1.6'}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.3)')} onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.07)')}/>
                      </div>
                      <button onClick={saveOpinion} disabled={savingOpinion||(!pendingEmoji&&!pendingNote.trim())} className="w-full py-2.5 font-syne text-[8.5px] font-black tracking-widest transition-all disabled:opacity-30 hover:opacity-80" style={{background:`rgba(27,95,250,0.08)`,color:BLU,borderTop:`1px solid rgba(27,95,250,0.12)`}}>
                        {savingOpinion?'GUARDANDO…':myOp?'ACTUALIZAR OPINIÓN':'PUBLICAR OPINIÓN'}
                      </button>
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ContenidoSection
