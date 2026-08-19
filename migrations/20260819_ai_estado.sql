-- Qué le ha pasado al análisis de cada correo.
--
-- Qué resuelve: hasta ahora un correo que la IA no había mirado era EXACTAMENTE
-- igual en la base que uno analizado que salió aburrido. Con eso no se puede
-- responder la única pregunta que importa después de poner una criba: «¿cuánto he
-- dejado de mirar, y era importante?».
--
-- Y sin poder responderla, la criba no es una decisión: es una amputación a
-- ciegas. Esta columna es lo que la convierte en algo auditable y reversible —
-- junto con el botón «analizar con IA» que la usa para saber a quién ofrecérselo.
--
--   ok         analizado de verdad
--   omitido    no se le pagó análisis (promoción o red social, sin nada que lo salvara)
--   pendiente  se acabó el tiempo de la pasada; se guardó y espera turno
--   fallo      se intentó y el modelo no respondió
--
-- `pendiente` es el que arregla un fallo vivo: hoy, cuando el presupuesto de
-- tiempo se agota, el bucle hace `break` ANTES del insert y esos correos se
-- pierden — no se guardan ni se vuelven a pedir, porque la ventana de Gmail no
-- pagina. Con este estado, quedarse sin tiempo pasa de perder correo a aplazarlo.

alter table public.inbox_messages
  add column if not exists ai_estado text not null default 'ok'
    check (ai_estado in ('ok', 'omitido', 'pendiente', 'fallo'));

-- Por qué se omitió, para poder auditar la criba sin adivinar.
alter table public.inbox_messages
  add column if not exists ai_motivo text;

-- Índice PARCIAL: la inmensa mayoría son 'ok' y nadie los busca por este campo.
-- Solo interesa listar lo que NO se miró, que es un puñado.
create index if not exists inbox_messages_ai_estado_idx
  on public.inbox_messages (ai_estado, received_at desc)
  where ai_estado <> 'ok';
