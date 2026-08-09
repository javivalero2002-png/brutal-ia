-- ─────────────────────────────────────────────────────────────────────────────
-- BRUTAL.IA — Archivos adjuntos en tareas
-- Ejecuta en Supabase SQL Editor. Es idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.task_attachments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  name        text not null,
  url         text not null,
  size        integer,
  mime_type   text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

alter table public.task_attachments enable row level security;

create index if not exists task_attachments_task_id_idx on public.task_attachments(task_id);

comment on table public.task_attachments is
  'Archivos adjuntos a tareas. Subidos a Supabase Storage (bucket: pdfs, prefix: task-attachments/).';
