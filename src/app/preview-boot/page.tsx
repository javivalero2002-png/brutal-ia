import { notFound } from 'next/navigation'
import Cliente from './Cliente'

// Ruta de preview SOLO para desarrollo, igual que /preview: en producción 404.
// Existe porque la pantalla de arranque real vive tras el login y no hay forma de
// mirarla mientras se diseña.
export default function PreviewBoot() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Cliente />
}
