'use client'
import { useEffect } from 'react'

// Registra el service worker al cargar la app. Necesario para:
//  - Instalación como PWA (escritorio + iOS)
//  - Arranque offline (caché de shell)
//  - Notificaciones push
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
    // Esperar a que la página esté cargada para no competir con recursos críticos
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  }, [])
  return null
}
