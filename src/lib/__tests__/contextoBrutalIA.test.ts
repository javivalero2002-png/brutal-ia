import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * LO QUE BRUTAL.IA VE DE VERDAD.
 *
 * Esto no comprueba que exista un `if` en alguna parte: captura el prompt de
 * sistema que sale hacia el modelo y lee lo que pone. Hacía falta porque los
 * cinco agujeros que arregla eran todos del mismo tipo — el dato ESTABA en la
 * consulta y no llegaba al texto:
 *
 *   · el responsable de cada tarea se pedía (`assignee:profiles!assigned_to`),
 *     se declaraba en el tipo, y el prompt imprimía solo `t.text`;
 *   · del equipo se decía «7 personas» sin un solo nombre;
 *   · del pipeline, «3 piezas» sin un solo título;
 *   · calendario no había;
 *   · el diario del equipo lo tenía Harvey y esta no.
 *
 * Los cuatro primeros no habrían salido en ninguna revisión de código que mire
 * consultas: la consulta era correcta.
 */

const capturado: { system?: string | undefined } = {}

vi.mock('@anthropic-ai/sdk', () => {
  class FakeAnthropic {
    messages = {
      create: async (params: any) => {
        capturado.system = params.system
        return { content: [{ type: 'text', text: 'ok' }] }
      },
    }
  }
  return { default: FakeAnthropic }
})

const { chat } = await import('@/lib/ai')

const BASE = {
  clients: ['Mango'],
  projects: [{ name: 'Spot verano', status: 'activo' }],
  tasks: [
    { text: 'Montar el teaser', level: 'urgent', assignee: 'Paula' },
    { text: 'Guion del spot', level: 'high' },
  ],
  unreadInbox: 2,
  emails: [],
  teamSize: 3,
  team: ['Javi', 'Paula', 'Pablo'],
  userName: 'Javi',
  todayDate: 'lunes, 25 de agosto de 2026',
  contentPipeline: 2,
}

async function prompt(extra: Record<string, unknown> = {}) {
  capturado.system = undefined
  await chat('hola', [], { ...BASE, ...extra } as never)
  expect(capturado.system, 'no se capturó el prompt: revisa el mock').toBeTruthy()
  return String(capturado.system)
}

describe('el prompt de Brutal.IA lleva lo que dice llevar', () => {
  beforeEach(() => { capturado.system = undefined })

  it('nombra al equipo, no solo lo cuenta', async () => {
    const p = await prompt()
    for (const n of ['Javi', 'Paula', 'Pablo']) expect(p).toContain(n)
    // El recuento se conserva: «Equipo (3)» sigue diciendo cuántos son.
    expect(p).toMatch(/Equipo \(3\)/)
  })

  it('dice de quién es cada tarea cuando lo sabe', async () => {
    const p = await prompt()
    expect(p).toContain('Montar el teaser (→ Paula)')
    // Y no se inventa un responsable para la que no lo tiene.
    expect(p).toContain('Guion del spot')
    expect(p).not.toMatch(/Guion del spot \(→/)
  })

  it('lista las piezas de contenido por título', async () => {
    const p = await prompt({
      contenido: [
        { title: 'Reel making of', platform: 'Instagram', status: 'listo', publish_date: '2026-08-27' },
        { title: 'Caso Mango', platform: 'LinkedIn', status: 'borrador' },
      ],
    })
    expect(p).toContain('Reel making of')
    expect(p).toContain('Instagram')
    expect(p).toContain('2026-08-27')
    expect(p).toContain('Caso Mango')
  })

  it('trae el calendario, y solo lo que aún no ha pasado', async () => {
    const p = await prompt({
      eventos: [
        { title: 'Rodaje Mango', start: '2099-01-02T09:00:00' },
        { title: 'Reunión vieja', start: '2020-01-01T09:00:00' },
      ],
    })
    expect(p).toContain('Rodaje Mango')
    // Un evento de 2020 en «CALENDARIO PRÓXIMO» hace que el modelo hable de él
    // como si viniera: se filtra por día, no se recorta la lista y ya está.
    expect(p).not.toContain('Reunión vieja')
  })

  it('la cuenta del evento solo se dice si hay más de una', async () => {
    // Con un solo calendario conectado, poner el correo detrás de cada evento es
    // ruido que el modelo acaba leyendo en voz alta.
    const una = await prompt({ eventos: [{ title: 'Rodaje', start: '2099-01-02T09:00:00', cuenta: 'a@b.com' }] })
    expect(una).not.toContain('a@b.com')
    const dos = await prompt({ eventos: [
      { title: 'Rodaje', start: '2099-01-02T09:00:00', cuenta: 'a@b.com' },
      { title: 'Montaje', start: '2099-01-03T09:00:00', cuenta: 'c@d.com' },
    ] })
    expect(dos).toContain('a@b.com')
  })

  it('cuando hay diario del equipo, van también las instrucciones de leerlo', async () => {
    // El dato sin la instrucción es peor que nada: «se propuso» es un PLAN y sin
    // avisar el modelo lo cuenta como trabajo terminado delante de un jefe.
    const sin = await prompt()
    expect(sin).not.toContain('CÓMO SE CUENTA LO QUE HA HECHO ALGUIEN')
    const con = await prompt({ diarioEquipo: '\n\nDIARIO DEL EQUIPO (últimos 7 días, desde 2026-08-19):\n  Paula: 2 tarea(s)' })
    expect(con).toContain('DIARIO DEL EQUIPO')
    expect(con).toContain('CÓMO SE CUENTA LO QUE HA HECHO ALGUIEN')
    expect(con).toContain('es un PLAN, no un hecho')
  })

  it('lo que no llega, no se finge', async () => {
    // Sin calendario no debe aparecer una cabecera vacía: un «CALENDARIO PRÓXIMO:»
    // sin nada debajo se lee como «no tienes nada», que es una afirmación, no un
    // hueco.
    const p = await prompt()
    expect(p).not.toContain('CALENDARIO PRÓXIMO')
    expect(p).toMatch(/no lo deduzcas ni te lo inventes/i)
  })
})
