-- Las dos columnas que este repo NO sabía crear.
--
-- En `brutalia.tech` llevan vivas meses: se añadieron a mano por el panel de
-- Supabase y nunca se escribió su DDL. O sea que la base de producción y lo que
-- este repositorio sabe construir NO son lo mismo, y la diferencia solo se nota el
-- día que alguien levanta una instancia nueva: arranca, compila, y se rompe al
-- usarla con un 42703 que parece «esta función no existe».
--
-- `co_assigned_to` es la peor de las dos porque además lleva un EMBED:
-- `co_assignee:profiles!co_assigned_to` en GET /api/tasks. Sin la clave ajena
-- PostgREST no sabe hacer ese join y la ruta devuelve 500 — no una lista sin el
-- campo, sino nada. Por eso aquí va la columna Y la clave, no solo la columna.
--
-- Idempotente a propósito: en producción no hace nada, y en una instancia nueva lo
-- crea. Es lo que permite correrla sin pensar.

alter table public.tasks
  add column if not exists co_assigned_to uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_co_assigned_to_fkey' and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_co_assigned_to_fkey
      foreign key (co_assigned_to) references public.profiles(id) on delete set null;
  end if;
end $$;

-- Quién más lleva la tarea: se consulta con `.or('assigned_to.eq…,co_assigned_to.eq…')`
-- en /api/diario/pendientes, así que sin índice son dos seq scans por carga.
create index if not exists tasks_co_assigned_to_idx
  on public.tasks (co_assigned_to)
  where co_assigned_to is not null;

alter table public.projects
  add column if not exists pdf_url text;
