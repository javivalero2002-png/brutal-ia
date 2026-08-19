-- Carpetas para ordenar lo ya publicado.
--
-- Qué resuelve: la columna «Publicado» crece sin parar y no tiene ninguna
-- estructura. A los tres meses son cien piezas en una lista, y encontrar «el reel
-- de la campaña de verano» es bajar hasta verlo. Lo publicado es justo lo que se
-- consulta después: para reutilizar, para enseñárselo a un cliente, o para saber
-- qué se hizo la última vez con esa marca.
--
-- Una COLUMNA DE TEXTO y no una tabla de carpetas, a propósito:
--
--   · Crear una carpeta pasa a ser escribir su nombre, sin una pantalla de
--     gestión de carpetas que nadie quiere mantener.
--   · Renombrarla es un `update` sobre las piezas que la usan.
--   · Y una carpeta vacía no existe — que a esta escala es lo correcto: una
--     carpeta sin nada dentro solo es sitio donde no mirar.
--
-- Si algún día hacen falta carpetas anidadas, con permisos o con orden propio,
-- entonces sí toca una tabla. Hoy sería construir un mueble para dos camisas.

alter table public.content_agenda
  add column if not exists carpeta text;

-- La consulta de la columna «Publicado»: agrupar por carpeta, lo más reciente
-- primero. Parcial porque solo lo publicado se agrupa — el resto del tablero se
-- ordena por estado y no toca esto.
create index if not exists content_agenda_carpeta_idx
  on public.content_agenda (carpeta, publish_date desc)
  where carpeta is not null;
