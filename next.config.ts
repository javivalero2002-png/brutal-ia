import type { NextConfig } from 'next'

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://lh3.googleusercontent.com https://brutal.thehook-produccion.es https://*.supabase.co",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co https://api.anthropic.com https://www.googleapis.com wss://*.supabase.co",
      "media-src 'self' blob: https://*.supabase.co",
      // Sin `frame-src`, el `default-src 'self'` de arriba bloqueaba TODOS los
      // iframes. Estaban rotos en producción: el vídeo de la página pública de
      // review (que es su único contenido, así que el cliente veía una página
      // vacía), los previews de Contenido y el visor de PDF de Proyectos.
      // `frame-src` = qué puede incrustar ESTA página; `frame-ancestors` = quién
      // puede incrustarnos a nosotros. Son directivas distintas e independientes.
      // DRIVE E INSTAGRAM TAMBIÉN. `videoEmbed()` genera cuatro clases de iframe
      // —YouTube, Vimeo, Drive e Instagram— y aquí solo estaban las dos primeras,
      // así que los otros dos los bloqueaba la CSP: caja negra vacía, sin error
      // visible, exactamente el síntoma que los commits que añadieron ese soporte
      // dicen haber arreglado («pegabas el enlace y no se veía nada»).
      //
      // Un test compara esta lista con los dominios que `videoEmbed` sabe producir:
      // añadir un quinto sin tocar esta línea se pone rojo.
      "frame-src 'self' blob: https://*.supabase.co https://www.youtube.com https://player.vimeo.com https://drive.google.com https://www.instagram.com",
      "frame-ancestors 'none'",
    ].join('; '),
  },
]

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'brutal.thehook-produccion.es' },
    ],
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
