import { notFound } from 'next/navigation'
import PreviewClient from './PreviewClient'

// Ruta de preview SOLO para desarrollo. En producción devuelve 404 —
// nunca expone datos ni UI sin auth en el entorno real.
export default function PreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <PreviewClient />
}
