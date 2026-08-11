-- ─────────────────────────────────────────────────────────────────────────────
-- BRUTAL.IA — Radiografía del esquema REAL de producción
--
-- No requiere psql ni pg_dump. Pega cada consulta en:
--   Supabase Dashboard → SQL Editor → New query → Run
-- y usa el botón de descargar CSV / copiar resultado.
--
-- La CONSULTA 1 devuelve UNA sola celda de texto: cópiala entera, pégala en un
-- archivo y compárala con el repo. Así el trabajo va por hechos, no por memoria.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══ CONSULTA 1 · Todas las columnas, en una celda copiable ══════════════════
-- Salida: una línea por columna, formato  tabla.columna : tipo [NOT NULL] [default]
select string_agg(
         format('%s.%s : %s%s%s',
                table_name,
                column_name,
                data_type,
                case when is_nullable = 'NO' then ' NOT NULL' else '' end,
                case when column_default is not null then ' DEFAULT ' || column_default else '' end),
         E'\n' order by table_name, column_name)
  as esquema_real
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'profiles','clients','projects','tasks','inbox_messages','memoria',
    'content_agenda','reglas','chat_messages','whatsapp_sessions',
    'project_notes','project_milestones','task_subtasks','task_attachments',
    'notification_log','rate_limits','push_rate_limits','client_comments'
  );


-- ═══ CONSULTA 2 · Todas las claves foráneas y su regla de borrado ════════════
-- Aquí se ve de un vistazo qué CASCADE puede destruir datos.
select tc.table_name          as tabla,
       kcu.column_name        as columna,
       ccu.table_name         as referencia,
       rc.delete_rule         as al_borrar,
       tc.constraint_name     as nombre_fk
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on kcu.constraint_name = tc.constraint_name and kcu.constraint_schema = tc.constraint_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name and ccu.constraint_schema = tc.constraint_schema
join information_schema.referential_constraints rc
  on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.constraint_schema
where tc.constraint_type = 'FOREIGN KEY'
  and tc.table_schema = 'public'
order by (rc.delete_rule = 'CASCADE') desc, tc.table_name, kcu.column_name;


-- ═══ CONSULTA 3 · ¿Existe la FK que sostiene GET /api/tasks? ═════════════════
-- Debe devolver exactamente una fila. Si devuelve cero, el repo NO puede
-- reconstruir producción: /api/tasks daría 500 y el dashboard arrancaría vacío.
select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.tasks'::regclass
  and contype = 'f'
  and conname like '%co_assigned%';


-- ═══ CONSULTA 4 · Tablas del esquema public y si tienen RLS ═════════════════
select c.relname as tabla,
       c.relrowsecurity as rls_activo,
       (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as politicas
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;


-- ═══ CONSULTA 5 · Volumen y antigüedad (para decidir la retención) ══════════
select 'inbox_messages'  as tabla, count(*) as filas, min(received_at)::date as mas_antiguo from public.inbox_messages
union all select 'notification_log', count(*), min(created_at)::date from public.notification_log
union all select 'chat_messages',    count(*), min(created_at)::date from public.chat_messages
union all select 'clients',          count(*), min(created_at)::date from public.clients
union all select 'projects',         count(*), min(created_at)::date from public.projects
union all select 'tasks',            count(*), min(created_at)::date from public.tasks;


-- ─────────────────────────────────────────────────────────────────────────────
-- ALTERNATIVA CON HERRAMIENTAS (si prefieres un volcado completo en un archivo)
--
-- No hace falta instalar psql: la CLI de Supabase se ejecuta con npx.
-- La cadena de conexión está en:
--   Supabase Dashboard → Project Settings → Database → Connection string → URI
--
--   npx --yes supabase@latest db dump \
--     --db-url "postgresql://postgres.<REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres" \
--     --schema public \
--     -f supabase/_prod_dump.sql
--
--   git diff --no-index supabase/schema.sql supabase/_prod_dump.sql
--
-- ⚠️ supabase/_prod_dump.sql NO debe commitearse (puede llevar nombres de
--    políticas y detalles de infraestructura). Añádelo a .gitignore o bórralo
--    después de comparar.
-- ─────────────────────────────────────────────────────────────────────────────
