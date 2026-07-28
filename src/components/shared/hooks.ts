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

export function useBackClosable(isOpen: boolean, close: () => void) {
  const openRef = useRef(false)
  const closeRef = useRef(close)
  closeRef.current = close
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
    const onPop = () => { if (openRef.current) { openRef.current = false; closeRef.current() } }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
}
