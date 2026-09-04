-- ─────────────────────────────────────────────────────────────────────────────
-- LA PARRILLA DE UNA CAMPAÑA
--
-- Javi: «el apartado de campañas no aporta valor real. Quiero que aporte un valor
-- distintivo, algo que lo haga diferente y único».
--
-- Ayer se separó Campañas de Proyectos (20260904_campanas.sql) y quedó siendo la
-- misma pantalla con otro nombre: la misma barra de progreso que alguien arrastra a
-- mano, que en una entrega significa algo y en una campaña no significa nada.
--
-- Esto añade lo que hace que una campaña se pueda mirar sin creerse nada: QUÉ SE
-- PROMETIÓ y QUÉ HA SALIDO. Con eso, «van 11 de 18 y en las semanas cerradas
-- faltaron 4» es un hecho verificable en vez de una impresión.
--
-- ── Ninguna tabla nueva, y el hueco NO se guarda
--
-- La parrilla se CALCULA: (semanas × salidas por semana) menos las piezas reales
-- que cuelgan de la campaña. Una tabla de huecos serían doce filas basura por
-- campaña que hay que sincronizar cada vez que alguien mueve una fecha. Mismo
-- criterio que `carpeta`: una carpeta vacía simplemente no existe.
--
-- ── UN número de cadencia, no cuatro
--
-- La versión larga de esta idea pedía días de emisión ('ma,ju'), plataformas y días
-- de producción. Eso es un formulario de cadencia, y es exactamente el trozo que se
-- pudre: cuatro decisiones que hay que mantener. Con `salidas_semana` la promesa
-- cabe en una frase, se escribe una vez y da los mismos huecos a resolución de
-- semana, que es a la que se decide de verdad.
--
-- ── Lo que NO lleva, y por qué
--
-- No se toca `projects.progress` ni `projects.deadline`. Los leen SIETE sitios más
-- que no filtran por tipo —contextoHarvey, ai-advice, ClientesSection ×3, Reportes
-- ×2, Calendario—, así que derivar el progreso aquí dejaría la campaña al 61% en
-- esta pantalla y al 0% en el informe, en la ficha del cliente y en la boca de las
-- dos IAs. El gemelo clásico. El marcador va como línea aparte.
--
-- Tampoco `facturas.project_id`: las facturas son de anteayer y todavía no hay
-- hábito, y las campañas del diario del equipo son «meta ads» e «instagram», que
-- son empuje propio sin cliente al que facturar. Se añadirá cuando haya una campaña
-- de cliente que lo pida, no antes.
--
-- ── on delete SET NULL, no cascade
--
-- Borrar una campaña no puede llevarse por delante una pieza que está publicada en
-- el mundo. Mismo criterio que la corrección CASCADE→RESTRICT de `projects`.
--
-- ── Sin esto aplicado la app NO se rompe
--
-- Las columnas ausentes llegan como `undefined` (las rutas hacen `select('*')`),
-- `compromisoDe()` devuelve null y la campaña se comporta EXACTAMENTE como hoy.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) QUÉ HA SALIDO. De qué campaña es cada pieza de contenido.
alter table public.content_agenda
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists content_agenda_campana_idx
  on public.content_agenda (project_id, publish_date);

-- 2) QUÉ SE PROMETIÓ. La ventana es `empieza_el` + `semanas`, y NO `deadline`:
--    `deadline` es texto libre y puede valer 'TBD' o 'ago 2026', y una ventana que
--    no se puede calcular no es una ventana.
alter table public.projects
  add column if not exists empieza_el     date,
  add column if not exists semanas        integer,
  add column if not exists salidas_semana integer;

-- Los límites son de cordura, no de producto: una campaña de 0 semanas o de 40
-- salidas al día es un dedazo, y el CHECK lo devuelve como 400 en vez de dejar una
-- parrilla de mil casillas.
alter table public.projects drop constraint if exists projects_compromiso_check;
alter table public.projects
  add constraint projects_compromiso_check check (
    (semanas is null or (semanas between 1 and 52)) and
    (salidas_semana is null or (salidas_semana between 1 and 21))
  );

-- Comprobación: 5 proyectos, ninguno con compromiso todavía, y la columna nueva.
-- select count(*) filter (where empieza_el is not null) as con_compromiso,
--        count(*) as total from public.projects;
