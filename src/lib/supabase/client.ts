import { createBrowserClient } from '@supabase/ssr'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

let _client: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  // createBrowserClient sets session in BOTH localStorage AND cookies,
  // so server-side API routes can authenticate the user via cookies.
  if (!_client) _client = createBrowserClient(URL, KEY)
  return _client
}
