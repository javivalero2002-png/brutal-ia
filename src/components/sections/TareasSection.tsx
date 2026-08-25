'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { hayModalAbierto } from '@/components/shared/modalAbierto'
import type { Task, Project, Profile, NexusData} from '@/types'
import { useIsMobile, useBackClosable, BLU, RED, GRN, SURFACE, SURF2, BORDER, LucideIcon, todayKey, daysBetweenKeys, estadoDeadline, buscaEnTexto, NIVEL_TAREA, rotuloNivel } from '@/components/shared'
import { plural, nivelTarea } from '@/components/shared/helpers'
import type { IrASeccion } from '@/components/shared/secciones'
import TableroLunes from '@/components/shared/TableroLunes'

const AMB = '#FFB020'
// El rótulo y el color salen de `NIVEL_TAREA`: aquí se llamaban ALTA/MEDIA/BAJA
// mientras el formulario de crear decía Urgente/Alta/Normal, así que pulsabas ALTA
// y la tarea salía etiquetada MEDIA.
const PRIMAP: Record<string,{label:string,color:string}> = {
  urgent: {label: NIVEL_TAREA.urgent.corto, color: NIVEL_TAREA.urgent.color},
  high:   {label: NIVEL_TAREA.high.corto,   color: NIVEL_TAREA.high.color},
  normal: {label: NIVEL_TAREA.normal.corto, color: NIVEL_TAREA.normal.color},
}

function relDate(dateStr: string) {
  const todayStr = todayKey()
  const d = dateStr.slice(0,10)
  const diff = Math.round((new Date(d+'T12:00:00').getTime() - new Date(todayStr+'T12:00:00').getTime()) / 86400000)
  if (diff < -1) return {label: new Date(d+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'}), color: RED, over: true}
  if (diff === -1) return {label: 'Ayer', color: RED, over: true}
  if (diff === 0)  return {label: 'Hoy', color: AMB, over: false}
  if (diff === 1)  return {label: 'Mañana', color:'#FFFFFF', over: false}
  return {label: new Date(d+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'}), color: 'rgba(255,255,255,0.32)', over: false}
}

// «Esta semana» es un rango de DIAS, no de instantes.
//
// Antes el limite era `new Date(Date.now() + 7*24h)` —o sea la hora que fuese,
// dentro de siete dias— y se comparaba contra las 23:59:59 del dia de
// vencimiento. La tarea que vence dentro de 7 dias EXACTOS caia siempre fuera:
// sus 23:59:59 son posteriores al limite durante todo el dia, y a la hora en que
// dejarian de serlo ya faltan 6 dias. La pestaña escondia un dia entero de
// tareas y el contador de la pestaña mentia con ella.
//
// Comparando day keys de Madrid la hora deja de importar. Los vencidos siguen
// contando (dias negativos), como en la version anterior.
const dentroDeLaSemana = (hoy: string, due?: string|null) =>
  !!due && daysBetweenKeys(hoy, due.slice(0,10)) <= 7

const HARVEY_SUGGESTIONS = [
  { text: 'Revisar y responder mensajes de clientes pendientes', level: 'urgent' },
  { text: 'Planificar contenido de redes sociales para la semana', level: 'high' },
  { text: 'Actualizar el estado de proyectos activos', level: 'high' },
  { text: 'Revisar métricas de publicaciones recientes', level: 'normal' },
]

interface PropsHarveyTaskSuggestions {
  data: NexusData
  onOpenModal: any
  onCreateTask: any
}

function HarveyTaskSuggestions({ data, onOpenModal, onCreateTask }: PropsHarveyTaskSuggestions) {
  const [creating, setCreating] = useState<string|null>(null)
  const [created, setCreated] = useState<Set<string>>(new Set())

  /**
   * UNA sugerencia, no cuatro.
   *
   * Javi: «no quiero que sugiera tantas tareas, quiero que sugiera una».
   *
   * Y no la primera de la lista: la primera que NO tengas ya. Sugerir «revisar
   * mensajes pendientes» a alguien que acaba de crear esa misma tarea no es
   * ayudar, es ruido — y es lo que hacía enseñándolas las cuatro a la vez, porque
   * al menos una siempre sobraba.
   *
   * Si ya las tienes todas, no se enseña ninguna: el panel entero desaparece. Un
   * hueco vacío que dice «HARVEY SUGIERE» y no sugiere nada es peor que no estar.
   */
  const sugerencia = (() => {
    const yaEstan = new Set(
      (data.tasks || [])
        .filter((t: Task) => !t.done)
        .map((t: Task) => (t.text || '').trim().toLowerCase()))
    const libre = HARVEY_SUGGESTIONS.find(s => !yaEstan.has(s.text.toLowerCase()) && !created.has(s.text))
    return libre ? [libre] : []
  })()

  const handleCreate = async (text: string, level: string) => {
    setCreating(text)
    try {
      await onCreateTask(text, level)
      // El setCreated va DENTRO del try. Antes se ejecutaba pasara lo que pasara:
      // la sugerencia se tachaba como creada aunque la tarea no existiera, y
      // encima el boton quedaba deshabilitado, asi que no habia forma de
      // reintentarlo sin recargar.
      setCreated(prev => new Set([...prev, text]))
    } catch {
      // El aviso ya lo da onCreateTask; aqui basta con no tacharla.
    } finally {
      setCreating(null)
    }
  }

  // Sin nada que sugerir, no se pinta el panel. Un recuadro que anuncia «HARVEY
  // SUGIERE» y está vacío ocupa sitio y no dice nada.
  if (!sugerencia.length) return null

  return (
    <div className="rounded-2xl p-6" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{background:`${BLU}18`,border:`1px solid ${BLU}30`}}>
          <LucideIcon name="sparkles" size={12} color={BLU}/>
        </div>
        <span className="font-syne text-[9px] font-black tracking-[0.2em]" style={{color:'rgba(255,255,255,0.28)'}}>HARVEY SUGIERE</span>
      </div>
      <p className="font-figtree text-[13px] mb-5" style={{color:'rgba(255,255,255,0.35)'}}>
        Por dónde empezar hoy, o crea la tuya.
      </p>
      <div className="flex flex-col gap-2">
        {sugerencia.map(s => {
          const done = created.has(s.text)
          const busy = creating === s.text
          const pri = PRIMAP[s.level] || PRIMAP.normal
          return (
            <button key={s.text} disabled={done||busy} onClick={()=>handleCreate(s.text, s.level)}
              className="flex items-center gap-3 w-full text-left px-4 py-3 rounded-xl transition-all"
              style={{background:done?`${GRN}0d`:`${SURF2}`,border:`1px solid ${done?GRN+'28':BORDER}`,opacity:done?0.6:1,cursor:done?'default':'pointer'}}>
              <div className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center" style={{border:`1.5px solid ${done?GRN:pri.color}40`}}>
                {done ? <LucideIcon name="check" size={10} color={GRN}/> : busy ? <div className="w-2 h-2 rounded-full" style={{background:BLU,animation:'pulse 1s infinite'}}/> : null}
              </div>
              <span className="font-figtree text-[13px] flex-1" style={{color:done?'#FFFFFF':'rgba(255,255,255,0.7)'}}>{s.text}</span>
              <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full flex-shrink-0" style={{color:pri.color,background:`${pri.color}14`,border:`1px solid ${pri.color}28`}}>{pri.label}</span>
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-3 mt-4 pt-4" style={{borderTop:`1px solid ${BORDER}`}}>
        <button onClick={()=>onOpenModal('tarea')}
          className="font-syne text-[9px] font-black px-4 py-2 rounded-xl flex items-center gap-1.5"
          style={{background:`${BLU}18`,color:BLU,border:`1px solid ${BLU}30`}}>
          <LucideIcon name="plus" size={11} color={BLU}/> Nueva tarea
        </button>
        <span className="font-figtree text-[11px]" style={{color:'rgba(255,255,255,0.2)'}}>o añade la tuya propia</span>
      </div>
    </div>
  )
}

interface PropsTareas {
  data: NexusData
  onOpenModal: any
  showToast: any
  isOwner: any
  profile: any
  onNavigate: IrASeccion
  onSelectProject: any
  initialView: any
  initialFocus: any
  initialGroupBy: any
  /**
   * Lo pasan NexusDashboard (`setSelectedClient`) y PreviewClient, y esta seccion
   * NO lo usa: el componente nunca lo desestructuro, asi que hacer clic en el
   * cliente de una tarea no navega a su ficha. Estaba oculto tras el `any` de los
   * props. Se declara para que el tipo no mienta; o se cablea o se quita de los
   * dos llamantes.
   */
  onSelectClient?: (id: string) => void
}

function TareasSection({data,onOpenModal,showToast,isOwner,profile,onNavigate,onSelectProject,initialView,initialFocus,initialGroupBy}: PropsTareas) {
  const isMobile = useIsMobile()
  const [view,           setView]           = useState<'lista'|'kanban'|'calendario'>(initialView||'lista')
  const [tabFilter,      setTabFilter]      = useState<'todas'|'hoy'|'semana'|'sin_fecha'|'completadas'>('todas')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [projectFilter,  setProjectFilter]  = useState('all')
  // Los tres desplegables ocupaban 148px — el bloque más alto de la cabecera en
  // móvil. Con la altura útil real de un iPhone (622px, ya sin la cabecera de la
  // app ni la barra de pestañas) la primera tarea caía en el píxel 810: un 130% de
  // pantalla antes de ver una sola, en la sección que más se usa. Plegados por
  // defecto, con aviso si alguno está activo — para que nadie crea que le faltan
  // tareas cuando en realidad las está filtrando.
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false)
  const [priorityFilter, setPriorityFilter] = useState<'all'|'urgent'|'high'|'normal'>('all')
  const [searchText,     setSearchText]     = useState('')
  // `fecha` de fábrica, no `prioridad`: es lo que la pantalla lleva enseñando desde
  // siempre —los cuatro cajones de ATRASADAS/HOY/PRÓXIMAS/SIN FECHA— y cambiar la
  // vista por defecto de todo el mundo para arreglar un botón sería cobrarle a
  // todos el arreglo de uno. Ahora el botón cambia algo de verdad; cuál viene
  // marcado al entrar es otra decisión, y esa se queda como estaba.
  const [taskSort,       setTaskSort]       = useState<'prioridad'|'fecha'>('fecha')
  const [focusMode,      setFocusMode]      = useState(!!initialFocus)
  const [activeTask,     setActiveTask]     = useState<Task|null>(null)
  // Espejo en ref del estado. Los `.then()` de una peticion capturan el closure del
  // render en que se lanzaron, asi que dentro no se puede consultar `activeTask`
  // para saber cual es la tarea abierta AHORA.
  const activeTaskRef = useRef(activeTask)
  activeTaskRef.current = activeTask
  useBackClosable(!!activeTask, ()=>setActiveTask(null))
  const [editing,        setEditing]        = useState<Partial<Task>>({})
  const [saving,         setSaving]         = useState(false)
  const [confirmDelete,  setConfirmDelete]  = useState(false)
  const [confirmLimpiar, setConfirmLimpiar] = useState(false)
  // Borrar un adjunto destruye el fichero del bucket, y eso no se deshace. Era un
  // solo toque, sin confirmar y sin decir que se llevaba tambien el archivo — y el
  // boton esta ahora visible en tactil, asi que se roza sin querer. Mismo patron de
  // doble toque que ya usan LIMPIAR COMPLETADAS y el borrado de tarea.
  const [confirmAdjunto, setConfirmAdjunto] = useState<string|null>(null)
  // Subtasks
  const [subtasks,      setSubtasks]      = useState<any[]>([])
  const [subtasksLoaded,setSubtasksLoaded]= useState<string|null>(null)
  const [stText,        setStText]        = useState('')
  const [stAdding,      setStAdding]      = useState(false)
  // Attachments
  const [attachments,     setAttachments]     = useState<any[]>([])
  const [attachLoaded,    setAttachLoaded]    = useState<string|null>(null)
  const [uploadProgress,  setUploadProgress]  = useState<number|null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const filteredRef = useRef<Task[]>([])
  const dueDateRef  = useRef<HTMLInputElement>(null)
  const saveRef     = useRef<()=>void>(()=>{})
  const savingRef   = useRef(false)

  useEffect(()=>{
    const h = (e: KeyboardEvent) => {
      // Con un modal abierto el foco esta en BODY, asi que la guarda por tagName
      // de mas abajo no protege: escribir en el formulario ejecutaba estos atajos.
      if (hayModalAbierto()) return
      if (e.key==='Escape'&&activeTask) { setActiveTask(null); return }
      if (e.key==='n'&&!activeTask&&!['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)&&!(e.metaKey||e.ctrlKey||e.altKey)) {
        e.preventDefault(); onOpenModal('tarea'); return
      }
      if ((e.key==='j'||e.key==='k')&&!['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault()
        const tasks = filteredRef.current
        const idx = activeTask ? tasks.findIndex(t=>t.id===activeTask.id) : -1
        const next = e.key==='j' ? Math.min(idx+1,tasks.length-1) : Math.max(idx-1,0)
        const t = tasks[next]
        if (t) { setActiveTask(t); setEditing({text:t.text,level:t.level,assigned_to:t.assigned_to,co_assigned_to:t.co_assigned_to,done:t.done,due_date:t.due_date,project_id:t.project_id,notes:t.notes}); setConfirmDelete(false) }
      }
      if (activeTask&&!['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)&&!(e.metaKey||e.ctrlKey||e.altKey)) {
        if (e.key==='c') { e.preventDefault(); setEditing(x=>({...x,done:!x.done})) }
        if (e.key==='d') { e.preventDefault(); dueDateRef.current?.focus() }
        if (e.key==='l') { e.preventDefault(); setEditing(x=>{const ls=['normal','high','urgent'] as const;const ci=ls.indexOf(x.level as any);return{...x,level:ls[(ci+1)%ls.length]}}) }
        if (e.key==='s'&&!savingRef.current) { e.preventDefault(); saveRef.current() }
      }
    }
    window.addEventListener('keydown', h)
    return ()=>window.removeEventListener('keydown', h)
  }, [activeTask, onOpenModal])

  // Los campos del panel, en un solo sitio: `openTask` los carga y `hayCambios`
  // los compara. Escritos dos veces se desincronizan, y el que se olvide en la
  // comparacion es un campo cuyos cambios se pierden sin avisar.
  const camposEditables = (t: Task) => ({
    text:t.text, level:t.level, assigned_to:t.assigned_to, co_assigned_to:t.co_assigned_to,
    done:t.done, due_date:t.due_date, project_id:t.project_id, notes:t.notes,
  })

  // ¿Hay algo escrito en el panel que no este guardado?
  //
  // El panel es un formulario que NO guarda solo, y pinchar otra tarea lo
  // recargaba entero: las notas que acabaras de escribir desaparecian sin aviso
  // y sin forma de recuperarlas. Es la clase de perdida que el usuario ni
  // atribuye a un bug — cree que no lo escribio.
  const hayCambios = (): boolean => {
    if (!activeTask) return false
    const guardado = camposEditables(activeTask) as Record<string, unknown>
    return Object.keys(guardado).some(k => (editing as Record<string, unknown>)[k] !== guardado[k])
  }

  const openTask = (t: Task) => {
    // Solo avisa al CAMBIAR de tarea. Volver a pinchar la que ya esta abierta no
    // recarga nada, asi que no hay nada que perder.
    if (activeTask && activeTask.id !== t.id && hayCambios()) {
      showToast('Tienes cambios sin guardar en esta tarea')
      return
    }
    setActiveTask(t)
    setEditing(camposEditables(t))
    setConfirmDelete(false)
  }
  const saveTask = async () => {
    if (!activeTask) return
    setSaving(true)
    try {
      // Solo lo que el usuario ha CAMBIADO en el cajon, no `editing` entero.
      //
      // `editing` es una foto congelada de cuando abriste el cajon: no hay ningun
      // useEffect que lo resincronice con data.tasks. Si mientras tanto marcas la
      // tarea como hecha desde la lista de al lado —en escritorio conviven, y en
      // el tablero la tarjeta se queda a la vista al moverse a HECHO—, GUARDAR
      // mandaba el `done: false` viejo y la resucitaba. Peor: la ruta hace
      // pick(body, [...'done'...]) y al llegar `done` como booleano ademas pone
      // `completed_at` a null, asi que la fecha de finalizacion se pierde en
      // silencio y Reportes cambia de semana.
      //
      // `hayCambios()` tampoco avisaba, porque compara contra el mismo activeTask
      // obsoleto. Mandando solo los campos tocados, un valor que no has editado no
      // puede pisar al de nadie.
      const guardado = camposEditables(activeTask) as Record<string, unknown>
      const cambios: Record<string, unknown> = {}
      for (const k of Object.keys(guardado)) {
        if ((editing as Record<string, unknown>)[k] !== guardado[k]) cambios[k] = (editing as Record<string, unknown>)[k]
      }
      if (Object.keys(cambios).length === 0) {
        showToast('No hay cambios que guardar'); setActiveTask(null); return
      }
      await data.updateTask(activeTask.id, cambios)
      showToast('Tarea actualizada')
      setActiveTask(null)
    }
    catch { showToast('Error al guardar') }
    finally { setSaving(false) }
  }
  saveRef.current = saveTask
  savingRef.current = saving

  useEffect(()=>{
    if (activeTask && activeTask.id !== subtasksLoaded) {
      // `vigente` ata esta carga a la tarea que la pidio. Abrir la tarea A y pasar
      // enseguida a la B dejaba dos peticiones en vuelo, y si la de A llegaba
      // despues se pintaban las subtareas de A bajo la B — con setSubtasksLoaded(A)
      // ademas quedaba marcado como "ya cargado", asi que no se corregia nunca:
      // los adjuntos y subtareas de una tarea se quedaban pegados en otra hasta
      // recargar la pagina.
      const idPedido = activeTask.id
      const vigente = () => activeTaskRef.current?.id === idPedido
      fetch(`/api/tasks/subtasks?taskId=${idPedido}`).then(async r=>{
        if (!r.ok) throw new Error('carga')
        return r.json()
      }).then(d=>{
        if (!vigente()) return
        setSubtasks(Array.isArray(d)?d:[])
        setSubtasksLoaded(idPedido)
        setStText('')
      }).catch(()=>{
        if (!vigente()) return
        // "Sin subtareas" y "no se pudieron cargar" se veian igual, y quien lo
        // creia volvia a crearlas: subtareas duplicadas al recargar.
        showToast('No se pudieron cargar las subtareas')
        setSubtasks([]); setSubtasksLoaded(idPedido)
      })
    }
    if (!activeTask) { setSubtasks([]); setSubtasksLoaded(null); setStText('') }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTask?.id])

  useEffect(()=>{
    if (activeTask && activeTask.id !== attachLoaded) {
      // Misma guarda que el efecto de subtareas de arriba, y por lo mismo: abrir la
      // tarea A y pasar enseguida a la B deja DOS peticiones en vuelo, y si la de A
      // llega despues pinta SUS adjuntos bajo la B. Peor: setAttachLoaded(A) deja el
      // efecto por «ya cargado», las deps no cambian y no se corrige nunca — la B
      // enseña los adjuntos de la A mientras siga abierta. Y al intentar borrar uno,
      // el DELETE va contra /api/tasks/B/... con el id de A, la ruta filtra por
      // task_id, devuelve 404 y sale un error que no explica nada.
      const idPedido = activeTask.id
      const vigente = () => activeTaskRef.current?.id === idPedido
      fetch(`/api/tasks/${idPedido}/attachments`).then(async r=>{
        if (!r.ok) throw new Error('carga')
        return r.json()
      }).then(d=>{
        if (!vigente()) return
        setAttachments(Array.isArray(d)?d:[])
        setAttachLoaded(idPedido)
      }).catch(()=>{
        if (!vigente()) return
        showToast('No se pudieron cargar los adjuntos')
        setAttachments([]); setAttachLoaded(idPedido)
      })
    }
    if (!activeTask) { setAttachments([]); setAttachLoaded(null) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTask?.id])

  // Las tres funciones de subtareas fijan la tarea AL EMPEZAR, igual que hacen
  // uploadAttachment y los dos efectos de carga de arriba. La peticion siempre iba
  // a la tarea correcta —la lleva el closure—, pero la lista de PANTALLA se tocaba
  // al responder: escribes una subtarea en la tarea A, pulsas Enter y saltas a la B
  // con j/k antes de que conteste el servidor, y la subtarea aparece listada bajo
  // la B (creada en A, pintada en B) hasta recargar. Los avisos de error si se dan
  // siempre: el fallo es de una accion que el usuario acaba de pedir.
  const addSubtask = async () => {
    if (!stText.trim() || !activeTask) return
    const idTarea = activeTask.id
    setStAdding(true)
    try {
      const res = await fetch('/api/tasks/subtasks', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({taskId:idTarea,text:stText.trim()}) })
      const st = await res.json()
      if (!res.ok) throw new Error(st.error)
      if (activeTaskRef.current?.id !== idTarea) return
      setSubtasks(s=>[...s, st])
      setStText('')
    } catch { showToast('Error al crear subtarea') }
    finally { setStAdding(false) }
  }

  const toggleSubtask = async (st: any) => {
    const idTarea = activeTaskRef.current?.id
    try {
      const res = await fetch('/api/tasks/subtasks', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id:st.id,done:!st.done}) })
      const updated = await res.json()
      // Sin esta comprobacion el cuerpo del error sustituia a la subtarea en la
      // lista: se quedaba sin texto y sin id, o sea que desaparecia de pantalla
      // sin ningun aviso y volvia al recargar.
      if (!res.ok) { showToast(updated?.error || 'No se pudo actualizar la subtarea'); return }
      if (activeTaskRef.current?.id !== idTarea) return
      setSubtasks(s=>s.map(x=>x.id===st.id?updated:x))
    } catch { showToast('Error al actualizar la subtarea') }
  }

  // `fetch` NO lanza con 4xx/5xx: solo si se cae la red. Sin mirar r.ok, un fallo
  // del servidor quitaba la subtarea de la pantalla igualmente y reaparecia al
  // recargar — la app decia haber borrado algo que seguia ahi.
  const deleteSubtask = async (id: string) => {
    const idTarea = activeTaskRef.current?.id
    try {
      const r = await fetch(`/api/tasks/subtasks?id=${id}`, { method:'DELETE' })
      if (!r.ok) {
        const e = await r.json().catch(()=>({}))
        showToast(e.error || 'No se pudo eliminar la subtarea')
        return
      }
      if (activeTaskRef.current?.id !== idTarea) return
      setSubtasks(s=>s.filter(x=>x.id!==id))
    } catch { showToast('Error al eliminar') }
  }

  const uploadAttachment = async (file: File) => {
    if (!activeTask) return
    // La tarea se fija AQUI, al empezar. Subir el fichero al bucket y registrarlo
    // son varios segundos, y el id se leia al final: si cambiabas de tarea mientras
    // tanto, el adjunto se registraba contra la tarea que estuvieras mirando. Mismo
    // patron que ya se corrigio en onPickPdf de Proyectos.
    const tareaId = activeTask.id
    setUploadProgress(0)
    try {
      const rUrl = await fetch('/api/pdf-upload-url', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ filename: file.name, size: file.size, prefix: 'task-attachments' })
      })
      const { signedUrl, publicUrl, error: errUrl } = await rUrl.json()
      // Sin esto, signedUrl venia undefined y el PUT se hacia contra la cadena
      // "undefined": el fallo aparecia mucho despues y sin relacion con la causa
      // real (fichero demasiado grande, tipo no permitido...).
      if (!rUrl.ok || !signedUrl) { showToast(errUrl || 'No se pudo preparar la subida'); return }
      const xhr = new XMLHttpRequest()
      await new Promise<void>((resolve, reject) => {
        xhr.upload.onprogress = e => { if (e.lengthComputable) setUploadProgress(Math.round(e.loaded/e.total*100)) }
        xhr.onload = () => xhr.status < 300 ? resolve() : reject()
        xhr.onerror = reject
        xhr.open('PUT', signedUrl)
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
        xhr.send(file)
      })
      const rAtt = await fetch(`/api/tasks/${tareaId}/attachments`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ name: file.name, url: publicUrl, size: file.size, mime_type: file.type||null })
      })
      const att = await rAtt.json()
      // El fichero ya esta subido al bucket; lo que falla aqui es registrarlo. Sin
      // la comprobacion se anadia el objeto de error a la lista Y se decia
      // "Archivo adjuntado": el adjunto no existia y nadie se enteraba.
      if (!rAtt.ok) { showToast(att?.error || 'El archivo se subio pero no se pudo adjuntar'); return }
      // La lista solo se toca si sigues en la tarea de la subida; el registro ya se
      // hizo contra la correcta pase lo que pase.
      if (activeTaskRef.current?.id === tareaId) setAttachments(a=>[...a, att])
      showToast('Archivo adjuntado')
    } catch { showToast('Error al subir el archivo') }
    finally { setUploadProgress(null) }
  }

  const deleteAttachment = async (att: any) => {
    if (!activeTask) return
    try {
      const r = await fetch(`/api/tasks/${activeTask.id}/attachments?attachmentId=${att.id}`, { method:'DELETE' })
      if (!r.ok) {
        const e = await r.json().catch(()=>({}))
        showToast(e.error || 'No se pudo eliminar el adjunto')
        return
      }
      setAttachments(a=>a.filter(x=>x.id!==att.id))
    } catch { showToast('Error al eliminar adjunto') }
  }

  const todayStr = todayKey()

  const counts = useMemo(()=>({
    pendientes:  data.tasks.filter((t:Task)=>!t.done).length,
    hoy:         data.tasks.filter((t:Task)=>!t.done&&!!t.due_date&&t.due_date.slice(0,10)===todayStr).length,
    atrasadas:   data.tasks.filter((t:Task)=>!t.done&&!!t.due_date&&new Date(t.due_date+'T23:59:59')<new Date(todayStr+'T00:00:00')).length,
    completadas: data.tasks.filter((t:Task)=>t.done).length,
    total:       data.tasks.length,
    semana:      data.tasks.filter((t:Task)=>!t.done&&dentroDeLaSemana(todayStr,t.due_date)).length,
    sinFecha:    data.tasks.filter((t:Task)=>!t.done&&!t.due_date).length,
  }), [data.tasks, todayStr])

  const pct = counts.total > 0 ? Math.round((counts.completadas/counts.total)*100) : 0
  const activeFilters = [assigneeFilter!=='all',projectFilter!=='all',priorityFilter!=='all'].filter(Boolean).length

  // "Mi día" (focus): mis tareas pendientes que son urgentes o están vencidas.
  const isMine = (t:Task) => !!profile?.id && (t.assigned_to===profile.id || t.co_assigned_to===profile.id)
  const isFocusTask = (t:Task) => {
    if (t.done) return false
    if (!isMine(t)) return false
    const over = !!t.due_date && new Date(t.due_date+'T23:59:59') < new Date(todayStr+'T00:00:00')
    return t.level==='urgent' || over
  }

  const filtered = useMemo(()=>{
    return data.tasks.filter((t:Task)=>{
      if (focusMode && !isFocusTask(t)) return false
      if (searchText && !buscaEnTexto(`${t.text} ${(t.assignee as any)?.name||''} ${(t.client as any)?.name||''}`, searchText)) return false
      if (assigneeFilter!=='all' && t.assigned_to !== assigneeFilter && t.co_assigned_to !== assigneeFilter) return false
      if (projectFilter!=='all' && t.project_id !== projectFilter) return false
      if (priorityFilter!=='all' && t.level !== priorityFilter) return false
      if (focusMode) return !t.done
      return tabFilter==='todas'     ? !t.done
           : tabFilter==='hoy'       ? (!t.done&&!!t.due_date&&t.due_date.slice(0,10)===todayStr)
           : tabFilter==='semana'    ? (!t.done&&dentroDeLaSemana(todayStr,t.due_date))
           : tabFilter==='sin_fecha' ? (!t.done&&!t.due_date)
           : t.done
    }).sort((a:Task,b:Task)=>{
      if (tabFilter==='completadas') return new Date(b.updated_at||b.created_at).getTime()-new Date(a.updated_at||a.created_at).getTime()
      if (taskSort==='fecha') {
        const aT = a.due_date ? new Date(a.due_date+'T23:59:59').getTime() : Infinity
        const bT = b.due_date ? new Date(b.due_date+'T23:59:59').getTime() : Infinity
        return aT-bT
      }
      const aO = a.due_date&&new Date(a.due_date+'T23:59:59')<new Date() ? -1 : 0
      const bO = b.due_date&&new Date(b.due_date+'T23:59:59')<new Date() ? -1 : 0
      if (aO!==bO) return aO-bO
      const lp=(l:string)=>l==='urgent'?0:l==='high'?1:2
      return lp(a.level)-lp(b.level)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.tasks,searchText,assigneeFilter,projectFilter,priorityFilter,tabFilter,taskSort,todayStr,focusMode,profile?.id])

  filteredRef.current = filtered

  const focusCount = useMemo(()=>data.tasks.filter(isFocusTask).length, [data.tasks, profile?.id, todayStr]) // eslint-disable-line react-hooks/exhaustive-deps

  const exportCSV = () => {
    const rows = filteredRef.current
    if (!rows.length) { showToast('No hay tareas para exportar'); return }
    const esc = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s }
    const prLabel = (l:string) => rotuloNivel(l)
    const header = ['Tarea','Prioridad','Estado','Vencimiento','Responsable','Proyecto','Notas']
    const lines = rows.map((t:Task)=>{
      const proj = t.project_id ? data.projects.find((p:Project)=>p.id===t.project_id) : null
      return [t.text, prLabel(t.level), t.done?'Completada':'Pendiente', t.due_date?t.due_date.slice(0,10):'', t.assignee?.name||'', proj?.name||'', t.notes||''].map(esc).join(',')
    })
    const csv = '﻿' + [header.join(','), ...lines].join('\n')
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `tareas-${todayKey()}.csv`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    showToast(`${rows.length} ${rows.length===1?'tarea exportada':'tareas exportadas'}`)
  }

  // Dataset del Kanban: mismos filtros de búsqueda/responsable/proyecto, pero
  // sin el filtro de pestaña (las columnas ya representan estado/prioridad) e
  // incluyendo las completadas (columna "Hecho").
  const kanbanTasks = useMemo(()=>{
    return data.tasks.filter((t:Task)=>{
      if (searchText && !buscaEnTexto(`${t.text} ${(t.assignee as any)?.name||''} ${(t.client as any)?.name||''}`, searchText)) return false
      if (assigneeFilter!=='all' && t.assigned_to !== assigneeFilter && t.co_assigned_to !== assigneeFilter) return false
      if (projectFilter!=='all' && t.project_id !== projectFilter) return false
      return true
    })
  }, [data.tasks,searchText,assigneeFilter,projectFilter])

  const grouped = useMemo(()=>{
    // AGRUPAR POR FECHA ES *ORDENAR* POR FECHA, y por eso lo decide el mismo botón.
    //
    // Javi: «con estos 2 botones en tareas no pasa nada». Y era verdad: el orden se
    // calculaba bien —lo hace `filtered`— pero en la pestaña «Todas» la lista NO se
    // pinta en plano, se reparte en ATRASADAS / HOY / PRÓXIMAS / SIN FECHA. Esos
    // cuatro cajones SON una ordenación por fecha, así que se comían cualquier otra:
    // una tarea urgente para el mes que viene seguía cayendo en PRÓXIMAS, debajo de
    // todo, por mucho que pulsaras «por prioridad».
    //
    // Ahora el botón elige entre las dos formas de mirar la misma lista:
    //   · por fecha     → los cuatro cajones, que es lo que había
    //   · por prioridad → lista plana, urgentes arriba (y las vencidas por delante,
    //                     que eso ya lo hacía el comparador)
    if (taskSort==='prioridad') return null
    if (tabFilter!=='todas') return null
    const over:Task[]=[],today:Task[]=[],upcoming:Task[]=[],nodate:Task[]=[]
    filtered.forEach((t:Task)=>{
      if (!t.due_date) { nodate.push(t); return }
      const d = t.due_date.slice(0,10)
      if (new Date(d+'T23:59:59')<new Date(todayStr+'T00:00:00')) { over.push(t); return }
      if (d===todayStr) { today.push(t); return }
      upcoming.push(t)
    })
    return {over,today,upcoming,nodate}
  }, [filtered,tabFilter,todayStr,taskSort])

  const TABS = [
    {id:'todas'      as const, label:'Todas',       short:'Todas',    count: counts.pendientes},
    {id:'hoy'        as const, label:'Hoy',         short:'Hoy',      count: counts.hoy},
    {id:'semana'     as const, label:'Esta semana', short:'Semana',   count: counts.semana},
    {id:'sin_fecha'  as const, label:'Sin fecha',   short:'Sin fecha',count: counts.sinFecha},
    {id:'completadas'as const, label:'Completadas', short:'Hechas',   count: counts.completadas},
  ]

  const lc = (l:string) => l==='urgent'?RED:l==='high'?AMB:BLU

  // ── Mobile Task Row ─────────────────────────────────────────────────────────
  // Igual que en el tablero: NO son componentes, son funciones que devuelven JSX.
  // Declaradas dentro de TareasSection, usarlas como <Componente/> hacia que el
  // tipo del elemento cambiase por identidad en cada render, asi que React
  // desmontaba y volvia a montar TODA la lista en vez de actualizarla — incluido
  // el sondeo periodico de notificaciones, que re-renderiza sin que nadie toque
  // nada. Van en minuscula para que no inviten a usarlas como etiqueta otra vez.
  const renderFilaMovil = (t: Task, last: boolean) => {
    const pri  = PRIMAP[t.level]||PRIMAP.normal
    const proj = t.project_id ? data.projects.find((p:Project)=>p.id===t.project_id) : null
    const due  = t.due_date ? relDate(t.due_date) : null
    const active = activeTask?.id===t.id
    const canComplete = true
    const isOver = due?.over && !t.done
    return (
      <div key={t.id} onClick={()=>openTask(t)}
        className="flex items-center gap-3 cursor-pointer transition-colors"
        style={{
          background: active ? 'rgba(27,95,250,0.06)' : isOver ? 'rgba(229,29,42,0.025)' : 'transparent',
          borderBottom: last ? 'none' : `1px solid ${BORDER}`,
          borderLeft: `3px solid ${t.done ? 'rgba(255,255,255,0.06)' : pri.color}`,
          padding: '12px 14px 12px 12px',
        }}>
        <button
          onClick={e=>{e.stopPropagation();canComplete&&data.toggleTask(t.id).catch(()=>showToast('No se pudo marcar — vuelve a intentarlo'))}}
          // La casilla de completar es el control mas usado de la app y no tenia
          // nombre accesible: solo un div redondo dentro, sin texto ni icono, asi
          // que un lector de pantalla la anunciaba como «boton» a secas. Con
          // aria-pressed ademas se puede saber si la tarea esta hecha sin verla.
          aria-label={t.done ? `Marcar «${t.text}» como pendiente` : `Completar «${t.text}»`}
          aria-pressed={t.done}
          disabled={!canComplete}
          title={canComplete ? undefined : 'Solo el responsable o quien la creó puede completarla'}
          style={{width:'36px',height:'36px',borderRadius:'50%',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',background:t.done?pri.color+'18':'transparent',cursor:canComplete?'pointer':'not-allowed',opacity:canComplete?1:0.4}}>
          <div style={{width:'20px',height:'20px',borderRadius:'50%',border:`2px solid ${t.done?lc(t.level):canComplete?lc(t.level)+'60':'rgba(255,255,255,0.12)'}`,background:t.done?lc(t.level):'transparent',display:'flex',alignItems:'center',justifyContent:'center'}}>
            {t.done && <LucideIcon name="check" size={10} color="white"/>}
          </div>
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-figtree text-[13px] font-semibold truncate"
            style={{color:t.done?'rgba(255,255,255,0.25)':'rgba(255,255,255,0.9)',textDecoration:t.done?'line-through':'none'}}>
            {t.text}
          </div>
          {/* Mini leyenda */}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {/* Estado */}
            <span className="font-syne text-[7.5px] font-black px-1.5 py-0.5 rounded-md"
              style={{background:t.done?'rgba(34,197,94,0.1)':'rgba(255,255,255,0.05)',color:t.done?'rgba(34,197,94,0.8)':'rgba(255,255,255,0.3)'}}>
              {t.done?'HECHA':'PENDIENTE'}
            </span>
            {/* Prioridad */}
            <span className="font-syne text-[7.5px] font-black px-1.5 py-0.5 rounded-md"
              style={{background:pri.color+'12',color:pri.color+'cc'}}>
              {pri.label}
            </span>
            {/* Fecha límite */}
            {due && <span className="font-syne text-[7.5px] font-black" style={{color:due.color}}>
              <span style={{color:'rgba(255,255,255,0.2)'}}>· </span>{due.label}
            </span>}
            {/* Notas */}
            {t.notes && (
              <span className="flex items-center gap-0.5">
                <LucideIcon name="file-text" size={9} color="rgba(255,255,255,0.25)"/>
              </span>
            )}
            {/* Proyecto */}
            {proj && <span className="font-syne text-[7.5px] font-black px-1.5 py-0.5 rounded-md" style={{background:(proj.color||BLU)+'12',color:(proj.color||BLU)+'aa'}}>
              <span style={{color:'rgba(255,255,255,0.2)'}}>· </span>{proj.name}
            </span>}
            {/* Asignado */}
            {t.assignee && (
              <div className="flex items-center gap-0.5 ml-0.5">
                <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center font-syne text-[6px] font-black flex-shrink-0" style={{background:t.assignee.avatar_color+'25',color:t.assignee.avatar_color}}>{t.assignee.initials}</div>
                {t.co_assignee && <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center font-syne text-[6px] font-black -ml-0.5 flex-shrink-0" style={{background:t.co_assignee.avatar_color+'25',color:t.co_assignee.avatar_color,border:`1px solid #030308`}}>{t.co_assignee.initials}</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Desktop Task Row ─────────────────────────────────────────────────────────
  // Grid: 28px | 1fr | 116px | 72px | 80px | 100px | 28px
  const COLS = '28px 1fr 116px 72px 80px 100px 28px'

  const renderFilaEscritorio = (t: Task, last: boolean) => {
    const pri  = PRIMAP[t.level]||PRIMAP.normal
    const proj = t.project_id ? data.projects.find((p:Project)=>p.id===t.project_id) : null
    const due  = t.due_date ? relDate(t.due_date) : null
    const active = activeTask?.id===t.id
    const canComplete = true
    const isOver = due?.over && !t.done
    return (
      <div key={t.id} onClick={()=>openTask(t)} className="group cursor-pointer transition-all"
        style={{
          display:'grid', gridTemplateColumns: COLS,
          alignItems: 'center', gap: '0 12px',
          padding: '0 20px',
          height: '52px',
          background: active ? 'rgba(27,95,250,0.05)' : isOver ? 'rgba(229,29,42,0.018)' : 'transparent',
          borderBottom: last ? 'none' : `1px solid ${BORDER}`,
          borderLeft: `3px solid ${t.done ? 'rgba(255,255,255,0.04)' : pri.color+'70'}`,
        }}
        onMouseEnter={e=>{if(!active&&!isOver)(e.currentTarget as HTMLElement).style.background='rgba(255,255,255,0.014)'}}
        onMouseLeave={e=>{if(!active&&!isOver)(e.currentTarget as HTMLElement).style.background='transparent'}}>

        {/* Checkbox */}
        <button onClick={e=>{e.stopPropagation();canComplete&&data.toggleTask(t.id).catch(()=>showToast('No se pudo marcar — vuelve a intentarlo'))}}
          aria-label={t.done ? `Marcar «${t.text}» como pendiente` : `Completar «${t.text}»`} aria-pressed={t.done} disabled={!canComplete}
          title={undefined}
          className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-all"
          style={{background:t.done?lc(t.level):'transparent',borderColor:t.done?lc(t.level):canComplete?lc(t.level)+'50':'rgba(255,255,255,0.1)',cursor:canComplete?'pointer':'not-allowed',opacity:canComplete?1:0.5}}>
          {t.done&&<LucideIcon name="check" size={9} color="white"/>}
        </button>

        {/* Title */}
        <span className="font-figtree text-[13.5px] font-semibold truncate min-w-0"
          style={{color:t.done?'rgba(255,255,255,0.22)':'rgba(255,255,255,0.9)',textDecoration:t.done?'line-through':'none'}}>
          {t.text}
        </span>

        {/* Project */}
        <div>
          {proj?(
            <button onClick={e=>{e.stopPropagation();onSelectProject?.(proj.id);onNavigate?.('proyectos')}}
              className="font-syne text-[8px] font-black px-2.5 py-1 rounded-lg whitespace-nowrap transition-all hover:opacity-75 max-w-full truncate"
              style={{background:(proj.color||BLU)+'16',color:(proj.color||BLU)+'cc',display:'block'}}>
              {proj.name}
            </button>
          ):(
            <span className="font-syne text-[9px]" style={{color:'rgba(255,255,255,0.12)'}}>—</span>
          )}
        </div>

        {/* Priority */}
        <span className="font-syne text-[8px] font-black px-2.5 py-1 rounded-lg text-center"
          style={{background:t.done?'rgba(255,255,255,0.04)':pri.color+'14',color:t.done?'rgba(255,255,255,0.2)':pri.color}}>
          {pri.label}
        </span>

        {/* Due date */}
        <span className="font-figtree text-[12px]" style={{color:due?(t.done?'rgba(255,255,255,0.2)':due.color):'rgba(255,255,255,0.1)'}}>
          {due?.label||'—'}
        </span>

        {/* Assignee */}
        <div className="flex items-center gap-1.5">
          {t.assignee?(
            <>
              <div className="w-6 h-6 rounded-full flex items-center justify-center font-syne text-[8px] font-black flex-shrink-0"
                style={{background:t.assignee.avatar_color+'22',color:t.assignee.avatar_color}}>
                {t.assignee.initials}
              </div>
              {t.co_assignee?(
                <div className="w-6 h-6 rounded-full flex items-center justify-center font-syne text-[8px] font-black flex-shrink-0 -ml-2"
                  style={{background:t.co_assignee.avatar_color+'22',color:t.co_assignee.avatar_color,border:`1.5px solid ${SURFACE}`}}>
                  {t.co_assignee.initials}
                </div>
              ):(
                <span className="font-figtree text-[11.5px] truncate" style={{color:'rgba(255,255,255,0.35)'}}>
                  {t.assignee.name.split(' ')[0]}
                </span>
              )}
            </>
          ):(
            <span className="font-syne text-[9px]" style={{color:'rgba(255,255,255,0.12)'}}>—</span>
          )}
        </div>

        {/* Menu */}
        <button onClick={e=>{e.stopPropagation();openTask(t)}}
          aria-label={`Abrir «${t.text}»`}
          className="w-6 h-6 flex items-center justify-center rounded-lg transition-opacity opacity-50 md:opacity-0 md:group-hover:opacity-100 flex-shrink-0"
          style={{color:'rgba(255,255,255,0.3)'}}>
          <LucideIcon name="more-horizontal" size={13} color="rgba(255,255,255,0.3)"/>
        </button>
      </div>
    )
  }

  const renderFila = (t: Task, last: boolean) =>
    isMobile ? renderFilaMovil(t, last) : renderFilaEscritorio(t, last)

  // ── Column headers (desktop only) ───────────────────────────────────────────
  const renderCabeceras = () => (
    <div style={{
      display:'grid', gridTemplateColumns: COLS,
      gap:'0 12px', padding:'0 20px',
      height:'32px', alignItems:'center',
      borderBottom:`1px solid ${BORDER}`,
      background: 'rgba(255,255,255,0.014)',
    }}>
      <div/>
      <span className="font-syne text-[8.5px] font-black tracking-[0.12em]" style={{color:'rgba(255,255,255,0.2)'}}>TAREA</span>
      <span className="font-syne text-[8.5px] font-black tracking-[0.12em]" style={{color:'rgba(255,255,255,0.2)'}}>PROYECTO</span>
      <span className="font-syne text-[8.5px] font-black tracking-[0.12em]" style={{color:'rgba(255,255,255,0.2)'}}>PRIORIDAD</span>
      <span className="font-syne text-[8.5px] font-black tracking-[0.12em]" style={{color:'rgba(255,255,255,0.2)'}}>VENCIMIENTO</span>
      <span className="font-syne text-[8.5px] font-black tracking-[0.12em]" style={{color:'rgba(255,255,255,0.2)'}}>RESPONSABLE</span>
      <div/>
    </div>
  )

  // ── Section block ────────────────────────────────────────────────────────────
  const renderGrupo = ({label,tasks,dot,showCols}:{label:string,tasks:Task[],dot?:string,showCols?:boolean}) => {
    if (!tasks.length) return null
    return (
      <div className="mb-3">
        <div className="flex items-center gap-2.5 mb-2" style={{padding:'0 20px'}}>
          {dot&&(
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{background:dot}}/>
          )}
          <span className="font-syne text-[8.5px] font-black tracking-widest" style={{color: dot ? dot : 'rgba(255,255,255,0.2)'}}>{label}</span>
          <span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-full ml-1" style={{background: dot ? dot+'18' : 'rgba(255,255,255,0.05)', color: dot ? dot+'aa' : 'rgba(255,255,255,0.25)'}}>{tasks.length}</span>
          <div className="h-px flex-1 ml-1" style={{background: dot ? dot+'18' : 'rgba(255,255,255,0.04)'}}/>
        </div>
        <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
          {!isMobile && showCols && renderCabeceras()}
          {tasks.map((t,i)=>renderFila(t, i===tasks.length-1))}
        </div>
      </div>
    )
  }

  return (
    <div className={isMobile ? 'flex flex-col min-h-0' : 'flex h-full overflow-hidden'}>

      {/* ── LIST PANE ─────────────────────────────────────────────────────────── */}
      <div className={isMobile ? 'flex flex-col' : 'flex flex-col overflow-hidden'}
        style={isMobile
        ?{width:'100%',flexShrink:0,display:activeTask?'none':'flex'}
        :{width:activeTask?'520px':'100%',flexShrink:0,borderRight:activeTask?`1px solid ${BORDER}`:'none'}}>

        <div className={`${isMobile?'px-4':'px-8'} pt-8 pb-0 flex-shrink-0`}>

          {/* ── HEADER ─────────────────────────────────────────────────────── */}
          <div className="flex items-end gap-3 mb-6 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-1" style={{color:'rgba(255,255,255,0.18)'}}>GESTIÓN</div>
              <h1 className="font-figtree font-black text-white leading-none" style={{fontSize:'26px',letterSpacing:'-0.03em'}}>Tareas</h1>
            </div>
            {isMobile ? (
              <button onClick={()=>onOpenModal('tarea')}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne text-[10px] font-black tracking-wide text-white flex-shrink-0"
                style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
                <LucideIcon name="plus" size={13} color="white"/> Nueva
              </button>
            ) : (
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Search */}
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"><LucideIcon name="search" size={12} color="rgba(255,255,255,0.2)"/></div>
                  <input value={searchText} onChange={e=>setSearchText(e.target.value)} placeholder="Buscar tareas..."
                    className="pl-8 pr-4 py-2 rounded-xl text-[12px] text-white placeholder-white/[0.18] outline-none transition-all"
                    style={{background:SURFACE,border:`1px solid ${searchText?BLU+'50':BORDER}`,width:'172px',caretColor:BLU}}/>
                  {searchText&&<button onClick={()=>setSearchText('')} className="absolute right-3 top-1/2 -translate-y-1/2"><LucideIcon name="x" size={11} color="rgba(255,255,255,0.3)"/></button>}
                </div>
                {/* View toggle */}
                <div className="flex p-0.5 rounded-xl gap-0.5" style={{background:SURF2,border:`1px solid ${BORDER}`}}>
                  {([{id:'lista' as const,icon:'list',nav:null},{id:'kanban' as const,icon:'layout-grid',nav:null},{id:'calendario' as const,icon:'calendar',nav:'calendario'}] as const).map(v=>(
                    <button key={v.id}
                      onClick={()=>v.nav ? onNavigate(v.nav) : setView(v.id)}
                      title={v.id==='kanban'?'Tablero':v.id==='calendario'?'Ir al calendario':'Lista'}
                      className="flex items-center justify-center w-8 h-8 rounded-lg transition-all relative"
                      style={{background:view===v.id?BLU+'26':'transparent',border:`1px solid ${view===v.id?BLU+'55':'transparent'}`}}>
                      <LucideIcon name={v.icon as any} size={13} color={view===v.id?'#5b8dff':'rgba(255,255,255,0.28)'}/>
                    </button>
                  ))}
                </div>
                {/* Nueva tarea */}
                <button onClick={()=>onOpenModal('tarea')}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl font-syne text-[10px] font-black tracking-wide text-white transition-opacity hover:opacity-85"
                  style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
                  <LucideIcon name="plus" size={13} color="white"/> Nueva tarea
                </button>
              </div>
            )}
          </div>

          {/* ── MOBILE SEARCH ──────────────────────────────────────────────── */}
          {isMobile && (
            <div className="relative mb-4">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"><LucideIcon name="search" size={13} color="rgba(255,255,255,0.22)"/></div>
              <input value={searchText} onChange={e=>setSearchText(e.target.value)} placeholder="Buscar tareas..."
                className="w-full pl-8 pr-4 py-3 rounded-xl text-[14px] text-white placeholder-white/20 outline-none"
                style={{background:SURFACE,border:`1px solid ${searchText?BLU+'50':BORDER}`,caretColor:BLU}}/>
              {searchText && <button onClick={()=>setSearchText('')} className="absolute right-3 top-1/2 -translate-y-1/2"><LucideIcon name="x" size={13} color="rgba(255,255,255,0.3)"/></button>}
            </div>
          )}

          {/* Mismo criterio que tenía el banner: con el cajón de una tarea abierto
              desaparece, para no flotar encima de lo que estás editando. */}
          {!activeTask && <TableroLunes isMobile={isMobile} />}

          {/* El tablero del lunes ya no ocupa una franja horizontal aquí arriba.
              Era un enlace que se lee una vez por semana comiéndose el ancho entero
              y empujando hacia abajo lo que sí se mira a diario. Ahora es un botón
              flotante, abajo — está a mano cuando hace falta y no estorba el resto
              del tiempo. Ver TableroLunes, al final del componente. */}

          {/* ── STATS CARDS ────────────────────────────────────────────────── */}
          {data.tasks.length>0 && !activeTask && (
            <div className={`grid mb-4 ${isMobile?'gap-2':'gap-3'}`} style={{gridTemplateColumns:'repeat(4,1fr)'}}>
              {[
                {label:'PENDIENTES', value:counts.pendientes, icon:'clock',          color:'#6495FF',  bg:'rgba(27,95,250,0.1)',   border:'rgba(27,95,250,0.18)'},
                {label:'PARA HOY',   value:counts.hoy,        icon:'sun',            color:AMB,                     bg:'rgba(255,176,32,0.1)',   border:'rgba(255,176,32,0.2)'},
                {label:'ATRASADAS',  value:counts.atrasadas,  icon:'alert-circle',   color:RED,                     bg:'rgba(229,29,42,0.1)',    border:counts.atrasadas>0?'rgba(229,29,42,0.25)':BORDER},
                {label:'COMPLETADAS',value:counts.completadas, icon:'check-circle',  color:GRN,                     bg:'rgba(34,197,94,0.1)',   border:'rgba(34,197,94,0.18)'},
              ].map(s=>(
                <div key={s.label}
                  className={`rounded-2xl transition-all ${isMobile?'flex flex-col items-center justify-center px-1 py-2.5':'flex items-center gap-3 px-4 py-4'}`}
                  style={{background:SURFACE,border:`1px solid ${s.border}`}}>
                  {/* Sin icono en móvil: ocupaba 40px por tarjeta y la cifra ya va
                      en su color, así que no añadía información. */}
                  {!isMobile && (
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:s.bg}}>
                      <LucideIcon name={s.icon as any} size={18} color={s.color}/>
                    </div>
                  )}
                  <div className={isMobile?'text-center':''}>
                    <div className="font-figtree font-black leading-none" style={{fontSize:isMobile?'20px':'28px',color:isMobile?s.color:'#fff'}}>{s.value}</div>
                    <div className="font-syne font-black tracking-widest mt-1" style={{fontSize:isMobile?'6px':'7px',color:'rgba(255,255,255,0.28)'}}>{s.label}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── WEEKLY PROGRESS ────────────────────────────────────────────── */}
          {data.tasks.length>0 && !activeTask && (
            <div className="flex items-center gap-4 px-5 py-4 rounded-2xl mb-5" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
              <div className="flex-shrink-0">
                <div className="font-syne text-[8px] font-black tracking-widest mb-0.5" style={{color:'rgba(255,255,255,0.22)'}}>PROGRESO SEMANAL</div>
                <div className="font-figtree font-black text-white" style={{fontSize:'22px',lineHeight:1}}>{pct}<span className="text-[13px] font-medium ml-0.5" style={{color:'rgba(255,255,255,0.4)'}}>%</span></div>
              </div>
              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{background:'rgba(255,255,255,0.05)'}}>
                <div className="h-full rounded-full transition-all duration-700"
                  style={{width:`${pct}%`,background:`linear-gradient(90deg,${BLU},${GRN})`}}/>
              </div>
              {!isMobile && (
                <div className="flex-shrink-0 text-right">
                  <div className="font-figtree font-semibold text-[13px]" style={{color:'rgba(255,255,255,0.55)'}}>
                    <span style={{color:'rgba(255,255,255,0.85)'}}>{counts.completadas}</span>
                    <span style={{color:'rgba(255,255,255,0.25)'}}> / {counts.total}</span>
                  </div>
                  <div className="font-syne text-[8px] font-black tracking-widest mt-0.5" style={{color:'rgba(255,255,255,0.18)'}}>COMPLETADAS</div>
                </div>
              )}
            </div>
          )}

          {/* ── TABS (underline style) ─────────────────────────────────────── */}
          {/* Las cinco pestañas miden más que la pantalla de un móvil (438 px en
              343), y sin desbordamiento controlado no se quedaban dentro: EMPUJABAN
              el ancho de la sección entera a 454, así que la página se podía
              arrastrar de lado y los rótulos aparecían cortados por la izquierda.
              Mismo patrón que Operativa: scroll horizontal sin barra visible. */}
          <div className="flex items-center gap-0 mb-1 overflow-x-auto"
            style={{borderBottom:`1px solid ${BORDER}`, scrollbarWidth:'none', overflowY:'hidden', touchAction:'pan-x', overscrollBehavior:'contain'}}>
            {TABS.map(tab=>(
              <button key={tab.id} onClick={()=>setTabFilter(tab.id)}
                className="flex items-center gap-1.5 font-syne font-black tracking-wide transition-all relative flex-shrink-0"
                style={{
                  padding: isMobile ? '10px 8px' : '12px 16px',
                  fontSize: isMobile?'9px':'9.5px',
                  color: tabFilter===tab.id ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)',
                  borderBottom: tabFilter===tab.id ? `2px solid ${BLU}` : '2px solid transparent',
                  marginBottom: '-1px',
                  flexShrink: isMobile ? 1 : 0,
                  whiteSpace: 'nowrap',
                  flex: isMobile ? '1 1 0' : 'none',
                }}>
                {isMobile ? tab.short : tab.label}
                {tab.count>0 && (
                  <span className="font-black rounded-full px-1.5 py-0.5"
                    style={{fontSize:'8px',background:tabFilter===tab.id?BLU+'20':'rgba(255,255,255,0.07)',color:tabFilter===tab.id?BLU:'rgba(255,255,255,0.25)'}}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
            {!isMobile && (
              <span className="ml-auto pr-1 font-syne text-[9px] font-black flex-shrink-0" style={{color:'rgba(255,255,255,0.12)'}}>{filtered.length}</span>
            )}
          </div>

          {/* ── FILTERS ROW (always visible on desktop) ───────────────────── */}
          {!isMobile && (
            <div className="flex items-center gap-2 pt-3 pb-1">
              {/* Mi día (focus) */}
              <button onClick={()=>setFocusMode(f=>!f)} title="Solo mis tareas urgentes y vencidas"
                className="flex items-center gap-2 px-3 py-2 rounded-xl font-syne text-[9px] font-black tracking-wide transition-all flex-shrink-0"
                style={{background:focusMode?`linear-gradient(135deg,${BLU}2e,${BLU}12)`:SURF2,border:`1px solid ${focusMode?BLU+'70':BORDER}`,color:focusMode?'#7aa5ff':'rgba(255,255,255,0.4)'}}>
                <LucideIcon name="target" size={12} color={focusMode?'#7aa5ff':'rgba(255,255,255,0.4)'}/>
                MI DÍA
                {focusCount>0 && <span className="font-black rounded-full px-1.5 py-0.5" style={{fontSize:'8px',background:focusMode?BLU+'40':'rgba(255,255,255,0.08)',color:focusMode?'#9ebbff':'rgba(255,255,255,0.35)'}}>{focusCount}</span>}
              </button>
              {/* Assignee */}
              <div className="relative flex-shrink-0">
                <select value={assigneeFilter} onChange={e=>setAssigneeFilter(e.target.value)}
                  className="appearance-none pl-3 pr-7 py-2 rounded-xl text-[11.5px] text-white outline-none cursor-pointer transition-all"
                  style={{background:assigneeFilter!=='all'?BLU+'15':SURF2,border:`1px solid ${assigneeFilter!=='all'?BLU+'50':BORDER}`,colorScheme:'dark',color:assigneeFilter!=='all'?'rgba(255,255,255,0.9)':'rgba(255,255,255,0.38)'}}>
                  <option value="all">Responsable</option>
                  {(data.team||[]).map((m:Profile)=><option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"><LucideIcon name="chevron-down" size={11} color={assigneeFilter!=='all'?BLU:'rgba(255,255,255,0.3)'}/></div>
              </div>
              {/* Project */}
              <div className="relative flex-shrink-0">
                <select value={projectFilter} onChange={e=>setProjectFilter(e.target.value)}
                  className="appearance-none pl-3 pr-7 py-2 rounded-xl text-[11.5px] text-white outline-none cursor-pointer"
                  style={{background:projectFilter!=='all'?BLU+'15':SURF2,border:`1px solid ${projectFilter!=='all'?BLU+'50':BORDER}`,colorScheme:'dark',color:projectFilter!=='all'?'rgba(255,255,255,0.9)':'rgba(255,255,255,0.38)'}}>
                  <option value="all">Proyecto</option>
                  {(data.projects||[]).filter((p:Project)=>p.status!=='completado').map((p:Project)=><option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"><LucideIcon name="chevron-down" size={11} color={projectFilter!=='all'?BLU:'rgba(255,255,255,0.3)'}/></div>
              </div>
              {/* Priority */}
              <div className="relative flex-shrink-0">
                <select value={priorityFilter} onChange={e=>setPriorityFilter(e.target.value as any)}
                  className="appearance-none pl-3 pr-7 py-2 rounded-xl text-[11.5px] text-white outline-none cursor-pointer"
                  style={{background:priorityFilter!=='all'?BLU+'15':SURF2,border:`1px solid ${priorityFilter!=='all'?BLU+'50':BORDER}`,colorScheme:'dark',color:priorityFilter!=='all'?'rgba(255,255,255,0.9)':'rgba(255,255,255,0.38)'}}>
                  <option value="all">Prioridad</option>
                  <option value="urgent">{NIVEL_TAREA.urgent.label}</option>
                  <option value="high">{NIVEL_TAREA.high.label}</option>
                  <option value="normal">{NIVEL_TAREA.normal.label}</option>
                </select>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"><LucideIcon name="chevron-down" size={11} color={priorityFilter!=='all'?BLU:'rgba(255,255,255,0.3)'}/></div>
              </div>
              {/* Clear filters */}
              {activeFilters>0 && (
                <button onClick={()=>{setAssigneeFilter('all');setProjectFilter('all');setPriorityFilter('all')}}
                  className="px-2.5 py-2 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all flex items-center gap-1.5"
                  style={{color:'rgba(229,29,42,0.7)',border:`1px solid rgba(229,29,42,0.2)`}}>
                  <LucideIcon name="x" size={10} color="rgba(229,29,42,0.7)"/> LIMPIAR
                </button>
              )}
              {/* Export CSV */}
              <button onClick={exportCSV} title="Exportar a CSV"
                className="ml-auto flex items-center gap-1.5 px-2.5 h-8 rounded-xl font-syne text-[8px] font-black tracking-wide transition-all flex-shrink-0"
                style={{background:SURF2,border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.4)'}}>
                <LucideIcon name="download" size={12} color="rgba(255,255,255,0.4)"/> CSV
              </button>
              {/* Sort */}
              <div className="flex p-0.5 rounded-xl" style={{background:SURF2,border:`1px solid ${BORDER}`}}>
                {([{id:'prioridad' as const,icon:'arrow-up-narrow-wide',title:'Ordenar por prioridad: urgentes arriba, en una sola lista'},{id:'fecha' as const,icon:'calendar-clock',title:'Agrupar por fecha: atrasadas, hoy, próximas y sin fecha'}] as const).map(s=>(
                  <button key={s.id} onClick={()=>setTaskSort(s.id)} title={s.title} className="w-7 h-7 flex items-center justify-center rounded-lg transition-all"
                    style={{background:taskSort===s.id?BLU+'26':'transparent',border:`1px solid ${taskSort===s.id?BLU+'55':'transparent'}`}}>
                    <LucideIcon name={s.icon as any} size={12} color={taskSort===s.id?'#5b8dff':'rgba(255,255,255,0.25)'}/>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Mobile filter row */}
          {isMobile && (
            <div className="flex flex-wrap items-center gap-2 pt-3 pb-1">
              {/* View toggle + Mi día */}
              <div className="flex items-center gap-2 w-full">
                <div className="flex p-0.5 rounded-xl gap-0.5 flex-shrink-0" style={{background:SURF2,border:`1px solid ${BORDER}`}}>
                  {([{id:'lista' as const,icon:'list'},{id:'kanban' as const,icon:'layout-grid'}] as const).map(v=>(
                    <button key={v.id} onClick={()=>setView(v.id)}
                      title={v.id==='kanban'?'Tablero':'Lista'} aria-label={v.id==='kanban'?'Ver como tablero':'Ver como lista'}
                      className="flex items-center justify-center w-8 h-8 rounded-lg transition-all"
                      style={{background:view===v.id?BLU+'26':'transparent',border:`1px solid ${view===v.id?BLU+'55':'transparent'}`}}>
                      <LucideIcon name={v.icon as any} size={14} color={view===v.id?'#5b8dff':'rgba(255,255,255,0.28)'}/>
                    </button>
                  ))}
                </div>
                <button onClick={()=>setFocusMode(f=>!f)}
                  className="flex items-center gap-1.5 px-3 h-9 rounded-xl font-syne text-[9px] font-black tracking-wide transition-all flex-1 justify-center"
                  style={{background:focusMode?`linear-gradient(135deg,${BLU}2e,${BLU}12)`:SURF2,border:`1px solid ${focusMode?BLU+'70':BORDER}`,color:focusMode?'#7aa5ff':'rgba(255,255,255,0.4)'}}>
                  <LucideIcon name="target" size={13} color={focusMode?'#7aa5ff':'rgba(255,255,255,0.4)'}/>
                  MI DÍA{focusCount>0?` · ${focusCount}`:''}
                </button>
                <button onClick={exportCSV} className="flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0" style={{background:SURF2,border:`1px solid ${BORDER}`}} aria-label="Descargar"><LucideIcon name="download" size={14} color="rgba(255,255,255,0.4)"/></button>
              </div>
              {(() => {
                const activos = [assigneeFilter, projectFilter, priorityFilter].filter(v => v !== 'all').length
                return (
                  <button onClick={()=>setFiltrosAbiertos(o=>!o)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-syne text-[9px] font-black tracking-widest"
                    style={{background:SURF2,border:`1px solid ${activos?BLU+'55':BORDER}`,color:activos?'#7aa5ff':'rgba(255,255,255,0.45)'}}>
                    <LucideIcon name="sliders-horizontal" size={11} color={activos?'#7aa5ff':'rgba(255,255,255,0.45)'}/>
                    FILTROS{activos?` · ${activos}`:''}
                  </button>
                )
              })()}
              {filtrosAbiertos && (<>
              <select value={assigneeFilter} onChange={e=>setAssigneeFilter(e.target.value)}
                className="px-3 py-2 rounded-xl text-[11.5px] text-white outline-none" style={{background:SURF2,border:`1px solid ${assigneeFilter!=='all'?BLU+'50':BORDER}`,colorScheme:'dark',flex:'1 1 auto',minWidth:0}}>
                <option value="all">Responsable</option>
                {(data.team||[]).map((m:Profile)=><option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <select value={projectFilter} onChange={e=>setProjectFilter(e.target.value)}
                className="px-3 py-2 rounded-xl text-[11.5px] text-white outline-none" style={{background:SURF2,border:`1px solid ${projectFilter!=='all'?BLU+'50':BORDER}`,colorScheme:'dark',flex:'1 1 auto',minWidth:0}}>
                <option value="all">Proyecto</option>
                {(data.projects||[]).filter((p:Project)=>p.status!=='completado').map((p:Project)=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={priorityFilter} onChange={e=>setPriorityFilter(e.target.value as any)}
                className="px-3 py-2 rounded-xl text-[11.5px] text-white outline-none" style={{background:SURF2,border:`1px solid ${priorityFilter!=='all'?BLU+'50':BORDER}`,colorScheme:'dark',flex:'1 1 auto',minWidth:0}}>
                <option value="all">Prioridad</option>
                <option value="urgent">{NIVEL_TAREA.urgent.label}</option>
                <option value="high">{NIVEL_TAREA.high.label}</option>
                <option value="normal">{NIVEL_TAREA.normal.label}</option>
              </select>
              </>)}
            </div>
          )}
        </div>

        {/* ── TASK LIST ──────────────────────────────────────────────────────── */}
        <div className={isMobile ? `px-4 pb-36 pt-4` : `flex-1 overflow-y-auto px-8 pb-8 pt-4`}>
          {focusMode && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-2xl mb-4" style={{background:`linear-gradient(135deg,${BLU}14,${BLU}06)`,border:`1px solid ${BLU}33`}}>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:BLU+'20'}}>
                <LucideIcon name="target" size={16} color="#7aa5ff"/>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-syne text-[9px] font-black tracking-widest" style={{color:'#7aa5ff'}}>MI DÍA · MODO FOCUS</div>
                <div className="font-figtree text-[11.5px]" style={{color:'rgba(255,255,255,0.4)'}}>Solo tus tareas <b style={{color:'rgba(255,255,255,0.65)'}}>urgentes</b> y <b style={{color:'rgba(255,255,255,0.65)'}}>vencidas</b>. {focusCount===0?'¡Todo al día! 🎉':`${focusCount} ${focusCount===1?'tarea requiere':'tareas requieren'} tu atención.`}</div>
              </div>
              <button onClick={()=>setFocusMode(false)} className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors hover:bg-white/5" style={{color:'rgba(255,255,255,0.35)'}}>
                <LucideIcon name="x" size={13} color="rgba(255,255,255,0.35)"/>
              </button>
            </div>
          )}
          {view==='kanban' ? (
            <KanbanBoard tasks={kanbanTasks} data={data} openTask={openTask} isMobile={isMobile} showToast={showToast} initialGroupBy={initialGroupBy}/>
          ) : view!=='lista' ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <LucideIcon name="calendar" size={32} color="rgba(255,255,255,0.07)"/>
              <span className="font-syne text-[10px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.18)'}}>PRÓXIMAMENTE</span>
              <button onClick={()=>setView('lista')} className="font-syne text-[9px] font-black px-3 py-1.5 rounded-xl" style={{color:BLU,border:`1px solid ${BLU}30`}}>Volver a lista</button>
            </div>
          ) : grouped ? (
            <>
              {grouped.over.length>0 && renderGrupo({label:"ATRASADAS", tasks:grouped.over, dot:RED, showCols:true})}
              {renderGrupo({label:"HOY", tasks:grouped.today, dot:AMB, showCols:!grouped.over.length})}
              {renderGrupo({label:"PRÓXIMAS", tasks:grouped.upcoming, dot:GRN, showCols:!grouped.over.length&&!grouped.today.length})}
              {renderGrupo({label:"SIN FECHA", tasks:grouped.nodate, showCols:!grouped.over.length&&!grouped.today.length&&!grouped.upcoming.length})}
              {filtered.length===0 && data.tasks.length===0 && (
                <HarveyTaskSuggestions data={data} onOpenModal={onOpenModal} onCreateTask={async(text:string,level:string)=>{
                  try{await data.createTask({text,level:nivelTarea(level),done:false});showToast('Tarea creada')}catch(err){showToast('No se pudo crear la tarea');throw err}
                }}/>
              )}
              {filtered.length===0 && data.tasks.length>0 && (
                <div className="rounded-2xl py-16 flex flex-col items-center gap-3" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
                  <LucideIcon name="check-circle" size={28} color={GRN+'50'}/>
                  <span className="font-figtree text-[14px]" style={{color:'rgba(255,255,255,0.25)'}}>Sin tareas pendientes</span>
                  <button onClick={()=>onOpenModal('tarea')} className="font-syne text-[9px] font-black px-4 py-2 rounded-xl mt-1" style={{color:BLU,border:`1px solid ${BLU}30`}}>+ Nueva tarea</button>
                </div>
              )}
            </>
          ) : (
            <>
              {filtered.length===0 ? (
                <div className="rounded-2xl py-16 text-center" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
                  <span className="font-figtree text-[14px]" style={{color:'rgba(255,255,255,0.22)'}}>Sin tareas en este filtro</span>
                </div>
              ) : (
                <div className="rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
                  {!isMobile && renderCabeceras()}
                  {filtered.map((t:Task,i:number)=>renderFila(t, i===filtered.length-1))}
                </div>
              )}
              {tabFilter==='completadas'&&filtered.length>0&&isOwner&&(
                <div className="mt-3 text-right">
                  {confirmLimpiar
                    ?<div className="flex items-center justify-end gap-2">
                       {/* En lotes de 500 y contando lo que el servidor dice haber
                           borrado, no lo que se mando: DELETE /api/tasks recorta la
                           lista a 500 ids en silencio, asi que con 620 completadas
                           el "¿BORRAR 620?" borraba 500 y las 120 restantes volvian
                           al recargar bajo un toast que decia "Eliminadas". */}
                       <button onClick={async()=>{
                         const ids = filtered.map((t:Task)=>t.id)
                         let borradas = 0
                         try {
                           for (let i=0; i<ids.length; i+=500) {
                             const lote = ids.slice(i, i+500)
                             borradas += (await data.deleteTasks(lote)) ?? lote.length
                           }
                           showToast(plural(borradas,'tarea eliminada','tareas eliminadas'))
                         } catch(e:any){ showToast(e?.message || 'No se pudieron eliminar') }
                         finally { setConfirmLimpiar(false) }
                       }}
                         className="px-3 py-1.5 rounded-xl font-syne text-[8px] font-black" style={{background:'rgba(229,29,42,0.12)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR {filtered.length}?</button>
                       <button onClick={()=>setConfirmLimpiar(false)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={11} color="rgba(255,255,255,0.3)"/></button>
                     </div>
                    :<button onClick={()=>setConfirmLimpiar(true)} className="font-syne text-[8px] font-black px-3 py-1.5 rounded-xl" style={{color:'rgba(229,29,42,0.5)',border:`1px solid rgba(229,29,42,0.15)`}}>LIMPIAR COMPLETADAS</button>
                  }
                </div>
              )}
            </>
          )}

          {/* Quick add + keyboard hints */}
          <div className="flex items-center justify-between py-3 mt-2">
            <button onClick={()=>onOpenModal('tarea')} className="flex items-center gap-2 font-figtree text-[13px] transition-colors hover:text-white/40" style={{color:'rgba(255,255,255,0.18)'}}>
              <LucideIcon name="plus" size={14} color="rgba(255,255,255,0.18)"/>
              Añadir tarea
            </button>
            <div className="nx-kbd-hints flex items-center gap-3">
              {(['N NUEVA','J/K NAVEGAR'] as const).map((h,i,arr)=>(
                <span key={h} className="flex items-center gap-2">
                  <span className="font-syne text-[7px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.08)'}}>{h}</span>
                  {i<arr.length-1&&<span className="text-[7px]" style={{color:'rgba(255,255,255,0.05)'}}>·</span>}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── DETAIL DRAWER ─────────────────────────────────────────────────────── */}
      {activeTask&&(
        // `key` fuerza el remonte al cambiar de tarea. Este div es el MISMO nodo para
        // todas —el cajon no se desmonta al navegar con j/k—, asi que el navegador le
        // conservaba el scrollTop: abrias una tarea con notas, subtareas y adjuntos,
        // bajabas hasta el final, pulsabas `j` y la siguiente se abria ya desplazada,
        // con su descripcion, prioridad y responsable fuera de pantalla. Mismo fallo
        // que el panel de detalle del inbox.
        //
        // Y en movil el cajon NO puede ser scroller propio: ahi la seccion no acota
        // altura, asi que su altura la marca el contenido y con `overflow-y-auto`
        // nunca llegaba a desplazarse — desplazaba la pagina. Pero `position:sticky`
        // se resuelve contra el scroller mas cercano, que era este, y la barra
        // «← Tareas» se iba hacia arriba con el resto en vez de quedarse fija. Sin
        // overflow, el scroller vuelve a ser el del dashboard y la barra se queda.
        <div key={activeTask.id} className={isMobile ? 'flex-1 min-w-0' : 'flex-1 overflow-y-auto min-w-0'} style={{background:'#050510'}} onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!saving)saveTask()}}>
          <div className={`flex items-center justify-between ${isMobile?'px-4':'px-7'} py-5 sticky top-0 z-10`}
            style={{background:'rgba(5,5,16,0.95)',backdropFilter:'blur(12px)',borderBottom:`1px solid ${BORDER}`}}>
            <button onClick={()=>setActiveTask(null)} className="flex items-center gap-2 text-[13px] transition-colors hover:text-white/70" style={{color:'rgba(255,255,255,0.35)'}}>
              <LucideIcon name="arrow-left" size={14}/> Tareas
            </button>
            <div className="flex items-center gap-2">
              {(isOwner || (!!profile?.id && activeTask?.created_by === profile.id))&&(confirmDelete
                ?<div className="flex items-center gap-1">
                   <button onClick={async()=>{try{await data.deleteTask(activeTask.id);setActiveTask(null);showToast('Eliminada')}catch{showToast('Error')}}}
                     className="px-3 py-2 rounded-xl font-syne text-[8px] font-black" style={{background:'rgba(229,29,42,0.15)',color:RED,border:`1px solid rgba(229,29,42,0.25)`}}>¿BORRAR?</button>
                   <button onClick={()=>setConfirmDelete(false)} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{color:'rgba(255,255,255,0.3)'}}><LucideIcon name="x" size={11} color="rgba(255,255,255,0.3)"/></button>
                 </div>
                :<button onClick={()=>setConfirmDelete(true)} className="px-3 py-2 rounded-xl font-syne text-[9px] font-black tracking-wide" style={{color:'rgba(229,29,42,0.5)',border:`1px solid rgba(229,29,42,0.15)`}}>ELIMINAR</button>
              )}
              <button onClick={async()=>{
                try{const copy=await data.createTask({text:`${activeTask.text} (copia)`,level:activeTask.level,assigned_to:activeTask.assigned_to,co_assigned_to:activeTask.co_assigned_to,notes:activeTask.notes,due_date:activeTask.due_date,project_id:activeTask.project_id,client_id:activeTask.client_id,source:'manual'})
                // El borrado armado se desarma tambien aqui, como ya hacen openTask y
                // el salto con j/k. Sin esto, si te lo pensabas y en vez de cancelar
                // pulsabas Duplicar, el cajon pasaba a la copia recien creada con el
                // boton todavia en «¿BORRAR?»: el siguiente clic borraba la copia
                // creyendo que borraba el original.
                showToast('Duplicada');setActiveTask(copy);setConfirmDelete(false);setEditing({text:copy.text,level:copy.level,assigned_to:copy.assigned_to,co_assigned_to:copy.co_assigned_to,notes:copy.notes,done:copy.done,due_date:copy.due_date,project_id:copy.project_id})}catch{showToast('Error al duplicar')}
              }} className="w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:opacity-80" style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${BORDER}`}} title="Duplicar">
                <LucideIcon name="copy" size={13} color="rgba(255,255,255,0.35)"/>
              </button>
              <button onClick={saveTask} disabled={saving}
                className="px-5 py-2.5 rounded-2xl font-syne text-[10px] font-black tracking-widest text-white disabled:opacity-40"
                style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
                {saving?'GUARDANDO…':'GUARDAR'}
              </button>
            </div>
          </div>
          {!isMobile&&<div className="flex items-center justify-center gap-2 py-2" style={{borderBottom:`1px solid ${BORDER}`}}>
            {(['J/K NAVEGAR','C COMPLETAR','L NIVEL','D FECHA','S GUARDAR'] as const).map((h,i,arr)=>(
              <span key={h} className="flex items-center gap-2">
                <span className="font-syne text-[6.5px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.08)'}}>{h}</span>
                {i<arr.length-1&&<span className="text-[6px]" style={{color:'rgba(255,255,255,0.05)'}}>·</span>}
              </span>
            ))}
          </div>}
          <div className={`${isMobile?'p-4':'p-7'} space-y-6`}>
            <div>
              <label className="block font-syne text-[9px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.25)'}}>DESCRIPCIÓN</label>
              <textarea value={editing.text||''} onChange={e=>setEditing(x=>({...x,text:e.target.value}))} rows={3}
                className="w-full px-5 py-4 rounded-2xl text-[15px] text-white font-medium resize-none outline-none"
                style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU,lineHeight:'1.5'}}
                onFocus={e=>e.target.style.borderColor='rgba(27,95,250,0.4)'} onBlur={e=>e.target.style.borderColor=BORDER}/>
            </div>
            <div>
              <label className="block font-syne text-[9px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.25)'}}>PRIORIDAD</label>
              <div className="flex gap-2">
                {((['urgent','high','normal'] as Task['level'][]).map(v=>({v,l:NIVEL_TAREA[v].label,c:NIVEL_TAREA[v].color}))).map(p=>(
                  <button key={p.v} onClick={()=>setEditing(x=>({...x,level:p.v}))}
                    className="flex-1 py-3 rounded-2xl font-syne text-[10px] font-black tracking-wide transition-all"
                    style={{background:editing.level===p.v?p.c+'18':SURF2,border:`1.5px solid ${editing.level===p.v?p.c+'70':BORDER}`,color:editing.level===p.v?p.c:'#FFFFFF'}}>
                    {p.l.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block font-syne text-[9px] font-black tracking-widest mb-1" style={{color:'rgba(255,255,255,0.25)'}}>ASIGNAR A</label>
              <div className="text-[9.5px] mb-3" style={{color:'rgba(255,255,255,0.15)'}}>Selecciona hasta 2 personas</div>
              <div className="flex flex-wrap gap-2">
                {data.team.map((m:Profile)=>{
                  const isPrimary = editing.assigned_to===m.id
                  const isSecond  = editing.co_assigned_to===m.id
                  const isSelected = isPrimary||isSecond
                  const badge = isPrimary?'1':isSecond?'2':null
                  return (
                    <button key={m.id} onClick={()=>setEditing(x=>{
                      if (x.assigned_to===m.id) return {...x,assigned_to:x.co_assigned_to??null,co_assigned_to:null}
                      if (x.co_assigned_to===m.id) return {...x,co_assigned_to:null}
                      if (!x.assigned_to) return {...x,assigned_to:m.id}
                      if (!x.co_assigned_to) return {...x,co_assigned_to:m.id}
                      return {...x,co_assigned_to:m.id}
                    })}
                      className="relative flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl transition-all"
                      style={{background:isSelected?m.avatar_color+'18':SURF2,border:`1.5px solid ${isSelected?m.avatar_color+'55':BORDER}`}}>
                      <div className="w-7 h-7 rounded-full flex items-center justify-center font-syne text-[10px] font-black" style={{background:m.avatar_color+'25',color:m.avatar_color}}>{m.initials}</div>
                      <span className="text-[13px]" style={{color:isSelected?'rgba(255,255,255,0.9)':'rgba(255,255,255,0.4)'}}>{m.name.split(' ')[0]}</span>
                      {badge&&<span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center font-syne text-[8px] font-black" style={{background:m.avatar_color,color:'white'}}>{badge}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <label className="block font-syne text-[9px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.25)'}}>ESTADO</label>
              <div className="flex gap-2">
                {[{v:false,l:'Pendiente',c:'#FFFFFF'},{v:true,l:'Completada',c:GRN}].map(s=>(
                  <button key={s.l} onClick={()=>setEditing(x=>({...x,done:s.v}))}
                    className="flex-1 py-3 rounded-2xl font-syne text-[10px] font-black tracking-wide transition-all"
                    style={{background:editing.done===s.v?s.c+'18':SURF2,border:`1.5px solid ${editing.done===s.v?s.c+'55':BORDER}`,color:editing.done===s.v?s.c:'#FFFFFF'}}>
                    {s.l.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            {data.projects.length>0&&(
              <div>
                <label className="block font-syne text-[9px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.25)'}}>PROYECTO</label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={()=>setEditing(x=>({...x,project_id:null}))}
                    className="px-3 py-2 rounded-2xl font-syne text-[9px] font-black tracking-wide transition-all"
                    style={{background:!editing.project_id?BLU+'18':SURF2,border:`1.5px solid ${!editing.project_id?BLU+'60':BORDER}`,color:!editing.project_id?BLU:'rgba(255,255,255,0.3)'}}>—</button>
                  {data.projects.filter((p:Project)=>p.status!=='completado').slice(0,8).map((p:Project)=>(
                    <button key={p.id} onClick={()=>setEditing(x=>({...x,project_id:x.project_id===p.id?null:p.id}))}
                      className="px-3 py-2 rounded-2xl font-syne text-[9px] font-black tracking-wide transition-all max-w-[160px] truncate"
                      style={{background:editing.project_id===p.id?(p.color||BLU)+'18':SURF2,border:`1.5px solid ${editing.project_id===p.id?(p.color||BLU)+'60':BORDER}`,color:editing.project_id===p.id?(p.color||BLU):'rgba(255,255,255,0.3)'}}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="block font-syne text-[9px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.25)'}}>FECHA LÍMITE</label>
              <input ref={dueDateRef} type="date" value={editing.due_date||''} onChange={e=>setEditing(x=>({...x,due_date:e.target.value||null}))}
                className="w-full px-5 py-3 rounded-2xl text-[13px] text-white outline-none"
                style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU,colorScheme:'dark'}}
                onFocus={e=>e.target.style.borderColor='rgba(27,95,250,0.4)'} onBlur={e=>e.target.style.borderColor=BORDER}/>
            </div>
            <div>
              <label className="block font-syne text-[9px] font-black tracking-widest mb-3" style={{color:'rgba(255,255,255,0.25)'}}>NOTAS</label>
              <textarea
                value={editing.notes||''}
                onChange={e=>setEditing(x=>({...x,notes:e.target.value||null}))}
                placeholder="Añade notas, contexto o comentarios…"
                rows={3}
                className="w-full px-5 py-3.5 rounded-2xl text-[13px] text-white outline-none resize-none"
                style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU,lineHeight:'1.6'}}
                onFocus={e=>e.target.style.borderColor='rgba(27,95,250,0.4)'}
                onBlur={e=>e.target.style.borderColor=BORDER}
              />
            </div>
            {/* ── ADJUNTOS ── */}
            <div>
              <input ref={fileInputRef} type="file" className="hidden" onChange={e=>{ const f=e.target.files?.[0]; if(f) uploadAttachment(f); e.target.value='' }}/>
              <div className="flex items-center justify-between mb-3">
                <label className="font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.25)'}}>ADJUNTOS</label>
                <button onClick={()=>fileInputRef.current?.click()} disabled={uploadProgress!==null}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-syne font-black tracking-wide disabled:opacity-40 transition-opacity"
                  style={{background:`${BLU}18`,color:BLU,border:`1px solid ${BLU}30`}}>
                  <LucideIcon name="paperclip" size={11} color={BLU}/>
                  ADJUNTAR
                </button>
              </div>
              {uploadProgress!==null&&(
                <div className="mb-3">
                  <div className="h-1 rounded-full overflow-hidden" style={{background:'rgba(255,255,255,0.06)'}}>
                    <div className="h-full rounded-full transition-all" style={{width:`${uploadProgress}%`,background:`linear-gradient(90deg,${BLU},${GRN})`}}/>
                  </div>
                  <span className="text-[10px] mt-1 block" style={{color:'rgba(255,255,255,0.3)'}}>{uploadProgress}% subido…</span>
                </div>
              )}
              {attachments.length>0&&(
                <div className="space-y-1.5">
                  {attachments.map((att:any)=>{
                    const isImg = att.mime_type?.startsWith('image/')
                    const isPdf = att.mime_type==='application/pdf'
                    const icon = isImg?'image':isPdf?'file-text':'paperclip'
                    const sizeLabel = att.size ? (att.size>1048576 ? `${(att.size/1048576).toFixed(1)} MB` : `${Math.round(att.size/1024)} KB`) : ''
                    return (
                      <div key={att.id} className="group flex items-center gap-2.5 px-3 py-2.5 rounded-xl" style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${BORDER}`}}>
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:`${BLU}12`}}>
                          <LucideIcon name={icon} size={13} color={BLU}/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <a href={att.url} target="_blank" rel="noopener noreferrer"
                            className="block text-[12.5px] truncate hover:underline"
                            style={{color:'rgba(255,255,255,0.75)'}}>{att.name}</a>
                          {sizeLabel&&<span className="text-[10px]" style={{color:'rgba(255,255,255,0.25)'}}>{sizeLabel}</span>}
                        </div>
                        {confirmAdjunto === att.id
                          ? <button onClick={()=>{ deleteAttachment(att); setConfirmAdjunto(null) }} aria-label="Confirmar borrado del adjunto"
                              className="font-syne text-[7.5px] font-black tracking-wide px-2 py-1 rounded-lg flex-shrink-0"
                              style={{background:`${RED}18`,color:RED,border:`1px solid ${RED}40`}}>¿BORRAR ARCHIVO?</button>
                          : <button onClick={()=>setConfirmAdjunto(att.id)} className="opacity-50 md:opacity-0 md:group-hover:opacity-60 transition-opacity flex-shrink-0" aria-label="Eliminar adjunto">
                          <LucideIcon name="trash-2" size={13} color={RED}/>
                        </button>}
                      </div>
                    )
                  })}
                </div>
              )}
              {attachments.length===0&&uploadProgress===null&&(
                <button onClick={()=>fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-[11px] transition-opacity hover:opacity-70"
                  style={{border:`1.5px dashed ${BORDER}`,color:'rgba(255,255,255,0.2)'}}>
                  <LucideIcon name="paperclip" size={13} color="rgba(255,255,255,0.2)"/>
                  Arrastra o pulsa para adjuntar un archivo
                </button>
              )}
            </div>
            {/* ── SUBTAREAS ── */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <label className="font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.25)'}}>SUBTAREAS</label>
                {subtasks.length>0&&<span className="font-syne text-[7.5px] font-black px-1.5 py-0.5 rounded-full" style={{background:`${BLU}14`,color:BLU+'cc'}}>{subtasks.filter((s:any)=>s.done).length}/{subtasks.length}</span>}
              </div>
              {subtasks.length>0&&(
                <div className="space-y-1.5 mb-3">
                  {subtasks.map((st:any)=>(
                    <div key={st.id} className="group flex items-center gap-2.5 px-3 py-2 rounded-xl" style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${BORDER}`}}>
                      <button onClick={()=>toggleSubtask(st)} className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-all" style={{background:st.done?BLU:'transparent',borderColor:st.done?BLU:BLU+'45'}}>
                        {st.done&&<LucideIcon name="check" size={8} color="white"/>}
                      </button>
                      <span className="flex-1 text-[12.5px]" style={{color:st.done?'#FFFFFF':'rgba(255,255,255,0.75)',textDecoration:st.done?'line-through':'none'}}>{st.text}</span>
                      <button onClick={()=>deleteSubtask(st.id)} aria-label="Eliminar subtarea" className="opacity-50 md:opacity-0 md:group-hover:opacity-50 transition-opacity flex-shrink-0">
                        <LucideIcon name="x" size={11} color={RED}/>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input value={stText} onChange={e=>setStText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&stText.trim())addSubtask()}} placeholder="Nueva subtarea… (Enter)" className="flex-1 px-4 py-2.5 rounded-xl text-[12.5px] text-white outline-none" style={{background:SURF2,border:`1.5px solid ${BORDER}`,caretColor:BLU}}/>
                <button onClick={addSubtask} disabled={!stText.trim()||stAdding} className="w-8 h-8 rounded-xl flex items-center justify-center disabled:opacity-30" style={{background:`${BLU}18`,border:`1px solid ${BLU}30`}} aria-label="Añadir"><LucideIcon name="plus" size={13} color={BLU}/></button>
              </div>
              {subtasks.length>0&&(
                <div className="h-1 rounded-full overflow-hidden mt-2" style={{background:'rgba(255,255,255,0.06)'}}>
                  <div className="h-full rounded-full transition-all" style={{width:`${Math.round(subtasks.filter((s:any)=>s.done).length/subtasks.length*100)}%`,background:`linear-gradient(90deg,${BLU},${GRN})`}}/>
                </div>
              )}
            </div>

            <div className="rounded-2xl p-5 space-y-3" style={{background:SURF2,border:`1px solid ${BORDER}`}}>
              {activeTask.source&&(
                <div className="flex items-center justify-between">
                  <span className="font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>ORIGEN</span>
                  <span className="font-syne text-[9px] font-black px-2.5 py-1 rounded-lg" style={{background:activeTask.source==='gmail'?'rgba(27,95,250,0.1)':activeTask.source==='whatsapp'?'rgba(37,211,102,0.08)':SURFACE,color:activeTask.source==='gmail'?BLU:activeTask.source==='whatsapp'?'#25D366':'rgba(255,255,255,0.3)'}}>{activeTask.source.toUpperCase()}</span>
                </div>
              )}
              {activeTask.client&&(
                <div className="flex items-center justify-between">
                  <span className="font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>CLIENTE</span>
                  <span className="text-[13px]" style={{color:'rgba(255,255,255,0.55)'}}>{(activeTask.client as any).name}</span>
                </div>
              )}
              {activeTask.project_id&&(()=>{
                const proj=data.projects.find((p:Project)=>p.id===activeTask.project_id); if(!proj)return null
                // Un deadline es un DIA, no un instante. Antes se restaban timestamps
                // —y dlDate() devuelve las 23:59:59 del dia— asi que Math.round se
                // comia el desfase: un proyecto vencido AYER daba Math.round(-0,4) = 0
                // y se pintaba «HOY» en ambar toda la mañana, y el que vencia HOY salia
                // como «1d». estadoDeadline() compara day keys de Madrid, que es lo que
                // ya usan Proyectos y Reportes.
                const pdl=estadoDeadline(proj.deadline)
                // Los deadlines heredados en texto libre ('ago 2026') no tienen day key
                // que valga: mejor no pintar el badge que pintar «+NaNd».
                const pdDiff=pdl&&Number.isFinite(pdl.dias)?pdl.dias:null
                const pdLabel=pdl&&pdDiff!==null?pdl.etiqueta:null
                // La tercera rama era 'rgba(255,255,255,0.28)' y aqui debajo se le
                // concatena la opacidad: 'rgba(...)18' no es un color, el navegador
                // descarta la declaracion entera y el badge se quedaba sin fondo — justo
                // en el caso mas comun, un proyecto que aun tiene margen. Con hex el
                // sufijo funciona; el '47' del texto es el gris tenue de antes (0,28).
                const pdLejos=pdDiff!==null&&pdDiff>7
                const pdColor=pdDiff===null?null:pdDiff<0?RED:pdDiff<=7?AMB:'#FFFFFF'
                return(
                  <div className="flex items-center justify-between">
                    <span className="font-syne text-[9px] font-black tracking-widest" style={{color:'rgba(255,255,255,0.2)'}}>PROYECTO</span>
                    <div className="flex items-center gap-2">
                      {pdLabel&&<span className="font-syne text-[8px] font-black px-2 py-0.5 rounded-lg" style={{background:(pdColor||'')+'18',color:(pdColor||'')+(pdLejos?'47':'')}}>{pdLabel}</span>}
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
            <div className="nx-kbd-hints flex items-center justify-center gap-4 pt-2">
              <span className="font-syne text-[7.5px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.1)'}}>⌘+ENTER GUARDAR</span>
              <span className="text-[7px]" style={{color:'rgba(255,255,255,0.05)'}}>·</span>
              <span className="font-syne text-[7.5px] font-bold tracking-widest" style={{color:'rgba(255,255,255,0.1)'}}>C ESTADO · D FECHA · L NIVEL</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── KANBAN ─────────────────────────────────────────────────────────────────
// Tablero agrupado por prioridad o por proyecto (+ columna Hecho). Drag & drop
// en escritorio; en táctil, tabs por columna + checkbox/tap para editar.
type KanKind = 'priority'|'project'|'none'|'done'
type KanCol = { key:string; label:string; color:string; kind:KanKind; projId?:string; level?:Task['level']; match:(t:Task)=>boolean }

const PRIORITY_COLS: KanCol[] = [
  { key:'urgent', label:NIVEL_TAREA.urgent.corto, color:NIVEL_TAREA.urgent.color, kind:'priority', level:'urgent', match:(t)=>!t.done && t.level==='urgent' },
  { key:'high',   label:NIVEL_TAREA.high.corto,   color:NIVEL_TAREA.high.color,   kind:'priority', level:'high',   match:(t)=>!t.done && t.level==='high' },
  { key:'normal', label:NIVEL_TAREA.normal.corto, color:NIVEL_TAREA.normal.color, kind:'priority', level:'normal', match:(t)=>!t.done && t.level==='normal' },
  { key:'done',   label:'HECHO', color:GRN, kind:'done',     match:(t)=>t.done },
]

function KanbanBoard({ tasks, data, openTask, isMobile, showToast, initialGroupBy }: {
  tasks: Task[]
  data: any
  openTask: (t: Task) => void
  isMobile: boolean
  showToast: (m: string) => void
  initialGroupBy?: 'priority'|'project'
}) {
  const [draggedId, setDraggedId] = useState<string|null>(null)
  const [overCol, setOverCol] = useState<string|null>(null)
  const [ov, setOv] = useState<Record<string, Partial<Task>>>({})
  const [qaText, setQaText] = useState<Record<string, string>>({})
  const [qaAdding, setQaAdding] = useState<Record<string, boolean>>({})
  const [mobileCol, setMobileCol] = useState<string>('urgent')
  const [groupBy, setGroupBy] = useState<'priority'|'project'>(initialGroupBy||'priority')

  const merged = useMemo(() => tasks.map(t => ov[t.id] ? { ...t, ...ov[t.id] } : t), [tasks, ov])

  // `ov` son los cambios optimistas mientras el servidor responde. Se retiran en
  // cuanto la peticion termina —salga bien o mal— porque a partir de ahi la
  // verdad esta en data.tasks.
  const quitarOverlay = (id: string) => setOv(o => { if (!o[id]) return o; const n = { ...o }; delete n[id]; return n })

  // Columnas dinámicas: por prioridad (fijas) o por proyecto (según proyectos con tareas).
  const columns: KanCol[] = useMemo(() => {
    if (groupBy === 'priority') return PRIORITY_COLS
    const seen: string[] = []
    merged.forEach(t => { if (!t.done && t.project_id && !seen.includes(t.project_id)) seen.push(t.project_id) })
    const projCols: KanCol[] = seen.map(id => {
      const p = data.projects?.find((pr: Project) => pr.id === id)
      return { key:'proj:'+id, label:(p?.name||'Proyecto').toUpperCase(), color:p?.color||BLU, kind:'project', projId:id, match:(t:Task)=>!t.done && t.project_id===id }
    })
    return [
      ...projCols,
      { key:'none', label:'SIN PROYECTO', color:'#A0A0B4', kind:'none', match:(t)=>!t.done && !t.project_id },
      { key:'done', label:'HECHO', color:GRN, kind:'done', match:(t)=>t.done },
    ]
  }, [groupBy, merged, data.projects])

  // Si la columna móvil activa deja de existir (cambio de agrupación), resetea.
  useEffect(() => { if (!columns.some(c => c.key === mobileCol)) setMobileCol(columns[0]?.key || 'done') }, [columns, mobileCol])

  const applyMove = async (t: Task, col: KanCol) => {
    const updates: Partial<Task> = {}
    if (col.kind === 'done') { if (t.done) return; updates.done = true }
    else if (col.kind === 'priority') {
      if (t.done) updates.done = false
      if (t.level !== col.level) updates.level = col.level
    } else if (col.kind === 'project') {
      if (t.done) updates.done = false
      if (t.project_id !== col.projId) updates.project_id = col.projId
    } else if (col.kind === 'none') {
      if (t.done) updates.done = false
      if (t.project_id) updates.project_id = null as any // limpia la relación en BD
    }
    if (Object.keys(updates).length === 0) return
    setOv(o => ({ ...o, [t.id]: { ...o[t.id], ...updates } }))
    try {
      await data.updateTask(t.id, updates)
      // El overlay se retira TAMBIEN al salir bien, no solo al fallar. Existe para
      // tapar el viaje de ida y vuelta al servidor; pasado eso, updateTask ya ha
      // escrito la fila autentica en data.tasks y dejarlo puesto solo sirve para
      // esconderla. Se quedaba residente hasta desmontar el tablero, que NO ocurre
      // al abrir una tarea: cambiabas el estado en el detalle, guardabas, y la
      // tarjeta seguia tachada en HECHO con el contador de columna contandola ahi.
      quitarOverlay(t.id)
      showToast(col.kind === 'done' ? '✓ Tarea completada' : `Movida a ${col.label}`)
    } catch {
      quitarOverlay(t.id)
      showToast('Error al mover')
    }
  }

  const quickAdd = async (col: KanCol) => {
    const text = (qaText[col.key] || '').trim()
    if (!text) return
    setQaAdding(a => ({ ...a, [col.key]: true }))
    try {
      const payload: any = { text, level: col.kind==='priority' ? col.level : 'normal', done: col.kind==='done', source:'manual' }
      if (col.kind === 'project') payload.project_id = col.projId
      await data.createTask(payload)
      setQaText(x => ({ ...x, [col.key]: '' }))
    } catch { showToast('Error al crear tarea') }
    finally { setQaAdding(a => ({ ...a, [col.key]: false })) }
  }

  const onDrop = (col: KanCol) => {
    setOverCol(null)
    const id = draggedId; setDraggedId(null)
    if (!id) return
    const t = merged.find(x => x.id === id)
    if (t) applyMove(t, col)
  }

  const toggleDone = async (t: Task) => {
    const updates: Partial<Task> = { done: !t.done }
    setOv(o => ({ ...o, [t.id]: { ...o[t.id], ...updates } }))
    try { await data.updateTask(t.id, updates); quitarOverlay(t.id); showToast(updates.done ? '✓ Tarea completada' : 'Tarea reabierta') }
    catch { quitarOverlay(t.id); showToast('Error al actualizar') }
  }

  // OJO: estas tres NO son componentes, son funciones que devuelven JSX, y se
  // llaman —renderTarjeta(t)— en vez de usarse como <Tarjeta t={t}/>. La
  // diferencia importa:
  //
  // Declaradas dentro de KanbanBoard, cada render creaba una funcion nueva. Usadas
  // como <Componente/>, el TIPO del elemento cambia por identidad en cada render, y
  // React entonces no actualiza el subarbol: lo desmonta y monta otro. El input de
  // "+ Anadir tarea" llamaba a setQaText en cada onChange -> re-render -> nodo DOM
  // nuevo -> foco perdido tras la primera letra. En el movil ademas se cerraba el
  // teclado. La alta rapida del tablero era inservible.
  //
  // Llamadas como funciones, su JSX se integra en el arbol de KanbanBoard y los
  // nodos se conservan. Se pueden dejar aqui dentro y seguir leyendo del closure,
  // que es lo que las hace legibles; sacarlas al modulo obligaria a pasarles catorce
  // props. Por eso NO llevan mayuscula inicial: para que no inviten a usarlas como
  // etiqueta otra vez. Y por eso no pueden usar hooks (ninguna lo hace).
  const renderTarjeta = (t: Task) => {
    const pr = PRIMAP[t.level] || PRIMAP.normal
    const assignee = t.assignee
    const dd = t.due_date ? relDate(t.due_date) : null
    const proj = t.project_id ? data.projects?.find((p: Project) => p.id === t.project_id) : null
    return (
      <div
        key={t.id}
        draggable={!isMobile}
        onDragStart={()=>setDraggedId(t.id)}
        onDragEnd={()=>{ setDraggedId(null); setOverCol(null) }}
        onClick={()=>openTask(t)}
        className="group rounded-xl p-3 cursor-pointer transition-all"
        style={{
          background: t.done ? 'rgba(255,255,255,0.02)' : SURF2,
          border:`1px solid ${draggedId===t.id ? BLU+'60' : BORDER}`,
          opacity: draggedId===t.id ? 0.4 : t.done ? 0.72 : 1,
        }}>
        <div className="flex items-start gap-2">
          <button
            onClick={(e)=>{ e.stopPropagation(); toggleDone(t) }}
            aria-label={t.done ? `Marcar «${t.text}» como pendiente` : `Completar «${t.text}»`} aria-pressed={t.done}
            className="mt-0.5 w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
            style={{ border:`1.5px solid ${t.done ? GRN : 'rgba(255,255,255,0.25)'}`, background: t.done ? GRN : 'transparent' }}>
            {t.done && <LucideIcon name="check" size={9} color="#04120a"/>}
          </button>
          <div className="flex-1 min-w-0">
            <div className="font-figtree text-[12.5px] leading-snug" style={{ color: t.done ? '#FFFFFF' : 'rgba(240,240,248,0.92)', textDecoration: t.done ? 'line-through' : 'none' }}>{t.text}</div>
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {!t.done && <span className="font-syne text-[7px] font-black tracking-widest px-1.5 py-0.5 rounded-md" style={{ background: pr.color+'18', color: pr.color }}>{pr.label}</span>}
              {proj && (
                <span className="font-syne text-[7px] font-black px-1.5 py-0.5 rounded-md truncate max-w-[90px]"
                  style={{ background:(proj.color||BLU)+'14', color:(proj.color||BLU)+'bb' }}>
                  {proj.name}
                </span>
              )}
              {dd && <span className="flex items-center gap-1 text-[10px]" style={{ color: dd.color }}><LucideIcon name="calendar" size={9} color={dd.color}/>{dd.label}</span>}
              {assignee && <span className="ml-auto w-5 h-5 rounded-full flex items-center justify-center font-syne text-[8px] font-black flex-shrink-0" style={{ background: assignee.avatar_color+'25', color: assignee.avatar_color }}>{assignee.initials}</span>}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderColumna = (col: KanCol) => {
    const items = merged.filter(col.match)
    const hot = overCol === col.key
    const qa = qaText[col.key] || ''
    const adding = qaAdding[col.key] || false
    return (
      <div
        key={col.key}
        onDragOver={e=>{ if(!isMobile){ e.preventDefault(); setOverCol(col.key) } }}
        onDragLeave={()=>{ if(overCol===col.key) setOverCol(null) }}
        onDrop={()=>onDrop(col)}
        className="flex-shrink-0 rounded-2xl flex flex-col transition-all"
        style={{
          width: isMobile ? '100%' : '270px',
          background: hot ? col.color+'0c' : 'rgba(255,255,255,0.014)',
          border:`1px solid ${hot ? col.color+'55' : BORDER}`,
          minHeight:'120px',
          maxHeight: isMobile ? 'calc(100vh - 340px)' : 'calc(100vh - 260px)',
        }}>
        {/* Column header — only desktop (mobile has tab bar) */}
        {!isMobile && (
          <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5 flex-shrink-0">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: col.color }}/>
            <span className="font-syne text-[9px] font-black tracking-widest flex-1" style={{ color: col.color }}>{col.label}</span>
            <span className="font-syne text-[8px] font-black px-1.5 py-0.5 rounded-full" style={{ background: col.color+'18', color: col.color+'cc' }}>{items.length}</span>
          </div>
        )}
        {/* Scrollable cards */}
        <div className="px-2.5 space-y-2 overflow-y-auto flex-1 pt-2.5" style={{ scrollbarWidth:'none' }}>
          {items.length === 0
            ? <div className="rounded-xl py-8 text-center text-[10.5px]" style={{ color:'rgba(255,255,255,0.15)', border:`1px dashed ${BORDER}` }}>{isMobile?'Sin tareas en esta columna':'Suelta aquí'}</div>
            : items.map(t => renderTarjeta(t))}
        </div>
        {/* Quick-add */}
        {(!isMobile || col.key !== 'done') && (
          <div className="px-2.5 pb-2.5 pt-2 flex-shrink-0">
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl transition-all"
              style={{ background:'rgba(255,255,255,0.025)', border:`1px solid ${qa?col.color+'40':BORDER}` }}>
              <input
                value={qa}
                onChange={e=>setQaText(x=>({...x,[col.key]:e.target.value}))}
                onKeyDown={e=>{ if(e.key==='Enter') quickAdd(col); if(e.key==='Escape') setQaText(x=>({...x,[col.key]:''})) }}
                placeholder="+ Añadir tarea…"
                className="flex-1 bg-transparent text-[11.5px] text-white placeholder-white/20 outline-none min-w-0"
                style={{ caretColor: col.color }}
              />
              {qa && (
                <button onClick={()=>quickAdd(col)} disabled={adding}
                  className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
                  style={{ background: col.color, opacity: adding ? 0.5 : 1 }}>
                  <LucideIcon name={adding ? 'clock' : 'plus'} size={10} color="#04120a"/>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Toggle de agrupación (prioridad / proyecto)
  const renderAgrupacion = () => (
    <div className="flex p-0.5 rounded-xl gap-0.5" style={{ background:SURF2, border:`1px solid ${BORDER}` }}>
      {([{id:'priority' as const,icon:'flag',label:'Prioridad'},{id:'project' as const,icon:'folder',label:'Proyecto'}] as const).map(g=>(
        <button key={g.id} onClick={()=>setGroupBy(g.id)}
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg font-syne text-[8.5px] font-black tracking-wide transition-all"
          style={{ background:groupBy===g.id?BLU+'26':'transparent', border:`1px solid ${groupBy===g.id?BLU+'55':'transparent'}`, color:groupBy===g.id?'#5b8dff':'rgba(255,255,255,0.32)' }}>
          <LucideIcon name={g.icon} size={11} color={groupBy===g.id?'#5b8dff':'rgba(255,255,255,0.32)'}/>
          {g.label}
        </button>
      ))}
    </div>
  )

  if (isMobile) {
    const activeKanCol = columns.find(c => c.key === mobileCol) || columns[0]
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-syne text-[8.5px] font-black tracking-widest" style={{ color:'rgba(255,255,255,0.28)' }}>AGRUPAR POR</span>
          {renderAgrupacion()}
        </div>
        {/* Mobile column tab bar (scrollable when many project columns) */}
        <div className="flex rounded-2xl overflow-x-auto" style={{ border:`1px solid ${BORDER}`, background:'rgba(255,255,255,0.014)', scrollbarWidth:'none' }}>
          {columns.map(col => {
            const count = merged.filter(col.match).length
            const active = activeKanCol?.key === col.key
            return (
              <button key={col.key} onClick={()=>setMobileCol(col.key)}
                className="flex-1 flex flex-col items-center py-2.5 px-3 transition-all"
                style={{ minWidth: groupBy==='project'?'96px':'auto', background: active ? col.color+'14' : 'transparent', borderBottom: active ? `2px solid ${col.color}` : '2px solid transparent' }}>
                <span className="font-syne text-[8px] font-black tracking-widest truncate max-w-full" style={{ color: active ? col.color : 'rgba(255,255,255,0.28)' }}>{col.label}</span>
                <span className="font-figtree text-[14px] font-black leading-tight" style={{ color: active ? col.color : 'rgba(255,255,255,0.35)' }}>{count}</span>
              </button>
            )
          })}
        </div>
        {activeKanCol && renderColumna(activeKanCol)}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="font-syne text-[8.5px] font-black tracking-widest" style={{ color:'rgba(255,255,255,0.28)' }}>AGRUPAR POR</span>
        {renderAgrupacion()}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-4" style={{ scrollbarWidth:'thin' }}>
        {columns.map(col => renderColumna(col))}
      </div>
    </div>
  )
}

export default TareasSection
