-- Notas de progreso en proyectos
create table if not exists project_notes (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete set null,
  user_name text,
  content text not null,
  created_at timestamptz default now()
);
alter table project_notes enable row level security;
create policy "Authenticated users can manage project_notes" on project_notes
  for all using (true) with check (true);

-- Hitos de proyectos
create table if not exists project_milestones (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade not null,
  name text not null,
  due_date date,
  done boolean default false,
  sort_order int default 0,
  created_at timestamptz default now()
);
alter table project_milestones enable row level security;
create policy "Authenticated users can manage project_milestones" on project_milestones
  for all using (true) with check (true);

-- Subtareas
create table if not exists task_subtasks (
  id uuid default gen_random_uuid() primary key,
  task_id uuid references tasks(id) on delete cascade not null,
  text text not null,
  done boolean default false,
  sort_order int default 0,
  created_at timestamptz default now()
);
alter table task_subtasks enable row level security;
create policy "Authenticated users can manage task_subtasks" on task_subtasks
  for all using (true) with check (true);
