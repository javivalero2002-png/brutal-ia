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
}

export class SectionErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
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
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-5 py-2.5 rounded-xl font-syne text-[9px] font-black tracking-widest text-white"
              style={{background:`linear-gradient(135deg,${BLU},#1440CC)`}}>
              REINTENTAR
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
