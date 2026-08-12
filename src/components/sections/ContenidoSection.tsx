'use client'

import { useState, useRef, useEffect } from 'react'
import { PLATAFORMA_COLOR, useIsMobile, useBackClosable, BLU, RED, GRN, SURFACE, SURF2, BORDER, LucideIcon, SafeImg, videoEmbed, todayKey } from '@/components/shared'
import { PlatformLogo } from '@/components/PlatformLogo'
import BocetoPanel from '@/components/BocetoPanel'

// El PATCH de /api/agenda/[id] reintenta sin las columnas que falten en la BD y
// devuelve `__dropped` con sus nombres. Aqui se traducen a lo que el usuario ve en
// el panel: el aviso de guardado parcial tiene que decirle QUE se ha perdido, no
// listarle columnas de Postgres.
const CAMPO_VISIBLE: Record<string,string> = {
  account_name: 'la cuenta',
  video_url: 'el enlace del vídeo',
  feedback: 'las opiniones',
  cover_url: 'la portada',
}
const listaCampos = (campos: string[]) => campos.map(c => CAMPO_VISIBLE[c] || c).join(', ')

function normContentType(raw: string|null|undefined): 'publicacion'|'reel'|'story' {
  const v = (raw||'').toLowerCase()
  if (v === 'reel' || v.includes('reel')) return 'reel'
  if (v === 'story' || v.includes('stor')) return 'story'
  return 'publicacion'
}

function ContenidoSection({data,onOpenModal,showToast,onNavigate,onSelectClient,profile}: any) {
  const isMobile = useIsMobile()
  const [activeItem, setActiveItem] = useState<any>(null)
  // Espejo de `activeItem` para poder mirar QUE PIEZA hay abierta despues de un
  // await, en vez del valor congelado del closure. Con el panel abierto se cambia
  // de pieza sin cerrarlo (J/K), asi que cualquier setter posterior a una espera
  // larga tiene que comprobar antes que sigue siendo la misma.
  const activeItemRef = useRef<any>(null)
  activeItemRef.current = activeItem
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
  const [platformFilter, setPlatformFilter] = useState('Todas')
  const [accountLogoUrl, setAccountLogoUrl] = useState<string>('')
  const [allAccountLogos, setAllAccountLogos] = useState<Record<string,string>>({})
  const logoFileInputRef = useRef<HTMLInputElement>(null)
  const [contentSearch, setContentSearch] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [confirmDeleteContent, setConfirmDeleteContent] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [editCoverUrl, setEditCoverUrl] = useState('')
  const [bocetoPlatform, setBocetoPlatform] = useState<'instagram'|'linkedin'|null>(null)
  const [bocetoCaption, setBocetoCaption] = useState<string|null>(null)
  const [editContentType, setEditContentType] = useState<'publicacion'|'reel'|'story'>('publicacion')
  const [mobileTab, setMobileTab] = useState<'boceto'|'editar'>('boceto')
  useEffect(()=>{
    const plat = activeItem?.platform
    setBocetoPlatform(plat==='Instagram'?'instagram':plat==='LinkedIn'?'linkedin':null)
    // null, NO activeItem.notes. `bocetoCaption` es «lo que el usuario ha escrito
    // en el copy», y null significa «no ha tocado nada»: BocetoPanel ya cae en
    // activeItem.title, que es donde vive el copy de verdad (onSaveCopy escribe
    // title, no notes).
    //
    // Sembrando con las notas de producción pasaban dos cosas, las dos malas: el
    // boceto en vivo enseñaba «Grabar en 4K, entregar viernes» como si fuera el
    // texto del post, y `dirty` daba true sin haber tocado nada, así que aparecía
    // GUARDAR COPY solo y un clic escribía las notas ENCIMA del título de la pieza.
    setBocetoCaption(null)
    setEditContentType(normContentType(activeItem?.content_type))
    setMobileTab('boceto')
  }, [activeItem?.id])
  // Load all account logos from Supabase on mount (persists across devices)
  useEffect(()=>{
    fetch('/api/account-logos').then(r=>r.ok?r.json():null).then(logos=>{
      if (logos && typeof logos === 'object') {
        setAllAccountLogos(logos)
        // Backfill localStorage for kanban cards that read from it inline
        for (const [k,v] of Object.entries(logos)) { try { localStorage.setItem(`account-logo-${k}`, v as string) } catch {} }
      }
    }).catch(()=>{})
  }, [])
  useEffect(()=>{
    const key = editAccountName.trim() || 'Brutal Studios'
    const fromServer = allAccountLogos[key]
    if (fromServer) { setAccountLogoUrl(fromServer); return }
    try { setAccountLogoUrl(localStorage.getItem(`account-logo-${key}`) || '') } catch { setAccountLogoUrl('') }
  }, [editAccountName, allAccountLogos])
  const coverFileInputRef = useRef<HTMLInputElement>(null)
  const filteredAgendaRef = useRef<any[]>([])
  const contentSearchInputRef = useRef<HTMLInputElement>(null)

  const uploadCover = async (file: File) => {
    // La pieza se fija AQUI, al empezar. Es el mismo arreglo que onPickPdf en
    // ProyectosSection.
    //
    // Entre elegir la foto y tener la URL hay una compresion en canvas y una
    // subida: segundos largos desde el movil o el iPad. El POST ya iba a la pieza
    // correcta, pero los setters de abajo pintaban la portada en la que estuviera
    // ABIERTA al terminar, y el siguiente "Guardar" la persistia ahi — la pieza
    // equivocada acababa con la portada de otra.
    const idPieza = activeItem?.id
    if (!idPieza) return
    setUploadingCover(true)
    try {
      // Comprimir a máx 1080px JPEG 0.72 — portadas de pipeline no necesitan resolución completa
      // Una foto de 6MB del iPad queda en ~80-120KB, muy por debajo del límite de 4.5MB de Vercel
      const compressed = await new Promise<Blob>((resolve, reject) => {
        const img = new Image()
        const objUrl = URL.createObjectURL(file)
        img.onload = () => {
          URL.revokeObjectURL(objUrl)
          const MAX = 1080
          let w = img.width, h = img.height
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * MAX / w); w = MAX }
            else { w = Math.round(w * MAX / h); h = MAX }
          }
          const canvas = document.createElement('canvas')
          canvas.width = w; canvas.height = h
          const ctx2d = canvas.getContext('2d'); if (!ctx2d) { reject(new Error('Canvas no disponible')); return }; ctx2d.drawImage(img, 0, 0, w, h)
          canvas.toBlob(b => b ? resolve(b) : reject(new Error('No se pudo comprimir la imagen')), 'image/jpeg', 0.72)
        }
        img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('No se pudo leer la imagen')) }
        img.src = objUrl
      })
      const fd = new FormData()
      fd.append('file', new File([compressed], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }))
      const res = await fetch(`/api/agenda/${idPieza}/upload-cover`, { method: 'POST', body: fd })
      const text = await res.text()
      let json: any = {}
      try { json = JSON.parse(text) } catch { throw new Error('Error del servidor al subir') }
      if (!res.ok) throw new Error(json.error || 'Error')
      // Los dos setters pintan el panel que se este viendo: si ya no es la pieza
      // de la subida, no se tocan (la portada ya quedo guardada en el servidor).
      if (activeItemRef.current?.id === idPieza) {
        setEditCoverUrl(json.url)
        setActiveItem((prev: any) => prev ? ({...prev, cover_url: json.url}) : prev)
      }
      data.updateAgenda && data.updateAgenda(idPieza, { cover_url: json.url }).catch(()=>{})
      showToast(json.warning || 'Portada subida correctamente')
    } catch (err: any) { showToast('Error: ' + err.message) }
    finally { setUploadingCover(false) }
  }

  // Guarda el logo de una cuenta en localStorage (base64 para evitar dependencia de servidor)
  const uploadAccountLogo = async (file: File) => {
    if (!file.type.startsWith('image/')) { showToast('Solo imágenes (JPG, PNG, WebP)'); return }
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const img = new Image()
        const objUrl = URL.createObjectURL(file)
        img.onload = () => {
          URL.revokeObjectURL(objUrl)
          const SIZE = 200
          const canvas = document.createElement('canvas')
          canvas.width = SIZE; canvas.height = SIZE
          const ctx = canvas.getContext('2d'); if (!ctx) { reject(new Error('Canvas no disponible')); return }
          const s = Math.min(img.width, img.height)
          ctx.drawImage(img, (img.width-s)/2, (img.height-s)/2, s, s, 0, 0, SIZE, SIZE)
          resolve(canvas.toDataURL('image/jpeg', 0.82))
        }
        img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('No se pudo leer la imagen')) }
        img.src = objUrl
      })
      const key = (editAccountName.trim() || 'Brutal Studios')
      try { localStorage.setItem(`account-logo-${key}`, url) } catch {}
      setAccountLogoUrl(url)
      setAllAccountLogos(prev => ({ ...prev, [key]: url }))
      // Se persiste en Supabase para que sobreviva al cambio de dispositivo o al
      // borrado del navegador. Y se ESPERA y se comprueba `ok`: un 400 ("Missing
      // fields") o un 500 de la ruta RESUELVEN la promesa, asi que el `.catch()`
      // que habia aqui no los veia nunca y el toast cantaba "actualizado" con el
      // logo guardado solo en este navegador. El try/catch propio es para que un
      // fallo de red no salte al catch de fuera: el logo SI se ha aplicado en local.
      let enLaNube = false
      try {
        const rLogo = await fetch('/api/account-logos', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({account:key,logo:url}) })
        enLaNube = rLogo.ok
      } catch { enLaNube = false }
      showToast(enLaNube ? 'Logo de cuenta actualizado' : 'Logo aplicado solo en este dispositivo — no se pudo guardar en la nube')
    } catch (err: any) { showToast('Error: ' + err.message) }
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
        const idPieza = activeItem.id
        setActiveItem((p: any) => ({...p, status: next}))
        data.updateAgenda?.(idPieza, {status:next}).catch(() => {
          // Deshacer a ciegas le pegaba el estado viejo de esta pieza a la que
          // hubieras abierto con J/K mientras el PATCH iba y venia.
          if (activeItemRef.current?.id === idPieza) setActiveItem((p: any) => ({...p, status: prev}))
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

  const platColor = PLATAFORMA_COLOR

  const cols = [
    { key:'borrador', label:'En bruto', color:'#FFFFFF' },
    { key:'pendiente', label:'En producción', color:'#FFB020' },
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
    setEditContentType(normContentType(item.content_type))
    setConfirmDeleteContent(false)
    const ops = (() => { try { const p = JSON.parse(item.feedback||'[]'); return Array.isArray(p) ? p : [] } catch { return [] } })()
    const myOp = ops.find((o: any) => o.userId === profile?.id)
    setPendingEmoji(myOp?.emoji || '')
    setPendingNote(myOp?.note || '')
  }

  const saveOpinion = async () => {
    if (!activeItem || (!pendingEmoji && !pendingNote.trim())) return
    const idPieza = activeItem.id
    setSavingOpinion(true)
    try {
      // Se relee el feedback del SERVIDOR antes de mezclar, no el que hay en
      // memoria.
      //
      // Esta columna tiene dos escritores: el equipo desde aqui y el cliente desde
      // /review. `activeItem.feedback` es de cuando se cargo la pieza, asi que si el
      // cliente mando su comentario mientras la tenias abierta, publicar una opinion
      // lo BORRABA — y es justo el momento en que lo hace, porque le acabas de pasar
      // el enlace. Es la otra mitad de la carrera que ya se corrigio en la ruta.
      //
      // Si la relectura falla se sigue con lo que hay: perder la opinion propia por
      // un fallo de red seria peor, y el caso comun es que no haya cambiado nada.
      let bruto = activeItem.feedback || '[]'
      try {
        const fresco = await fetch(`/api/agenda/${idPieza}`).then(r => r.ok ? r.json() : null)
        if (fresco && typeof fresco.feedback === 'string') bruto = fresco.feedback
      } catch {}
      const existing = (() => { try { const p = JSON.parse(bruto||'[]'); return Array.isArray(p) ? p : [] } catch { return [] } })()
      const filtered = existing.filter((o: any) => o.userId !== profile?.id)
      const name = profile?.name || 'Equipo'
      const initials = profile?.initials || name.split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase() || 'YO'
      filtered.push({ userId: profile?.id, name, initials, color: profile?.avatar_color || BLU, emoji: pendingEmoji, note: pendingNote.trim(), at: new Date().toISOString() })
      const feedback = JSON.stringify(filtered)
      // La ruta responde 200 aunque haya tenido que reintentar sin las columnas que
      // faltan en la BD, y avisa de cuales en `__dropped`. Aqui solo se manda
      // `feedback`: si vuelve descartado, la opinion no se ha escrito en ningun
      // sitio y decir "publicada" seria mentir — al recargar no estaria.
      const descartadas: string[] = (await data.updateAgenda(idPieza, { feedback })) || []
      if (descartadas.length) { showToast('No se pudo publicar: falta la columna feedback en la base de datos'); return }
      // Y como la relectura del servidor tarda, la pieza abierta puede ser ya otra.
      if (activeItemRef.current?.id === idPieza) setActiveItem((prev: any) => ({...prev, feedback}))
      showToast('Opinión publicada')
    } catch { showToast('Error al guardar opinión') }
    finally { setSavingOpinion(false) }
  }

  const saveNotes = async () => {
    if (!activeItem) return
    const idPieza = activeItem.id
    setSavingNotes(true)
    try {
      const updates: any = { notes: editNotes, video_url: editVideoUrl, cover_url: editCoverUrl || null, account_name: editAccountName, publish_date: editPublishDate || null, publish_time: editPublishTime || null, content_type: editContentType }
      // El PATCH reintenta sin las columnas ausentes en la BD y responde 200 con
      // `__dropped`. Nadie lo leia: la UI decia "Guardado" y ademas dejaba fijados
      // en la pieza valores que no se habian escrito en ninguna parte, asi que la
      // perdida no se veia hasta recargar.
      const descartadas: string[] = (await data.updateAgenda(idPieza, updates)) || []
      showToast(descartadas.length ? 'Guardado parcial — no se guardó ' + listaCampos(descartadas) : 'Guardado')
      if (activeItemRef.current?.id !== idPieza) return
      const persistido = { ...updates }
      for (const campo of descartadas) delete persistido[campo]
      setActiveItem((prev: any) => ({...prev, ...persistido}))
    } catch { showToast('Error guardando') }
    finally { setSavingNotes(false) }
  }

  const FIXED_ACCOUNTS = ['Brutal Studios', 'Julio', 'Pablo']
  const _normalizeAcc = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g,'')
  const allAccounts: string[] = ['Todas', ...FIXED_ACCOUNTS]
  // Filter by account first, then platform
  const filteredByAccount = accountFilter === 'Todas' ? data.agenda : data.agenda.filter((a: any)=>_normalizeAcc(String(a.account_name||''))===_normalizeAcc(accountFilter))
  // Platforms available for the current account selection
  const activePlatforms = [...new Set(filteredByAccount.filter((a: any)=>a.platform).map((a: any)=>String(a.platform).trim()))].filter(Boolean).sort() as string[]
  const allPlatforms: string[] = ['Todas', ...activePlatforms]
  const filteredByPlatform = platformFilter === 'Todas' ? filteredByAccount : filteredByAccount.filter((a: any)=>String(a.platform||'').trim()===platformFilter)
  const filteredAgenda = !contentSearch.trim() ? filteredByPlatform : filteredByPlatform.filter((a: any)=>a.title?.toLowerCase().includes(contentSearch.toLowerCase()))
  filteredAgendaRef.current = filteredAgenda

  const changeStatus = async (item: any, newStatus: string) => {
    try {
      await data.updateAgenda(item.id, { status: newStatus })
      // El ref, no `activeItem`: aqui el closure lleva la pieza que hubiera abierta
      // cuando se pinto el kanban, asi que la guarda podia dar true sobre otra.
      if (activeItemRef.current?.id === item.id) setActiveItem((prev: any)=>({...prev, status: newStatus}))
      showToast('Estado actualizado')
    } catch { showToast('Error') }
  }

  const pc = activeItem ? (platColor[activeItem.platform]||BLU) : BLU

  return (
    <div className="h-full overflow-hidden">

      {/* ── KANBAN ─────────────────────────────────────────────── */}
      <div className="flex flex-col h-full overflow-hidden">

        {/* Header */}
        <div className={`${isMobile?'px-4':'px-8'} pt-6 pb-5 flex-shrink-0`} style={{borderBottom:`1px solid ${BORDER}`}}>
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
                    const platColors = PLATAFORMA_COLOR
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
          {/* Platform filter — fila primaria */}
          {allPlatforms.length > 1 && (
            <div className="flex gap-1.5 flex-wrap mb-2 items-center">
              <span className="font-syne text-[7px] font-black tracking-widest mr-0.5" style={{color:'rgba(255,255,255,0.12)'}}>PLATAFORMA</span>
              {allPlatforms.map((pl: string)=>{
                const isAll = pl === 'Todas'
                const isActive = platformFilter === pl
                const platColors = PLATAFORMA_COLOR
                const plColor = platColors[pl] || BLU
                return (
                  <button key={pl} onClick={()=>setPlatformFilter(pl)} className="flex items-center gap-1.5 font-syne text-[8.5px] font-black px-3 py-1.5 rounded-xl transition-all" style={{
                    background: isActive ? (isAll ? 'rgba(27,95,250,0.15)' : plColor+'18') : 'rgba(255,255,255,0.04)',
                    color: isActive ? (isAll ? BLU : plColor) : 'rgba(255,255,255,0.3)',
                    border: isActive ? `1px solid ${isAll ? 'rgba(27,95,250,0.3)' : plColor+'35'}` : '1px solid transparent',
                  }}>
                    {!isAll && <PlatformLogo platform={pl} size={10}/>}
                    {pl}
                  </button>
                )
              })}
            </div>
          )}
          {/* Account filter — fila secundaria, sólo cuentas con contenido */}
          {(()=>{
            // Show accounts that have content overall (not filtered by current platform)
            const visibleAccounts = allAccounts.filter(acc => {
              if (acc === 'Todas') return true
              if (FIXED_ACCOUNTS.includes(acc)) return true
              return data.agenda.some((a: any) => _normalizeAcc(String(a.account_name||'')) === _normalizeAcc(acc))
            })
            if (visibleAccounts.length <= 1) return null
            return (
              <div className="flex gap-1.5 flex-wrap items-center">
                <span className="font-syne text-[7px] font-black tracking-widest mr-0.5" style={{color:'rgba(255,255,255,0.12)'}}>CUENTA</span>
                {visibleAccounts.map((acc: string)=>{
                  const isAll = acc === 'Todas'
                  const isActive = accountFilter === acc
                  return (
                    <button key={acc} onClick={()=>{ setAccountFilter(acc); setPlatformFilter('Todas') }} className="flex items-center gap-1.5 font-syne text-[8.5px] font-black px-3 py-1.5 rounded-xl transition-all" style={{
                      background: isActive ? (isAll ? 'rgba(27,95,250,0.15)' : 'rgba(255,255,255,0.08)') : 'rgba(255,255,255,0.04)',
                      color: isActive ? (isAll ? BLU : 'rgba(255,255,255,0.9)') : 'rgba(255,255,255,0.3)',
                      border: isActive ? `1px solid ${isAll ? 'rgba(27,95,250,0.3)' : 'rgba(255,255,255,0.15)'}` : '1px solid transparent',
                    }}>
                      {acc}
                    </button>
                  )
                })}
              </div>
            )
          })()}
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
        ) : isMobile ? (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {/* Cada columna vacia devuelve null, asi que si NINGUNA pieza pasa el
                filtro no se pintaba absolutamente nada: la pantalla se quedaba en
                blanco y parecia que la app se habia roto o que no habia contenido.
                En escritorio no pasa porque las columnas se ven igual de vacias. */}
            {filteredAgenda.length === 0 && (
              <div className="rounded-2xl px-6 py-10 text-center" style={{background:SURFACE,border:`1px dashed ${BORDER}`}}>
                <div className="font-figtree text-[15px] font-black text-white mb-1.5">Ningún resultado</div>
                <div className="text-[12.5px] mb-5" style={{color:'rgba(255,255,255,0.3)'}}>
                  Hay piezas en el pipeline, pero ninguna encaja con lo que has filtrado.
                </div>
                <button onClick={()=>{ setContentSearch(''); setPlatformFilter('Todas'); setAccountFilter('Todas') }}
                  className="font-syne text-[9px] font-black tracking-widest px-5 py-2.5 rounded-xl"
                  style={{background:`${BLU}14`,border:`1px solid ${BLU}30`,color:BLU}}>QUITAR FILTROS</button>
              </div>
            )}
            {cols.map(col=>{
              const items = filteredAgenda.filter((a: any)=>a.status===col.key)
              if (items.length===0) return null
              return (
                <div key={col.key}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:col.color}}/>
                    <span className="font-syne text-[8px] font-black tracking-widest uppercase" style={{color:'rgba(255,255,255,0.35)'}}>{col.label}</span>
                    <span className="font-syne text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{background:col.color+'15',color:col.color+'90'}}>{items.length}</span>
                  </div>
                  <div className="space-y-2">
                    {items.map((item: any)=>{
                      const ipc = platColor[item.platform]||BLU
                      const isActive = activeItem?.id===item.id
                      return (
                        <div key={item.id} onClick={()=>openItem(item)}
                          className="rounded-2xl overflow-hidden cursor-pointer"
                          style={{background:isActive?'rgba(255,255,255,0.05)':'rgba(255,255,255,0.035)',border:`1px solid ${isActive?ipc+'40':'rgba(255,255,255,0.08)'}`}}>
                          {/* Cover image banner — shown when cover_url exists */}
                          {item.cover_url && (
                            <div className="relative overflow-hidden" style={{height:'90px'}}>
                              <SafeImg src={item.cover_url} className="w-full h-full object-cover" style={{opacity:0.82}}/>
                              <div className="absolute inset-0" style={{background:'linear-gradient(to bottom,rgba(0,0,0,0.1) 0%,rgba(0,0,0,0.65) 100%)'}}/>
                              <div className="absolute bottom-0 left-0 right-0 px-3 pb-2 flex items-end justify-between">
                                <p className="font-figtree text-[12px] font-semibold text-white leading-tight line-clamp-2 flex-1 mr-2">{item.title}</p>
                                <PlatformLogo platform={item.platform} size={13}/>
                              </div>
                            </div>
                          )}
                          <div className="flex items-center gap-2 px-3.5 py-2.5" style={{background:`linear-gradient(90deg,${ipc}1A,${ipc}08)`,borderBottom:`1px solid ${ipc}16`}}>
                            <PlatformLogo platform={item.platform} size={13}/>
                            <span className="font-syne text-[8px] font-black tracking-widest" style={{color:ipc}}>{item.platform.toUpperCase()}</span>
                            {item.account_name && <span className="font-syne text-[7.5px] truncate flex-1" style={{color:`${ipc}65`}}>@{item.account_name}</span>}
                          </div>
                          {!item.cover_url && (
                            <div className="px-3.5 py-2.5">
                              <p className="font-figtree text-[13px] font-semibold leading-snug text-white/80 line-clamp-2">{item.title}</p>
                              {item.publish_date && <p className="font-syne text-[8px] mt-1" style={{color:'rgba(255,255,255,0.3)'}}>{item.publish_date}</p>}
                            </div>
                          )}
                          {item.cover_url && item.publish_date && (
                            <div className="px-3.5 pt-1.5 pb-2.5">
                              <p className="font-syne text-[8px]" style={{color:'rgba(255,255,255,0.3)'}}>{item.publish_date}</p>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
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
                            {/* Mini boceto preview — IG/LinkedIn */}
                            {(item.platform==='Instagram'||item.platform==='LinkedIn') && (()=>{
                              const isIG = item.platform==='Instagram'
                              const coverUrl = item.cover_url || null
                              const acc = item.account_name || 'Brutal Studios'
                              const initial = (acc.trim().charAt(0)||'B').toUpperCase()
                              const ctype = normContentType(item.content_type)
                              if (isIG) {
                                // Reel — formato vertical 9:16
                                if (ctype==='reel') return (
                                  <div className="relative overflow-hidden flex-shrink-0 mx-auto mt-2 rounded-xl" style={{aspectRatio:'9/16',width:'72px',background:coverUrl?'#000':'linear-gradient(180deg,#1a0030,#000)',border:'1px solid rgba(195,53,132,0.25)'}}>
                                    {coverUrl && <SafeImg src={coverUrl} className="absolute inset-0 w-full h-full object-cover" style={{opacity:0.8}}/>}
                                    {/* Overlay top */}
                                    <div className="absolute top-1.5 left-1.5 right-1.5 flex items-center gap-1">
                                      <div className="w-4 h-4 rounded-full overflow-hidden flex-shrink-0" style={{background:'linear-gradient(45deg,#f09433,#dc2743,#bc1888)',padding:'1px'}}><div className="w-full h-full rounded-full bg-black"/></div>
                                      <span className="font-figtree text-[5.5px] font-bold text-white truncate">{acc}</span>
                                    </div>
                                    {/* Right actions */}
                                    <div className="absolute right-1 bottom-8 flex flex-col items-center gap-2">
                                      {['❤️','💬','↗️'].map(e=><span key={e} style={{fontSize:'11px'}}>{e}</span>)}
                                      <div className="w-4 h-4 rounded-sm border border-white/50" style={{background:'#C13584'}}/>
                                    </div>
                                    {/* Bottom */}
                                    <div className="absolute bottom-0 left-0 right-0 px-1.5 pb-1.5" style={{background:'linear-gradient(to top,rgba(0,0,0,0.8),transparent)'}}>
                                      <p className="font-figtree text-[5.5px] font-bold text-white truncate">@{acc}</p>
                                      <p className="font-figtree text-[5px] text-white/70 line-clamp-2 leading-tight mt-0.5">{item.title}</p>
                                      <div className="flex items-center gap-0.5 mt-0.5"><span style={{fontSize:'6px'}}>🎵</span><span className="font-figtree text-[5px] text-white/50 truncate">Audio original</span></div>
                                    </div>
                                    {/* Reel badge */}
                                    <div className="absolute top-1.5 right-1.5"><span className="font-syne text-[4.5px] font-black px-1 py-0.5 rounded" style={{background:'rgba(195,53,132,0.8)',color:'white'}}>REEL</span></div>
                                  </div>
                                )
                                // Story — formato vertical 9:16
                                if (ctype==='story') return (
                                  <div className="relative overflow-hidden flex-shrink-0 mx-auto mt-2 rounded-xl" style={{aspectRatio:'9/16',width:'72px',background:coverUrl?'#000':'linear-gradient(135deg,#6B21A8,#C13584)',border:'1px solid rgba(195,53,132,0.3)'}}>
                                    {coverUrl && <SafeImg src={coverUrl} className="absolute inset-0 w-full h-full object-cover" style={{opacity:0.85}}/>}
                                    {/* Story bars */}
                                    <div className="absolute top-1 left-1 right-1 flex gap-0.5">
                                      {[1,2,3,4,5].map((b,i)=><div key={b} className="flex-1 h-0.5 rounded-full" style={{background:i===0?'white':'rgba(255,255,255,0.38)'}}/>)}
                                    </div>
                                    {/* Account */}
                                    <div className="absolute top-3 left-1.5 flex items-center gap-1">
                                      <div className="w-4 h-4 rounded-full" style={{background:'linear-gradient(45deg,#f09433,#dc2743,#bc1888)',padding:'1px'}}><div className="w-full h-full rounded-full bg-black"/></div>
                                      <span className="font-figtree text-[5px] font-bold text-white">{acc}</span>
                                    </div>
                                    {/* Story content if no image */}
                                    {!coverUrl && <div className="absolute inset-0 flex items-center justify-center p-2"><p className="font-figtree text-[6px] text-white/80 text-center leading-tight line-clamp-4">{item.title}</p></div>}
                                    {/* Bottom message bar */}
                                    <div className="absolute bottom-1.5 left-1 right-1">
                                      <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.18)',border:'1px solid rgba(255,255,255,0.3)'}}>
                                        <span className="font-figtree text-[4.5px] text-white/60 flex-1">Envía mensaje</span>
                                        <span style={{fontSize:'7px'}}>❤️</span>
                                      </div>
                                    </div>
                                    {/* Story badge */}
                                    <div className="absolute top-1.5 right-1"><span className="font-syne text-[4.5px] font-black px-1 py-0.5 rounded" style={{background:'rgba(107,33,168,0.85)',color:'white'}}>STORY</span></div>
                                  </div>
                                )
                                // Post — imagen cuadrada (default)
                                const cardLogoUrl = allAccountLogos[acc] || (() => { try { return localStorage.getItem(`account-logo-${acc}`) || '' } catch { return '' } })()
                                const cardInitial = (acc.trim().charAt(0)||'B').toUpperCase()
                                return (
                                  <div className="relative overflow-hidden flex-shrink-0 mx-2 mt-2 rounded-xl"
                                    style={{aspectRatio:'1/1',maxHeight:'108px',background:coverUrl?'#000':`linear-gradient(135deg,#1a0a1e,#0f0520)`,border:`1px solid rgba(195,53,132,0.2)`}}>
                                    {coverUrl
                                      ? <SafeImg src={coverUrl} className="w-full h-full object-cover" style={{opacity:0.88}}/>
                                      : <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 p-3">
                                          {cardLogoUrl ? <img src={cardLogoUrl} alt={cardInitial} className="w-8 h-8 rounded-full object-cover"/> : <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{background:'rgba(255,255,255,0.1)'}}><span className="font-figtree font-black text-white text-[14px]">{cardInitial}</span></div>}
                                          <p className="font-figtree text-[7.5px] text-center leading-tight line-clamp-3" style={{color:'rgba(255,255,255,0.5)'}}>{item.title}</p>
                                        </div>
                                    }
                                    {coverUrl && (
                                      <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5" style={{background:'linear-gradient(to top,rgba(0,0,0,0.78) 0%,transparent 100%)'}}>
                                        <p className="font-figtree text-[7.5px] leading-tight line-clamp-2" style={{color:'rgba(255,255,255,0.9)'}}><span className="font-semibold">{acc}</span> {item.title}</p>
                                      </div>
                                    )}
                                    <div className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full overflow-hidden border border-white/20 flex items-center justify-center" style={{background:'#111'}}>
                                      {cardLogoUrl ? <img src={cardLogoUrl} alt="" className="w-full h-full object-cover"/> : <span className="font-figtree font-black text-white text-[8px]">{cardInitial}</span>}
                                    </div>
                                    <div className="absolute top-1.5 right-1.5"><span className="font-syne text-[4.5px] font-black px-1 py-0.5 rounded" style={{background:'rgba(0,0,0,0.65)',color:'white'}}>POST</span></div>
                                  </div>
                                )
                              } else {
                                // LinkedIn — texto primero, imagen opcional abajo
                                return (
                                  <div className="flex-shrink-0 mx-2 mt-2 rounded-xl overflow-hidden" style={{background:'#1b1f23',border:'1px solid rgba(10,102,194,0.25)'}}>
                                    <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1">
                                      <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 font-figtree text-[8px] font-bold text-white" style={{background:'#0a66c2'}}>{initial}</div>
                                      <div className="min-w-0">
                                        <p className="font-figtree text-[8px] font-semibold text-white truncate">{acc}</p>
                                        <p className="font-figtree text-[6.5px]" style={{color:'rgba(255,255,255,0.35)'}}>Agencia · Ahora · 🌐</p>
                                      </div>
                                    </div>
                                    <div className="px-2.5 pb-1.5">
                                      <p className="font-figtree text-[8px] leading-snug line-clamp-3" style={{color:'rgba(255,255,255,0.8)'}}>{item.title}</p>
                                    </div>
                                    {coverUrl && <SafeImg src={coverUrl} className="w-full" style={{maxHeight:'52px',objectFit:'cover'}}/>}
                                    <div className="flex items-center gap-1 px-2.5 py-1" style={{borderTop:'1px solid rgba(255,255,255,0.06)'}}>
                                      <span className="text-[8px]">👍</span><span className="text-[8px] -ml-1">❤️</span>
                                      <span className="font-figtree text-[7px] ml-0.5" style={{color:'rgba(255,255,255,0.3)'}}>Recomendar · Comentar</span>
                                    </div>
                                  </div>
                                )
                              }
                            })()}
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
                                  const todayStr2 = todayKey()
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
                                    <button onClick={e=>{e.stopPropagation();changeStatus(item, nextStatus)}} className={`ml-auto flex-shrink-0 font-syne text-[7px] font-black px-2 py-1 rounded-lg transition-all ${isMobile?'opacity-50':'opacity-0 group-hover:opacity-100'}`} style={{background:col.color+'18',color:col.color+'cc',border:`1px solid ${col.color}30`}}>
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
      {activeItem && isMobile && (
        /* ── MOBILE MODAL: full-screen with BOCETO / EDITAR tabs ── */
        <div className="fixed inset-0 z-50 flex flex-col" style={{background:'linear-gradient(160deg,#0E0E20 0%,#07070F 100%)',border:`1px solid ${pc}20`}}>
          {/* Ambient glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 pointer-events-none" style={{width:'90%',height:'120px',background:`radial-gradient(ellipse,${pc}18 0%,transparent 70%)`,filter:'blur(40px)',zIndex:0}}/>

          {/* Header */}
          <div className="flex-shrink-0 relative z-10" style={{paddingTop:'env(safe-area-inset-top)'}}>
            <div className="flex items-center gap-3 px-4 pt-4 pb-2.5">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{background:`${pc}15`,border:`1px solid ${pc}30`}}>
                <PlatformLogo platform={activeItem.platform} size={22}/>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-syne text-[7.5px] font-black tracking-widest" style={{color:`${pc}90`}}>
                  {activeItem.platform.toUpperCase()}{activeItem.account_name ? ` · @${activeItem.account_name}` : ''}
                </div>
                <div className="font-figtree text-[15px] font-bold text-white leading-tight line-clamp-1" style={{letterSpacing:'-0.02em'}}>{activeItem.title}</div>
              </div>
              <button onClick={()=>setActiveItem(null)} className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:'rgba(255,255,255,0.06)',border:`1px solid rgba(255,255,255,0.08)`}}>
                <LucideIcon name="x" size={14} color="rgba(255,255,255,0.4)"/>
              </button>
            </div>
            {/* Status pills */}
            <div className="flex gap-1.5 px-4 pb-3 overflow-x-auto" style={{scrollbarWidth:'none',overflowY:'hidden',touchAction:'pan-x'}}>
              {cols.map(col=>(
                <button key={col.key} onClick={()=>changeStatus(activeItem, col.key)}
                  className="flex items-center gap-1.5 py-1.5 px-3 rounded-xl font-syne text-[7px] font-black tracking-wide transition-all flex-shrink-0 active:opacity-70"
                  style={{
                    background: activeItem.status===col.key ? col.color+'18' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${activeItem.status===col.key ? col.color+'45' : 'rgba(255,255,255,0.06)'}`,
                    color: activeItem.status===col.key ? col.color : 'rgba(255,255,255,0.25)',
                  }}>
                  <div className="w-1 h-1 rounded-full flex-shrink-0" style={{background:activeItem.status===col.key ? col.color : 'rgba(255,255,255,0.15)'}}/>
                  {col.label.toUpperCase()}
                </button>
              ))}
            </div>
            {/* Tab bar */}
            <div className="flex px-4" style={{borderBottom:`1px solid rgba(255,255,255,0.07)`}}>
              {(['boceto','editar'] as const).map(tab=>(
                <button key={tab} onClick={()=>setMobileTab(tab)}
                  className="flex-1 py-2.5 font-syne text-[8.5px] font-black tracking-widest transition-all"
                  style={{
                    color: mobileTab===tab ? pc : 'rgba(255,255,255,0.22)',
                    borderBottom: mobileTab===tab ? `2px solid ${pc}` : '2px solid transparent',
                    marginBottom:'-1px',
                  }}>
                  {tab === 'boceto' ? 'BOCETO' : 'EDITAR'}
                </button>
              ))}
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto relative z-10" style={{paddingBottom:'env(safe-area-inset-bottom)'}}>

            {/* BOCETO TAB */}
            {mobileTab === 'boceto' && (
              <BocetoPanel
                activeItem={activeItem}
                editCoverUrl={editCoverUrl}
                editAccountName={editAccountName}
                accountLogoUrl={accountLogoUrl}
                bocetoCaption={bocetoCaption}
                setBocetoCaption={setBocetoCaption}
                bocetoPlatform={bocetoPlatform}
                setBocetoPlatform={setBocetoPlatform}
                editContentType={editContentType}
                setEditContentType={setEditContentType}
                onSaveCopy={async (caption) => {
                  // Misma cautela que en uploadCover: la pieza se fija al empezar.
                  // Con el panel abierto se salta de pieza con J/K, y el copy de una
                  // se pegaba encima del titulo de la que estuvieras viendo al volver.
                  const idPieza = activeItem?.id
                  if (!idPieza) return
                  try {
                    await data.updateAgenda(idPieza, { title: caption.trim() })
                    showToast('Copy guardado')
                    if (activeItemRef.current?.id !== idPieza) return
                    setActiveItem((a: any) => a ? { ...a, title: caption.trim() } : a)
                    setBocetoCaption(null)
                  } catch { showToast('Error al guardar') }
                }}
              />
            )}

            {/* EDITAR TAB */}
            {mobileTab === 'editar' && (
              <div className="px-4 py-5 space-y-5" onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!savingNotes){e.preventDefault();saveNotes()}}}>

                {/* Formato — solo Instagram */}
                {String(activeItem.platform||'').toLowerCase().includes('instagram') && (
                  <div>
                    <div className="font-syne text-[7px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.2)'}}>FORMATO</div>
                    <div className="flex gap-1.5">
                      {([['publicacion','📷','POST'],['reel','🎬','REEL'],['story','⭕','STORY']] as const).map(([t,icon,label])=>{
                        const on = editContentType===t
                        const c = '#C33584'
                        return (
                          <button key={t} onClick={()=>setEditContentType(t)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-syne text-[7px] font-black tracking-wide transition-all active:opacity-70"
                            style={{background:on?c+'18':'rgba(255,255,255,0.03)',border:`1.5px solid ${on?c+'55':'rgba(255,255,255,0.06)'}`,color:on?c:'rgba(255,255,255,0.35)'}}>
                            <span style={{fontSize:'13px'}}>{icon}</span><span>{label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Portada */}
                <input id={`cover-mob-${activeItem.id}`} ref={coverFileInputRef} type="file" accept="image/*" className="hidden" onChange={e=>{ const f=e.target.files?.[0]; if(f) uploadCover(f); e.target.value='' }}/>
                <div>
                  <div className="font-syne text-[7px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.2)'}}>PORTADA</div>
                  <div className="flex gap-2 mb-2">
                    <input value={editCoverUrl} onChange={e=>setEditCoverUrl(e.target.value)} placeholder="URL de portada…" className="flex-1 px-3 py-2.5 rounded-xl text-[11px] text-white placeholder-white/20 outline-none" style={{background:'rgba(255,255,255,0.04)',border:`1.5px solid rgba(255,255,255,0.07)`,caretColor:BLU,minWidth:0}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.3)')} onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.07)')}/>
                    <label htmlFor={`cover-mob-${activeItem.id}`} className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-syne text-[7.5px] font-black tracking-wide flex-shrink-0 cursor-pointer transition-all active:opacity-60${uploadingCover?' pointer-events-none opacity-50':''}`} style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.45)',border:`1px solid rgba(255,255,255,0.07)`}}>
                      {uploadingCover ? <div className="w-3 h-3 border-2 rounded-full animate-spin flex-shrink-0" style={{borderColor:'rgba(27,95,250,0.3)',borderTopColor:BLU}}/> : <LucideIcon name="image" size={11} color="rgba(255,255,255,0.4)"/>}
                      <span>{uploadingCover?'…':'SUBIR'}</span>
                    </label>
                  </div>
                  {(editCoverUrl || activeItem.cover_url) && (
                    <div className="rounded-xl overflow-hidden" style={{maxHeight:'130px'}}>
                      <SafeImg src={editCoverUrl || activeItem.cover_url} className="w-full" style={{maxHeight:'130px',objectFit:'cover'}}/>
                    </div>
                  )}
                </div>

                {/* Vídeo */}
                <div>
                  <div className="font-syne text-[7px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.2)'}}>VÍDEO</div>
                  <input value={editVideoUrl} onChange={e=>setEditVideoUrl(e.target.value)} placeholder="YouTube · Vimeo · Drive…" className="w-full px-3 py-2.5 rounded-xl text-[11px] text-white placeholder-white/20 outline-none" style={{background:'rgba(255,255,255,0.04)',border:`1.5px solid rgba(255,255,255,0.07)`,caretColor:BLU}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.3)')} onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.07)')}/>
                  {(editVideoUrl || activeItem.video_url) && (
                    <div className="rounded-xl overflow-hidden mt-2">
                      {videoEmbed(editVideoUrl||activeItem.video_url)
                        ? <div style={{aspectRatio:'16/9'}}><iframe src={videoEmbed(editVideoUrl||activeItem.video_url)!} className="w-full h-full" allow="accelerometer;autoplay;encrypted-media;gyroscope;picture-in-picture" allowFullScreen/></div>
                        : <video src={editVideoUrl||activeItem.video_url} controls className="w-full" style={{maxHeight:'180px',objectFit:'contain',background:'#000'}} preload="metadata"/>
                      }
                    </div>
                  )}
                </div>

                {/* Fecha + Hora */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="font-syne text-[7px] font-black tracking-widest mb-1.5" style={{color:'rgba(255,255,255,0.2)'}}>FECHA</div>
                    <input type="date" value={editPublishDate} onChange={e=>setEditPublishDate(e.target.value)} className="w-full px-3 py-2.5 rounded-xl text-[11px] text-white outline-none" style={{background:'rgba(255,255,255,0.04)',border:`1.5px solid rgba(255,255,255,0.07)`,caretColor:BLU,colorScheme:'dark'}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.3)')} onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.07)')}/>
                  </div>
                  <div>
                    <div className="font-syne text-[7px] font-black tracking-widest mb-1.5" style={{color:'rgba(255,255,255,0.2)'}}>HORA</div>
                    <input type="time" value={editPublishTime} onChange={e=>setEditPublishTime(e.target.value)} className="w-full px-3 py-2.5 rounded-xl text-[11px] text-white outline-none" style={{background:'rgba(255,255,255,0.04)',border:`1.5px solid rgba(255,255,255,0.07)`,caretColor:BLU,colorScheme:'dark'}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.3)')} onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.07)')}/>
                  </div>
                </div>

                {/* Cuenta */}
                <input id={`logo-mob-${activeItem.id}`} ref={logoFileInputRef} type="file" accept="image/*" className="hidden" onChange={e=>{ const f=e.target.files?.[0]; if(f) uploadAccountLogo(f); e.target.value='' }}/>
                <div>
                  <div className="font-syne text-[7px] font-black tracking-widest mb-1.5" style={{color:'rgba(255,255,255,0.2)'}}>CUENTA</div>
                  <div className="flex gap-2 items-center">
                    <label htmlFor={`logo-mob-${activeItem.id}`} className="flex-shrink-0 w-10 h-10 rounded-full overflow-hidden relative cursor-pointer active:opacity-70" style={{background:'linear-gradient(45deg,#f09433,#dc2743,#bc1888)',padding:'2px'}}>
                      <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center" style={{background:'#111'}}>
                        {accountLogoUrl ? <img src={accountLogoUrl} alt="" className="w-full h-full object-cover rounded-full"/> : <span className="font-figtree font-black text-white text-[13px]">{(editAccountName.trim().charAt(0)||'B').toUpperCase()}</span>}
                      </div>
                      <div className="absolute inset-0 rounded-full flex items-center justify-center" style={{background:'rgba(0,0,0,0.45)'}}>
                        <LucideIcon name="camera" size={12} color="white"/>
                      </div>
                    </label>
                    <select value={editAccountName} onChange={e=>setEditAccountName(e.target.value)} className="flex-1 px-3 py-2.5 rounded-xl text-[11px] text-white outline-none appearance-none" style={{background:'rgba(255,255,255,0.04)',border:`1.5px solid rgba(255,255,255,0.07)`,colorScheme:'dark'}}>
                      <option value="">Sin asignar</option>
                      {FIXED_ACCOUNTS.map((acc: string)=><option key={acc} value={acc}>{acc}</option>)}
                    </select>
                  </div>
                </div>

                {/* Save + Delete */}
                <div className="flex gap-2">
                  <button onClick={saveNotes} disabled={savingNotes} className="flex-1 py-3 rounded-xl font-syne text-[9px] font-black tracking-wide text-white disabled:opacity-40 transition-opacity active:opacity-70" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>{savingNotes?'GUARDANDO…':'GUARDAR'}</button>
                  {confirmDeleteContent
                    ? <div className="flex items-center gap-1.5">
                        <button onClick={async()=>{try{await data.deleteAgenda(activeItem.id);setActiveItem(null);showToast('Pieza eliminada')}catch{showToast('Error al eliminar')}}} className="px-3 py-3 rounded-xl font-syne text-[8px] font-black" style={{background:'rgba(229,29,42,0.15)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR?</button>
                        <button onClick={()=>setConfirmDeleteContent(false)} className="w-10 h-10 rounded-xl flex items-center justify-center" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={12} color="rgba(255,255,255,0.3)"/></button>
                      </div>
                    : <button onClick={()=>setConfirmDeleteContent(true)} className="w-12 py-3 rounded-xl flex items-center justify-center" style={{color:'rgba(229,29,42,0.4)',border:`1px solid rgba(229,29,42,0.1)`}}>
                        <LucideIcon name="trash" size={14} color="rgba(229,29,42,0.4)"/>
                      </button>
                  }
                </div>

                {/* Notes */}
                <div>
                  <div className="font-syne text-[7px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.2)'}}>NOTAS DE PRODUCCIÓN</div>
                  <textarea value={editNotes} onChange={e=>setEditNotes(e.target.value)} placeholder="Brief, referencias, instrucciones de producción…" rows={4} className="w-full px-3.5 py-3 rounded-xl text-[11px] text-white placeholder-white/20 outline-none resize-none" style={{background:'rgba(255,255,255,0.03)',border:`1.5px solid rgba(255,255,255,0.07)`,caretColor:BLU,lineHeight:'1.65'}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.3)')} onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.07)')}/>
                </div>

                {/* Team opinions */}
                <div className="space-y-3 pb-8">
                  <div className="flex items-center justify-between">
                    <div className="font-syne text-[7px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>EQUIPO</div>
                    {(()=>{ try { const ops=JSON.parse(activeItem.feedback||'[]'); return Array.isArray(ops)&&ops.length>0?<span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full" style={{background:`${BLU}15`,color:`${BLU}bb`}}>{ops.length}</span>:null } catch { return null } })()}
                  </div>
                  {(()=>{ try { const ops=JSON.parse(activeItem.feedback||'[]'); return Array.isArray(ops)&&ops.length>0?(
                    <div className="space-y-2">
                      {(ops as any[]).map((op:any,i:number)=>(
                        <div key={i} className="flex items-start gap-2.5 p-3 rounded-xl" style={{background:'rgba(255,255,255,0.03)',border:`1px solid rgba(255,255,255,0.06)`}}>
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center font-syne text-[8px] font-black flex-shrink-0" style={{background:`${op.color||BLU}18`,color:op.color||BLU}}>{op.initials}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5"><span className="font-figtree text-[11px] font-bold" style={{color:'rgba(255,255,255,0.8)'}}>{op.name}</span>{op.emoji&&<span className="text-[14px] leading-none">{op.emoji}</span>}</div>
                            {op.note&&<p className="font-syne text-[9px] leading-relaxed" style={{color:'rgba(255,255,255,0.4)'}}>{op.note}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ):null } catch { return null } })()}
                  {(()=>{
                    const existing=(() => { try { const p=JSON.parse(activeItem.feedback||'[]'); return Array.isArray(p)?p:[] } catch { return [] } })()
                    const myOp=existing.find((o:any)=>o.userId===profile?.id)
                    return (
                      <div className="rounded-xl overflow-hidden" style={{background:'rgba(255,255,255,0.02)',border:`1px solid rgba(255,255,255,0.07)`}}>
                        <div className="p-3.5">
                          <div className="font-syne text-[7px] font-black tracking-widest mb-2.5" style={{color:'rgba(255,255,255,0.18)'}}>{myOp?'TU OPINIÓN — EDITAR':'AÑADE TU OPINIÓN'}</div>
                          <div className="flex gap-2 mb-3 flex-wrap">
                            {([['🔥','Love'],['👍','Bien'],['🤔','Dudas'],['✏️','Cambios'],['❌','No']] as const).map(([em,label])=>(
                              <button key={em} onClick={()=>setPendingEmoji(em===pendingEmoji?'':em)} className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg transition-all active:opacity-70" style={{background:pendingEmoji===em?'rgba(255,255,255,0.1)':'rgba(255,255,255,0.03)',border:`1px solid ${pendingEmoji===em?'rgba(255,255,255,0.2)':'rgba(255,255,255,0.06)'}`,transform:pendingEmoji===em?'scale(1.08)':'scale(1)'}}>
                                <span className="text-[14px] leading-none">{em}</span>
                                <span className="font-syne text-[6px] font-black tracking-wide mt-0.5" style={{color:pendingEmoji===em?'rgba(255,255,255,0.55)':'rgba(255,255,255,0.22)'}}>{label}</span>
                              </button>
                            ))}
                          </div>
                          <textarea value={pendingNote} onChange={e=>setPendingNote(e.target.value)} placeholder="Tu opinión sobre el contenido…" rows={2} className="w-full px-3 py-2.5 rounded-xl text-[11px] text-white placeholder-white/20 outline-none resize-none" style={{background:'rgba(255,255,255,0.03)',border:`1px solid rgba(255,255,255,0.07)`,caretColor:BLU,lineHeight:'1.6'}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.3)')} onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.07)')}/>
                        </div>
                        <button onClick={saveOpinion} disabled={savingOpinion||(!pendingEmoji&&!pendingNote.trim())} className="w-full py-2.5 font-syne text-[8px] font-black tracking-widest transition-all disabled:opacity-30 active:opacity-70" style={{background:`rgba(27,95,250,0.08)`,color:BLU,borderTop:`1px solid rgba(27,95,250,0.12)`}}>
                          {savingOpinion?'GUARDANDO…':myOp?'ACTUALIZAR':'PUBLICAR'}
                        </button>
                      </div>
                    )
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeItem && !isMobile && (
        /* ── DESKTOP MODAL: two-column layout ── */
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{background:'rgba(0,0,0,0.72)',backdropFilter:'blur(14px)'}}
          onClick={()=>setActiveItem(null)}
        >
          <div
            className="relative w-full flex overflow-hidden"
            style={{maxWidth:'940px',maxHeight:'calc(100vh - 48px)',borderRadius:'28px',background:'linear-gradient(160deg,#0E0E20 0%,#07070F 100%)',border:`1px solid ${pc}22`,boxShadow:`0 60px 120px rgba(0,0,0,0.85),0 0 0 1px rgba(255,255,255,0.04),inset 0 1px 0 rgba(255,255,255,0.05)`}}
            onClick={e=>e.stopPropagation()}
          >
            {/* Ambient glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 pointer-events-none" style={{width:'60%',height:'180px',background:`radial-gradient(ellipse,${pc}1A 0%,transparent 70%)`,filter:'blur(50px)'}}/>

            {/* ── LEFT COLUMN ── */}
            <div className="relative flex flex-col flex-shrink-0 overflow-y-auto" style={{width:'52%',borderRight:`1px solid rgba(255,255,255,0.06)`}}>
              <div className="flex-shrink-0 px-7 pt-7 pb-5" style={{borderBottom:`1px solid rgba(255,255,255,0.06)`}}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <div className="rounded-2xl flex items-center justify-center flex-shrink-0" style={{background:`${pc}15`,border:`1px solid ${pc}25`,width:48,height:48}}>
                      <PlatformLogo platform={activeItem.platform} size={26}/>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-syne text-[9px] font-black tracking-widest" style={{color:pc}}>{activeItem.platform.toUpperCase()}</span>
                        {activeItem.account_name && <span className="font-syne text-[8px]" style={{color:'rgba(255,255,255,0.25)'}}>@{activeItem.account_name}</span>}
                        {activeItem.client && <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full" style={{background:(activeItem.client.color||BLU)+'12',color:(activeItem.client.color||BLU)+'bb'}}>{activeItem.client.name}</span>}
                      </div>
                      <div className="font-figtree text-[16px] font-bold text-white leading-snug" style={{letterSpacing:'-0.02em'}}>{activeItem.title}</div>
                    </div>
                  </div>
                  <button onClick={()=>setActiveItem(null)} className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:'rgba(255,255,255,0.05)',border:`1px solid rgba(255,255,255,0.08)`}}>
                    <LucideIcon name="x" size={13} color="rgba(255,255,255,0.35)"/>
                  </button>
                </div>
                <div className="flex gap-1.5 mt-4 overflow-x-auto" style={{scrollbarWidth:'none'}}>
                  {cols.map(col=>(
                    <button key={col.key} onClick={()=>changeStatus(activeItem, col.key)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-3 px-2.5 rounded-xl font-syne text-[7.5px] font-black tracking-wide transition-all flex-shrink-0 whitespace-nowrap"
                      style={{background:activeItem.status===col.key?col.color+'1A':'rgba(255,255,255,0.04)',border:`1px solid ${activeItem.status===col.key?col.color+'45':'rgba(255,255,255,0.06)'}`,color:activeItem.status===col.key?col.color:'rgba(255,255,255,0.22)'}}>
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:activeItem.status===col.key?col.color:'rgba(255,255,255,0.12)'}}/>
                      {col.label.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-6 space-y-4" onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!savingNotes){e.preventDefault();saveNotes()}}}>
                {String(activeItem.platform||'').toLowerCase().includes('instagram') && (
                  <div>
                    <div className="font-syne text-[8.5px] font-black tracking-widest mb-2.5" style={{color:'rgba(255,255,255,0.2)'}}>TIPO DE CONTENIDO</div>
                    <div className="grid grid-cols-3 gap-2">
                      {([['publicacion','📷','Publicación','Imagen fija en el feed'],['reel','🎬','Reel','Vídeo vertical 9:16'],['story','⭕','Story','Desaparece en 24h']] as const).map(([t,icon,label,desc])=>{
                        const on=editContentType===t
                        const colors: Record<string,string>={publicacion:'#C33584',reel:'#C33584',story:'#6B21A8'}
                        const c=colors[t]
                        return (
                          <button key={t} onClick={()=>setEditContentType(t)} className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-2xl transition-all" style={{background:on?c+'18':'rgba(255,255,255,0.03)',border:`1.5px solid ${on?c+'55':'rgba(255,255,255,0.06)'}`}}>
                            <span style={{fontSize:'20px'}}>{icon}</span>
                            <span className="font-syne text-[9px] font-black tracking-wide" style={{color:on?c:'rgba(255,255,255,0.4)'}}>{label.toUpperCase()}</span>
                            <span className="font-figtree text-[9px] text-center leading-tight" style={{color:'rgba(255,255,255,0.25)'}}>{desc}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="font-syne text-[8.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>VÍDEO</div>
                    <span className="font-syne text-[7px] font-black tracking-wide px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.2)',border:'1px solid rgba(255,255,255,0.07)'}}>YouTube · Vimeo · Drive</span>
                  </div>
                  <div className="flex gap-2 mb-2.5">
                    <input value={editVideoUrl} onChange={e=>setEditVideoUrl(e.target.value)} placeholder="Pega el enlace del vídeo…" className="flex-1 px-3 py-2.5 rounded-xl text-[12px] text-white placeholder-white/20 outline-none" style={{background:'rgba(255,255,255,0.04)',border:`1.5px solid rgba(255,255,255,0.07)`,caretColor:BLU,minWidth:0}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.3)')} onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.07)')}/>
                  </div>
                  {videoEmbed(editVideoUrl)&&<div className="rounded-2xl overflow-hidden" style={{aspectRatio:'16/9',background:'#000'}}><iframe src={videoEmbed(editVideoUrl)!} className="w-full h-full" allow="accelerometer;autoplay;encrypted-media;gyroscope;picture-in-picture" allowFullScreen/></div>}
                  {!videoEmbed(editVideoUrl)&&editVideoUrl&&<div className="rounded-2xl overflow-hidden" style={{background:'#000'}}><video src={editVideoUrl} controls className="w-full rounded-2xl" style={{maxHeight:'240px',objectFit:'contain'}} preload="metadata"/></div>}
                  {!editVideoUrl&&activeItem.video_url&&<div className="rounded-2xl overflow-hidden" style={{background:'#000'}}>{videoEmbed(activeItem.video_url)?<div style={{aspectRatio:'16/9'}}><iframe src={videoEmbed(activeItem.video_url)!} className="w-full h-full" allow="accelerometer;autoplay;encrypted-media;gyroscope;picture-in-picture" allowFullScreen/></div>:<video src={activeItem.video_url} controls className="w-full rounded-2xl" style={{maxHeight:'240px',objectFit:'contain'}} preload="metadata"/>}</div>}
                  {!editVideoUrl&&!activeItem.video_url&&<div className="flex items-center gap-2 rounded-xl p-4" style={{background:'rgba(255,255,255,0.02)',border:`1px dashed rgba(255,255,255,0.07)`}}><LucideIcon name="film" size={14} color="rgba(255,255,255,0.12)"/><span className="font-syne text-[9px]" style={{color:'rgba(255,255,255,0.18)'}}>Pega un enlace de YouTube, Vimeo, Instagram o Drive</span></div>}
                </div>

                {/* Logo de cuenta */}
                <input ref={logoFileInputRef} type="file" accept="image/*" className="hidden" onChange={e=>{ const f=e.target.files?.[0]; if(f) uploadAccountLogo(f); e.target.value='' }}/>

                {/* Cover / Portada */}
                <div>
                  <input ref={coverFileInputRef} type="file" accept="image/*" className="hidden" onChange={e=>{ const f=e.target.files?.[0]; if(f) uploadCover(f); e.target.value='' }}/>
                  <div className="font-syne text-[8.5px] font-black tracking-widest mb-2.5" style={{color:'rgba(255,255,255,0.2)'}}>PORTADA</div>
                  <div className="flex gap-2 mb-2.5">
                    <input value={editCoverUrl} onChange={e=>setEditCoverUrl(e.target.value)} placeholder="URL de portada…" className="flex-1 px-3 py-2.5 rounded-xl text-[12px] text-white placeholder-white/20 outline-none" style={{background:'rgba(255,255,255,0.04)',border:`1.5px solid rgba(255,255,255,0.07)`,caretColor:BLU,minWidth:0}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.3)')} onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.07)')}/>
                    <button onClick={()=>coverFileInputRef.current?.click()} disabled={uploadingCover} className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-syne text-[8px] font-black tracking-wide flex-shrink-0 disabled:opacity-40 transition-all hover:opacity-80" style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.45)',border:`1px solid rgba(255,255,255,0.07)`}}>
                      {uploadingCover?<><div className="w-3 h-3 border-2 rounded-full animate-spin flex-shrink-0" style={{borderColor:'rgba(255,255,255,0.3)',borderTopColor:'white'}}/><span>SUBIENDO…</span></>:<><LucideIcon name="image" size={11} color="rgba(255,255,255,0.4)"/><span>SUBIR</span></>}
                    </button>
                  </div>
                  {(editCoverUrl||activeItem.cover_url)&&<div className="rounded-2xl overflow-hidden" style={{background:'#000'}}><SafeImg src={editCoverUrl||activeItem.cover_url} className="w-full rounded-2xl" style={{maxHeight:'200px',objectFit:'cover'}}/></div>}
                  {!editCoverUrl&&!activeItem.cover_url&&<div className="flex items-center gap-2 rounded-xl p-4" style={{background:'rgba(255,255,255,0.02)',border:`1px dashed rgba(255,255,255,0.07)`}}><LucideIcon name="image" size={14} color="rgba(255,255,255,0.12)"/><span className="font-syne text-[9px]" style={{color:'rgba(255,255,255,0.18)'}}>Sin portada — pega una URL o sube una imagen</span></div>}
                </div>

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
                  <div className="flex gap-2 items-start">
                    <button onClick={()=>logoFileInputRef.current?.click()} className="flex-shrink-0 w-10 h-10 rounded-full overflow-hidden flex items-center justify-center transition-opacity hover:opacity-80 relative group" style={{background:'linear-gradient(45deg,#f09433,#dc2743,#bc1888)',padding:'2px'}}>
                      <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center" style={{background:'#111'}}>
                        {accountLogoUrl?<img src={accountLogoUrl} alt="" className="w-full h-full object-cover rounded-full"/>:<span className="font-figtree font-black text-white text-[14px]">{(editAccountName.trim().charAt(0)||'B').toUpperCase()}</span>}
                      </div>
                      <div className="absolute inset-0 rounded-full flex items-center justify-center transition-opacity opacity-0 group-hover:opacity-100" style={{background:'rgba(0,0,0,0.55)'}}>
                        <LucideIcon name="camera" size={13} color="white"/>
                      </div>
                    </button>
                    <select value={editAccountName} onChange={e=>setEditAccountName(e.target.value)} className="flex-1 px-3 py-2.5 rounded-xl text-[12px] text-white outline-none appearance-none" style={{background:'rgba(255,255,255,0.04)',border:`1.5px solid rgba(255,255,255,0.07)`,colorScheme:'dark'}}>
                      <option value="">Sin asignar</option>
                      {FIXED_ACCOUNTS.map((acc: string)=><option key={acc} value={acc}>{acc}</option>)}
                    </select>
                  </div>
                  <div className="mt-1.5 font-syne text-[7.5px]" style={{color:'rgba(255,255,255,0.2)'}}>Toca el avatar para cambiar la foto de la cuenta</div>
                </div>

                {/* La página pública /review/[token] existía pero su enlace no se
                    generaba en NINGÚN sitio de la app: era inalcanzable, así que
                    la función de revisión con cliente estaba muerta. El token es
                    el propio id de la pieza. */}
                <button
                  onClick={()=>{
                    const url = `${window.location.origin}/review/${activeItem.id}`
                    navigator.clipboard.writeText(url)
                      .then(()=>showToast('Enlace de revisión copiado — mándaselo al cliente'))
                      .catch(()=>showToast(url))
                  }}
                  className="w-full py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest transition-all flex items-center justify-center gap-2"
                  style={{color:'rgba(255,255,255,0.5)',border:`1px solid ${BORDER}`,background:'rgba(255,255,255,0.02)'}}
                >
                  <LucideIcon name="link" size={11} color="rgba(255,255,255,0.5)"/>COPIAR ENLACE PARA EL CLIENTE
                </button>
                <div className="flex gap-2 pt-1">
                  <button onClick={saveNotes} disabled={savingNotes} className="flex-1 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-wide text-white disabled:opacity-40 transition-opacity" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>{savingNotes?'GUARDANDO…':'GUARDAR'}</button>
                  {confirmDeleteContent
                    ? <div className="flex items-center gap-1">
                        <button onClick={async()=>{try{await data.deleteAgenda(activeItem.id);setActiveItem(null);showToast('Pieza eliminada')}catch{showToast('Error al eliminar')}}} className="px-3 py-2.5 rounded-xl font-syne text-[8px] font-black" style={{background:'rgba(229,29,42,0.15)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR?</button>
                        <button onClick={()=>setConfirmDeleteContent(false)} className="w-8 h-8 rounded-xl flex items-center justify-center" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={12} color="rgba(255,255,255,0.3)"/></button>
                      </div>
                    : <button onClick={()=>setConfirmDeleteContent(true)} className="px-4 py-2.5 rounded-xl font-syne text-[9px] font-black transition-all" style={{color:'rgba(229,29,42,0.4)',border:`1px solid rgba(229,29,42,0.1)`}}><LucideIcon name="trash" size={12} color="rgba(229,29,42,0.4)"/></button>
                  }
                </div>
                <div className="nx-kbd-hints flex items-center justify-center gap-2 pb-1">
                  {[['⌘+ENTER','GUARDAR'],['S','ESTADO'],['ESC','CERRAR']].map(([k,l],i,a)=><span key={k} className="flex items-center gap-1.5"><span className="font-syne text-[7px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.09)'}}>{k}</span><span className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.08)'}}>{l}</span>{i<a.length-1&&<span style={{color:'rgba(255,255,255,0.06)'}}>·</span>}</span>)}
                </div>
              </div>
            </div>

            {/* ── RIGHT COLUMN ── */}
            <div className="flex-1 flex flex-col overflow-y-auto">
              <BocetoPanel
                activeItem={activeItem}
                editCoverUrl={editCoverUrl}
                editAccountName={editAccountName}
                accountLogoUrl={accountLogoUrl}
                bocetoCaption={bocetoCaption}
                setBocetoCaption={setBocetoCaption}
                bocetoPlatform={bocetoPlatform}
                setBocetoPlatform={setBocetoPlatform}
                editContentType={editContentType}
                setEditContentType={setEditContentType}
                onSaveCopy={async (caption) => {
                  // Misma cautela que en uploadCover: la pieza se fija al empezar.
                  // Con el panel abierto se salta de pieza con J/K, y el copy de una
                  // se pegaba encima del titulo de la que estuvieras viendo al volver.
                  const idPieza = activeItem?.id
                  if (!idPieza) return
                  try {
                    await data.updateAgenda(idPieza, { title: caption.trim() })
                    showToast('Copy guardado')
                    if (activeItemRef.current?.id !== idPieza) return
                    setActiveItem((a: any) => a ? { ...a, title: caption.trim() } : a)
                    setBocetoCaption(null)
                  } catch { showToast('Error al guardar') }
                }}
              />
              <div className="px-7 pt-7 pb-5 flex-shrink-0" style={{borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
                <div className="font-syne text-[8.5px] font-black tracking-widest mb-2.5" style={{color:'rgba(255,255,255,0.2)'}}>NOTAS DE PRODUCCIÓN</div>
                <textarea value={editNotes} onChange={e=>setEditNotes(e.target.value)} placeholder="Añade notas del equipo, brief de producción, referencias…" rows={5} className="w-full px-4 py-3 rounded-xl text-[12px] text-white placeholder-white/20 outline-none resize-none" style={{background:'rgba(255,255,255,0.03)',border:`1.5px solid rgba(255,255,255,0.07)`,caretColor:BLU,lineHeight:'1.65'}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.3)')} onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.07)')} onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!savingNotes){e.preventDefault();saveNotes()}}}/>
              </div>
              <div className="flex-1 px-7 py-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="font-syne text-[8.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>OPINIONES DEL EQUIPO</div>
                  {(()=>{ try { const ops=JSON.parse(activeItem.feedback||'[]'); return Array.isArray(ops)&&ops.length>0?<span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full" style={{background:`${BLU}15`,color:`${BLU}bb`}}>{ops.length}</span>:null } catch { return null } })()}
                </div>
                {(()=>{ try { const ops=JSON.parse(activeItem.feedback||'[]'); return Array.isArray(ops)&&ops.length>0?(
                  <div className="space-y-2">
                    {(ops as any[]).map((op:any,i:number)=>(
                      <div key={i} className="flex items-start gap-3 p-3.5 rounded-2xl transition-all" style={{background:'rgba(255,255,255,0.03)',border:`1px solid rgba(255,255,255,0.06)`}}>
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center font-syne text-[9px] font-black flex-shrink-0" style={{background:`${op.color||BLU}18`,color:op.color||BLU}}>{op.initials}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap"><span className="font-figtree text-[12px] font-bold" style={{color:'rgba(255,255,255,0.8)'}}>{op.name}</span>{op.emoji&&<span className="text-[16px] leading-none">{op.emoji}</span>}<span className="font-syne text-[7px] ml-auto flex-shrink-0" style={{color:'rgba(255,255,255,0.18)'}}>{op.at?new Date(op.at).toLocaleDateString('es-ES',{day:'numeric',month:'short'}):''}</span></div>
                          {op.note&&<p className="font-syne text-[10px] leading-relaxed" style={{color:'rgba(255,255,255,0.42)'}}>{op.note}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                ):null } catch { return null } })()}
                {(()=>{
                  const existing=(() => { try { const p=JSON.parse(activeItem.feedback||'[]'); return Array.isArray(p)?p:[] } catch { return [] } })()
                  const myOp=existing.find((o:any)=>o.userId===profile?.id)
                  return (
                    <div className="rounded-2xl overflow-hidden" style={{background:'rgba(255,255,255,0.02)',border:`1px solid rgba(255,255,255,0.07)`}}>
                      <div className="p-4">
                        <div className="font-syne text-[7.5px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.18)'}}>{myOp?'TU OPINIÓN — EDITAR':'AÑADE TU OPINIÓN'}</div>
                        <div className="flex gap-2 mb-3 flex-wrap">
                          {([['🔥','Love it'],['👍','Bien'],['🤔','Dudas'],['✏️','Cambios'],['❌','No va']] as const).map(([em,label])=>(
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
