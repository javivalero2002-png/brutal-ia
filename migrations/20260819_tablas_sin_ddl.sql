-- Las dos tablas que el código usaba y no existían en ningún fichero del repo.
--
-- Qué resuelve: `client_comments` y `notification_log` se crearon a mano en el
-- editor de Supabase y nunca llegaron aquí. El código las usa —los comentarios de
-- la ficha de cliente y el historial de avisos— así que una instancia levantada
-- desde este repositorio arrancaba, compilaba y se rompía al usarla, que es la
-- peor forma de fallar: en ejecución y solo en la mitad de las pantallas.
--
-- Es el riesgo de fondo del proyecto: la base no se podía reconstruir. Ahora hay
-- una regla en `regresiones.test.ts` que compara las tablas que toca el código con
-- las que este repositorio sabe crear, y se pone roja si vuelve a abrirse el hueco.
--
-- IDEMPOTENTE a propósito: en la instancia viva las tablas YA existen, así que
-- esto no debe tocarlas. `if not exists` en todo, y los `add column` también.

-- ─── COMENTARIOS DE CLIENTE ──────────────────────────────────────────────────
-- Hilo de notas del equipo sobre un cliente. Compartido, como todo aquí.
create table if not exists public.client_comments (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,

  -- Quién lo escribió. RESTRICT y no CASCADE: dar de baja a alguien no puede
  -- borrar el histórico de lo que dijo sobre un cliente — el comentario sigue
  -- siendo verdad aunque la persona ya no esté.
  profile_id  uuid not null references public.profiles(id) on delete restrict,

  -- La ruta acota a 2.000 caracteres antes de escribir; el CHECK es la red por si
  -- alguien escribe por otro camino.
  body        text not null check (char_length(body) <= 2000),

  created_at  timestamptz not null default now()
);

-- La consulta que hace la ficha: los de este cliente, del más nuevo al más viejo.
create index if not exists client_comments_client_idx
  on public.client_comments(client_id, created_at desc);

alter table public.client_comments enable row level security;

drop policy if exists client_comments_lectura on public.client_comments;
create policy client_comments_lectura on public.client_comments
  for select to authenticated using (true);

-- Escritura solo de lo propio. Las de verdad van por service role desde la API,
-- que es donde se comprueba la sesión; esto es defensa en profundidad.
drop policy if exists client_comments_escritura_propia on public.client_comments;
create policy client_comments_escritura_propia on public.client_comments
  for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());


-- ─── HISTORIAL DE AVISOS ─────────────────────────────────────────────────────
-- Lo que se ha mandado por push. Es lo que pinta la campana.
--
-- `sendPushToUser` inserta aquí dentro de un try/catch que se traga el fallo a
-- propósito («tabla ausente o error transitorio: no bloquear el envío»), y
-- /api/notifications/history responde lista vacía si la tabla no está. Esa
-- tolerancia es correcta —el aviso importa más que su registro— pero es también
-- la razón de que faltara tanto tiempo sin que nadie lo notara.
create table if not exists public.notification_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,

  title       text not null,
  body        text,
  url         text,
  -- Agrupa avisos del mismo origen para que el sistema operativo los colapse
  -- en vez de apilar diez notificaciones de la misma tarea.
  tag         text,

  read        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- La consulta de la campana: los míos, los más recientes primero.
create index if not exists notification_log_user_idx
  on public.notification_log(user_id, created_at desc);

alter table public.notification_log enable row level security;

-- Aquí NO vale el `using (true)` del resto: un aviso es de una persona, no del
-- equipo. Que el diario sea compartido a propósito no hace compartida la campana.
drop policy if exists notification_log_propio on public.notification_log;
create policy notification_log_propio on public.notification_log
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ─── RETENCIÓN ───────────────────────────────────────────────────────────────
-- El historial de avisos crece con cada push y nadie lo consulta más allá de unos
-- días: la campana pide 40. Sin poda, en un año son decenas de miles de filas
-- inútiles ocupando el medio giga del plan gratuito.
--
-- Se ejecuta desde el cron de copia de seguridad, que ya corre a diario.
create or replace function public.podar_notificaciones(dias int default 60)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  borradas int;
begin
  delete from public.notification_log
   where created_at < now() - (dias || ' days')::interval;
  get diagnostics borradas = row_count;
  return borradas;
end;
$$;

-- Nadie desde el navegador: es un borrado en lote y no tiene por qué estar al
-- alcance de una clave de cliente.
revoke all on function public.podar_notificaciones(int) from public, anon, authenticated;

-- Y EXPLÍCITAMENTE al service role, que es quien la llama desde el cron.
--
-- Sin esta línea el permiso dependía de los privilegios por defecto de Supabase
-- —que sí conceden a `service_role`, pero eso es una suposición sobre cómo está
-- montado el proyecto, no algo escrito aquí—. En una instancia nueva montada de
-- otra forma, la poda fallaría una vez al día en silencio: el cron la registra y
-- sigue con la copia, así que nadie lo vería hasta mirar los registros.
-- Escribirlo cuesta una línea y quita la duda entera.
grant execute on function public.podar_notificaciones(int) to service_role;
