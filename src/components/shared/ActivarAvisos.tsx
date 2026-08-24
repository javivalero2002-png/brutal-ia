'use client'
import { useEffect, useState } from 'react'
import { activarPush, haySoportePush } from '@/lib/activarPush'
import LucideIcon from '@/components/shared/LucideIcon'
import { BLU, AMBAR } from '@/components/shared/design-tokens'

/**
 * «Activa los avisos», donde de verdad hace falta.
 *
 * Javi, sobre el recordatorio de cerrar el día: «no que sea obligatorio, pero que
 * la gente lo active fácil y sencillo, ya que es vital».
 *
 * La preferencia ya viene activada de fábrica, así que lo que de verdad frena a la
 * gente no es un interruptor: es que nunca ha dado permiso al navegador. Y eso
 * vivía en Operativa → Notificaciones, a cuatro toques de donde se ficha. Aquí se
 * pone AL LADO del hábito, con un botón.
 *
 * No se pinta nada si ya están activados o si el navegador no puede: una fila que
 * no se puede accionar es ruido, y en este repo el ruido se lee y luego se ignora.
 */
export default function ActivarAvisos({ motivo }: { motivo: string }) {
  const [estado, setEstado] = useState<'mirando' | 'falta' | 'ok' | 'denegado' | 'sin-soporte'>('mirando')
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      if (!haySoportePush()) { if (vivo) setEstado('sin-soporte'); return }
      if (Notification.permission === 'denied') { if (vivo) setEstado('denegado'); return }
      try {
        // Permiso Y suscripción. Con solo el permiso, la pantalla decía que estaba
        // activado mientras el servidor no tenía a quién mandar nada.
        const reg = await navigator.serviceWorker.ready
        const sus = await reg.pushManager.getSubscription()
        if (vivo) setEstado(Notification.permission === 'granted' && sus ? 'ok' : 'falta')
      } catch {
        if (vivo) setEstado('falta')
      }
    })()
    return () => { vivo = false }
  }, [])

  if (estado === 'mirando' || estado === 'ok' || estado === 'sin-soporte') return null

  const denegado = estado === 'denegado'
  const col = denegado ? AMBAR : BLU

  return (
    <div className="flex items-center gap-3 rounded-2xl px-4 py-3 mb-3"
      style={{ background: `${col}0F`, border: `1px solid ${col}33` }}>
      <LucideIcon name={denegado ? 'bell-off' : 'bell'} size={16} color={col} />
      <div className="flex-1 min-w-0">
        <div className="font-figtree text-[12.5px] font-bold break-words" style={{ color: 'rgba(255,255,255,0.82)' }}>
          {denegado ? 'Los avisos están bloqueados en este navegador' : 'Activa los avisos'}
        </div>
        <div className="font-figtree text-[11px] mt-0.5 break-words" style={{ color: 'rgba(255,255,255,0.38)' }}>
          {denegado
            ? 'Desbloquéalos en los ajustes del sitio y vuelve a entrar.'
            : motivo}
        </div>
      </div>
      {!denegado && (
        <button
          disabled={ocupado}
          onClick={async () => {
            setOcupado(true)
            const r = await activarPush()
            setOcupado(false)
            // El resultado manda: si falla, la tarjeta se queda. Ocultarla al
            // pulsar prometería unos avisos que no van a llegar.
            if (r.ok) setEstado('ok')
            else if (r.motivo === 'denegado') setEstado('denegado')
          }}
          className="font-syne text-[8.5px] font-black tracking-widest px-3.5 py-2 rounded-xl flex-shrink-0 transition-all active:scale-95 disabled:opacity-50"
          style={{ background: col, color: '#fff' }}>
          {ocupado ? 'ACTIVANDO…' : 'ACTIVAR'}
        </button>
      )}
    </div>
  )
}
