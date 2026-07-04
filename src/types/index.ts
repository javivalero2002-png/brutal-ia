export interface Profile {
  id: string
  email: string
  name: string
  role: 'owner' | 'member'
  avatar_color: string
  initials: string
  gmail_connected: boolean
  gmail_refresh_token?: string
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
}

export interface Project {
  id: string
  client_id: string
  name: string
  status: 'plan.' | 'activo' | 'urgente' | 'revisión' | 'completado'
  progress: number
  deadline: string
  color: string
  created_at: string
  client?: Client
}

export interface Task {
  id: string
  project_id?: string
  client_id?: string
  created_by?: string
  assigned_to?: string
  text: string
  level: 'urgent' | 'high' | 'normal'
  done: boolean
  due_date?: string
  source: 'manual' | 'gmail' | 'whatsapp' | 'ai'
  created_at: string
  assignee?: Profile
  client?: Client
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
  content_type: string
  status: 'borrador' | 'pendiente' | 'listo' | 'publicado'
  publish_date?: string
  publish_time?: string
  notes?: string
  video_url?: string
  feedback?: string
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
}

export interface ChatMessage {
  id: string
  role: 'user' | 'ai'
  content: string
  created_at: string
}
