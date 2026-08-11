-- ─────────────────────────────────────────────────────────────────────────────
-- Cerrojo entre instancias para trabajos que no deben solaparse.
--
-- Lo usa el motor de automatizaciones (src/lib/jobLock.ts). Sin esto, dos
-- ejecuciones a la vez —dos personas pulsando "Ejecutar ahora", o una persona
-- justo cuando salta el cron de la hora en punto— crean la misma tarea dos veces
-- y avisan dos veces a los 7 del equipo, porque el dedup lee sus marcas al
-- empezar y no las escribe hasta el final.
--
-- La exclusión mutua NO la da esta tabla: la da la PRIMARY KEY. Dos INSERT
-- simultáneos con la misma `key` → Postgres deja pasar uno y al otro le devuelve
-- 23505. Por eso `key` es la PK y no un índice único cualquiera.
--
-- Aplicar en el SQL Editor de Supabase. Es idempotente: se puede repetir.
--
-- Seguro de ejecutar en caliente: crea una tabla nueva, no toca datos existentes.
-- Mientras no se aplique, el motor sigue funcionando exactamente igual que hasta
-- ahora (fail-open, con un aviso en los logs).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.job_locks (
  key         text primary key,
  holder      text        not null,
  acquired_at timestamptz not null default now(),
  expires_at  timestamptz not null
);

comment on table public.job_locks is
  'Cerrojos de exclusión mutua entre instancias serverless. La PK sobre `key` es lo que garantiza que solo una instancia lo tome. `holder` (UUID por ejecución) impide que una instancia suelte el cerrojo de otra tras una recuperación por caducidad.';

-- Solo el service role la toca; el motor corre con admin client. Sin políticas,
-- RLS activo deja la tabla cerrada a `anon` y `authenticated`, que es lo que
-- queremos: nadie debe poder liberar el cerrojo desde el navegador.
alter table public.job_locks enable row level security;

revoke all on public.job_locks from anon, authenticated;

-- Comprobación. Debe devolver:  4 | key | true
--
-- Mirar solo pg_tables NO basta: prueba que la tabla existe, no que `key` sea la
-- PRIMARY KEY — y lo que da la exclusión mutua es el 23505 del INSERT contra esa
-- PK, no la tabla. Con `create table if not exists`, una tabla preexistente con
-- otra forma se queda como está y el cerrojo no protegería nada.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'job_locks')          as columnas,
  (select string_agg(a.attname, ',' order by a.attname)
     from pg_constraint c
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.job_locks'::regclass and c.contype = 'p') as clave_primaria,
  (select rowsecurity from pg_tables where tablename = 'job_locks')      as rls;
