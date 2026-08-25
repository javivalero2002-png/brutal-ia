-- ─────────────────────────────────────────────────────────────────────────────
-- EL REGISTRO DE ERRORES
--
-- Javi: «estaría bien que se anotasen en algún lado para notificártelos... que yo
-- te dijese "hay algún error detectado" y sacases los errores detectados».
--
-- Nace del hallazgo de fondo de la auditoría: lo que falla en esta app no da
-- error a nadie. Un buzón de Gmail cuyo token revoca Google deja de traer correo,
-- el cron responde 200, el latido se pinta verde, y la única traza es un
-- `console.error` que vive lo que dure la retención de logs de Vercel. Si nadie
-- mira ese día, el fallo no existió.
--
-- AGRUPADO POR `clave`, y esto es lo que lo hace legible en vez de un vertedero:
-- el mismo fallo cada hora son 24 filas al día y a la semana nadie lo lee. Con la
-- clave única, son UNA fila con `veces = 168` y su primera y última vez. Lo que
-- importa de un fallo repetido no es cada repetición: es desde cuándo pasa y
-- cuántas veces.
--
-- Y `resuelto_at` se BORRA al repetirse: un error que vuelve después de darlo por
-- arreglado es la señal más valiosa que hay aquí, y con una marca pegajosa se
-- perdería.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.errores (
  id          uuid primary key default gen_random_uuid(),
  -- Lo que agrupa. Se compone en el código: 'gmail:auth_rota:javi@…'
  clave       text not null unique,
  -- Dónde pasó, en palabras de quien lo va a leer: «sync personal», «calendario».
  donde       text not null,
  -- Qué pasó. Una frase.
  que         text not null,
  gravedad    text not null default 'media' check (gravedad in ('alta','media','baja')),
  -- Lo que haga falta para reproducirlo, sin secretos: nunca un token.
  contexto    jsonb,
  veces       int not null default 1,
  primera_at  timestamptz not null default now(),
  ultima_at   timestamptz not null default now(),
  resuelto_at timestamptz
);

create index if not exists errores_abiertos_idx
  on public.errores (ultima_at desc) where resuelto_at is null;

alter table public.errores enable row level security;

-- Lo lee el equipo (la pantalla es de propietario, pero la barrera real es la
-- ruta). Lo escribe solo el service role, como todo lo que genera el servidor.
drop policy if exists "team_lee_errores" on public.errores;
create policy "team_lee_errores" on public.errores
  for select using (auth.uid() is not null);
