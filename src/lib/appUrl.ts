// La URL pública de la app, en UN solo sitio.
//
// Estaba escrita a mano —`https://brutalstudios-ia.vercel.app`— en cuatro sitios,
// y tres de ellos son TEXTO QUE LEE EL USUARIO: las instrucciones de invitación al
// equipo («el miembro puede acceder en …») y la URL del webhook de WhatsApp que se
// copia y se pega en Meta. El día que la app tenga dominio propio, esos textos
// pasan a mentir sin que nada falle ni salte ningún error: alguien manda una
// invitación con la dirección vieja y el compañero no puede entrar.
//
// `NEXT_PUBLIC_APP_URL` es obligatoria en producción (scripts/check-env.mjs la
// exige), así que el fallback es solo para que un entorno mal configurado no
// reviente el render — no para que se use de verdad.
const CRUDA = process.env.NEXT_PUBLIC_APP_URL || 'https://brutalstudios-ia.vercel.app'

/** Sin barra final, para poder concatenar rutas sin duplicarla. */
export const APP_URL = CRUDA.replace(/\/+$/, '')

/**
 * Solo el dominio, para enseñárselo a una persona. Se calcula con try/catch
 * porque un `NEXT_PUBLIC_APP_URL` mal escrito haría que `new URL()` lanzara en
 * tiempo de MÓDULO, y eso tumba la sección entera en vez de enseñar una URL fea.
 */
export const APP_HOST = (() => {
  try { return new URL(APP_URL).host } catch { return APP_URL.replace(/^https?:\/\//, '') }
})()

/** Une la app con una ruta: rutaApp('/api/whatsapp') → 'https://…/api/whatsapp' */
export const rutaApp = (ruta: string) => `${APP_URL}/${ruta.replace(/^\/+/, '')}`
