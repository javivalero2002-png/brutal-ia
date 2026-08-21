const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='
let sharedAudioEl: HTMLAudioElement | null = null

export const getSharedAudio = () => {
  if (!sharedAudioEl && typeof window !== 'undefined') {
    sharedAudioEl = new Audio()
    sharedAudioEl.preload = 'auto'
    sharedAudioEl.setAttribute('playsinline', '')
    sharedAudioEl.style.display = 'none'
    // Cualquier reproducción que llegue a sonar YA demuestra que el audio está
    // desbloqueado. Sin esto, `__unlocked` solo se ponía si el `play()` del wav
    // silencioso salía bien —y si fallaba, `unlockAudio` reintentaba en CADA toque
    // durante el resto de la sesión, para siempre.
    sharedAudioEl.addEventListener('playing', () => {
      ;(sharedAudioEl as unknown as { __unlocked?: boolean }).__unlocked = true
    })
    document.body.appendChild(sharedAudioEl)
  }
  return sharedAudioEl
}

let lastAckAt = 0
export const playAck = () => {
  const now = Date.now()
  if (now - lastAckAt < 6000) return
  lastAckAt = now
  try {
    const a = getSharedAudio()
    if (!a) return
    a.src = '/ack-' + (1 + Math.floor(Math.random() * 4)) + '.mp3'
    a.play().catch(() => {})
  } catch {}
}

export const isIOSDevice = () => {
  if (typeof navigator === 'undefined') return false
  return /iP(hone|od|ad)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export const matchTeamMember = (team: any[], name: string) => {
  const n = (name || '').trim().toLowerCase()
  if (!n) return null
  return team.find((m: any) => m.name?.toLowerCase() === n)
    || team.find((m: any) => m.name?.toLowerCase().split(' ')[0] === n)
    || team.find((m: any) => m.name?.toLowerCase().includes(n) || n.includes(m.name?.toLowerCase().split(' ')[0]))
    || null
}

export const splitForTTS = (text: string): string[] => {
  const clean = (text || '').trim()
  if (clean.length <= 60) return clean ? [clean] : []
  const sentences = clean.split(/(?<=[.!?…])\s+/)
  let first = sentences.shift() || clean
  while (first.length < 25 && sentences.length) first += ' ' + sentences.shift()
  const rest = sentences.join(' ').trim()
  return rest ? [first, rest] : [first]
}

export const stopAllVoices = () => {
  if (sharedAudioEl) { try { sharedAudioEl.pause() } catch {} }
  if (typeof window !== 'undefined' && window.speechSynthesis) { try { window.speechSynthesis.cancel() } catch {} }
}

/**
 * Desbloquear el audio en iOS, SIN pisar lo que esté sonando.
 *
 * EL FALLO QUE ARREGLA: esto va enganchado a cada `touchend` y cada `click` de la
 * app, y ponía `src = SILENT_WAV` en el ÚNICO elemento de audio que hay. La guarda
 * era `__unlocked`, que solo se pone a `true` si ese primer `play()` sale bien — y
 * en iOS falla a menudo. Con la guarda en falso, CADA toque metía un wav silencioso
 * encima de la voz de Harvey. Javi: «mientras está hablando y deslizo, se para».
 *
 * Y `touchend` dispara también al terminar un scroll, así que ni siquiera hacía
 * falta pulsar nada: bastaba con deslizar para leer lo que Harvey iba diciendo.
 *
 * Ahora se comprueba si el elemento está OCUPADO antes de tocarlo. Desbloquear es
 * una optimización; cortar la voz es un fallo. Ante la duda, no se toca.
 */
export const unlockAudio = () => {
  const a = getSharedAudio()
  if (!a || (a as any).__unlocked) return
  // Sonando, o a punto: no se pisa. `paused` es falso mientras reproduce, y
  // `readyState`/`currentSrc` cubren el hueco entre asignar el src y empezar.
  if (!a.paused || (a.currentSrc && a.currentSrc !== SILENT_WAV && a.readyState > 0 && !a.ended)) return
  a.setAttribute('playsinline', '')
  a.volume = 1
  a.src = SILENT_WAV
  a.play().then(() => { (a as any).__unlocked = true }).catch(() => {})
  try {
    const synth = window.speechSynthesis
    if (synth && !(synth as any).__unlocked) {
      const utt = new SpeechSynthesisUtterance('')
      utt.volume = 0
      synth.speak(utt)
      ;(synth as any).__unlocked = true
    }
  } catch {}
}

export const isSRBroken = () => {
  try { return sessionStorage.getItem('nx_sr_broken') === '1' } catch { return false }
}

export const markSRBroken = () => {
  try { sessionStorage.setItem('nx_sr_broken', '1') } catch {}
}
