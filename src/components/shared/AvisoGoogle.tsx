'use client'
import LucideIcon from './LucideIcon'
import { APP_HOST } from '@/lib/appUrl'

/**
 * El aviso de «aplicación no verificada», CONTADO ANTES de que salga.
 *
 * `gmail.readonly` es un permiso **restringido** de Google. Quitar esa pantalla
 * pide pasar su verificación y una auditoría de seguridad — para una herramienta
 * interna de siete personas eso no tiene ningún sentido, así que la pantalla se
 * queda. Es una decisión, no un descuido.
 *
 * Y una pantalla roja que avisa de un riesgo de seguridad, sin previo aviso, hace
 * exactamente lo que Google quiere que haga: que la persona se eche atrás. Lo que
 * la desactiva no es esconderla — es haberla anunciado tú primero. Si te lo
 * contaron antes de que pasara, deja de ser una alarma y pasa a ser un trámite.
 *
 * Va con los pasos LITERALES («Configuración avanzada», «Ir a …») porque el texto
 * de esos botones es lo único que uno busca con la vista cuando está nervioso.
 *
 * ESTÁ EN UN SOLO SITIO A PROPÓSITO. Hay cuatro botones de conectar repartidos en
 * tres pantallas —puesta en marcha, Ajustes y Sincronización, esta última con
 * dos—. Escribir el aviso en una sola es cómo nace un gemelo en este repo: se
 * mejora el texto en la que se está mirando y las otras se quedan atrás. Hay una
 * regla en `regresiones.test.ts` que exige este componente allí donde se enlace a
 * `/api/gmail/connect`.
 */

/**
 * Los dos pasos, con el TEXTO LITERAL de lo que hay que pulsar.
 *
 * Primer intento: un dibujo en SVG de las dos pantallas de Google, en miniatura.
 * Se descartó al mirarlo — a ese tamaño los enlaces resaltados parecían barras de
 * progreso, y una miniatura de una pantalla llena de texto ilegible no informa de
 * nada. Un adorno con forma de instrucción es peor que ninguna instrucción.
 *
 * Lo que de verdad hace falta no es reproducir la pantalla: es que cuando aparezca,
 * la persona reconozca DÓNDE pulsar. Y lo que se reconoce es el texto exacto del
 * enlace, que además es lo más pequeño y apagado de esa pantalla —eso es el diseño
 * de Google, que quiere que pulses el botón azul de volver—.
 *
 * Así que se enseñan los dos textos tal cual, en orden, en el mismo ámbar del
 * aviso. Se lee de un vistazo, pesa cero y no hay nada que se pueda malinterpretar.
 */
function PasosGoogle() {
  const pasos = ['Configuración avanzada', `Ir a ${APP_HOST} (no seguro)`]
  return (
    <div className="flex flex-col gap-1.5 mt-2.5">
      {pasos.map((t, i) => (
        <div key={t} className="flex items-center gap-2">
          <span className="flex items-center justify-center flex-shrink-0 rounded-full font-syne text-[8px] font-black"
            style={{ width: 15, height: 15, background: 'rgba(255,176,32,0.16)', color: 'rgba(255,176,32,0.9)' }}>
            {i + 1}
          </span>
          <span className="font-figtree text-[11.5px] truncate" style={{ color: 'rgba(255,176,32,0.85)', textDecoration: 'underline', textUnderlineOffset: 2 }}>
            {t}
          </span>
        </div>
      ))}
    </div>
  )
}

export function AvisoGoogle({ compacto }: { compacto?: boolean }) {
  return (
    <div className="rounded-2xl px-3.5 py-3"
      style={{ background: 'rgba(255,176,32,0.06)', border: '1px solid rgba(255,176,32,0.2)' }}>
      <div className="flex items-center gap-2 mb-1.5">
        <LucideIcon name="alert-triangle" size={13} color="rgba(255,176,32,0.85)" />
        <span className="font-syne text-[8px] font-black tracking-[0.18em]" style={{ color: 'rgba(255,176,32,0.85)' }}>
          GOOGLE TE VA A AVISAR
        </span>
      </div>
      <p className="font-figtree text-[11.5px] leading-snug" style={{ color: 'rgba(255,255,255,0.45)' }}>
        Dirá que <strong style={{ color: 'rgba(255,255,255,0.7)' }}>la aplicación no está verificada</strong>. Es normal:
        Nexus es nuestra, no está en ninguna tienda y no la ha revisado Google.
        Está escondido: hay que pulsar estas dos cosas, en este orden.
      </p>
      {/* El dibujo va en las DOS versiones: es lo que más rápido se entiende, y
          quien reconecta desde Sincronización lo agradece igual que quien entra
          por primera vez. */}
      <PasosGoogle />
      {!compacto && (
        <p className="font-figtree text-[11px] mt-1.5 leading-snug" style={{ color: 'rgba(255,255,255,0.28)' }}>
          Nexus solo LEE tu correo. No puede enviar ni borrar nada en tu nombre.
        </p>
      )}
    </div>
  )
}
