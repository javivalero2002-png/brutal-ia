'use client'
import LucideIcon from './LucideIcon'
import { BORDER } from './design-tokens'

// ─────────────────────────────────────────────────────────────────────────────
// Las piezas que las secciones repiten.
//
// Se extraen ANTES de rediseñar Brutal.IA, Harvey y el briefing, no después: las
// tres necesitan lo mismo, y resolverlo tres veces es cómo se acaba con tres
// rediseños que no se parecen entre sí. Este repo ya tiene historial de eso.
//
// NO es un design system. CLAUDE.md descarta extraer uno, y con razón: aquello
// hablaba de una abstracción especulativa sobre ~127 líneas duplicadas. Esto es lo
// contrario — duplicación concreta, contada, y que el rediseño va a multiplicar:
// la cabecera está copiada en once secciones, el «chip» tiene cinco gramáticas
// distintas para el mismo objeto.
//
// BENEFICIO LATERAL que vale por sí solo: el color entra por prop desde
// `design-tokens`, así que la concatenación de opacidad (`color + '18'`) ocurre en
// UN sitio. Hoy la regla del hex hay que recordarla en cada fichero.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La cabecera de una sección. Está copiada literalmente en once secciones, y las
 * tres que hay que rediseñar son justo las que NO la siguen — que es buena parte
 * de por qué se sienten «de otra app».
 */
export function CabeceraSeccion({ kicker, titulo, bajada, acciones, isMobile }: {
  kicker: string
  titulo: string
  bajada?: string
  acciones?: React.ReactNode
  isMobile?: boolean
}) {
  return (
    <div className={`flex items-end justify-between gap-3 flex-wrap ${isMobile ? 'mb-5' : 'mb-8'}`}>
      <div className="min-w-0">
        <div className="font-syne text-[9px] font-black tracking-[0.25em] mb-2" style={{ color: 'rgba(255,255,255,0.18)' }}>
          {kicker}
        </div>
        <h1 className="font-figtree font-black text-white leading-none"
          style={{ fontSize: isMobile ? '22px' : '26px', letterSpacing: '-0.03em' }}>
          {titulo}
        </h1>
        {bajada && (
          <p className="font-figtree mt-2" style={{ fontSize: '13px', color: 'rgba(255,255,255,0.35)' }}>
            {bajada}
          </p>
        )}
      </div>
      {acciones && <div className="flex items-center gap-2 flex-wrap">{acciones}</div>}
    </div>
  )
}

/**
 * Una pastilla. Hoy hay cinco gramáticas distintas para el mismo objeto.
 *
 * `color` DEBE ser hex: se le concatena el alfa aquí dentro. Con un `rgba()` el
 * navegador descarta la declaración y el chip se pinta sin fondo ni borde, sin
 * error en consola. Por eso este es el único sitio donde se hace la concatenación.
 */
export function Chip({ children, color, icono, activo, onClick, title }: {
  children: React.ReactNode
  /** Hex, siempre. Si no se pasa, el chip es neutro. */
  color?: string
  icono?: string
  activo?: boolean
  onClick?: () => void
  title?: string
}) {
  const tenido = !!color && (activo ?? true)
  const Etiqueta = onClick ? 'button' : 'span'
  return (
    <Etiqueta
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-syne text-[8.5px] font-black tracking-widest whitespace-nowrap ${onClick ? 'transition-all hover:opacity-80 active:scale-95' : ''}`}
      style={{
        background: tenido ? `${color}14` : 'rgba(255,255,255,0.04)',
        border: `1px solid ${tenido ? `${color}30` : BORDER}`,
        color: tenido ? color : 'rgba(255,255,255,0.4)',
      }}>
      {icono && <LucideIcon name={icono} size={10} color={tenido ? color : 'rgba(255,255,255,0.35)'} />}
      {children}
    </Etiqueta>
  )
}

/**
 * Un número grande con su etiqueta. Está en los contadores de Harvey, en los chips
 * de recuento del chat y en los KPIs del briefing, con tres tamaños distintos.
 */
export function Metrica({ valor, etiqueta, color, onClick }: {
  valor: React.ReactNode
  etiqueta: string
  /** Hex. */
  color?: string
  onClick?: () => void
}) {
  const Etiqueta = onClick ? 'button' : 'div'
  return (
    <Etiqueta onClick={onClick}
      className={`text-left ${onClick ? 'transition-all hover:opacity-80 active:scale-[0.98]' : ''}`}>
      <div className="font-figtree font-black leading-none"
        style={{ fontSize: '24px', letterSpacing: '-0.02em', color: color || '#FFFFFF' }}>
        {valor}
      </div>
      <div className="font-syne text-[7.5px] font-black tracking-[0.18em] mt-1.5" style={{ color: 'rgba(255,255,255,0.28)' }}>
        {etiqueta}
      </div>
    </Etiqueta>
  )
}

/**
 * La espera, CONTADA.
 *
 * Las tres secciones esperan al modelo y las tres lo resuelven distinto y mal:
 * tres puntitos en el chat, un orbe quieto en Harvey, «Cargando…» a 11px en el
 * briefing. Una pantalla que no dice nada durante cuarenta segundos se lee como
 * rota — y es lo primero que envejece un chat.
 *
 * Las fases van por TIEMPO y no por progreso real, y eso es honesto mientras diga
 * cosas que de verdad están pasando: leer el contexto, buscar, redactar. Lo que no
 * hace es prometer un porcentaje, que sería inventarse un dato — el mismo error que
 * ya se corrigió en la barra del PDF.
 */
export function Esperando({ fases, color = '#1B5FFA' }: { fases?: string[]; color?: string }) {
  const pasos = fases ?? ['Leyendo tu contexto', 'Pensando', 'Redactando']
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex items-center gap-1" aria-hidden>
        {[0, 1, 2].map(i => (
          <span key={i} className="rounded-full"
            style={{ width: 5, height: 5, background: color, animation: `dot${i + 1} 1.4s ease-in-out infinite` }} />
        ))}
      </span>
      <span className="font-figtree text-[12.5px] nx-fases" style={{ color: 'rgba(255,255,255,0.4)' }}>
        {pasos.map((p, i) => (
          <span key={p} style={{ animationDelay: `${i * 4}s` }}>{p}…</span>
        ))}
      </span>
    </div>
  )
}
