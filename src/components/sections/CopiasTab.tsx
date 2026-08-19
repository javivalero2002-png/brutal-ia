'use client'

import { useState, useEffect, useCallback } from 'react'
import { BLU, GRN, AMBAR, RED, SURFACE, SURF2, BORDER, LucideIcon, relTime } from '@/components/shared'

type Copia = { nombre: string; dia: string; bytes: number | null; creada: string | null }

/**
 * Copias de seguridad de la base. Solo el propietario llega aquí.
 *
 * Por qué se enseñan y no se dejan corriendo calladas: un respaldo que nadie ha
 * visto nunca no es un respaldo, es una intención. Ver «hace 6 horas · 4.312
 * filas» es lo que hace que se note el día que deje de aparecer — y ese día es el
 * único que importa.
 */
export default function CopiasTab({ showToast }: { showToast: (m: string) => void }) {
  const [copias, setCopias] = useState<Copia[] | null>(null)
  const [sinEstrenar, setSinEstrenar] = useState(false)
  // Tres estados y no un booleano: «cargando», «no se pudo leer» y «no hay
  // ninguna» son cosas distintas, y pintarlas igual es como una lista vacía
  // acaba mintiendo.
  const [estado, setEstado] = useState<'cargando' | 'error' | 'ok'>('cargando')
  const [copiando, setCopiando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/backup')
      if (!r.ok) { setEstado('error'); return }
      const j = await r.json()
      setCopias(j.copias || [])
      setSinEstrenar(!!j.sinEstrenar)
      setEstado('ok')
    } catch { setEstado('error') }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const copiarAhora = async () => {
    setCopiando(true)
    try {
      const r = await fetch('/api/admin/backup', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { showToast(j.error || 'No se pudo hacer la copia'); return }
      showToast(`Copia hecha · ${(j.total ?? 0).toLocaleString('es-ES')} filas`)
      await cargar()
    } catch { showToast('No se pudo hacer la copia') }
    finally { setCopiando(false) }
  }

  const descargar = async (nombre: string) => {
    try {
      const r = await fetch(`/api/admin/backup?descargar=${encodeURIComponent(nombre)}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.url) { showToast(j.error || 'No se pudo preparar la descarga'); return }
      window.open(j.url, '_blank')
    } catch { showToast('No se pudo preparar la descarga') }
  }

  const ultima = copias?.[0]
  const tam = (b: number | null) => (b == null ? '' : b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`)

  return (
    <div className="px-4 sm:px-8 py-6 flex flex-col gap-4">

      {/* Lo primero, la respuesta a la única pregunta que importa: ¿hay copia? */}
      <div className="rounded-2xl p-5" style={{
        background: SURFACE,
        border: `1px solid ${estado === 'ok' && ultima ? `${GRN}35` : estado === 'error' ? `${RED}35` : BORDER}`,
      }}>
        <div className="font-syne text-[8.5px] font-black tracking-[0.2em] mb-2" style={{ color: 'rgba(255,255,255,0.25)' }}>
          COPIA DE SEGURIDAD
        </div>

        {estado === 'cargando' ? (
          <div className="font-figtree text-[13px]" style={{ color: 'rgba(255,255,255,0.25)' }}>Comprobando…</div>
        ) : estado === 'error' ? (
          <div className="font-figtree text-[13px]" style={{ color: RED }}>
            No se pudo comprobar el estado de las copias. Vuelve a intentarlo.
          </div>
        ) : ultima ? (
          <>
            <div className="font-figtree text-[19px] font-bold text-white leading-tight">
              Última copia {relTime(ultima.creada || `${ultima.dia}T04:00:00Z`)}
            </div>
            <div className="font-figtree text-[12.5px] mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
              {copias!.length} {copias!.length === 1 ? 'copia guardada' : 'copias guardadas'} · se hace sola cada noche · se conservan 30 días
            </div>
          </>
        ) : (
          <>
            <div className="font-figtree text-[19px] font-bold leading-tight" style={{ color: AMBAR }}>
              Todavía no hay ninguna copia
            </div>
            <div className="font-figtree text-[12.5px] mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
              {sinEstrenar
                ? 'La primera se crea sola esta noche. Puedes adelantarla ahora.'
                : 'Haz la primera y a partir de ahí se repite cada noche.'}
            </div>
          </>
        )}

        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={copiarAhora} disabled={copiando}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest transition-all active:scale-95 disabled:opacity-40"
            style={{ background: `${BLU}18`, border: `1px solid ${BLU}3A`, color: BLU }}>
            <LucideIcon name={copiando ? 'loader' : 'download-cloud'} size={12} color={BLU} />
            {copiando ? 'COPIANDO…' : 'COPIAR AHORA'}
          </button>
          {ultima && (
            <button onClick={() => descargar(ultima.nombre)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest transition-all active:scale-95"
              style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: 'rgba(255,255,255,0.6)' }}>
              <LucideIcon name="download" size={12} color="rgba(255,255,255,0.5)" />
              DESCARGAR LA ÚLTIMA
            </button>
          )}
        </div>
      </div>

      {/* Qué hay dentro y qué NO. Un respaldo en el que confías de más es peor
          que ninguno: si un día hay que restaurar, esto es lo que evita la
          sorpresa de descubrir a mitad que faltaba algo. */}
      <div className="rounded-2xl p-5" style={{ background: SURF2, border: `1px solid ${BORDER}` }}>
        <div className="font-syne text-[8.5px] font-black tracking-[0.2em] mb-2.5" style={{ color: 'rgba(255,255,255,0.25)' }}>
          QUÉ GUARDA, Y QUÉ NO
        </div>
        <div className="font-figtree text-[12.5px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
          Guarda <span className="text-white font-semibold">todas las filas</span>: personas, clientes, proyectos,
          tareas, contenido, memoria, diario, bandeja y avisos.
          <br />
          No guarda la estructura de la base (se reconstruye desde el repositorio),
          los ficheros subidos (siguen en su sitio) ni las conexiones de Gmail —
          esas se omiten a propósito, porque un fichero descargado no es lugar para
          una llave del correo de nadie.
        </div>
      </div>

      {/* El histórico. Se enseña entero porque «cuántas hay» es la señal de que
          esto sigue vivo. */}
      {estado === 'ok' && copias!.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
          <div className="font-syne text-[8.5px] font-black tracking-[0.2em] px-5 pt-4 pb-2" style={{ color: 'rgba(255,255,255,0.25)' }}>
            HISTÓRICO · {copias!.length}
          </div>
          <div className="flex flex-col">
            {copias!.map(c => (
              <button key={c.nombre} onClick={() => descargar(c.nombre)}
                className="flex items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
                style={{ borderTop: `1px solid ${BORDER}` }}>
                <LucideIcon name="file-text" size={13} color="rgba(255,255,255,0.25)" />
                <span className="font-figtree text-[13px] flex-1" style={{ color: 'rgba(255,255,255,0.75)' }}>{c.dia}</span>
                <span className="font-figtree text-[11.5px] tabular-nums" style={{ color: 'rgba(255,255,255,0.3)' }}>{tam(c.bytes)}</span>
                <LucideIcon name="download" size={12} color="rgba(255,255,255,0.25)" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
