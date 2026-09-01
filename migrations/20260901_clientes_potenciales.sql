-- ─────────────────────────────────────────────────────────────────────────────
-- CLIENTES POTENCIALES
--
-- Javi, tras enseñarle la app al jefe: «algo que diferencie potenciales de los
-- clientes que tenemos».
--
-- Un potencial NO es un cliente pausado ni uno archivado: es alguien con quien
-- todavía no se ha cerrado nada. Meterlo como «Activo» —que es lo que había que
-- hacer para que apareciera— lo cuela en el MRR, en el recuento de clientes del
-- informe en PDF y en el contexto que leen Harvey y Brutal.IA, que entonces
-- hablan de él como de un cliente. Un número que se enseña al jefe con dentro
-- dinero que nadie ha facturado.
--
-- Va como ESTADO y no como columna nueva a propósito: `clients.status` ya es el
-- eje por el que se filtra, se pinta y se cuenta en cinco sitios. Una columna
-- aparte obligaría a acordarse de ella en los cinco.
--
-- La app aguanta sin esto: si no se aplica, el único síntoma es que guardar el
-- estado «Potencial» devuelve un aviso que dice exactamente qué falta (el 23514
-- se traduce en src/app/api/clients — no es un error críptico).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_status_check;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_status_check
  CHECK (status IN ('Activo', 'Potencial', 'Pausado', 'Archivado'));

-- Comprobación: debe devolver la lista con los cuatro.
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'clients_status_check';
