-- Persistir el análisis IA de PDFs de proyectos entre sesiones.
-- El resumen/puntos/acciones/datos que genera Claude se guardan como JSON en texto.
-- Ejecutar en el SQL editor de Supabase (idempotente).
alter table public.projects add column if not exists pdf_analysis text;
