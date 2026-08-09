-- ═══════════════════════════════════════════════════════════════════════════
-- Nexus / BRUTAL.IA — Retención de datos e integridad referencial
-- Fecha: 2026-08-10
--
-- CÓMO EJECUTARLO: Supabase → SQL Editor → pega UN BLOQUE cada vez, en orden.
-- NO lo pegues entero de golpe: el bloque 2 borra datos y quieres ver antes
-- cuántas filas se lleva.
--
-- Todo es idempotente: se puede ejecutar dos veces sin romper nada.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- BLOQUE 1 · ÍNDICES  (seguro, no toca datos)
--
-- Las dos lecturas más calientes de la app ordenan por received_at y ninguna
-- tenía índice. A 100 filas da igual; a 10.000 se nota en cada carga.
--
-- SIN `concurrently` a propósito: el SQL Editor de Supabase envuelve cada
-- ejecución en una transacción, y CREATE INDEX CONCURRENTLY no puede correr
-- dentro de una (error 25001). A esta escala el bloqueo dura milisegundos.
-- ───────────────────────────────────────────────────────────────────────────

create index if not exists inbox_messages_received_idx
  on public.inbox_messages (received_at desc);

create index if not exists inbox_messages_user_received_idx
  on public.inbox_messages (user_id, received_at desc);

create index if not exists tasks_due_open_idx
  on public.tasks (due_date) where done = false;

create index if not exists chat_messages_user_created_idx
  on public.chat_messages (user_id, created_at desc);


-- ───────────────────────────────────────────────────────────────────────────
-- BLOQUE 2a · ¿CUÁNTO SE VA A BORRAR?  (solo cuenta, NO borra)
--
-- Ejecuta esto ANTES del 2b y mira los números. Si alguno te parece alto,
-- no sigas y dímelo.
-- ───────────────────────────────────────────────────────────────────────────

select 'inbox leídos > 180 días' as que,
       count(*) as filas
  from public.inbox_messages
 where is_read = true and received_at < now() - interval '180 days'
union all
select 'notificaciones > 30 días',
       count(*) from public.notification_log where created_at < now() - interval '30 days'
union all
select 'mensajes de chat > 90 días',
       count(*) from public.chat_messages where created_at < now() - interval '90 days'
union all
select 'rate_limits > 1 día',
       count(*) from public.rate_limits where window_start < now() - interval '1 day';


-- ───────────────────────────────────────────────────────────────────────────
-- BLOQUE 2b · RETENCIÓN  ⚠️ ESTO SÍ BORRA. Ejecútalo solo tras ver el 2a.
--
-- Por qué importa: es un estudio en la UE guardando correspondencia de clientes
-- indefinidamente y sin política de retención (RGPD art. 5.1.e, limitación del
-- plazo de conservación). Además ninguna de estas tablas tenía borrado en
-- ningún sitio: los límites del código son solo de LECTURA (.limit(100)), así
-- que crecen para siempre sin que se note.
--
-- Solo se borran emails YA LEÍDOS: lo no leído nunca se toca.
-- ───────────────────────────────────────────────────────────────────────────

begin;

delete from public.inbox_messages
 where is_read = true
   and received_at < now() - interval '180 days';

delete from public.notification_log
 where created_at < now() - interval '30 days';

delete from public.chat_messages
 where created_at < now() - interval '90 days';

-- OJO: rate_limits NO tiene created_at; su columna de fecha es window_start
-- (migrations/20260809_audit_fixes.sql). push_rate_limits usa last_sent.
delete from public.rate_limits
 where window_start < now() - interval '1 day';

delete from public.push_rate_limits
 where last_sent < now() - interval '1 day';

commit;


-- ───────────────────────────────────────────────────────────────────────────
-- BLOQUE 3 · INTEGRIDAD: que borrar un cliente NO destruya sus proyectos
--
-- Hoy projects.client_id es ON DELETE CASCADE (schema.sql:64): borrar un
-- cliente elimina en cascada sus proyectos, y con ellos sus notas e hitos —
-- detrás de un botón que solo decía "¿BORRAR?". Una agencia casi nunca quiere
-- un borrado duro de cliente.
--
-- Se cambia a RESTRICT: si el cliente tiene proyectos, Postgres impide el
-- borrado y la app mostrará el error en vez de destruir trabajo.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.projects
  drop constraint if exists projects_client_id_fkey;

alter table public.projects
  add constraint projects_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete restrict;

-- Archivado en vez de borrado: la vía recomendada para "quitar" un cliente.
alter table public.clients
  add column if not exists archived_at timestamptz;

create index if not exists clients_archived_idx
  on public.clients (archived_at) where archived_at is null;


-- ───────────────────────────────────────────────────────────────────────────
-- BLOQUE 4 · COMPROBACIÓN FINAL  (solo lee)
--
-- Esperado: los 5 índices existen, projects_client_id_fkey pone 'r' (restrict)
-- y clients tiene la columna archived_at.
-- ───────────────────────────────────────────────────────────────────────────

select indexname from pg_indexes
 where schemaname = 'public'
   and indexname in ('inbox_messages_received_idx','inbox_messages_user_received_idx',
                     'tasks_due_open_idx','chat_messages_user_created_idx','clients_archived_idx')
 order by indexname;

select conname,
       case confdeltype when 'c' then 'CASCADE ⚠️' when 'r' then 'RESTRICT ✅'
            when 'n' then 'SET NULL' else confdeltype::text end as al_borrar
  from pg_constraint
 where conname = 'projects_client_id_fkey';

select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'clients' and column_name = 'archived_at';
