-- Enlaza una tarea con la línea de diario que la creó.
--
-- Hoy el Diario y Tareas se emparejan por el TEXTO NORMALIZADO. Acotar ese
-- emparejamiento a «mis tareas de este día» (ya hecho, PR #29) arregla el cruce
-- entre personas y el de los objetivos recurrentes, pero deja vivo un caso que
-- el texto no puede resolver: si alguien retoca el texto de la tarea desde la
-- sección Tareas —`text` está en sus campos editables—, el vínculo se rompe. La
-- burbuja del Diario aparece sin tachar aunque la tarea esté hecha, y al tocarla
-- se crea una SEGUNDA tarea con el texto viejo, ya marcada como completada.
-- Dos tareas para un trabajo y dos completadas en Reportes.
--
-- Con estas dos columnas el vínculo deja de depender de que nadie toque el texto.
--
-- NO ROMPE NADA: nacen a null, ninguna consulta actual las lee, y las tareas ya
-- creadas siguen emparejándose por texto como respaldo.
--
-- EJECUTAR ESTO ANTES DE DESPLEGAR EL CÓDIGO QUE LAS ESCRIBE. Al revés, el
-- INSERT rebota con 42703 y la tarea NO se crea — que es exactamente lo que ya
-- pasó con `content_agenda.feedback` y tuvo la revisión con cliente muerta
-- semanas. Ejecutar solo el SQL es inofensivo: se quedan vacías.

alter table public.tasks add column if not exists diario_dia      text;
alter table public.tasks add column if not exists diario_objetivo text;

-- La consulta que hace el Diario: «mis tareas de este día».
create index if not exists tasks_diario_idx
  on public.tasks (assigned_to, diario_dia)
  where diario_dia is not null;
