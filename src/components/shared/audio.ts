const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='
let sharedAudioEl: HTMLAudioElement | null = null

export const getSharedAudio = () => {
  if (!sharedAudioEl && typeof window !== 'undefined') {
    sharedAudioEl = new Audio()
    sharedAudioEl.preload = 'auto'
    sharedAudioEl.setAttribute('playsinline', '')
    sharedAudioEl.style.display = 'none'
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

export const unlockAudio = () => {
  const a = getSharedAudio()
  if (!a || (a as any).__unlocked) return
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
