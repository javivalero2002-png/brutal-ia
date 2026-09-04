-- ─────────────────────────────────────────────────────────────────────────────
-- CAMPAÑAS, SEPARADAS DE LOS PROYECTOS
--
-- Reunión de empresa del 2026-09-03: «reorganizar interfaz: separar la sección de
-- proyectos de la de campañas y mejorar la navegación».
--
-- Iban en el mismo cajón, y no son lo mismo. Un PROYECTO es una entrega con
-- cliente y fecha de fin («Propuesta de activación — ClipBoom»); una CAMPAÑA es un
-- empuje que corre durante un tiempo y que se mide por lo que trae («campaña Meta
-- Ads», «campaña Instagram» — las dos salen del diario del equipo de agosto).
-- Mezclarlas hace que el tablero por estado no signifique lo mismo en cada fila.
--
-- ── Por qué una COLUMNA y no una tabla nueva
--
-- Comparten todo lo que ya está montado: cliente, estado, progreso, fecha, tareas
-- colgando (`tasks.project_id`), portada, PDF, carpeta y la ficha entera. Una tabla
-- aparte obligaría a duplicar esas siete cosas y a mantener dos copias del mismo
-- panel — el gemelo que este repo lleva toda la auditoría pagando. Lo que cambia
-- entre las dos es cómo se AGRUPAN y cómo se llaman, y eso es una columna.
--
-- ── Sin esto aplicado, la app NO se rompe
--
-- `tipo` ausente se lee como `undefined`, y todo el código compara contra
-- `'campana'`, así que todo sigue siendo un proyecto: exactamente lo de hoy. Lo
-- único que no se podrá es CREAR una campaña, y esa ruta devuelve un aviso que dice
-- qué migración falta en vez de un 42703 críptico.
--
-- Sin eñe en el valor guardado (`campana`) a propósito: es un identificador que
-- viaja en la URL y en comparaciones, y la eñe ahí solo trae problemas de
-- codificación. Lo que lee la gente («Campañas») vive en la interfaz.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'proyecto';

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_tipo_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_tipo_check CHECK (tipo IN ('proyecto', 'campana'));

-- El tablero y la lista filtran siempre por tipo, así que el índice va por ahí.
CREATE INDEX IF NOT EXISTS projects_tipo_idx ON public.projects (tipo, created_at DESC);

-- Comprobación: debe devolver 'proyecto' y el número de filas que ya había.
-- SELECT tipo, count(*) FROM public.projects GROUP BY tipo;
