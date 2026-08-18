'use client'
import { useEffect } from 'react'
// Solo por el efecto de importarlo: engancha el oyente de `beforeinstallprompt`
// en cuanto corre el chunk. Este componente está en el layout raíz, que es lo
// más pronto que hay. Ver el comentario largo en ese fichero.
import '@/lib/instalarPwa'

// Registra el service worker al cargar la app. Necesario para:
//  - Instalación como PWA (escritorio + iOS)
//  - Arranque offline (caché de shell)
//  - Notificaciones push
//
// EN DESARROLLO NO SE REGISTRA, y además se desregistra el que hubiera.
//
// `sw.js` cachea /_next/static/ con estrategia cache-first, y en desarrollo los
// nombres de chunk de Turbopack son ESTABLES: el mismo fichero para siempre. El
// resultado es que el navegador sirve código viejo indefinidamente, y no lo
// arregla ni reiniciar el servidor, ni borrar .next, ni abrir pestañas nuevas —
// la caché vive en el navegador.
//
// Eso costó horas: se persiguieron errores de hidratación ya corregidos, se dudó
// de diagnósticos correctos, y una captura seguía mostrando un texto arreglado
// hacía rato. En desarrollo el service worker no aporta nada (no se instala la
// PWA ni se prueba el offline) y estorba mucho.
//
// El desregistro además cura solo los navegadores que ya tengan uno pegado.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations()
        .then(async regs => {
          if (!regs.length) return
          for (const r of regs) await r.unregister()
          for (const k of await caches.keys()) await caches.delete(k)
          console.info('[dev] service worker desregistrado: en desarrollo servía código viejo')
        })
        .catch(() => {})
      return
    }

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
    // Esperar a que la página esté cargada para no competir con recursos críticos
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  }, [])
  return null
}
