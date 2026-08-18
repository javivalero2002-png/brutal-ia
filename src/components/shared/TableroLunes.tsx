'use client'
import { useState } from 'react'
import { BLU } from '@/components/shared/design-tokens'
import LucideIcon from '@/components/shared/LucideIcon'

// El tablero semanal del equipo, como botón flotante.
//
// Antes era una franja horizontal en la cabecera de Tareas: un enlace que se abre
// una vez por semana ocupando el ancho completo y empujando hacia abajo los
// recuentos y la lista, que son lo que se mira cada día. Aquí queda a mano sin
// gastar sitio.
//
// Abajo a la IZQUIERDA a propósito: la derecha es donde el pulgar cae solo y donde
// ya vive el botón de crear. Un enlace externo que se pulsa una vez por semana no
// debe compartir zona con la acción que más se repite — ahí solo se gana pulsarlo
// sin querer.
const HOJA = 'https://docs.google.com/spreadsheets/d/12LAHQfIUy8BrYx_ekRWZgoqtwlUOUIn0/edit?usp=sharing&ouid=109708069863804140195&rtpof=true&sd=true'

export default function TableroLunes({ isMobile }: { isMobile: boolean }) {
  const [abierto, setAbierto] = useState(false)

  return (
    <a
      href={HOJA}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Reunión del lunes — tablero semanal del equipo en Google Sheets"
      title="Reunión del lunes · tablero semanal"
      onMouseEnter={() => setAbierto(true)}
      onMouseLeave={() => setAbierto(false)}
      className="fixed z-40 flex items-center rounded-full transition-all active:scale-95 group"
      style={{
        // `env(safe-area-inset-bottom)` para que no se meta bajo la barra de gestos
        // del iPhone, y algo más de aire en móvil, donde hay barra de navegación.
        // En MÓVIL a la izquierda, que es lo contrario de donde cae el pulgar y de
        // donde vive el botón de crear: un enlace que se pulsa una vez por semana
        // no comparte zona con la acción que más se repite.
        //
        // En ESCRITORIO a la derecha, y no por gusto: a la izquierda está la barra
        // lateral, así que el botón caía justo encima del bloque de tu perfil. En
        // la demo no se nota porque no tiene barra; en la app sí.
        ...(isMobile ? { left: '1rem' } : { right: '1.5rem' }),
        bottom: `calc(${isMobile ? '5.25rem' : '1.5rem'} + env(safe-area-inset-bottom))`,
        height: '2.75rem',
        width: abierto && !isMobile ? '13.5rem' : '2.75rem',
        padding: '0 0.6rem',
        gap: '0.55rem',
        overflow: 'hidden',
        background: 'rgba(10,10,20,0.82)',
        border: `1px solid ${BLU}38`,
        backdropFilter: 'blur(12px)',
        boxShadow: `0 6px 22px rgba(0,0,0,0.45), 0 0 0 4px ${BLU}0D`,
      }}
    >
      <span
        className="flex items-center justify-center flex-shrink-0 rounded-full"
        style={{ width: '1.6rem', height: '1.6rem', background: `${BLU}1F` }}
      >
        <LucideIcon name="coffee" size={14} color={BLU} />
      </span>

      {/* El texto solo existe en escritorio y al pasar por encima: en móvil no hay
          hover, así que un rótulo que nunca se muestra sería peso muerto. */}
      {!isMobile && (
        <span
          className="flex flex-col min-w-0 transition-opacity"
          style={{ opacity: abierto ? 1 : 0, whiteSpace: 'nowrap' }}
          aria-hidden={!abierto}
        >
          <span className="font-syne text-[8px] font-black tracking-widest" style={{ color: BLU }}>
            REUNIÓN DEL LUNES
          </span>
          <span className="font-figtree text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Tablero semanal · Sheets
          </span>
        </span>
      )}
    </a>
  )
}
