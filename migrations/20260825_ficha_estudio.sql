-- ─────────────────────────────────────────────────────────────────────────────
-- LA FICHA DEL ESTUDIO — el resumen permanente de la memoria.
--
-- Javi: «quiero asegurarme de que Memoria es la base de datos y el cerebro de
-- Brutal.IA... que la IA lo usa como contexto para contestar. Si no existe ese
-- contexto, igual hay que crear un contexto resumido con toda la información que
-- tiene, y cada vez que se le añade algo se modifica ese contexto».
--
-- POR QUÉ HACE FALTA, y no basta con lo que ya hay: `memoriaRelevante` elige las
-- notas que casan CON LA PREGUNTA. Funciona bien cuando la pregunta menciona algo
-- que está escrito, y no aporta nada cuando no. O sea que la IA no tiene una base
-- estable: sabe mucho de lo que le preguntas con las palabras exactas, y nada del
-- estudio en general.
--
-- La ficha es esa base. Va SIEMPRE en el prompt, la escribe el modelo a partir de
-- toda la memoria, y se rehace cuando la memoria cambia lo suficiente.
--
-- Una sola fila. `id` fijo para que el upsert no pueda crear dos.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.memoria_ficha (
  id            int primary key default 1 check (id = 1),
  texto         text not null default '',
  -- Cuántas notas había cuando se escribió. Es lo que permite saber si la ficha
  -- se ha quedado vieja sin tener que releer la memoria entera.
  notas         int not null default 0,
  -- La nota más reciente que entró en ella. Con solo el recuento, editar una nota
  -- sin añadir ninguna dejaría la ficha desactualizada para siempre.
  ultima_nota   timestamptz,
  actualizada_at timestamptz not null default now()
);

alter table public.memoria_ficha enable row level security;

-- Lectura para todo el equipo; la escritura va solo por service role, como el
-- resto de lo que genera el servidor.
drop policy if exists "team_lee_ficha" on public.memoria_ficha;
create policy "team_lee_ficha" on public.memoria_ficha
  for select using (auth.uid() is not null);

insert into public.memoria_ficha (id) values (1) on conflict (id) do nothing;
