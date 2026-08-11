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
  cover_url?: string | null
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

export interface NexusData {
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
  // Data mutation methods
  createClient: (data: Partial<Client>) => Promise<Client | null>
  updateClient: (id: string, data: Partial<Client>) => Promise<void>
  deleteClient: (id: string) => Promise<void>
  createProject: (data: Partial<Project>) => Promise<Project | null>
  updateProject: (id: string, data: Partial<Project>) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  createTask: (data: Partial<Task>) => Promise<Task | null>
  updateTask: (id: string, data: Partial<Task>) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  createMemoria: (data: Partial<MemoriaEntry>) => Promise<MemoriaEntry | null>
  updateMemoria: (id: string, data: Partial<MemoriaEntry>) => Promise<void>
  deleteMemoria: (id: string) => Promise<void>
  createAgenda: (data: Partial<ContentItem>) => Promise<ContentItem | null>
  updateAgenda: (id: string, data: Partial<ContentItem>) => Promise<void>
  deleteAgenda: (id: string) => Promise<void>
  createRegla: (data: Partial<Regla>) => Promise<Regla | null>
  updateRegla: (id: string, data: Partial<Regla>) => Promise<void>
  deleteRegla: (id: string) => Promise<void>
  sendInternalMessage: (toId: string, subject: string, body: string, fromName: string) => Promise<void>
  reloadCalendar?: () => Promise<void>
  reloadInbox?: () => Promise<any>
  calendarScopeError: boolean
  [key: string]: unknown
}

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
}

export interface SectionProps {
  data: NexusData
  profile: Profile
  showToast: (msg: string) => void
  onOpenModal: (type: string) => void
  onSetMf: (fields: Record<string, string>) => void
  isOwner: boolean
}
