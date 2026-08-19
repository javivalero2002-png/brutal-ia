import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { videoEmbed, videoEsVertical } from '@/components/shared/helpers'

// ─────────────────────────────────────────────────────────────────────────────
// La pantalla de revisión es la ÚNICA que ve gente de fuera del estudio.
//
// Ese enlace es, casi siempre, el primer contacto de un cliente con nuestro
// trabajo, así que el listón es más alto que dentro: aquí no vale «se arregla
// cuando alguien se queje», porque quien se queja es el cliente.
// ─────────────────────────────────────────────────────────────────────────────

const leerCodigo = (ruta: string) =>
  readFileSync(ruta, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('videoEmbed · lo que se le enseña al cliente', () => {
  it('entiende YouTube en sus dos formas', () => {
    expect(videoEmbed('https://www.youtube.com/watch?v=abc123')).toBe('https://www.youtube.com/embed/abc123')
    expect(videoEmbed('https://youtu.be/abc123')).toBe('https://www.youtube.com/embed/abc123')
  })

  it('entiende Vimeo', () => {
    expect(videoEmbed('https://vimeo.com/987654')).toBe('https://player.vimeo.com/video/987654')
  })

  // Drive es el caso que faltaba, y no era un caso raro: la propia app le dice al
  // usuario «sube el vídeo a YouTube, Vimeo o Drive». Con un enlace de Drive, el
  // cliente abría la revisión y veía el título y una caja de texto vacía — le
  // pedíamos opinión sobre algo que no le enseñábamos.
  it('entiende Drive, que es lo que la propia app recomienda', () => {
    expect(videoEmbed('https://drive.google.com/file/d/1AbC_xyz/view?usp=sharing'))
      .toBe('https://drive.google.com/file/d/1AbC_xyz/preview')
    expect(videoEmbed('https://drive.google.com/open?id=1AbC_xyz'))
      .toBe('https://drive.google.com/file/d/1AbC_xyz/preview')
  })

  // Instagram es lo que MÁS se va a pegar —el estudio publica ahí— y hasta ahora
  // no se entendía, aunque el propio texto de la pantalla lo prometía: pegabas el
  // enlace y no se veía nada.
  it('entiende Instagram, que es lo que más se publica', () => {
    for (const [url, id] of [
      ['https://www.instagram.com/reel/CxYz123/', 'CxYz123'],
      ['https://instagram.com/p/AbC456/?igsh=xxx', 'AbC456'],
      ['https://www.instagram.com/tv/DeF789/', 'DeF789'],
    ]) {
      expect(videoEmbed(url), url).toBe(`https://www.instagram.com/p/${id}/embed`)
    }
  })

  it('sabe cuáles son verticales, para no pintarlos como un sello', () => {
    // Un reel en un marco 16:9 sale diminuto entre dos franjas negras, y el reel
    // es el formato que más se manda a revisar a un cliente.
    expect(videoEsVertical('https://www.instagram.com/reel/CxYz123/')).toBe(true)
    expect(videoEsVertical('https://www.instagram.com/p/AbC456/')).toBe(false)
    expect(videoEsVertical('https://www.youtube.com/watch?v=abc')).toBe(false)
  })

  it('devuelve null para lo que no sabe incrustar, no una URL rota', () => {
    // Es un contrato: quien llame tiene que poder distinguir «esto va en un
    // iframe» de «esto hay que abrirlo aparte». Devolver la URL a secas metería
    // una página cualquiera dentro de un iframe y saldría en blanco.
    expect(videoEmbed('https://ejemplo.com/video.mp4')).toBeNull()
    expect(videoEmbed('')).toBeNull()
  })
})

describe('la pantalla que ve el cliente', () => {
  const PAGINA = leerCodigo('src/app/review/[token]/page.tsx')
  const RUTA = leerCodigo('src/app/api/review/[token]/route.ts')

  it('nunca deja un hueco mudo: si no se puede incrustar, hay enlace', () => {
    // El fallo era pintar SOLO la rama del incrustado, así que cualquier otro
    // material dejaba al cliente con el título y una caja de texto.
    // Ventana holgada: la rama del incrustado creció al adaptar el marco a los
    // vídeos verticales, y con 400 letras la regla se puso roja sin que nada se
    // hubiera roto. Lo que se comprueba es la CADENA de ternarios, no que estén
    // pegados — el formato no es el invariante.
    expect(/embed \?[\s\S]{0,900}: item\.video_url \?/.test(PAGINA),
      'solo pinta el material cuando se puede incrustar: con un enlace de Drive o una story el cliente no ve nada')
      .toBe(true)
  })

  it('siempre hay un enlace al original, aunque el incrustado se tape', () => {
    // Medido el 2026-08-19: el incrustado de Instagram FUNCIONA —carga bien en un
    // navegador limpio, verificado— pero cualquier bloqueador de contenido lo tapa
    // con «este contenido esta bloqueado». Y los bloqueadores son de lo mas
    // instalado que hay: el propio Javi tiene uno, y el cliente al que le mandamos
    // el enlace puede tener otro sin que nosotros lo sepamos nunca.
    //
    // Discutir con el bloqueador no es una opcion. Dar una salida de un clic, si.
    expect(/item\.video_url && \([\s\S]{0,600}target="_blank"/.test(PAGINA),
      'sin enlace al original: a quien tenga un bloqueador le pedimos opinion sobre una pieza que no puede ver')
      .toBe(true)
  })

  it('no se escribe su propia copia de videoEmbed', () => {
    // Había dos, y la de aquí se había quedado atrás: la de `shared` entiende
    // Drive y esta no. Es el patrón de gemelos que domina los fallos de este repo.
    expect(/function videoEmbed/.test(PAGINA),
      'vuelve a tener su propia copia de videoEmbed: la de shared y esta divergirán, y ya pasó una vez')
      .toBe(false)
  })

  it('la portada que se firma es una que la consulta trae', () => {
    // `firmarCampos` pedía `cover_url` y el `select` no la traía: se firmaba una
    // columna inexistente y el cliente nunca veía la imagen.
    const i = RUTA.indexOf('firmarCampos(')
    expect(i, 'ya no se firma: revisa esta regla').toBeGreaterThan(-1)
    for (const campo of RUTA.slice(i, i + 200).match(/'(\w+_url)'/g) || []) {
      const nombre = campo.replace(/'/g, '')
      expect(new RegExp(`select\\([^)]*${nombre}`).test(RUTA),
        `firma «${nombre}» pero el select no la trae: se firma una columna que nunca llega y el cliente no ve nada`)
        .toBe(true)
    }
  })

  it('el endpoint publico no saca nada interno', () => {
    // Lo que sale por aquí sale a internet sin sesión. `notes` son las notas del
    // equipo y `client_id` identifica al cliente: ninguna de las dos es asunto de
    // quien abre el enlace.
    const sel = RUTA.slice(RUTA.indexOf('.select('), RUTA.indexOf('.select(') + 200)
    for (const prohibido of ['notes', 'client_id', 'feedback']) {
      expect(new RegExp(`\\b${prohibido}\\b`).test(sel),
        `el endpoint publico saca «${prohibido}»: es interno y esto lo lee cualquiera con el enlace`)
        .toBe(false)
    }
  })

  it('aprobar viaja como bandera, no como texto que alguien interpreta', () => {
    expect(/aprobado/.test(PAGINA) && /body\.aprobado === true/.test(RUTA),
      'aprobar es texto libre: el equipo tiene que adivinar si un mensaje es un si, y eso no se deduce leyendo prosa')
      .toBe(true)
  })

  it('cuando el cliente responde, alguien se entera', () => {
    // La pagina PROMETE «el equipo recibira tu respuesta». La unica senal era un
    // punto ambar de pixel y medio en un tablero que nadie patrulla.
    expect(/sendPushTo(User|All)\(/.test(RUTA),
      'el feedback del cliente no avisa a nadie, y la pagina promete que si').toBe(true)
    expect(/export const maxDuration/.test(RUTA),
      'espera un push sin declarar maxDuration: un cuelgue no se distingue de un fallo').toBe(true)
  })

  it('la vista previa del enlace presenta la PIEZA, no la herramienta interna', () => {
    // Resuelto en el servidor a proposito: la vista previa la pide un robot que no
    // ejecuta JavaScript, asi que ponerlo desde React dejaria la tarjeta generica.
    const LAYOUT = leerCodigo('src/app/review/[token]/layout.tsx')
    expect(/generateMetadata/.test(LAYOUT),
      'el enlace hereda el titulo del sitio: al cliente le llega «app interna de Brutal Studios»').toBe(true)
    expect(/index: false/.test(LAYOUT),
      'el enlace de revision es indexable: acabaria en Google').toBe(true)
    // Y lo que viaja a los servidores de WhatsApp y Slack no puede ser interno.
    for (const prohibido of ['notes', 'feedback']) {
      expect(new RegExp(`select\\([^)]*${prohibido}`).test(LAYOUT),
        `la vista previa saca «${prohibido}»: eso viaja a los servidores de WhatsApp y Slack`)
        .toBe(false)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// El informe que se lleva a una reunión.
// ─────────────────────────────────────────────────────────────────────────────
describe('el informe imprimible', () => {
  const R = leerCodigo('src/components/sections/ReportesSection.tsx')

  it('se pagina como un documento, no como una pagina web larga', () => {
    // Sin `@page` el navegador imprime con sus margenes por defecto y mete la URL
    // en el pie; sin control de cortes, una fila se parte entre dos hojas.
    expect(/@page\{/.test(R),
      'el informe no declara pagina: sale con los margenes del navegador y la URL impresa en el pie').toBe(true)
    expect(/break-inside:avoid/.test(R),
      'nada impide que una fila o una seccion se parta entre dos hojas: son hojas grapadas, no un informe').toBe(true)
    // Las barras de progreso son fondo de color y por defecto NO se imprimen.
    expect(/print-color-adjust:exact/.test(R),
      'los fondos no se imprimen: las barras de progreso salen en blanco y se pierde lo que se lee de un vistazo').toBe(true)
  })

  it('ensena lo que el estudio entrega, no solo su gestion interna', () => {
    const i = R.indexOf('printWin.document.write')
    expect(i, 'ya no se genera asi: revisa esta regla').toBeGreaterThan(-1)
    expect(/contenidoHtml/.test(R.slice(i, i + 4000)),
      'el informe lleva tareas, proyectos y diario pero no las piezas publicadas: para un estudio de contenido, es ensenar el andamio y no el edificio')
      .toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Quién firma una opinión que llega por el enlace público.
//
// El enlace se pega en un grupo de WhatsApp donde están el cliente Y los jefes,
// así que firmarlo todo como «CLIENTE» era falso la mitad de las veces. Ahora se
// elige — pero eso abre dos agujeros que estas reglas cierran.
// ─────────────────────────────────────────────────────────────────────────────
describe('quién opina por el enlace', () => {
  const RUTA = leerCodigo('src/app/api/review/[token]/route.ts')
  const PAGINA = leerCodigo('src/app/review/[token]/page.tsx')

  it('el equipo que se manda fuera NO lleva correos', () => {
    // Esto sale a internet sin sesión y acaba en un grupo con el cliente dentro.
    // Quién trabaja aquí no es un secreto; sus direcciones sí.
    const i = RUTA.indexOf("from('profiles')")
    expect(i, 'ya no se lee el equipo: revisa esta regla').toBeGreaterThan(-1)
    const sel = RUTA.slice(i, i + 200)
    for (const prohibido of ['email', 'role', 'gmail']) {
      expect(new RegExp(`\\b${prohibido}`).test(sel),
        `la pantalla publica manda «${prohibido}» del equipo a internet`).toBe(false)
    }
  })

  it('el nombre que llega se VALIDA contra el equipo real', () => {
    // Sin esto, cualquiera con el enlace firma con el nombre que quiera —el de un
    // compañero, o uno inventado con un cargo delante— y queda escrito en el hilo
    // interno como si fuera suyo.
    expect(/miembros \|\| \[\]\)\.find/.test(RUTA) || /\.find\(p =>[^)]*name\) === autor/.test(RUTA),
      'acepta el nombre que le manden sin comprobar que exista: se puede firmar como cualquiera')
      .toBe(true)
  })

  it('una firma declarada nunca pasa por comprobada', () => {
    // `origen: 'cliente'` no significa «lo escribió el cliente»: significa «llegó
    // por el enlace, sin que nadie iniciara sesión». Perder esa marca sería
    // convertir una firma que cualquiera puede elegir en una verificada.
    const i = RUTA.indexOf('entradas.push({')
    expect(i, 'ya no se anexan opiniones asi: revisa esta regla').toBeGreaterThan(-1)
    expect(/origen: 'cliente'/.test(RUTA.slice(i, i + 400)),
      'la opinion del enlace deja de marcarse como venida de fuera: se confundiria con una escrita desde dentro con sesion')
      .toBe(true)
    // Y la pantalla del equipo tiene que DECIRLO, no solo guardarlo.
    const C = leerCodigo('src/components/sections/ContenidoSection.tsx')
    expect(/POR EL ENLACE/.test(C),
      'el hilo del equipo no distingue una firma declarada de una comprobada').toBe(true)
  })

  it('por defecto se firma como Cliente, no como alguien del equipo', () => {
    // Quien abre este enlace es, casi siempre, alguien de fuera. Que el valor por
    // defecto fuera una persona del equipo haría que un despiste firmara por ella.
    expect(/useState\(''\)/.test(PAGINA.slice(PAGINA.indexOf('const [autor'), PAGINA.indexOf('const [autor') + 120)),
      'el selector arranca con alguien del equipo elegido: un despiste firmaria por esa persona')
      .toBe(true)
  })
})
