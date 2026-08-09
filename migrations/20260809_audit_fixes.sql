-- ─────────────────────────────────────────────────────────────────────────────
-- BRUTAL.IA — Migración de correcciones del audit (9 ago 2026)
--
-- Ejecuta este archivo entero en el SQL Editor de Supabase. Es idempotente:
-- puedes lanzarlo varias veces sin romper nada.
--
-- Incluye:
--   1) tabla `rate_limits`      → límite real de Harvey y de las rutas de IA
--   2) `tasks.completed_at`     → reportes de tendencia reales
--   3) `push_rate_limits`       → saca el throttle de push de la tabla `reglas`
-- ─────────────────────────────────────────────────────────────────────────────


-- 1) RATE LIMITS ─────────────────────────────────────────────────────────────
-- El contador vivía en un Map en memoria, que se reinicia en cada cold start de
-- Vercel: el límite no se aplicaba de verdad. Ahora es compartido entre nodos.
create table if not exists public.rate_limits (
  key          text primary key,
  count        integer not null default 0,
  window_start timestamptz not null default now()
);

alter table public.rate_limits enable row level security;

-- Solo el service role (rutas API) la usa. Sin políticas = sin acceso público.
drop policy if exists "rate_limits service only" on public.rate_limits;

comment on table public.rate_limits is
  'Contadores de rate limiting compartidos entre instancias serverless. Uso exclusivo del service role.';


-- 2) TASKS.COMPLETED_AT ──────────────────────────────────────────────────────
-- Sin esta columna no se sabe CUÁNDO se completó una tarea, así que las
-- gráficas de "últimos 7 días" eran imprecisas (usaban updated_at).
alter table public.tasks
  add column if not exists completed_at timestamptz;

-- Backfill razonable para las tareas ya completadas: usamos updated_at como
-- mejor aproximación disponible del momento de completado.
update public.tasks
   set completed_at = coalesce(updated_at, created_at)
 where done = true
   and completed_at is null;

create index if not exists tasks_completed_at_idx
  on public.tasks (completed_at desc)
  where done = true;

comment on column public.tasks.completed_at is
  'Momento en que la tarea se marcó como completada. Lo mantiene la API (/api/tasks/[id]).';


-- 3) PUSH RATE LIMITS ────────────────────────────────────────────────────────
-- El throttle de 90s entre notificaciones se guardaba insertando y borrando
-- filas especiales en la tabla `reglas` (junto a las automatizaciones reales).
create table if not exists public.push_rate_limits (
  scope     text primary key,          -- 'company' o el user_id
  last_sent timestamptz not null default now()
);

alter table public.push_rate_limits enable row level security;

comment on table public.push_rate_limits is
  'Throttle de notificaciones push por ámbito. Sustituye a las filas __push_rate_limit__ de la tabla reglas.';

-- Limpieza de las filas antiguas que contaminaban `reglas`
delete from public.reglas where name = '__push_rate_limit__';
