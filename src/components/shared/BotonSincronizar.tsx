'use client'
import LucideIcon from './LucideIcon'
import { BLU, BORDER } from './design-tokens'

/**
 * El botón de sincronizar. UNO, no cinco.
 *
 * Había cinco repartidos por la pantalla de Sincronización y ninguno se parecía a
 * otro: dos decían «Sync» en gris, uno «SYNC AHORA» en azul sólido, y los de
 * reconectar decían «Reauth». Tres estilos y dos idiomas para la misma acción.
 *
 * DECISIONES:
 *
 * · «Sincronizar», no «Sync». La app está en español y «Sync» no lo entiende quien
 *   no programa. «Reauth» menos todavía — eso es jerga de OAuth, no una palabra.
 *
 * · El icono GIRA mientras trabaja. Es la única señal honesta de que algo está
 *   pasando: sin ella, pulsar y no ver nada durante ocho segundos parece que el
 *   botón no funciona, y la gente lo pulsa otra vez.
 *
 * · Deshabilitado mientras gira, a propósito. Cada sincronización analiza correos
 *   con Claude: pulsarlo tres veces seguidas es pagar tres veces por lo mismo.
 *
 * · El brillo del `principal` es MUY suave (18% de opacidad). Un botón que grita
 *   compite con el contenido; este tiene que verse cuando lo buscas y desaparecer
 *   cuando no.
 */
export function BotonSincronizar({
  onClick, sincronizando = false, disabled = false, variante = 'discreto', etiqueta, color = BLU, title,
}: {
  onClick?: () => void
  sincronizando?: boolean
  disabled?: boolean
  /** `principal` es el de la cabecera; `discreto` los de cada tarjeta. */
  variante?: 'principal' | 'discreto'
  /** Para reemplazar el texto — «Reconectar» usa el mismo botón con otro icono. */
  etiqueta?: string
  color?: string
  title?: string
}) {
  const principal = variante === 'principal'
  const texto = etiqueta ?? (sincronizando ? 'Sincronizando' : 'Sincronizar')
  return (
    <button
      onClick={onClick}
      disabled={disabled || sincronizando}
      title={title}
      aria-busy={sincronizando}
      className={`group inline-flex items-center justify-center gap-2 rounded-full font-syne font-black tracking-widest
        transition-all duration-200 active:scale-[0.97] disabled:cursor-not-allowed
        ${principal ? 'px-5 py-3 text-[9.5px]' : 'px-4 py-2.5 text-[8.5px]'}
        ${sincronizando ? 'opacity-90' : 'hover:-translate-y-[1px] disabled:opacity-35 disabled:hover:translate-y-0'}`}
      style={principal
        ? { background: `linear-gradient(135deg, ${color}, ${color}CC)`, color: '#FFFFFF',
            border: `1px solid ${color}`, boxShadow: `0 4px 18px ${color}2E` }
        : { background: 'rgba(255,255,255,0.035)', color: 'rgba(255,255,255,0.6)',
            border: `1px solid ${BORDER}` }}>
      <span className="flex items-center justify-center" style={sincronizando ? { animation: 'spin 900ms linear infinite' } : undefined}>
        <LucideIcon name="refresh-cw" size={principal ? 13 : 11} color={principal ? '#FFFFFF' : color} />
      </span>
      {texto}
      {/* Los tres puntos, aparte del texto: así el ancho del botón no salta entre
          «Sincronizar» y «Sincronizando…» y la fila de al lado no se mueve. */}
      {sincronizando && <span aria-hidden style={{ width: principal ? 10 : 8, textAlign: 'left' }}>…</span>}
    </button>
  )
}
