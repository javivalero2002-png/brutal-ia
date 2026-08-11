'use client'
import React from 'react'
import { BLU, RED, SURFACE, BORDER } from './design-tokens'
import LucideIcon from './LucideIcon'

interface Props {
  section: string
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  /** Cadena de componentes hasta el fallo: es lo que de verdad lo localiza. */
  pila?: string
  copiado?: boolean
}

export class SectionErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null, pila: '', copiado: false }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  // Sin esto el fallo no quedaba registrado en NINGÚN sitio: la persona pulsaba
  // REINTENTAR, la pantalla se recomponía y nadie más se enteraba de que había
  // pasado. Un servicio de reporte de errores es desproporcionado para 7
  // personas, pero dejarlo en la consola cuesta cero y hace el fallo
  // diagnosticable si alguien mira.
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[sección:${this.props.section}]`, error, info.componentStack)
    this.setState({ pila: info.componentStack || '' })
  }

  // El mensaje suelto casi nunca basta para saber qué pasó, y pedirle a alguien
  // que transcriba a mano lo que ve en pantalla no funciona. Con esto se copia
  // entero y se pega en un mensaje.
  copiarDetalles = () => {
    const { section } = this.props
    const { error, pila } = this.state
    const texto = [
      `Sección: ${section}`,
      `Error: ${error?.message || '(sin mensaje)'}`,
      `Cuándo: ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}`,
      pila ? `\n${pila.trim()}` : '',
    ].join('\n')
    navigator.clipboard?.writeText(texto)
      .then(() => this.setState({ copiado: true }))
      .catch(() => {})
    setTimeout(() => this.setState({ copiado: false }), 2000)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full flex items-center justify-center p-8">
          <div className="text-center max-w-[400px]">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{background:`${RED}15`,border:`1px solid ${RED}30`}}>
              <LucideIcon name="alert-circle" size={20} color={RED}/>
            </div>
            <div className="font-syne text-[9px] font-black tracking-widest mb-2" style={{color:`${RED}80`}}>ERROR EN {this.props.section.toUpperCase()}</div>
            <p className="text-[13px] mb-4" style={{color:'rgba(255,255,255,0.5)'}}>
              Algo ha fallado en esta sección. El resto de la app sigue funcionando.
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null, pila: '', copiado: false })}
              className="px-5 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest text-white"
              style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
              REINTENTAR
            </button>
            <button
              onClick={this.copiarDetalles}
              className="ml-2 px-4 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest"
              style={{background:'rgba(255,255,255,0.05)',border:`1px solid ${BORDER}`,color:'rgba(255,255,255,0.55)'}}>
              {this.state.copiado ? 'COPIADO ✓' : 'COPIAR DETALLES'}
            </button>
            {this.state.error && (
              <div className="mt-4 p-3 rounded-xl text-left" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
                <pre className="text-[10px] overflow-auto max-h-[100px]" style={{color:'rgba(255,255,255,0.3)'}}>
                  {this.state.error.message}
                </pre>
              </div>
            )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
