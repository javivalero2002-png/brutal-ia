# Nexus · BRUTAL.IA

Herramienta interna de Brutal Studios. Reúne en un sitio lo que un estudio de
siete personas tiene repartido entre el correo, el calendario, un tablero de
tareas y la cabeza de cada uno.

Vive en **[brutalia.tech](https://brutalia.tech)**. Es una PWA: se instala en el
móvil y en el escritorio y funciona como una app.

---

## Qué hace

| | |
|---|---|
| **Tareas** | La base de todo. Con responsable, co-responsable, subtareas, adjuntos y fecha límite. |
| **Diario** | Escribes en prosa qué vas a hacer y qué has hecho; de ahí salen las tareas. Lo que no se cierra vuelve al día siguiente. |
| **Bandeja** | Gmail personal **y** el buzón compartido de colaboraciones, unificados. Claude lee cada correo, detecta de qué cliente es y propone la tarea. |
| **Harvey** | El asistente. Por voz o por escrito, conoce la memoria del estudio y **ejecuta**: crea tareas, eventos, clientes. |
| **Clientes y Proyectos** | Fichas, comentarios del equipo, hitos y análisis de los briefs en PDF. |
| **Contenido** | La agenda de publicaciones, y un enlace público por pieza para que el cliente la revise sin darle una cuenta. |
| **Memoria** | Lo que el estudio sabe. Todo documento que se sube acaba aquí, y es lo que Harvey lee para responder. |
| **Reportes** | Solo el propietario: quién hizo qué, con informe imprimible. |
| **Automatizaciones** | Reglas propias: si pasa X, avisa o crea una tarea. |

---

## Poner en marcha una copia local

Hace falta Node 20+ y acceso a un proyecto de Supabase.

```bash
npm ci
cp .env.local.example .env.local   # y rellenarlo, ver abajo
npm run dev
```

### Variables obligatorias

Sin cualquiera de estas, `npm run build` se niega a compilar
(`scripts/check-env.mjs`, que corre en `prebuild`):

| Variable | Para qué |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | base de datos y sesiones |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | cliente del navegador |
| `SUPABASE_SERVICE_ROLE_KEY` | todas las rutas de la API |
| `ANTHROPIC_API_KEY` | chat, Harvey y análisis de correo |
| `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` | Gmail y Calendar |
| `NEXT_PUBLIC_APP_URL` | de aquí sale la dirección de vuelta de OAuth |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT` | avisos push |

En producción hace falta además `CRON_SECRET`, o los procesos automáticos
devuelven 500.

**Opcionales**: sin ellas la app funciona y pierde una función concreta —
`FISH_AUDIO_API_KEY` y `FISH_AUDIO_VOICE_ID` (la voz de Harvey: sin cualquiera de
las dos, el mismo 503), `GROQ_API_KEY` u `OPENAI_API_KEY` (que Harvey te entienda
al hablar), `TAVILY_API_KEY` (búsqueda web), y `WHATSAPP_APP_SECRET`,
`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` (el canal
de WhatsApp, aún sin estrenar).

**Y las de montar la app para OTRO negocio.** Todas tienen valor por defecto y
ninguna falla si falta: la instancia funciona y lleva el nombre de Brutal Studios
dentro, que es la peor forma de equivocarse porque no da señal.

| Variable | Si no la pones |
|---|---|
| `COMPANY_EMAIL` | de aquí sale qué correos son «del equipo»; por defecto, el de Brutal Studios |
| `DOMINIO_EQUIPO` | la lista de Equipo filtra por este dominio: con el de otro negocio saldría **vacía** |
| `VAPID_SUBJECT` | va firmado en cada notificación; por defecto, un correo de Brutal Studios |
| `NEXT_PUBLIC_APP_URL` | es obligatoria, pero ojo: el código cae a `brutalstudios-ia.vercel.app` si se queda vacía |

Las comprueba `npm run revisar`. Ver **`docs/NUEVA-INSTANCIA.md`**.

### La base de datos

```bash
# En Supabase → SQL Editor, en este orden:
supabase/schema.sql           # las tablas base
migrations/*.sql              # por fecha, de la más vieja a la más nueva
```

Hay un test que comprueba que **toda tabla que usa el código existe en estos
ficheros** (`regresiones.test.ts`, «el esquema se puede reconstruir desde el
repo»). Si añades una tabla a mano en Supabase y no la traes aquí, la suite se
pone roja: es a propósito.

---

## Antes de subir nada

```bash
npx tsc --noEmit && npm test && npm run build
```

Los tests corren con `TZ=UTC` a propósito: en un portátil español los fallos de
zona horaria se esconden.

### Cómo son los tests aquí

De los ~590, más de la mitad no comprueban qué devuelve una función: comprueban
un **invariante sobre todo el código, incluido el que se escriba mañana**. Es la
respuesta a lo que descubrió una auditoría — más de la mitad de los fallos graves
eran *gemelos*: el mismo error escrito dos veces, arreglado en una copia y vivo en
la otra.

Si añades una regla, **reintrodúcele el fallo y comprueba que la suite se pone
roja**. Una regla que nunca ha fallado no demuestra nada.

---

## Desplegar

`git push` a `main` **despliega a producción**. No hay staging. Todo commit en
`main` es una release, y el ruleset del repositorio obliga a pasar por una PR con
CI en verde.

Tras cada fusión, comprueba que producción sirve de verdad el commit nuevo:

```bash
curl -sD- -o /dev/null https://brutalia.tech/login | grep x-vercel-error
```

Sin salida es que va bien. El porqué de esta comprobación, y todo lo demás que hay
que saber para operar esto, está en **[docs/OPERACION.md](docs/OPERACION.md)**.

---

## Cómo está montado

```
src/app/api/        65 rutas. `createClient()` para consultar como el usuario,
                    `createAdminClient()` (service role, se salta RLS) para lo
                    demás — y toda ruta que use la segunda resuelve antes al
                    usuario. Hay un test que lo obliga.
src/components/     17 secciones + lo compartido en `shared/`.
src/lib/            La lógica que no es ni ruta ni pantalla: el motor de
                    automatizaciones, la sincronización de Gmail, las llamadas al
                    modelo, las fechas de Madrid.
migrations/         SQL que se pega en el editor de Supabase, por fecha.
docs/               Runbook de operación.
CLAUDE.md           Las trampas que ya han mordido. Léelo antes de tocar nada.
```

**Modelo de seguridad**: un único espacio de trabajo compartido, sin
multi-tenancy. Es el diseño, no una carencia: el producto *es* el estudio. La API
es la barrera y RLS es defensa en profundidad. La única señal de autorización del
servidor es `profiles.role`.

Las fechas de negocio van **siempre** por `todayKey()` y `localDayKey()`
(Europe/Madrid). Un `new Date().toISOString().slice(0,10)` da el día en UTC y a
partir de las diez de la noche ya es mañana; hay un test que lo prohíbe.

---

## Licencia

Software propietario de Brutal Studios. Todos los derechos reservados.
