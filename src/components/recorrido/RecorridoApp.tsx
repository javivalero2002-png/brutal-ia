'use client'
import { BLU, BORDER, SURF2 } from '@/components/shared/design-tokens'
import LucideIcon from '@/components/shared/LucideIcon'
import {
  MiniHoy, MiniFichar, MiniTareas, MiniInbox, MiniCalendario,
  MiniClientes, MiniProyectos, MiniContenido, MiniHarvey, MiniChat, MiniOperativa,
} from './piezas'

// ─────────────────────────────────────────────────────────────────────────────
// EL RECORRIDO — el último paso de la puesta en marcha.
//
// Javi: «hay que añadir un apartado de "Explicando la App" y todo lo que hace,
// con ejemplos y todo muy visual».
//
// Una pantalla por sección, y en cada una tres cosas y solo tres:
//
//   · UNA MAQUETA de esa pantalla, para que cuando llegue a ella la reconozca.
//     Es lo que hace que esto no sea una lista de nombres.
//   · QUÉ ES, en una frase, escrita para alguien que no ha visto la app nunca.
//   · LO QUE NO SE VE MIRÁNDOLA. Esta es la que vale. Que Fichar existe se
//     descubre solo; que los objetivos que escribes al fichar se convierten en
//     tareas de verdad, no — y es justo lo que hace que la app sea una app y no
//     catorce pantallas sueltas. Un recorrido que solo nombra las secciones no
//     hace falta: para eso está el menú.
//
// El orden no es el del menú: es el del día. Llegas (Hoy), fichas, miras qué
// tienes que hacer, miras el correo... y lo de mantenimiento va al final.
// ─────────────────────────────────────────────────────────────────────────────

export const RECORRIDO = [
  {
    id: 'hoy', icono: 'sun', nombre: 'Hoy', Mini: MiniHoy,
    que: 'La portada. Al abrir la app te dice en cinco líneas qué reclama tu atención hoy: lo urgente del correo, lo que vence y lo que dejaste a medias ayer.',
    truco: 'No hay que ir a buscar nada. Si algo importa, sale aquí — y si aquí no sale nada, es que no hay nada ardiendo.',
    ejemplos: [
      'Pulsa el orbe y habla con Harvey',
      'Toca una cifra para ir a su sección',
      'Es lo que se abre al entrar',
    ],
  },
  {
    id: 'diario', icono: 'pen-line', nombre: 'Fichar', Mini: MiniFichar,
    que: 'Al entrar marcas entrada y escribes qué te propones hacer. Al salir tachas lo que has hecho y cuentas en dos líneas qué se quedó a medias.',
    truco: 'Lo que escribes como objetivo no se queda aquí: pasa a Tareas como tarea de verdad. Si la tachas en un sitio, se tacha en el otro — son la misma cosa vista desde dos pantallas, no dos listas que hay que mantener a mano.',
    ejemplos: [
      'Marca entrada y escribe tres objetivos',
      'Míralos aparecer solos en Tareas',
      'Al salir, cuenta qué quedó a medias',
    ],
  },
  {
    id: 'tareas', icono: 'check-square', nombre: 'Tareas', Mini: MiniTareas,
    que: 'Todo lo que hay que hacer, tuyo y del equipo, con quién lo lleva, para cuándo y con qué prioridad. En lista o en tablero, como prefieras mirarlo.',
    truco: 'El botón «Mi día» deja en pantalla solo lo tuyo urgente o ya vencido. Es el atajo para cuando abres la app y no sabes por dónde empezar.',
    ejemplos: [
      'Pulsa «Mi día»',
      'Cambia entre lista y tablero',
      'Agrupa por proyecto o por prioridad',
    ],
  },
  {
    id: 'inbox', icono: 'inbox', nombre: 'Inbox', Mini: MiniInbox,
    que: 'Tu correo de Gmail y el buzón compartido de colaboraciones, en una sola lista. También los mensajes internos que os mandáis entre vosotros.',
    truco: 'Cada correo llega ya leído por la IA: la línea azul de debajo del asunto es su resumen, y la barra de color de la izquierda marca lo urgente. Puedes saber si algo corre sin abrir un solo email.',
    ejemplos: [
      'Lee la línea azul, no el correo entero',
      'Filtra por «Urgente»',
      'Responde y deja que Harvey lo redacte',
    ],
  },
  {
    id: 'calendario', icono: 'calendar', nombre: 'Calendario', Mini: MiniCalendario,
    que: 'El mes entero con todo lo que tiene fecha, y el detalle del día al pinchar en él.',
    truco: 'No es solo tu Google Calendar: en el mismo día se pintan los eventos, las piezas que se publican, las tareas que vencen y los cierres de proyecto. Cada cosa con su color.',
    ejemplos: [
      'Pincha un día para ver el detalle',
      'Cambia entre «solo mías» y «todo el equipo»',
      'Crea un evento y saldrá en tu Google',
    ],
  },
  {
    id: 'clientes', icono: 'users', nombre: 'Clientes', Mini: MiniClientes,
    que: 'La ficha de cada cliente: a qué se dedica, cuánto factura al mes y todo lo que tenéis abierto con él.',
    truco: 'Se cruza sola con el correo. La ficha te dice cuándo fue el último contacto y cuántos emails suyos siguen sin leer — que es la forma rápida de ver a quién tenéis olvidado.',
    ejemplos: [
      'Mira cuándo fue el último contacto',
      'Filtra por «Activo»',
      'Abre un cliente y ve todo lo suyo',
    ],
  },
  {
    id: 'proyectos', icono: 'folder-open', nombre: 'Proyectos', Mini: MiniProyectos,
    que: 'Cada trabajo grande con su cliente, su porcentaje de avance, su fecha límite y las tareas que cuelgan de él.',
    truco: 'Suelta un PDF encima de un proyecto y la IA lo lee entero: saca la portada, lo resume, lo guarda en la memoria del estudio y después le puedes hacer preguntas al documento sin volver a abrirlo.',
    ejemplos: [
      'Suelta un PDF encima de un proyecto',
      'Pregúntale al documento',
      'Mira el porcentaje de avance',
    ],
  },
  {
    id: 'contenido', icono: 'film', nombre: 'Contenido', Mini: MiniContenido,
    que: 'El tablero de las piezas que se publican en redes: van pasando de idea a en producción, a listo, a publicado.',
    truco: 'Cada pieza tiene un enlace de revisión que se copia con un botón. Se lo mandas a un cliente, lo abre fuera de la app y deja su opinión ahí mismo — sin cuenta, sin contraseña y sin ver nada más del estudio.',
    ejemplos: [
      'Mueve una pieza a «Listo»',
      'Copia el enlace de revisión',
      'Filtra por plataforma',
    ],
  },
  {
    id: 'harvey', icono: 'cpu', nombre: 'Harvey', Mini: MiniHarvey,
    que: 'El asistente al que se le habla. Pulsas el micrófono, dices lo que quieras y te contesta en voz alta.',
    // Lo que Javi pidio explicar de verdad: que Harvey no es un buscador de la
    // app, es la app con manos. Y que no se queda dentro — busca en internet.
    truco: 'No solo contesta: HACE. Crea tareas, proyectos, clientes, piezas y reuniones, marca cosas como hechas y te cierra la jornada. Y antes de tocar nada te enseña una tarjeta con lo que ha entendido: hasta que no la confirmas, no existe.',
    ejemplos: [
      '«Crea una tarea urgente para Jorge»',
      '«Reunión con Zara el martes a las 10»',
      '«Cierra mi día: he montado el teaser»',
    ],
  },
  {
    id: 'chat', icono: 'message-square', nombre: 'Brutal.IA', Mini: MiniChat,
    que: 'La misma cabeza que Harvey, pero escrita. Para cuando no puedes hablar en voz alta o quieres leer la respuesta con calma.',
    // Las tres cosas que la gente NO prueba porque no se le ocurre que pueda.
    truco: 'Sabe tres cosas a la vez: lo que hay dentro de la app, lo que ha hecho cada persona del equipo, y lo que hay en internet ahora mismo — busca de verdad, en tiempo real. Así que le puedes preguntar por una campaña vuestra de hace un año y, en el mensaje siguiente, por el precio de un alquiler hoy.',
    ejemplos: [
      '«¿Qué ha hecho Jorge esta semana?»',
      '«¿Qué campaña hicimos con Nutella?»',
      '«¿Cuánto cuesta alquilar un dron en Valencia?»',
    ],
  },
  {
    id: 'ajustes', icono: 'settings', nombre: 'Operativa', Mini: MiniOperativa,
    que: 'La trastienda: tu ficha y tu color, los avisos, conectar el correo y el calendario, la memoria del estudio y las copias de seguridad.',
    truco: 'La Memoria es lo que hace que las IAs sepan cómo trabajáis: notas, decisiones, procesos y PDFs que se leen enteros. Lo que apuntes ahí lo saben las dos, y lo saben al momento.',
    ejemplos: [
      'Conecta tu Gmail y tu calendario',
      'Sube un PDF a Memoria',
      'Vuelve a abrir esta puesta en marcha',
    ],
  },
]

/** Una pantalla del recorrido. La maqueta arriba, y debajo qué es y qué esconde. */
export function TarjetaRecorrido({ i }: { i: number }) {
  const p = RECORRIDO[Math.min(Math.max(i, 0), RECORRIDO.length - 1)]
  const { Mini } = p
  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${BLU}1A`, border: `1px solid ${BLU}3D` }}>
          <LucideIcon name={p.icono} size={12} color={BLU} />
        </div>
        <h2 className="font-figtree text-[17px] font-black text-white leading-none" style={{ letterSpacing: '-0.02em' }}>{p.nombre}</h2>
        <div className="flex-1" />
        {/* Cuántas van. Un recorrido de diez pantallas sin contador parece que
            no se acaba, que es justo lo que hace que se salte. */}
        <div className="font-syne text-[7px] font-black tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.25)' }}>
          {i + 1}/{RECORRIDO.length}
        </div>
      </div>

      <Mini />

      <p className="font-figtree text-[12.5px] mt-3 leading-snug" style={{ color: 'rgba(255,255,255,0.62)' }}>{p.que}</p>

      <div className="mt-2.5 rounded-2xl px-3.5 py-2.5" style={{ background: SURF2, border: `1px solid ${BORDER}` }}>
        <div className="font-syne text-[7px] font-black tracking-[0.2em] mb-1" style={{ color: `${BLU}B3` }}>LO QUE NO SE VE</div>
        <p className="font-figtree text-[11.5px] leading-snug" style={{ color: 'rgba(255,255,255,0.5)' }}>{p.truco}</p>
      </div>

      {/* PRUEBA ESTO — tres cosas, siempre tres, en las once pantallas.
          Javi: «parece que se ha mezclado entre lo anterior y lo nuevo; tiene que
          haber un único apartado donde pone un repaso de qué hace cada pantalla,
          más o menos tiene que ser igual». Y era verdad: unas llevaban cuatro
          frases entrecomilladas y otras una etiqueta suelta de adorno, así que el
          recorrido parecía dos recorridos pegados.
          Ahora las once tienen la misma forma —maqueta, qué es, lo que no se ve, y
          tres cosas que probar— y el rótulo lo hace evidente. */}
      {p.ejemplos.length > 0 && (
        <div className="mt-2.5">
        <div className="font-syne text-[7px] font-black tracking-[0.2em] mb-1.5" style={{ color: 'rgba(255,255,255,0.25)' }}>PRUEBA ESTO</div>
        <div className="flex flex-wrap gap-1.5">
          {p.ejemplos.map(e => {
            // Lo entrecomillado es algo que se DICE; lo demás es algo que hay.
            const seDice = e.startsWith('«')
            return (
              <div key={e} className="px-2.5 py-1 rounded-full font-figtree text-[10.5px] leading-tight"
                style={seDice
                  ? { background: `${BLU}14`, border: `1px solid ${BLU}30`, color: '#BFD2FF' }
                  : { background: 'rgba(255,255,255,0.035)', border: `1px solid ${BORDER}`, color: 'rgba(255,255,255,0.38)' }}>
                {e}
              </div>
            )
          })}
        </div>
        </div>
      )}

      {/* Los puntos. Van abajo y pequeños: informan de dónde estás, no se pulsan
          —a diez pantallas, unos puntos pulsables de 4px son una trampa táctil. */}
      <div className="flex items-center justify-center gap-1 mt-3">
        {RECORRIDO.map((x, n) => (
          <div key={x.id} className="rounded-full transition-all"
            style={{ width: n === i ? '10px' : '4px', height: '4px', background: n === i ? BLU : 'rgba(255,255,255,0.14)' }} />
        ))}
      </div>
    </div>
  )
}
