import { describe, it, expect } from 'vitest'
import { triar } from '@/lib/inboxTriage'

// ─────────────────────────────────────────────────────────────────────────────
// La criba del correo, caso por caso.
//
// Cada uno de estos casos es un correo que un estudio creativo recibe de verdad,
// y la mayoría salen de una revisión adversarial que tumbó la primera versión del
// plan. La lista importa más que el código: es lo que impide que alguien
// «simplifique» la criba dentro de seis meses y deje una factura invisible.
//
// LA ASIMETRÍA: un falso positivo cuesta 0,001 $. Un falso negativo cuesta una
// factura, un contrato o un cliente sin contestar. Ante la duda, se analiza.
// ─────────────────────────────────────────────────────────────────────────────

const PROPIOS = ['brutalstudios.es']
const NADIE = new Set<string>()

const correo = (x: Partial<Parameters<typeof triar>[0]>) => ({
  labelIds: ['INBOX'], from_email: 'quien@ejemplo.com', subject: 'algo', attachments: [], ...x,
})

describe('triaje · lo que SÍ se analiza', () => {
  it('el correo normal de la bandeja', () => {
    expect(triar(correo({}), PROPIOS, NADIE).analizar).toBe(true)
  })

  it('cualquier cosa con adjunto, aunque Gmail la llame promoción', () => {
    // La señal más fuerte y más barata: nadie manda un PDF en un boletín que no
    // importe, y el adjunto ya viene calculado.
    const r = triar(correo({ labelIds: ['CATEGORY_PROMOTIONS'], attachments: [{ n: 'contrato.pdf' }] }), PROPIOS, NADIE)
    expect(r.analizar).toBe(true)
    expect(r.motivo).toBe('adjunto')
  })

  it('lo que viene de nuestro propio dominio', () => {
    const r = triar(correo({ labelIds: ['CATEGORY_PROMOTIONS'], from_email: 'pablo@brutalstudios.es' }), PROPIOS, NADIE)
    expect(r.analizar).toBe(true)
    expect(r.motivo).toBe('dominio-propio')
  })

  it('un remitente con el que ya hemos tenido correspondencia de cliente', () => {
    const conocidos = new Set(['maria@estrellagalicia.es', 'estrellagalicia.es'])
    // Por dirección exacta…
    expect(triar(correo({ labelIds: ['CATEGORY_PROMOTIONS'], from_email: 'maria@estrellagalicia.es' }), PROPIOS, conocidos).analizar).toBe(true)
    // …y por dominio, que es lo que cubre al compañero nuevo de ese mismo cliente.
    expect(triar(correo({ labelIds: ['CATEGORY_PROMOTIONS'], from_email: 'jose@estrellagalicia.es' }), PROPIOS, conocidos).analizar).toBe(true)
  })

  it('un asunto que huele a dinero, esté donde esté', () => {
    for (const asunto of [
      'Tu factura de agosto',
      'Contrato firmado por todas las partes',
      'Presupuesto campaña verano',
      'Purchase Order #4471',
      'Recibo devuelto',
      'Brief para el rodaje',
      'Nueva propuesta comercial',
    ]) {
      const r = triar(correo({ labelIds: ['CATEGORY_PROMOTIONS'], subject: asunto }), PROPIOS, NADIE)
      expect(r.analizar, `«${asunto}» se quedaría sin analizar`).toBe(true)
    }
  })

  it('CATEGORY_UPDATES se analiza: ahí viven las facturas y el banco', () => {
    // La primera versión del plan la excluía. Ahí caen DocuSign, los pedidos de
    // Ariba, los avisos de recibo devuelto y las invitaciones de calendario — que
    // son literalmente el caso de uso de «detectar si hay reunión».
    expect(triar(correo({ labelIds: ['CATEGORY_UPDATES'] }), PROPIOS, NADIE).analizar).toBe(true)
  })

  it('CATEGORY_FORUMS se analiza: ahí caen los grupos de Google', () => {
    // Muchos clientes con Workspace enrutan su `marketing@` o su `hola@` por un
    // grupo, y eso lleva cabecera de lista → Forums. Excluirla se llevaba hilos
    // enteros de proyecto por delante.
    expect(triar(correo({ labelIds: ['CATEGORY_FORUMS'] }), PROPIOS, NADIE).analizar).toBe(true)
  })

  it('sin etiquetas de categoría se analiza todo', () => {
    // Cuentas con las pestañas desactivadas, o si Gmail cambia de idea. Lo peor
    // que puede pasar es pagar de más: ese sí es el lado seguro.
    expect(triar(correo({ labelIds: [] }), PROPIOS, NADIE).analizar).toBe(true)
    expect(triar(correo({ labelIds: undefined }), PROPIOS, NADIE).analizar).toBe(true)
  })

  it('un no-reply cualquiera se analiza: por ahí llega el dinero', () => {
    // La primera versión saltaba los `no-reply@` por regex. Es exactamente el
    // remitente de DocuSign, WeTransfer, Drive, Ariba y el banco.
    for (const de of ['no-reply@docusign.net', 'noreply@wetransfer.com', 'drive-shares-dm-noreply@google.com', 'notifications@ariba.com']) {
      expect(triar(correo({ from_email: de }), PROPIOS, NADIE).analizar, de).toBe(true)
    }
  })
})

describe('triaje · lo único que NO se analiza', () => {
  it('promociones y redes sociales, sin nada que las salve', () => {
    for (const etiqueta of ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL']) {
      const r = triar(correo({ labelIds: ['INBOX', etiqueta], subject: 'Rebajas de verano' }), PROPIOS, NADIE)
      expect(r.analizar, etiqueta).toBe(false)
      expect(r.motivo).toBe('categoria')
    }
  })

  it('pero eso NO significa que no se guarde', () => {
    // No se puede comprobar aquí —lo decide quien llama—, así que queda escrito
    // donde se lee: `triar` responde «¿le pago un análisis?», nunca «¿lo guardo?».
    // La regla de regresiones.test.ts vigila que ningún sync use esto para
    // decidir si inserta.
    expect(typeof triar).toBe('function')
  })
})

describe('el interruptor de «que la IA lea mi correo»', () => {
  it('apagado, no se analiza NADA — ni con adjunto ni con factura en el asunto', () => {
    // Las exenciones son heuristicas nuestras; esto es una decision de la persona.
    // Una decision no se gana con una heuristica: si alguien dice que no quiere que
    // se lea su correo personal, no hay adjunto ni palabra que valga.
    const casos = [
      { attachments: [{ n: 'contrato.pdf' }] },
      { subject: 'Tu factura de agosto' },
      { from_email: 'pablo@brutalstudios.es' },
      { labelIds: [] },
    ]
    for (const c of casos) {
      const r = triar(correo(c), PROPIOS, new Set(['pablo@brutalstudios.es']), false)
      expect(r.analizar, JSON.stringify(c)).toBe(false)
      expect(r.motivo).toBe('preferencia')
    }
  })

  it('encendido se comporta igual que antes', () => {
    expect(triar(correo({}), PROPIOS, NADIE, true).analizar).toBe(true)
    expect(triar(correo({ labelIds: ['CATEGORY_PROMOTIONS'] }), PROPIOS, NADIE, true).analizar).toBe(false)
  })

  it('sin decir nada se analiza: quien no toque el interruptor sigue igual', () => {
    // El defecto NO puede ser «no analizar»: cambiar el comportamiento de todo el
    // mundo en silencio al desplegar seria peor que no tener el interruptor.
    expect(triar(correo({}), PROPIOS, NADIE).analizar).toBe(true)
  })

  it('apagarlo NO esconde el correo: sigue guardandose', () => {
    // No se puede comprobar aqui —lo decide quien llama—, asi que queda escrito
    // donde se lee. `triar` responde «¿le pago un analisis?», nunca «¿lo guardo?».
    expect(triar(correo({}), PROPIOS, NADIE, false).analizar).toBe(false)
  })
})
