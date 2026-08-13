import { describe, it, expect } from 'vitest'
import { esTokenMuerto, esConexionRota, codigoDeFallo, ERRORES_ACCIONABLES } from '@/lib/gmailAuth'

// ─────────────────────────────────────────────────────────────────────────────
// Cuándo una conexión de Gmail está rota.
//
// Esto no sale de leer la documentación de Google: sale de los LOGS de producción
// del 2026-08-13, donde el buzón de un compañero llevaba días fallando con
// `unauthorized_client` mientras la pantalla de Sincronización decía «CONECTADO».
// Las cuatro copias de la detección miraban solo `invalid_grant`.
//
// La distinción entre las dos funciones es lo importante y por eso se fija aquí:
// una borra el token y la otra no.
// ─────────────────────────────────────────────────────────────────────────────

const errGoogle = (codigo: string) =>
  Object.assign(new Error('Bad Request'), { response: { data: { error: codigo } } })

describe('esTokenMuerto — solo lo que es culpa de ESE token', () => {
  it('reconoce invalid_grant, venga en el cuerpo o en el mensaje', () => {
    expect(esTokenMuerto(errGoogle('invalid_grant'))).toBe(true)
    expect(esTokenMuerto(new Error('invalid_grant: Token has been expired'))).toBe(true)
    expect(esTokenMuerto(new Error('Token has been expired or revoked.'))).toBe(true)
  })

  // Esta es la que evita el desastre: si un día se rota mal la credencial de
  // Google, TODOS los refresh fallan con unauthorized_client. Si eso contara como
  // token muerto, la primera vuelta del cron borraría el token de las 7 personas y
  // arreglar la variable ya no bastaría.
  it('NO trata unauthorized_client como token muerto, para no borrarlo', () => {
    expect(esTokenMuerto(errGoogle('unauthorized_client'))).toBe(false)
    expect(esTokenMuerto(errGoogle('invalid_client'))).toBe(false)
  })

  it('ignora los errores que no son de autorización', () => {
    expect(esTokenMuerto(errGoogle('rateLimitExceeded'))).toBe(false)
    expect(esTokenMuerto(new Error('socket hang up'))).toBe(false)
    expect(esTokenMuerto(null)).toBe(false)
    expect(esTokenMuerto(undefined)).toBe(false)
  })
})

describe('esConexionRota — todo lo que exige reconectar', () => {
  it('cubre el token muerto y además lo que rechaza Google por cliente', () => {
    expect(esConexionRota(errGoogle('invalid_grant'))).toBe(true)
    expect(esConexionRota(errGoogle('unauthorized_client'))).toBe(true)
    expect(esConexionRota(errGoogle('invalid_client'))).toBe(true)
  })

  it('no se dispara con un fallo transitorio de red o de cuota', () => {
    expect(esConexionRota(errGoogle('rateLimitExceeded'))).toBe(false)
    expect(esConexionRota(new Error('ETIMEDOUT'))).toBe(false)
    expect(esConexionRota({})).toBe(false)
  })

  it('no le importan las mayúsculas con que venga el código', () => {
    expect(esConexionRota(errGoogle('UNAUTHORIZED_CLIENT'))).toBe(true)
  })
})

describe('codigoDeFallo — lo que se le devuelve al cliente', () => {
  it('distingue los dos casos, porque uno borra el token y el otro no', () => {
    expect(codigoDeFallo(errGoogle('invalid_grant'))).toBe('token_expired')
    expect(codigoDeFallo(errGoogle('unauthorized_client'))).toBe('auth_rota')
    expect(codigoDeFallo(errGoogle('rateLimitExceeded'))).toBeNull()
  })

  // El cron se pinta en rojo con estos dos: son los que necesitan que una persona
  // vaya y reconecte. Antes solo contaba token_expired, así que el fallo real de
  // producción se quedaba en un log que no lee nadie.
  it('los dos códigos son accionables para el cron', () => {
    expect(ERRORES_ACCIONABLES.has('token_expired')).toBe(true)
    expect(ERRORES_ACCIONABLES.has('auth_rota')).toBe(true)
    expect(ERRORES_ACCIONABLES.has('dedup_failed')).toBe(false)
  })
})
