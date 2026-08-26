'use client'
import { BLU, RED, GRN, VIO, AMBAR, BORDER } from '@/components/shared/design-tokens'

// ─────────────────────────────────────────────────────────────────────────────
// LAS MINIATURAS DEL RECORRIDO
//
// Son maquetas dibujadas con divs, no capturas. Tres motivos, y el tercero es el
// que decide:
//
// 1. Una captura de esta app hay que hacerla con la sesión iniciada, y las
//    pantallas llevan datos reales del estudio: correos, clientes, importes.
//    Nada de eso debe viajar dentro del recorrido de bienvenida.
// 2. Una captura envejece sola. La primera vez que se mueva un botón, la
//    bienvenida enseña una app que ya no existe y nadie se entera.
// 3. Pesan. Diez capturas a retina son megas dentro de un bundle que se sirve
//    también por móvil, y esto se ve UNA vez por persona.
//
// El precedente es `BocetoPanel.tsx`, que dibuja Instagram y LinkedIn igual.
//
// REGLA DE COLOR: todo lo que concatene opacidad (`${c}1A`) tiene que salir de
// una base HEX. Con rgba() el navegador descarta la declaración entera y la
// miniatura se pinta en negro sobre negro, sin error en consola. Es la mina que
// CLAUDE.md dice que ha mordido nueve veces.
// ─────────────────────────────────────────────────────────────────────────────

/** El marco común. Todas miden lo mismo para que el recorrido no dé saltos. */
export const Lienzo = ({ children }: { children: React.ReactNode }) => (
  // `nx-noinvert` a proposito. El modo claro de esta app es un
  // `filter: invert(1) hue-rotate(180deg)` sobre el body entero, y CLAUDE.md ya
  // explica por que ahi los colores de marca se hunden y por que no hay
  // parametro que lo arregle. Una maqueta es una FOTO de una pantalla oscura:
  // invertirla no la adapta al modo claro, la estropea — el orbe azul salia
  // celeste sobre blanco y las pastillas desaparecian.
  //
  // Cancelar el filtro es justo el unico remedio que la documentacion da por
  // bueno, y aqui sale gratis porque lo de dentro YA esta pensado para fondo
  // oscuro. Solo se cancela en el recuadro: el texto de alrededor sigue
  // invirtiendose con el resto de la ventana.
  <div className="relative w-full overflow-hidden rounded-xl nx-noinvert"
    style={{ height: '132px', background: '#050510', border: `1px solid ${BORDER}` }}>
    {children}
  </div>
)

/** El halo azul que hace que una pantalla de Nexus parezca encendida. */
export const Halo = () => (
  <div className="absolute inset-0 pointer-events-none"
    style={{ background: `radial-gradient(ellipse 140% 90% at 70% -20%, ${BLU}14, transparent 65%)` }} />
)

/** Hoy: la portada, con el orbe de Harvey en el centro. */
export function MiniHoy() {
  return (
    <Lienzo>
      <Halo />
      <div className="relative h-full flex flex-col items-center justify-center gap-2">
        <div className="flex gap-1.5">
          {[{ n: '3 URG', c: RED }, { n: '7 TAREAS', c: BLU }, { n: '2 HOY', c: AMBAR }].map(p => (
            <div key={p.n} className="px-1.5 py-0.5 rounded-full font-syne text-[5px] font-black tracking-wide"
              style={{ background: `${p.c}1A`, border: `1px solid ${p.c}3D`, color: p.c }}>{p.n}</div>
          ))}
        </div>
        <div className="relative flex items-center justify-center" style={{ width: '50px', height: '50px' }}>
          <div className="absolute rounded-full" style={{ inset: '-11px', background: `${BLU}24`, filter: 'blur(9px)' }} />
          <div className="absolute rounded-full" style={{ inset: '-5px', border: `1px dashed ${BLU}47`, transform: 'rotate(24deg) scaleY(0.4)' }} />
          <div className="absolute rounded-full" style={{ inset: '-5px', border: `1px dashed ${BLU}2E`, transform: 'rotate(-38deg) scaleY(0.4)' }} />
          <div className="relative rounded-full" style={{ width: '50px', height: '50px', border: `1px solid ${BLU}5C`, background: `radial-gradient(circle at 34% 28%, ${BLU}B3, ${BLU}38 58%, transparent 72%)` }} />
          <div className="absolute flex items-end gap-[1.5px]" style={{ height: '9px' }}>
            {[4, 8, 5, 9, 3].map((h, i) => (
              <div key={i} className="rounded-full" style={{ width: '1.5px', height: `${h}px`, background: `${BLU}D9` }} />
            ))}
          </div>
        </div>
        <div className="font-syne text-[5.5px] font-black tracking-[0.3em]" style={{ color: `${BLU}CC` }}>HARVEY</div>
      </div>
    </Lienzo>
  )
}

/** Fichar: la tarjeta del día — el anillo de objetivos y el cronómetro de la jornada corriendo. */
export function MiniFichar() {
  // El morado del héroe de Fichar (el `VIO` de design-tokens). Va como hex literal
  // de 6 dígitos porque abajo se le concatena opacidad: con un rgba() de base el
  // navegador tira la declaración entera, sin error y sin nada en consola.
  const MORADO = '#8B5CF6'
  const objetivos = [
    { t: 'Montaje Nike', hecho: true },
    { t: 'Guion Zara', hecho: false },
  ]
  return (
    <Lienzo>
      <Halo />
      <div className="relative h-full p-2 flex flex-col gap-1.5">
        {/* El héroe: degradado violeta→azul y dos halos difuminados, como el de verdad. */}
        <div className="relative overflow-hidden rounded-lg flex items-center gap-2.5 px-2.5 py-2"
          style={{ background: `linear-gradient(120deg, ${MORADO}24 0%, ${BLU}14 45%, #0F0F1E 100%)`, border: `1px solid ${MORADO}30` }}>
          <div className="absolute pointer-events-none rounded-full"
            style={{ width: '46%', height: '190%', top: '-45%', right: '-6%', background: `radial-gradient(closest-side, ${MORADO}3D, transparent)`, filter: 'blur(12px)' }} />
          <div className="absolute pointer-events-none rounded-full"
            style={{ width: '30%', height: '150%', top: '-25%', right: '22%', background: `radial-gradient(closest-side, ${BLU}30, transparent)`, filter: 'blur(11px)' }} />

          {/* El anillo: un conic-gradient para el arco y un disco oscuro encima que lo vacía. */}
          <div className="relative flex-shrink-0" style={{ width: '44px', height: '44px' }}>
            <div className="absolute rounded-full" style={{ inset: '-5px', background: `${MORADO}2E`, filter: 'blur(7px)' }} />
            <div className="absolute inset-0 rounded-full"
              style={{ background: `conic-gradient(from -90deg, ${MORADO} 0turn 0.6turn, rgba(255,255,255,0.08) 0.6turn 1turn)` }} />
            <div className="absolute rounded-full" style={{ inset: '3px', background: '#0B0916' }} />
            <div className="absolute inset-0 flex items-center justify-center font-syne text-[9px] font-black" style={{ color: '#E6DEFF' }}>60%</div>
          </div>

          <div className="relative flex-1 min-w-0">
            <div className="font-syne text-[5px] font-black tracking-[0.22em]" style={{ color: 'rgba(255,255,255,0.4)' }}>MI DÍA</div>
            <div className="font-figtree text-[9px] font-bold text-white leading-tight mt-0.5 truncate" style={{ letterSpacing: '-0.02em' }}>3 de 5 objetivos</div>
            <div className="mt-1 inline-block px-1.5 py-0.5 rounded-full font-syne text-[5px] font-black tracking-[0.2em]"
              style={{ background: `${AMBAR}1E`, border: `1px solid ${AMBAR}3D`, color: AMBAR }}>EN MARCHA</div>
          </div>

          {/* El cronómetro, al otro lado de la línea, que es donde vive en la pantalla
              real. Los segundos van más pequeños y atenuados con `opacity`, igual que
              RelojJornada — nunca con un rgba() de base. */}
          <div className="relative flex-shrink-0 pl-2.5" style={{ borderLeft: `1px solid ${BORDER}` }}>
            <div className="font-syne text-[5px] font-black tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.3)' }}>EN LA OFICINA</div>
            <div className="font-figtree font-black text-white whitespace-nowrap"
              style={{ fontSize: '13px', lineHeight: 1.15, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
              2:14<span style={{ fontSize: '8px', opacity: 0.55 }}>:30</span>
            </div>
            <div className="font-figtree text-[5.5px]" style={{ color: 'rgba(255,255,255,0.35)' }}>desde las 9:12</div>
          </div>

          {/* La única acción de la pantalla cuando el reloj corre. */}
          <div className="relative flex-shrink-0 px-1.5 py-1 rounded font-syne text-[5px] font-black tracking-[0.2em]"
            style={{ background: `${MORADO}18`, border: `1px solid ${MORADO}42`, color: '#E6DEFF' }}>TERMINAR</div>
        </div>

        {/* Los objetivos del día, debajo del héroe: ahí es donde están de verdad. */}
        <div className="flex flex-col gap-1">
          {objetivos.map(o => (
            <div key={o.t} className="flex items-center gap-1.5 px-1.5 py-[3px] rounded"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="rounded-full flex-shrink-0"
                style={{ width: '4px', height: '4px', background: o.hecho ? GRN : 'transparent', border: o.hecho ? 'none' : `1px solid ${MORADO}8A` }} />
              <div className="font-figtree text-[5.5px] truncate"
                style={{ color: o.hecho ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.72)', textDecoration: o.hecho ? 'line-through' : 'none' }}>{o.t}</div>
            </div>
          ))}
        </div>
      </div>
    </Lienzo>
  )
}

/** Tareas: los cuatro recuentos, el progreso de la semana y la lista debajo. */
export function MiniTareas() {
  return (
    <Lienzo>
      <Halo />
      <div className="relative h-full flex flex-col gap-1" style={{ padding: '6px' }}>
        {/* Los cuatro recuentos, con los rótulos y colores de la sección real */}
        <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
          {[{ n: '12', l: 'PENDIENTES', c: '#6495FF' },
            { n: '4', l: 'PARA HOY', c: AMBAR },
            { n: '2', l: 'ATRASADAS', c: RED },
            { n: '9', l: 'COMPLETADAS', c: GRN }].map(s => (
            <div key={s.l} className="rounded py-1 flex flex-col items-center justify-center"
              style={{ background: `${s.c}12`, border: `1px solid ${s.c}2B` }}>
              <div className="font-figtree text-[13px] font-black leading-none" style={{ color: s.c }}>{s.n}</div>
              <div className="font-syne text-[5px] font-black tracking-[0.08em] leading-none mt-0.5 whitespace-nowrap"
                style={{ color: 'rgba(255,255,255,0.34)' }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Progreso semanal: rótulo y cifra a la izquierda, barra ocupando el resto */}
        <div className="flex items-center gap-2 rounded px-1.5 py-1"
          style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex-shrink-0">
            <div className="font-syne text-[5px] font-black tracking-[0.14em] leading-none whitespace-nowrap"
              style={{ color: 'rgba(255,255,255,0.28)' }}>PROGRESO SEMANAL</div>
            <div className="font-figtree text-[9px] font-black leading-none text-white mt-0.5">
              68<span className="text-[5.5px] font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>%</span>
            </div>
          </div>
          <div className="flex-1 rounded-full overflow-hidden" style={{ height: '3px', background: 'rgba(255,255,255,0.06)' }}>
            <div className="h-full rounded-full" style={{ width: '68%', background: `linear-gradient(90deg, ${BLU}, ${GRN})` }} />
          </div>
        </div>

        {/* La lista: UNA tarjeta con filas separadas y el filo de color de la
            prioridad, como en la pantalla. Va en flex-1 con el desbordamiento
            oculto: lo que no cabe se corta por abajo, que es lo que hace una
            lista de verdad — y así ningún cálculo de altura puede romperla. */}
        <div className="flex-1 min-h-0 overflow-hidden rounded-lg"
          style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
          {[{ t: 'Montaje reel Nike', p: 'URGENTE', pc: RED, i: 'L', ic: '#A78BFA' },
            { t: 'Guion campaña Zara', p: 'ALTA', pc: AMBAR, i: 'M', ic: '#6495FF' },
            { t: 'Color corto Laura P.', p: 'NORMAL', pc: BLU, i: 'J', ic: GRN }].map((f, k) => (
            <div key={f.t} className="flex items-center gap-1.5 px-1.5"
              style={{ height: '17px', borderTop: k === 0 ? undefined : '1px solid rgba(255,255,255,0.05)', borderLeft: `2px solid ${f.pc}70` }}>
              <div className="rounded-full flex-shrink-0"
                style={{ width: '7px', height: '7px', border: `1px solid ${f.pc}80` }} />
              <div className="font-figtree text-[7px] leading-none flex-1 min-w-0 truncate" style={{ color: 'rgba(240,240,248,0.92)' }}>{f.t}</div>
              <div className="font-syne text-[5px] font-black leading-none tracking-[0.1em] px-1 rounded flex-shrink-0"
                style={{ paddingTop: '2px', paddingBottom: '2px', background: `${f.pc}1F`, color: f.pc }}>{f.p}</div>
              <div className="rounded-full flex items-center justify-center font-syne text-[5px] font-black leading-none flex-shrink-0"
                style={{ width: '9px', height: '9px', background: `${f.ic}2E`, color: f.ic }}>{f.i}</div>
            </div>
          ))}
        </div>
      </div>
    </Lienzo>
  )
}

/** Inbox: los filtros con recuento y, bajo cada asunto, el resumen que escribe la IA en azul. */
export function MiniInbox() {
  // Cuatro filtros y no los cinco de la app. Medidos: los cinco piden 220px de ancho
  // y la miniatura mide 248 en el móvil más estrecho — 28px de margen que se come
  // cualquier `sans-serif` de sistema más ancha que la de macOS, y el `overflow-hidden`
  // del Lienzo cortaría el último sin avisar. Con cuatro pide 184. Sobra PERSONAL:
  // su rojo (#EA4335) y el de URGENTE son el mismo rojo a 5px.
  const filtros = [{ l: 'TODOS', n: '12', c: '#FFFFFF' }, { l: 'SIN LEER', n: '4', c: BLU }, { l: 'URGENTE', n: '2', c: RED }, { l: 'COLABS', n: '3', c: GRN }]
  const correos = [
    { ini: 'NK', de: 'Nike Iberia', urg: true, etiq: '', ec: RED, av: AMBAR, barra: RED, asunto: 'Cambios en el montaje', ia: 'Piden el corte final antes del viernes.' },
    { ini: 'ZR', de: 'Zara Studio', urg: false, etiq: 'COLABS', ec: GRN, av: GRN, barra: GRN, asunto: 'Presupuesto de campaña', ia: 'Aprueban el presupuesto y piden fechas.' },
    { ini: 'LP', de: 'Laura P.', urg: false, etiq: '', ec: BLU, av: '#A78BFA', barra: `${BLU}66`, asunto: 'Facturas de agosto', ia: 'Adjunta tres facturas por firmar.' },
  ]
  return (
    <Lienzo>
      <Halo />
      <div className="relative h-full flex flex-col">
        {/* La fila de filtros con su recuento: es lo que hace que se lea como una bandeja. */}
        <div className="flex items-center gap-1 px-2 pt-[5px] pb-1">
          {filtros.map(f => (
            <div key={f.l} className="flex items-center gap-[2px] px-1 py-0.5 rounded-full font-syne text-[5px] font-black tracking-wide whitespace-nowrap flex-shrink-0"
              style={{ background: `${f.c}14`, border: `1px solid ${f.c}33`, color: `${f.c}E0` }}>
              <span>{f.l}</span><span style={{ color: `${f.c}80` }}>{f.n}</span>
            </div>
          ))}
        </div>
        {/* Cada correo: barra de color pegada al borde, iniciales, asunto y —lo característico—
            el resumen azul que escribe la IA, que en la app real va justo ahí y de ese color. */}
        {correos.map(m => (
          <div key={m.ini} className="flex items-start gap-1.5 px-2 py-[6px]"
            style={{ borderLeft: `2px solid ${m.barra}`, borderBottom: `1px solid ${BORDER}`, background: m.urg ? `${RED}0F` : 'transparent' }}>
            <div className="rounded-full flex items-center justify-center flex-shrink-0 font-syne text-[5px] font-black"
              style={{ width: '14px', height: '14px', marginTop: '1px', background: `${m.av}26`, color: m.av }}>{m.ini}</div>
            <div className="flex-1 min-w-0">
              {/* `leading-none` aquí no es estética: sin él las tres líneas suman 129 de los 132
                  del Lienzo, y lo que se pierde al recortar es justo el resumen de la IA. */}
              <div className="flex items-center gap-1 leading-none">
                <span className="font-syne text-[5.5px] font-black tracking-wide truncate flex-1 min-w-0" style={{ color: 'rgba(255,255,255,0.85)' }}>{m.de}</span>
                {m.etiq ? <span className="font-syne text-[5px] font-black px-1 rounded-full flex-shrink-0" style={{ background: `${m.ec}1F`, color: m.ec }}>{m.etiq}</span> : null}
                {m.urg ? <span className="font-syne text-[5px] font-black px-1 rounded-full flex-shrink-0" style={{ background: `${RED}1F`, color: RED }}>URG</span> : null}
                <span className="font-syne text-[5px] flex-shrink-0" style={{ color: 'rgba(255,255,255,0.22)' }}>9:41</span>
              </div>
              <div className="font-figtree text-[7px] font-semibold leading-tight truncate" style={{ color: 'rgba(255,255,255,0.9)' }}>{m.asunto}</div>
              <div className="font-figtree text-[6px] leading-tight truncate" style={{ color: 'rgba(138,170,255,0.85)' }}>{m.ia}</div>
            </div>
          </div>
        ))}
      </div>
    </Lienzo>
  )
}

/** Calendario: la rejilla del mes de lunes a domingo, con hoy anillado, el día elegido en azul y un puntito por cada cosa que pasa. */
export function MiniCalendario() {
  // El morado de Google Calendar, el mismo '#a78bfa' que pinta CalendarioSection.
  // Va como HEX de 6 dígitos porque es base de color en una miniatura.
  const GCAL = '#A78BFA'
  const HOY = 13
  const SEL = 21
  // Octubre de 2026 de verdad: empieza en jueves y cabe justo en cinco filas.
  // Si cambias el rótulo de mes, cambia también los huecos o la rejilla miente.
  const semanas: (number | null)[][] = [
    [null, null, null, 1, 2, 3, 4],
    [5, 6, 7, 8, 9, 10, 11],
    [12, 13, 14, 15, 16, 17, 18],
    [19, 20, 21, 22, 23, 24, 25],
    [26, 27, 28, 29, 30, 31, null],
  ]
  // Los cuatro colores de evento de la sección real: GCAL = Google Calendar ·
  // BLU = contenido a publicar · AMBAR = tarea con deadline · GRN = proyecto.
  const puntos: Record<number, string[]> = {
    3: [GCAL], 5: [BLU], 6: [GCAL, GRN], 8: [AMBAR], 11: [BLU],
    12: [GCAL], 13: [GCAL, BLU, AMBAR], 15: [GRN], 18: [BLU, AMBAR], 19: [GCAL],
    21: [BLU, GRN], 22: [GCAL], 25: [AMBAR], 26: [BLU], 28: [GCAL, GRN], 30: [BLU],
  }
  return (
    <Lienzo>
      <Halo />
      <div className="relative h-full flex flex-col px-2.5 py-2">
        <div className="flex items-center justify-between mb-1">
          <div className="font-figtree text-[8px] font-black leading-none" style={{ color: 'rgba(255,255,255,0.88)' }}>
            Octubre <span style={{ color: 'rgba(255,255,255,0.32)' }}>2026</span>
          </div>
          <div className="px-1.5 py-[1px] rounded-full font-syne text-[5px] font-black tracking-[0.2em] leading-none"
            style={{ background: `${BLU}1F`, color: BLU }}>HOY</div>
        </div>
        <div className="grid grid-cols-7 mb-[3px]">
          {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d, i) => (
            <div key={`${d}${i}`} className="text-center font-syne text-[5.5px] font-black tracking-[0.2em] leading-none"
              style={{ color: i >= 5 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.38)' }}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-[2px]">
          {semanas.flat().map((dia, i) => {
            const finde = i % 7 >= 5
            const esHoy = dia === HOY
            const esSel = dia === SEL
            const ps = dia === null ? [] : (puntos[dia] ?? [])
            return (
              <div key={i} className="flex flex-col items-center gap-[1.5px]">
                <div className="rounded-full flex items-center justify-center"
                  style={{
                    width: '12px', height: '12px',
                    background: esSel ? BLU : esHoy ? `${BLU}1F` : 'transparent',
                    border: `1px solid ${esHoy ? `${BLU}B3` : 'transparent'}`,
                  }}>
                  {dia !== null && (
                    <span className="font-figtree text-[6.5px] font-black leading-none"
                      style={{ color: esSel ? '#FFFFFF' : esHoy ? BLU : finde ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.72)' }}>{dia}</span>
                  )}
                </div>
                <div className="flex items-center justify-center gap-[1.5px]" style={{ height: '3px' }}>
                  {ps.map((c, j) => (
                    <div key={`${i}-${j}`} className="rounded-full" style={{ width: '3px', height: '3px', background: c }} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Lienzo>
  )
}

/** Clientes: el MRR total en grande, el reparto por cliente en barras y los filtros de estado. */
export function MiniClientes() {
  return (
    <Lienzo>
      <Halo />
      <div className="relative h-full flex flex-col p-2 gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="font-syne text-[5px] font-black tracking-[0.25em]" style={{ color: 'rgba(255,255,255,0.25)' }}>GESTIÓN</div>
            <div className="font-figtree text-[9px] font-black leading-none text-white" style={{ letterSpacing: '-0.03em' }}>Clientes</div>
          </div>
          <div className="flex-shrink-0 px-1.5 py-0.5 rounded-full font-syne text-[5px] font-black tracking-wide text-white"
            style={{ background: `linear-gradient(135deg, ${BLU}, #1440CC)` }}>+ NUEVO CLIENTE</div>
        </div>
        <div className="flex-1 min-h-0 flex gap-1.5">
          <div className="flex-shrink-0 rounded-lg px-2 py-1.5 flex flex-col justify-center"
            style={{ width: '40%', background: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDER}` }}>
            <div className="font-syne text-[5px] font-black tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.28)' }}>MRR TOTAL</div>
            <div className="font-figtree text-[13px] font-black leading-none text-white mt-1 whitespace-nowrap" style={{ letterSpacing: '-0.02em' }}>€12.400</div>
            <div className="font-figtree text-[5.5px] mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>4 clientes activos</div>
          </div>
          <div className="flex-1 min-w-0 rounded-lg px-2 py-1.5 flex flex-col justify-center"
            style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDER}` }}>
            <div className="font-syne text-[5px] font-black tracking-[0.2em] mb-1" style={{ color: 'rgba(255,255,255,0.28)' }}>REVENUE POR CLIENTE</div>
            <div className="flex flex-col gap-[5px]">
              {[{ n: 'Nike', v: '4.800', c: BLU, w: '100%' },
                { n: 'Zara', v: '3.200', c: '#F97316', w: '67%' },
                { n: 'Mahou', v: '2.600', c: '#A78BFA', w: '54%' },
                { n: 'Cabify', v: '1.800', c: '#06B6D4', w: '38%' }].map(b => (
                <div key={b.n} className="flex items-center gap-1.5">
                  <div className="font-syne text-[5px] font-black w-[26px] flex-shrink-0 truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>{b.n}</div>
                  <div className="flex-1 min-w-0 rounded-full overflow-hidden" style={{ height: '3px', background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-full rounded-full" style={{ width: b.w, background: `linear-gradient(90deg, ${b.c}, ${b.c}88)` }} />
                  </div>
                  <div className="font-syne text-[5px] font-black w-[24px] flex-shrink-0 text-right" style={{ color: b.c }}>€{b.v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-1">
          {[{ n: 'TODOS', bg: 'rgba(255,255,255,0.07)', bd: 'rgba(255,255,255,0.12)', fg: 'rgba(255,255,255,0.8)' },
            { n: 'ACTIVO', bg: `${GRN}1A`, bd: `${GRN}3D`, fg: GRN },
            { n: 'PAUSADO', bg: `${AMBAR}1A`, bd: `${AMBAR}3D`, fg: AMBAR }].map(p => (
            <div key={p.n} className="px-1.5 py-0.5 rounded-full font-syne text-[5px] font-black tracking-wide"
              style={{ background: p.bg, border: `1px solid ${p.bd}`, color: p.fg }}>{p.n}</div>
          ))}
        </div>
      </div>
    </Lienzo>
  )
}

/** Proyectos: el tablero, con las cinco columnas de estado y el anillo de progreso de cada ficha. */
export function MiniProyectos() {
  // Los títulos y los colores son los de `shared/kanban.ts`. El color de cada ficha
  // es el SUYO (`p.color`), no el de su columna: así se pinta el tablero de verdad.
  const columnas = [
    { t: 'PLAN.', n: '2', c: '#F0F0F8', fichas: [{ n: 'Nike', p: 15, c: BLU }, { n: 'Zara', p: 5, c: '#A78BFA' }] },
    { t: 'PROG.', n: '2', c: BLU, fichas: [{ n: 'Mango', p: 62, c: '#06B6D4' }, { n: 'Loewe', p: 34, c: BLU }] },
    { t: 'URG.', n: '1', c: RED, fichas: [{ n: 'Boss', p: 78, c: RED }] },
    { t: 'REV.', n: '1', c: AMBAR, fichas: [{ n: 'IKEA', p: 92, c: '#F97316' }] },
    { t: 'HECHO', n: '2', c: GRN, fichas: [{ n: 'Puma', p: 100, c: GRN }, { n: 'Vans', p: 100, c: GRN }] },
  ]
  return (
    <Lienzo>
      <Halo />
      <div className="relative h-full flex flex-col px-2 py-1.5">
        <div className="flex items-center justify-between gap-1.5">
          <span className="font-syne text-[5.5px] font-black leading-none tracking-[0.3em]" style={{ color: 'rgba(240,240,248,0.5)' }}>PROYECTOS</span>
          <span className="flex gap-[2px] p-[1px] rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <span className="px-1.5 py-[2px] rounded-full font-syne text-[5px] font-black leading-none tracking-[0.15em]" style={{ background: `${BLU}2E`, color: BLU }}>TABLERO</span>
            <span className="px-1.5 py-[2px] rounded-full font-syne text-[5px] font-black leading-none tracking-[0.15em]" style={{ color: 'rgba(255,255,255,0.22)' }}>LISTA</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5 pt-1 pb-[5px] font-syne text-[5px] font-black leading-none tracking-[0.1em]">
          <span className="block rounded-full overflow-hidden flex-shrink-0" style={{ width: '16px', height: '2px', background: 'rgba(255,255,255,0.07)' }}>
            <span className="block h-full rounded-full" style={{ width: '58%', background: `linear-gradient(90deg, ${BLU}80, ${BLU})` }} />
          </span>
          <span style={{ color: 'rgba(255,255,255,0.3)' }}>58% AVG ACTIVOS</span>
          <span style={{ color: `${RED}99` }}>1 ATRASADO</span>
          <span style={{ color: 'rgba(255,255,255,0.16)' }}>2 COMPLETADOS</span>
        </div>
        <div className="flex-1 grid gap-1" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
          {columnas.map(col => (
            <div key={col.t} className="min-w-0 flex flex-col overflow-hidden rounded-lg"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', opacity: col.t === 'HECHO' ? 0.62 : 1 }}>
              <div style={{ height: '2px', background: `linear-gradient(90deg, ${col.c}B3, transparent)` }} />
              <div className="flex items-center gap-[2px] p-[3px]" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="rounded-full flex-shrink-0" style={{ width: '3px', height: '3px', background: col.c, boxShadow: `0 0 4px ${col.c}A6` }} />
                <span className="font-syne text-[5px] font-black leading-none tracking-[0.06em] flex-1 min-w-0 truncate" style={{ color: 'rgba(255,255,255,0.42)' }}>{col.t}</span>
                <span className="font-syne text-[5px] font-black leading-none px-[2px] rounded-full flex-shrink-0" style={{ background: `${col.c}1F`, color: `${col.c}B3` }}>{col.n}</span>
              </div>
              <div className="flex flex-col gap-[3px] p-[3px]">
                {col.fichas.map(f => (
                  <div key={f.n} className="rounded overflow-hidden" style={{ background: '#0F0F1E', border: `1px solid ${BORDER}` }}>
                    <div style={{ height: '2px', background: `linear-gradient(90deg, ${f.c}A6, ${f.c}2E, transparent)` }} />
                    <div className="flex items-center gap-[3px] min-w-0 px-[3px] py-[4px]">
                      <div className="relative flex-shrink-0" style={{ width: '15px', height: '15px' }}>
                        <div className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(${f.c} ${f.p}%, rgba(255,255,255,0.10) 0)` }} />
                        <div className="absolute rounded-full" style={{ inset: '2px', background: '#0F0F1E' }} />
                        <div className="absolute inset-0 flex items-center justify-center font-syne text-[5px] font-black leading-none" style={{ color: `${f.c}E6` }}>{f.p}</div>
                      </div>
                      <span className="font-figtree text-[5.5px] font-semibold leading-none flex-1 min-w-0 truncate" style={{ color: 'rgba(240,240,248,0.85)' }}>{f.n}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Lienzo>
  )
}

/** Contenido: el tablero de piezas, cada tarjeta con el color de su plataforma. */
export function MiniContenido() {
  const TT = '#ff0050', IG = '#C13584', YT = '#FF0000'
  const columnas = [
    { t: 'EN BRUTO', c: '#FFFFFF', piezas: [{ p: TT, t: 'Nike' }, { p: IG, t: 'Zara' }, { p: YT, t: 'Teaser' }] },
    { t: 'EN PROD.', c: AMBAR, piezas: [{ p: YT, t: 'Laura P.' }, { p: TT, t: 'Reto 04' }, { p: IG, t: 'Backstage' }] },
    { t: 'LISTO', c: GRN, piezas: [{ p: IG, t: 'Carrusel' }, { p: TT, t: 'Corte 12' }] },
    { t: 'PUBLICADO', c: BLU, piezas: [{ p: IG, t: 'Zara' }, { p: YT, t: 'Vlog 03' }] },
  ]
  return (
    <Lienzo>
      <Halo />
      <div className="relative h-full flex flex-col p-2 gap-1.5">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-syne text-[5px] font-black tracking-[0.25em]" style={{ color: 'rgba(255,255,255,0.25)' }}>PRODUCCIÓN</div>
            <div className="font-figtree text-[9px] font-black leading-none text-white" style={{ letterSpacing: '-0.03em' }}>Contenido</div>
          </div>
          <div className="px-1.5 py-0.5 rounded-full font-syne text-[5px] font-black tracking-wide text-white"
            style={{ background: `linear-gradient(135deg, ${BLU}, #1440CC)` }}>+ PIEZA</div>
        </div>
        <div className="flex-1 grid grid-cols-4 gap-1">
          {columnas.map(col => (
            <div key={col.t} className="min-w-0 flex flex-col gap-[4px] overflow-hidden rounded-lg p-[3px]"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-[3px] min-w-0">
                <div className="rounded-full flex-shrink-0" style={{ width: '3px', height: '3px', background: col.c }} />
                <span className="font-syne text-[5px] font-black tracking-wide truncate" style={{ color: `${col.c}8C` }}>{col.t}</span>
                <span className="font-syne text-[5px] font-black ml-auto flex-shrink-0" style={{ color: `${col.c}59` }}>{col.piezas.length}</span>
              </div>
              {col.piezas.map(pz => (
                <div key={pz.t} className="rounded px-[4px] py-[3px] overflow-hidden"
                  style={{ background: `${pz.p}14`, border: `1px solid ${pz.p}2E`, borderLeft: `2px solid ${pz.p}` }}>
                  <div className="flex items-center gap-[3px] min-w-0">
                    <div className="rounded-full flex-shrink-0" style={{ width: '3px', height: '3px', background: pz.p }} />
                    <span className="font-figtree text-[5.5px] font-semibold leading-none truncate" style={{ color: 'rgba(255,255,255,0.8)' }}>{pz.t}</span>
                  </div>
                  <div className="h-[2px] rounded-full mt-[3px]" style={{ background: 'rgba(255,255,255,0.09)' }} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Lienzo>
  )
}

/** Brutal.IA: el chat escrito. Cabecera canónica, dos burbujas y el campo de abajo. */
export function MiniChat() {
  return (
    <Lienzo>
      <Halo />
      <div className="relative h-full flex flex-col p-2 gap-1.5">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-syne text-[5px] font-black tracking-[0.25em]" style={{ color: 'rgba(255,255,255,0.25)' }}>IA</div>
            <div className="font-figtree text-[9px] font-black leading-none text-white" style={{ letterSpacing: '-0.03em' }}>Brutal.IA</div>
          </div>
          <div className="px-1.5 py-0.5 rounded-full font-syne text-[5px] font-black tracking-wide"
            style={{ border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.28)' }}>LIMPIAR</div>
        </div>
        <div className="flex-1 flex flex-col justify-center gap-1.5">
          <div className="flex justify-end">
            <div className="px-1.5 py-1 rounded font-figtree text-[6px] leading-none"
              style={{ background: `${BLU}2E`, border: `1px solid ${BLU}47`, borderTopRightRadius: '1px', color: 'rgba(255,255,255,0.88)' }}>¿Qué tengo hoy?</div>
          </div>
          <div className="flex items-start gap-1">
            <div className="rounded flex items-center justify-center flex-shrink-0"
              style={{ width: '9px', height: '9px', marginTop: '1px', background: `${BLU}2E`, border: `1px solid ${BLU}4D` }}>
              <div className="rounded-full" style={{ width: '3px', height: '3px', background: `${BLU}D9` }} />
            </div>
            <div className="px-1.5 py-1 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderTopLeftRadius: '2px', maxWidth: '76%' }}>
              <div className="font-figtree text-[6px] leading-[1.6]" style={{ color: 'rgba(255,255,255,0.72)' }}>3 tareas urgentes y la entrega de Nike.</div>
              <div className="font-figtree text-[6px] leading-[1.6]" style={{ color: 'rgba(255,255,255,0.45)' }}>Laura P. espera tu revisión.</div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-1.5 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BLU}29` }}>
          <div className="flex-1 font-figtree text-[6px]" style={{ color: 'rgba(255,255,255,0.3)' }}>Pregunta a Brutal.IA…</div>
          <div className="rounded flex items-center justify-center flex-shrink-0" style={{ width: '11px', height: '11px', background: `linear-gradient(135deg, ${BLU}, #1440CC)` }}>
            <div style={{ width: 0, height: 0, marginLeft: '1px', borderTop: '2.5px solid transparent', borderBottom: '2.5px solid transparent', borderLeft: '4px solid #FFFFFF' }} />
          </div>
        </div>
      </div>
    </Lienzo>
  )
}

/** Operativa: la trastienda —pestañas arriba, ajustes con interruptor debajo. */
export function MiniOperativa() {
  const pestanas = [
    { t: 'PERFIL', act: false },
    { t: 'NOTIFICACIONES', act: true },
    { t: 'SINCRONIZACIÓN', act: false },
    { t: 'EQUIPO', act: false },
  ]
  const ajustes = [
    { n: 'Tareas tuyas', d: 'Cuando te asignan una', on: true },
    { n: 'Mensajes del equipo', d: 'Alguien te escribe', on: true },
    { n: 'Correo nuevo', d: 'Bandeja compartida', on: false },
  ]
  return (
    <Lienzo>
      <Halo />
      <div className="relative h-full flex flex-col p-2">
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="font-syne text-[5px] font-black tracking-[0.25em] leading-none" style={{ color: 'rgba(255,255,255,0.22)' }}>CONFIGURACIÓN</div>
            <div className="font-figtree text-[9px] font-black text-white leading-none mt-[2px]" style={{ letterSpacing: '-0.03em' }}>Operativa</div>
          </div>
          <div className="flex items-center gap-[3px] px-1.5 py-0.5 rounded-full font-syne text-[5px] font-black tracking-wide"
            style={{ background: `${GRN}1A`, border: `1px solid ${GRN}3D`, color: GRN }}>
            <div className="rounded-full" style={{ width: '3px', height: '3px', background: GRN }} />
            ACTIVOS
          </div>
        </div>

        <div className="flex items-end gap-[3px] overflow-hidden flex-shrink-0" style={{ borderBottom: `1px solid ${BORDER}` }}>
          {pestanas.map(p => (
            <div key={p.t}
              className="flex items-center gap-[3px] px-1.5 flex-shrink-0 whitespace-nowrap rounded-t font-syne text-[5px] font-black tracking-[0.12em] leading-none"
              style={{
                paddingTop: '3px', paddingBottom: '3px', marginBottom: '-1px',
                background: p.act ? 'rgba(255,255,255,0.06)' : 'transparent',
                color: p.act ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.22)',
                borderBottom: p.act ? `1.5px solid ${BLU}` : '1.5px solid transparent',
              }}>
              <div className="rounded-full" style={{ width: '3px', height: '3px', background: p.act ? BLU : 'rgba(255,255,255,0.18)' }} />
              {p.t}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-[3px] mt-1.5">
          {ajustes.map(a => (
            <div key={a.n} className="flex items-center gap-1.5 rounded-lg px-1.5 flex-shrink-0"
              style={{ height: '22px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDER}` }}>
              <div className="rounded-full flex items-center flex-shrink-0"
                style={{
                  width: '15px', height: '8px', padding: '1px',
                  justifyContent: a.on ? 'flex-end' : 'flex-start',
                  background: a.on ? BLU : 'rgba(255,255,255,0.12)',
                }}>
                <div className="rounded-full" style={{ width: '6px', height: '6px', background: a.on ? '#FFFFFF' : 'rgba(255,255,255,0.45)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-figtree text-[6.5px] font-bold leading-none truncate" style={{ color: a.on ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.4)' }}>{a.n}</div>
                <div className="font-figtree text-[5.5px] leading-none truncate mt-[2px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{a.d}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Lienzo>
  )
}
