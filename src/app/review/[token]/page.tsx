'use client'
import { useState, useEffect, use } from 'react'
import { PlatformLogo } from '@/components/PlatformLogo'
import { PLATAFORMA_COLOR } from '@/components/shared/design-tokens'
// El de `shared`, no una copia: aquí había una segunda versión que además se
// había quedado atrás — la de shared entiende Drive y esta no.
import { videoEmbed, videoEsVertical } from '@/components/shared/helpers'

const platColor = PLATAFORMA_COLOR

export default function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [item, setItem] = useState<any>(null)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  /**
   * Quién dice ser quien está opinando.
   *
   * El enlace se pega en un grupo de WhatsApp donde están el cliente Y los jefes,
   * así que firmarlo todo como «CLIENTE» era falso la mitad de las veces. Ahora
   * se elige, y el servidor comprueba que ese nombre exista de verdad en el equipo
   * — si no, firma como Cliente.
   *
   * Vacío = Cliente, y es el valor por DEFECTO a propósito: quien abre este enlace
   * es, casi siempre, alguien de fuera. Elegir debe ser el gesto raro.
   */
  const [autor, setAutor] = useState('')

  useEffect(() => {
    fetch(`/api/review/${token}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setItem)
      .catch(() => setError('Enlace no válido o caducado.'))
  }, [token])

  /**
   * Un solo camino para mandar la respuesta, se pida cambios o se apruebe.
   *
   * `aprobado` viaja como bandera y no como texto: el equipo tiene que poder
   * distinguir «el cliente ha dado el visto bueno» de «el cliente ha escrito algo
   * que parece un sí», y eso no se deduce leyendo prosa.
   */
  const enviar = async (texto: string, aprobado = false) => {
    if (!texto.trim()) return
    setSending(true)
    try {
      const res = await fetch(`/api/review/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: texto, aprobado, autor }),
      })
      if (res.ok) setSent(true)
      else setError('No se pudo enviar. Inténtalo de nuevo en un momento.')
    } catch {
      // Sin este catch, un fallo de RED dejaba la promesa rechazada: no se marcaba
      // como enviado ni se enseñaba error, el boton volvia a estar disponible y el
      // cliente se quedaba mirando su texto sin saber si habia llegado. Es la unica
      // pantalla que ve gente de fuera y su unico proposito es recoger esto.
      setError('No hemos podido enviarlo — comprueba tu conexión y vuelve a intentarlo. Tu texto sigue aquí.')
    } finally { setSending(false) }
  }

  const submitFeedback = () => enviar(feedback)

  const pc = item ? (platColor[item.platform] || '#1B5FFA') : '#1B5FFA'
  const embed = item?.video_url ? videoEmbed(item.video_url) : null

  // `overflow-y-auto` + altura fija: esta página necesita su PROPIO contenedor de
  // scroll.
  //
  // globals.css pone `html, body { height: 100%; overflow: hidden }` sin media
  // query, y solo hay un layout, así que esa regla alcanza también a esta ruta. La
  // app interna vive con ella porque cada sección scrollea por dentro; esta página
  // no tenía ninguno, así que el body recortaba el contenido y NO HABÍA FORMA DE
  // BAJAR: el cliente no llegaba al textarea ni al botón de enviar, que son el
  // único propósito de la página. Y es la única pantalla que ve gente de fuera.
  return (
    <div
      className="min-h-screen overflow-y-auto"
      style={{ background: '#08080F', fontFamily: 'system-ui, sans-serif', height: '100dvh' }}
    >
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
                <PlatformLogo platform={item.platform} size={14} />
                <span className="text-xs font-bold tracking-wider" style={{ color: pc }}>{item.platform}</span>
              </div>
              <h1 className="text-white text-2xl font-black leading-snug" style={{ letterSpacing: '-0.02em' }}>{item.title}</h1>
              {item.publish_date && (
                <p className="mt-2 text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>Publicación: {new Date(item.publish_date+'T12:00:00').toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p>
              )}
            </div>

            {/* El material. Tres casos y NINGUNO es un hueco mudo: se puede
                incrustar, no se puede pero hay enlace, o solo hay portada. Antes
                solo se pintaba el primero, así que a un cliente con el vídeo en
                Drive —lo que la propia app le recomienda— se le pedía opinión
                sobre algo que no veía. */}
            {/* Y aquí más aún: el cliente puede tener un bloqueador y nosotros no
                nos vamos a enterar. Si el incrustado se le tapa, esto es lo único
                que le queda para ver la pieza sobre la que le pedimos opinión. */}
            {item.video_url && (
              <a href={item.video_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl transition-opacity hover:opacity-80"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                <span className="text-[12px] font-semibold" style={{ color: 'rgba(255,255,255,0.55)' }}>Ver el original</span>
              </a>
            )}

            {/* La PORTADA manda sobre el incrustado, por lo mismo que dentro de
                la app: vive en nuestro Storage y ningún bloqueador la toca,
                mientras que un incrustado de Instagram se tapa con un recuadro
                gris que no podemos detectar. Y aquí el que lo abre es un cliente:
                si no ve la pieza, no opina.
                Con play encima, porque un clic lleva al vídeo de verdad. */}
            {item.cover_url && item.video_url ? (
              <a href={item.video_url} target="_blank" rel="noopener noreferrer"
                className="relative block rounded-2xl overflow-hidden mx-auto"
                style={{
                  aspectRatio: videoEsVertical(item.video_url) ? '9/16' : '16/9',
                  maxWidth: videoEsVertical(item.video_url) ? '340px' : 'none',
                  background: '#000',
                }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.cover_url} alt={item.title} className="w-full h-full object-cover"/>
                <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.28)' }}>
                  <div className="rounded-full flex items-center justify-center" style={{ width: 56, height: 56, background: 'rgba(255,255,255,0.92)' }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="#111"><path d="M8 5v14l11-7z"/></svg>
                  </div>
                </div>
              </a>
            ) : embed ? (
              // El marco se adapta al vídeo, no al revés. Un reel en un hueco 16:9
              // sale como un sello entre dos franjas negras — y el reel es el
              // formato que más se manda a revisar.
              <div className="rounded-2xl overflow-hidden mx-auto" style={{
                aspectRatio: videoEsVertical(item.video_url) ? '9/16' : '16/9',
                maxWidth: videoEsVertical(item.video_url) ? '340px' : 'none',
                background: '#000',
              }}>
                <iframe src={embed} className="w-full h-full" allow="accelerometer;autoplay;encrypted-media;gyroscope;picture-in-picture" allowFullScreen />
              </div>
            ) : item.video_url ? (
              <a href={item.video_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2.5 rounded-2xl py-5 transition-opacity hover:opacity-80"
                style={{ background: 'rgba(27,95,250,0.08)', border: '1px solid rgba(27,95,250,0.25)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5B87FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                <span className="text-sm font-semibold" style={{ color: '#5B87FF' }}>Ver el material</span>
              </a>
            ) : item.cover_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.cover_url} alt={item.title} className="w-full rounded-2xl"
                style={{ display: 'block', background: 'rgba(255,255,255,0.03)' }} />
            ) : null}

            {/* La portada acompaña al vídeo cuando hay las dos: da contexto sin
                competir con él. */}
            {(embed || item.video_url) && item.cover_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.cover_url} alt="" className="w-full rounded-2xl" style={{ display: 'block' }} />
            )}

            {/* Aquí había un bloque «NOTAS DEL EQUIPO» que NO podía pintarse
                nunca: el endpoint excluye `notes` a propósito por ser de uso
                interno, así que `item.notes` no llega jamás. Código muerto que
                aparentaba una función que no existe. Si algún día se quiere
                mandar contexto al cliente, hará falta un campo PÚBLICO aparte —
                reexponer las notas internas no es la solución. */}

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
                <div className="text-xs font-bold tracking-widest mb-3" style={{ color: 'rgba(255,255,255,0.3)' }}>TU FEEDBACK</div>

                {/* Quién eres. Solo aparece si hay equipo que ofrecer — si la
                    consulta falló, esto no sale y todo firma como Cliente, que es
                    como funcionaba antes. Nunca bloquea el poder opinar. */}
                {item.equipo?.length > 0 && (
                  <div className="mb-4">
                    <div className="text-[11px] mb-2" style={{ color: 'rgba(255,255,255,0.35)' }}>¿Quién eres?</div>
                    <div className="flex flex-wrap gap-1.5">
                      <button onClick={() => setAutor('')}
                        className="px-3 py-1.5 rounded-lg text-[12px] transition-all"
                        style={{
                          background: autor === '' ? 'rgba(255,176,32,0.14)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${autor === '' ? 'rgba(255,176,32,0.35)' : 'rgba(255,255,255,0.08)'}`,
                          color: autor === '' ? '#FFB020' : 'rgba(255,255,255,0.5)',
                        }}>
                        Sin decir quién
                      </button>
                      {item.equipo.map((p: { name: string; initials: string; color: string }) => (
                        <button key={p.name} onClick={() => setAutor(p.name)}
                          className="px-3 py-1.5 rounded-lg text-[12px] transition-all"
                          style={{
                            background: autor === p.name ? `${p.color}22` : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${autor === p.name ? p.color + '55' : 'rgba(255,255,255,0.08)'}`,
                            color: autor === p.name ? p.color : 'rgba(255,255,255,0.5)',
                          }}>
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
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
                {/* Aprobar de un clic.
                    Hasta ahora aprobar era literalmente el «…o aprobación» del
                    marcador de posición: texto libre que alguien del equipo lee,
                    interpreta y traduce a mover una tarjeta a mano. Para un
                    estudio cuyo entregable es contenido revisado por clientes, la
                    respuesta MÁS frecuente era la peor servida.
                    Va como una entrada más del mismo array de opiniones, así que
                    no hace falta ninguna columna nueva. */}
                <button
                  onClick={() => enviar('Aprobado sin cambios.', true)}
                  disabled={sending}
                  className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl text-xs font-bold tracking-widest transition-all disabled:opacity-40 mb-3"
                  style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ADE80' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4ADE80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  APROBAR SIN CAMBIOS
                </button>
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1" style={{ height: '1px', background: 'rgba(255,255,255,0.07)' }}/>
                  <span className="text-[10px] font-bold tracking-widest" style={{ color: 'rgba(255,255,255,0.2)' }}>O PIDE CAMBIOS</span>
                  <div className="flex-1" style={{ height: '1px', background: 'rgba(255,255,255,0.07)' }}/>
                </div>

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
