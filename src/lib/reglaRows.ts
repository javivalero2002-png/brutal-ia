// La tabla `reglas` no guarda solo reglas: se usa además como almacén de
// clave/valor para un par de cosas que no tenían tabla propia. Esas filas NO son
// automatizaciones y no deben aparecer ni en la lista de la UI ni en el motor.
//
// Existe este módulo porque el filtro se olvidó una vez: `__push_subscription__`
// se excluía en los dos sitios y `__account_logo__`, añadido después, en ninguno.
// El resultado era visible en producción — el panel de Automatizaciones contaba
// el logo como "1 de 1 activas" y mostraba un JPEG en base64 como condición.
//
// Sin dependencias a propósito: lo importan tanto rutas API como el motor, y
// `automations.ts` arrastra web-push (que rompe el bundle del navegador).
export const PUSH_ROW = '__push_subscription__'
export const LOGO_ROW = '__account_logo__'

/** Nombres de filas de la tabla `reglas` que no son automatizaciones. */
export const NON_RULE_ROWS = [PUSH_ROW, LOGO_ROW] as const

/** Filtro PostgREST para excluirlas: `.not('name', 'in', NON_RULE_ROWS_FILTER)`. */
export const NON_RULE_ROWS_FILTER = `(${NON_RULE_ROWS.map(n => `"${n}"`).join(',')})`
