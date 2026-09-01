'use client'
import { useState, useEffect, useRef } from 'react'
import { estadoDeadline, parseImporte, buscaEnTexto, colorEstadoCliente, ESTADOS_CLIENTE, VIO } from '@/components/shared'
import { rutaApp } from '@/lib/appUrl'
import { hayModalAbierto } from '@/components/shared/modalAbierto'
import { BLU, RED, GRN, SURFACE, SURF2, BORDER, AMBAR} from '@/components/shared/design-tokens'
import { useIsMobile, useBackClosable } from '@/components/shared/hooks'
import { dlDate, dlLabel, strColor, relTime, todayKey, localDayKey, daysBetweenKeys, plural } from '@/components/shared/helpers'
import { fetchWithTimeout } from '@/lib/fetch-timeout'
import { ProgressRing } from '@/components/shared/ui'
import LucideIcon from '@/components/shared/LucideIcon'
import { PlatformLogo } from '@/components/PlatformLogo'
import type { Client, Project, Task, NexusData} from '@/types'
import type { IrASeccion } from '@/components/shared/secciones'

// El plan estrategico lo escribe Claude y /api/clients/[id]/ai-advice reenvia el
// JSON parseado TAL CUAL, sin esquema que lo valide. Tipar aqui la forma que la
// ficha necesita obliga a normalizar antes de guardarlo en el estado, que es lo
// que impide que un campo ausente llegue al render.
type Prioridad = 'alta'|'media'|'baja'
type Recomendacion = { title: string; body: string; priority: Prioridad }

// El prompt pide {title, body, priority:"alta|media|baja"}, pero eso es una
// peticion, no un contrato: si el modelo omite `priority` o la manda como numero,
// `rec.priority.toUpperCase()` lanzaba "Cannot read properties of undefined" y se
// caia la ficha ENTERA del cliente —cabecera, proyectos, tareas y comentarios—,
// no solo el bloque del plan. Y `recommendations` puede no ser ni un array: la
// rama de rescate de la ruta devuelve el texto crudo cuando el JSON no parsea.
// Se normaliza una vez, al recibir, en vez de defenderse campo a campo al pintar.
const PRIORIDADES: Prioridad[] = ['alta','media','baja']
const normalizarRecomendaciones = (raw: unknown): Recomendacion[] =>
  (Array.isArray(raw) ? raw : []).map((r: any): Recomendacion => {
    const p = typeof r?.priority === 'string' ? r.priority.trim().toLowerCase() : ''
    return {
      title: typeof r?.title === 'string' && r.title.trim() ? r.title.trim() : 'Recomendación',
      body: typeof r?.body === 'string' ? r.body : '',
      // 'media' y no 'baja': una prioridad ilegible no es una prioridad baja.
      priority: (PRIORIDADES as string[]).includes(p) ? p as Prioridad : 'media',
    }
  })

interface PropsClientes {
  data: NexusData
  selectedId: any
  onSelect: any
  onOpenModal: any
  showToast: any
  isOwner: any
  onNavigate: IrASeccion
  onSelectProject: any
}

export default function ClientesSection({data,selectedId,onSelect,onOpenModal,showToast,isOwner,onNavigate,onSelectProject}: PropsClientes) {
  const isMobile = useIsMobile()
  useBackClosable(!!selectedId, () => onSelect(null))
  const [aiAdvice, setAiAdvice] = useState<Recomendacion[]|null>(null)
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
  const [clientFiles, setClientFiles] = useState<any[]|null>(null)
  const [filesLoading, setFilesLoading] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selected = selectedId ? data.clients.find((c: Client)=>c.id===selectedId) : null
  // Espejo en ref: dentro de un `await` no se puede consultar `selectedId`, porque
  // el closure es el del render en que arranco la peticion.
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  // Todo el estado que pertenece a UN cliente concreto se limpia aquí, no en
  // handleBack. Del detalle se sale por tres sitios —el enlace "Todos los
  // clientes", Escape y el gesto/botón Atrás— y los dos últimos llaman a
  // onSelect(null) directamente. Limpiar solo en handleBack dejaba pegados los
  // comentarios y el plan de IA del cliente anterior al abrir el siguiente: se
  // leía el hilo de A mientras se respondía sobre B.
  useEffect(() => {
    setClientEditOpen(false)
    setConfirmDeleteClient(false)
    setClientFiles(null)
    setComments(null)
    setAiAdvice(null)
    setExpandedProject(null)
    setNewComment('')
    // Las cargas en vuelo del cliente anterior ya no apagan su propio spinner
    // —sus setters van detrás de `vigente()`—, así que se apaga aquí. Si no, la
    // ficha del siguiente cliente se quedaba en "Cargando…" para siempre.
    setFilesLoading(false)
    setCommentsLoading(false)
    setAiLoading(false)
  }, [selectedId])

  const loadFiles = async (id: string) => {
    // El efecto de arriba limpia el estado al cambiar de cliente, pero la
    // peticion que ya estaba en vuelo seguia escribiendo al volver: los
    // contratos y briefings de A se pintaban en la ficha de B. `vigente()`
    // descarta la respuesta que ya no corresponde — tambien la de error, que
    // dejaba a B con "Sin archivos" por un fallo que no era suyo.
    const vigente = () => selectedIdRef.current === id
    setFilesLoading(true)
    try {
      const r = await fetchWithTimeout(`/api/clients/${id}/files`)
      if (!vigente()) return
      if (!r.ok) { showToast('Error al cargar archivos'); setClientFiles([]); return }
      const archivos = await r.json()
      if (!vigente()) return
      setClientFiles(archivos)
    } catch { if (vigente()) { showToast('Error al cargar archivos'); setClientFiles([]) } }
    finally { if (vigente()) setFilesLoading(false) }
  }

  const uploadFile = async (file: File) => {
    if (!selected) return
    // El cliente se fija al empezar. El registro ya iba contra el correcto —la URL
    // se evalua antes del await— pero la lista se actualizaba al terminar: si
    // cambiabas de cliente durante la subida, el archivo aparecia colgando del
    // siguiente. Mismo patron que onPickPdf de Proyectos.
    const clienteId = selected.id
    setUploadingFile(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const r = await fetch(`/api/clients/${clienteId}/files`, { method: 'POST', body: fd })
      const result = await r.json()
      if (!r.ok) { showToast(result.error || 'Error al subir'); return }
      if (selectedIdRef.current === clienteId) setClientFiles(prev => [result, ...(prev||[])])

      // Y a MEMORIA. Un contrato subido a la ficha de un cliente se quedaba solo
      // ahí: había que saber que existía y entrar a buscarlo, no salía al buscar
      // en Memoria y Harvey no lo veía. Memoria es lo que el estudio sabe, y un
      // documento que no llega no lo sabe nadie.
      //
      // Solo los PDF se analizan —es lo que la IA sabe leer—; el resto entra igual
      // como registro, que ya es más que nada. Va sin `await`: la subida ya ha
      // terminado y esto no debe hacer esperar.
      const nombre = (result?.name || file.name || 'Documento').replace(/\.[^.]+$/, '')
      const enlace = result?.url ? rutaApp('/api/archivo?u=' + encodeURIComponent(result.url)) : ''
      const esPdf = /\.pdf$/i.test(file.name)
      ;(async () => {
        let resumen = ''
        if (esPdf && result?.url) {
          try {
            const ra = await fetch('/api/documents', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: result.url, name: file.name }),
            })
            if (ra.ok) { const ja = await ra.json(); resumen = ja?.summary || '' }
          } catch { /* sin resumen, la nota se crea igual */ }
        }
        try {
          await data.createMemoria?.({
            title: `${nombre} — ${selected?.name || 'cliente'}`,
            category: 'Documento',
            client_id: clienteId,
            content: [resumen, enlace ? `📎 Documento: ${enlace}` : ''].filter(Boolean).join('\n\n'),
          })
        } catch { /* la nota es un extra: el archivo ya está subido */ }
      })()

      showToast('Archivo subido')
    } catch { showToast('Error al subir el archivo') }
    finally { setUploadingFile(false) }
  }

  // Dos toques: un contrato o un briefing se borraba con un solo toque, y el
  // objetivo táctil en móvil es diminuto. El segundo toque confirma.
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<string|null>(null)
  const deleteFile = async (path: string) => {
    if (!selected) return
    if (confirmDeleteFile !== path) {
      setConfirmDeleteFile(path)
      setTimeout(() => setConfirmDeleteFile(c => c === path ? null : c), 4000)
      showToast('Toca otra vez para borrar el archivo')
      return
    }
    setConfirmDeleteFile(null)
    // Igual que en `uploadFile`: el borrado va contra el cliente correcto, pero
    // la lista se toca al terminar. Sin fijar el id, cambiar de ficha durante la
    // peticion dejaba a `clientFiles` en `[]` para el cliente siguiente — su
    // ficha decia "Sin archivos" teniendolos.
    const clienteId = selected.id
    try {
      const r = await fetch(`/api/clients/${clienteId}/files`, { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ path }) })
      // Se quitaba la fila y se decia "Archivo eliminado" pasara lo que pasara.
      // El archivo seguia en el bucket y reaparecia al recargar la seccion.
      if (!r.ok) { const e = await r.json().catch(()=>({} as any)); showToast(e.error || 'No se pudo eliminar el archivo'); return }
      if (selectedIdRef.current === clienteId) setClientFiles(prev => (prev||[]).filter(f => f.path !== path))
      showToast('Archivo eliminado')
    } catch { showToast('Error al eliminar') }
  }

  const fmtSize = (bytes: number) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024*1024) return `${(bytes/1024).toFixed(0)}KB`
    return `${(bytes/(1024*1024)).toFixed(1)}MB`
  }

  const fileIcon = (type: string, name: string) => {
    const ext = name.split('.').pop()?.toLowerCase() || ''
    if (type.startsWith('image/')) return 'image'
    if (type === 'application/pdf' || ext === 'pdf') return 'file-text'
    if (['mp4','mov','avi','webm'].includes(ext)) return 'video'
    if (['xlsx','xls','csv'].includes(ext)) return 'table'
    if (['doc','docx'].includes(ext)) return 'file-pen'
    if (['zip','rar','7z'].includes(ext)) return 'archive'
    return 'file'
  }

  useEffect(()=>{
    const handler = (e: KeyboardEvent) => {
      // Con un modal abierto el foco esta en BODY, asi que la guarda por tagName
      // de mas abajo no protege: escribir en el formulario ejecutaba estos atajos.
      if (hayModalAbierto()) return
      if (['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName) || e.metaKey||e.ctrlKey||e.altKey) return
      if (e.key === 'Escape') { if (clientEditOpen) { setClientEditOpen(false); return } if (selected) { onSelect(null); return } }
      if (e.key === 'n' && !selected) { e.preventDefault(); onOpenModal('cliente') }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientEditOpen, selected, isOwner])

  const loadComments = async (id: string) => {
    // Mismo caso que `loadFiles`: sin esta guarda se leia el hilo de A mientras
    // se respondia sobre B, que es justo lo que el efecto de arriba intentaba
    // evitar limpiando el estado.
    const vigente = () => selectedIdRef.current === id
    setCommentsLoading(true)
    try {
      const r = await fetchWithTimeout(`/api/clients/${id}/comments`)
      if (!vigente()) return
      if (!r.ok) { showToast('Error al cargar comentarios'); setComments([]); return }
      const hilo = await r.json()
      if (!vigente()) return
      setComments(hilo)
    } catch { if (vigente()) { showToast('Error al cargar comentarios'); setComments([]) } }
    finally { if (vigente()) setCommentsLoading(false) }
  }

  const postComment = async () => {
    // El input no se vacia hasta que responde el servidor, asi que un segundo
    // Enter mientras tanto publicaba el mismo comentario dos veces.
    if (postingComment) return
    if (!newComment.trim() || !selected) return
    // El cliente se fija al empezar, como en `uploadFile`: el comentario ya iba
    // al correcto, pero al volver se anadia a la lista en pantalla, y si habias
    // cambiado de ficha aparecia como unico comentario del cliente siguiente.
    const clienteId = selected.id
    setPostingComment(true)
    try {
      const r = await fetch(`/api/clients/${clienteId}/comments`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:newComment.trim()})})
      const c = await r.json()
      // Sin esta comprobacion el cuerpo del error se anadia al hilo como si fuera
      // un comentario: burbuja vacia firmada por "Alguien" y el texto perdido.
      // No se vacia el input al fallar — lo escrito se conserva.
      if (!r.ok) { showToast(c?.error === 'Comment too long' ? 'El comentario es demasiado largo' : 'No se pudo publicar el comentario'); return }
      if (selectedIdRef.current === clienteId) { setComments(prev => [...(prev||[]), c]); setNewComment('') }
    } catch { showToast('Error al publicar') }
    finally { setPostingComment(false) }
  }

  const loadAiAdvice = async (id: string) => {
    // El analisis tarda decenas de segundos (hasta 60s de funcion). Sin guarda,
    // el plan estrategico de A se pintaba bajo el nombre de B, con sus cifras y
    // sus proyectos: recomendaciones de otro cliente firmadas por este.
    const vigente = () => selectedIdRef.current === id
    setAiLoading(true)
    try {
      const r = await fetch(`/api/clients/${id}/ai-advice`, {method:'POST'})
      const d = await r.json()
      if (!vigente()) return
      // Con 429 ("Demasiadas solicitudes") o 502 ("AI no disponible") el boton
      // pasaba de "Analizando…" a normal y no ocurria nada: parecia roto. Con
      // varias personas usandolo a la vez, el 429 es lo mas probable.
      if (!r.ok) { showToast(d.error || 'No se pudieron generar las recomendaciones'); return }
      const recs = normalizarRecomendaciones(d.recommendations)
      // El bloque solo se pinta si hay al menos una: sin este aviso, una respuesta
      // vacia o con otra forma dejaba el boton volviendo de "Analizando…" a normal
      // sin que apareciera nada, que es justo lo que arriba se describe como
      // "parecia roto".
      if (!recs.length) { showToast('La IA no ha devuelto recomendaciones. Vuelve a intentarlo.'); return }
      setAiAdvice(recs)
    } catch { if (vigente()) showToast('Error generando recomendaciones') }
    finally { if (vigente()) setAiLoading(false) }
  }

  // La limpieza la hace el efecto de [selectedId], que cubre también Escape y Atrás.
  const handleBack = () => onSelect(null)

  if (selected) {
    const clientProjects = data.projects.filter((p: Project)=>p.client_id===selected.id)
    const clientTasks = data.tasks.filter((t: Task)=>t.client_id===selected.id)
    const activeTasks = clientTasks.filter((t: Task)=>!t.done).sort((a: Task,b: Task)=>{ const lp=(l: string)=>l==='urgent'?0:l==='high'?1:2; return lp(a.level)-lp(b.level) })
    const doneTasks = clientTasks.filter((t: Task)=>t.done)
    const urgentTasks = activeTasks.filter((t: Task)=>t.level==='urgent')
    const activeProjects = clientProjects.filter((p: Project)=>p.status==='activo'||p.status==='urgente')
    const avgProgress = clientProjects.length ? Math.round(clientProjects.reduce((s: number,p: Project)=>s+p.progress,0)/clientProjects.length) : 0

    return (
      <div className={`${isMobile?'p-4':'p-8'} max-w-[1100px] mx-auto`}>
        <button onClick={handleBack} className="flex items-center gap-2 text-[12px] mb-8 transition-colors hover:text-white/70" style={{color:'rgba(255,255,255,0.35)'}}>
          <LucideIcon name="arrow-left" size={14}/> Todos los clientes
        </button>

        <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
          <div className="flex items-center gap-5 min-w-0">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center font-syne text-xl font-black flex-shrink-0" style={{background:selected.color+'18',border:`2px solid ${selected.color}35`,color:selected.color}}>{selected.initials}</div>
            <div>
              <div className="font-syne text-[9px] font-black tracking-widest mb-1" style={{color:'rgba(255,255,255,0.2)'}}>{(selected.industry||'').toUpperCase()}</div>
              <h1 className="font-figtree text-[28px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>{selected.name}</h1>
              {(
                <div className="flex items-center gap-1.5 mt-2">
                  {ESTADOS_CLIENTE.map(s0=>({s:s0,c:colorEstadoCliente(s0)})).map(opt=>(
                    <button key={opt.s} onClick={async()=>{try{await data.updateClient(selected.id,{status:opt.s});showToast(`Estado: ${opt.s}`)}catch{showToast('Error al actualizar')}}} className="px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all" style={{background:selected.status===opt.s?opt.c+'18':'rgba(255,255,255,0.03)',border:`1px solid ${selected.status===opt.s?opt.c+'50':'rgba(255,255,255,0.08)'}`,color:selected.status===opt.s?opt.c:'#FFFFFF'}}>{opt.s.toUpperCase()}</button>
                  ))}
                  {/* Sin esto, `archived_at` seria una columna que se escribe y no
                      lee nadie. Aqui responde a la pregunta que se hace uno al ver
                      un cliente archivado: ¿desde cuando? */}
                  {selected.status==='Archivado' && selected.archived_at && (
                    <span className="font-syne text-[8px] font-black tracking-wide ml-1" style={{color:'rgba(255,255,255,0.25)'}}>
                      DESDE {dlLabel(localDayKey(selected.archived_at))}
                    </span>
                  )}
                  {/* CERRAR EL TRATO, en un clic. El botón que de verdad se pulsa:
                      el estado ya se puede cambiar en la fila de arriba, pero este
                      es el momento que se quiere celebrar y el que hay que hacer
                      fácil — y es lo que mueve el dinero del embudo al MRR. */}
                  {selected.status==='Potencial' && (
                    <button
                      onClick={async()=>{try{await data.updateClient(selected.id,{status:'Activo'});showToast(`${selected.name} ya es cliente 🎉`)}catch(e:any){showToast(e?.message||'No se pudo cerrar')}}}
                      className="ml-1 px-3 py-1.5 rounded-xl font-syne text-[8px] font-black tracking-wide transition-opacity hover:opacity-80"
                      style={{background:`${GRN}18`,border:`1px solid ${GRN}50`,color:GRN}}>
                      ✓ CERRADO — PASAR A CLIENTE
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={()=>{ onOpenModal('tarea', {cliente:selected.name}) }} className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-wide transition-all" style={{background:'rgba(27,95,250,0.08)',color:BLU,border:`1px solid rgba(27,95,250,0.18)`}}>
              <LucideIcon name="check-square" size={11} color={BLU}/>+ TAREA
            </button>
            {<button onClick={()=>{ onOpenModal('proyecto', {cliente:selected.name}) }} className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-wide transition-all" style={{background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.4)',border:`1px solid ${BORDER}`}}>
              <LucideIcon name="folder-open" size={11} color="rgba(255,255,255,0.4)"/>+ PROYECTO
            </button>}
            <button onClick={()=>{ setAiAdvice(null); loadAiAdvice(selected.id) }} disabled={aiLoading} className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest text-white disabled:opacity-50 transition-all" style={{background:`linear-gradient(135deg,rgba(139,92,246,0.3),rgba(27,95,250,0.2))`,border:`1px solid rgba(139,92,246,0.35)`}}>
              <LucideIcon name="zap" size={11} color="#A78BFA"/>{aiLoading?'Analizando…':'IA ESTRATÉGICA'}
            </button>
            {(
              <button onClick={()=>{ setClientEditOpen(o=>!o); setEditRevenue(selected.revenue||''); setEditIndustry(selected.industry||''); setEditNotes(selected.notes||'') }} className="px-3 py-2 rounded-xl font-syne text-[9px] font-black tracking-widest transition-all" style={{color:clientEditOpen?BLU:'rgba(255,255,255,0.4)',background:clientEditOpen?'rgba(27,95,250,0.1)':'transparent',border:`1px solid ${clientEditOpen?'rgba(27,95,250,0.3)':BORDER}`}}>EDITAR</button>
            )}
            {isOwner && (
              confirmDeleteClient
                ? <div className="flex items-center gap-1">
                    {/* El botón decía "¿BORRAR + N PROYECTOS?" apoyándose en que la
                        FK projects.client_id era ON DELETE CASCADE. Ya no lo es:
                        migrations/20260810_retencion_e_integridad.sql la cambió a
                        ON DELETE RESTRICT justamente para que borrar un cliente no
                        destruya su trabajo. Con proyectos, Postgres rechaza el
                        DELETE — el botón prometía una destrucción que no ocurre y
                        el borrado fallaba sin explicar por qué. La vía buena es
                        archivar, que es para lo que se añadió `archived_at`. */}
                    {(() => {
                      const n = (data.projects || []).filter((p: any) => p.client_id === selected.id).length
                      if (n > 0) return (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl flex-wrap max-w-full" style={{background:AMBAR+'12',border:`1px solid ${AMBAR}28`}}>
                          <span className="font-syne text-[8px] font-black tracking-wide leading-relaxed" style={{color:AMBAR}}>TIENE {plural(n,'proyecto').toUpperCase()} · ARCHÍVALO O MUÉVELOS ANTES DE BORRAR</span>
                          <button onClick={async()=>{try{await data.updateClient(selected.id,{status:'Archivado'});setConfirmDeleteClient(false);showToast('Cliente archivado')}catch(e:any){showToast(e?.message||'Error al archivar')}}} className="px-2.5 py-1 rounded-lg font-syne text-[8px] font-black tracking-wide transition-all flex-shrink-0" style={{background:AMBAR+'20',color:AMBAR,border:`1px solid ${AMBAR}35`}}>ARCHIVAR</button>
                        </div>
                      )
                      return (
                        // El motivo del fallo se descartaba con un catch mudo: si
                        // el DELETE lo rechaza la base de datos, hay que verlo.
                        <button onClick={()=>data.deleteClient(selected.id).then(()=>{handleBack();showToast('Cliente eliminado')}).catch((e:any)=>showToast(e?.message||'Error al eliminar'))} className="px-3 py-2 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all" style={{background:'rgba(229,29,42,0.15)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}} title="El cliente no tiene proyectos: se borra solo él">
                          ¿BORRAR?
                        </button>
                      )
                    })()}
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
              {aiAdvice.map((rec, i)=>{
                const pc = rec.priority==='alta'?RED:rec.priority==='media'?AMBAR:BLU
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

        {clientEditOpen && (
          <div className="mb-8 rounded-2xl p-6" style={{background:'rgba(27,95,250,0.05)',border:'1px solid rgba(27,95,250,0.15)'}}>
            <div className="font-syne text-[8.5px] font-black tracking-widest mb-4" style={{color:'rgba(100,140,255,0.6)'}}>EDITAR CLIENTE</div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block font-syne text-[8px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>INDUSTRIA</label>
                <input value={editIndustry} onChange={e=>setEditIndustry(e.target.value)} placeholder="Ej: Fashion · Lifestyle" className="w-full px-4 py-3 rounded-xl text-[13px] text-white placeholder-white/20 outline-none transition-all" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.4)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
              </div>
              {isOwner && <div>
                <label className="block font-syne text-[8px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>FACTURACIÓN MENSUAL</label>
                <div className="flex gap-2 items-stretch">
                  <input value={editRevenue.replace(/\s*\/\s*(mes|año|ano)\s*$/i,'')}
                    onChange={e=>{
                      // El periodo se conserva al reescribir el importe: si no, cambiar
                      // «12k/año» por «14k» lo convertía en mensual sin avisar y el MRR
                      // se multiplicaba por doce.
                      const anual = parseImporte(editRevenue).anual
                      setEditRevenue(e.target.value.trim() ? `${e.target.value.trim()}${anual?'/año':'/mes'}` : '')
                    }}
                    placeholder="Ej: €12.000 · 12k · 1,5M"
                    className="flex-1 min-w-0 px-4 py-3 rounded-xl text-[13px] text-white placeholder-white/20 outline-none transition-all"
                    style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}}
                    onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.4)')}
                    onBlur={e=>(e.target.style.borderColor=BORDER)}/>
                  {/* MES o AÑO. No existía: todo se interpretaba como mensual, así
                      que un contrato anual inflaba el MRR doce veces. */}
                  <div className="flex rounded-xl overflow-hidden flex-shrink-0" style={{border:`1.5px solid ${BORDER}`}}>
                    {([['mes','MES'],['año','AÑO']] as const).map(([p,l])=>{
                      const on = (p==='año') === parseImporte(editRevenue).anual
                      return (
                        <button key={p} type="button"
                          onClick={()=>{
                            const importe = editRevenue.replace(/\s*\/\s*(mes|año|ano)\s*$/i,'').trim()
                            setEditRevenue(importe ? `${importe}/${p}` : '')
                          }}
                          className="px-3 font-syne text-[8.5px] font-black tracking-widest transition-all"
                          style={{background:on?'rgba(27,95,250,0.15)':'transparent',color:on?BLU:'rgba(255,255,255,0.3)'}}>
                          {l}
                        </button>
                      )
                    })}
                  </div>
                </div>
                {editRevenue && parseImporte(editRevenue).anual && (
                  <div className="font-figtree text-[11px] mt-1.5" style={{color:'rgba(255,255,255,0.35)'}}>
                    Son {Math.round(parseImporte(editRevenue).mensual).toLocaleString('es-ES')} € al mes — es lo que suma en Reportes.
                  </div>
                )}
              </div>}
            </div>
            <div className="mb-4">
              <label className="block font-syne text-[8px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.25)'}}>NOTAS INTERNAS</label>
              <textarea value={editNotes} onChange={e=>setEditNotes(e.target.value)} placeholder="Contexto del cliente, preferencias, acuerdos…" rows={3} className="w-full px-4 py-3 rounded-xl text-[13px] text-white placeholder-white/20 outline-none transition-all resize-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}} onFocus={e=>(e.target.style.borderColor='rgba(27,95,250,0.4)')} onBlur={e=>(e.target.style.borderColor=BORDER)}/>
            </div>
            <div className="flex gap-2">
              <button onClick={async()=>{ setSavingClient(true); try { await data.updateClient(selected.id,{industry:editIndustry,notes:editNotes,...(isOwner?{revenue:editRevenue}:{})}); showToast('Cliente actualizado'); setClientEditOpen(false) } catch { showToast('Error') } finally { setSavingClient(false) } }} disabled={savingClient} className="px-5 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest text-white disabled:opacity-40" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>{savingClient?'GUARDANDO…':'GUARDAR'}</button>
              <button onClick={()=>setClientEditOpen(false)} className="px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest transition-colors" style={{color:'rgba(255,255,255,0.3)',border:`1px solid ${BORDER}`}}>CANCELAR</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            {v:(selected.revenue||'—').split('/')[0].trim(),
             // Decía «Facturación mensual» pasara lo que pasara, incluso con un
             // contrato anual escrito al lado. Ahora lo lee y lo dice, y enseña
             // el equivalente mensual, que es lo que suma en Reportes.
             // Y en un POTENCIAL es una estimación, no una factura: aquí ponía
             // «Contrato activo» debajo del importe de alguien con quien no hay
             // nada firmado. Es la misma frase que en la rejilla, y por lo mismo.
             l:(selected.status==='Potencial'?'Estimado · f':'F')+(parseImporte(selected.revenue).anual?'acturación anual':'acturación mensual'),
             accent:selected.status==='Potencial'?VIO:selected.color,
             note:selected.status==='Potencial'
               ? 'Sin cerrar · no suma en el MRR'
               : parseImporte(selected.revenue).anual
               ? `Al año · ${Math.round(parseImporte(selected.revenue).mensual).toLocaleString('es-ES')} €/mes`
               : (selected.revenue||'').includes('/')?'Al mes · contrato activo':'Contrato activo'},
            {v:clientProjects.length, l:'Proyectos totales', accent:BLU, note:plural(activeProjects.length,'activo')},
            {v:activeTasks.length, l:'Tareas activas', accent:urgentTasks.length>0?RED:BLU, note:urgentTasks.length>0?plural(urgentTasks.length,'urgente'):plural(doneTasks.length,'completada')},
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
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words" style={{color:'rgba(255,255,255,0.5)'}}>{selected.notes}</p>
          </div>
        )}

        {(()=>{
          // El emparejamiento era `ai.includes(firstWord)` sin minimo de longitud,
          // asi que la primera palabra del cliente podia ser un articulo: "La Nave"
          // -> "la", y "coca-cola".includes("la") es cierto. Los correos de
          // Coca-Cola aparecian en la ficha de La Nave. Igual con "El Corte" ->
          // "el", que casa con Telefonica, Adobe, Dell...
          //
          // Ahora se compara por palabras completas y con un minimo de 4 letras.
          // Sacrifica alguna coincidencia rara a cambio de no mezclar clientes,
          // que en la ficha de un cliente es exactamente lo que no puede pasar.
          const normaliza = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          const name = normaliza(selected.name)
          const palabras = name.split(/[^a-z0-9]+/).filter(p => p.length >= 4)
          const clientEmails = ((data.inbox||[]) as any[]).filter((m:any)=>{
            if (!m.ai_client||m.ai_client==='Desconocido') return false
            const ai = normaliza(m.ai_client)
            if (ai === name) return true
            const palabrasAi = ai.split(/[^a-z0-9]+/).filter(p => p.length >= 4)
            // Alguna palabra significativa en comun, no un trozo suelto.
            return palabras.some(p => palabrasAi.includes(p))
          }).slice(0,5)
          if (clientEmails.length===0) return null
          return (
            <div className="mb-6 rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
              <div className="flex items-center justify-between px-6 py-4" style={{borderBottom:`1px solid ${BORDER}`}}>
                <div className="font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.25)'}}>CORREOS RECIENTES</div>
                <span className="font-syne text-[9px] font-black" style={{color:'rgba(255,255,255,0.2)'}}>{clientEmails.length}</span>
              </div>
              {clientEmails.map((m:any)=>(
                <div key={m.id} className="flex items-start gap-3 px-6 py-3.5" style={{borderBottom:`1px solid rgba(255,255,255,0.04)`}}>
                  <div className="flex-shrink-0 mt-1.5 w-2 h-2 rounded-full" style={{background:m.ai_urgency==='urgent'?RED:m.ai_urgency==='high'?'rgba(255,176,32,0.8)':BLU}}/>
                  <div className="flex-1 min-w-0">
                    <div className="font-figtree text-[13px] font-semibold truncate" style={{color:m.is_read?'rgba(255,255,255,0.5)':'rgba(255,255,255,0.88)'}}>{m.subject||'Sin asunto'}</div>
                    <div className="text-[11px] mt-0.5 break-words" style={{color:'rgba(255,255,255,0.28)'}}>{m.from_name} · {relTime(m.received_at)}</div>
                  </div>
                  {!m.is_read && <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5" style={{background:BLU}}/>}
                </div>
              ))}
            </div>
          )
        })()}
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
                          const dOver = !!estadoDeadline(p.deadline)?.vencido
                          const dSoon = !dOver && dlDate(p.deadline)<new Date(Date.now()+7*24*3600*1000)
                          return <span className="font-syne text-[8px] font-black px-1.5 py-0.5 rounded-full" style={{background:dOver?`${RED}15`:dSoon?'rgba(255,176,32,0.1)':'transparent',color:dOver?RED:dSoon?'rgba(255,176,32,0.8)':'rgba(255,255,255,0.25)'}}>{dOver&&'⚠ '}{dlLabel(p.deadline)}</span>
                        })()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {projTasks.length > 0 && <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.3)'}}>{plural(projTasks.length,'tarea')}</span>}
                      <span className="font-syne text-[8px] font-black px-2.5 py-1 rounded-lg" style={{background:p.status==='urgente'?'rgba(229,29,42,0.1)':'rgba(27,95,250,0.07)',color:p.status==='urgente'?RED:BLU}}>{p.progress}%</span>
                      {onNavigate && onSelectProject && <button onClick={e=>{e.stopPropagation();onSelectProject(p.id);onNavigate('proyectos')}} className={`transition-opacity flex items-center justify-center w-7 h-7 rounded-xl ${isMobile?'opacity-40':'opacity-0 group-hover:opacity-100'}`} style={{background:'rgba(27,95,250,0.1)',color:BLU}} title="Ver en Proyectos"><LucideIcon name="arrow-right" size={11} color={BLU}/></button>}
                      <LucideIcon name={isOpen?'chevron-up':'chevron-down'} size={13} color="rgba(255,255,255,0.25)"/>
                    </div>
                  </div>
                  {isOpen && projTasks.length > 0 && (
                    <div className="px-6 pb-3" style={{borderTop:`1px solid ${BORDER}`}}>
                      {projTasks.slice(0,6).map((t: Task,ti: number)=>{
                        const cTodayStr = todayKey()
                        const cIsToday = t.due_date && t.due_date.slice(0,10)===cTodayStr
                        const cOver = t.due_date && !cIsToday && new Date(t.due_date+'T23:59:59')<new Date()
                        return (
                        <div key={t.id} className="flex items-center gap-3 py-2" style={{borderBottom:ti<Math.min(projTasks.length,6)-1?`1px solid rgba(255,255,255,0.03)`:'none'}}>
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:t.level==='urgent'?RED:t.level==='high'?'rgba(255,176,32,0.7)':BLU}}/>
                          <span className="text-[12px] flex-1 truncate" style={{color:'rgba(255,255,255,0.5)'}}>{t.text}</span>
                          {t.due_date && <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:cIsToday?'rgba(255,176,32,0.15)':cOver?`${RED}15`:'rgba(255,255,255,0.04)',color:cIsToday?AMBAR:cOver?RED:'rgba(255,255,255,0.2)'}}>{cIsToday?'HOY':new Date(t.due_date+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'})}</span>}
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
                    const todayStr = todayKey()
                    const isToday = t.due_date.slice(0,10)===todayStr
                    const over = !isToday && new Date(t.due_date+'T23:59:59')<new Date()
                    return <span className="font-syne text-[7.5px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:isToday?'rgba(255,176,32,0.15)':over?`${RED}15`:'rgba(255,255,255,0.04)',color:isToday?AMBAR:over?RED:'rgba(255,255,255,0.25)'}}>{isToday?'HOY':new Date(t.due_date+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'})}</span>
                  })()}
                </div>
              ))}
              {activeTasks.length>5 && <div className="px-5 py-2 text-center text-[10px]" style={{color:'rgba(255,255,255,0.2)'}}>+{activeTasks.length-5} más</div>}
            </div>
            {/* El bloque CONTENIDO de este cliente se quitó: las piezas de
                Contenido son las RRSS del estudio, no de un cliente. */}
            {/* Aquí había un bloque NOTAS del diseño original que pintaba
                selected.notes por segunda vez — el bloque NOTAS INTERNAS de más
                arriba es el que quedó como bueno. Hay una regla en
                regresiones.test.ts que impide que vuelva. */}
          </div>
        </div>

        {/* ARCHIVOS */}
        <div className="rounded-2xl overflow-hidden mb-5" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
          <div className="flex items-center justify-between px-6 py-4" style={{borderBottom:`1px solid ${BORDER}`}}>
            <div className="font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.25)'}}>ARCHIVOS</div>
            <div className="flex items-center gap-2">
              {clientFiles===null && (
                <button onClick={()=>loadFiles(selected.id)} className="font-syne text-[8px] font-black px-3 py-1.5 rounded-xl transition-all" style={{background:'rgba(27,95,250,0.1)',color:BLU}}>VER ARCHIVOS</button>
              )}
              <input ref={fileInputRef} type="file" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f){uploadFile(f);e.target.value=''}}}/>
              <button onClick={async()=>{if(clientFiles===null){await loadFiles(selected.id)};fileInputRef.current?.click()}} disabled={uploadingFile}
                className="flex items-center gap-1.5 font-syne text-[8px] font-black px-3 py-1.5 rounded-xl transition-all disabled:opacity-40"
                style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.45)'}}>
                <LucideIcon name="upload" size={11} color="rgba(255,255,255,0.45)"/>
                {uploadingFile ? 'Subiendo…' : 'Subir archivo'}
              </button>
            </div>
          </div>
          {filesLoading && <div className="px-6 py-6 text-center text-[12px]" style={{color:'rgba(255,255,255,0.2)'}}>Cargando…</div>}
          {clientFiles!==null && !filesLoading && (
            clientFiles.length===0
              ? <div className="px-6 py-8 text-center">
                  <LucideIcon name="paperclip" size={20} color="rgba(255,255,255,0.1)"/>
                  <div className="mt-2 text-[12px]" style={{color:'rgba(255,255,255,0.2)'}}>Sin archivos — sube contratos, briefings o referencias</div>
                </div>
              : <div>
                  {clientFiles.map((f:any, i:number)=>(
                    <div key={f.path} className="flex items-center gap-3 px-5 py-3 group" style={{borderBottom:i<clientFiles.length-1?`1px solid ${BORDER}`:'none'}}>
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:'rgba(27,95,250,0.08)'}}>
                        <LucideIcon name={fileIcon(f.type,f.name) as any} size={15} color={BLU}/>
                      </div>
                      <div className="flex-1 min-w-0">
                        <a href={f.url} target="_blank" rel="noopener noreferrer" className="font-figtree text-[13px] font-medium truncate block transition-colors hover:text-blue-400" style={{color:'rgba(255,255,255,0.75)'}}>{f.name}</a>
                        <div className="flex items-center gap-2 mt-0.5">
                          {f.size>0&&<span className="font-syne text-[8px] font-black" style={{color:'rgba(255,255,255,0.2)'}}>{fmtSize(f.size)}</span>}
                          {f.created_at&&<span className="font-syne text-[8px]" style={{color:'rgba(255,255,255,0.15)'}}>{new Date(f.created_at).toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'})}</span>}
                        </div>
                      </div>
                      <a href={f.url} target="_blank" rel="noopener noreferrer" className={`w-7 h-7 flex items-center justify-center rounded-lg transition-opacity ${isMobile?'opacity-50':'opacity-0 group-hover:opacity-100'}`} style={{background:'rgba(27,95,250,0.1)',color:BLU}} title="Descargar">
                        <LucideIcon name="download" size={12} color={BLU}/>
                      </a>
                      {<button onClick={()=>deleteFile(f.path)} className={`w-7 h-7 flex items-center justify-center rounded-lg transition-opacity ${isMobile?'opacity-50':'opacity-0 group-hover:opacity-100'}`} style={{color:'rgba(229,29,42,0.5)'}} title="Eliminar">
                        <LucideIcon name="trash-2" size={12} color="rgba(229,29,42,0.5)"/>
                      </button>}
                    </div>
                  ))}
                </div>
          )}
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

  // `parseImporte`, no un parser propio: el de aquí ignoraba la «k» y el «/año»,
  // así que «12k/mes» valía 12 € y «120k/año» valía 120 €/mes en vez de 10.000.
  // Es el mismo fallo que ya se arregló en Reportes, vivo en la copia de al lado —
  // y este fichero YA importaba `parseImporte` y lo usaba seis veces en el detalle:
  // la línea que dice «es lo que suma en Reportes» contradecía a la tarjeta de
  // arriba en la misma pantalla.
  const parseRevenue = (s: string): number => parseImporte(s).mensual
  const activeClients = data.clients.filter((c: Client)=>c.status==='Activo')
  const totalMRR = activeClients.reduce((sum: number, c: Client) => sum + parseRevenue(c.revenue||''), 0)
  // EL EMBUDO, aparte y con su propio número.
  //
  // Un potencial NO suma en el MRR: ese dinero no lo ha facturado nadie todavía, y
  // el MRR es la cifra que se mira para decidir. Pero tampoco puede desaparecer —
  // «cuánto hay en el aire» es media conversación de un lunes. Van los dos, y con
  // etiquetas que no se pueden confundir: uno dice TOTAL y el otro EN EL EMBUDO.
  const potenciales = data.clients.filter((c: Client)=>c.status==='Potencial')
  const totalEmbudo = potenciales.reduce((sum: number, c: Client) => sum + parseRevenue(c.revenue||''), 0)
  // El desglose tiene que contar los MISMOS clientes que el total que hay al lado.
  // Antes salían todos —también los pausados—, así que las barras sumaban más que
  // el MRR: con los datos de ejemplo, €154.500 en barras bajo un total de €136.500.
  const revenueClients = activeClients
    .filter((c: Client)=>parseRevenue(c.revenue||'')>0)
    .sort((a: Client,b: Client)=>parseRevenue(b.revenue||'')-parseRevenue(a.revenue||''))
  const REVENUE_TOP = 4
  const maxRevenue = Math.max(...revenueClients.map((c: Client)=>parseRevenue(c.revenue||'')), 1)
  const visibleClients = data.clients.filter((c: Client) => {
    const matchStatus = clientStatusFilter === 'Todos' || c.status === clientStatusFilter
    const matchSearch = buscaEnTexto(`${c.name} ${c.industry||''}`, clientSearch)
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
    <div className={`${isMobile?'p-4':'p-8'} max-w-[1200px] mx-auto`}>
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-2" style={{color:'rgba(255,255,255,0.18)'}}>GESTIÓN</div>
          <h1 className="font-figtree text-[26px] font-black text-white leading-none" style={{letterSpacing:'-0.03em'}}>Clientes</h1>
        </div>
        <button onClick={()=>onOpenModal('cliente')} className="flex items-center gap-2 px-5 py-3 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white transition-opacity hover:opacity-85" style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>+ NUEVO CLIENTE</button>
      </div>
      {potenciales.length > 0 && (
        <button onClick={()=>setClientStatusFilter(clientStatusFilter==='Potencial'?'Todos':'Potencial')}
          className="w-full flex items-center gap-3 mb-5 px-5 py-3.5 rounded-2xl text-left transition-opacity hover:opacity-85"
          /* Borde DISCONTINUO, como las tarjetas de abajo: es la misma idea dicha
             dos veces — nada de esto está cerrado todavía. */
          style={{background:`${VIO}0A`,border:`1px dashed ${VIO}45`}}>
          <LucideIcon name="user-plus" size={15} color={VIO}/>
          <span className="font-syne text-[9.5px] font-black tracking-widest" style={{color:VIO}}>
            {plural(potenciales.length,'CLIENTE POTENCIAL','CLIENTES POTENCIALES').toUpperCase()}
          </span>
          {totalEmbudo > 0 && (
            <span className="font-figtree text-[13px] font-black" style={{color:VIO}}>
              €{totalEmbudo.toLocaleString('es-ES')} en el embudo
            </span>
          )}
          <span className="ml-auto font-syne text-[8px] font-black tracking-wide" style={{color:'rgba(255,255,255,0.28)'}}>
            {clientStatusFilter==='Potencial' ? 'VER TODOS' : 'VER SOLO ESTOS'}
          </span>
        </button>
      )}
      {totalMRR > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="col-span-1 rounded-2xl p-5" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            <div className="font-syne text-[8.5px] font-black tracking-widest mb-2" style={{color:'rgba(255,255,255,0.2)'}}>MRR TOTAL</div>
            <div className="font-figtree text-[32px] font-black leading-none text-white" style={{letterSpacing:'-0.02em'}}>€{totalMRR.toLocaleString('es-ES')}</div>
            <div className="text-[11px] mt-1.5" style={{color:'rgba(255,255,255,0.3)'}}>{plural(activeClients.length,'cliente activo','clientes activos')}</div>
          </div>
          <div className="col-span-1 md:col-span-2 rounded-2xl p-5" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
            {/* Solo caben 4 barras. Decirlo evita que se lea como el desglose
                completo del MRR cuando hay más clientes activos que eso. */}
            <div className="font-syne text-[8.5px] font-black tracking-widest mb-4" style={{color:'rgba(255,255,255,0.2)'}}>
              REVENUE POR CLIENTE ACTIVO{revenueClients.length > REVENUE_TOP ? ` · TOP ${REVENUE_TOP} DE ${revenueClients.length}` : ''}
            </div>
            <div className="space-y-2.5">
              {revenueClients.slice(0,REVENUE_TOP).map((c: Client)=>{
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
            {[{v:'Todos',c:'rgba(255,255,255,0.9)'},...ESTADOS_CLIENTE.map(e=>({v:e,c:colorEstadoCliente(e)}))].map(s=>(
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
              <div key={c.id} onClick={()=>onSelect(c.id)} className="rounded-2xl overflow-hidden cursor-pointer transition-all group hover:border-white/10"
                /* DISCONTINUO si es un potencial. La chapa de estado ya lo dice,
                   pero se lee después del nombre y del logo; el borde se ve antes
                   de leer nada, que es lo que se pidió: distinguirlos de un
                   vistazo en una rejilla donde todos parecen clientes. */
                style={{background:SURFACE,border:c.status==='Potencial'?`1px dashed ${VIO}40`:`1px solid ${BORDER}`}}>
                <div className="h-1" style={{background:c.status==='Potencial'?`repeating-linear-gradient(90deg,${VIO}55 0 6px,transparent 6px 12px)`:`linear-gradient(90deg,${c.color}60,transparent)`}}/>
                <div className="p-6">
                  <div className="flex items-center gap-4 mb-5">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center font-syne text-base font-black flex-shrink-0" style={{background:c.color+'18',border:`2px solid ${c.color}25`,color:c.color}}>{c.initials}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-syne text-[15px] font-black text-white truncate">{c.name}</div>
                      <div className="text-[11px] mt-0.5 truncate" style={{color:'rgba(255,255,255,0.3)'}}>{c.industry}</div>
                    </div>
                    <span className="font-syne text-[8px] font-black px-2.5 py-1 rounded-full flex-shrink-0" style={{background:`${colorEstadoCliente(c.status)}14`,color:c.status==='Archivado'?'rgba(255,255,255,0.3)':colorEstadoCliente(c.status)}}>{c.status.toUpperCase()}</span>
                  </div>

                  {c.revenue && c.revenue !== '—' && (
                    <div className="mb-4 px-4 py-3 rounded-xl" style={{background:c.color+'08',border:`1px solid ${c.color}15`}}>
                      <div className="font-syne text-[8px] font-black tracking-widest mb-1" style={{color:'rgba(255,255,255,0.25)'}}>{/* El mismo criterio que la ficha: «120k/año» etiquetado MENSUAL hacía apuntar una cifra doce veces mayor a quien lee la rejilla deprisa. */}{(c.status==='Potencial'?'ESTIMADO · ':'')+(parseImporte(c.revenue).anual ? 'FACTURACIÓN ANUAL' : 'FACTURACIÓN MENSUAL')}</div>
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
                    const clientMsgs = data.inbox.filter((m: any)=>{
                      if (!m.ai_client || m.ai_client === 'Desconocido') return false
                      const ai = m.ai_client.toLowerCase(); const nm = c.name.toLowerCase()
                      if (ai.includes(nm) || nm.includes(ai)) return true
                      const nmW = nm.split(' ')[0]; const aiW = ai.split(' ')[0]
                      // Primera palabra solo como match parcial si es distintiva (≥4 car.)
                      return (nmW.length>=4 && ai.includes(nmW)) || (aiW.length>=4 && nm.includes(aiW))
                    })
                    const lm = clientMsgs.sort((a: any,b: any)=>new Date(b.received_at).getTime()-new Date(a.received_at).getTime())[0]
                    const unreadN = clientMsgs.filter((m: any)=>!m.is_read).length
                    if (!lm) return null
                    // Dias naturales de Madrid, no bloques de 24h: con la resta,
                    // un email de ayer a las 22:00 seguia diciendo 'HOY' a las 09:00.
                    const dd = daysBetweenKeys(localDayKey(lm.received_at), todayKey())
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
