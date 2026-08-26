'use client'
import { BLU, RED, GRN } from './design-tokens'
import LucideIcon from './LucideIcon'

/**
 * Cuánto dura un aviso en pantalla.
 *
 * Había DOS duraciones —3.000 en `showToast` y 4.000 en el de la insignia— y
 * ninguna escrita en un sitio. Con la barra de tiempo esto deja de ser un
 * detalle: la barra tiene que vaciarse justo cuando el aviso se va, o miente.
 */
export const DURACION_AVISO = 3200

/**
 * El aviso de abajo. UNO, no dos.
 *
 * Estaba escrito en `NexusDashboard` y OTRA VEZ, distinto y más pobre, en el
 * harness de `/preview`. O sea que la pantalla donde se prueban las secciones no
 * podía enseñar el aviso que ve el equipo: se veía uno bonito en producción y una
 * caja gris en la demo, y cualquier arreglo aquí no llegaba allí.
 *
 * Lo de antes era un punto de 1,5 px y texto plano —Javi: «queda cutre»—. Ahora:
 *
 *  · el estado se lee por el ICONO, no por un punto de color de página web;
 *  · un halo del color del estado, que es el gesto que usan las tarjetas;
 *  · y una barra que se vacía, que dice que se va solo y cuánto queda. Sin ella
 *    el aviso desaparece de golpe y no sabes si se fue o si tocaste algo.
 */
export default function Aviso({ texto, isMobile }: { texto: string; isMobile?: boolean }) {
  const esError = /^error/i.test(texto) || texto.toLowerCase().includes(' error')
  const esOk = /^✓|creado|guardado|actualizado|eliminado|leído|enviado|añadid|salvo|pieza|conectado|sincronizado|releíd/i.test(texto) && !esError
  const c = esError ? RED : esOk ? GRN : BLU
  const icono = esError ? 'alert-triangle' : esOk ? 'check' : 'info'

  return (
    <div className="fixed left-1/2 z-[200] rounded-2xl overflow-hidden animate-avisoEntra"
      style={{
        bottom: isMobile ? 'calc(72px + env(safe-area-inset-bottom, 0px))' : '24px',
        transform: 'translateX(-50%)', width: 'max-content', maxWidth: 'calc(100vw - 24px)',
        background: `radial-gradient(120% 140% at 0% 0%, ${c}1F, transparent 62%), #101024`,
        border: `1px solid ${c}3D`,
        boxShadow: `0 18px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03), 0 0 22px ${c}14`,
      }}>
      <div className="flex items-center gap-3 pl-3.5 pr-5 py-3">
        <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${c}1F`, border: `1px solid ${c}45` }}>
          <LucideIcon name={icono} size={13} color={c} />
        </div>
        <span className="font-figtree text-[13px] leading-snug" style={{ color: 'rgba(255,255,255,0.92)' }}>{texto}</span>
      </div>
      {/* `key` con el texto: sin él, dos avisos seguidos comparten la animación y
          el segundo hereda la barra ya medio vacía del primero. */}
      <div key={texto} className="h-[2px] animate-avisoTiempo"
        style={{ background: `linear-gradient(90deg, ${c}, ${c}4D)`, animationDuration: `${DURACION_AVISO}ms` }} />
    </div>
  )
}
