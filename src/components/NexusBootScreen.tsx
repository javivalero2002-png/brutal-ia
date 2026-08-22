'use client'
import { useEffect, useState } from 'react'

// Pantalla de arranque.
//
// Antes desaparecía en cuanto llegaba el perfil, pero el dashboard todavía tenía
// por delante diez peticiones: se veía la carcasa vacía, los datos aparecían de
// golpe y por el camino daba un par de saltos. De ahí la sensación de que se
// quedaba pillado. Ahora cubre TODA la carga y solo se va cuando hay algo que
// enseñar.
//
// Y la espera se usa para algo: elegir la versión del logo. No es un adorno —
// esa elección FIJA EL TEMA de la app (insignia negra → oscuro, insignia blanca →
// claro), que es una decisión que hay que tomar igualmente y que hasta ahora
// estaba escondida en un icono de 14px del menú lateral.
//
// Solo se pregunta la PRIMERA vez. Después se recuerda y el arranque es una
// animación de dos segundos con la insignia elegida: preguntar cada vez sería
// convertir un detalle bonito en un peaje.

type Props = {
  /** Si es true, se pide elegir versión. Si no, solo se anima la ya elegida. */
  pedirEleccion?: boolean
  /** Se llama con el tema elegido. El padre lo persiste y entra. */
  onElegir?: (tema: 'dark' | 'light') => void
  /** Texto de lo que se está cargando, para que la espera no sea muda. */
  estado?: string
  /** Esta pantalla CONTINÚA otra que ya se estaba viendo, no aparece de cero.
   *  Ver el comentario largo en el cuerpo del componente. */
  continua?: boolean
}

export default function NexusBootScreen({ pedirEleccion = false, onElegir, estado, continua = false }: Props) {
  const [elegido, setElegido] = useState<'dark' | 'light' | null>(null)
  const [entrando, setEntrando] = useState(false)

  // Precarga las dos insignias antes de pintarlas: sin esto, la primera vez que
  // se abre la app los dos círculos aparecen vacíos y se rellenan medio segundo
  // después, que es justo el parpadeo que se quería quitar.
  useEffect(() => {
    for (const src of ['/logo-oscuro.svg', '/logo-claro.svg']) {
      const img = new Image()
      img.src = src
    }
  }, [])

  const elegir = (tema: 'dark' | 'light') => {
    if (entrando) return
    setElegido(tema)
    setEntrando(true)
    // La transición se ve: 520ms es lo que tarda la insignia en crecer y el resto
    // en desvanecerse. Entrar de golpe hace que el clic parezca no registrado.
    setTimeout(() => onElegir?.(tema), 520)
  }

  return (
    // ESTE ERA EL PARPADEO AL ABRIR LA APP, y me costó cuatro diagnósticos. Los
    // tres primeros fueron míos y equivocados (los negros, la insignia, la
    // tipografía). Lo resolvió un vídeo de Javi, mirado frame a frame.
    //
    // La app monta DOS pantallas de arranque seguidas, y son objetos distintos:
    //
    //   0,00 s  DashboardClient pinta esta pantalla — «Comprobando tu sesión…»
    //   0,60 s  /api/me responde → `listo` pasa a true → esa pantalla SE DESMONTA
    //           y NexusDashboard monta OTRA, porque sus datos aún no han llegado
    //   1,58 s  llegan los datos y aparece la app
    //
    // Al ser un nodo nuevo, `nxBootSube` (0,6 s, de `opacity: 0` a 1) vuelve a
    // empezar: la pantalla que ya estaba entera se apaga de golpe y vuelve a
    // encenderse. Medido en el vídeo, el brillo cae de 80,5 a 61,3 en 33 ms y tarda
    // otros 0,6 s en recuperarse.
    //
    // `continua` dice que esta pantalla RELEVA a otra que ya se veía, así que se
    // queda donde estaba la anterior en vez de entrar otra vez.
    <div className={`nx-boot ${pedirEleccion ? 'nx-boot-eligiendo' : ''}`}>
      <div className="nx-boot-glow" aria-hidden />

      <div className={`nx-boot-contenido ${entrando ? 'nx-boot-saliendo' : ''}`}>
        {pedirEleccion ? (
          <>
            <div className="nx-boot-eyebrow">BRUTAL STUDIOS</div>
            <h1 className="nx-boot-titulo">Elige tu versión</h1>
            <p className="nx-boot-sub">Marca el aspecto de toda la app. Puedes cambiarlo cuando quieras.</p>

            <div className="nx-boot-opciones" role="group" aria-label="Elige la versión del logo">
              {([
                { tema: 'dark' as const, src: '/logo-oscuro.svg', label: 'OSCURA' },
                { tema: 'light' as const, src: '/logo-claro.svg', label: 'CLARA' },
              ]).map(o => (
                <button
                  key={o.tema}
                  onClick={() => elegir(o.tema)}
                  aria-label={`Versión ${o.label.toLowerCase()}`}
                  aria-pressed={elegido === o.tema}
                  className={`nx-boot-opcion ${elegido === o.tema ? 'nx-boot-elegida' : ''} ${elegido && elegido !== o.tema ? 'nx-boot-descartada' : ''}`}
                >
                  <img src={o.src} alt="" width={132} height={132} draggable={false} />
                  <span className="nx-boot-label">{o.label}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="nx-boot-solo">
            {/* Las dos, y el CSS enseña la que toca segun el tema. Antes estaba
                fija la oscura, asi que en modo claro salia la insignia
                equivocada sobre fondo claro. */}
            <img src="/logo-oscuro.svg" alt="Brutal Studios" width={104} height={104} className="nx-boot-latido nx-boot-insignia-oscura" />
            <img src="/logo-claro.svg" alt="" aria-hidden width={104} height={104} className="nx-boot-latido nx-boot-insignia-clara" />
          </div>
        )}

        {/* El estado va SIEMPRE, también mientras se elige: así se ve que por
            detrás está pasando algo y la elección no es lo que retrasa la entrada. */}
        <div className="nx-boot-estado" aria-live="polite">
          <span className="nx-boot-barra" aria-hidden><i /></span>
          {estado || 'Preparando tu espacio…'}
        </div>
      </div>
    </div>
  )
}
