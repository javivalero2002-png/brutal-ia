export interface Profile {
  id: string
  email: string
  name: string
  role: 'owner' | 'member'
  avatar_color: string
  initials: string
  gmail_connected: boolean
  gmail_refresh_token?: string
  gmail_account?: string
  gmail_colabs_connected?: boolean
  gmail_colabs_refresh_token?: string
  gmail_colabs_account?: string
  /** Cuándo pasó por la puesta en marcha. Sin valor = todavía no la ha visto. */
  onboarding_at?: string | null
}

export interface Client {
  id: string
  name: string
  industry: string
  status: 'Activo' | 'Pausado' | 'Archivado'
  revenue: string
  notes?: string
  color: string
  initials: string
  created_at: string
  /** Se sella al pasar a 'Archivado' y se limpia al reactivar. Lo deriva el
   *  servidor del propio estado — el cliente nunca lo envía. */
  archived_at?: string | null
}

export interface Project {
  id: string
  client_id: string
  name: string
  status: 'plan.' | 'activo' | 'urgente' | 'revisión' | 'completado'
  progress: number
  deadline: string
  color: string
  cover_url?: string
  pdf_url?: string | null
  pdf_analysis?: string | null
  created_at: string
  client?: Client
}

export interface Task {
  id: string
  // Nullable en Postgres. El tipo debe admitir null explícito: JSON.stringify
  // elimina las claves undefined, así que "limpiar" un campo solo persiste si
  // viaja como null en el PATCH.
  project_id?: string | null
  client_id?: string | null
  created_by?: string
  assigned_to?: string | null
  co_assigned_to?: string | null
  notes?: string | null
  text: string
  level: 'urgent' | 'high' | 'normal'
  done: boolean
  due_date?: string | null
  source: 'manual' | 'gmail' | 'whatsapp' | 'ai'
  created_at: string
  updated_at?: string
  /** Momento real de completado. Lo sella la API al marcar done. */
  completed_at?: string | null
  /**
   * De qué línea de diario nació esta tarea. Las dos van juntas o ninguna.
   *
   * Antes el Diario emparejaba sus objetivos con las tareas por el TEXTO, así que
   * en cuanto alguien retocaba el texto de la tarea desde Tareas el vínculo se
   * rompía: la burbuja salía sin tachar aunque estuviera hecha, y al tocarla se
   * creaba una SEGUNDA tarea con el texto viejo. Dos tareas para un trabajo.
   */
  diario_dia?: string | null
  diario_objetivo?: string | null
  assignee?: Profile
  co_assignee?: Profile
  client?: Client
}

export interface AttachmentMeta {
  attachmentId: string
  filename: string
  mimeType: string
  size: number
}

export interface InboxMessage {
  id: string
  user_id: string
  source: 'gmail' | 'whatsapp' | 'internal'
  gmail_id?: string
  from_name: string
  from_email?: string
  from_phone?: string
  subject?: string
  body_preview?: string
  ai_summary?: string
  ai_action?: string
  ai_client?: string
  ai_urgency: 'urgent' | 'high' | 'normal'
  is_read: boolean
  is_unread?: boolean
  shared?: boolean
  received_at: string
  attachments?: AttachmentMeta[]
}

export interface MemoriaEntry {
  id: string
  category: string
  title: string
  content: string
  source?: string
  created_at: string
  /** El cliente al que pertenece. La ruta ya lo aceptaba; faltaba declararlo. */
  client_id?: string | null
  client?: Client
}

export interface ContentItem {
  id: string
  title: string
  platform: string
  account_name?: string
  content_type: string
  status: 'borrador' | 'pendiente' | 'listo' | 'publicado'
  publish_date?: string
  publish_time?: string
  notes?: string
  video_url?: string
  cover_url?: string
  /**
   * Carpeta donde vive la pieza una vez publicada.
   *
   * Texto libre y no una tabla: crear una carpeta es escribir su nombre, y una
   * carpeta vacía simplemente no existe — que a esta escala es lo correcto.
   */
  carpeta?: string | null
  feedback?: string
  client_id?: string
  client?: Client
}

export interface Regla {
  id: string
  name: string
  description?: string
  condition_text?: string
  action_text?: string
  active: boolean
  trigger_count: number
  last_triggered_at?: string
  created_at?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'ai'
  content: string
  created_at: string
  searched?: boolean
}

// ── Shared section prop types ────────────────────────────────────────────────

// Contrato de lo que `useNexusData()` devuelve. Estuvo desincronizado con el hook
// —y nadie lo importaba, asi que `tsc` no veia la divergencia—: por ahi se colaron
// ocho metodos que el stub de /preview no implementaba y que reventaban en el
// handler de teclado, fuera del alcance de los SectionErrorBoundary. Cada firma de
// aqui esta copiada del `return` de src/hooks/useNexusData.ts: si cambia una, esta
// tiene que cambiar con ella.
export interface NexusData {
  loading: boolean
  /** false hasta que alguna de las nueve consultas del arranque falla. */
  loadError: boolean
  syncing: boolean
  syncResult: { ok: boolean; message: string } | null
  syncGmail: () => Promise<{ synced: number; total: number; insertFailures?: number }>
  clients: Client[]
  projects: Project[]
  tasks: Task[]
  inbox: InboxMessage[]
  team: Profile[]
  memoria: MemoriaEntry[]
  agenda: ContentItem[]
  reglas: Regla[]
  chatMessages: ChatMessage[]
  calendarEvents: CalendarEvent[]
  calendarScopeError: boolean
  // Data mutation methods
  createClient: (data: Partial<Client>) => Promise<Client>
  updateClient: (id: string, data: Partial<Client>) => Promise<void>
  deleteClient: (id: string) => Promise<void>
  createProject: (data: Partial<Project>) => Promise<Project>
  updateProject: (id: string, data: Partial<Project>) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  createTask: (data: Partial<Task>) => Promise<Task>
  updateTask: (id: string, data: Partial<Task>) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  /** Cuantas borro el servidor de verdad. Relanza si no coinciden con las enviadas. */
  deleteTasks: (ids: string[]) => Promise<number>
  toggleTask: (id: string) => Promise<void>
  markRead: (id: string) => Promise<void>
  markManyRead: (ids: string[]) => Promise<void>
  markUnread: (id: string) => Promise<void>
  createMemoria: (data: Partial<MemoriaEntry>) => Promise<void>
  updateMemoria: (id: string, data: Partial<MemoriaEntry>) => Promise<void>
  deleteMemoria: (id: string) => Promise<void>
  createAgenda: (data: Partial<ContentItem>) => Promise<void>
  /** Columnas que el PATCH no pudo escribir (guardado parcial); vacio si fue completo. */
  updateAgenda: (id: string, data: Partial<ContentItem>) => Promise<string[]>
  /** Mete en la lista una fila que el servidor YA ha escrito. No hace PATCH. */
  aplicarAgendaLocal: (fila: ContentItem) => void
  deleteAgenda: (id: string) => Promise<void>
  createRegla: (data: Partial<Regla>) => Promise<void>
  updateRegla: (id: string, data: Partial<Regla>) => Promise<void>
  deleteRegla: (id: string) => Promise<void>
  runAutomations: () => Promise<{ ran: number; results: Array<{ ruleId?: string; ruleName: string; action: string; detail: string }>; skipped?: boolean }>
  sendInternalMessage: (toId: string, subject: string, body: string, fromName: string) => Promise<void>
  sendChatMessage: (message: string) => Promise<string>
  /** false si el borrado en servidor fallo, para que la UI no diga que borro. */
  clearChat: () => Promise<boolean>
  reload: () => Promise<void>
  reloadInbox: () => Promise<InboxMessage[]>
  reloadTeam: () => Promise<Profile[]>
  // Devuelve el resultado, no solo setea estado: leer `calendarScopeError` justo
  // despues del await da el valor del render anterior.
  reloadCalendar: () => Promise<{ ok: boolean; noScope: boolean }>
  [key: string]: unknown
}

// Gemela de la que exporta src/hooks/useNexusData.ts (es de donde la importan los
// componentes). Le faltaba `hangoutLink`, que lib/gmail.ts si rellena y el boton de
// "unirse a la videollamada" de CalendarioSection si lee: con esta copia el evento
// llegaba sin esa clave y el enlace de Meet no existia.
export interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
  location?: string
  description?: string
  colorId?: string
  htmlLink?: string
  hangoutLink?: string
  /** De qué calendario de Google sale. Editar y borrar lo necesitan: sin él iban
   *  siempre contra 'primary' y devolvían 404 para todo lo demás. */
  calendarId?: string
  /** false = calendario compartido en solo lectura. La UI esconde EDITAR y
   *  ELIMINAR, que ahí Google contesta 403. */
  editable?: boolean
}

// Base para tipar una seccion. Solo `data` es universal: NexusDashboard le pasa a
// cada una lo que necesita —ReportesSection recibe `data` y `onNavigate` y nada
// mas—, asi que declarar el resto como obligatorio convertia este tipo en algo que
// no encajaba con ninguna seccion real. Cada seccion extiende esto con SUS props.
export interface SectionProps {
  data: NexusData
  profile?: Profile
  showToast?: (msg: string) => void
  onOpenModal?: (type: string | null, prellenado?: Record<string,string>) => void
  onNavigate?: (section: string) => void
  onSelectClient?: (id: string | null) => void
  onSelectProject?: (id: string | null) => void
  isOwner?: boolean
}
