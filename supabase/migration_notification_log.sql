-- Historial de notificaciones push: registra cada aviso generado para cada
-- usuario, para mostrar un feed en Operativa → Notificaciones aunque el push
-- no llegara (dispositivo sin suscripción, app cerrada, etc.).
-- Ejecutar en el SQL editor de Supabase (idempotente).
create table if not exists public.notification_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  body text,
  url text,
  tag text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notification_log_user_idx on public.notification_log(user_id, created_at desc);

alter table public.notification_log enable row level security;
do $$ begin
  create policy "users_own_notif_log" on public.notification_log for all using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
