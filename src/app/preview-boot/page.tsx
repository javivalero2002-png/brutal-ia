import { notFound } from 'next/navigation'
import { getAuthCtx } from '@/lib/authz'
import Cliente from './Cliente'

// La demo con datos de muestra. En desarrollo, abierta; en PRODUCCION, solo para
// el propietario con sesion.
//
// Antes devolvia 404 en produccion sin mas. El motivo escrito era «nunca expone
// datos ni UI sin auth en el entorno real», y sigue valiendo: aqui no hay ni un
// dato real —PreviewClient lleva su propio juego de muestra— y ahora ademas exige
// sesion y rol owner, que es la misma senal de autorizacion que usa el resto de la
// app (`profiles.role`, resuelto en el servidor).
//
// Para que sirve: es la unica forma de ensenar la app —o una seccion nueva— sin
// dar acceso a los datos del estudio.
// Existe porque la pantalla de arranque real vive tras el login y no hay forma de
// mirarla mientras se diseña.
export default async function PreviewBoot() {
  if (process.env.NODE_ENV === 'production') {
    const ctx = await getAuthCtx()
    if (ctx?.role !== 'owner') notFound()
  }
  return <Cliente />
}
