// Typed, validated environment variables.
// Import from here instead of process.env directly — build fails fast if something is missing.

function required(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

function optional(key: string): string | undefined {
  return process.env[key] || undefined
}

// ── Server-only (never sent to the browser) ─────────────────────────────────
export const env = {
  // Supabase
  SUPABASE_URL:              required('NEXT_PUBLIC_SUPABASE_URL'),
  SUPABASE_ANON_KEY:         required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: required('SUPABASE_SERVICE_ROLE_KEY'),

  // AI providers
  ANTHROPIC_API_KEY:  required('ANTHROPIC_API_KEY'),
  GROQ_API_KEY:       optional('GROQ_API_KEY'),   // STT primario (Whisper)
  OPENAI_API_KEY:     optional('OPENAI_API_KEY'), // STT fallback (Whisper)
  TAVILY_API_KEY:     optional('TAVILY_API_KEY'), // búsqueda web de Harvey
  FISH_AUDIO_API_KEY: optional('FISH_AUDIO_API_KEY'), // TTS (voz de Harvey)
  FISH_AUDIO_VOICE_ID: optional('FISH_AUDIO_VOICE_ID'),

  // Google OAuth
  GOOGLE_CLIENT_ID:     optional('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: optional('GOOGLE_CLIENT_SECRET'),

  // Push notifications
  VAPID_PUBLIC_KEY:  optional('NEXT_PUBLIC_VAPID_PUBLIC_KEY'),
  VAPID_PRIVATE_KEY: optional('VAPID_PRIVATE_KEY'),
  VAPID_SUBJECT:     optional('VAPID_SUBJECT'),

  // WhatsApp
  WHATSAPP_TOKEN:        optional('WHATSAPP_TOKEN'),
  WHATSAPP_PHONE_ID:     optional('WHATSAPP_PHONE_NUMBER_ID'),
  WHATSAPP_VERIFY_TOKEN: optional('WHATSAPP_VERIFY_TOKEN'),
  WHATSAPP_APP_SECRET:   optional('WHATSAPP_APP_SECRET'),

  // App
  APP_URL:     optional('NEXT_PUBLIC_APP_URL'),
  CRON_SECRET: optional('CRON_SECRET'),
} as const
