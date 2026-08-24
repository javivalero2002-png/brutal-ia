-- ─────────────────────────────────────────────────────────────────────────────
-- DE QUÉ CUENTA VIENE CADA CORREO
--
-- Javi: «no sé si están entrando los Gmail de ambos correos». Y no había forma de
-- saberlo: `inbox_messages` guarda `user_id` y `shared`, pero no la dirección del
-- buzón por el que entró el mensaje. Con dos cuentas personales conectadas —lo que
-- permite `gmail_cuentas` desde el 2026-08-20— las dos escriben `shared = false` y
-- son indistinguibles.
--
-- Se guarda la DIRECCIÓN en texto y no una clave a `gmail_cuentas` a propósito: al
-- desconectar una cuenta su fila se borra, y una clave foránea obligaría a elegir
-- entre borrar sus correos (inaceptable) o impedir la desconexión. La dirección
-- sigue siendo cierta aunque la cuenta ya no esté.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.inbox_messages
  add column if not exists cuenta text;

comment on column public.inbox_messages.cuenta is
  'Dirección del buzón por el que entró el mensaje. NULL en los anteriores a esta migración que no se pudieron atribuir sin adivinar.';

create index if not exists inbox_messages_cuenta_idx
  on public.inbox_messages (user_id, cuenta);

-- ── RELLENO DE LO VIEJO ──────────────────────────────────────────────────────
-- Solo lo que se puede saber SIN ADIVINAR. Una etiqueta equivocada es peor que un
-- hueco: el hueco se ve y se entiende, la etiqueta falsa se cree.

-- 1. El buzón compartido es uno solo, así que todo `shared` viene de él.
update public.inbox_messages m
   set cuenta = c.email
  from public.gmail_cuentas c
 where m.shared is true
   and m.cuenta is null
   and c.compartida is true;

-- 2. Lo personal, SOLO si esa persona tiene exactamente UNA cuenta no compartida
--    hoy. Con dos o más no hay manera de saber cuál fue y se queda en NULL.
update public.inbox_messages m
   set cuenta = u.email
  from (
    select profile_id, min(email) as email
      from public.gmail_cuentas
     where compartida is false
     group by profile_id
    having count(*) = 1
  ) u
 where m.user_id = u.profile_id
   and m.shared is false
   and m.source = 'gmail'
   and m.cuenta is null;
