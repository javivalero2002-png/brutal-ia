-- Cómo fue el día, en una palabra.
--
-- El cierre del día ya pide texto libre («¿cómo fue tu día?»), y el texto libre es
-- lo que mejor cuenta un día concreto y lo que peor se agrega: no se puede sumar,
-- ni ordenar, ni ver si la semana ha ido peor que la anterior sin leerlo todo.
-- Tres botones sí, y no le quitan sitio al texto — van al lado.
--
-- `check` con las tres en español, que es como se pintan y como se guardan. Ojo con
-- lo que ya avisa CLAUDE.md: si algún día un modelo escribe en esta columna, tiene
-- que pasar antes por un normalizador, porque un valor fuera de la lista hace que
-- el INSERT rebote entero y el cierre del día se pierda sin decir nada.
--
-- Sin `default`: «no lo he dicho» es una respuesta y no es «normal».

alter table public.diario
  add column if not exists animo text
  check (animo is null or animo in ('productivo', 'normal', 'bloqueado'));
