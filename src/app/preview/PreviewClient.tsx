'use client'
// ─────────────────────────────────────────────────────────────────────────────
// PREVIEW HARNESS · solo desarrollo. Monta las secciones reales con datos mock
// para poder revisarlas/capturarlas sin necesidad de login. NO se sirve en prod.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useCallback, useRef, useEffect } from 'react'
import type { Task, Project, Client, Profile, Regla, InboxMessage, ContentItem, MemoriaEntry, ChatMessage, CalendarEvent, NexusData } from '@/types'
import { SectionErrorBoundary } from '@/components/shared/ErrorBoundary'
import CreateModal from '@/components/CreateModal'
import { BLU } from '@/components/shared/design-tokens'
import { construirKanbanCols } from '@/components/shared/kanban'
import { todayKey } from '@/components/shared/helpers'
import HoySection from '@/components/sections/HoySection'
import TareasSection from '@/components/sections/TareasSection'
import AutomatizacionesSection from '@/components/sections/AutomatizacionesSection'
import ReportesSection from '@/components/sections/ReportesSection'
import InboxSection from '@/components/sections/InboxSection'
import ClientesSection from '@/components/sections/ClientesSection'
// Las 8 restantes: /preview cubria 6 de 14, asi que media app no se podia mirar
// sin credenciales — y es la unica via para revisar la UI en una sesion de Claude.
import CalendarioSection from '@/components/sections/CalendarioSection'
import ProyectosSection from '@/components/sections/ProyectosSection'
import ContenidoSection from '@/components/sections/ContenidoSection'
import MemoriaSection from '@/components/sections/MemoriaSection'
import EquipoSection from '@/components/sections/EquipoSection'
import ChatSection from '@/components/sections/ChatSection'
import HarveySection from '@/components/sections/HarveySection'
import AjustesSection from '@/components/sections/AjustesSection'

// Base DETERMINISTA: mediodía UTC del día de hoy en Madrid.
//
// Con `Date.now()` los datos de ejemplo salían distintos en el servidor y en el
// navegador —el módulo se evalúa por petición en uno y al cargar el bundle en el
// otro—, así que el orden de los eventos de una celda del calendario cambiaba y
// React abortaba la hidratación. Eso llenaba la consola de /preview de errores
// que NO existen en producción (allí los datos llegan por fetch después de
// montar, y el servidor no pinta ninguno), y me tapó errores de verdad varias
// veces: cada vez que veía "1 Issue" tenía que descartar este primero.
//
// El mediodía evita además que un desfase de horas cruce la medianoche y cambie
// el día. Sigue siendo relativo a HOY, así que "vence hoy" y "ayer" se ven bien.
const BASE = Date.parse(`${todayKey()}T12:00:00Z`)
const iso = (dOffsetDays: number) => new Date(BASE + dOffsetDays*86400000).toISOString()
const day = (dOffsetDays: number) => iso(dOffsetDays).slice(0,10)

const TEAM: Profile[] = [
  { id:'u1', email:'javi@brutal.studio', name:'Javier Valero', role:'owner',  avatar_color:'#1B5FFA', initials:'JV', gmail_connected:true },
  { id:'u2', email:'paula@brutal.studio', name:'Paula Bravo',  role:'member', avatar_color:'#22c55e', initials:'PB', gmail_connected:false },
  { id:'u3', email:'marco@brutal.studio', name:'Marco Ruiz',   role:'member', avatar_color:'#A78BFA', initials:'MR', gmail_connected:false },
]

const CLIENTS: Client[] = [
  { id:'c1', name:'Nike',   industry:'Deporte',  status:'Activo',  revenue:'€48.000', color:'#1B5FFA', initials:'NK', created_at:iso(-120) },
  { id:'c2', name:'Adidas', industry:'Deporte',  status:'Activo',  revenue:'€36.500', color:'#22c55e', initials:'AD', created_at:iso(-90) },
  { id:'c3', name:'Zara',   industry:'Moda',     status:'Activo',  revenue:'€52.000', color:'#A78BFA', initials:'ZA', created_at:iso(-60) },
  { id:'c4', name:'Mango',  industry:'Moda',     status:'Pausado', revenue:'€18.000', color:'#F59E0B', initials:'MG', created_at:iso(-30) },
  // El filtro "Archivado" no tenia ningun cliente que mostrar, asi que ese estado
  // —y la fecha de archivado— no se podian revisar en el harness.
  { id:'c5', name:'Desigual', industry:'Moda',    status:'Archivado', revenue:'€9.000', color:'#EC4899', initials:'DG', created_at:iso(-400), archived_at:iso(-45) },
]

const PROJECTS: Project[] = [
  { id:'p1', client_id:'c1', name:'Nike Verano 24', status:'activo',   progress:65, deadline:day(5),  color:'#1B5FFA', created_at:iso(-40), client:CLIENTS[0] },
  { id:'p2', client_id:'c2', name:'Adidas Renovación', status:'urgente', progress:30, deadline:day(-2), color:'#22c55e', created_at:iso(-25), client:CLIENTS[1] },
  { id:'p3', client_id:'c3', name:'Zara F/W',        status:'revisión', progress:82, deadline:day(12), color:'#A78BFA', created_at:iso(-50), client:CLIENTS[2] },
  { id:'p4', client_id:'c4', name:'Mango Social',    status:'plan.',    progress:10, deadline:'TBD',   color:'#F59E0B', created_at:iso(-10), client:CLIENTS[3] },
]

const withPeople = (t: Task): Task => ({
  ...t,
  assignee: t.assigned_to ? TEAM.find(m=>m.id===t.assigned_to) : undefined,
  co_assignee: t.co_assigned_to ? TEAM.find(m=>m.id===t.co_assigned_to) : undefined,
  client: t.client_id ? CLIENTS.find(c=>c.id===t.client_id) : undefined,
})

let taskSeq = 100
const mkTask = (p: Partial<Task>): Task => withPeople({
  id:'t'+(taskSeq++), text:'', level:'normal', done:false, source:'manual', created_at:iso(-1), ...p,
} as Task)

const TASKS: Task[] = [
  mkTask({ text:'Propuesta Nike Q4 — deck ejecutivo', level:'urgent', due_date:day(0),  assigned_to:'u1', project_id:'p1' }),
  mkTask({ text:'Revisar contrato renovación Adidas', level:'urgent', due_date:day(-1), assigned_to:'u2', project_id:'p2' }),
  mkTask({ text:'Responder email urgente de Zara',     level:'urgent', due_date:day(1),  assigned_to:'u1', project_id:'p3', notes:'Esperan respuesta antes del viernes' }),
  mkTask({ text:'Editar stories lanzamiento verano',   level:'high',   due_date:day(2),  assigned_to:'u3', project_id:'p1' }),
  mkTask({ text:'Preparar memo reunión del lunes',     level:'high',   due_date:day(3),  assigned_to:'u1' }),
  mkTask({ text:'Feedback creatividades Mango',        level:'high',   due_date:day(-3), assigned_to:'u2', project_id:'p4' }),
  mkTask({ text:'Actualizar portfolio web',            level:'normal', due_date:day(9),  assigned_to:'u3' }),
  mkTask({ text:'Programar newsletter agosto',         level:'normal', assigned_to:'u1', project_id:'p3' }),
  mkTask({ text:'Call de seguimiento Mango',           level:'high',   done:true, assigned_to:'u2', project_id:'p4', updated_at:iso(0) }),
  mkTask({ text:'Factura agosto Adidas',               level:'normal', done:true, assigned_to:'u1', updated_at:iso(0) }),
  mkTask({ text:'Brief campaña Nike aprobado',         level:'normal', done:true, assigned_to:'u3', project_id:'p1', updated_at:iso(-1) }),
]

const INBOX: InboxMessage[] = [
  { id:'m1', user_id:'u1', source:'gmail', from_name:'Laura Pérez (Nike)', from_email:'laura@nike.com', subject:'Urgente: cambios en el deck antes del viernes', body_preview:'Hola Javier, necesitamos ajustar las diapositivas 4 y 7…', ai_summary:'Nike pide cambios en el deck antes del viernes.', ai_action:'Actualizar deck y reenviar', ai_client:'Nike', ai_urgency:'urgent', is_read:false, received_at:iso(0), shared:false },
  { id:'m2', user_id:'u1', source:'gmail', from_name:'Carlos Díaz (Adidas)', from_email:'carlos@adidas.com', subject:'Renovación de contrato 2025', body_preview:'Adjunto la propuesta de renovación para revisar…', ai_summary:'Adidas envía propuesta de renovación 2025.', ai_action:'Revisar propuesta', ai_client:'Adidas', ai_urgency:'high', is_read:false, received_at:iso(-1), shared:true },
  { id:'m3', user_id:'u1', source:'gmail', from_name:'Newsletter Meta', subject:'Novedades de Instagram Ads', body_preview:'Descubre las nuevas opciones de segmentación…', ai_summary:'Boletín informativo de Meta.', ai_urgency:'normal', is_read:false, received_at:iso(-2) },
  { id:'m4', user_id:'u1', source:'gmail', from_name:'Ana (Zara)', from_email:'ana@zara.com', subject:'Aprobado: creatividades F/W', ai_summary:'Zara aprueba las creatividades F/W.', ai_client:'Zara', ai_urgency:'normal', is_read:true, received_at:iso(-3) },
]

const REGLAS: Regla[] = [
  { id:'r1', name:'Email urgente → Crear tarea', condition_text:JSON.stringify({v:1,trigger:{type:'email_urgent'},action:{type:'create_task',level:'high'}}), action_text:'Email urgente sin leer › Crear tarea (alta)', active:true, trigger_count:7, last_triggered_at:iso(-0.08) },
  { id:'r2', name:'Deadline cerca → Avisar equipo', condition_text:JSON.stringify({v:1,trigger:{type:'project_deadline',days:7},action:{type:'notify_team'}}), action_text:'Deadline en < 7 días › Notificar al equipo', active:true, trigger_count:3, last_triggered_at:iso(-1) },
  { id:'r3', name:'Muchas tareas vencidas', condition_text:JSON.stringify({v:1,trigger:{type:'many_overdue',threshold:5},action:{type:'notify_owner'}}), action_text:'5+ tareas vencidas › Avisarme a mí', active:true, trigger_count:1, last_triggered_at:iso(-2) },
  { id:'r4', name:'Inbox saturado (manual)', condition_text:'15+ emails sin leer', action_text:'Avisarme', active:false, trigger_count:0 },
]

const AGENDA: ContentItem[] = [
  { id:'a1', title:'Reel lanzamiento Nike', platform:'Instagram', content_type:'Reel', status:'borrador', client_id:'c1' },
  { id:'a2', title:'Carrusel Zara F/W',     platform:'Instagram', content_type:'Post',  status:'pendiente', client_id:'c3' },
  { id:'a3', title:'TikTok Adidas',         platform:'TikTok',    content_type:'Video', status:'listo', client_id:'c2' },
]

// Memoria salía vacía en el harness, así que su estado real —el que ve el equipo
// todos los días— no se podía revisar: solo el cartel de "sin entradas". Una
// entrada por categoría, para poder comprobar los colores de cada una.
const MEMORIA: MemoriaEntry[] = [
  { id:'m1', category:'Clientes',     title:'Nike · tono de marca',
    content:'Nada de superlativos ni signos de exclamación. Frases cortas. El logo siempre sobre fondo liso, nunca sobre foto.',
    created_at:iso(-12), client:CLIENTS[0] },
  { id:'m2', category:'Procesos',     title:'Entrega de vídeo a cliente',
    content:'Exportar en H.264 a 1080p, subir a Drive y compartir el enlace por email — nunca adjunto. El máster en ProRes se queda en el NAS.',
    created_at:iso(-30) },
  { id:'m3', category:'Decisiones',   title:'Por qué dejamos Figma para wireframes',
    content:'Duplicaba el trabajo: el diseño final acababa haciéndose otra vez. Se decidió pasar directo a maqueta en enero.',
    created_at:iso(-45) },
  { id:'m4', category:'Aprendizajes', title:'Los briefs por WhatsApp se pierden',
    content:'Dos encargos se quedaron sin hacer por quedar enterrados en el chat. Todo brief entra por email o se copia a una tarea.',
    created_at:iso(-8) },
  { id:'m5', category:'General',      title:'Accesos y contraseñas',
    content:'Todo va en el gestor compartido. Nunca por chat, nunca en una nota. Si alguien sale del equipo se rotan ese mismo día.',
    created_at:iso(-60) },
]

// Chat tambien salia vacio en el harness. La respuesta de Harvey lleva a proposito
// una lista numerada CON linea en blanco entre items —que es como escribe Claude—
// para poder comprobar que la numeracion no se reinicia.
const CHAT: ChatMessage[] = [
  { id:'ch1', role:'user' as const, content:'¿Qué tengo pendiente con Nike?', created_at:iso(-0.02) },
  { id:'ch2', role:'ai' as const, created_at:iso(-0.019), content:`Con **Nike** tienes tres cosas abiertas:

1. La propuesta Q4 — el deck ejecutivo, vence hoy.

2. Las stories del lanzamiento de verano, asignadas a Marco.

3. El proyecto *Nike Verano 24* va por el 65% y cierra en 5 días.

- El brief de campaña ya está aprobado
- No hay emails de Nike sin responder

> Lo más urgente es el deck: es lo único que vence hoy.` },
]

const CAL_EVENTS: CalendarEvent[] = [
  { id:'e1', title:'Reunión equipo semanal', start:day(0)+'T10:00', end:day(0)+'T11:00', allDay:false },
  { id:'e2', title:'Presentación Nike',      start:day(2)+'T16:30', end:day(2)+'T17:30', allDay:false },
]

// Los parámetros de la URL llegan ya resueltos desde page.tsx, que es un Server
// Component. Leerlos aquí —en el render o en un useEffect, da igual— hace que el
// servidor pinte la sección por defecto y el navegador otra: React aborta la
// hidratación y regenera el árbol. Con la lectura en el servidor los dos parten
// del mismo valor y no hay nada que reconciliar.
export default function PreviewClient({
  initialSection,
  initialView,
  initialFocus,
  initialGroupBy,
}: {
  initialSection: string
  initialView?: string
  initialFocus: boolean
  initialGroupBy?: 'priority' | 'project'
}) {
  const [tasks, setTasks] = useState<Task[]>(TASKS)
  const [reglas, setReglas] = useState<Regla[]>(REGLAS)
  const [inbox, setInbox] = useState<InboxMessage[]>(INBOX)
  const [clients, setClients] = useState<Client[]>(CLIENTS)
  // Proyectos, agenda, memoria y chat eran constantes inmutables: pasan a estado
  // para que los stubs de abajo puedan reflejar el cambio en pantalla. Con un
  // noop, arrastrar una tarjeta del kanban o borrar una pieza no movía nada y la
  // revisión visual daba por bueno un flujo que en la app real sí cambia la lista.
  const [projects, setProjects] = useState<Project[]>(PROJECTS)
  const [agenda, setAgenda] = useState<ContentItem[]>(AGENDA)
  const [memoria, setMemoria] = useState<MemoriaEntry[]>(MEMORIA)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(CHAT)
  const [section, setSection] = useState(initialSection)
  // CreateModal conectado de verdad: antes onOpenModal era una función vacía y
  // este componente —por donde pasa la creación de tareas, clientes, proyectos,
  // piezas y reglas— no se podía mirar sin credenciales.
  const [modal, setModal] = useState<string|null>(null)
  const [mf, setMf] = useState<Record<string,any>>({})
  const [modalSaving, setModalSaving] = useState(false)
  const abrirModal = useCallback((tipo: string) => { setMf({}); setModal(tipo) }, [])
  const guardarModal = useCallback(async () => {
    setModalSaving(true)
    await new Promise(r => setTimeout(r, 500))   // simula la ida al servidor
    setModalSaving(false); setModal(null)
    setToast(`(preview) ${modal} creado`)
  }, [modal])

  const [toast, setToast] = useState('')
  const [projView, setProjView] = useState<'board'|'list'>('board')
  const [projStatusFilter, setProjStatusFilter] = useState('Todos')
  const [selectedProject, setSelectedProject] = useState<string|null>(null)
  const [memFilter, setMemFilter] = useState('Todos')
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const dragRef = useRef<any>(null)

  const showToast = useCallback((m:string)=>{ setToast(m); setTimeout(()=>setToast(''), 2200) }, [])

  const createTask = useCallback(async (p:Partial<Task>)=>{ const t=mkTask({...p, created_at:iso(0)}); setTasks(x=>[t,...x]); return t }, [])
  const updateTask = useCallback(async (id:string, u:Partial<Task>)=>{ setTasks(x=>x.map(t=>t.id===id?withPeople({...t,...u}):t)) }, [])
  const deleteTask = useCallback(async (id:string)=>{ setTasks(x=>x.filter(t=>t.id!==id)) }, [])
  // Devuelve cuántas cayeron, como el hook: TareasSection compara ese número con
  // los ids enviados para no dar por completo un borrado parcial.
  const deleteTasks = useCallback(async (ids:string[])=>{ const f=new Set(ids); setTasks(x=>x.filter(t=>!f.has(t.id))); return ids.length }, [])
  const toggleTask = useCallback(async (id:string)=>{ setTasks(x=>x.map(t=>t.id===id?{...t,done:!t.done,updated_at:iso(0)}:t)) }, [])

  // Sin devolver la regla, igual que el hook: quien la crea no usa el valor.
  const createRegla = useCallback(async (r:Partial<Regla>)=>{ const n={id:'r'+Date.now(),trigger_count:0,active:true,...r} as Regla; setReglas(x=>[n,...x]) }, [])
  const updateRegla = useCallback(async (id:string, u:Partial<Regla>)=>{ setReglas(x=>x.map(r=>r.id===id?{...r,...u}:r)) }, [])
  const deleteRegla = useCallback(async (id:string)=>{ setReglas(x=>x.filter(r=>r.id!==id)) }, [])
  const runAutomations = useCallback(async ()=>{
    setReglas(x=>x.map(r=>r.id==='r1'?{...r,trigger_count:r.trigger_count+1,last_triggered_at:iso(0)}:r))
    return { ran:2, results:[
      { ruleId:'r1', ruleName:'Email urgente → Crear tarea', action:'create_task', detail:'Responder a Laura Pérez sobre "cambios en el deck"' },
      { ruleId:'r2', ruleName:'Deadline cerca → Avisar equipo', action:'notify_team', detail:'Deadline cercano en Nike Verano 24 (5 días)' },
    ] }
  }, [])

  const markRead = useCallback(async (id:string)=>{ setInbox(x=>x.map(m=>m.id===id?{...m,is_read:true}:m)) }, [])
  const markUnread = useCallback(async (id:string)=>{ setInbox(x=>x.map(m=>m.id===id?{...m,is_read:false}:m)) }, [])
  // Faltaba en el stub: el botón "TODO LEÍDO" y el atajo `a` de InboxSection lo
  // llaman sin optional chaining → TypeError dentro del handler de teclado, que
  // ningún SectionErrorBoundary captura (solo cubren errores de render).
  const markManyRead = useCallback(async (ids:string[])=>{ setInbox(x=>x.map(m=>ids.includes(m.id)?{...m,is_read:true}:m)) }, [])
  const noop = useCallback(async ()=>{}, [])

  // Los OCHO que seguían faltando, por el mismo motivo que markManyRead: las
  // secciones reales los llaman sin optional chaining, así que el fallo no era
  // un render roto —que el SectionErrorBoundary sí pinta— sino un TypeError
  // dentro del handler del clic, que no captura nadie: Contenido, Memoria, Chat
  // y Sincronización se quedaban mudas en /preview y no se podían revisar.
  // La forma de retorno imita a la del hook: ContenidoSection espera un array de
  // columnas descartadas, ChatSection espera la respuesta y el booleano de
  // clearChat, y SincronizacionSection lee {synced,total} de syncGmail.
  const updateAgenda = useCallback(async (id:string, u:Partial<ContentItem>)=>{
    setAgenda(x=>x.map(a=>a.id===id?{...a,...u}:a))
    return []   // ninguna columna descartada: aquí no hay servidor que se queje
  }, [])
  const aplicarAgendaLocal = useCallback((fila:ContentItem)=>{ setAgenda(x=>x.map(a=>a.id===fila.id?fila:a)) }, [])
  const deleteAgenda = useCallback(async (id:string)=>{ setAgenda(x=>x.filter(a=>a.id!==id)) }, [])
  const createMemoria = useCallback(async (e:Partial<MemoriaEntry>)=>{
    setMemoria(x=>[{ id:'mem'+Date.now(), category:'General', title:'', content:'', created_at:iso(0), ...e }, ...x])
  }, [])
  const updateMemoria = useCallback(async (id:string, u:Partial<MemoriaEntry>)=>{ setMemoria(x=>x.map(m=>m.id===id?{...m,...u}:m)) }, [])
  const deleteMemoria = useCallback(async (id:string)=>{ setMemoria(x=>x.filter(m=>m.id!==id)) }, [])
  const sendChatMessage = useCallback(async (message:string)=>{
    const reply = '(preview) Aquí respondería Harvey. El harness no llama a Claude: no hay clave ni sesión.'
    setChatMessages(x=>[...x, { id:'u'+Date.now(), role:'user', content:message, created_at:new Date().toISOString() }])
    await new Promise(r => setTimeout(r, 600))   // deja ver el indicador de "escribiendo"
    setChatMessages(x=>[...x, { id:'a'+Date.now(), role:'ai', content:reply, created_at:new Date().toISOString() }])
    return reply
  }, [])
  const clearChat = useCallback(async ()=>{ setChatMessages([]); return true }, [])
  const syncGmail = useCallback(async ()=>{ await new Promise(r => setTimeout(r, 600)); return { synced:0, total:0 } }, [])

  // Clientes y proyectos también dejan de ser noop: la tarjeta «HARVEY PROPONE»
  // de Hoy y de Harvey los crea de verdad —y el kanban mueve tarjetas con
  // updateProject—, así que con un noop la UI cantaba "creado" y no aparecía
  // nada. Las dos creaciones DEVUELVEN la fila porque el dashboard real navega
  // al proyecto recién creado con el id que sale de aquí.
  const createClient = useCallback(async (c:Partial<Client>): Promise<Client> => {
    const nuevo: Client = { id:'c'+Date.now(), industry:'—', status:'Activo', revenue:'—', color:BLU, created_at:iso(0), ...c, name:c.name||'Cliente', initials:(c.name||'??').slice(0,2).toUpperCase() }
    setClients(x=>[nuevo,...x]); return nuevo
  }, [])
  const updateClient = useCallback(async (id:string, u:Partial<Client>)=>{ setClients(x=>x.map(c=>c.id===id?{...c,...u}:c)) }, [])
  const deleteClient = useCallback(async (id:string)=>{ setClients(x=>x.filter(c=>c.id!==id)) }, [])
  const createProject = useCallback(async (p:Partial<Project>): Promise<Project> => {
    const nuevo: Project = { id:'p'+Date.now(), client_id:'', name:'Proyecto', status:'activo', progress:0, deadline:'TBD', color:BLU, created_at:iso(0), ...p }
    setProjects(x=>[{ ...nuevo, client: clients.find(c=>c.id===nuevo.client_id) }, ...x]); return nuevo
  }, [clients])
  const updateProject = useCallback(async (id:string, u:Partial<Project>)=>{ setProjects(x=>x.map(p=>p.id===id?{...p,...u}:p)) }, [])
  const deleteProject = useCallback(async (id:string)=>{ setProjects(x=>x.filter(p=>p.id!==id)) }, [])
  const createAgenda = useCallback(async (i:Partial<ContentItem>)=>{
    setAgenda(x=>[...x, { id:'ag'+Date.now(), title:'', platform:'Instagram', content_type:'Post', status:'borrador', ...i }])
  }, [])
  const reloadInbox = useCallback(async ()=>inbox, [inbox])
  const reloadTeam = useCallback(async ()=>TEAM, [])
  const reloadCalendar = useCallback(async ()=>({ ok:true, noScope:false }), [])

  // Tipado con NexusData, que es el contrato que devuelve useNexusData(), y no
  // con `any`: con `any` un método nuevo del hook que no se replicara aquí no
  // daba error hasta que alguien abría la sección en /preview y reventaba —así
  // se colaron los ocho de arriba. Ahora falta uno y no compila.
  const data: NexusData = {
    loading:false, loadError:false, syncing:false, syncResult:null,
    tasks, projects, clients, team:TEAM, inbox, reglas,
    agenda, memoria, calendarEvents:CAL_EVENTS, chatMessages, calendarScopeError:false,
    createTask, updateTask, deleteTask, deleteTasks, toggleTask,
    createRegla, updateRegla, deleteRegla, runAutomations,
    markRead, markUnread, markManyRead,
    createClient, updateClient, deleteClient,
    createProject, updateProject, deleteProject,
    createAgenda, updateAgenda, deleteAgenda, aplicarAgendaLocal,
    createMemoria, updateMemoria, deleteMemoria,
    sendChatMessage, clearChat, syncGmail,
    sendInternalMessage:noop, reloadInbox, reloadTeam,
    reload:noop, reloadCalendar,
  }
  const profile = TEAM[0]
  const unreadCount = inbox.filter(m=>!m.is_read).length
  const urgentCount = tasks.filter(t=>!t.done&&t.level==='urgent').length

  const SECTIONS = [
    { id:'hoy', label:'Hoy' },
    { id:'tareas', label:'Tareas' },
    { id:'automatizaciones', label:'Automatizaciones' },
    { id:'inbox', label:'Inbox' },
    { id:'reportes', label:'Reportes' },
    { id:'clientes', label:'Clientes' },
    { id:'proyectos', label:'Proyectos' },
    { id:'contenido', label:'Contenido' },
    { id:'calendario', label:'Calendario' },
    { id:'memoria', label:'Memoria' },
    { id:'equipo', label:'Equipo' },
    { id:'chat', label:'Brutal.IA' },
    { id:'harvey', label:'Harvey' },
    { id:'ajustes', label:'Operativa' },
  ]

  const filteredProjects = projStatusFilter === 'Todos' ? projects : projects.filter(p => p.status === projStatusFilter)
  // Mismas columnas que el dashboard real, del módulo compartido: esta copia
  // llevaba «Plan.» y «Revisión» en rgba() —igual que la del dashboard— y
  // ProyectosSection les concatena opacidad, así que el harness enseñaba el
  // tablero roto exactamente igual que producción. Ahora, además, no puede
  // divergir en colores.
  const kanbanCols = construirKanbanCols(filteredProjects)

  return (
    <div className="h-screen flex flex-col" style={{ background:'#030308' }}>
      {/* Preview switcher */}
      <div className="flex items-center gap-1.5 px-4 py-2 flex-shrink-0 overflow-x-auto" style={{ background:'#07070F', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
        <span className="font-syne text-[8px] font-black tracking-widest mr-2 flex-shrink-0" style={{ color:'rgba(255,255,255,0.25)' }}>PREVIEW</span>
        {SECTIONS.map(s=>(
          <button key={s.id} onClick={()=>setSection(s.id)}
            className="px-3 py-1.5 rounded-lg font-syne text-[9px] font-black tracking-wide transition-all flex-shrink-0"
            style={{ background: section===s.id ? BLU+'26' : 'transparent', border:`1px solid ${section===s.id?BLU+'55':'transparent'}`, color: section===s.id?'#7aa5ff':'rgba(255,255,255,0.4)' }}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden min-h-0">
        {section==='hoy' && <SectionErrorBoundary section="hoy"><HoySection profile={profile} data={data} urgentCount={urgentCount} unreadCount={unreadCount} onOpenModal={abrirModal} showToast={showToast} isOwner onNavigate={setSection}/></SectionErrorBoundary>}
        {section==='tareas' && <SectionErrorBoundary section="tareas"><TareasSection data={data} onOpenModal={abrirModal} showToast={showToast} isOwner profile={profile} onNavigate={setSection} onSelectProject={()=>{}} onSelectClient={()=>{}} initialView={initialView} initialFocus={initialFocus} initialGroupBy={initialGroupBy}/></SectionErrorBoundary>}
        {section==='automatizaciones' && <SectionErrorBoundary section="automatizaciones"><AutomatizacionesSection data={data} onOpenModal={abrirModal} showToast={showToast} isOwner/></SectionErrorBoundary>}
        {section==='inbox' && <SectionErrorBoundary section="inbox"><InboxSection data={data} showToast={showToast} profile={profile} onNavigate={setSection} onSelectClient={()=>{}} onAskHarvey={()=>{}}/></SectionErrorBoundary>}
        {section==='reportes' && <SectionErrorBoundary section="reportes"><ReportesSection data={data} onNavigate={setSection}/></SectionErrorBoundary>}
        {section==='clientes' && <SectionErrorBoundary section="clientes"><ClientesSection data={data} selectedId={null} onSelect={()=>{}} onOpenModal={abrirModal} showToast={showToast} isOwner onNavigate={setSection} onSelectProject={()=>{}}/></SectionErrorBoundary>}
        {section==='proyectos' && <SectionErrorBoundary section="proyectos"><ProyectosSection data={data} filteredProjects={filteredProjects} kanbanCols={kanbanCols} projView={projView} setProjView={setProjView} projStatusFilter={projStatusFilter} setProjStatusFilter={setProjStatusFilter} dragRef={dragRef} selectedId={selectedProject} onSelect={setSelectedProject} onOpenModal={abrirModal} showToast={showToast} isOwner onNavigate={setSection} onSelectClient={()=>{}} justCreatedId={null} onJustCreatedScrolled={()=>{}}/></SectionErrorBoundary>}
        {section==='contenido' && <SectionErrorBoundary section="contenido"><ContenidoSection data={data} onOpenModal={abrirModal} showToast={showToast} onNavigate={setSection} onSelectClient={()=>{}} profile={profile}/></SectionErrorBoundary>}
        {section==='calendario' && <SectionErrorBoundary section="calendario"><CalendarioSection data={data} profile={profile} showToast={showToast} onOpenModal={abrirModal}/></SectionErrorBoundary>}
        {section==='memoria' && <SectionErrorBoundary section="memoria"><MemoriaSection data={data} memFilter={memFilter} setMemFilter={setMemFilter} onOpenModal={abrirModal} showToast={showToast}/></SectionErrorBoundary>}
        {section==='equipo' && <SectionErrorBoundary section="equipo"><EquipoSection data={data} profile={profile} showToast={showToast}/></SectionErrorBoundary>}
        {section==='chat' && <SectionErrorBoundary section="chat"><ChatSection profile={profile} data={data} chatInput={chatInput} setChatInput={setChatInput} chatLoading={chatLoading} setChatLoading={setChatLoading} showToast={showToast} onNavigate={setSection}/></SectionErrorBoundary>}
        {section==='harvey' && <SectionErrorBoundary section="harvey"><HarveySection data={data} profile={profile} showToast={showToast} onNavigate={setSection} preloadMessage={null} onClearPreload={()=>{}}/></SectionErrorBoundary>}
        {section==='ajustes' && <SectionErrorBoundary section="ajustes"><AjustesSection profile={profile} data={data} showToast={showToast} memFilter={memFilter} setMemFilter={setMemFilter} onOpenModal={abrirModal} isOwner onNavigate={setSection}/></SectionErrorBoundary>}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl font-figtree text-[13px] z-[200]" style={{ background:'#0F0F1E', border:`1px solid ${BLU}44`, color:'white', boxShadow:'0 10px 40px rgba(0,0,0,0.5)' }}>
          {toast}
        </div>
      )}

      {modal && (
        <CreateModal
          modal={modal as any}
          onClose={() => setModal(null)}
          mf={mf}
          setMf={setMf}
          saving={modalSaving}
          onSave={guardarModal}
          team={TEAM}
          clients={CLIENTS}
        />
      )}
    </div>
  )
}
