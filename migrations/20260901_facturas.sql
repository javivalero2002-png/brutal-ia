-- ─────────────────────────────────────────────────────────────────────────────
-- FACTURAS, ASOCIADAS A SU CLIENTE
--
-- Javi, tras la ronda con el jefe: «facturas asociadas clientes».
--
-- Lo que había era `clients.revenue`: un TEXTO libre —«12k/mes», «€1.500»— que se
-- interpreta con `parseImporte` para pintar el MRR. Sirve para decir cuánto vale
-- un cliente al mes; no sirve para lo que se pregunta de verdad un día 5: qué se
-- ha emitido, qué falta por cobrar y qué está vencido. Eso no se puede deducir de
-- una cadena de texto, y hoy vive en la cabeza de alguien o en una hoja aparte.
--
-- ── Por qué en CÉNTIMOS y no en decimal
--
-- Un importe en coma flotante se equivoca al sumar, y aquí se suman columnas que
-- alguien va a comparar con su banco. `integer` de céntimos no tiene ese problema
-- y no hay ningún importe en esta app que se acerque al límite de int4 (21
-- millones de euros). Se formatea al pintar, en un solo sitio.
--
-- ── Por qué el estado NO es una columna
--
-- «Cobrada / pendiente / vencida» se DERIVA de `cobrada_el` y `vence_el`: una
-- columna de estado sería una segunda verdad que hay que mantener en sincronía
-- con las fechas, y en cuanto se olvide una actualización la pantalla dirá
-- «pendiente» de algo cobrado. Esta app ya ha pagado eso (`archived_at` y
-- `status` se contradecían hasta que uno pasó a derivarse del otro).
--
-- Las fechas son DÍAS (`date`), no instantes, por la misma razón que los
-- deadlines: una factura vence un día entero, y comparar timestamps hacía que una
-- tarea que vencía hoy saliera vencida desde las 02:00 de Madrid. Ver CLAUDE.md.
--
-- ── El borrado
--
-- `on delete restrict`: borrar un cliente con facturas dentro tiene que fallar y
-- decirlo, no llevárselas por delante en silencio. Es el mismo criterio que ya se
-- aplicó al resto de tablas que cuelgan de `clients`.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.facturas (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete restrict,
  -- El número que lleva escrito la factura. Texto: los estudios numeran con
  -- prefijos y años («2026-014»), y un entero no sabe de eso.
  numero            text,
  concepto          text,
  importe_centimos  integer not null check (importe_centimos >= 0),
  -- El IVA aparte, para poder enseñar base y total sin volver a calcularlo mal en
  -- cada pantalla. 21 por defecto, que es el general en España.
  iva_pct           integer not null default 21 check (iva_pct >= 0 and iva_pct <= 100),
  emitida_el        date not null,
  -- Nulo = «sin fecha de vencimiento acordada». No se inventa una: una fecha
  -- inventada convierte en «vencida» algo que nadie ha incumplido.
  vence_el          date,
  -- Nulo = todavía no cobrada. Es la única marca de que se cobró.
  cobrada_el        date,
  notas             text,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- La consulta de siempre: las facturas de un cliente, la más reciente primero.
create index if not exists facturas_cliente_idx
  on public.facturas (client_id, emitida_el desc);

-- Y la que importa de verdad: lo que falta por cobrar. Parcial, porque las
-- cobradas son la mayoría con el tiempo y no se preguntan casi nunca.
create index if not exists facturas_pendientes_idx
  on public.facturas (vence_el) where cobrada_el is null;

alter table public.facturas enable row level security;

-- Lo lee el equipo con sesión; lo escribe solo el service role, o sea la API, que
-- es donde está la comprobación de que quien escribe es propietario. Mismo modelo
-- que el resto: la API es la barrera y RLS es defensa en profundidad.
drop policy if exists "team_lee_facturas" on public.facturas;
create policy "team_lee_facturas" on public.facturas
  for select using (auth.uid() is not null);

-- Comprobación: debe devolver la tabla vacía y sin error.
-- select count(*) from public.facturas;
