import { describe, it, expect, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// El cerrojo del buzón: que corte ANTES de gastar, no después.
//
// Las reglas de regresiones.test.ts comprueban que el cerrojo está cableado. Eso
// no demuestra lo único que importa aquí: que cuando lo tiene otra instancia, la
// función se va sin llamar a Gmail y sin llamar a Claude. Un cerrojo que toma la
// decisión correcta después de haber pagado el análisis no sirve de nada.
//
// Por eso `getEmailsWithRefreshToken` y `analyzeEmail` se mockean como espías: el
// test no mira lo que devuelven, mira que NO SE LLAMEN.
//
// El mecanismo del cerrojo en sí (23505 = lo tiene otro, 42P01 = tabla ausente,
// recuperación del caducado con UPDATE condicional) ya está cubierto por conducta
// en runAutomations.test.ts; aquí no se repite.
// ─────────────────────────────────────────────────────────────────────────────

const gmailLlamado = vi.fn()
const claudeLlamado = vi.fn()

vi.mock('@/lib/gmail', () => ({
  getEmailsWithRefreshToken: vi.fn(async (...a: unknown[]) => { gmailLlamado(...a); return [] }),
  getGmailAccountEmail: vi.fn(async () => 'colabs@brutalstudios.es'),
}))
vi.mock('@/lib/ai', () => ({
  analyzeEmail: vi.fn(async (...a: unknown[]) => { claudeLlamado(...a); return { summary: '', action: '', client: '' } }),
}))
vi.mock('@/lib/push', () => ({
  sendPushToAll: vi.fn(async () => {}),
  sendPushToUser: vi.fn(async () => {}),
  canSendPush: vi.fn(async () => false),
  PUSH_ROW: '__push_subscription__',
}))

import { syncColabsInbox, syncPersonalInbox } from '@/lib/colabsSync'

/**
 * Doble mínimo: solo sabe de `job_locks`. Si el código llegara a pedir otra
 * tabla, es que NO se ha ido por la puerta del cerrojo — y entonces el test
 * revienta ahí mismo, que es justo lo que queremos que pase.
 */
function adminConCerrojoTomado(): any {
  const cadena = (resultado: any): any => new Proxy(() => {}, {
    get: (_t, prop) => {
      if (prop === 'then') return undefined
      return () => cadena(resultado)
    },
    apply: () => cadena(resultado),
  })
  return {
    from(tabla: string) {
      if (tabla !== 'job_locks') {
        throw new Error(`no deberia haber tocado «${tabla}»: el cerrojo tenia que haber cortado antes`)
      }
      return {
        // INSERT contra la PK -> 23505: la fila ya está, lo tiene otra instancia.
        insert: async () => ({ data: null, error: { code: '23505', message: 'duplicate key value' } }),
        // El UPDATE condicional de recuperación devuelve 0 filas: sigue vigente.
        update: () => ({ eq: () => ({ lt: () => ({ select: async () => ({ data: [], error: null }) }) }) }),
        delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
        ...cadena({ data: null, error: null }),
      }
    },
  }
}

describe('cerrojo del buzón compartido', () => {
  it('con el cerrojo tomado no llama a Gmail ni a Claude', async () => {
    gmailLlamado.mockClear(); claudeLlamado.mockClear()
    const r = await syncColabsInbox(adminConCerrojoTomado(), { triggeredBy: 'u1' })

    expect(r.ok, 'saltar no es un fallo: el trabajo lo está haciendo otra instancia').toBe(true)
    expect(r.ok && r.saltado, 'no marca el resultado como saltado').toBe(true)
    expect(gmailLlamado, 'pidió los emails a Gmail con el cerrojo tomado').not.toHaveBeenCalled()
    expect(claudeLlamado, 'pagó un análisis con el cerrojo tomado — que es justo lo que el cerrojo existe para evitar')
      .not.toHaveBeenCalled()
  })

  it('lo mismo en el buzón personal', async () => {
    gmailLlamado.mockClear(); claudeLlamado.mockClear()
    const r = await syncPersonalInbox(adminConCerrojoTomado(), { id: 'u1', gmail_refresh_token: 'tok' })

    expect(r.ok).toBe(true)
    expect(r.ok && r.saltado).toBe(true)
    expect(gmailLlamado).not.toHaveBeenCalled()
    expect(claudeLlamado).not.toHaveBeenCalled()
  })

  it('un saltado no dice que haya sincronizado nada', async () => {
    // `synced: 0` sobre `total: 0` con ok:true es, desde fuera, idéntico a "no
    // había correo nuevo". Lo que los distingue es `saltado`, y por eso viaja.
    const r = await syncColabsInbox(adminConCerrojoTomado(), {})
    expect(r.ok && r.synced).toBe(0)
    expect(r.ok && r.total).toBe(0)
    expect(r.ok && r.saltado).toBe(true)
  })
})
