'use client'
import { useState, useEffect, use } from 'react'

function videoEmbed(url: string): string | null {
  if (!url) return null
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?\s]+)/)
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`
  const vm = url.match(/vimeo\.com\/(\d+)/)
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`
  return null
}

const platColor: Record<string,string> = {
  TikTok:'#ff0050', Instagram:'#C13584', LinkedIn:'#0A66C2',
  YouTube:'#FF0000', Twitter:'#1DA1F2', Pinterest:'#E60023',
}

export default function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [item, setItem] = useState<any>(null)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    fetch(`/api/review/${token}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setItem)
      .catch(() => setError('Enlace no válido o caducado.'))
  }, [token])

  const submitFeedback = async () => {
    if (!feedback.trim()) return
    setSending(true)
    try {
      const res = await fetch(`/api/review/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback }),
      })
      if (res.ok) setSent(true)
      else setError('Error enviando feedback. Inténtalo de nuevo.')
    } finally { setSending(false) }
  }

  const pc = item ? (platColor[item.platform] || '#1B5FFA') : '#1B5FFA'
  const embed = item?.video_url ? videoEmbed(item.video_url) : null

  return (
    <div className="min-h-screen" style={{ background: '#08080F', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div className="border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="max-w-[720px] mx-auto px-6 py-4 flex items-center gap-3">
          <div className="font-black text-white text-sm tracking-tight">BRUTAL<span style={{ color: '#1B5FFA' }}>.</span>STUDIOS</div>
          <div className="flex-1"/>
          <div className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>Revisión de contenido</div>
        </div>
      </div>

      <div className="max-w-[720px] mx-auto px-6 py-10">
        {error && (
          <div className="text-center py-20">
            <div className="text-4xl mb-4" style={{ color: 'rgba(255,255,255,0.1)' }}>—</div>
            <div className="text-white/50 text-sm">{error}</div>
          </div>
        )}

        {!item && !error && (
          <div className="text-center py-20">
            <div className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>Cargando…</div>
          </div>
        )}

        {item && (
          <div className="space-y-8">
            {/* Title block */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-4" style={{ background: pc + '15', border: `1px solid ${pc}30` }}>
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: pc }} />
                <span className="text-xs font-bold tracking-wider" style={{ color: pc }}>{item.platform?.toUpperCase()}</span>
              </div>
              <h1 className="text-white text-2xl font-black leading-snug" style={{ letterSpacing: '-0.02em' }}>{item.title}</h1>
              {item.publish_date && (
                <p className="mt-2 text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>Fecha de publicación: {item.publish_date}</p>
              )}
            </div>

            {/* Video */}
            {embed && (
              <div className="rounded-2xl overflow-hidden" style={{ aspectRatio: '16/9', background: '#000' }}>
                <iframe src={embed} className="w-full h-full" allow="accelerometer;autoplay;encrypted-media;gyroscope;picture-in-picture" allowFullScreen />
              </div>
            )}

            {/* Notes from team */}
            {item.notes && (
              <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="text-xs font-bold tracking-widest mb-3" style={{ color: 'rgba(255,255,255,0.25)' }}>NOTAS DEL EQUIPO</div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'rgba(255,255,255,0.65)' }}>{item.notes}</p>
              </div>
            )}

            {/* Feedback form */}
            {sent ? (
              <div className="rounded-2xl p-8 text-center" style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}>
                <div className="w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: 'rgba(34,197,94,0.1)' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <div className="text-white font-semibold mb-1">Feedback enviado</div>
                <div className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>El equipo recibirá tu respuesta.</div>
              </div>
            ) : (
              <div className="rounded-2xl p-6" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="text-xs font-bold tracking-widest mb-4" style={{ color: 'rgba(255,255,255,0.3)' }}>TU FEEDBACK</div>
                <textarea
                  value={feedback}
                  onChange={e => setFeedback(e.target.value)}
                  placeholder="Escribe aquí tus comentarios, cambios o aprobación del contenido…"
                  rows={5}
                  className="w-full rounded-xl px-4 py-3.5 text-sm text-white outline-none resize-none"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1.5px solid rgba(255,255,255,0.08)', caretColor: '#1B5FFA', lineHeight: '1.65', color: 'rgba(255,255,255,0.85)' }}
                  onFocus={e => (e.target.style.borderColor = 'rgba(27,95,250,0.4)')}
                  onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.08)')}
                />
                <div className="flex items-center gap-3 mt-4">
                  <button
                    onClick={submitFeedback}
                    disabled={sending || !feedback.trim()}
                    className="px-6 py-3 rounded-xl text-xs font-bold tracking-widest text-white disabled:opacity-40 transition-all"
                    style={{ background: 'linear-gradient(135deg,#1B5FFA,#1440CC)' }}
                  >
                    {sending ? 'ENVIANDO…' : 'ENVIAR FEEDBACK'}
                  </button>
                  <span className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>Tu respuesta se guardará en el sistema de Brutal Studios</span>
                </div>
              </div>
            )}

            <div className="text-center text-xs pt-4" style={{ color: 'rgba(255,255,255,0.15)' }}>
              Powered by Brutal Studios IA
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
