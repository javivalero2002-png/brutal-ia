-- Varias cuentas de Gmail por persona.
--
-- QUÉ RESUELVE. Hoy `profiles` tiene DOS pares de columnas: uno para «mi Gmail» y
-- otro para «el buzón compartido». Eso obliga a que la segunda cuenta de cualquiera
-- sea el buzón de colaboraciones, y Javi quiere lo contrario para los jefes: que
-- Julio y Pablo tengan su Gmail personal y su dirección de empresa, ninguna de las
-- dos compartida con los siete. Con dos columnas fijas eso no cabe — conectar una
-- segunda propia pisaría la primera, en silencio.
--
-- EL RIESGO. Por aquí entra el correo de todo el equipo. Por eso:
--   · la tabla se RELLENA desde las columnas viejas en la misma migración, para que
--     nadie pierda su conexión al desplegar;
--   · y las columnas viejas NO SE BORRAN. Volver atrás es revertir el código, sin
--     tocar la base ni pedirle a nadie que reconecte. Cuando esto lleve semanas
--     funcionando se podrán quitar, y ese es un commit aparte y sin prisa.
--
-- `compartida` es lo que decide si el correo de esa cuenta se guarda con
-- `shared = true`, o sea si lo ve todo el equipo. Es una propiedad de la CUENTA y no
-- de la persona, que es justo lo que faltaba.

create table if not exists public.gmail_cuentas (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  email         text not null,
  refresh_token text not null,
  compartida    boolean not null default false,
  creada_at     timestamptz not null default now(),
  -- La misma dirección dos veces en la misma persona es siempre un error de
  -- reconexión, no dos cuentas: el upsert del callback se apoya en esto.
  unique (profile_id, email)
);

create index if not exists gmail_cuentas_profile_idx on public.gmail_cuentas (profile_id);
-- El sync del buzón compartido busca por aquí, y hay como mucho una.
create index if not exists gmail_cuentas_compartida_idx on public.gmail_cuentas (compartida) where compartida;

alter table public.gmail_cuentas enable row level security;
-- Los tokens NO salen al cliente por ninguna vía: todo pasa por el service role,
-- igual que hoy con las columnas de `profiles`. Sin políticas, `authenticated` no
-- puede leer nada — que es exactamente lo que se quiere.

-- ── Relleno desde lo que ya hay ─────────────────────────────────────────────
insert into public.gmail_cuentas (profile_id, email, refresh_token, compartida)
select p.id,
       coalesce(nullif(p.gmail_account, ''), p.email),
       p.gmail_refresh_token,
       false
from public.profiles p
where p.gmail_refresh_token is not null
on conflict (profile_id, email) do nothing;

insert into public.gmail_cuentas (profile_id, email, refresh_token, compartida)
select p.id,
       coalesce(nullif(p.gmail_colabs_account, ''), 'colaboraciones@brutalstudios.es'),
       p.gmail_colabs_refresh_token,
       true
from public.profiles p
where p.gmail_colabs_refresh_token is not null
on conflict (profile_id, email) do nothing;
