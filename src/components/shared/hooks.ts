'use client'
import { useState, useEffect, useRef } from 'react'

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(mq.matches)
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
