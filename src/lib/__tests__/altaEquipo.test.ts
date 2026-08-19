import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// El alta y la baja de un miembro, EJECUTADAS de verdad.
//
// El resto de la suite comprueba invariantes leyendo el código. Esto es otra
// cosa: llama a los manejadores reales con una base simulada y recorre los
// caminos que de verdad vive una persona al entrar en el equipo. Existe porque
// ese flujo se rompió de tres formas distintas el mismo día y ninguna la habría
// cazado una regla de texto — eran fallos de COMPORTAMIENTO:
//
//   · el email no se normalizaba, así que no se encontraba una cuenta que sí
//     existía y el alta reventaba con «duplicate key ... profiles_pkey»;
//   · la búsqueda usaba `.single()` y se tragaba el error, así que un fallo de
//     consulta era indistinguible de «no existe»;
//   · y la contraseña que se creaba no la veía nadie, así que el único acceso era
//     un enlace que caduca en una hora.
// ─────────────────────────────────────────────────────────────────────────────

// El estado de la base simulada, que cada prueba amasa a su gusto.
type Fila = Record<string, unknown>
let PERFILES: Fila[] = []
let AUTH: { id: string; email: string }[] = []
let ROL = 'owner'
let FALLO_BUSQUEDA: string | null = null
let ULTIMO_ENLACE_PARA: string | null = null
/**
 * Que `createUser` DEVUELVA la cuenta existente en vez de dar error.
 *
 * Es el comportamiento que produce el fallo que vio Javi: la cuenta ya está en
 * autenticación, `createUser` no protesta y nos devuelve su id, y el insert del
 * perfil choca contra la fila que ya había → «duplicate key value violates unique
 * constraint "profiles_pkey"» en la cara del usuario.
 */
let CREAR_DEVUELVE_EXISTENTE = false
let ULTIMO_UPDATE: { tabla: string; campos: Fila } | null = null
/**
 * Que el UPDATE falle. Es el caso que separa «no revienta» de «no miente»: si el
 * borrado de la marca falla y nadie mira el error, la ruta devuelve un enlace tan
 * contento y esa persona entra directa al panel, sin puesta en marcha. Cara de
 * haber ido bien y el resultado exactamente contrario al que se pidio.
 */
let FALLO_UPDATE: string | null = null

const admin = {
  from(tabla: string) {
    const q: Record<string, unknown> = {}
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (col: string, val: unknown) => { q[col] = val; return api },
      in: () => api,
      order: () => api,
      limit: () => api,
      maybeSingle: async () => {
        if (FALLO_BUSQUEDA) return { data: null, error: { message: FALLO_BUSQUEDA } }
        const fila = (tabla === 'profiles' ? PERFILES : []).find(f =>
          Object.entries(q).every(([k, v]) => f[k] === v))
        return { data: fila ?? null, error: null }
      },
      single: async () => {
        const fila = (tabla === 'profiles' ? PERFILES : []).find(f =>
          Object.entries(q).every(([k, v]) => f[k] === v))
        // Como PostgREST: sin filas, ERROR. Es lo que hacía que el camino normal
        // pasara por una rama de error.
        return fila ? { data: fila, error: null } : { data: null, error: { message: 'no rows', code: 'PGRST116' } }
      },
      insert: async (fila: Fila) => {
        if (tabla === 'profiles' && PERFILES.some(p => p.id === fila.id)) {
          return { error: { message: 'duplicate key value violates unique constraint "profiles_pkey"' } }
        }
        if (tabla === 'profiles') PERFILES.push(fila)
        return { error: null }
      },
      // Encadenables Y esperables, como el cliente de verdad: la ruta hace
      // `.update(x).eq('email', y)`, así que devolver una promesa aquí rompía la
      // cadena. Detalle tonto, pero es la clase de cosa que solo se descubre
      // EJECUTANDO — leyendo el código no aparece.
      update: (campos: Fila) => {
        // Registra QUÉ se actualiza: sin esto no se puede comprobar que la puesta
        // en marcha se borra de verdad, solo que la ruta no revienta.
        ULTIMO_UPDATE = { tabla, campos }
        return api
      },
      delete: () => api,
      then: (res: (v: { error: { message: string } | null }) => unknown) =>
        res({ error: FALLO_UPDATE ? { message: FALLO_UPDATE } : null }),
    }
    return api
  },
  auth: {
    admin: {
      createUser: async ({ email }: { email: string }) => {
        const ya = AUTH.find(u => u.email === email.toLowerCase())
        if (ya && CREAR_DEVUELVE_EXISTENTE) return { data: { user: ya }, error: null }
        // Supabase normaliza los correos por dentro: por eso `Laura@` encuentra
        // la cuenta de `laura@`. Ese detalle es el origen del fallo original.
        if (ya) return { data: null, error: { message: 'A user with this email address has already been registered' } }
        const u = { id: `auth-${AUTH.length + 1}`, email: email.toLowerCase() }
        AUTH.push(u)
        return { data: { user: u }, error: null }
      },
      deleteUser: async (id: string) => { AUTH = AUTH.filter(u => u.id !== id); return { error: null } },
      generateLink: async ({ email }: { email: string }) => {
        ULTIMO_ENLACE_PARA = email
        return {
          data: { properties: {
            action_link: `https://xxx.supabase.co/auth/v1/verify?token=abc&type=recovery`,
            hashed_token: `tok-${email}`,
          } },
          error: null,
        }
      },
    },
  },
}

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: async () => admin,
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'yo' } } }) } }),
}))
vi.mock('@/lib/authz', () => ({
  getAuthCtx: async () => ({ userId: 'yo', role: ROL, admin, user: { id: 'yo' } }),
}))
vi.mock('@/lib/appUrl', () => ({ APP_URL: 'https://brutalia.tech', rutaApp: (r: string) => `https://brutalia.tech${r}` }))

const pedir = async (cuerpo: Record<string, unknown>) => {
  const { POST } = await import('@/app/api/admin/team/route')
  const res = await POST(new Request('http://x/api/admin/team', {
    method: 'POST', body: JSON.stringify(cuerpo),
  }) as never)
  return { status: res.status, json: await res.json() }
}

beforeEach(() => {
  // El perfil de quien pide. `requireOwner()` es local a la ruta y lee el rol de
  // `profiles` con el id de la sesión, así que hay que ponerlo aquí — mockear
  // `getAuthCtx` no sirve, y descubrirlo es parte de por qué esta prueba EJECUTA
  // la ruta en vez de leerla.
  PERFILES = [{ id: 'yo', email: 'javi@brutalstudios.es', role: 'owner' }]
  AUTH = []
  ROL = 'owner'
  FALLO_BUSQUEDA = null
  ULTIMO_ENLACE_PARA = null
  CREAR_DEVUELVE_EXISTENTE = false
  ULTIMO_UPDATE = null
  FALLO_UPDATE = null
})

describe('alta de un miembro · lo que vive quien entra en el equipo', () => {
  it('una cuenta nueva se crea y devuelve contraseña Y enlace', () => {
    return pedir({ email: 'laura@brutalstudios.es', name: 'Laura' }).then(({ status, json }) => {
      expect(status).toBe(200)
      expect(json.ok).toBe(true)
      // Las DOS vías. El enlace caduca en una hora y se quema al primer uso; la
      // contraseña no caduca. Sin ella, un enlace muerto dejaba a esa persona
      // fuera para siempre, porque nadie conocía su contraseña.
      expect(json.inviteLink, 'no devuelve enlace').toBeTruthy()
      expect(json.clave, 'no devuelve contraseña temporal: si el enlace muere, no hay forma de entrar').toBeTruthy()
      // Legible: se dicta por teléfono y se copia a mano sin errores. Tres palabras
      // y no dos desde que se midió la entropía de la anterior: 10 × 10 × 9000 son
      // menos de 20 bits, y el argumento de «da igual, se cambia en el primer
      // minuto» resultó falso — ese paso se puede saltar.
      expect(json.clave).toMatch(/^[a-z]+-[a-z]+-[a-z]+-\d{4}$/)
      expect(PERFILES).toHaveLength(2)
      expect(PERFILES[1].onboarding_at, 'nace con la puesta en marcha pendiente').toBeUndefined()
    })
  })

  it('dar de alta a alguien que YA existe devuelve su acceso, no un error', async () => {
    await pedir({ email: 'laura@brutalstudios.es', name: 'Laura' })
    const { status, json } = await pedir({ email: 'laura@brutalstudios.es', name: 'Laura' })
    // Este es EL fallo que veía Javi: salía «duplicate key value violates unique
    // constraint profiles_pkey» en la cara, que no le dice nada a nadie.
    expect(status, 'repetir el alta devuelve un error de Postgres').toBe(200)
    expect(json.inviteLink).toBeTruthy()
    expect(PERFILES, 'ha creado un perfil duplicado').toHaveLength(2)
  })

  it('el email con mayúsculas o espacios es la MISMA cuenta', async () => {
    await pedir({ email: 'laura@brutalstudios.es', name: 'Laura' })
    const { status, json } = await pedir({ email: '  Laura@BrutalStudios.es  ', name: 'Laura' })
    // Supabase normaliza por dentro, así que para él es la misma cuenta. Si
    // nosotros no normalizamos, no la encontramos, pedimos crearla, nos devuelve
    // la que había, y el insert del perfil revienta. Exactamente lo que pasó.
    expect(status).toBe(200)
    expect(PERFILES, 'ha creado una cuenta duplicada por una mayúscula').toHaveLength(2)
    expect(json.inviteLink).toBeTruthy()
  })

  it('si no se puede comprobar si existe, NO se crea a ciegas', async () => {
    FALLO_BUSQUEDA = 'connection reset'
    const { status } = await pedir({ email: 'nueva@brutalstudios.es', name: 'Nueva' })
    // Crear encima de una cuenta viva es lo que reventaba. Ante la duda, se para.
    expect(status, 'crea sin saber si la cuenta ya existía').toBe(503)
    expect(PERFILES).toHaveLength(1)
  })

  it('la cuenta de autenticación existente sin perfil también se recupera', async () => {
    // El estado incoherente que deja una baja a medias: la cuenta está en auth
    // pero su ficha no. Antes, el alta moría aquí.
    AUTH.push({ id: 'auth-viejo', email: 'fer@brutalstudios.es' })
    const { status, json } = await pedir({ email: 'fer@brutalstudios.es', name: 'Fer' })
    expect(status).toBe(200)
    expect(json.inviteLink).toBeTruthy()
  })

  it('si la cuenta existe en auth pero su perfil no se encuentra, no revienta', async () => {
    // El caso EXACTO que vio Javi. La cuenta está en autenticación con un perfil
    // asociado, pero la búsqueda por email no lo encuentra —porque se guardó
    // distinto, o porque el alta anterior murió a medias—. `createUser` devuelve
    // la que había, y el insert choca contra su propia fila.
    AUTH.push({ id: 'auth-laura', email: 'laura@brutalstudios.es' })
    PERFILES.push({ id: 'auth-laura', email: 'OTRO-CORREO-RARO', role: 'member' })
    CREAR_DEVUELVE_EXISTENTE = true

    const { status, json } = await pedir({ email: 'laura@brutalstudios.es', name: 'Laura' })
    expect(status, 'devuelve el error crudo de Postgres en vez del acceso de esa persona').toBe(200)
    expect(json.inviteLink, 'no le da su enlace').toBeTruthy()
  })

  it('solo el propietario puede dar de alta', async () => {
    PERFILES = [{ id: 'yo', email: 'javi@brutalstudios.es', role: 'member' }]
    const { status } = await pedir({ email: 'x@brutalstudios.es', name: 'X' })
    expect(status).toBe(403)
    expect(PERFILES).toHaveLength(1)
  })

  it('el enlace apunta a NUESTRA pantalla, no a la verificación de Supabase', async () => {
    // La raíz del «este enlace ya se ha usado» que veía Javi al abrirlo él mismo:
    // el `action_link` de Supabase pasa por su página de verificación, y esa
    // CONSUME el token antes de que la nuestra se ejecute. Después redirige con un
    // `?code=` que solo se canjea con un verificador PKCE que nuestro navegador no
    // tiene, porque el enlace lo generó el servidor. Moría siempre, al primer clic.
    const { json } = await pedir({ email: 'laura@brutalstudios.es', name: 'Laura' })
    expect(json.inviteLink).toContain('/reset-password?token_hash=')
    expect(json.inviteLink, 'vuelve a mandar por la verificación de Supabase: el enlace se gastará al abrirlo')
      .not.toContain('/auth/v1/verify')
  })

  it('el enlace se pide para el correo NORMALIZADO', async () => {
    await pedir({ email: '  Pablo@BrutalStudios.ES ', name: 'Pablo' })
    expect(ULTIMO_ENLACE_PARA, 'pide el enlace para un correo sin normalizar: Supabase no lo encontraría')
      .toBe('pablo@brutalstudios.es')
  })
})

describe('empezar de cero sin borrar la cuenta', () => {
  const reiniciar = async (email: string) => {
    const { PATCH } = await import('@/app/api/admin/team/route')
    const res = await PATCH(new Request('http://x/api/admin/team', {
      method: 'PATCH', body: JSON.stringify({ email, action: 'reiniciar_acceso' }),
    }) as never)
    return { status: res.status, json: await res.json() }
  }

  it('borra la marca de puesta en marcha Y devuelve enlace', async () => {
    PERFILES.push({ id: 'p-laura', email: 'laura@brutalstudios.es', role: 'member', onboarding_at: '2026-08-01' })
    const { status, json } = await reiniciar('laura@brutalstudios.es')
    expect(status).toBe(200)
    // Las DOS cosas. Con el enlace pero sin borrar la marca, esa persona entra
    // directa al panel y no ve la puesta en marcha — que es justo lo que se pedia,
    // pero con cara de haber ido bien.
    expect(ULTIMO_UPDATE?.tabla, 'no toca profiles').toBe('profiles')
    expect(ULTIMO_UPDATE?.campos, 'no borra la marca de puesta en marcha').toEqual({ onboarding_at: null })
    expect(json.inviteLink, 'no devuelve enlace').toBeTruthy()
    expect(json.reiniciado).toBe(true)
  })

  it('el enlace apunta a NUESTRA pantalla, igual que el del alta', async () => {
    // Mismo camino (`generarEnlace`), asi que hereda el arreglo de PKCE. Si alguien
    // lo reescribe a mano aqui, este enlace se gastaria al abrirlo.
    PERFILES.push({ id: 'p-fer', email: 'fer@brutalstudios.es', role: 'member' })
    const { json } = await reiniciar('fer@brutalstudios.es')
    expect(json.inviteLink).toContain('/reset-password?token_hash=')
    expect(json.inviteLink).not.toContain('/auth/v1/verify')
  })

  it('el correo se normaliza, como en todo lo demas', async () => {
    PERFILES.push({ id: 'p-pablo', email: 'pablo@brutalstudios.es', role: 'member' })
    await reiniciar('  Pablo@BrutalStudios.ES ')
    expect(ULTIMO_ENLACE_PARA, 'pide el enlace sin normalizar: Supabase no encontraria la cuenta')
      .toBe('pablo@brutalstudios.es')
  })

  it('si no se puede borrar la marca, NO se da el enlace', async () => {
    PERFILES.push({ id: 'p-ana', email: 'ana@brutalstudios.es', role: 'member', onboarding_at: '2026-08-01' })
    FALLO_UPDATE = 'connection reset'
    const { status, json } = await reiniciar('ana@brutalstudios.es')
    // Dar el enlace igualmente seria lo peor de los dos mundos: le mandas el enlace
    // a alguien convencido de que vera la puesta en marcha, y no la ve.
    expect(status, 'devuelve 200 con la marca sin borrar').toBe(500)
    expect(json.inviteLink, 'da el enlace aunque el reinicio haya fallado').toBeFalsy()
  })

  it('solo el propietario puede reiniciar el acceso de alguien', async () => {
    PERFILES = [{ id: 'yo', email: 'javi@brutalstudios.es', role: 'member' }]
    const { status } = await reiniciar('laura@brutalstudios.es')
    expect(status).toBe(403)
    expect(ULTIMO_UPDATE, 'ha tocado profiles sin ser propietario').toBeNull()
  })
})
