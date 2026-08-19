-- Carpetas en Proyectos, para lo que ya está terminado.
--
-- Qué resuelve: la columna «Completado» es la que crece para siempre y nadie
-- borra. Cada proyecto ocupa una tarjeta con su portada grande, así que a los tres
-- meses es un muro por el que hay que bajar — y es justo la columna que MÁS se
-- consulta después: para reutilizar una propuesta, para enseñarle a un cliente lo
-- que se hizo, o para saber cuánto se cobró la última vez.
--
-- Igual que `content_agenda.carpeta`, y por los mismos motivos: una COLUMNA DE
-- TEXTO y no una tabla de carpetas. Crear una carpeta es escribir su nombre,
-- renombrarla es un `update`, y una carpeta vacía no existe — que a esta escala es
-- lo correcto. Si algún día hacen falta anidadas o con permisos, entonces sí toca
-- una tabla; hoy sería un mueble para dos camisas.

alter table public.projects
  add column if not exists carpeta text;

-- Agrupar por carpeta dentro de un estado, lo más reciente primero.
create index if not exists projects_carpeta_idx
  on public.projects (carpeta, created_at desc)
  where carpeta is not null;
