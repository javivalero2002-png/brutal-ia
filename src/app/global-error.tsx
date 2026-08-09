'use client'

// Última red bajo los SectionErrorBoundary. Sin esto, un fallo fuera de una
// sección mostraba la página de error genérica de Next, sin ninguna referencia.
// Lo importante es `error.digest`: Next registra la traza completa en los
// Runtime Logs de Vercel bajo ese identificador, así que basta con pegarlo para
// encontrar el error — sin necesidad de ningún servicio externo.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="es">
      <body style={{
        background: '#030308', color: '#fff', fontFamily: 'system-ui, sans-serif',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', margin: 0,
      }}>
        <div style={{ textAlign: 'center', maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 16, marginBottom: 8, letterSpacing: '0.1em' }}>BRUTAL.IA ha fallado</h1>
          <p style={{ fontSize: 13, opacity: 0.6, marginBottom: 12, lineHeight: 1.5 }}>{error.message}</p>
          {error.digest && (
            <p style={{ fontSize: 11, opacity: 0.35, marginBottom: 16, fontFamily: 'monospace' }}>
              ref: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              background: '#1B5FFA', color: '#fff', border: 'none', borderRadius: 999,
              padding: '10px 24px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              letterSpacing: '0.08em',
            }}
          >
            REINTENTAR
          </button>
        </div>
      </body>
    </html>
  )
}
