'use client'
import { useState, useEffect, useCallback } from 'react'
import { AvisoGoogle } from '@/components/shared'
import { BLU, GRN, AMBAR, AMARILLO, SURFACE, SURF2, BORDER, ACCENT_COLORS } from '@/components/shared/design-tokens'
import LucideIcon from '@/components/shared/LucideIcon'
import type { Profile } from '@/types'
import { promptGuardado, alCambiarPrompt, lanzarInstalacion, type PromptInstalacion } from '@/lib/instalarPwa'
import { activarPush } from '@/lib/activarPush'
import { RECORRIDO, TarjetaRecorrido } from '@/components/recorrido/RecorridoApp'

// ─────────────────────────────────────────────────────────────────────────────
// PUESTA EN MARCHA — lo primero que ve cada persona del equipo.
//
// Hasta ahora todo han sido pruebas: la gente entraba con una contraseña que le
// dieron, sin Gmail conectado y sin avisos. Esto convierte esos cabos sueltos en
// un recorrido de una vez.
//
// Tres decisiones que la hacen usable, y las tres son por lo mismo — que nadie se
// quede fuera de la app por culpa de la pantalla que debía darle la bienvenida:
//
// 1. NADA BLOQUEA. Todos los pasos se pueden saltar. Un proceso que no deja pasar
//    hasta conectar Gmail deja tirado a quien tenga el móvil sin sesión de Google,
//    y encima el primer día.
// 2. SE PUEDE VOLVER. Conectar Gmail sale de la app (OAuth), así que el paso se
//    guarda para retomarlo al volver.
// 3. LO IMPORTANTE VA MARCADO. La contraseña se destaca porque la actual se la dio
//    otra persona; el resto es preferencia.
// ─────────────────────────────────────────────────────────────────────────────

const CLAVE_PASO = 'nx_onboarding_paso'

// FUERA EL PASO DE CONTRASEÑA.
//
// Javi: «quítalo porque ya lo has hecho al principio, cuando pasó el enlace».
// El camino normal es el enlace de invitación, y ahí la contraseña se pone en
// esa misma pantalla treinta segundos antes: volver a pedirla en la primera
// pantalla de la app es explicar un motivo que no existe.
//
// Había un apaño —`nx_clave_elegida` en localStorage— que cambiaba el TEXTO
// según si la habías puesto, pero el paso salía igual. Y solo funcionaba si
// habías pasado por /reset-password en ESE navegador, así que con otro móvil
// o una pestaña privada volvía a decirte que te la había dado otra persona.
//
// No se pierde nada: cambiar la contraseña sigue estando en Operativa →
// Ajustes, que es donde se busca cuando se quiere cambiar — no en un recorrido
// de bienvenida.
const PASOS = ['Bienvenida', 'Tu ficha', 'Instalar', 'Gmail', 'Avisos', 'La app']


/**
 * Olvida el paso a medias. Se exporta porque quien REABRE el recorrido a mano
 * (Operativa → «Ver la puesta en marcha») tiene que empezar por el principio, y
 * si no se limpia esto aparecería en el paso donde lo dejó la última vez.
 *
 * Vive aquí y no escrita como cadena en quien la llama: la clave en dos sitios
 * es la forma de que un día cambie en uno y no en el otro.
 */
export function olvidarPasoGuardado() {
  try { localStorage.removeItem(CLAVE_PASO) } catch {}
}

// Los caminos para instalar la app, uno por sitio donde puede estar la gente.
//
// Safari NO tiene instalador que ofrecer, y no es un descuido de Apple: la
// petición de implementar `beforeinstallprompt` en WebKit está cerrada como
// WONTFIX, porque su postura es que cualquier web se añade desde Compartir y por
// eso no hace falta un aviso del navegador. O sea que aquí no hay botón posible
// ni lo va a haber: lo único que se puede hacer es que estas instrucciones sean
// tan buenas que den igual.
//
// Por eso van con el icono DIBUJADO y con el aviso de que hay que bajar en la
// hoja de compartir, que es justo donde se pierde todo el mundo: «Añadir a
// pantalla de inicio» queda por debajo de los contactos y las apps, fuera de lo
// que se ve sin desplazar.
type Camino = 'ios-safari' | 'ios-otro' | 'safari-mac' | 'otro'

const CAMINOS: Record<Camino, { donde: string; pasos: { texto: string; icono?: string; cola?: string }[] }> = {
  'ios-safari': {
    donde: 'EN IPHONE O IPAD, CON SAFARI',
    pasos: [
      { texto: 'Pulsa Compartir', icono: 'share', cola: 'en la barra de abajo' },
      { texto: 'Baja por la lista hasta «Añadir a pantalla de inicio» — está más abajo de lo que parece' },
      { texto: 'Confirma con «Añadir», arriba a la derecha' },
    ],
  },
  'ios-otro': {
    donde: 'EN IPHONE O IPAD, CON CHROME',
    pasos: [
      { texto: 'Pulsa el menú', icono: 'more-vertical', cola: 'abajo a la derecha' },
      { texto: 'Elige «Añadir a pantalla de inicio»' },
      { texto: 'Confirma con «Añadir»' },
    ],
  },
  'safari-mac': {
    donde: 'EN SAFARI, EN EL MAC',
    pasos: [
      // Está en DOS sitios y conviene decir los dos: el menú Archivo se pasa por
      // alto (no hay nada en la página que lo sugiera) y el botón de Compartir se
      // ve. Javi buscó esto y no encontró nada con una sola pista.
      { texto: 'Pulsa Compartir', icono: 'share', cola: 'en la barra de Safari — o abre el menú Archivo' },
      { texto: 'Elige «Añadir al Dock»' },
      { texto: 'Ponle el nombre que quieras y confirma con «Añadir»' },
    ],
  },
  otro: {
    donde: 'EN ESTE NAVEGADOR',
    pasos: [
      { texto: 'Abre el menú del navegador (los tres puntos)' },
      { texto: 'Busca «Instalar aplicación» o «Añadir a la pantalla de inicio»' },
      { texto: 'Confirma' },
    ],
  },
}

interface Props {
  profile: Profile
  onTerminar: () => void
  showToast: (m: string) => void
}

export default function PuestaEnMarcha({ profile, onTerminar, showToast }: Props) {
  const [paso, setPaso] = useState(0)
  const [guardando, setGuardando] = useState(false)

  // Perfil
  const [nombre, setNombre] = useState(profile?.name || '')
  const [iniciales, setIniciales] = useState(profile?.initials || '')
  const [color, setColor] = useState(profile?.avatar_color || BLU)

  const [avisos, setAvisos] = useState(false)
  // En qué pantalla del recorrido va. Vive aquí y no dentro de `TarjetaRecorrido`
  // porque quien lo mueve son los botones del pie, que son de esta ventana.
  const [tour, setTour] = useState(0)


  // LAS CUENTAS DE VERDAD, no la columna vieja.

  //

  // Javi: «me pone que estoy conectado a este correo, pero en verdad estoy

  // conectado a dos». Aqui se leia `profile.gmail_account`, que es la columna

  // de UNA sola direccion de antes de `gmail_cuentas` — asi que con varias

  // conectadas ensenaba la que se hubiera guardado la ultima, y las demas

  // no existian para esta pantalla.

  //

  // `null` mientras no se sabe: un array vacio significa «ninguna conectada»,

  // que es otra cosa, y con el se pintaria CONECTAR a quien ya las tiene.

  const [buzones, setBuzones] = useState<{ email: string; compartida: boolean }[] | null>(null)

  useEffect(() => {

    let vivo = true

    fetch('/api/gmail/cuentas')

      .then(r => (r.ok ? r.json() : null))

      .then(j => { if (vivo && j) setBuzones(Array.isArray(j.cuentas) ? j.cuentas : []) })

      .catch(() => {})

    return () => { vivo = false }

  }, [])

  // Instalar la app. Los navegadores NO se comportan igual y ese es todo el
  // problema de este paso:
  //   · Chrome (Android y escritorio) dispara `beforeinstallprompt` -> se puede
  //     ofrecer un botón que instala de verdad.
  //   · Safari no implementa ese evento, ni en iPhone ni en Mac. Ahí no hay
  //     botón posible y solo caben instrucciones.
  // Por eso no se detecta el navegador para decidir: se GUARDA el evento si
  // llega, y las instrucciones son el camino de quien no lo tiene. Así un
  // navegador que mañana lo implemente entra solo por la rama buena.
  const [promptInstalar, setPromptInstalar] = useState<PromptInstalacion | null>(null)
  const [yaInstalada, setYaInstalada] = useState(false)
  const [comoInstalar, setComoInstalar] = useState<Camino>('otro')

  // Al volver de Google se retoma donde estaba. Sin esto, conectar Gmail te
  // devolvía al principio y había que pasar otra vez por todo.
  useEffect(() => {
    try {
      const guardado = Number(localStorage.getItem(CLAVE_PASO))
      // ACOTADO AL ÚLTIMO PASO QUE EXISTE. Sin esto, un número guardado que ya no
      // existe revienta el render entero: `PASOS[6]` es `undefined` y
      // `.toUpperCase()` lanza. Y como el valor vive en localStorage, pasa en CADA
      // carga — la app queda inaccesible sin abrir la consola del navegador.
      //
      // No es teórico: hoy mismo se quitó el paso de contraseña y la lista pasó de
      // 7 a 6. Quien hubiera llegado a «Listo» sin pulsar ENTRAR tenía un 6
      // guardado, y ese 6 ya no es un paso.
      //
      // Esta pantalla es la única que se interpone entre alguien y su herramienta
      // de trabajo: si falla, no falla una sección, falla el acceso.
      if (Number.isFinite(guardado) && guardado > 0) setPaso(Math.min(guardado, PASOS.length - 1))
    } catch { /* sin localStorage se empieza por el principio, que tampoco es grave */ }
  }, [])

  useEffect(() => {
    // Puede que el evento ya hubiera llegado antes de montar: se pregunta Y se
    // escucha, porque cualquiera de las dos por su cuenta se deja un caso.
    setPromptInstalar(promptGuardado())
    const dejar = alCambiarPrompt(setPromptInstalar)

    try {
      const ua = navigator.userAgent
      const iOS = /iphone|ipad|ipod/i.test(ua) ||
        // iPadOS 13+ se presenta como Mac; lo que lo delata es que tiene táctil.
        (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
      // En iPhone TODOS los navegadores son WebKit por dentro, así que ninguno
      // instala solo — pero el botón no está en el mismo sitio: Safari lo tiene
      // en la barra y Chrome lo esconde en su menú de tres puntos. Mandar a todo
      // el mundo al de Safari deja tirado a quien use Chrome, que es medio equipo.
      const safari = /safari/i.test(ua) && !/chrome|chromium|crios|edg|firefox|fxios/i.test(ua)
      setComoInstalar(iOS ? (safari ? 'ios-safari' : 'ios-otro') : safari ? 'safari-mac' : 'otro')
      setYaInstalada(
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true,
      )
    } catch {}

    return dejar
  }, [])

  const irA = useCallback((n: number) => {
    setPaso(n)
    try { localStorage.setItem(CLAVE_PASO, String(n)) } catch {}
  }, [])

  const terminar = useCallback(async () => {
    setGuardando(true)
    try {
      const res = await fetch('/api/onboarding', { method: 'POST' })
      if (!res.ok) showToast('No se pudo guardar — te la volveremos a enseñar')
      onTerminar()
    } catch {
      showToast('No se pudo guardar — te la volveremos a enseñar')
      onTerminar()
    } finally {
      // En las DOS ramas: si falla el POST y el paso guardado sobrevive, al
      // volver a abrirla se cae a mitad del recorrido en vez de al principio.
      olvidarPasoGuardado()
      // Y la marca de «ya elegí contraseña»: si algún día se vuelve a hacer la
      // puesta en marcha —porque se reseteó, o porque entra en otro sitio— el paso
      // tiene que decidir de nuevo, no arrastrar lo de la vez anterior.
      try { localStorage.removeItem('nx_clave_elegida') } catch {}
      setGuardando(false)
    }
  }, [onTerminar, showToast])

  const guardarPerfil = async () => {
    setGuardando(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nombre.trim(), initials: iniciales.trim().slice(0, 2).toUpperCase(), avatar_color: color }),
      })
      if (!res.ok) { showToast('No se pudo guardar tu ficha'); return }
      irA(2)
    } catch { showToast('No se pudo guardar tu ficha') }
    finally { setGuardando(false) }
  }
  const activarAvisos = async () => {
    setGuardando(true)
    // Pedir el permiso NO basta: sin suscripción en el servidor no llega ni un
    // aviso. Va por `activarPush()` para que esto y Operativa no puedan volver a
    // separarse. Ver el comentario de src/lib/activarPush.ts.
    const r = await activarPush()
    setGuardando(false)
    if (!r.ok) { showToast(r.mensaje); return }
    setAvisos(true)
    showToast('Avisos activados')
  }

  // El ASPECTO no está aquí a propósito: ya se elige al arrancar la app, en la
  // pantalla de la insignia, y con mejor tratamiento que unas muestras de color.
  // Repetirlo aquí sería preguntar dos veces lo mismo en el primer minuto.
  const ultimo = PASOS.length - 1

  const Cabecera = ({ icono, eyebrow, titulo, bajada, opcional }: { icono: string; eyebrow: string; titulo: string; bajada: string; opcional?: boolean }) => (
    <div className="flex items-start gap-3 mb-5">
      <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
        style={{ background: `${BLU}1A`, border: `1px solid ${BLU}42` }}>
        <LucideIcon name={icono} size={17} color={BLU} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <div className="font-syne text-[8px] font-black tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.3)' }}>{eyebrow}</div>
          {/* Que se vea que se puede saltar, y no en letra pequeña al final.
              Quien llega por el enlace de invitación YA ha puesto su contraseña en
              esa pantalla: para esa persona —que son casi todas— este paso está
              hecho. Sin el distintivo parece un trámite obligatorio más, y eso hace
              que la gente escriba una contraseña nueva sin necesitarlo. */}
          {opcional && (
            <span className="font-syne text-[7.5px] font-black tracking-[0.18em] px-1.5 py-0.5 rounded-full"
              style={{ background: 'rgba(255,176,32,0.1)', border: '1px solid rgba(255,176,32,0.28)', color: 'rgba(255,176,32,0.85)' }}>
              OPCIONAL
            </span>
          )}
        </div>
        <h2 className="font-figtree text-[19px] font-black text-white leading-tight" style={{ letterSpacing: '-0.02em' }}>{titulo}</h2>
        <p className="font-figtree text-[12.5px] mt-1.5 leading-snug" style={{ color: 'rgba(255,255,255,0.42)' }}>{bajada}</p>
      </div>
    </div>
  )

  const Boton = ({ children, onClick, primario, disabled }: { children: React.ReactNode; onClick: () => void; primario?: boolean; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled || guardando}
      className="px-5 py-2.5 rounded-2xl font-syne text-[9px] font-black tracking-widest transition-all active:scale-95 disabled:opacity-40"
      style={primario
        ? { background: `linear-gradient(140deg, ${BLU}42, ${AMARILLO}1A)`, border: `1px solid ${BLU}66`, color: '#DCE6FF' }
        : { border: `1px solid ${BORDER}`, color: 'rgba(255,255,255,0.4)' }}>
      {children}
    </button>
  )

  const campo = 'w-full px-3.5 py-3 rounded-2xl text-[13px] text-white placeholder-white/20 outline-none'
  const estiloCampo = { background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, caretColor: BLU }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" style={{ background: 'rgba(2,2,10,0.88)', backdropFilter: 'blur(10px)' }}>
      <div className="w-full rounded-3xl overflow-hidden flex flex-col" style={{ maxWidth: '30rem', maxHeight: '92vh', background: SURFACE, border: `1px solid ${BLU}2E` }}>

        {/* La cabecera de la marca. Sin esto la ventana podía ser la de cualquier
            app: es la primera pantalla que ve el equipo y tiene que decir de quién
            es. El logotipo sale de `public/`, que es donde ya vive el de login. */}
        <div className="relative px-5 pt-5 pb-4 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: `radial-gradient(120% 100% at 12% 0%, ${BLU}1F, transparent 62%), radial-gradient(80% 70% at 92% 0%, ${AMARILLO}12, transparent 60%)` }} />
          <div className="relative flex items-center gap-3">
            <img src="/logo-oscuro.svg" alt="Brutal Studios" width={34} height={34} className="nx-boot-insignia-oscura flex-shrink-0" />
            <img src="/logo-claro.svg" alt="" aria-hidden width={34} height={34} className="nx-boot-insignia-clara flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <img src="/brutal-logo.svg" alt="" aria-hidden style={{ height: '13px', opacity: 0.9 }} />
              <div className="font-syne text-[7px] font-black tracking-[0.24em] mt-1" style={{ color: AMARILLO }}>PUESTA EN MARCHA</div>
            </div>
          </div>
        </div>

        {/* Progreso. Enseña cuántos pasos quedan: sin eso, un proceso de siete
            pantallas parece que no se acaba nunca. */}
        <div className="flex gap-1 px-5">
          {PASOS.map((_, i) => (
            <div key={i} className="flex-1 rounded-full" style={{ height: '3px', background: i <= paso ? BLU : 'rgba(255,255,255,0.08)' }} />
          ))}
        </div>
        <div className="px-5 pt-2.5 font-syne text-[7.5px] font-black tracking-widest" style={{ color: 'rgba(255,255,255,0.25)' }}>
          PASO {paso + 1} DE {PASOS.length} · {PASOS[paso].toUpperCase()}
        </div>

        <div className="px-5 py-5 overflow-y-auto flex-1">

          {paso === 0 && (
            <>
              <div className="flex flex-col items-center text-center mb-5">
                <div className="relative mb-3.5">
                  <div className="absolute inset-0 rounded-full blur-xl" style={{ background: `${BLU}30` }} />
                  <img src="/logo-oscuro.svg" alt="Brutal Studios" width={82} height={82} className="nx-boot-insignia-oscura relative" />
                  <img src="/logo-claro.svg" alt="" aria-hidden width={82} height={82} className="nx-boot-insignia-clara relative" />
                </div>
                <h2 className="font-figtree text-[21px] font-black text-white leading-tight" style={{ letterSpacing: '-0.02em' }}>
                  Bienvenido, {(profile?.name || '').split(' ')[0] || 'compañero'}
                </h2>
                <p className="font-figtree text-[12.5px] mt-2 leading-snug px-2" style={{ color: 'rgba(255,255,255,0.42)' }}>
                  Vamos a dejar tu cuenta lista en un minuto. Puedes saltarte cualquier paso y hacerlo luego desde Operativa.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {[
                  { i: 'user', t: 'Tu ficha', d: 'Nombre, iniciales y color con los que te verá el equipo' },
                  { i: 'download', t: 'Instalar la app', d: 'Acceso directo, sin barra del navegador' },
                  { i: 'mail', t: 'Gmail', d: 'Para que tu correo entre en la app' },
                  { i: 'bell', t: 'Avisos', d: 'Notificaciones de lo urgente' },
                  { i: 'layout-grid', t: 'La app', d: 'Un repaso de qué hace cada pantalla' },
                ].map(x => (
                  <div key={x.t} className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl" style={{ background: SURF2, border: `1px solid ${BORDER}` }}>
                    <LucideIcon name={x.i} size={14} color="rgba(255,255,255,0.35)" />
                    <div className="flex-1 min-w-0">
                      <div className="font-figtree text-[12.5px] font-semibold text-white">{x.t}</div>
                      <div className="font-figtree text-[11px]" style={{ color: 'rgba(255,255,255,0.32)' }}>{x.d}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {paso === 1 && (
            <>
              <Cabecera icono="user" eyebrow="TU FICHA" titulo="Cómo te ve el equipo"
                bajada="Tus iniciales y tu color salen en cada tarea, en el diario y en el calendario." />
              <div className="flex items-center gap-3 mb-4">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 font-syne text-[15px] font-black"
                  style={{ background: `${color}26`, color, border: `1px solid ${color}45` }}>
                  {(iniciales || nombre.slice(0, 2) || '??').toUpperCase()}
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Tu nombre" className={campo} style={estiloCampo} />
                  <input value={iniciales} onChange={e => setIniciales(e.target.value.slice(0, 2))} placeholder="Iniciales" maxLength={2}
                    className={campo} style={{ ...estiloCampo, textTransform: 'uppercase' }} />
                </div>
              </div>
              <div className="font-syne text-[7.5px] font-black tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.28)' }}>TU COLOR</div>
              <div className="flex flex-wrap gap-2">
                {ACCENT_COLORS.map(c => (
                  <button key={c} onClick={() => setColor(c)} aria-label={`Color ${c}`}
                    className="w-8 h-8 rounded-xl transition-all active:scale-90"
                    style={{ background: `${c}30`, border: `2px solid ${color === c ? c : 'transparent'}` }}>
                    <span className="block w-3 h-3 rounded-full mx-auto" style={{ background: c }} />
                  </button>
                ))}
              </div>
            </>
          )}

          {paso === 2 && (
            <>
              <Cabecera icono="download" eyebrow="ACCESO DIRECTO" titulo="Instala Nexus"
                bajada="Se abre a pantalla completa, sin barra del navegador, y los avisos llegan aunque la tengas cerrada." />
              {yaInstalada ? (
                <div className="flex items-center gap-2 px-3.5 py-3 rounded-2xl font-figtree text-[12.5px]"
                  style={{ background: `${GRN}10`, border: `1px solid ${GRN}30`, color: GRN }}>
                  <LucideIcon name="check" size={14} color={GRN} /> Ya la estás usando instalada
                </div>
              ) : promptInstalar ? (
                /* Android y escritorio dan un instalador de verdad: un boton, no
                   instrucciones. Se usa siempre que el navegador lo ofrezca. */
                <button onClick={lanzarInstalacion}
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl font-syne text-[9px] font-black tracking-widest"
                  style={{ background: `${AMARILLO}1A`, border: `1px solid ${AMARILLO}45`, color: AMARILLO }}>
                  <LucideIcon name="download" size={13} color={AMARILLO} />
                  INSTALAR AHORA
                </button>
              ) : (
                /* iOS no lo ofrece: Safari obliga a hacerlo a mano. Se dan los
                   pasos de SU navegador y no una lista de todos los casos, que es
                   lo que convierte esta pantalla en la peor del recorrido. */
                <div className="rounded-2xl px-4 py-3.5" style={{ background: SURF2, border: `1px solid ${BORDER}` }}>
                  <div className="font-syne text-[7.5px] font-black tracking-widest mb-2.5" style={{ color: AMARILLO }}>
                    {CAMINOS[comoInstalar].donde}
                  </div>
                  <ol className="flex flex-col gap-2.5">
                    {CAMINOS[comoInstalar].pasos.map((p, k) => (
                      <li key={k} className="flex items-start gap-2.5">
                        <span className="flex items-center justify-center flex-shrink-0 rounded-full font-syne text-[8px] font-black"
                          style={{ width: '17px', height: '17px', background: `${AMARILLO}22`, color: AMARILLO, marginTop: '1px' }}>{k + 1}</span>
                        <span className="font-figtree text-[12.5px] leading-snug" style={{ color: 'rgba(255,255,255,0.7)' }}>
                          {p.texto}
                          {/* El icono va DIBUJADO, no descrito. «El botón de
                              Compartir» no le dice nada a quien nunca se ha
                              fijado; el cuadrado con la flecha lo reconoce
                              cualquiera en cuanto lo ve en su pantalla. */}
                          {p.icono && (
                            <span className="inline-flex items-center justify-center align-middle rounded-md mx-1"
                              style={{ width: '22px', height: '22px', background: `${AMARILLO}1A`, border: `1px solid ${AMARILLO}38` }}>
                              <LucideIcon name={p.icono} size={13} color={AMARILLO} />
                            </span>
                          )}
                          {p.cola}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <p className="font-figtree text-[11px] mt-3" style={{ color: 'rgba(255,255,255,0.28)' }}>
                Hazlo desde <strong style={{ color: 'rgba(255,255,255,0.5)' }}>brutalia.tech</strong>, que es la dirección buena.
              </p>
            </>
          )}

          {paso === 3 && (
            <>
              <Cabecera icono="mail" eyebrow="CORREO" titulo="Conecta tu Gmail"
                bajada="Tus correos entran en Inbox y la IA te marca los urgentes. Nexus no manda correo en tu nombre." />
              {/* Las conectadas, TODAS. Mientras el servidor no conteste se usa
                  `gmail_connected` del perfil para no pintar CONECTAR a quien ya
                  las tiene: es peor equivocarse hacia ese lado. */}
              {(buzones === null ? !!profile?.gmail_connected : buzones.length > 0) ? (
                <div className="flex flex-col gap-1.5">
                  {(buzones && buzones.length ? buzones : [{ email: profile?.gmail_account || '', compartida: false }]).map(b => (
                    <div key={b.email} className="flex items-center gap-2 px-3.5 py-3 rounded-2xl font-figtree text-[12.5px]"
                      style={{ background: `${GRN}10`, border: `1px solid ${GRN}30`, color: GRN }}>
                      <LucideIcon name="check" size={14} color={GRN} />
                      <span className="break-all">{b.email || 'Ya está conectado'}{b.compartida ? ' · compartido' : ''}</span>
                    </div>
                  ))}
                  {/* Conectar OTRA sigue disponible aquí: es donde la gente se da
                      cuenta de que tiene dos correos, no en Operativa tres días
                      después. */}
                  <a href="/api/gmail/connect?account=personal"
                    onClick={() => irA(paso)}
                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-2xl font-syne text-[8.5px] font-black tracking-widest mt-0.5"
                    style={{ background: 'rgba(255,255,255,0.03)', border: `1px dashed ${BORDER}`, color: 'rgba(255,255,255,0.4)' }}>
                    <LucideIcon name="plus" size={12} color="rgba(255,255,255,0.4)" />
                    CONECTAR OTRA CUENTA
                  </a>
                </div>
              ) : (
                <>
                  {/* Se avisa de que sale de la app: si no, el salto a Google parece
                      que ha pasado algo raro justo el primer día. */}
                  <p className="font-figtree text-[11.5px] mb-3" style={{ color: 'rgba(255,255,255,0.32)' }}>
                    Se abrirá Google para que des permiso. Al volver seguimos donde lo dejaste.
                  </p>
                  <div className="mb-3"><AvisoGoogle /></div>
                  <a href="/api/gmail/connect?account=personal"
                    onClick={() => irA(paso)}
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl font-syne text-[9px] font-black tracking-widest"
                    style={{ background: `${BLU}18`, border: `1px solid ${BLU}38`, color: BLU }}>
                    <LucideIcon name="mail" size={13} color={BLU} />
                    CONECTAR GMAIL
                  </a>
                </>
              )}
            </>
          )}

          {paso === 4 && (
            <>
              <Cabecera icono="bell" eyebrow="AVISOS" titulo="Que te avise de lo urgente"
                bajada="Solo para lo que no puede esperar: un correo urgente de cliente o una tarea que vence hoy." />
              {avisos ? (
                <div className="flex items-center gap-2 px-3.5 py-3 rounded-2xl font-figtree text-[12.5px]"
                  style={{ background: `${GRN}10`, border: `1px solid ${GRN}30`, color: GRN }}>
                  <LucideIcon name="check" size={14} color={GRN} /> Avisos activados
                </div>
              ) : (
                <button onClick={activarAvisos}
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl font-syne text-[9px] font-black tracking-widest"
                  style={{ background: `${AMBAR}18`, border: `1px solid ${AMBAR}38`, color: AMBAR }}>
                  <LucideIcon name="bell" size={13} color={AMBAR} />
                  ACTIVAR AVISOS
                </button>
              )}
            </>
          )}

          {paso === ultimo && <TarjetaRecorrido i={tour} />}
        </div>

        {/* Nada bloquea: siempre se puede saltar. Un proceso que retiene a alguien
            fuera de la app el primer día es peor que uno incompleto. */}
        <div className="flex items-center gap-2 px-5 py-4" style={{ borderTop: `1px solid ${BORDER}` }}>
          {paso > 0 && paso < ultimo && (
            <Boton onClick={() => irA(paso - 1)}>ATRÁS</Boton>
          )}
          {/* En el recorrido, ATRÁS retrocede una PANTALLA del recorrido, no un
              paso. Volver a Avisos desde la sexta maqueta seria perder las cinco
              anteriores por querer ver la anterior. */}
          {paso === ultimo && tour > 0 && (
            <Boton onClick={() => setTour(tour - 1)}>ATRÁS</Boton>
          )}
          <div className="flex-1" />
          {paso < ultimo && (
            <button onClick={() => irA(paso + 1)}
              className="px-3 py-2.5 font-syne text-[9px] font-black tracking-widest"
              style={{ color: 'rgba(255,255,255,0.3)' }}>
              SALTAR
            </button>
          )}
          {/* Tambien se salta el recorrido, por lo mismo que todo lo demas: nada
              retiene a nadie fuera de la app el primer dia. */}
          {paso === ultimo && tour < RECORRIDO.length - 1 && (
            <button onClick={terminar}
              className="px-3 py-2.5 font-syne text-[9px] font-black tracking-widest"
              style={{ color: 'rgba(255,255,255,0.3)' }}>
              SALTAR
            </button>
          )}
          {paso === 0 && <Boton primario onClick={() => irA(1)}>EMPEZAR</Boton>}
          {paso === 1 && <Boton primario onClick={guardarPerfil}>GUARDAR</Boton>}
          {(paso === 2 || paso === 3 || paso === 4) && <Boton primario onClick={() => irA(paso + 1)}>SIGUIENTE</Boton>}
          {paso === ultimo && (tour < RECORRIDO.length - 1
            ? <Boton primario onClick={() => setTour(tour + 1)}>SIGUIENTE</Boton>
            : <Boton primario onClick={terminar}>ENTRAR EN NEXUS</Boton>)}
        </div>
      </div>
    </div>
  )
}
