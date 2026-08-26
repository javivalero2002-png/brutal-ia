'use client'
import { BLU, BORDER, SURF2 } from '@/components/shared/design-tokens'
import LucideIcon from '@/components/shared/LucideIcon'
import {
  MiniHoy, MiniFichar, MiniTareas, MiniInbox, MiniCalendario,
  MiniClientes, MiniProyectos, MiniContenido, MiniChat, MiniOperativa,
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
    que: 'La portada. Te saluda por tu nombre y te resume en cinco líneas lo que reclama tu atención hoy.',
    truco: 'El orbe del centro es Harvey. Le hablas, y si le pides crear una tarea, un cliente o un evento, te enseña lo que ha entendido antes de crearlo.',
  },
  {
    id: 'diario', icono: 'pen-line', nombre: 'Fichar', Mini: MiniFichar,
    que: 'Al empezar el día escribes qué te propones y marcas entrada. Al terminar tachas lo que has hecho y cuentas qué se quedó a medias.',
    truco: 'Los objetivos que escribes no se quedan aquí: se convierten en tareas de verdad, salen en Tareas, y se tachan solas cuando las completas.',
  },
  {
    id: 'tareas', icono: 'check-square', nombre: 'Tareas', Mini: MiniTareas,
    que: 'Todo lo que hay que hacer, en lista o en tablero, con quién lo lleva y para cuándo.',
    truco: 'El botón «Mi día» deja solo lo tuyo urgente o ya vencido. Y una fecha límite es un DÍA, no una hora: nada vence a las dos de la mañana.',
  },
  {
    id: 'inbox', icono: 'inbox', nombre: 'Inbox', Mini: MiniInbox,
    que: 'El correo de tus cuentas de Gmail y del buzón compartido de colaboraciones, en una sola lista.',
    truco: 'Cada correo llega ya leído por la IA: la línea azul de debajo del asunto es su resumen, y la barra de color de la izquierda marca lo urgente sin que abras nada.',
  },
  {
    id: 'calendario', icono: 'calendar', nombre: 'Calendario', Mini: MiniCalendario,
    que: 'El mes entero con todo lo que tiene fecha, y el detalle del día al pinchar en él.',
    truco: 'No es solo Google Calendar: en el mismo día se pintan los eventos, las piezas que se publican, las tareas que vencen y los deadlines de proyecto.',
  },
  {
    id: 'clientes', icono: 'users', nombre: 'Clientes', Mini: MiniClientes,
    que: 'La ficha de cada cliente: a qué se dedica, cuánto factura al mes y todo lo que tenéis abierto con él.',
    truco: 'Se cruza sola con el correo: la ficha te dice cuándo fue el último contacto y cuántos emails suyos siguen sin leer.',
  },
  {
    id: 'proyectos', icono: 'folder-open', nombre: 'Proyectos', Mini: MiniProyectos,
    que: 'Cada trabajo grande con su cliente, su porcentaje de avance, su fecha límite y las tareas que cuelgan de él.',
    truco: 'Puedes soltar un PDF dentro de un proyecto: la IA lo lee, lo resume, lo guarda en la memoria del estudio y después le puedes hacer preguntas al documento.',
  },
  {
    id: 'contenido', icono: 'film', nombre: 'Contenido', Mini: MiniContenido,
    que: 'El tablero de las piezas que se publican en redes: van pasando de idea a en producción, a listo, a publicado.',
    truco: 'Cada pieza tiene un enlace de revisión que se copia con un botón, para que un cliente lo abra fuera de la app y deje su opinión sin necesitar cuenta.',
  },
  {
    id: 'chat', icono: 'message-square', nombre: 'Brutal.IA', Mini: MiniChat,
    que: 'Un chat escrito con la IA que ya sabe lo que hay dentro de la app.',
    truco: 'No hay que contarle nada: conoce tus tareas, tus proyectos, tus clientes y tu correo. Y la conversación se guarda — mañana sigue ahí.',
  },
  {
    id: 'ajustes', icono: 'settings', nombre: 'Operativa', Mini: MiniOperativa,
    que: 'La trastienda: tu ficha y tu color, los avisos, conectar el correo y el calendario, la memoria del estudio y las copias de seguridad.',
    truco: 'Aquí se vuelve a abrir esta puesta en marcha entera cuando quieras. Es la única forma de repetir un paso que te hayas saltado.',
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
