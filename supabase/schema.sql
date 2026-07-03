-- ─────────────────────────────────────────────────────────────
-- NEXUS OS · Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ─────────────────────────────────────────────────────────────

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─── PROFILES ────────────────────────────────────────────────
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text unique not null,
  name text not null default '',
  role text not null default 'member' check (role in ('owner', 'member')),
  avatar_color text not null default '#1B5FFA',
  initials text not null default '',
  gmail_refresh_token text,
  gmail_connected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _name text;
  _initials text;
  _color text;
  _colors text[] := array['#1B5FFA','#9B5FFA','#E51D2A','#FA8B1B','#1BFA9B'];
begin
  _name := coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1));
  _initials := upper(left(split_part(_name,' ',1),1) || left(split_part(_name,' ',2),1));
  if _initials = '' then _initials := upper(left(_name,2)); end if;
  _color := _colors[1 + (abs(hashtext(new.email)) % array_length(_colors,1))];
  insert into public.profiles (id, email, name, initials, avatar_color)
  values (new.id, new.email, _name, _initials, _color);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─── CLIENTS ─────────────────────────────────────────────────
create table public.clients (
  id uuid primary key default uuid_generate_v4(),
  created_by uuid references public.profiles(id) on delete set null,
  name text not null,
  industry text not null default '—',
  status text not null default 'Activo' check (status in ('Activo','Pausado','Archivado')),
  revenue text not null default '—',
  notes text,
  color text not null default '#1B5FFA',
  initials text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── PROJECTS ────────────────────────────────────────────────
create table public.projects (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references public.clients(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  name text not null,
  status text not null default 'activo' check (status in ('plan.','activo','urgente','revisión','completado')),
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  deadline text not null default 'TBD',
  color text not null default '#1B5FFA',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── TASKS ───────────────────────────────────────────────────
create table public.tasks (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references public.projects(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  text text not null,
  level text not null default 'high' check (level in ('urgent','high','normal')),
  done boolean not null default false,
  due_date text,
  source text default 'manual' check (source in ('manual','gmail','whatsapp','ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── INBOX MESSAGES ──────────────────────────────────────────
create table public.inbox_messages (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  source text not null check (source in ('gmail','whatsapp','internal')),
  gmail_id text unique,
  from_name text not null default '',
  from_email text,
  from_phone text,
  subject text,
  body_preview text,
  ai_summary text,
  ai_action text,
  ai_client text,
  ai_urgency text default 'normal' check (ai_urgency in ('urgent','high','normal')),
  is_read boolean not null default false,
  is_unread boolean not null default true,
  raw_data jsonb,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ─── MEMORIA ─────────────────────────────────────────────────
create table public.memoria (
  id uuid primary key default uuid_generate_v4(),
  created_by uuid references public.profiles(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  category text not null default 'General',
  title text not null,
  content text not null default '',
  source text default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── CONTENT AGENDA ──────────────────────────────────────────
create table public.content_agenda (
  id uuid primary key default uuid_generate_v4(),
  created_by uuid references public.profiles(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  title text not null,
  platform text not null default 'Instagram',
  content_type text not null default 'Post',
  status text not null default 'borrador' check (status in ('borrador','pendiente','listo','publicado')),
  publish_date text,
  publish_time text default '12:00',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── REGLAS / AUTOMATIZACIONES ───────────────────────────────
create table public.reglas (
  id uuid primary key default uuid_generate_v4(),
  created_by uuid references public.profiles(id) on delete set null,
  name text not null,
  description text,
  condition_text text,
  action_text text,
  active boolean not null default true,
  trigger_count integer not null default 0,
  last_triggered_at timestamptz,
  created_at timestamptz not null default now()
);

-- ─── CHAT MESSAGES ───────────────────────────────────────────
create table public.chat_messages (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  role text not null check (role in ('user','ai')),
  content text not null,
  created_at timestamptz not null default now()
);

-- ─── WHATSAPP SESSIONS ───────────────────────────────────────
create table public.whatsapp_sessions (
  id uuid primary key default uuid_generate_v4(),
  phone text unique not null,
  user_id uuid references public.profiles(id) on delete set null,
  context jsonb default '{}',
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);

-- ─── RLS POLICIES ────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.inbox_messages enable row level security;
alter table public.memoria enable row level security;
alter table public.content_agenda enable row level security;
alter table public.reglas enable row level security;
alter table public.chat_messages enable row level security;
alter table public.whatsapp_sessions enable row level security;

-- Profiles: users see their own
create policy "users_own_profile" on public.profiles for all using (auth.uid() = id);
create policy "owners_see_all_profiles" on public.profiles for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
);

-- All team members see clients, projects, tasks, agenda, memoria, reglas
create policy "team_see_clients" on public.clients for select using (auth.uid() is not null);
create policy "owners_mutate_clients" on public.clients for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
);

create policy "team_see_projects" on public.projects for select using (auth.uid() is not null);
create policy "owners_mutate_projects" on public.projects for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
);

create policy "team_see_tasks" on public.tasks for select using (auth.uid() is not null);
create policy "owners_create_tasks" on public.tasks for insert with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
);
create policy "members_update_own_tasks" on public.tasks for update using (
  assigned_to = auth.uid() or
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
);
create policy "owners_delete_tasks" on public.tasks for delete using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
);

create policy "users_own_inbox" on public.inbox_messages for all using (user_id = auth.uid());
create policy "team_see_memoria" on public.memoria for select using (auth.uid() is not null);
create policy "team_mutate_memoria" on public.memoria for all using (auth.uid() is not null);
create policy "team_see_agenda" on public.content_agenda for select using (auth.uid() is not null);
create policy "team_mutate_agenda" on public.content_agenda for all using (auth.uid() is not null);
create policy "team_see_reglas" on public.reglas for select using (auth.uid() is not null);
create policy "owners_mutate_reglas" on public.reglas for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
);
create policy "users_own_chat" on public.chat_messages for all using (user_id = auth.uid());
create policy "users_own_wa_session" on public.whatsapp_sessions for all using (user_id = auth.uid());

-- ─── SEED: Owners ────────────────────────────────────────────
-- After signup, run this to make Pablo & Julio owners:
-- UPDATE public.profiles SET role = 'owner' WHERE email IN ('pablo@brutalstudios.es','julio@brutalstudios.es');

-- ─── INDEXES ─────────────────────────────────────────────────
create index idx_tasks_assigned on public.tasks(assigned_to);
create index idx_tasks_project on public.tasks(project_id);
create index idx_inbox_user on public.inbox_messages(user_id, is_read, received_at desc);
create index idx_inbox_gmail_id on public.inbox_messages(gmail_id);
create index idx_projects_client on public.projects(client_id);
create index idx_chat_user on public.chat_messages(user_id, created_at);
