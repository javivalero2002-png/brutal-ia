import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parsearAccionHarvey, etiquetaAccion, TIPOS_ACCION } from '@/lib/harveyAccion'
import { ejecutarAccionHarvey } from '@/lib/harveyEjecutar'

// ─────────────────────────────────────────────────────────────────────────────
// El comando [ACCION:...] de Harvey.
//
// Esta lógica estaba escrita DOS veces, línea por línea, dentro de HoySection y
// HarveySection — dos ficheros de mil líneas donde no se podía testear nada. La
// auditoría de agosto encontró tres bugs en esa pareja y cada uno hubo que
// arreglarlo dos veces.
//
// Lo que se comprueba aquí es lo que el modelo puede hacer mal, porque el que
// escribe esta cadena es Claude, no un formulario.
// ─────────────────────────────────────────────────────────────────────────────

describe('parsearAccionHarvey', () => {
  it('separa la frase hablada del comando', () => {
    const { texto, accion } = parsearAccionHarvey('Te la creo. [ACCION:tarea|Llamar a Nocilla|high|Pablo]')
    expect(texto).toBe('Te la creo.')
    expect(accion).toEqual({ type: 'tarea', text: 'Llamar a Nocilla', level: 'high', assigneeName: 'Pablo', projectName: '' })
  })

  it('sin comando devuelve la frase entera y ninguna acción', () => {
    const { texto, accion } = parsearAccionHarvey('  Hoy tienes tres reuniones.  ')
    expect(texto).toBe('Hoy tienes tres reuniones.')
    expect(accion).toBeNull()
  })

  // El TTS lee lo que quede en el texto. Una etiqueta sin limpiar se pronuncia:
  // «corchete ACCION dos puntos tarea». Por eso el texto se limpia SIEMPRE,
  // incluso cuando la acción no se entiende.
  it('limpia la etiqueta aunque el tipo sea desconocido', () => {
    const { texto, accion } = parsearAccionHarvey('Hecho. [ACCION:recordatorio|algo|x]')
    expect(texto).toBe('Hecho.')
    expect(texto).not.toContain('ACCION')
    expect(accion).toBeNull()
  })

  it('limpia varias etiquetas si el modelo se repite', () => {
    const { texto } = parsearAccionHarvey('Va. [ACCION:tarea|A|high|] y [ACCION:tarea|B|high|]')
    expect(texto).not.toContain('[ACCION')
  })

  // El prompt pide los niveles en inglés dentro de una conversación en español,
  // así que el modelo escribe «urgente» tarde o temprano. `tasks.level` tiene
  // CHECK: un valor de fuera hace que el INSERT rebote. Y la tarjeta «HARVEY
  // PROPONE» pinta su color comparando con 'urgent', así que además salía gris.
  it('normaliza el nivel que escribe el modelo en español', () => {
    expect(parsearAccionHarvey('[ACCION:tarea|X|urgente|]').accion?.level).toBe('urgent')
    expect(parsearAccionHarvey('[ACCION:tarea|X|alta|]').accion?.level).toBe('high')
    expect(parsearAccionHarvey('[ACCION:tarea|X|baja|]').accion?.level).toBe('normal')
  })

  it('sin nivel, o con uno irreconocible, cae en «high»', () => {
    expect(parsearAccionHarvey('[ACCION:tarea|X||]').accion?.level).toBe('high')
    expect(parsearAccionHarvey('[ACCION:tarea|X|P1|]').accion?.level).toBe('high')
    expect(parsearAccionHarvey('[ACCION:tarea|X]').accion?.level).toBe('high')
  })

  it('recorta los espacios que el modelo deja alrededor de las barras', () => {
    const { accion } = parsearAccionHarvey('[ACCION:tarea| Revisar contrato | urgente | Marta ]')
    expect(accion).toEqual({ type: 'tarea', text: 'Revisar contrato', level: 'urgent', assigneeName: 'Marta', projectName: '' })
  })

  it('lee los cinco tipos con sus campos', () => {
    expect(parsearAccionHarvey('[ACCION:evento|Reunión|2026-08-20|10:00|todos]').accion)
      .toEqual({ type: 'evento', text: 'Reunión', date: '2026-08-20', time: '10:00', invitees: 'todos' })
    expect(parsearAccionHarvey('[ACCION:proyecto|Web nueva|Nocilla|2026-09-01]').accion)
      .toEqual({ type: 'proyecto', text: 'Web nueva', clientName: 'Nocilla', date: '2026-09-01' })
    expect(parsearAccionHarvey('[ACCION:cliente|KOTO|Moda]').accion)
      .toEqual({ type: 'cliente', text: 'KOTO', industry: 'Moda' })
    expect(parsearAccionHarvey('[ACCION:pieza|Reel del festival|TikTok|Reel]').accion)
      .toEqual({ type: 'pieza', text: 'Reel del festival', platform: 'TikTok', contentType: 'Reel' })
  })

  it('rellena los valores por defecto que el resto de la app da por hechos', () => {
    expect(parsearAccionHarvey('[ACCION:cliente|KOTO]').accion?.industry).toBe('—')
    const pieza = parsearAccionHarvey('[ACCION:pieza|Algo]').accion
    expect(pieza?.platform).toBe('Instagram')
    expect(pieza?.contentType).toBe('Post')
  })

  it('aguanta lo que el modelo puede mandar roto sin lanzar', () => {
    for (const raro of ['[ACCION:]', '[ACCION:|||]', '[ACCION:tarea|]', 'texto [ACCION: tarea |X|high|]']) {
      expect(() => parsearAccionHarvey(raro)).not.toThrow()
      expect(parsearAccionHarvey(raro).texto).not.toContain('[ACCION')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Sin persona = PARA QUIEN HABLA.
//
// El prompt lo prometía desde siempre —«persona = …, o vacío si es para quien
// habla»— y el ejecutor no lo cumplía: dejaba `null` y la tarea nacía huérfana.
// Le pedías a Harvey «créame una tarea», él decía que la creaba, y no aparecía en
// las de nadie. El contrato estaba roto por el lado del código.
//
// Y de fondo había algo peor: Harvey no sabía CON QUIÉN hablaba. Nada en su
// prompt decía quién era el usuario, así que «para mí» no tenía referente.
// ─────────────────────────────────────────────────────────────────────────────
describe('Harvey · a quién se asigna una tarea', () => {
  const leerCodigo = (f: string) =>
    readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('una acción sin persona cae en quien habla, no en nadie', () => {
    const EJ = leerCodigo('src/lib/harveyEjecutar.ts')
    const i = EJ.indexOf('const miembro =')
    expect(i, 'ya no se resuelve el miembro así: revisa esta regla').toBeGreaterThan(-1)
    const rama = EJ.slice(i, i + 320)
    expect(/perfil\?\.(id|name)/.test(rama),
      'sin persona vuelve a quedarse en null: la tarea nace sin asignar y no aparece en las de nadie').toBe(true)
  })

  it('Harvey sabe con quién está hablando', () => {
    const R = leerCodigo('src/app/api/harvey/chat/route.ts')
    expect(/CON QUIEN ESTAS HABLANDO/.test(R),
      'el prompt no dice quién es el usuario: «para mí» no tiene referente').toBe(true)
    // Del servidor, no del body: el nombre de quien habla no es entrada del cliente.
    //
    // Esta regla exigía literalmente una consulta `from('profiles')…eq('id', user.id)`.
    // Eso es la IMPLEMENTACIÓN, no el invariante: al fusionar esa consulta con la de
    // la plantilla —una sola ida a la base en vez de dos, por latencia— se puso roja
    // sin que nada fuera mal. Ahora comprueba lo que de verdad importa: que la
    // identidad salga de `user.id` (la sesión) y NUNCA del cuerpo de la petición.
    const i = R.indexOf('quienHabla')
    expect(i, 'ya no se resuelve quién habla: revisa esta regla en vez de borrarla').toBeGreaterThan(-1)
    const ventana = R.slice(Math.max(0, i - 300), i + 300)
    expect(/user\.id/.test(ventana),
      'quién habla no se resuelve contra la sesión: podría venir del cliente').toBe(true)
    expect(/(context|body|message)\s*[.?]\s*(userName|nombre|name)/.test(R),
      'el nombre de quien habla se coge del cuerpo de la petición: es suplantable').toBe(false)
  })
})

describe('completar una tarea por voz', () => {
  // La contraria de 'tarea', y faltaba: Harvey te leía en voz alta lo que tenías
  // pendiente y no podía tachar nada.
  //
  // Lo que se prueba aquí no es que llame a `toggleTask` —eso es una línea—, sino
  // A CUÁL. Marcar hecha la tarea equivocada es el error que nadie ve: desaparece
  // de la lista, y se descubre cuando ya cuenta como trabajo terminado de alguien.
  const tareas = [
    { id: '1', text: 'Guion del spot', done: false },
    { id: '2', text: 'Guion del spot — versión corta', done: false },
    { id: '3', text: 'Montaje del teaser', done: false },
    { id: '4', text: 'Guion del spot', done: true },
  ]

  function deps(over: Partial<{ tasks: unknown[] }> = {}) {
    const tocadas: string[] = []
    const dichos: string[] = []
    return {
      tocadas, dichos,
      deps: {
        data: { tasks: over.tasks ?? tareas, toggleTask: async (id: string) => { tocadas.push(id) } } as never,
        perfil: { id: 'u1', name: 'Javi' },
        showToast: (m: string) => { dichos.push(m) },
      },
    }
  }

  it('una coincidencia exacta gana a la que solo la contiene', async () => {
    // «Guion del spot» está dentro de «Guion del spot — versión corta». Sin capas,
    // el `includes` elegía la primera que apareciera.
    const { tocadas, deps: d } = deps()
    const ok = await ejecutarAccionHarvey({ type: 'completar', text: 'Guion del spot' }, d)
    expect(ok).toBe(true)
    expect(tocadas).toEqual(['1'])
  })

  it('con varias candidatas NO elige: pregunta cuál', async () => {
    const { tocadas, dichos, deps: d } = deps()
    const ok = await ejecutarAccionHarvey({ type: 'completar', text: 'guion' }, d)
    expect(ok, 'devolver true descartaría la tarjeta sin haber hecho nada').toBe(false)
    expect(tocadas, 'ha marcado una tarea sin saber cuál').toEqual([])
    expect(dichos.join(' ')).toMatch(/cuál|cual/i)
  })

  it('ignora las que ya están hechas', async () => {
    // La cuarta es idéntica a la primera pero `done`. Si entrara, «Guion del spot»
    // sería ambigua para siempre y no se podría cerrar nunca por voz.
    const { tocadas, deps: d } = deps()
    await ejecutarAccionHarvey({ type: 'completar', text: 'Guion del spot' }, d)
    expect(tocadas).toEqual(['1'])
  })

  it('los acentos y los signos no cuentan', async () => {
    // Se dicta en voz alta y se transcribe: «guión» y «guion» son la misma tarea.
    const { tocadas, deps: d } = deps({ tasks: [{ id: '9', text: '¡Guión del spot!', done: false }] })
    const ok = await ejecutarAccionHarvey({ type: 'completar', text: 'guion del spot' }, d)
    expect(ok).toBe(true)
    expect(tocadas).toEqual(['9'])
  })

  it('si no existe, lo dice y no toca nada', async () => {
    const { tocadas, dichos, deps: d } = deps()
    const ok = await ejecutarAccionHarvey({ type: 'completar', text: 'llamar al banco' }, d)
    expect(ok).toBe(false)
    expect(tocadas).toEqual([])
    expect(dichos.join(' ')).toMatch(/no encuentro/i)
  })

  it('sin texto no adivina', async () => {
    const { tocadas, deps: d } = deps()
    expect(await ejecutarAccionHarvey({ type: 'completar', text: '' }, d)).toBe(false)
    expect(tocadas).toEqual([])
  })
})

describe('la tarjeta de confirmacion dice la verdad', () => {
  // Es lo UNICO que el usuario lee antes de confirmar algo que no puede deshacer,
  // y estaba escrita cuatro veces —HoySection y HarveySection, cada una en su
  // variante de movil y escritorio— con dos mapas distintos entre si. Un tipo
  // nuevo habia que darlo de alta en cuatro sitios o salia con el icono de
  // «cliente» y el boton decia CREANDO.
  it('ningun tipo se queda sin etiqueta', () => {
    for (const t of TIPOS_ACCION) {
      const e = etiquetaAccion(t)
      expect(e?.icono, `${t} sin icono`).toBeTruthy()
      expect(e?.titulo, `${t} sin titulo`).toBeTruthy()
      expect(e?.tituloLargo, `${t} sin titulo largo`).toBeTruthy()
      expect(e?.enCurso, `${t} sin texto de «en curso»`).toBeTruthy()
    }
  })

  it('completar no dice que esta creando nada', () => {
    // No anade nada: tacha. Llamarlo «CREAR» en el unico sitio donde el usuario
    // puede parar la accion es la clase de mentira pequena que hace que se
    // confirme sin leer.
    const e = etiquetaAccion('completar')
    expect(e.enCurso).not.toMatch(/crea/i)
    expect(e.tituloLargo).not.toMatch(/crear/i)
    expect(e.tituloLargo).toMatch(/marcar/i)
  })
})

describe('cerrar el dia por voz no pisa lo escrito', () => {
  // `PATCH /api/diario` hace un upsert con el valor que le mandes, asi que
  // escribir a pelo BORRA lo que hubiera antes. Borrar el cierre de alguien es lo
  // peor que puede hacer una accion por voz: no hay papelera y ese texto no esta
  // en ningun otro sitio.
  const PERFIL = { id: 'u1', name: 'Javi' }

  function conServidor(entradas: unknown[] | 'falla') {
    const escrito: Record<string, unknown>[] = []
    const dichos: string[] = []
    // EL DOBLE IMITA A LA RUTA, INCLUIDO LO QUE RECHAZA.
    //
    // Antes aceptaba el metodo que le dieras. Se subio la accion llamando con
    // PATCH —que `/api/diario` NO exporta— y esta prueba paso en verde: estaba de
    // acuerdo con la suposicion en vez de con la ruta. En produccion era un 405 y
    // no se escribia nada. Lo caza tambien una regla estructural, que compara
    // cada `fetch('/api/...')` con lo que ese route.ts exporta de verdad.
    const METODOS_REALES = ['GET', 'POST']   // los que exporta src/app/api/diario/route.ts
    const fetchFalso = async (url: string, init?: { method?: string; body?: string }) => {
      const metodo = (init?.method || 'GET').toUpperCase()
      if (!METODOS_REALES.includes(metodo)) {
        return { ok: false, status: 405, json: async () => ({ error: 'Method Not Allowed' }) }
      }
      if (metodo === 'GET') {
        if (entradas === 'falla') return { ok: false, status: 500, json: async () => ({}) }
        return { ok: true, status: 200, json: async () => ({ dia: '2026-08-25', entradas, porPersona: [] }) }
      }
      escrito.push(JSON.parse(init!.body || '{}'))
      return { ok: true, status: 200, json: async () => ({}) }
    }
    ;(globalThis as { fetch?: unknown }).fetch = fetchFalso
    return {
      escrito, dichos,
      deps: { data: {} as never, perfil: PERFIL, showToast: (m: string) => { dichos.push(m) } },
    }
  }

  it('con un cierre ya escrito, lo conserva y anade debajo', async () => {
    const { escrito, deps } = conServidor([{ user_id: 'u1', cierre: 'He montado el teaser' }])
    const ok = await ejecutarAccionHarvey({ type: 'diario', text: 'Y he mandado el presupuesto' }, deps)
    expect(ok).toBe(true)
    expect(escrito).toHaveLength(1)
    expect(escrito[0].cierre).toBe('He montado el teaser\nY he mandado el presupuesto')
  })

  it('sin nada escrito, escribe solo lo dictado', async () => {
    const { escrito, deps } = conServidor([])
    await ejecutarAccionHarvey({ type: 'diario', text: 'He montado el teaser' }, deps)
    expect(escrito[0].cierre).toBe('He montado el teaser')
  })

  it('no confunde el cierre de otro con el mio', async () => {
    // `entradas` trae UNA FILA POR PERSONA: coger la primera pegaria el texto de
    // Javi debajo del de Paula y lo escribiria en el dia de quien habla.
    const { escrito, deps } = conServidor([
      { user_id: 'otro', cierre: 'Cierre de Paula' },
      { user_id: 'u1', cierre: 'Cierre de Javi' },
    ])
    await ejecutarAccionHarvey({ type: 'diario', text: 'Y una cosa mas' }, deps)
    expect(escrito[0].cierre).toBe('Cierre de Javi\nY una cosa mas')
  })

  it('si no puede leer lo que habia, NO escribe', async () => {
    // Escribir sin saber que habia es exactamente el caso que hay que evitar: se
    // prefiere no guardar la frase a guardarla encima del cierre de la manana.
    const { escrito, dichos, deps } = conServidor('falla')
    const ok = await ejecutarAccionHarvey({ type: 'diario', text: 'algo' }, deps)
    expect(ok).toBe(false)
    expect(escrito, 'ha escrito sin saber que habia debajo').toEqual([])
    expect(dichos.join(' ')).toMatch(/no he podido leer/i)
  })
})

describe('una tarea dictada puede pertenecer a un proyecto', () => {
  // Sin esto, lo que se creaba por voz no pertenecia a ningun sitio: Proyectos no
  // reflejaba nada de lo dictado aunque el usuario hubiera dicho de cual era.
  // EL COMPLETADO VA PRIMERO a proposito. Con el activo delante, `find` lo cogia
  // igual y la prueba pasaba en verde con el filtro quitado: no comprobaba nada.
  const proyectos = [
    { id: 'p2', name: 'Spot verano Mango 2025', status: 'completado' },
    { id: 'p1', name: 'Spot verano Mango', status: 'activo' },
    { id: 'p3', name: 'Web Nocilla', status: 'activo' },
  ]

  function deps() {
    const creadas: Record<string, unknown>[] = []
    const dichos: string[] = []
    return {
      creadas, dichos,
      deps: {
        data: {
          projects: proyectos, team: [], clients: [],
          createTask: async (t: Record<string, unknown>) => { creadas.push(t); return t },
        } as never,
        perfil: { id: 'u1', name: 'Javi' },
        showToast: (m: string) => { dichos.push(m) },
      },
    }
  }

  it('engancha la tarea al proyecto que se ha dicho', async () => {
    const { creadas, deps: d } = deps()
    await ejecutarAccionHarvey({ type: 'tarea', text: 'Montar el teaser', projectName: 'Spot verano Mango' }, d)
    expect(creadas[0].project_id).toBe('p1')
  })

  it('no la mete en un proyecto COMPLETADO', async () => {
    // Un proyecto cerrado que aun se llama parecido casaria primero, y la tarea se
    // iria a un sitio donde ya no mira nadie.
    const { creadas, deps: d } = deps()
    await ejecutarAccionHarvey({ type: 'tarea', text: 'Retoque', projectName: 'Spot verano Mango 2025' }, d)
    expect(creadas[0].project_id).toBe('p1')
  })

  it('si no reconoce el proyecto la crea suelta Y LO DICE', async () => {
    // Engancharla al proyecto equivocado no es recuperable: nadie sabe que hay que
    // ir a buscarla. Crearla suelta si, pero solo si el aviso lo cuenta — «creada»
    // a secas deja al usuario creyendo que esta dentro.
    const { creadas, dichos, deps: d } = deps()
    const ok = await ejecutarAccionHarvey({ type: 'tarea', text: 'Algo', projectName: 'Proyecto que no existe' }, d)
    expect(ok).toBe(true)
    expect(creadas[0].project_id).toBeUndefined()
    expect(dichos.join(' ')).toMatch(/fuera de proyecto/i)
  })

  it('sin proyecto dicho, ni lo menciona', async () => {
    const { creadas, dichos, deps: d } = deps()
    await ejecutarAccionHarvey({ type: 'tarea', text: 'Algo suelto' }, d)
    expect(creadas[0].project_id).toBeUndefined()
    expect(dichos.join(' ')).not.toMatch(/proyecto/i)
  })

  it('el parser recoge el cuarto campo', () => {
    const { accion } = parsearAccionHarvey('Hecho. [ACCION:tarea|Montar el teaser|high|Paula|Spot verano Mango]')
    expect(accion?.projectName).toBe('Spot verano Mango')
    expect(accion?.assigneeName).toBe('Paula')
  })
})
