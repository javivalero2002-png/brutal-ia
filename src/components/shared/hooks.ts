'use client'
import { useState, useEffect, useRef } from 'react'

const CONSULTA_MOVIL = '(max-width: 767px)'

/**
 * ¿Estamos en móvil? Y acertando ya en el PRIMER render.
 *
 * ─── EL FALLO QUE ARREGLA ───
 *
 * Esto arrancaba en `useState(false)` —«no es móvil»— y se corregía dentro de un
 * `useEffect`, que corre DESPUÉS de pintar. En un teléfono, eso significa que cada
 * sección se pintaba una vez entera con el diseño de ESCRITORIO —columnas de
 * kanban, paneles de 360px, tres columnas— y al frame siguiente saltaba al de
 * móvil.
 *
 * Javi lo describió como «un frame que aparece bugueado, da sensación de lag», y
 * pasaba SIEMPRE, en todas las secciones. Yo lo achaqué primero a la descarga del
 * código y puse un esqueleto animado: empeoró, porque el parpadeo seguía y encima
 * ahora latía. La pista que lo delataba estaba en el propio síntoma — «siempre».
 * La descarga de un trozo ocurre UNA vez por sesión; esto ocurría en cada apertura.
 *
 * ─── POR QUÉ EL INICIALIZADOR PEREZOSO Y NO UNA CONSTANTE ───
 *
 * `useState(() => …)` solo ejecuta la función en el primer render. En el servidor
 * `window` no existe, así que se devuelve `false` —el mismo valor que antes, con
 * lo que el HTML del servidor no cambia y la hidratación no se rompe—. En el
 * cliente, el primer render ya sabe la verdad.
 *
 * `useSyncExternalStore` sería lo canónico, pero exige un `getServerSnapshot` y
 * añade una suscripción por cada uso del hook; con `matchMedia` directamente sale
 * lo mismo y se lee de un vistazo.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(CONSULTA_MOVIL).matches
      : false)
  useEffect(() => {
    const mq = window.matchMedia(CONSULTA_MOVIL)
    const update = () => setIsMobile(mq.matches)
    // Se sigue llamando una vez: entre el primer render y este efecto puede haber
    // girado la pantalla, y el evento `change` solo avisa de lo que pase DESPUÉS.
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return isMobile
}

/**
 * Hace que el botón ATRÁS del móvil cierre un panel a pantalla completa en vez
 * de salirse de la app.
 *
 * `puedeCerrar` es opcional y sirve para los paneles que son FORMULARIOS: si
 * devuelve false, el panel no se cierra. Ojo con el detalle que lo hace correcto
 * — cuando se veta, la entrada de historial que el atrás acaba de consumir hay
 * que REPONERLA, o el siguiente atrás se lleva al usuario fuera de la app; y
 * `openRef` tiene que quedarse en true, o al cerrar de verdad el hook ya no
 * deshace su propia entrada y el historial se queda con basura.
 */
export function useBackClosable(isOpen: boolean, close: () => void, puedeCerrar?: () => boolean) {
  const openRef = useRef(false)
  const closeRef = useRef(close)
  closeRef.current = close
  const guardRef = useRef(puedeCerrar)
  guardRef.current = puedeCerrar
  useEffect(() => {
    if (isOpen && !openRef.current) {
      openRef.current = true
      window.history.pushState({ ...(window.history.state || {}), nxOverlay: true }, '')
    } else if (!isOpen && openRef.current) {
      openRef.current = false
      if (window.history.state?.nxOverlay) window.history.back()
    }
  }, [isOpen])
  useEffect(() => {
    const onPop = () => {
      if (!openRef.current) return
      if (guardRef.current && !guardRef.current()) {
        window.history.pushState({ ...(window.history.state || {}), nxOverlay: true }, '')
        return
      }
      openRef.current = false
      closeRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
}
