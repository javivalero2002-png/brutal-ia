// Supabase devuelve sus errores de autenticación en inglés y crudos. Enseñarlos
// tal cual dejaba las dos pantallas de acceso —lo primero que ve cualquiera—
// hablando en otro idioma: comprobado apagando la red, el login mostraba
// literalmente "Failed to fetch".
//
// El problema no es solo el idioma. Ninguno de esos textos dice QUÉ HACER, y en
// una app de 7 personas la salida casi siempre es la misma: reintentar, esperar,
// o avisar a Javi. Cada mensaje de aquí termina en una de esas tres.
//
// Los casos que no están cubiertos caen en el genérico, y el original va a la
// consola: al usuario no le sirve de nada y a quien depura, sí.

/** Errores al intentar entrar (login). */
export function mensajeDeAcceso(bruto: string): string {
  const m = (bruto || '').toLowerCase()
  if (m.includes('invalid login credentials')) return 'Email o contraseña incorrectos'
  if (esFalloDeRed(m)) return 'Sin conexión. Comprueba la red y vuelve a intentarlo.'
  if (m.includes('email not confirmed')) return 'Esa cuenta todavía no está activada. Pídele a Javi que la active desde Operativa → Equipo.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.'
  if (m.includes('user not found')) return 'No hay ninguna cuenta con ese email.'
  return 'No se pudo entrar. Vuelve a intentarlo y, si sigue, avisa a Javi.'
}

/** Errores al elegir contraseña nueva desde el enlace de recuperación. */
export function mensajeDeContrasena(bruto: string): string {
  const m = (bruto || '').toLowerCase()
  if (esFalloDeRed(m)) return 'Sin conexión. Comprueba la red y vuelve a intentarlo.'
  // El más frecuente con diferencia: el enlace del email caduca, y el mensaje
  // original ("Auth session missing") no da ninguna pista de que basta con pedir
  // otro enlace.
  if (m.includes('session missing') || m.includes('expired') || m.includes('invalid') || m.includes('token')) {
    return 'El enlace ha caducado. Pide uno nuevo desde "¿Olvidaste tu contraseña?".'
  }
  if (m.includes('should be different')) return 'Esa es la contraseña que ya tenías. Elige otra distinta.'
  if (m.includes('at least') || m.includes('password should be')) return 'La contraseña es demasiado corta: mínimo 8 caracteres.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.'
  return 'No se pudo cambiar la contraseña. Vuelve a intentarlo y, si sigue, avisa a Javi.'
}

// Un fallo de red llega con formas distintas segun el navegador, y ninguna se
// parece a las demas: Chrome da "Failed to fetch", Firefox "NetworkError when
// attempting to fetch resource", Safari "Load failed". Buscar solo la de Chrome
// dejaba a los otros dos con el mensaje generico.
function esFalloDeRed(m: string): boolean {
  return m.includes('failed to fetch')
    || m.includes('networkerror')
    || m.includes('network request failed')
    || m.includes('load failed')
    || m.includes('fetch failed')
}
