#!/usr/bin/env python3
# Manual de uso de Nexus / BRUTAL.IA para el equipo de Brutal Studios.
# Todo el contenido está verificado contra el código real de la app.

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, PageBreak, KeepTogether)

OUT = "/Users/javierporto/brutalstudios-nexus/nexus-web/Manual-BRUTAL-IA.pdf"

AZUL   = colors.HexColor("#1B5FFA")
TINTA  = colors.HexColor("#12121C")
GRIS   = colors.HexColor("#5A5A6E")
SUAVE  = colors.HexColor("#F2F4F9")
BORDE  = colors.HexColor("#DDE1EC")
AMBAR  = colors.HexColor("#B26B00")
ROJO   = colors.HexColor("#C42230")

ss = getSampleStyleSheet()

def S(name, **kw):
    base = dict(fontName="Helvetica", fontSize=9.5, leading=14, textColor=TINTA,
                spaceAfter=6, alignment=TA_LEFT)
    base.update(kw)
    return ParagraphStyle(name, **base)

H1   = S("H1", fontName="Helvetica-Bold", fontSize=19, leading=23, textColor=TINTA, spaceAfter=3, spaceBefore=0)
KICK = S("KICK", fontName="Helvetica-Bold", fontSize=7.5, leading=10, textColor=AZUL, spaceAfter=10)
H2   = S("H2", fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=TINTA, spaceBefore=13, spaceAfter=5)
BODY = S("BODY")
LEAD = S("LEAD", fontSize=10.5, leading=16, textColor=GRIS, spaceAfter=10)
SMALL= S("SMALL", fontSize=8.5, leading=12, textColor=GRIS)
CELL = S("CELL", fontSize=8.8, leading=12)
CELLB= S("CELLB", fontSize=8.8, leading=12, fontName="Helvetica-Bold")
KEY  = S("KEY", fontSize=8.8, leading=12, fontName="Courier-Bold", textColor=AZUL)

def bullets(items, style=BODY):
    out = []
    for it in items:
        out.append(Paragraph(f"&bull;&nbsp;&nbsp;{it}", ParagraphStyle(
            "b", parent=style, leftIndent=10, spaceAfter=3.5)))
    return out

def callout(titulo, texto, color=AZUL, fondo=SUAVE):
    t = Table([[Paragraph(f'<font color="{color.hexval()}"><b>{titulo}</b></font><br/>{texto}',
                          ParagraphStyle("c", parent=BODY, fontSize=9, leading=13))]],
              colWidths=[165*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), fondo),
        ("LINEBEFORE", (0,0), (0,-1), 2.2, color),
        ("LEFTPADDING", (0,0), (-1,-1), 9),
        ("RIGHTPADDING", (0,0), (-1,-1), 9),
        ("TOPPADDING", (0,0), (-1,-1), 8),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
    ]))
    return [Spacer(1, 4), t, Spacer(1, 8)]

def tabla(filas, anchos, cabecera=True):
    t = Table(filas, colWidths=anchos, repeatRows=1 if cabecera else 0)
    est = [
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 7),
        ("RIGHTPADDING", (0,0), (-1,-1), 7),
        ("TOPPADDING", (0,0), (-1,-1), 6),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
        ("LINEBELOW", (0,0), (-1,-2), 0.4, BORDE),
    ]
    if cabecera:
        est += [("BACKGROUND", (0,0), (-1,0), TINTA),
                ("LINEBELOW", (0,0), (-1,0), 0, colors.white)]
    t.setStyle(TableStyle(est))
    return t

def th(txt):
    return Paragraph(f'<font color="#FFFFFF"><b>{txt}</b></font>',
                     ParagraphStyle("th", parent=CELL, fontSize=8.2))

# ── Plantilla de página ──────────────────────────────────────────────────────
def deco(canvas, doc):
    canvas.saveState()
    w, h = A4
    if doc.page == 1:
        canvas.setFillColor(TINTA)
        canvas.rect(0, h-72*mm, w, 72*mm, stroke=0, fill=1)
        canvas.setFillColor(AZUL)
        canvas.rect(0, h-72*mm, w, 2.5*mm, stroke=0, fill=1)
    else:
        canvas.setFillColor(BORDE)
        canvas.rect(22*mm, 16*mm, w-44*mm, 0.4, stroke=0, fill=1)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(GRIS)
        canvas.drawString(22*mm, 11*mm, "BRUTAL.IA — Manual de uso")
        canvas.drawRightString(w-22*mm, 11*mm, str(doc.page))
    canvas.restoreState()

doc = BaseDocTemplate(OUT, pagesize=A4,
                      leftMargin=22*mm, rightMargin=22*mm,
                      topMargin=20*mm, bottomMargin=22*mm,
                      title="BRUTAL.IA — Manual de uso",
                      author="Brutal Studios")

portada = Frame(22*mm, 22*mm, A4[0]-44*mm, A4[1]-95*mm, id="port")
normal  = Frame(22*mm, 22*mm, A4[0]-44*mm, A4[1]-44*mm, id="norm")
doc.addPageTemplates([
    PageTemplate(id="Portada", frames=[portada], onPage=deco),
    PageTemplate(id="Normal",  frames=[normal],  onPage=deco),
])

E = []

# ═══════════════════════ PORTADA ═══════════════════════
E += [
    Spacer(1, 6*mm),
    Paragraph("BRUTAL.IA", ParagraphStyle("t", fontName="Helvetica-Bold", fontSize=34,
              leading=38, textColor=TINTA, spaceAfter=2)),
    Paragraph("Manual de uso del equipo", ParagraphStyle("s", fontName="Helvetica",
              fontSize=13, leading=18, textColor=GRIS, spaceAfter=16)),
    Paragraph(
        "Nexus es la herramienta interna de Brutal Studios: reúne en un solo sitio el correo, "
        "las tareas, los clientes, los proyectos, el calendario y el pipeline de contenido. "
        "Este manual explica lo que hay dentro y cómo usarlo el primer día.", LEAD),
]
E += callout("Antes de empezar",
             "Todo lo que hagas aquí lo ve el resto del equipo. No es una cuenta personal: "
             "es el espacio compartido del estudio. Las tareas que crees, los clientes que añadas "
             "y los comentarios que escribas aparecen para todos.")
E += [
    Spacer(1, 4*mm),
    tabla([
        [th("Sección"), th("Para qué sirve")],
        [Paragraph("<b>Hoy</b>", CELLB),        Paragraph("Tu resumen del día y el asistente de voz", CELL)],
        [Paragraph("<b>Inbox</b>", CELLB),      Paragraph("Todo el correo, con resumen automático", CELL)],
        [Paragraph("<b>Calendario</b>", CELLB), Paragraph("Reuniones, entregas y publicaciones", CELL)],
        [Paragraph("<b>Tareas</b>", CELLB),     Paragraph("Lo que hay que hacer y quién lo hace", CELL)],
        [Paragraph("<b>Clientes</b>", CELLB),   Paragraph("Ficha, archivos y comentarios de cada cliente", CELL)],
        [Paragraph("<b>Proyectos</b>", CELLB),  Paragraph("Estado de cada proyecto y análisis de PDF", CELL)],
        [Paragraph("<b>Contenido</b>", CELLB),  Paragraph("Pipeline de piezas hasta publicarlas", CELL)],
        [Paragraph("<b>Brutal.IA</b>", CELLB),  Paragraph("Chat que conoce todo el estudio", CELL)],
        [Paragraph("<b>Operativa</b>", CELLB),  Paragraph("Tu perfil, avisos y conexiones", CELL)],
    ], [38*mm, 123*mm]),
    Spacer(1, 8*mm),
    Paragraph("Brutal Studios · Documento interno", SMALL),
]

# ═══════════════════════ 1. PRIMEROS PASOS ═══════════════════════
E += [PageBreak()]
E += [Paragraph("PRIMER DÍA", KICK), Paragraph("Los tres pasos para empezar", H1),
      Paragraph("Quince minutos y ya lo tienes funcionando.", LEAD)]

E += [Paragraph("1 · Elige tu contraseña y entra", H2),
      Paragraph("Javi te manda un <b>enlace de acceso</b>. Ábrelo y elige ahí tu contraseña: "
                "es la que usarás a partir de ese momento, también en el móvil. El enlace sirve "
                "una sola vez.", BODY)]
E += bullets([
    "A partir de ahí entras en <b>brutalstudios-ia.vercel.app</b> con tu correo y esa contraseña.",
    "Si la olvidas, pulsa <b>¿Olvidaste tu contraseña?</b> en la pantalla de acceso. "
    "Si no te llega el correo, pídele a Javi otro enlace: Operativa → Equipo.",
    "En el móvil, pulsa <b>Compartir → Añadir a pantalla de inicio</b>. Se instala como una app "
    "y así te llegan los avisos.",
])

E += [Paragraph("2 · Conecta tu Gmail", H2),
      Paragraph("Ve a <b>Operativa → Sincronización</b> y pulsa conectar en <b>Gmail Personal</b>. "
                "Google te pedirá permiso para leer tu correo y tu calendario.", BODY)]
E += bullets([
    "Complétalo <b>sin pausas</b>: si tardas más de 20 minutos caduca y hay que repetirlo.",
    "Tu correo personal es <b>tuyo</b>: solo lo ves tú. El buzón de "
    "<b>colaboraciones@brutalstudios.es</b> es el compartido y lo ve todo el equipo.",
])

E += [Paragraph("3 · Activa las notificaciones", H2),
      Paragraph("En <b>Operativa → Notificaciones</b>, pulsa <b>Activar notificaciones</b> y acepta "
                "el aviso del navegador. Sin esto no te enteras de que te asignan una tarea.", BODY)]

E += callout("Si el móvil no te pide permiso",
             "Es que no has instalado la app en la pantalla de inicio (paso 1). En iPhone las "
             "notificaciones solo funcionan con la app instalada, no desde Safari.", AMBAR,
             colors.HexColor("#FFF8EC"))

# ═══════════════════════ 2. LAS SECCIONES ═══════════════════════
E += [PageBreak()]
E += [Paragraph("QUÉ HAY DENTRO", KICK), Paragraph("Las secciones, una por una", H1),
      Paragraph("Se navega por la barra lateral. En el móvil, con el botón de menú de arriba a la izquierda.", LEAD)]

secciones = [
    ("Hoy",
     "Tu pantalla de inicio. Muestra el briefing del día — correos que necesitan respuesta, tareas "
     "que vencen hoy y piezas de contenido en marcha — y da acceso a <b>Harvey</b>, el asistente de voz. "
     "Es el sitio del que partir cada mañana."),
    ("Inbox",
     "Todo el correo en un solo sitio: tu Gmail personal y el buzón compartido de colaboraciones. "
     "Cada mensaje llega con un <b>resumen automático</b> y una acción sugerida, para que sepas de "
     "qué va sin abrirlo. Puedes crear una tarea directamente desde un email."),
    ("Calendario",
     "Junta tres cosas en una vista: tus eventos de Google Calendar, las tareas con fecha límite y las "
     "publicaciones programadas de contenido. Vista de mes o de semana."),
    ("Tareas",
     "El corazón del día a día. Cada tarea tiene responsable, prioridad, fecha límite y puede colgar "
     "de un proyecto o un cliente. Se pueden asignar <b>dos personas</b>: una principal y un apoyo. "
     "Filtros por responsable, proyecto y prioridad, y exportación a CSV."),
    ("Clientes",
     "La ficha de cada cliente: sector, estado, notas, archivos (contratos, briefings, referencias) y "
     "los comentarios del equipo. Desde aquí se ve todo lo que hay abierto con ese cliente."),
    ("Proyectos",
     "Tablero por estados — planificación, activo, urgente, revisión, completado — y se arrastra de "
     "una columna a otra. Cada proyecto admite portada, notas, hitos y un <b>PDF que la IA analiza</b>: "
     "sube un briefing y te extrae resumen, puntos clave, acciones y riesgos."),
    ("Contenido",
     "El pipeline de producción: <b>En bruto → En producción → Listo → Publicado</b>. Cada pieza lleva "
     "plataforma, cuenta, fecha de publicación, vídeo y portada. El equipo deja su opinión en la ficha, "
     "y se puede generar un <b>enlace para que el cliente la revise</b> sin entrar en la app."),
    ("Brutal.IA",
     "Un chat que conoce el estado real del estudio: tus clientes, proyectos, tareas y correo. Pregúntale "
     "en lenguaje normal — <i>¿qué tengo urgente?</i>, <i>resúmeme el estado del equipo</i>. También busca "
     "en internet cuando hace falta."),
    ("Operativa",
     "Los ajustes: tu perfil, notificaciones, conexiones de Gmail y Calendar, el equipo, la memoria "
     "(documentos y conocimiento del estudio) y las automatizaciones."),
]
for nombre, desc in secciones:
    E += [KeepTogether([Paragraph(nombre, H2), Paragraph(desc, BODY)])]

# ═══════════════════════ 3. HARVEY ═══════════════════════
E += [PageBreak()]
E += [Paragraph("ASISTENTES", KICK), Paragraph("Harvey y Brutal.IA", H1),
      Paragraph("Dos formas de preguntarle lo mismo al estudio: por voz o escribiendo.", LEAD)]

E += [Paragraph("Harvey (por voz)", H2),
      Paragraph("Está en <b>Hoy</b> y en su propia sección. Pulsa el orbe, habla, y vuelve a pulsarlo "
                "para terminar. Te responde en voz alta.", BODY)]
E += bullets([
    "Puede <b>crear tareas y reuniones</b> por ti: <i>“crea una tarea para Carlos de revisar el "
    "briefing de KOTO”</i>.",
    "<b>Nunca hace nada sin que lo confirmes</b>: te muestra una tarjeta con lo que va a hacer y "
    "tú decides. Si no la pulsas, no pasa nada.",
    "Si te equivocas al hablar, vuelve a pulsar el orbe: cancela y empieza de nuevo.",
])

E += [Paragraph("Brutal.IA (escribiendo)", H2),
      Paragraph("Lo mismo pero por texto, y con respuestas más largas. Útil para pedirle que redacte, "
                "resuma o compare. Tiene prompts rápidos: pulsa <b>1</b> a <b>6</b> para lanzarlos.", BODY)]

E += callout("Lo que la IA ve y lo que no",
             "Conoce lo que hay <b>en la app</b>: clientes, proyectos, tareas y los resúmenes del correo. "
             "No lee el contenido íntegro de tus emails privados ni tiene acceso a nada de fuera del "
             "estudio. Y como cualquier IA, <b>puede equivocarse</b>: si te da un dato que vas a usar "
             "con un cliente, compruébalo.")

# ═══════════════════════ 4. ATAJOS ═══════════════════════
E += [PageBreak()]
E += [Paragraph("IR MÁS RÁPIDO", KICK), Paragraph("Atajos de teclado", H1),
      Paragraph("Solo en ordenador. Pulsa <b>?</b> en cualquier momento para verlos dentro de la app.", LEAD)]

E += [Paragraph("Moverte entre secciones", H2),
      Paragraph("Pulsa <b>G</b> y después la letra. Por ejemplo <b>G</b> y luego <b>T</b> te lleva a Tareas.", BODY)]
E += [tabla([
    [th("Tecla"), th("Sección"), th("Tecla"), th("Sección")],
    [Paragraph("G H", KEY), Paragraph("Hoy", CELL),        Paragraph("G K", KEY), Paragraph("Contenido", CELL)],
    [Paragraph("G I", KEY), Paragraph("Inbox", CELL),      Paragraph("G N", KEY), Paragraph("Brutal.IA", CELL)],
    [Paragraph("G T", KEY), Paragraph("Tareas", CELL),     Paragraph("G Y", KEY), Paragraph("Harvey", CELL)],
    [Paragraph("G C", KEY), Paragraph("Clientes", CELL),   Paragraph("G A", KEY), Paragraph("Calendario", CELL)],
    [Paragraph("G P", KEY), Paragraph("Proyectos", CELL),  Paragraph("G S", KEY), Paragraph("Operativa", CELL)],
], [20*mm, 60*mm, 20*mm, 61*mm]), Spacer(1, 5)]

E += [Paragraph("Dentro de cada sección", H2)]
E += [tabla([
    [th("Dónde"), th("Tecla"), th("Qué hace")],
    [Paragraph("En todas", CELLB),  Paragraph("Cmd K", KEY),   Paragraph("Buscador global", CELL)],
    [Paragraph("", CELL),           Paragraph("?", KEY),          Paragraph("Ver todos los atajos", CELL)],
    [Paragraph("", CELL),           Paragraph("ESC", KEY),        Paragraph("Cerrar lo que esté abierto", CELL)],
    [Paragraph("Tareas", CELLB),    Paragraph("J / K", KEY),      Paragraph("Subir y bajar por la lista", CELL)],
    [Paragraph("", CELL),           Paragraph("N", KEY),          Paragraph("Nueva tarea", CELL)],
    [Paragraph("", CELL),           Paragraph("C", KEY),          Paragraph("Completar la tarea", CELL)],
    [Paragraph("", CELL),           Paragraph("L", KEY),          Paragraph("Cambiar la prioridad", CELL)],
    [Paragraph("", CELL),           Paragraph("D", KEY),          Paragraph("Poner fecha límite", CELL)],
    [Paragraph("Inbox", CELLB),     Paragraph("J / K", KEY),      Paragraph("Moverte por los mensajes", CELL)],
    [Paragraph("", CELL),           Paragraph("E", KEY),          Paragraph("Marcar como leído", CELL)],
    [Paragraph("", CELL),           Paragraph("T", KEY),          Paragraph("Crear tarea desde el email", CELL)],
    [Paragraph("", CELL),           Paragraph("A", KEY),          Paragraph("Marcar todo leído (pide confirmar)", CELL)],
    [Paragraph("Proyectos", CELLB), Paragraph("V", KEY),          Paragraph("Cambiar entre tablero y lista", CELL)],
    [Paragraph("", CELL),           Paragraph("S", KEY),          Paragraph("Cambiar el estado", CELL)],
    [Paragraph("Contenido", CELLB), Paragraph("S", KEY),          Paragraph("Mover la pieza de estado", CELL)],
    [Paragraph("", CELL),           Paragraph("F", KEY),          Paragraph("Buscar pieza", CELL)],
], [26*mm, 20*mm, 115*mm]), Spacer(1, 5)]

# ═══════════════════════ 5. NORMAS + PROBLEMAS ═══════════════════════
E += [PageBreak()]
E += [Paragraph("CONVIVENCIA", KICK), Paragraph("Cómo no pisarnos", H1),
      Paragraph("Cuatro normas y cómo reaccionar cuando algo no va.", LEAD)]

E += [Paragraph("Lo que conviene hacer", H2)]
E += bullets([
    "<b>Asigna siempre las tareas.</b> Una tarea sin responsable no la hace nadie.",
    "<b>Pon fecha a lo que la tenga.</b> Sin fecha no aparece en el calendario ni en el resumen del día.",
    "<b>Escribe para el que venga detrás.</b> “Revisar” no dice nada; “revisar el copy del reel "
    "de KOTO antes del jueves” sí.",
    "<b>Sube los archivos a la ficha del cliente</b>, no los mandes por WhatsApp: así los encuentra "
    "todo el mundo dentro de seis meses.",
])

E += [Paragraph("Lo que no debes tocar", H2)]
E += bullets([
    "<b>No borres clientes ni proyectos</b> aunque puedas. Si algo sobra, avísale a un responsable.",
    "<b>No desconectes el Gmail de colaboraciones</b> desde Operativa: es el buzón compartido de "
    "toda la empresa, no una cuenta personal.",
    "<b>No compartas los enlaces de revisión</b> fuera del cliente al que van dirigidos: cualquiera "
    "con el enlace ve esa pieza.",
])

E += [Paragraph("Si algo va mal", H2)]
E += [tabla([
    [th("Qué ves"), th("Qué significa y qué hacer")],
    [Paragraph("Una franja ámbar arriba", CELLB),
     Paragraph("No se han podido cargar todos los datos. Pulsa <b>REINTENTAR</b>. Si sigue, avísale a Javi.", CELL)],
    [Paragraph("Una franja roja: sin conexión", CELLB),
     Paragraph("No hay internet. <b>Lo que escribas ahora no se guarda</b> — espera a recuperar cobertura.", CELL)],
    [Paragraph("“La conexión caducó” al conectar Gmail", CELLB),
     Paragraph("Tardaste demasiado en la pantalla de Google. Repite el proceso sin pausas.", CELL)],
    [Paragraph("No me llegan notificaciones", CELLB),
     Paragraph("Instala la app en la pantalla de inicio y vuelve a activarlas en Operativa.", CELL)],
    [Paragraph("El calendario está vacío", CELLB),
     Paragraph("Falta el permiso de Calendar. Reconecta Gmail desde Operativa → Sincronización.", CELL)],
], [46*mm, 115*mm])]

E += callout("Si algo se rompe de verdad",
             "Avísale a Javi con <b>qué estabas haciendo</b> y <b>una captura</b>. Si aparece un código "
             "de referencia en pantalla, cópialo: con él se localiza el fallo exacto en segundos.",
             ROJO, colors.HexColor("#FDF1F2"))

E += [Spacer(1, 6), Paragraph(
    "Este manual describe la app tal y como está el 10 de agosto de 2026. "
    "Nexus cambia a menudo: si algo no coincide, gana lo que veas en pantalla.", SMALL)]

doc.build(E)
print("PDF generado:", OUT)
