// ¿Hay un modal abierto? Una señal global, y hace falta que lo sea.
//
// El problema que resuelve, encontrado el 2026-08-13 y trazado letra por letra:
//
// Las catorce secciones escuchan el teclado en `window` para sus atajos, y se
// protegen con `!['INPUT','TEXTAREA'].includes(e.target.tagName)`. Eso funciona
// mientras el foco esté en un campo — pero al abrir el modal de creación el foco
// se queda en BODY, porque el modal no enfoca nada y se pinta como HERMANO de la
// sección, que sigue montada y escuchando.
//
// Resultado: escribir el título de una tarea nueva ejecutaba atajos de la sección
// de detrás. Con «kickoff clientes semanal»: la 'k' seleccionaba una tarea de
// fondo, la 'c' le daba la vuelta a `done`, y la 's' llamaba a guardar. Un PATCH
// contra una tarea que el usuario ni estaba mirando.
//
// Por qué una señal de módulo y no un prop: son catorce listeners en catorce
// ficheros, y el modal lo pinta NexusDashboard como hermano de todos ellos.
// Enhebrar un prop hasta cada uno es mucha superficie para un booleano que no
// forma parte del render — esto no pinta nada, solo decide si un atajo corre.
//
// Enfocar el primer campo del modal (que también se hace) arregla el caso normal,
// porque entonces el `tagName` vuelve a ser INPUT. Esto cubre el resto: cuando el
// usuario hace clic en una zona del modal que no es un campo, el foco vuelve a
// BODY y las guardas por tagName dejan de valer otra vez.

let abiertos = 0

/** Lo llama un modal al montarse. Cuenta, por si algún día hay dos anidados. */
export function marcarModalAbierto(): void { abiertos++ }

/** Lo llama al desmontarse. Nunca baja de cero, por si hay un doble unmount. */
export function marcarModalCerrado(): void { abiertos = Math.max(0, abiertos - 1) }

/** Primera línea de todo listener de teclado de sección. */
export function hayModalAbierto(): boolean { return abiertos > 0 }
