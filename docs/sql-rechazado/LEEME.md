# SQL de un plan RECHAZADO — no ejecutar

Estos dos ficheros salieron del plan de **reconciliación de esquema** que un
verificador adversarial tumbó con **17 roturas concretas** (ver `CLAUDE.md`).
No están corregidos y no deben ejecutarse contra la base de datos.

Estaban en `migrations/`, al lado de una migración legítima y con el mismo
prefijo de fecha — una trampa evidente. Se movieron aquí y se renombró el
peligroso con sufijo `.RECHAZADO` para que no pueda confundirse.

Se conservan porque el análisis que hay dentro sigue siendo útil como punto de
partida cuando ese bloque se retome, con análisis nuevo y con Javi delante.

- `reconcile_prod.sql.RECHAZADO` — DDL de reconciliación. **NO EJECUTAR.**
- `inspect_prod_schema.sql` — solo consultas de lectura; inofensivo, útil para
  volcar el esquema real de producción y compararlo con el repo.

Cómo llegaron a git: se colaron en el commit `5861947` mediante un `git add -A`
que no llevaba la exclusión que sí tenían todos los demás commits de esa tanda.
El mensaje de ese commit habla solo de quitar `CONCURRENTLY` y arrastró 397
líneas que no menciona.
