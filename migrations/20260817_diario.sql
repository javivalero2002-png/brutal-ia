-- Diario de equipo: una fila por persona y día.
--
-- Qué resuelve: hoy no hay forma de saber en qué anda cada uno sin preguntar, y
-- crear una tarea por cada cosa que haces es más trabajo que hacerla. La idea es
-- al revés — escribes en prosa lo que vas a hacer al entrar y lo que has hecho al
-- salir, y de ahí salen las tareas.
--
-- Es COMPARTIDO a propósito: lo lee todo el equipo. Ese es el punto, no un efecto
-- secundario. Mismo modelo que el resto de la app (workspace único, sin
-- multi-tenancy); la API es la barrera y RLS es defensa en profundidad.

create table if not exists public.diario (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,

  -- El DÍA como texto 'YYYY-MM-DD', no una fecha con hora ni un timestamp.
  --
  -- Igual que los deadlines de tasks: un día es un día. Guardar un timestamp
  -- obliga a decidir una zona horaria al leer, y esta app ya se ha quemado con eso
  -- (ver CLAUDE.md: a partir de las ~22:00 de Madrid, UTC ya es mañana). El día lo
  -- calcula el servidor con todayKey(), que va anclado a Europe/Madrid.
  dia         text not null,

  entrada     text,          -- lo que voy a hacer hoy
  cierre      text,          -- lo que he hecho de verdad
  entrada_at  timestamptz,   -- cuándo fichó al entrar
  cierre_at   timestamptz,   -- cuándo cerró el día

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Una sola entrada por persona y día: el flujo es "abrir el día y editarlo",
  -- no "ir añadiendo notas sueltas". Además hace el upsert trivial y evita que
  -- dos pestañas creen dos filas del mismo día.
  unique (user_id, dia)
);

-- La consulta que hace la sección: el día de hoy, de todo el equipo.
create index if not exists diario_dia_idx on public.diario(dia desc);
-- Y la de "mi historial".
create index if not exists diario_user_dia_idx on public.diario(user_id, dia desc);

alter table public.diario enable row level security;

-- Defensa en profundidad. Las escrituras reales van por service role desde la API,
-- que es donde se comprueba la sesión; esto solo evita que una clave anon suelta
-- pueda tocar nada.
drop policy if exists diario_lectura on public.diario;
create policy diario_lectura on public.diario
  for select to authenticated using (true);

drop policy if exists diario_escritura_propia on public.diario;
create policy diario_escritura_propia on public.diario
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
