-- ─────────────────────────────────────────────────────────────────────────────
-- BRUTAL.IA — RECONCILIACIÓN DE ESQUEMA (10 ago 2026)
--
-- Objetivo: que el repositorio pueda reconstruir producción DESDE CERO.
-- Hoy hay columnas y una tabla que solo existen en la base de datos viva y no
-- tienen DDL en ningún .sql del repo. Si mañana se levanta un proyecto nuevo de
-- Supabase con supabase/schema.sql + las migraciones, la app arranca ROTA.
--
-- Este archivo es IDEMPOTENTE: se puede lanzar contra la base de datos LIVE
-- (que ya tiene casi todo) tantas veces como haga falta. No borra datos.
--
-- Ejecutar entero en: Supabase Dashboard → SQL Editor → New query → Run.
-- Orden: después de supabase/schema.sql y de todas las migraciones anteriores.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 · CRÍTICO — tasks.co_assigned_to + su FOREIGN KEY
--
-- src/app/api/tasks/route.ts:22 hace, en TODAS las lecturas de tareas:
--     co_assignee:profiles!co_assigned_to(id,name,initials,avatar_color)
-- PostgREST resuelve ese embed por la FOREIGN KEY de la columna. Sin la FK
-- devuelve PGRST200 ("Could not find a relationship...") → GET /api/tasks 500.
-- Y como src/hooks/useNexusData.ts:61 carga todo con Promise.all sin catch,
-- ese 500 tumba clientes, proyectos, tareas, inbox, memoria, agenda, reglas y
-- chat a la vez: el dashboard arranca COMPLETAMENTE vacío.
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.tasks
  add column if not exists co_assigned_to uuid;

-- Higiene previa: si quedara algún valor huérfano (perfil ya borrado), la FK
-- fallaría al crearse. Lo dejamos en null antes de añadir la restricción.
update public.tasks t
   set co_assigned_to = null
 where t.co_assigned_to is not null
   and not exists (select 1 from public.profiles p where p.id = t.co_assigned_to);

-- `add constraint` no admite `if not exists`: lo envolvemos.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tasks'::regclass
       and contype  = 'f'
       and conname  = 'tasks_co_assigned_to_fkey'
  ) then
    alter table public.tasks
      add constraint tasks_co_assigned_to_fkey
      foreign key (co_assigned_to) references public.profiles(id) on delete set null;
  end if;
end $$;

create index if not exists idx_tasks_co_assigned on public.tasks(co_assigned_to);

comment on column public.tasks.co_assigned_to is
  'Segundo responsable. La FK tasks_co_assigned_to_fkey es OBLIGATORIA: el embed '
  'co_assignee:profiles!co_assigned_to de /api/tasks la necesita o devuelve 500.';


-- ═════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 · tasks.notes
--
-- La usa la UI (TareasSection.tsx:1043) y, sobre todo, el motor de
-- automatizaciones: src/lib/automations.ts:291 guarda ahí la marca oculta
-- '⚙ auto:<reglaId>:<clave>' y automations.ts:254-265 la relee para no crear
-- la misma tarea dos veces. Sin esta columna el insert falla, `if (!error)`
-- se salta el registro de la marca y las automatizaciones dejan de funcionar
-- EN SILENCIO (0 tareas creadas, 0 errores visibles).
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.tasks
  add column if not exists notes text;

comment on column public.tasks.notes is
  'Notas libres de la tarea. También almacena la marca de deduplicación de '
  'automatizaciones (AUTO_MARK en src/lib/automations.ts:20).';


-- ═════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 · projects.cover_url y projects.pdf_url
--
-- Escritas en src/app/api/projects/route.ts:35 y projects/[id]/route.ts:21,
-- leídas en ProyectosSection.tsx:105 (pdf_url) y :446/:574 (cover_url).
-- Nota: projects.pdf_analysis SÍ existe ya (supabase/migration_pdf_analysis.sql:4).
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.projects
  add column if not exists cover_url text,
  add column if not exists pdf_url   text;


-- ═════════════════════════════════════════════════════════════════════════════
-- BLOQUE 4 · content_agenda.feedback  +  content_agenda.review_feedback
--
-- ⚠️ COLISIÓN REAL DE FORMATOS, no solo una columna que falta:
--
--   · ContenidoSection.tsx:207/217/222 trata `feedback` como un ARRAY JSON de
--     opiniones del equipo: [{userId,name,initials,color,emoji,note,at}, ...]
--   · src/app/api/review/[token]/route.ts:45-49 (endpoint PÚBLICO de revisión
--     de cliente) escribe en la MISMA columna texto plano acumulativo:
--     "[09/08 17:32] me gusta pero cambia el color"
--
-- Consecuencia con una sola columna: en cuanto un cliente envía feedback por
-- el enlace de revisión, JSON.parse revienta, el catch devuelve [] y TODAS las
-- opiniones del equipo desaparecen de la interfaz; y la siguiente opinión que
-- alguien publique sobrescribe el texto del cliente. Se pierden los dos lados.
--
-- Por eso se separan: `feedback` = opiniones internas (JSON), `review_feedback`
-- = revisión del cliente (texto). Requiere el cambio de código correspondiente
-- en src/app/api/review/[token]/route.ts (ver plan, paso de código).
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.content_agenda
  add column if not exists feedback        text,
  add column if not exists review_feedback text;

comment on column public.content_agenda.feedback is
  'Opiniones internas del equipo. Formato: array JSON serializado. Lo escribe '
  'ContenidoSection.tsx (saveOpinion). NO escribir texto plano aquí.';
comment on column public.content_agenda.review_feedback is
  'Feedback del cliente vía enlace público /review/[token]. Texto plano '
  'acumulativo con marca de fecha. Nunca JSON.';


-- ═════════════════════════════════════════════════════════════════════════════
-- BLOQUE 5 · tabla client_comments
--
-- src/app/api/clients/[id]/comments/route.ts la lee (:12) y escribe (:43-44)
-- con las columnas client_id, profile_id, body, created_at. No existe DDL en
-- ningún .sql del repo. Hoy el GET devuelve [] ante CUALQUIER error (:17-21),
-- así que en una base nueva la pestaña de comentarios se ve vacía y funcional,
-- pero el POST devuelve 500.
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists public.client_comments (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients(id)  on delete cascade,
  profile_id uuid          references public.profiles(id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now()
);

create index if not exists client_comments_client_idx
  on public.client_comments(client_id, created_at);

alter table public.client_comments enable row level security;
-- Sin políticas a propósito: solo se accede vía API con service role,
-- igual que projects/clients/tasks tras 20260809_rls_defense_in_depth.sql.

comment on table public.client_comments is
  'Comentarios internos del equipo sobre un cliente. Solo service role.';


-- ═════════════════════════════════════════════════════════════════════════════
-- BLOQUE 6 · clients.archived_at — borrado suave
--
-- Prepara el terreno para dejar de hacer DELETE físico de clientes (ver
-- BLOQUE 7). Añadir la columna es inocuo y no cambia ningún comportamiento
-- hasta que el código la use.
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.clients
  add column if not exists archived_at timestamptz;

create index if not exists clients_active_idx
  on public.clients(name) where archived_at is null;

comment on column public.clients.archived_at is
  'Marca de archivado (borrado suave). null = cliente activo. Preferir esto a '
  'DELETE: projects.client_id era ON DELETE CASCADE.';


-- ═════════════════════════════════════════════════════════════════════════════
-- BLOQUE 7 · FKs DESTRUCTIVAS  ⚠️ REVISAR ANTES DE EJECUTAR
--
-- Este bloque va comentado a propósito. Cambia el comportamiento de borrado y
-- debe ejecutarse de forma consciente, no como efecto colateral. Descomenta lo
-- que quieras aplicar.
--
-- 7a) projects.client_id  (supabase/schema.sql:64)  ON DELETE CASCADE
--     Borrar un cliente destruye sus proyectos y, en cascada, project_notes y
--     project_milestones (migrations/20260804_...:4 y :17). El único aviso en
--     la interfaz es un botón que pone "¿BORRAR?" (ClientesSection.tsx:189).
--     Todas las demás FKs a clients ya son `on delete set null`
--     (tasks:79, memoria:117, content_agenda:130). Esta es la excepción.
--
-- alter table public.projects drop constraint if exists projects_client_id_fkey;
-- alter table public.projects
--   add constraint projects_client_id_fkey
--   foreign key (client_id) references public.clients(id) on delete set null;
--
--     Alternativa más estricta (bloquea el borrado en vez de huerfanizar):
--       ... on delete restrict;
--
--
-- 7b) inbox_messages.user_id  (supabase/schema.sql:94)  ON DELETE CASCADE + NOT NULL
--     /api/admin/team DELETE (:148) llama a auth.admin.deleteUser → cascada
--     auth.users → profiles → inbox_messages. Quitar a un compañero borra todo
--     el correo de empresa que su sincronización había ingerido, incluidos los
--     mensajes shared=true del buzón de colaboraciones que ve TODO el equipo.
--
-- alter table public.inbox_messages alter column user_id drop not null;
-- alter table public.inbox_messages drop constraint if exists inbox_messages_user_id_fkey;
-- alter table public.inbox_messages
--   add constraint inbox_messages_user_id_fkey
--   foreign key (user_id) references public.profiles(id) on delete set null;
--
--     Tras esto, el correo compartido sobrevive con user_id null y sigue
--     visible (la consulta de /api/inbox usa `user_id.eq.X OR shared.eq.true`
--     y la política RLS de 20260809_rls_defense_in_depth.sql:34 hace lo mismo).
--     El correo personal del ex-compañero queda con user_id null y shared=false
--     → invisible para todos, que es el comportamiento deseado.
-- ═════════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════════
-- BLOQUE 8 · RETENCIÓN DE DATOS (RGPD)
--
-- Hoy no se borra NADA nunca: ni inbox_messages (correspondencia de clientes
-- reales, con cuerpo, remitente y resumen IA), ni notification_log, ni
-- chat_messages, ni rate_limits. Un estudio europeo que guarda correo de
-- clientes indefinidamente y sin plazo de conservación documentado no cumple
-- el principio de limitación del plazo de conservación (art. 5.1.e RGPD).
--
-- La función se crea aquí; NO se ejecuta sola. La llama el cron horario desde
-- src/app/api/cron/sync-colabs/route.ts vía admin.rpc('purge_old_data').
--
-- ⚠️ Los plazos de abajo son una PROPUESTA. Ajústalos antes de la primera
--    ejecución: son irreversibles.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.purge_old_data()
returns table (tabla text, borrados bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  n bigint;
begin
  -- Correspondencia: 18 meses. AJUSTAR según la política del estudio.
  delete from public.inbox_messages where received_at < now() - interval '18 months';
  get diagnostics n = row_count; tabla := 'inbox_messages'; borrados := n; return next;

  -- Historial de avisos push: 90 días. Es un feed de UI, no un registro legal.
  delete from public.notification_log where created_at < now() - interval '90 days';
  get diagnostics n = row_count; tabla := 'notification_log'; borrados := n; return next;

  -- Chat con la IA: 12 meses.
  delete from public.chat_messages where created_at < now() - interval '12 months';
  get diagnostics n = row_count; tabla := 'chat_messages'; borrados := n; return next;

  -- Contadores efímeros: la ventana más larga es de 1 minuto (src/lib/rate-limit.ts:63,68).
  delete from public.rate_limits where window_start < now() - interval '1 day';
  get diagnostics n = row_count; tabla := 'rate_limits'; borrados := n; return next;

  -- Throttle de push: ventana de 90s (src/lib/push.ts:28).
  delete from public.push_rate_limits where last_sent < now() - interval '7 days';
  get diagnostics n = row_count; tabla := 'push_rate_limits'; borrados := n; return next;

  -- Sesiones de WhatsApp inactivas (integración futura, aún sin tráfico).
  delete from public.whatsapp_sessions where coalesce(last_message_at, created_at) < now() - interval '6 months';
  get diagnostics n = row_count; tabla := 'whatsapp_sessions'; borrados := n; return next;
end $$;

-- Solo el service role (las rutas API) puede lanzarla.
revoke execute on function public.purge_old_data() from public, anon, authenticated;
grant  execute on function public.purge_old_data() to service_role;

comment on function public.purge_old_data() is
  'Retención RGPD. La llama el cron horario (/api/cron/sync-colabs) una vez al '
  'día. Devuelve el recuento de filas borradas por tabla.';


-- ═════════════════════════════════════════════════════════════════════════════
-- BLOQUE 9 · Refrescar la caché de esquema de PostgREST
--
-- Sin esto, el embed profiles!co_assigned_to puede seguir devolviendo PGRST200
-- hasta que PostgREST recargue. Supabase suele recargar solo tras un DDL, pero
-- este NOTIFY lo fuerza y no cuesta nada.
-- ═════════════════════════════════════════════════════════════════════════════

notify pgrst, 'reload schema';


-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN — ejecuta esto después y comprueba que salen 8 filas en `ok`.
-- ═════════════════════════════════════════════════════════════════════════════
--
-- select 'tasks.co_assigned_to'        as ok where exists (select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='co_assigned_to')
-- union all select 'tasks_co_assigned_to_fkey' where exists (select 1 from pg_constraint where conname='tasks_co_assigned_to_fkey')
-- union all select 'tasks.notes'                where exists (select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='notes')
-- union all select 'projects.cover_url'         where exists (select 1 from information_schema.columns where table_schema='public' and table_name='projects' and column_name='cover_url')
-- union all select 'projects.pdf_url'           where exists (select 1 from information_schema.columns where table_schema='public' and table_name='projects' and column_name='pdf_url')
-- union all select 'content_agenda.feedback'    where exists (select 1 from information_schema.columns where table_schema='public' and table_name='content_agenda' and column_name='feedback')
-- union all select 'client_comments'            where exists (select 1 from information_schema.tables  where table_schema='public' and table_name='client_comments')
-- union all select 'clients.archived_at'        where exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='archived_at');
