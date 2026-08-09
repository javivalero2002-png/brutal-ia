import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de autorización centralizados.
//
// IMPORTANTE: todas las rutas API usan el cliente admin (service role), que se
// salta RLS. Por eso el control de acceso vive AQUÍ, en el código de la ruta:
// es la única barrera real. Estos helpers la hacen consistente.
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthCtx {
  userId: string
  role: 'owner' | 'member'
  admin: SupabaseClient
}

// Devuelve el usuario autenticado + su rol + un admin client, o null si no hay sesión.
export async function getAuthCtx(): Promise<AuthCtx | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = await createAdminClient()
  const { data: profile, error } = await admin.from('profiles').select('role').eq('id', user.id).single()
  // Si la consulta FALLA no se puede saber el rol. Antes se degradaba en silencio
  // a 'member', así que un owner empezaba a recibir 403 en acciones que sí puede
  // hacer, sin ninguna pista de por qué. Devolver null (→ 401) es honesto y hace
  // el fallo diagnosticable; sigue siendo fail-closed.
  if (error) {
    console.error('[authz] no se pudo leer el rol de', user.id, '—', error.message)
    return null
  }
  return { userId: user.id, role: (profile?.role === 'owner' ? 'owner' : 'member'), admin }
}

// ¿Puede este usuario ver/editar esta tarea?
//
// Las tareas son un recurso de EQUIPO, igual que los proyectos: el GET de
// /api/tasks devuelve todas a todo el mundo, y la UI ofrece completar, editar y
// adjuntar en cualquiera de ellas (TareasSection: `canComplete`; CalendarioSection:
// "MARCAR COMO HECHA", ninguno con guardia de rol).
//
// Antes esto restringía a los miembros a sus propias tareas, así que la interfaz
// prometía una acción que la API rechazaba con 403 — y como toggleTask hace update
// optimista y el llamante remata con .catch(()=>{}), el usuario veía la tarea
// marcarse y desmarcarse sola, sin ningún mensaje. Solo comprobamos que la tarea
// exista, para no hacer PATCH a ciegas.
export async function canAccessTask(ctx: AuthCtx, taskId: string): Promise<boolean> {
  const { data } = await ctx.admin.from('tasks').select('id').eq('id', taskId).single()
  return !!data
}

// Los proyectos son recursos de equipo: cualquier miembro autenticado colabora
// en ellos. Solo comprobamos que el proyecto exista (evita PATCH a ciegas).
export async function projectExists(ctx: AuthCtx, projectId: string): Promise<boolean> {
  const { data } = await ctx.admin.from('projects').select('id').eq('id', projectId).single()
  return !!data
}
