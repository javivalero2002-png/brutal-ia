-- ============================================================================
-- Fase 4a + 4b — dos columnas que faltaban. Solo AÑADE: no borra ni modifica
-- nada existente, así que es segura de ejecutar con la app en marcha.
--
-- Verificado contra la base de producción el 2026-08-13 antes de escribirla:
--   · content_agenda.feedback   -> NO existe (42703)
--   · inbox_messages.from_user_id -> NO existe (42703)
--   · el resto de columnas que el código usa (tasks.co_assigned_to, notes,
--     completed_at, projects.cover_url/pdf_url/pdf_analysis, clients.archived_at)
--     SÍ existen, y el embed co_assignee:profiles!co_assigned_to responde 200.
-- ============================================================================


-- ── 4a · content_agenda.feedback ────────────────────────────────────────────
--
-- Sin esta columna la revisión con cliente está MUERTA, no degradada:
-- /api/review/[token] hace `.select('feedback')`, eso falla con 42703, `existing`
-- queda en null y la ruta responde **404 Not Found**. O sea: le mandas el enlace a
-- un cliente, escribe su opinión, le da a enviar y le sale que no existe.
--
-- Y por el lado del equipo, "Opiniones del equipo" se guardaba en el PATCH de
-- /api/agenda/[id], que descarta las columnas inexistentes y devuelve `__dropped`.
-- Hasta hoy nadie leía ese aviso, así que decía "Opinión publicada" y se perdía.
--
-- Es TEXT y no JSONB a propósito: el código guarda un array JSON serializado con
-- JSON.stringify y lo lee con JSON.parse, con un fallback a [] si no parsea
-- (ContenidoSection y review/[token]). Ponerla JSONB obligaría a tocar los dos
-- escritores y el lector, y no aporta nada a esta escala.
alter table public.content_agenda
  add column if not exists feedback text;

comment on column public.content_agenda.feedback is
  'Array JSON serializado de opiniones: [{userId,name,initials,color,emoji,note,at}]. '
  'Dos escritores: el equipo desde ContenidoSection y el cliente desde /review/[token]. '
  'Por eso ContenidoSection relee la fila con GET /api/agenda/[id] justo antes de escribir.';

-- NOTA: `review_feedback` NO se añade. Aparecía en el plan rechazado, pero un grep
-- sobre todo src no la encuentra en ningún sitio: es una columna fantasma.


-- ── 4b · inbox_messages.from_user_id ────────────────────────────────────────
--
-- Cierra el resto del agujero de los mensajes directos.
--
-- `inbox_messages` no guarda quién envía: solo `from_name`, que POST /api/inbox
-- saca de la sesión. /api/inbox/thread empareja la conversación por ese nombre, y
-- un nombre NO es una identidad: `profiles.name` no es unique y cualquiera se lo
-- cambia. Renombrándote como un compañero, esa ruta te devolvía los DM que él le
-- había mandado a un tercero.
--
-- El 2026-08-13 se cerró lo cerrable sin esquema (el nombre del otro sale de la BD
-- por id, dos homónimos cortan con 409, y /api/profile ya no deja repetir nombre).
-- Lo que quedaba abierto: un nombre liberado por un renombrado antiguo sigue
-- casando los mensajes históricos. Con esta columna el emparejado pasa a ser por
-- id y el agujero desaparece del todo.
--
-- SIN backfill: verificado el 2026-08-13 que `inbox_messages` tiene CERO filas con
-- source='internal'. No hay nada que migrar, así que tampoco hay que adivinar a
-- quién pertenece un nombre repetido — que era el punto delicado del plan viejo.
--
-- ON DELETE SET NULL y no CASCADE: si alguien se da de baja, sus mensajes no deben
-- desaparecer de la bandeja de quien los recibió. Se queda el `from_name` como
-- rastro legible y el hilo se corta solo, que es lo correcto.
alter table public.inbox_messages
  add column if not exists from_user_id uuid references public.profiles(id) on delete set null;

create index if not exists idx_inbox_from_user
  on public.inbox_messages (user_id, from_user_id)
  where source = 'internal';

comment on column public.inbox_messages.from_user_id is
  'Quién envía, por id. Es la identidad real del remitente: from_name es solo para '
  'mostrar. Nulo en filas anteriores al 2026-08-13 (no hay ninguna) y en los correos '
  'de Gmail, que no vienen de un perfil.';


-- ── Comprobación ────────────────────────────────────────────────────────────
-- Debe devolver las dos filas. Si falta alguna, algo ha ido mal.
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where (table_name = 'content_agenda' and column_name = 'feedback')
   or (table_name = 'inbox_messages' and column_name = 'from_user_id')
order by table_name;
