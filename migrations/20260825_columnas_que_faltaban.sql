-- ─────────────────────────────────────────────────────────────────────────────
-- Las DOS columnas que produccion tenia y este repo no sabia crear.
--
-- Salieron comparando el esquema VIVO —el que PostgREST publica en
-- /rest/v1/ como OpenAPI, que es la verdad— contra todo el SQL del repo,
-- columna a columna y POR TABLA. De mas de 200 columnas en 23 tablas,
-- faltaban estas dos:
--
--   · projects.cover_url — y los CINCO proyectos de produccion tienen portada.
--     En una instancia nueva, subir la portada de un proyecto revienta con
--     42703 y el usuario ve «no se pudo guardar» sin mas.
--   · tasks.notes — esta en el `pick()` de las dos rutas de tareas y se usa
--     ocho veces en TareasSection.
--
-- Por que no las cazaba la regla que ya existia: solo mira los
-- `.select('literal')`, y estas dos se escriben por `pick(body, [...])`, que no
-- es un select. Y ademas la regla comprobaba que el NOMBRE existiera en algun
-- sitio del DDL, no en SU tabla: «cover_url» existe en `content_agenda` y
-- «notes» en `clients`, asi que las dos colaban. Esta escrito en la propia
-- regla como una concesion deliberada («precision antes que cobertura»).
--
-- Lo que lo cierra de verdad no es esta migracion: es la instantanea del
-- esquema vivo que la acompaña (supabase/esquema-vivo.json) y la regla que
-- compara POR TABLA contra ella.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.projects add column if not exists cover_url text;
alter table public.tasks    add column if not exists notes text;
