'use client'

export default function NexusBootScreen() {
  return (
    <div style={{
      height: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#030308',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Radial glow background */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(ellipse 600px 400px at 50% 50%, rgba(27,95,250,0.07) 0%, transparent 70%)',
        pointerEvents: 'none',
      }}/>

      {/* Content — animated fade+rise */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        animation: 'bootFadeIn 0.6s cubic-bezier(0.22,1,0.36,1) both',
      }}>
        {/* Logo — BS monogram con borde y glow azul */}
        <div style={{
          width: '68px',
          height: '68px',
          borderRadius: '18px',
          background: 'rgba(27,95,250,0.08)',
          border: '1.5px solid rgba(27,95,250,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '24px',
          animation: 'logoPulse 2.8s ease-in-out infinite',
          flexShrink: 0,
        }}>
          <span style={{
            fontFamily: 'Syne, sans-serif',
            fontWeight: 900,
            fontSize: '26px',
            color: '#1B5FFA',
            letterSpacing: '-2px',
            lineHeight: 1,
            userSelect: 'none',
          }}>BS</span>
        </div>

        {/* Wordmark */}
        <div style={{
          fontFamily: 'Syne, sans-serif',
          fontWeight: 900,
          fontSize: '28px',
          color: 'white',
          letterSpacing: '-0.04em',
          lineHeight: 1,
          marginBottom: '6px',
        }}>BRUTAL.IA</div>

        <div style={{
          fontFamily: 'Syne, sans-serif',
          fontWeight: 700,
          fontSize: '8.5px',
          letterSpacing: '0.28em',
          color: 'rgba(255,255,255,0.18)',
          marginBottom: '44px',
        }}>NEXUS DASHBOARD</div>

        {/* Scan bar */}
        <div style={{
          width: '160px',
          height: '1.5px',
          background: 'rgba(255,255,255,0.06)',
          borderRadius: '2px',
          overflow: 'hidden',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '40%',
            height: '100%',
            background: 'linear-gradient(90deg, transparent 0%, #1B5FFA 40%, #6fa0ff 60%, transparent 100%)',
            animation: 'scanLoop 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          }}/>
        </div>
      </div>

      {/* Corner marks — subtle grid reference */}
      {[['0,0','0,0'],['100%,0','0,0'],['0,100%','0,0'],['100%,100%','0,0']].map((_,i)=>(
        <div key={i} style={{
          position:'absolute',
          [i%2===0?'left':'right']:'20px',
          [i<2?'top':'bottom']:'20px',
          width:'16px',
          height:'16px',
          borderTop: i<2 ? '1px solid rgba(27,95,250,0.18)' : 'none',
          borderBottom: i>=2 ? '1px solid rgba(27,95,250,0.18)' : 'none',
          borderLeft: i%2===0 ? '1px solid rgba(27,95,250,0.18)' : 'none',
          borderRight: i%2!==0 ? '1px solid rgba(27,95,250,0.18)' : 'none',
        }}/>
      ))}
    </div>
  )
}
