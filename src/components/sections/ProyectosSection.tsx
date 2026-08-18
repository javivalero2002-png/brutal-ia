'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { rutaApp } from '@/lib/appUrl'
import { hayModalAbierto } from '@/components/shared/modalAbierto'
import { useIsMobile, useBackClosable, BLU, RED, GRN, SURFACE, SURF2, BORDER, LucideIcon, ProgressRing, SafeImg, dlDate, dlLabel, todayKey, estadoDeadline, AMBAR } from '@/components/shared'
import { plural } from '@/components/shared/helpers'
import type { Project, Task, Profile, NexusData} from '@/types'
import type { IrASeccion } from '@/components/shared/secciones'

interface PropsProyectos {
  data: NexusData
  filteredProjects: any
  kanbanCols: any
  projView: any
  setProjView: any
  projStatusFilter: any
  setProjStatusFilter: any
  dragRef: any
  selectedId: any
  onSelect: any
  onOpenModal: any
  showToast: any
  isOwner: any
  onNavigate: IrASeccion
  onSelectClient: any
  justCreatedId: any
  onJustCreatedScrolled: any
}

function ProyectosSection({data,filteredProjects,kanbanCols,projView,setProjView,projStatusFilter,setProjStatusFilter,dragRef,selectedId,onSelect,onOpenModal,showToast,isOwner,onNavigate,onSelectClient,justCreatedId,onJustCreatedScrolled}: PropsProyectos) {
  const isMobile = useIsMobile()
  useBackClosable(!!selectedId, () => onSelect(null))
  const [editProgress, setEditProgress] = useState<number|null>(null)
  const [savingProgress, setSavingProgress] = useState(false)
  const [confirmDeleteProjId, setConfirmDeleteProjId] = useState<string|null>(null)
  const [confirmDeleteDetail, setConfirmDeleteDetail] = useState(false)
  // URLs de cover que han fallado al cargar (p.ej. cover_url corrupto apuntando a un PDF)
  const [brokenCovers, setBrokenCovers] = useState<Set<string>>(new Set())
  const markCoverBroken = (url:string) => setBrokenCovers(prev => prev.has(url) ? prev : new Set(prev).add(url))
  const [projSearch, setProjSearch] = useState('')
  const [projListSort, setProjListSort] = useState<'default'|'deadline'|'progress'|'status'>('default')
  const [quickProjTask, setQuickProjTask] = useState('')
  const [quickProjCreating, setQuickProjCreating] = useState(false)
  // Project notes
  const [projNotes, setProjNotes] = useState<any[]>([])
  const [noteText, setNoteText] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [notesLoaded, setNotesLoaded] = useState<string|null>(null)
  // Project milestones
  const [milestones, setMilestones] = useState<any[]>([])
  const [msText, setMsText] = useState('')
  const [msDate, setMsDate] = useState('')
  const [msAdding, setMsAdding] = useState(false)
  const [msLoaded, setMsLoaded] = useState<string|null>(null)
  const selectedProject: Project|null = selectedId ? data.projects.find((p: Project)=>p.id===selectedId)||null : null
  const projViewRef = useRef<'board'|'list'>('board')
  projViewRef.current = projView
  const selectedProjectRef = useRef<Project|null>(null)

  // Force list view on mobile — kanban columns don't fit 375px
  useEffect(()=>{
    if (isMobile) setProjView('list')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile])
  selectedProjectRef.current = selectedProject
  const progressInputRef = useRef<HTMLInputElement>(null)
  const detailPanelRef = useRef<HTMLDivElement>(null)

  const loadProjectExtras = useCallback(async (pid: string) => {
    // Un fallo de carga se pintaba como "sin notas" / "sin hitos", asi que se
    // volvian a escribir y quedaban duplicados al recargar.
    let fallo = false
    const pedir = (url: string) => fetch(url).then(r => { if (!r.ok) throw new Error('carga'); return r.json() }).catch(() => { fallo = true; return [] })
    const [nr, mr] = await Promise.all([
      pedir(`/api/projects/${pid}/notes`),
      pedir(`/api/projects/${pid}/milestones`),
    ])
    // Solo se pinta si sigues en el proyecto que lo pidio. Mismo patron que ya
    // usan onPickPdf y analyzePdf en este fichero: abrir el proyecto A y saltar al
    // B antes de que responda dejaba dos peticiones en vuelo, y si la de A llegaba
    // la ultima el panel de B mostraba las notas y los HITOS de A. Y como
    // notesLoaded acababa valiendo A mientras selectedId era B, las deps no
    // cambiaban y no se corregia: se leian el brief y las fechas de entrega de otro
    // proyecto. Al tocar uno de esos hitos, el PATCH iba contra B con el id de A y
    // fallaba sin explicar por que.
    if (selectedProjectRef.current?.id !== pid) return
    if (fallo) showToast('No se pudieron cargar las notas o los hitos del proyecto')
    setProjNotes(Array.isArray(nr)?nr:[])
    setMilestones(Array.isArray(mr)?mr:[])
    setNotesLoaded(pid)
    setMsLoaded(pid)
  }, [])

  useEffect(()=>{
    if (selectedId && selectedId !== notesLoaded) {
      loadProjectExtras(selectedId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // Scroll to detail panel on mobile when a project is selected
  useEffect(()=>{
    if (selectedId && isMobile) {
      setTimeout(()=>detailPanelRef.current?.scrollIntoView({behavior:'smooth',block:'start'}), 200)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // ── Documento IA (subir PDF directo a Supabase + análisis + chat) ──
  // `url` es lo que se PINTA; `ident` es lo que se manda al SERVIDOR.
  //
  // Son dos cosas distintas y confundirlas rompe una u otra. Lo que se pinta tiene
  // que poder abrirse en el navegador —con el bucket cerrado eso obliga a firma, o
  // a /api/archivo, que la pide fresca—. Lo que se manda a /api/projects/analyze-pdf
  // tiene que pasar su `isOwnStorageUrl` (analyze-pdf/route.ts:65), y un enlace de
  // brutalia.tech NO lo pasa: envolver la URL sin separar los papeles arregla el
  // visor y estropea el chat sobre el PDF.
  //
  // Cuando el dato viene de la base (:154) ya llega firmado, asi que `ident` no
  // hace falta: `ident || url` devuelve la firmada, y rutaDeStorage() la resuelve
  // igual porque su patron acepta /object/sign/ ademas de /object/public/.
  type PdfDoc = { name: string; url: string; ident?: string }
  const [pdfDoc, setPdfDoc] = useState<PdfDoc|null>(null)
  const [pdfAnalysis, setPdfAnalysis] = useState<any>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfUploadPct, setPdfUploadPct] = useState<number|null>(null)
  const [pdfChat, setPdfChat] = useState<{role:'user'|'ai'; content:string}[]>([])
  // El chat del PDF tampoco bajaba a la ultima respuesta. Mismo gemelo del scroll
  // de ChatSection. Nombre propio: `pdfChatRef` ya existe y apunta a los DATOS del
  // chat, no al contenedor.
  const pdfScrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const c = pdfScrollRef.current
    if (!c) return
    const irAlFinal = () => { c.scrollTop = c.scrollHeight }
    irAlFinal()
    const t = setTimeout(irAlFinal, 60)
    return () => clearTimeout(t)
  }, [pdfChat])
  const [pdfQ, setPdfQ] = useState('')
  const [pdfChatBusy, setPdfChatBusy] = useState(false)
  const [showPdfViewer, setShowPdfViewer] = useState(false)
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const pdfSectionRef = useRef<HTMLDivElement>(null)

  // Cache PDF state per project so switching projects doesn't lose the analysis
  type PdfCache = { doc: PdfDoc|null; analysis: any; chat: {role:'user'|'ai';content:string}[] }
  const pdfCacheRef = useRef<Map<string, PdfCache>>(new Map())
  const pdfDocRef = useRef(pdfDoc); pdfDocRef.current = pdfDoc
  const pdfAnalysisRef = useRef(pdfAnalysis); pdfAnalysisRef.current = pdfAnalysis
  const pdfChatRef = useRef(pdfChat); pdfChatRef.current = pdfChat
  const prevSelectedIdRef = useRef<string|null>(null)
  useEffect(()=>{
    // Save outgoing project state
    const prev = prevSelectedIdRef.current
    if (prev) pdfCacheRef.current.set(prev, { doc: pdfDocRef.current, analysis: pdfAnalysisRef.current, chat: pdfChatRef.current })
    prevSelectedIdRef.current = selectedId
    // Restore incoming project state
    const cached = selectedId ? pdfCacheRef.current.get(selectedId) : undefined
    if (cached) {
      setPdfDoc(cached.doc)
      setPdfAnalysis(cached.analysis)
      setPdfChat(cached.chat)
    } else {
      // Fallback: restore from DB (survives full navigation away y recarga)
      const proj = selectedId ? (data.projects as Project[]).find(p => p.id === selectedId) : null
      setPdfDoc(proj?.pdf_url ? { name: 'Documento adjunto', url: proj.pdf_url } : null)
      // El análisis se guarda en projects.pdf_analysis (JSON) para sobrevivir a la sesión
      let restored: any = null
      if ((proj as any)?.pdf_analysis) { try { restored = JSON.parse((proj as any).pdf_analysis) } catch {} }
      setPdfAnalysis(restored)
      setPdfChat([])
    }
    setPdfQ('')
    // Si la respuesta de Claude sobre el PDF anterior sigue en vuelo, askPdf ya no
    // la aplicará (comprueba el proyecto al volver): el `busy` se limpia aquí, que es
    // donde se sabe que el chat que entra no está esperando a nadie. Sin esto, el
    // input del proyecto nuevo se quedaba bloqueado hasta un minuto.
    setPdfChatBusy(false)
    setPdfUploadPct(null)
    setShowPdfViewer(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])
  // Save state when navigating away from the section (component unmounts)
  useEffect(()=>{
    return () => {
      const cur = prevSelectedIdRef.current
      if (cur) pdfCacheRef.current.set(cur, { doc: pdfDocRef.current, analysis: pdfAnalysisRef.current, chat: pdfChatRef.current })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(()=>{
    if (justCreatedId && justCreatedId === selectedId && pdfSectionRef.current) {
      const t = setTimeout(()=>{ pdfSectionRef.current?.scrollIntoView({behavior:'smooth',block:'center'}); onJustCreatedScrolled?.() }, 300)
      return () => clearTimeout(t)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justCreatedId, selectedId])

  // Extract first PDF page as JPEG blob (client-side, pdfjs-dist)
  const extractPdfCover = async (file: File): Promise<Blob | null> => {
    try {
      const pdfjsLib = await import('pdfjs-dist')
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
      const buf = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise
      const page = await pdf.getPage(1)
      const viewport = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')!
      await page.render({ canvasContext: ctx as any, viewport, canvas }).promise
      return await new Promise<Blob | null>(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', 0.82))
    } catch { return null }
  }

  const uploadCoverBlob = async (blob: Blob, projectId: string): Promise<string | null> => {
    try {
      const urlRes = await fetch('/api/pdf-upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: `cover-${projectId}.jpg`, size: blob.size, prefix: 'project-covers' }) })
      const urlJ = await urlRes.json().catch(() => ({}))
      if (!urlRes.ok) return null
      const fd = new FormData()
      fd.append('cacheControl', '3600')
      fd.append('', blob, 'cover.jpg')
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.onload = () => xhr.status < 300 ? resolve() : reject()
        xhr.onerror = reject
        xhr.open('PUT', urlJ.signedUrl)
        xhr.send(fd)
      })
      return urlJ.publicUrl
    } catch { return null }
  }

  // `proyectoId` entra por parametro y no se lee del ref al final: el analisis es
  // una llamada a Claude de hasta 60 segundos, y en ese hueco da tiempo de sobra a
  // cambiar de proyecto. Se persistia en el que estuvieras mirando al terminar.
  const analyzePdf = async (pdfUrl: string, proyectoId: string) => {
    setPdfBusy(true)
    try {
      const nombre = data.projects?.find((p: Project) => p.id === proyectoId)?.name
      const res = await fetch('/api/projects/analyze-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pdfUrl,projectName:nombre}),signal:AbortSignal.timeout(60000)})
      const j = await res.json().catch(()=>({}))
      if (!res.ok) { showToast(j.error||'Error al analizar'); return }
      if (selectedProjectRef.current?.id === proyectoId) setPdfAnalysis(j.analysis)
      // Persistir el análisis en el proyecto para que sobreviva a la sesión.
      // Aislado y best-effort: si la columna pdf_analysis aún no existe en la BD,
      // el fallo no debe afectar al guardado de pdf_url ni romper el flujo.
      const pid = proyectoId
      if (pid && j.analysis) {
        fetch(`/api/projects/${pid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pdf_analysis: JSON.stringify(j.analysis) }) }).catch(() => {})

        // Y TAMBIÉN a Memoria. El análisis se quedaba solo dentro del proyecto:
        // había que saber que existía ese proyecto y entrar a mirarlo, no salía al
        // buscar en Memoria, y sobre todo Harvey no lo veía — así que lo que la
        // app acababa de aprender de un contrato no lo sabía nadie más.
        //
        // El coste es CERO: se guarda el análisis que ya se ha pagado, no se
        // vuelve a leer el PDF.
        const a = j.analysis
        const proy = data.projects?.find((p: Project) => p.id === pid)
        const ficha = [
          a.data?.client ? `Cliente: ${a.data.client}` : '',
          a.data?.budget ? `Presupuesto: ${a.data.budget}` : '',
          a.data?.dates ? `Fechas: ${a.data.dates}` : '',
          a.data?.scope ? `Alcance: ${a.data.scope}` : '',
        ].filter(Boolean).join(' · ')
        const puntos = (a.keyPoints || []).slice(0, 5).map((p: string) => `· ${p}`).join('\n')

        data.createMemoria?.({
          title: `${nombre || 'Proyecto'} — documento`,
          category: 'Documento',
          // Enlazada al cliente del proyecto: es el que ya sabemos con certeza,
          // mejor que el nombre que haya leído la IA dentro del PDF.
          ...(proy?.client_id ? { client_id: proy.client_id } : {}),
          content: [
            a.summary || '',
            ficha,
            puntos,
            `📎 Documento: ${rutaApp('/api/archivo?u=' + encodeURIComponent(pdfUrl))}`,
          ].filter(Boolean).join('\n\n'),
        })?.catch?.(() => { /* la nota es un extra: si falla, el análisis del proyecto sigue guardado */ })
      }
    } catch { showToast('Error al analizar el PDF') }
    finally { setPdfBusy(false) }
  }

  const onPickPdf = async (file: File) => {
    if (file.type !== 'application/pdf') { showToast('Solo archivos PDF'); return }
    if (file.size > 50 * 1024 * 1024) { showToast('PDF muy grande (máx. 50 MB)'); return }
    // El proyecto se fija AQUI, al empezar.
    //
    // Subir + extraer portada + analizar con Claude son varios segundos, a veces
    // mas de medio minuto. El id se leia al FINAL, de selectedProjectRef.current,
    // asi que si cambiabas de proyecto mientras tanto el contrato se adjuntaba al
    // proyecto que estuvieras mirando en ese momento — sin ningun aviso.
    const proyectoId = selectedProjectRef.current?.id
    if (!proyectoId) { showToast('Abre un proyecto antes de subir el PDF'); return }
    setPdfDoc(null); setPdfAnalysis(null); setPdfChat([]); setPdfUploadPct(0)
    try {
      // 1. Pedir signed upload URL al servidor
      const urlRes = await fetch('/api/pdf-upload-url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:file.name,size:file.size,prefix:'pdfs'})})
      const urlJ = await urlRes.json().catch(()=>({}))
      if (!urlRes.ok) { showToast(urlJ.error||'Error preparando subida'); setPdfUploadPct(null); return }
      // 2. Subir el archivo directamente a Supabase con XMLHttpRequest para el progreso
      // Supabase signed upload URL espera FormData con cacheControl + el archivo en key ''
      const fd = new FormData()
      fd.append('cacheControl', '3600')
      fd.append('', file)
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = e => { if (e.lengthComputable) setPdfUploadPct(Math.round(e.loaded/e.total*100)) }
        xhr.onload = () => xhr.status < 300 ? resolve() : reject(new Error(`Upload ${xhr.status}`))
        xhr.onerror = () => reject(new Error('Error de red'))
        xhr.open('PUT', urlJ.signedUrl)
        xhr.send(fd)
      })
      setPdfUploadPct(100)
      // Los setters de aqui pintan el panel que se este viendo: si ya no es el
      // proyecto de la subida, no se tocan.
      // `urlJ.publicUrl` es el IDENTIFICADOR que se guarda en la columna, no una
      // direccion que se pueda abrir con el bucket cerrado. Pintarla directamente
      // daba 400 en los tres sitios que la usan, y no se arreglaba solo: el efecto
      // que recompone pdfDoc desde la base depende de [selectedId], que no cambia
      // al subir, y ademas pdfCacheRef restaura la copia vieja por delante.
      if (selectedProjectRef.current?.id === proyectoId) setPdfDoc({
        name: file.name,
        // RELATIVA, no rutaApp(). Esto es un enlace para la pagina que el usuario
        // YA tiene abierta, asi que tiene que apuntar al host desde el que la abrio.
        // `rutaApp()` cablea NEXT_PUBLIC_APP_URL en el bundle, y la app se sirve en
        // DOS hosts a proposito (CLAUDE.md 3-bis: brutalia.tech y el .vercel.app
        // viejo, para no dejar fuera a quien tenga la PWA instalada). Las cookies de
        // Supabase son host-only, asi que cruzar de origen = /api/archivo no ve
        // sesion = 401 en los tres consumidores, y el <iframe> ademas lo bloquea la
        // CSP. El fallo es simetrico: da igual que valor tenga la variable, siempre
        // rompe a la mitad de la plantilla.
        url: '/api/archivo?u=' + encodeURIComponent(urlJ.publicUrl),
        ident: urlJ.publicUrl,
      })
      // 3. Extraer portada (cliente) + analizar en paralelo
      const [coverBlob] = await Promise.all([
        extractPdfCover(file),
        analyzePdf(urlJ.publicUrl, proyectoId),
      ])
      // 4. Guardar pdf_url siempre; cover_url solo si la extracción funcionó
      {
        const projUpdates: Record<string, string> = { pdf_url: urlJ.publicUrl }
        if (coverBlob) {
          const coverUrl = await uploadCoverBlob(coverBlob, proyectoId)
          if (coverUrl) projUpdates.cover_url = coverUrl
        }
        // Sin este aviso, el PDF se subía y su enlace no quedaba guardado en el
        // proyecto: al recargar, el documento y su análisis habían desaparecido y
        // nadie sabía por qué.
        data.updateProject(proyectoId, projUpdates)
          .catch(() => showToast('El PDF se subió pero no se pudo guardar en el proyecto'))
      }
    } catch { showToast('Error subiendo el PDF') }
    finally { setPdfUploadPct(null) }
  }

  // El proyecto se fija AQUI, al empezar, igual que en analyzePdf y onPickPdf. La
  // peticion lleva AbortSignal.timeout(60000): hasta un minuto pidiendole a Claude
  // que lea un contrato, tiempo de sobra para cambiar de proyecto. Los setPdfChat de
  // despues del await escriben en el chat que este EN PANTALLA, y el efecto de
  // arriba guarda ese chat en pdfCacheRef del proyecto abierto — asi que la
  // respuesta sobre el contrato de A se colgaba del chat de B y ademas se persistia
  // en su cache. La pregunta y el `busy` iniciales van antes del await, o sea que
  // esos si son del proyecto correcto.
  const askPdf = async () => {
    const q = pdfQ.trim(); if (!q || !pdfDoc || pdfChatBusy) return
    const proyectoId = selectedProjectRef.current?.id
    const vigente = () => selectedProjectRef.current?.id === proyectoId
    setPdfQ(''); setPdfChat(c=>[...c,{role:'user',content:q}]); setPdfChatBusy(true)
    try {
      const res = await fetch('/api/projects/analyze-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pdfUrl:pdfDoc.ident||pdfDoc.url,question:q}),signal:AbortSignal.timeout(60000)})
      const j = await res.json().catch(()=>({}))
      if (!vigente()) return
      setPdfChat(c=>[...c,{role:'ai',content: res.ok ? (j.answer||'—') : (j.error||'Error al responder')}])
    } catch { if (vigente()) setPdfChat(c=>[...c,{role:'ai',content:'Error de conexión'}]) }
    // `pdfChatBusy` no esta cacheado por proyecto, es uno solo para toda la seccion:
    // liberarlo aqui desde una respuesta que ya no toca dejaria el input del proyecto
    // nuevo escribiendo mientras "responde". Al cambiar de proyecto lo resetea el
    // efecto de [selectedId], que es quien sabe que el chat de destino no espera nada.
    finally { if (vigente()) setPdfChatBusy(false) }
  }

  useEffect(() => { setEditProgress(null); setConfirmDeleteDetail(false); setQuickProjTask('') }, [selectedId])

  useEffect(()=>{
    const handler = (e: KeyboardEvent) => {
      // Con un modal abierto el foco esta en BODY, asi que la guarda por tagName
      // de mas abajo no protege: escribir en el formulario ejecutaba estos atajos.
      if (hayModalAbierto()) return
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

  const addNote = async () => {
    if (!noteText.trim() || !selectedProject) return
    setNoteSaving(true)
    try {
      const res = await fetch(`/api/projects/${selectedProject.id}/notes`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({content:noteText.trim()}) })
      const note = await res.json()
      if (!res.ok) throw new Error(note.error)
      setProjNotes(n=>[note,...n])
      setNoteText('')
      showToast('Nota añadida')
    } catch { showToast('Error al guardar nota') }
    finally { setNoteSaving(false) }
  }

  // `fetch` NO lanza con 4xx/5xx: solo si se cae la red. Sin mirar r.ok, un 500 del
  // servidor quitaba la nota de la pantalla igualmente y reaparecia al recargar —
  // la app decia que habia borrado algo que seguia ahi.
  const deleteNote = async (noteId: string) => {
    if (!selectedProject) return
    try {
      const r = await fetch(`/api/projects/${selectedProject.id}/notes?noteId=${noteId}`, { method:'DELETE' })
      if (!r.ok) {
        const e = await r.json().catch(()=>({}))
        showToast(e.error || 'No se pudo eliminar la nota')
        return
      }
      setProjNotes(n=>n.filter(x=>x.id!==noteId))
    } catch { showToast('Error al eliminar nota') }
  }

  const addMilestone = async () => {
    // `msAdding` como guarda, no solo como indicador. El campo se envia con Enter,
    // y pulsarlo dos veces seguidas creaba el hito DUPLICADO: la segunda pulsacion
    // entraba antes de que la primera hubiera vaciado msText. Es el mismo guard
    // que ya tienen postComment, sendMessage y addMember.
    if (msAdding) return
    if (!msText.trim() || !selectedProject) return
    setMsAdding(true)
    try {
      const res = await fetch(`/api/projects/${selectedProject.id}/milestones`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name:msText.trim(),due_date:msDate||null}) })
      const ms = await res.json()
      if (!res.ok) throw new Error(ms.error)
      setMilestones(m=>[...m, ms])
      setMsText(''); setMsDate('')
    } catch { showToast('Error al crear hito') }
    finally { setMsAdding(false) }
  }

  const toggleMilestone = async (ms: any) => {
    if (!selectedProject) return
    try {
      const res = await fetch(`/api/projects/${selectedProject.id}/milestones`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({milestoneId:ms.id,done:!ms.done}) })
      const updated = await res.json()
      // Mismo caso que las subtareas: el cuerpo del error sustituia al hito.
      if (!res.ok) { showToast(updated?.error || 'No se pudo actualizar el hito'); return }
      setMilestones(m=>m.map(x=>x.id===ms.id?updated:x))
    } catch { showToast('Error al actualizar el hito') }
  }

  // Quitar el documento tiene que ESCRIBIRSE. Antes el boton solo limpiaba el
  // estado local: pdf_url y pdf_analysis seguian en la base de datos y el efecto
  // de [selectedId] los restauraba al recargar. El PDF que creias haber quitado
  // volvia a estar ahi — y son contratos y presupuestos.
  //
  // cover_url se limpia con ellos porque es la portada extraida del propio PDF
  // (se rellena en onPickPdf y solo si la extraccion funciono): dejarla apuntando
  // a un documento que ya no esta es dejar una imagen huerfana.
  //
  // El fichero del bucket no se borra: `content-videos` es publico y sus URLs
  // estan guardadas como cadenas en varias tablas, asi que tocarlo es harina de
  // otro costal. Aqui se desvincula del proyecto, que es lo que promete el boton.
  const quitarDocumento = async () => {
    if (!selectedProject) return
    try {
      await data.updateProject(selectedProject.id, { pdf_url: null, pdf_analysis: null, cover_url: null } as any)
      setPdfDoc(null); setPdfAnalysis(null); setPdfChat([])
      showToast('Documento quitado')
    } catch {
      showToast('No se pudo quitar el documento')
    }
  }

  const deleteMilestone = async (msId: string) => {
    if (!selectedProject) return
    try {
      const r = await fetch(`/api/projects/${selectedProject.id}/milestones?milestoneId=${msId}`, { method:'DELETE' })
      if (!r.ok) {
        const e = await r.json().catch(()=>({}))
        showToast(e.error || 'No se pudo eliminar el hito')
        return
      }
      setMilestones(m=>m.filter(x=>x.id!==msId))
    } catch { showToast('Error al eliminar hito') }
  }

  const saveProgress = async () => {
    if (!selectedProject || editProgress === null) return
    setSavingProgress(true)
    try {
      await data.updateProject(selectedProject.id, { progress: editProgress })
      showToast('Progreso actualizado')
    } catch { showToast('Error') }
    finally { setSavingProgress(false) }
  }

  const statusTabs: {id:string;label:string;short:string}[] = [
    {id:'Todos',      label:'Todos',        short:'Todos'},
    {id:'plan.',      label:'Planificación', short:'Plan.'},
    {id:'activo',     label:'Activo',       short:'Activo'},
    {id:'urgente',    label:'Urgente',      short:'Urg.'},
    {id:'revisión',   label:'Revisión',     short:'Rev.'},
    {id:'completado', label:'Completado',   short:'Hecho'},
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
  const statusColor = (s: string) => s==='urgente'?RED:s==='activo'?GRN:s==='revisión'?'#A78BFA':s==='completado'?'#22C55E':BLU
  const listProjectsSorted: Project[] = (()=>{
    const baseL = filteredProjects.filter((p: Project)=>!projSearch.trim()||p.name.toLowerCase().includes(projSearch.toLowerCase())||(p.client as any)?.name?.toLowerCase().includes(projSearch.toLowerCase()))
    if (projListSort==='progress') return [...baseL].sort((a:Project,b:Project)=>b.progress-a.progress)
    if (projListSort==='deadline') return [...baseL].sort((a:Project,b:Project)=>{const da=a.deadline&&a.deadline!=='TBD'?dlDate(a.deadline).getTime():Infinity;const db=b.deadline&&b.deadline!=='TBD'?dlDate(b.deadline).getTime():Infinity;return da-db})
    if (projListSort==='status') return [...baseL].sort((a:Project,b:Project)=>{const o:Record<string,number>={urgente:0,activo:1,'revisión':2,'plan.':3,completado:4};return (o[a.status]??3)-(o[b.status]??3)})
    return baseL
  })()

  return (
    <div className={isMobile?'p-4':'p-8'}>
      <div className={`flex items-end justify-between ${isMobile?'mb-5':'mb-8'} flex-wrap gap-3`}>
        <div>
          <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-2" style={{color:'rgba(255,255,255,0.18)'}}>GESTIÓN</div>
          <h1 className="font-figtree text-[26px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Proyectos</h1>
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
          {!isMobile && (
          <div className="flex p-1 rounded-xl" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            {(['board','list'] as const).map(v=>(
              <button key={v} onClick={()=>setProjView(v)} className="px-3 py-2 rounded-lg font-syne text-[9px] font-black tracking-wide transition-all" style={{background:projView===v?SURF2:'transparent',color:projView===v?'rgba(255,255,255,0.9)':'rgba(240,240,248,0.3)'}}>
                {v==='board'?'TABLERO':'LISTA'}
              </button>
            ))}
          </div>
          )}
          <button onClick={()=>onOpenModal('proyecto')} className="flex items-center gap-2 px-5 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>+ PROYECTO</button>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        {/* `max-w-full` recortaba la fila sin dejar desplazarla: en móvil el
            último filtro ("Hecho") quedaba fuera de pantalla y era IMPOSIBLE
            filtrar por proyectos completados. Con overflow-x-auto se alcanza
            deslizando, igual que las pestañas de Operativa. */}
        <div className="flex items-center gap-1 p-1 rounded-2xl max-w-full overflow-x-auto"
             style={{background:SURFACE,border:`1px solid ${BORDER}`,scrollbarWidth:'none',WebkitOverflowScrolling:'touch' as any}}>
          {statusTabs.map(s=>{
            const cnt = s.id==='Todos' ? data.projects.length : data.projects.filter((p: Project)=>p.status===s.id).length
            return (
            <button key={s.id} onClick={()=>setProjStatusFilter(s.id)} className="flex items-center gap-1.5 rounded-xl font-syne font-black tracking-wide transition-all flex-shrink-0" style={{padding:isMobile?'6px 8px':'8px 16px',fontSize:'9px',flex:isMobile?'1 1 0':'none',background:projStatusFilter===s.id?SURF2:'transparent',color:projStatusFilter===s.id?'rgba(255,255,255,0.9)':'rgba(240,240,248,0.28)',whiteSpace:'nowrap',justifyContent:'center'}}>
              {(isMobile ? s.short : s.label).toUpperCase()}
              {cnt > 0 && <span className="text-[7.5px] font-black opacity-60 ml-1">{cnt}</span>}
            </button>
          )})}
        </div>
        {/* En móvil el buscador se comprimía hasta que su texto se quedaba en
            "Busc". `basis-full` lo baja a su propia línea; en escritorio sigue
            compartiendo fila con los filtros. */}
        <div className="basis-full md:basis-auto flex-1 min-w-0 flex items-center gap-2 px-3 py-2 rounded-2xl" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
          <LucideIcon name="search" size={12} color="rgba(255,255,255,0.2)"/>
          <input value={projSearch} onChange={e=>setProjSearch(e.target.value)} placeholder="Busca proyecto…" className="bg-transparent text-[12px] outline-none flex-1 min-w-0" style={{caretColor:BLU,color:'rgba(255,255,255,0.75)'}}/>
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
                    {p.cover_url && !brokenCovers.has(p.cover_url) ? (
                      <div className="relative w-full overflow-hidden" style={{height:'88px'}}>
                        <SafeImg src={p.cover_url} className="w-full h-full object-cover object-top" style={{filter:'brightness(0.75)'}} onErrorHide={()=>markCoverBroken(p.cover_url!)}/>
                        <div className="absolute inset-0" style={{background:`linear-gradient(to bottom,transparent 40%,${SURF2}ee)`}}/>
                        <div className="absolute bottom-0 inset-x-0 px-3 pb-2 flex items-center gap-2">
                          <ProgressRing pct={p.progress} size={22} stroke={2} color={p.color||BLU}/>
                          <span className="font-syne text-[7px] font-black" style={{color:p.color||'rgba(255,255,255,0.6)'}}>{p.progress}%</span>
                        </div>
                      </div>
                    ) : (
                      <div style={{height:'3px',background:`linear-gradient(90deg,${p.color||BLU}90,${p.color||BLU}20,transparent)`}}/>
                    )}
                    <div className="p-4">
                      <div className={`flex items-start gap-3 ${p.cover_url ? 'mb-2' : 'mb-3'}`}>
                        {!p.cover_url && (
                          <div className="relative flex-shrink-0">
                            <ProgressRing pct={p.progress} size={36} stroke={2.5} color={p.color||BLU}/>
                            <div className="absolute inset-0 flex items-center justify-center font-syne text-[7.5px] font-black" style={{color:p.color||'rgba(255,255,255,0.5)'}}>{p.progress}</div>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-figtree text-[13px] font-semibold leading-snug mb-0.5" style={{color:'rgba(240,240,248,0.9)'}}>{p.name}</div>
                          <div className="text-[10px]" style={{color:'rgba(255,255,255,0.28)'}}>{p.client?.name||'—'}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {p.deadline && p.deadline!=='TBD' && (()=>{
                          // Sin el `!`: estadoDeadline devuelve null con los deadlines
                          // heredados en texto libre ('ago 2026'), y la guarda de arriba
                          // solo excluye '' y 'TBD'. El `!` se lo callaba ante tsc y aqui
                          // reventaba el render de la FILA — o sea la seccion entera, via
                          // SectionErrorBoundary. dlLabel si sabe enseñar el texto original.
                          const dl = estadoDeadline(p.deadline)
                          if (!dl) return <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.45)'}}>{dlLabel(p.deadline)}</span>
                          const dOver = dl.vencido, dSoon = dl.pronto, dLabel = dl.etiqueta
                          return <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full" style={{background:dOver?`${RED}18`:dSoon?'rgba(255,176,32,0.12)':'rgba(255,255,255,0.04)',color:dOver?RED:dSoon?AMBAR:'rgba(255,255,255,0.3)'}}>{dLabel}</span>
                        })()}
                        {(()=>{ const n=data.tasks.filter((t:Task)=>t.project_id===p.id&&!t.done).length; if(n>0) return <span className="font-syne text-[7.5px] font-black px-1.5 py-0.5 rounded-full" style={{background:'rgba(27,95,250,0.08)',color:'rgba(100,140,255,0.65)'}}>{plural(n,'tarea')}</span>; if(p.status!=='completado'&&p.status!=='plan.') return <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full" style={{background:'rgba(255,176,32,0.07)',color:'rgba(255,176,32,0.5)'}}>sin tareas</span>; return null })()}
                      </div>
                    </div>
                  </div>
                ))}
                {col.items.length===0&&<div className="py-8 text-center text-[11px]" style={{color:'rgba(255,255,255,0.22)'}}>Arrastra aquí</div>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
          {listProjectsSorted.map((p: Project, i: number, arr: Project[])=>{
            // showCover: solo mostramos la banda de cover si existe, no está rota y el proyecto no está expandido
            const showCover = isMobile && !!p.cover_url && !brokenCovers.has(p.cover_url) && selectedId !== p.id
            return (
            <div key={p.id} onClick={()=>onSelect(selectedId===p.id?null:p.id)} className="group cursor-pointer transition-colors" style={{borderBottom:i<arr.length-1?`1px solid ${BORDER}`:'none',background:selectedId===p.id?`${p.color||BLU}08`:'transparent'}}
              onMouseEnter={e=>{ if(selectedId!==p.id)(e.currentTarget.style.background='rgba(255,255,255,0.015)') }}
              onMouseLeave={e=>{ if(selectedId!==p.id)(e.currentTarget.style.background='transparent') }}>
              {/* Cover banner – mobile only when cover_url available and not already shown in detail drawer */}
              {showCover && (
                <div className="relative w-full overflow-hidden" style={{height:'110px'}}>
                  <SafeImg src={p.cover_url} className="w-full h-full object-cover object-center" onErrorHide={()=>markCoverBroken(p.cover_url!)}/>
                  <div className="absolute inset-0" style={{background:'linear-gradient(to bottom,rgba(10,10,20,0.1) 0%,rgba(10,10,20,0.88) 100%)'}}/>
                  <div className="absolute bottom-0 left-0 right-0 px-4 pb-2.5 flex items-end justify-between">
                    <div>
                      <div className="font-figtree text-[15px] font-bold text-white leading-tight">{p.name}</div>
                      <div className="font-figtree text-[11px] mt-0.5" style={{color:'rgba(255,255,255,0.45)'}}>{p.client?.name||'—'}</div>
                    </div>
                    <span className="font-syne text-[7.5px] font-black px-2 py-0.5 rounded-full flex-shrink-0 ml-2" style={{background:statusColor(p.status)+'22',color:statusColor(p.status),border:`1px solid ${statusColor(p.status)}40`}}>{statusLabel(p.status)}</span>
                  </div>
                </div>
              )}
              <div className={`flex items-center gap-4 py-3 transition-colors${isMobile?' px-4 flex-wrap gap-y-1.5':' px-6 py-4'}`} style={{borderLeft:`3px solid ${(()=>{
                if (selectedId===p.id) return p.color||BLU
                if (!p.deadline||p.deadline==='TBD'||p.status==='completado') return (p.color||BLU)+'35'
                const dOver = dlDate(p.deadline)<new Date()
                const dSoon = !dOver && dlDate(p.deadline)<new Date(Date.now()+7*24*3600*1000)
                return dOver ? `${RED}75` : dSoon ? 'rgba(255,176,32,0.55)' : (p.color||BLU)+'35'
              })()}`}}>
              <div className="relative flex-shrink-0">
                <ProgressRing pct={p.progress} size={34} stroke={2.5} color={p.color||BLU}/>
                <div className="absolute inset-0 flex items-center justify-center font-syne text-[7.5px] font-black" style={{color:'rgba(255,255,255,0.5)'}}>{p.progress}</div>
              </div>
              {!showCover && (
                <div className="flex-1 min-w-0" style={isMobile?{flexBasis:'calc(100% - 60px)'}:undefined}>
                  <div className="font-figtree text-[14px] font-semibold text-white/88 truncate">{p.name}</div>
                  <div className="text-[11px] mt-0.5 truncate" style={{color:'rgba(255,255,255,0.3)'}}>{p.client?.name||'—'}</div>
                </div>
              )}
              {showCover && <div className="flex-1 min-w-0"/>}
              {!showCover && <span className="font-syne text-[8px] font-black px-2.5 py-1 rounded-full flex-shrink-0" style={{background:statusColor(p.status)+'14',color:statusColor(p.status)}}>{statusLabel(p.status)}</span>}
              {p.deadline && p.deadline!=='TBD' && (()=>{
                const dl = estadoDeadline(p.deadline)
                if (!dl) return <span className="font-syne text-[9px] font-black flex-shrink-0 px-1.5 py-0.5 rounded-full" style={{background:'transparent',color:'rgba(255,255,255,0.45)'}}>{dlLabel(p.deadline)}</span>
                const dOver = dl.vencido, dSoon = dl.pronto, dLabel = dl.etiqueta
                return <span className="font-syne text-[9px] font-black flex-shrink-0 px-1.5 py-0.5 rounded-full" style={{background:dOver?`${RED}18`:dSoon?'rgba(255,176,32,0.1)':'transparent',color:dOver?RED:dSoon?AMBAR:'rgba(255,255,255,0.28)'}}>{dLabel}</span>
              })()}
              {(()=>{ const n=data.tasks.filter((t:Task)=>t.project_id===p.id&&!t.done).length; if(n>0) return <span className="font-syne text-[7.5px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:'rgba(27,95,250,0.08)',color:'rgba(100,140,255,0.55)'}}>{n}t</span>; if(p.status!=='completado'&&p.status!=='plan.') return <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:'rgba(255,176,32,0.07)',color:'rgba(255,176,32,0.5)'}}>SIN TAREAS</span>; return null })()}
              {isOwner && (
                confirmDeleteProjId === p.id
                  ? <div className="flex items-center gap-1 flex-shrink-0" onClick={e=>e.stopPropagation()}>
                      <button onClick={()=>{ data.deleteProject(p.id).then(()=>showToast('Proyecto eliminado')).catch(()=>showToast('Error al eliminar')); setConfirmDeleteProjId(null) }} className="px-2 py-1 rounded-lg font-syne text-[7.5px] font-black" style={{background:'rgba(229,29,42,0.15)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR?</button>
                      <button onClick={()=>setConfirmDeleteProjId(null)} className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/5" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={10} color="rgba(255,255,255,0.3)"/></button>
                    </div>
                  : <button onClick={e=>{e.stopPropagation();setConfirmDeleteProjId(p.id)}} title="Eliminar proyecto" aria-label={`Eliminar el proyecto ${p.name}`} className={`transition-opacity flex-shrink-0 ${isMobile?'opacity-25':'opacity-0 group-hover:opacity-60'}`}><LucideIcon name="trash" size={13} color={RED}/></button>
              )}
              </div>{/* end inner flex row */}
            </div>
            )
          })}
          {listProjectsSorted.length===0&&(
            projSearch
              ? <div className="py-16 text-center text-[13px]" style={{color:'rgba(255,255,255,0.18)'}}>Sin resultados</div>
              : <div className="py-14 flex flex-col items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.07)'}}>
                    <LucideIcon name="folder-open" size={22} color="rgba(255,255,255,0.15)"/>
                  </div>
                  <div className="text-center">
                    <div className="font-syne text-[9px] font-black tracking-widest mb-1.5" style={{color:'rgba(255,255,255,0.18)'}}>SIN PROYECTOS</div>
                    <div className="text-[12px]" style={{color:'rgba(255,255,255,0.22)'}}>Crea tu primer proyecto para empezar a organizar el trabajo</div>
                  </div>
                  <button onClick={()=>onOpenModal?.('proyecto')} className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-syne text-[8.5px] font-black tracking-widest text-white transition-all hover:opacity-80" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
                    <LucideIcon name="plus" size={12} color="white"/>NUEVO PROYECTO
                  </button>
                </div>
          )}
        </div>
      )}

      {/* Project detail drawer */}
      {selectedProject && (
        <div ref={detailPanelRef} className={`mt-6 rounded-2xl overflow-hidden transition-all`} style={{background:SURFACE,border:`1px solid ${selectedProject.color||BLU}30`,boxShadow:`0 0 40px ${selectedProject.color||BLU}0D`}}>
          {/* Cover banner — se oculta completo (incluido el label) si la cover está rota */}
          {selectedProject.cover_url && !brokenCovers.has(selectedProject.cover_url) && (
            <div className="relative w-full overflow-hidden" style={{height:isMobile?'160px':'180px'}}>
              <SafeImg src={selectedProject.cover_url} className="w-full h-full object-cover object-center" onErrorHide={()=>markCoverBroken(selectedProject.cover_url!)}/>
              <div className="absolute inset-0" style={{background:'linear-gradient(to bottom,rgba(10,10,20,0.05) 0%,rgba(10,10,20,0.55) 85%,rgba(10,10,20,0.75) 100%)'}}/>
              <div className="absolute bottom-3 left-4 flex items-center gap-1.5">
                <LucideIcon name="file-text" size={10} color="rgba(255,255,255,0.55)"/>
                <span className="font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.5)'}}>PDF ADJUNTO</span>
              </div>
            </div>
          )}
          <div className={`${isMobile?'p-4':'p-6'}`}>
          <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
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
                    const dl = estadoDeadline(selectedProject.deadline)
                    if (!dl) return <span className="flex items-center gap-1.5 font-syne text-[8px] font-black px-2 py-1 rounded-full" style={{background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.45)'}}>Deadline {dlLabel(selectedProject.deadline)}</span>
                    const dOver = dl.vencido, dSoon = dl.pronto, daysLabel = dl.etiquetaLarga
                    return (
                      <span className="flex items-center gap-1.5 font-syne text-[8px] font-black px-2 py-1 rounded-full" style={{background:dOver?`${RED}18`:dSoon?'rgba(255,176,32,0.1)':'rgba(255,255,255,0.04)',color:dOver?RED:dSoon?AMBAR:'rgba(255,255,255,0.3)'}}>
                        {dOver&&'⚠ '}Deadline {fmtDate(selectedProject.deadline)}
                        <span className="font-black" style={{color:dOver?RED+'cc':dSoon?'rgba(255,176,32,0.7)':'rgba(255,255,255,0.2)',opacity:0.9}}>· {daysLabel}</span>
                      </span>
                    )
                  })()}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={()=>{ onOpenModal('tarea', {cliente:selectedProject.client?.name||''}) }} className="flex items-center gap-2 px-3 py-2 rounded-xl font-syne text-[8.5px] font-black tracking-wide transition-all" style={{background:'rgba(27,95,250,0.08)',color:BLU,border:`1px solid rgba(27,95,250,0.18)`}}>
                <LucideIcon name="plus" size={11} color={BLU}/>TAREA
              </button>
              {isOwner && (
                confirmDeleteDetail
                  ? <div className="flex items-center gap-1">
                      <button onClick={()=>data.deleteProject(selectedProject.id).then(()=>{onSelect(null);showToast('Proyecto eliminado')}).catch(()=>showToast('Error al eliminar'))} className="px-2.5 py-2 rounded-xl font-syne text-[8px] font-black transition-all" style={{background:'rgba(229,29,42,0.15)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR?</button>
                      <button onClick={()=>setConfirmDeleteDetail(false)} className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={12} color="rgba(255,255,255,0.3)"/></button>
                    </div>
                  : <button onClick={()=>setConfirmDeleteDetail(true)} title="Eliminar proyecto" aria-label="Eliminar este proyecto" className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5" style={{background:'rgba(229,29,42,0.06)',color:'rgba(229,29,42,0.45)',border:`1px solid rgba(229,29,42,0.12)`}}>
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
              {([{s:'plan.',l:'Planif.',c:'#FFFFFF'},{s:'activo',l:'Activo',c:GRN},{s:'urgente',l:'Urgente',c:RED},{s:'revisión',l:'Revisión',c:'#A78BFA'},{s:'completado',l:'Completado',c:GRN}] as {s:Project['status'];l:string;c:string}[]).map(opt=>(
                <button key={opt.s} onClick={async()=>{ try{await data.updateProject(selectedProject.id,{status:opt.s});showToast(`Estado: ${opt.l}`)}catch{showToast('Error al actualizar')} }} className="px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all" style={{background:selectedProject.status===opt.s?opt.c+'18':SURF2,border:`1px solid ${selectedProject.status===opt.s?opt.c+'50':BORDER}`,color:selectedProject.status===opt.s?opt.c:'#FFFFFF'}}>{opt.l.toUpperCase()}</button>
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
            // El guard de client_id es necesario: si el proyecto no tiene cliente,
            // `null === null` haría match con todas las tareas sueltas del estudio.
            const projTasks = data.tasks.filter((t: Task) => !t.done && (t.project_id === selectedProject.id || (!!selectedProject.client_id && t.client_id === selectedProject.client_id)))
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
                      const tc = t.level==='urgent'?RED:t.level==='high'?AMBAR:BLU
                      const ptodayStr = todayKey()
                      const ptIsToday = t.due_date && t.due_date.slice(0,10) === ptodayStr
                      const ptOver = t.due_date && !ptIsToday && new Date(t.due_date+'T23:59:59') < new Date()
                      return (
                        <div key={t.id} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{background:tc+'10',border:`1px solid ${tc}25`}}>
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:tc}}/>
                          <span className="text-[11.5px] flex-1 truncate" style={{color:'rgba(255,255,255,0.65)'}}>{t.text}</span>
                          {t.due_date && <span className="font-syne text-[7.5px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:ptIsToday?'rgba(255,176,32,0.15)':ptOver?`${RED}18`:'rgba(255,255,255,0.05)',color:ptIsToday?AMBAR:ptOver?RED:'rgba(255,255,255,0.25)'}}>{ptIsToday?'HOY':new Date(t.due_date+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'})}</span>}
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
          <div ref={pdfSectionRef} className="mt-5 pt-5" style={{borderTop:`1px solid ${BORDER}`}}>
            <div className="flex items-center gap-2 mb-3">
              <div className="font-syne text-[8px] font-black tracking-widest flex-shrink-0" style={{color:'rgba(255,255,255,0.2)'}}>DOCUMENTO · ANÁLISIS IA</div>
              {pdfDoc && <>
                <span className="font-syne text-[7.5px] truncate" style={{color:'rgba(255,255,255,0.3)',maxWidth:'140px'}}>{pdfDoc.name}</span>
                <div className="flex items-center gap-1 ml-auto flex-shrink-0">
                  {isMobile ? (
                    <a href={pdfDoc.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-syne text-[7.5px] font-black tracking-wide"
                      style={{background:`${BLU}14`,border:`1px solid ${BLU}30`,color:BLU}}>
                      <LucideIcon name="external-link" size={10} color={BLU}/> ABRIR
                    </a>
                  ) : (
                    <button onClick={()=>setShowPdfViewer(v=>!v)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-syne text-[7.5px] font-black tracking-wide transition-all"
                      style={{background:showPdfViewer?`${BLU}20`:`${BLU}10`,border:`1px solid ${showPdfViewer?BLU+'55':BLU+'25'}`,color:showPdfViewer?BLU:'rgba(100,149,255,0.7)'}}>
                      <LucideIcon name={showPdfViewer ? 'eye-off' : 'eye'} size={10} color={showPdfViewer?BLU:'rgba(100,149,255,0.7)'}/>
                      {showPdfViewer ? 'OCULTAR' : 'VER PDF'}
                    </button>
                  )}
                </div>
              </>}
            </div>

            {/* ── PDF INLINE VIEWER ── */}
            {pdfDoc && showPdfViewer && !isMobile && (
              <div className="mb-3 rounded-2xl overflow-hidden" style={{border:`1px solid ${BORDER}`,background:'rgba(255,255,255,0.02)'}}>
                <div className="flex items-center justify-between px-4 py-2.5" style={{borderBottom:`1px solid ${BORDER}`,background:'rgba(255,255,255,0.02)'}}>
                  <span className="font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.25)'}}>VISTA PREVIA</span>
                  <a href={pdfDoc.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 font-syne text-[7.5px] font-black tracking-wide transition-opacity hover:opacity-70"
                    style={{color:`${BLU}cc`}}>
                    <LucideIcon name="external-link" size={9} color={`${BLU}cc`}/> ABRIR EN NUEVA PESTAÑA
                  </a>
                </div>
                <iframe
                  src={`${pdfDoc.url}#toolbar=1&navpanes=0&scrollbar=1`}
                  title="Vista previa del documento"
                  className="w-full"
                  style={{height:'520px',border:'none',display:'block'}}
                />
              </div>
            )}

            <input id={`pdf-input-${selectedProject?.id||'new'}`} ref={pdfInputRef} type="file" accept="application/pdf" onChange={e=>{const f=e.target.files?.[0]; if(f) onPickPdf(f); e.target.value=''}} style={{display:'none'}}/>
            {pdfUploadPct !== null ? (
              /* Subida en progreso */
              <div className="w-full flex flex-col items-center gap-3 py-6 rounded-2xl" style={{background:'rgba(255,255,255,0.02)',border:`1px dashed ${BORDER}`}}>
                <div className="w-full px-4">
                  <div className="flex justify-between mb-1.5">
                    <span className="font-syne text-[8px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.35)'}}>SUBIENDO PDF…</span>
                    <span className="font-syne text-[8px] font-black" style={{color:BLU}}>{pdfUploadPct}%</span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{background:'rgba(255,255,255,0.06)'}}>
                    <div className="h-full rounded-full transition-all duration-200" style={{width:`${pdfUploadPct}%`,background:`linear-gradient(90deg,${BLU},#4f8fff)`}}/>
                  </div>
                </div>
                <span className="font-figtree text-[11px]" style={{color:'rgba(255,255,255,0.25)'}}>Subida directa a Supabase — sin límite de tamaño</span>
              </div>
            ) : !pdfDoc ? (
              <label htmlFor={`pdf-input-${selectedProject?.id||'new'}`} className="w-full flex flex-col items-center gap-2 py-6 rounded-2xl cursor-pointer transition-all active:opacity-70" style={{background:'rgba(255,255,255,0.02)',border:`1px dashed ${BORDER}`,display:'flex',flexDirection:'column',alignItems:'center'}}>
                <LucideIcon name="upload" size={18} color={BLU}/>
                <span className="font-figtree text-[12px]" style={{color:'rgba(255,255,255,0.5)'}}>Sube un PDF y la IA lo analiza</span>
                <span className="font-syne text-[7px] tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>HASTA 50 MB · RESUMEN · PUNTOS · ACCIONES · DATOS · CHAT</span>
              </label>
            ) : (
              <div className="space-y-3">
                {pdfBusy && !pdfAnalysis && (
                  <div className="flex items-center gap-2 py-5 justify-center">
                    <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{borderColor:'rgba(255,255,255,0.15)',borderTopColor:BLU}}/>
                    <span className="font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.4)'}}>ANALIZANDO DOCUMENTO…</span>
                  </div>
                )}
                {!pdfBusy && !pdfAnalysis && pdfDoc && (
                  <div className="flex gap-2">
                    <button onClick={()=>{ if (selectedProject) analyzePdf(pdfDoc.ident||pdfDoc.url, selectedProject.id) }} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl transition-all active:opacity-70" style={{background:`${BLU}12`,border:`1px solid ${BLU}30`}}>
                      <LucideIcon name="sparkles" size={14} color={BLU}/>
                      <span className="font-syne text-[8px] font-black tracking-widest" style={{color:BLU}}>ANALIZAR DOCUMENTO</span>
                    </button>
                    <label htmlFor={`pdf-input-${selectedProject?.id||'new'}`} className="flex items-center justify-center gap-1.5 px-3 py-3 rounded-xl cursor-pointer transition-all active:opacity-70" style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`}}>
                      <LucideIcon name="upload" size={13} color="rgba(255,255,255,0.4)"/>
                      <span className="font-syne text-[8px] font-black tracking-wide" style={{color:'rgba(255,255,255,0.4)'}}>REEMPLAZAR</span>
                    </label>
                  </div>
                )}
                {pdfAnalysis && (<>
                  {/* Resumen ejecutivo */}
                  {pdfAnalysis.summary && (
                    <div className="rounded-2xl p-4" style={{background:'rgba(27,95,250,0.06)',border:`1px solid rgba(27,95,250,0.18)`}}>
                      <div className="flex items-center gap-2 mb-3">
                        <LucideIcon name="sparkles" size={12} color={BLU}/>
                        <span className="font-syne text-[8px] font-black tracking-widest" style={{color:'rgba(120,155,255,0.85)'}}>RESUMEN EJECUTIVO</span>
                      </div>
                      <p className="font-figtree text-[13px] leading-[1.7]" style={{color:'rgba(255,255,255,0.8)'}}>{pdfAnalysis.summary}</p>
                    </div>
                  )}
                  {/* Datos clave como chips visuales */}
                  {pdfAnalysis.data && (pdfAnalysis.data.client||pdfAnalysis.data.budget||pdfAnalysis.data.dates||pdfAnalysis.data.scope) && (
                    <div className="flex flex-wrap gap-2">
                      {pdfAnalysis.data.client && (
                        <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl" style={{background:`${BLU}10`,border:`1px solid ${BLU}25`}}>
                          <LucideIcon name="building-2" size={11} color={BLU}/>
                          <span className="font-syne text-[9px] font-black" style={{color:`${BLU}dd`}}>Cliente</span>
                          <span className="font-figtree text-[11px]" style={{color:'rgba(255,255,255,0.75)'}}>{pdfAnalysis.data.client}</span>
                        </div>
                      )}
                      {pdfAnalysis.data.budget && (
                        <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl" style={{background:'rgba(34,197,94,0.08)',border:'1px solid rgba(34,197,94,0.2)'}}>
                          <LucideIcon name="euro" size={11} color="rgba(34,197,94,0.85)"/>
                          <span className="font-syne text-[9px] font-black" style={{color:'rgba(34,197,94,0.7)'}}>Presupuesto</span>
                          <span className="font-figtree text-[11px]" style={{color:'rgba(255,255,255,0.75)'}}>{pdfAnalysis.data.budget}</span>
                        </div>
                      )}
                      {pdfAnalysis.data.dates && (
                        <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl" style={{background:'rgba(167,139,250,0.08)',border:'1px solid rgba(167,139,250,0.2)'}}>
                          <LucideIcon name="calendar" size={11} color="rgba(167,139,250,0.85)"/>
                          <span className="font-syne text-[9px] font-black" style={{color:'rgba(167,139,250,0.7)'}}>Plazos</span>
                          <span className="font-figtree text-[11px]" style={{color:'rgba(255,255,255,0.75)'}}>{pdfAnalysis.data.dates}</span>
                        </div>
                      )}
                      {pdfAnalysis.data.scope && (
                        <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl" style={{background:'rgba(255,176,32,0.08)',border:'1px solid rgba(255,176,32,0.2)'}}>
                          <LucideIcon name="target" size={11} color="rgba(255,176,32,0.85)"/>
                          <span className="font-syne text-[9px] font-black" style={{color:'rgba(255,176,32,0.7)'}}>Alcance</span>
                          <span className="font-figtree text-[11px]" style={{color:'rgba(255,255,255,0.75)'}}>{pdfAnalysis.data.scope}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Entregables */}
                  {Array.isArray(pdfAnalysis.data?.deliverables) && pdfAnalysis.data.deliverables.length > 0 && (
                    <div className="rounded-2xl p-4" style={{background:'rgba(255,255,255,0.02)',border:`1px solid ${BORDER}`}}>
                      <div className="font-syne text-[7.5px] font-black tracking-widest mb-2.5" style={{color:'rgba(255,255,255,0.2)'}}>ENTREGABLES</div>
                      <div className="flex flex-wrap gap-1.5">
                        {pdfAnalysis.data.deliverables.map((d:string,i:number)=>(
                          <span key={i} className="flex items-center gap-1 font-syne text-[9px] font-black px-2.5 py-1 rounded-lg" style={{background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.55)',border:'1px solid rgba(255,255,255,0.06)'}}>
                            <span style={{color:`${BLU}80`}}>·</span>{d}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className={`grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
                    {/* Puntos clave */}
                    {pdfAnalysis.keyPoints?.length>0 && (
                      <div className="rounded-2xl p-4" style={{background:'rgba(255,255,255,0.02)',border:`1px solid ${BORDER}`}}>
                        <div className="font-syne text-[7.5px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.2)'}}>PUNTOS CLAVE</div>
                        <div className="space-y-2.5">
                          {pdfAnalysis.keyPoints.slice(0,8).map((k:string,i:number)=>(
                            <div key={i} className="flex items-start gap-2.5">
                              <span className="font-syne text-[8px] font-black flex-shrink-0 mt-0.5 px-1.5 py-0.5 rounded" style={{background:`${BLU}15`,color:`${BLU}cc`}}>{String(i+1).padStart(2,'0')}</span>
                              <span className="font-figtree text-[12px] leading-snug" style={{color:'rgba(255,255,255,0.65)'}}>{k}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Acciones */}
                    {pdfAnalysis.actions?.length>0 && (
                      <div className="rounded-2xl p-4" style={{background:'rgba(34,197,94,0.03)',border:`1px solid rgba(34,197,94,0.12)`}}>
                        <div className="font-syne text-[7.5px] font-black tracking-widest mb-3" style={{color:'rgba(34,197,94,0.6)'}}>ACCIONES → CREA TAREA</div>
                        <div className="space-y-2">
                          {pdfAnalysis.actions.slice(0,6).map((a:string,i:number)=>(
                            <button key={i} onClick={async()=>{try{await data.createTask({text:a,level:'normal',project_id:selectedProject.id,client_id:selectedProject.client_id||undefined,source:'ai'});showToast('Tarea creada ✓')}catch{showToast('Error')}}}
                              className="w-full text-left flex items-start gap-2.5 px-3 py-2.5 rounded-xl transition-all hover:bg-white/5 group"
                              style={{border:'1px solid rgba(34,197,94,0.08)'}}>
                              <LucideIcon name="plus-circle" size={13} color="rgba(34,197,94,0.5)"/>
                              <span className="font-figtree text-[12px] leading-snug flex-1" style={{color:'rgba(255,255,255,0.65)'}}>{a}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Riesgos */}
                  {pdfAnalysis.risks?.length>0 && (
                    <div className="rounded-2xl p-4" style={{background:'rgba(229,29,42,0.04)',border:'1px solid rgba(229,29,42,0.12)'}}>
                      <div className="flex items-center gap-2 mb-3">
                        <LucideIcon name="alert-triangle" size={11} color="rgba(229,29,42,0.6)"/>
                        <span className="font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(229,29,42,0.5)'}}>RIESGOS IDENTIFICADOS</span>
                      </div>
                      <div className="space-y-2">
                        {pdfAnalysis.risks.map((r:string,i:number)=>(
                          <div key={i} className="flex items-start gap-2.5">
                            <div className="w-1 h-1 rounded-full flex-shrink-0 mt-2" style={{background:'rgba(229,29,42,0.5)'}}/>
                            <span className="font-figtree text-[12px] leading-snug" style={{color:'rgba(255,255,255,0.6)'}}>{r}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="rounded-2xl overflow-hidden" style={{background:'rgba(255,255,255,0.02)',border:`1px solid ${BORDER}`}}>
                    <div className="px-4 py-2.5 font-syne text-[7.5px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.25)',borderBottom:`1px solid ${BORDER}`}}>PREGUNTA AL DOCUMENTO</div>
                    {pdfChat.length>0 && (
                      <div ref={pdfScrollRef} className="px-4 py-3 space-y-2.5 overflow-y-auto" style={{maxHeight:'220px'}}>
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
                  <div className="flex gap-3">
                    <label htmlFor={`pdf-input-${selectedProject?.id||'new'}`} className="flex-1 py-2 font-syne text-[8px] font-black tracking-widest cursor-pointer text-center transition-opacity active:opacity-60" style={{color:'rgba(255,255,255,0.25)'}}>REEMPLAZAR PDF</label>
                    <button onClick={quitarDocumento} className="flex-1 py-2 font-syne text-[8px] font-black tracking-widest transition-opacity hover:opacity-60" style={{color:'rgba(255,255,255,0.2)'}}>QUITAR DOCUMENTO</button>
                  </div>
                </>)}
              </div>
            )}
          {/* ── HITOS ── */}
          <div className="mt-5 pt-5" style={{borderTop:`1px solid ${BORDER}`}}>
            <div className="font-syne text-[8px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.2)'}}>HITOS</div>
            {milestones.length > 0 && (
              <div className="space-y-2 mb-3">
                {milestones.map((ms: any)=>(
                  <div key={ms.id} className="flex items-center gap-2.5 group">
                    <button onClick={()=>toggleMilestone(ms)} className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-all" style={{background:ms.done?(selectedProject!.color||BLU):'transparent',borderColor:ms.done?(selectedProject!.color||BLU):(selectedProject!.color||BLU)+'55'}}>
                      {ms.done&&<LucideIcon name="check" size={9} color="white"/>}
                    </button>
                    <span className="flex-1 text-[12.5px]" style={{color:ms.done?'#FFFFFF':'rgba(255,255,255,0.75)',textDecoration:ms.done?'line-through':'none'}}>{ms.name}</span>
                    {ms.due_date&&<span className="font-syne text-[8px] font-black" style={{color:'rgba(255,255,255,0.25)'}}>{new Date(ms.due_date+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'})}</span>}
                    <button onClick={()=>deleteMilestone(ms.id)} aria-label="Eliminar hito" className="opacity-50 md:opacity-0 md:group-hover:opacity-60 transition-opacity flex-shrink-0">
                      <LucideIcon name="x" size={11} color={RED}/>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input value={msText} onChange={e=>setMsText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&msText.trim())addMilestone()}} placeholder="Nuevo hito…" className="flex-1 bg-transparent text-[11.5px] outline-none px-3 py-2 rounded-xl" style={{caretColor:selectedProject!.color||BLU,color:'rgba(255,255,255,0.6)',border:`1px solid ${BORDER}`}}/>
              <input type="date" value={msDate} onChange={e=>setMsDate(e.target.value)} className="bg-transparent text-[11px] outline-none px-2 py-2 rounded-xl" style={{color:'rgba(255,255,255,0.4)',border:`1px solid ${BORDER}`,caretColor:BLU,width:'120px'}}/>
              <button onClick={addMilestone} disabled={!msText.trim()||msAdding} className="w-8 h-8 rounded-xl flex items-center justify-center disabled:opacity-30 transition-all" style={{background:(selectedProject!.color||BLU)+'20',border:`1px solid ${(selectedProject!.color||BLU)}40`}} aria-label="Añadir"><LucideIcon name="plus" size={13} color={selectedProject!.color||BLU}/></button>
            </div>
            {milestones.length > 0 && (
              <div className="mt-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <div className="h-1 flex-1 rounded-full overflow-hidden" style={{background:'rgba(255,255,255,0.06)'}}>
                    <div className="h-full rounded-full transition-all" style={{width:`${Math.round(milestones.filter((m:any)=>m.done).length/milestones.length*100)}%`,background:selectedProject!.color||BLU}}/>
                  </div>
                  <span className="font-syne text-[7.5px] font-black flex-shrink-0" style={{color:'rgba(255,255,255,0.2)'}}>{milestones.filter((m:any)=>m.done).length}/{milestones.length}</span>
                </div>
              </div>
            )}
          </div>

          {/* ── NOTAS DE PROGRESO ── */}
          <div className="mt-5 pt-5" style={{borderTop:`1px solid ${BORDER}`}}>
            <div className="font-syne text-[8px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.2)'}}>NOTAS DE PROGRESO</div>
            <div className="flex items-start gap-2 mb-3">
              <textarea value={noteText} onChange={e=>setNoteText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&noteText.trim())addNote()}} placeholder="Añade una actualización… (⌘+Enter para guardar)" rows={2} className="flex-1 bg-transparent text-[12px] outline-none px-3 py-2.5 rounded-xl resize-none" style={{caretColor:BLU,color:'rgba(255,255,255,0.65)',border:`1px solid ${BORDER}`}}/>
              <button onClick={addNote} disabled={!noteText.trim()||noteSaving} className="w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-30 transition-all flex-shrink-0" style={{background:`${BLU}18`,border:`1px solid ${BLU}30`}}>
                <LucideIcon name={noteSaving?'loader':'send'} size={13} color={BLU}/>
              </button>
            </div>
            {projNotes.length > 0 ? (
              <div className="space-y-2">
                {projNotes.map((n: any)=>(
                  <div key={n.id} className="group flex items-start gap-3 px-4 py-3 rounded-xl" style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${BORDER}`}}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-syne text-[7.5px] font-black" style={{color:'rgba(255,255,255,0.35)'}}>{n.user_name||'Usuario'}</span>
                        <span className="font-syne text-[7px]" style={{color:'rgba(255,255,255,0.18)'}}>{new Date(n.created_at).toLocaleDateString('es-ES',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
                      </div>
                      <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap" style={{color:'rgba(255,255,255,0.65)'}}>{n.content}</p>
                    </div>
                    <button onClick={()=>deleteNote(n.id)} title="Eliminar nota" aria-label="Eliminar esta nota" className="opacity-50 md:opacity-0 md:group-hover:opacity-50 transition-opacity flex-shrink-0 mt-0.5">
                      <LucideIcon name="trash" size={11} color={RED}/>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-[11px]" style={{color:'rgba(255,255,255,0.18)'}}>Sin notas aún — registra aquí cada actualización del proyecto</div>
            )}
          </div>
          </div>
          </div>{/* end inner padding div */}
        </div>
      )}
    </div>
  )
}

export default ProyectosSection
