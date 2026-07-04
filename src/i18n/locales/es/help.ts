// Modal de ayuda y documentación. Esta es la superficie con más texto de la app,
// por lo que la mayoría de los valores llevan marcado en línea y se renderizan mediante
// <Trans> con marcadores de componentes indexados (<0>, <1>, …). Las TECLAS de atajo
// (p. ej. "Ctrl + N") permanecen literales en el componente; solo sus descripciones viven
// aquí. Los identificadores de código, fragmentos de comandos, rutas de archivos, URL,
// regex y nombres de protocolos/productos (SSH, Telnet, WSL, GCP, IAP, gcloud) NO se traducen.
export const help = {
  title: 'Ayuda y documentación',

  shortcuts: {
    summary: 'Atajos',
    newSession: 'Diálogo de nueva sesión',
    newWindow: 'Nueva ventana',
    focusNext: 'Enfocar el panel siguiente',
    focusPrev: 'Enfocar el panel anterior',
    closeTab: 'Cerrar la pestaña actual',
    clearOrSigint: 'Limpiar selección / Enviar SIGINT',
    paste: 'Pegar en el terminal (con comprobación de seguridad)',
    sendMessage: 'Enviar mensaje en el diálogo Preguntar a la IA',
    closeModal: 'Cerrar modal / diálogo',
  },

  gettingStarted: {
    summary: 'Primeros pasos',
    openDialog:
      'Abra el diálogo de conexión mediante <0>Ctrl + N</0> o el botón <1>"Nueva"</1> de la barra lateral. Puede gestionar sus hosts y carpetas en el árbol de hosts.',
    doubleClick:
      '<0>Doble clic:</0> haga doble clic en un host del árbol para conectarse inmediatamente.',
    supportedTypes: '<0>Tipos de conexión admitidos:</0>',
    typeSsh:
      '<0>SSH</0> — Shell remoto cifrado (autenticación por contraseña o clave)',
    typeTelnet:
      '<0>Telnet</0> — Shell remoto sin cifrar para dispositivos heredados',
    typeSerial:
      '<0>Serie</0> — Conexión directa por puerto COM (routers, dispositivos integrados, etc.)',
    typeWsl: '<0>WSL</0> — Distribuciones del Subsistema de Windows para Linux',
    typeLocal: '<0>Local</0> — Shell local (CMD o PowerShell)',
    typeGitBash:
      '<0>Git Bash</0> — Shell de inicio de sesión interactivo de Git Bash (detectado automáticamente)',
    jumpbox:
      '<0>Jumpbox (host de bastión):</0> las conexiones SSH y Telnet se pueden enrutar a través de un jumpbox. Marque cualquier host SSH como jumpbox en el árbol de hosts y luego selecciónelo como host "vía" al editar un host de destino.',
    gcpIap:
      '<0>Google Cloud IAP:</0> conéctese a VMs de Google Compute Engine mediante Identity-Aware Proxy sin exponer las VMs a la red pública. Abra la pestaña <1>GCP</1> en el diálogo de nueva sesión para examinar todas sus instancias de GCE en cada proyecto al que tenga acceso — agrupadas por proyecto, con estado en vivo (🟢 RUNNING / 🔴 detenida / 🟡 en transición) — y luego haga doble clic en una instancia para conectarse. El panel también tiene botones para <2>iniciar</2> o <3>detener</3> una instancia directamente, y una acción de <4>Actualizar</4> para volver a consultar sus proyectos e instancias. Un <5>cuadro de búsqueda</5> filtra la lista por nombre de proyecto o instancia mientras escribe. La última lista conocida se muestra <6>al instante al iniciar</6> y se revalida en segundo plano, para que no tenga que esperar a una consulta completa cada vez que se abre el panel. Si hace doble clic en una VM detenida, HoTTY pregunta antes de iniciarla (o la inicia automáticamente cuando está configurado en un host IAP guardado). <7>No se requiere nombre de usuario, contraseña ni clave privada de SSH</7> — HoTTY delega la conexión en <8>gcloud compute ssh --tunnel-through-iap</8>, que gestiona el túnel IAP, el mapeo de OS Login, la generación automática de claves SSH (<9>~/.ssh/google_compute_engine</9>), el registro de claves y la autenticación en su nombre. Requiere el Google Cloud SDK y un <10>gcloud auth login</10> completado.',
    gcpFiltering:
      '<0>Filtrado consciente del acceso de GCP:</0> el panel de GCP comprueba <1>iap.tunnelInstances.accessViaIAP</1> a nivel de proyecto e instancia (mediante <2>gcloud projects test-iam-permissions</2>) y oculta las VMs para las que no tiene permiso de túnel IAP. Un botón contador 🔒 en el encabezado del panel le permite volver a mostrar las instancias ocultas; las instancias sin permiso de OS Login siguen mostrándose pero muestran un glifo de advertencia 🔑 porque SSH puede funcionar igualmente mediante una clave de metadatos. Cuando la propia comprobación de IAM falla (corte de red, proyecto eliminado), las instancias permanecen visibles para que las VMs accesibles nunca se oculten por accidente.',
    updateNotifications:
      '<0>Notificaciones de actualización:</0> al iniciar, HoTTY comprueba el feed de versiones de GitHub y muestra una notificación descartable cuando hay una versión más reciente disponible, con un enlace directo a la página de la versión.',
    connectionStatus:
      '<0>Estado de la conexión:</0> se muestra una superposición de Conexión mientras se establece el transporte. Las sesiones SSH y Telnet expiran tras un intervalo configurable (predeterminado 5 segundos) — consulte <1>Configuración → Protocolos</1>. Los fallos de conexión aparecen como notificaciones descartables con etiquetas cortas y claras — <2>Conexión rechazada</2>, <3>Host no encontrado</3>, <4>Tiempo de conexión agotado (15s)</4>, <5>No hay algoritmo kex común con el servidor</5>, <6>Frase de contraseña incorrecta para la clave privada</6>, etc. — en lugar del texto de error sin procesar de la biblioteca. Los fallos en un salto de jumpbox se etiquetan claramente como <7>Jumpbox: …</7> para que pueda saber qué salto falló.',
    sshAlgorithms:
      '<0>Algoritmos de SSH:</0> active qué algoritmos de intercambio de claves, cifrado, MAC y clave de host se ofrecen durante el protocolo de enlace SSH en <1>Configuración → Protocolos → Algoritmos de SSH</1>. Los valores predeterminados modernos como <2>curve25519-sha256</2> y <3>diffie-hellman-group14-sha256</3> están activados de fábrica. Las opciones heredadas de SHA-1 (<4>diffie-hellman-group14-sha1</4>, <5>3des-cbc</5>, <6>ssh-dss</6>, etc.) siguen disponibles para dispositivos más antiguos (p. ej. Cisco Catalyst 3650 / IOS antiguo) que no negocian algoritmos modernos. Activar <7>diffie-hellman-group-exchange-sha1</7> muestra un mensaje de confirmación porque SHA-1 se considera roto — use un KEX más sólido siempre que sea posible.',
    algorithmsMerge:
      'Al actualizar, cualquier algoritmo recién añadido en una versión se fusiona con su configuración guardada para que no tenga que optar manualmente por las mejoras de seguridad.',
  },

  hostTree: {
    summary: 'Organizar el árbol de hosts',
    dragDrop:
      '<0>Arrastrar y soltar:</0> puede reordenar hosts y carpetas arrastrándolos en el diálogo "Nueva sesión".',
    exportImportPrefix: '<0>Exportar e importar:</0> use los iconos de',
    exportLabel: '<0>Exportar</0>',
    importLabel: '<0>Importar</0>',
    exportImportSuffix:
      'en la parte superior derecha del panel de hosts para hacer copias de seguridad o cargar sus configuraciones.',
    management:
      '<0>Gestión:</0> use los iconos de acción junto a los elementos para añadir carpetas, añadir nuevos hosts, editar la configuración o eliminar entradas.',
    showPassword:
      '<0>Mostrar contraseña:</0> use el botón de visibilidad de la contraseña para revelar las contraseñas guardadas en el árbol de hosts cuando sea necesario.',
    newConnection:
      '<0>🆕 Entrada de Nueva conexión:</0> la fila superior del árbol de hosts inicia una conexión nueva — limpia el formulario de protocolo a la derecha del diálogo para que pueda marcar un host ad hoc sin tener que deseleccionar primero uno guardado.',
    saveAdHoc:
      '<0>Guardar una sesión ad hoc en el árbol de hosts:</0> después de conectarse mediante <1>Nueva conexión</1>, haga clic con el botón derecho en la pestaña de la sesión y elija <2>Guardar en el árbol de hosts…</2> para conservar la conexión para más tarde. Se admiten sesiones SSH y Telnet (se conservan la ruta de la clave privada y la frase de contraseña). En el diálogo de guardado, las carpetas del árbol de hosts se muestran como una vista de árbol para que pueda elegir la carpeta de destino directamente, y <3>+ Nueva carpeta</3> crea una carpeta bajo la seleccionada actualmente — anidable tan profundamente como desee.',
    openAll:
      '<0>Abrir todo en una carpeta:</0> Haz clic derecho en una carpeta del árbol de hosts y elige <1>Abrir todo</1> para conectarte a todos los hosts que contiene a la vez, incluidos los de las subcarpetas. Si la carpeta tiene 5 o más hosts, se te pide confirmación primero.',
  },

  layout: {
    summary: 'Dominar el diseño',
    flexibleTabs:
      '<0>Pestañas flexibles:</0> arrastre y suelte las pestañas no solo para reordenarlas, sino para moverlas entre paneles de cuadrícula, barras laterales o barras superior/inferior.',
    resizing:
      '<0>Redimensionar:</0> redimensione todo arrastrando los divisores o el <1>punto de intersección 2D</1> (donde se encuentran 4 paneles).',
    emptyPaneHints:
      '<0>Sugerencias de paneles vacíos:</0> las celdas de cuadrícula vacías muestran su número de panel y un mensaje "Soltar pestaña aquí" para que sepa dónde soltar una pestaña.',
    lineWrap:
      '<0>Alternar ajuste de línea:</0> desactive <1>Configuración → Apariencia → Ajuste de línea</1> para activar una barra de desplazamiento horizontal en los paneles del terminal. La vista se desplaza automáticamente para mantener el cursor a la vista mientras escribe más allá del borde derecho, y vuelve a la columna 0 al pulsar Enter. La barra de desplazamiento vertical y el marcador de prompt permanecen anclados al borde derecho del panel independientemente de la posición de desplazamiento horizontal.',
    multiWindow:
      '<0>Múltiples ventanas:</0> abra otra ventana con el botón <1>Nueva ventana</1> de la barra lateral o con <2>Ctrl + Shift + N</2>: al iniciar HoTTY de nuevo también se abre una ventana nueva en el mismo proceso. Cada ventana mantiene sus propios paneles y sesiones de terminal, mientras que sus ajustes, tema, árbol de hosts y marcadores se comparten y sincronizan entre todas las ventanas. Un chat de IA puede incluso enlazarse a un terminal que se ejecuta en otra ventana.',
  },

  copyPaste: {
    summary: 'Copiar y pegar',
    copy:
      '<0>Copiar:</0> simplemente seleccione texto en el terminal o haga clic en un <1>Marcador de terminal</1> para seleccionar un bloque completo. El contenido se copia automáticamente al portapapeles al seleccionarlo.',
    paste:
      '<0>Pegar:</0> haga clic con el botón derecho en cualquier parte del terminal o use <1>Ctrl + V</1>.',
    safety:
      '<0>Comprobación de seguridad:</0> aparecerá un diálogo de <1>Confirmación de pegado</1> si intenta pegar varias líneas. Esto evita la ejecución accidental de comandos peligrosos.',
  },

  markers: {
    summary: 'Marcadores del terminal',
    redTitle: 'Línea roja/naranja: Prompt',
    redDesc: 'Indica dónde escribió un comando.',
    blueTitle: 'Línea azul: Salida',
    blueDesc: 'Indica el resultado/salida de un comando.',
    tip:
      '<0>Sugerencia:</0> haga clic en un marcador para seleccionar el bloque completo. Haga clic derecho en él para preguntar rápidamente a la IA sobre esa salida específica.',
  },

  logging: {
    summary: 'Registro de sesiones y Visor de registros',
    sessionLogging:
      '<0>Registro de sesiones:</0> active el registro automático en <1>Configuración → General</1>. Toda la salida del terminal se guarda como archivos <2>.log</2> con marca de tiempo en la carpeta que especifique.',
    folderApproval:
      '<0>Aprobación de carpeta:</0> la primera vez que HoTTY usa una carpeta de registros — ya sea que inicie una sesión, active el registro o abra el Visor de registros — un diálogo de confirmación nativo le pide que apruebe esa carpeta. Elegir una carpeta mediante el botón <1>Examinar...</1> la aprueba automáticamente. Las aprobaciones persisten entre inicios de la aplicación (guardadas en <2>%APPDATA%\\com.hotty.terminal\\approved_log_dirs.json</2>), por lo que solo verá el diálogo una vez por carpeta. El mecanismo existe para que una ruta escrita o importada no pueda otorgar silenciosamente acceso al registro.',
    logViewer:
      '<0>Visor de registros:</0> haga clic en el botón <1>Visor de registros</1> de la barra de pestañas para abrir un panel dedicado a la exploración de registros. Enumera todos los archivos de registro guardados y le permite abrirlos y buscar en ellos sin salir de HoTTY.',
    search:
      '<0>Búsqueda:</0> use la barra de búsqueda dentro del Visor de registros para filtrar líneas. Active el botón <1>.*</1> para alternar entre la búsqueda de texto plano y la de expresiones regulares.',
  },

  textEditor: {
    summary: 'Editor de texto',
    intro:
      'Abra un panel de editor de texto integrado mediante <0><1></1></0> (Funciones) → <2>"Editor de texto"</2>. Puede abrir varios paneles de editor y editar varios archivos simultáneamente usando subpestañas.',
    fileMenu:
      '<0>Menú Archivo:</0> acciones de Nuevo, Abrir, Guardar, Guardar como y Cerrar para subpestañas individuales.',
    viewMenu:
      '<0>Menú Ver:</0> active <1>Mostrar códigos de salto de línea</1> para mostrar los caracteres de salto de línea como símbolos visibles en el editor.',
    findReplace:
      '<0>Buscar y reemplazar:</0> pulse <1>Ctrl + F</1> para abrir la barra de búsqueda. Use <2>Ctrl + H</2> para buscar y reemplazar. Las coincidencias se resaltan y se muestra el recuento total.',
    gotoLine:
      '<0>Ir a línea:</0> pulse <1>Ctrl + G</1> para saltar a un número de línea específico.',
    encoding:
      '<0>Codificación y fin de línea:</0> haga clic en el indicador de codificación o de fin de línea en la barra de estado para cambiarlos en el archivo actual.',
    lineWrap:
      '<0>Ajuste de línea:</0> controlado por el interruptor global <1>Configuración → Apariencia → Ajuste de línea</1>. Los números de línea visuales se actualizan automáticamente para reflejar las líneas ajustadas.',
    fileAssociation:
      '<0>Asociación de archivos:</0> los archivos abiertos desde el Explorador de Windows (doble clic o "Abrir con") se inician directamente en el Editor de texto.',
    tip:
      '<0>Sugerencia:</0> un archivo sin guardar muestra un punto <1>•</1> en el título de su subpestaña. Guarde con <2>Ctrl + S</2>.',
    unsavedPrompt:
      '<0>Aviso de cambios sin guardar:</0> al cerrar una subpestaña o salir con editores con cambios pendientes se abre un diálogo de <1>Guardar / Descartar / Cancelar</1> para que nunca pierda trabajo por accidente.',
  },

  fileServer: {
    summary:
      'Servidor de archivos (TFTP / SFTP)',
    intro:
      'Abre el panel Servidor de archivos con <0><1></1></0> (Features) → <2>"File Server"</2>. Elige una carpeta para compartir e inicia un servidor TFTP o SFTP para que los dispositivos de red (p. ej. Cisco) descarguen o suban firmware por la LAN.',
    serve:
      '<0>Carpeta compartida:</0> Elige la carpeta con Examinar. Solo se puede acceder a los archivos que contiene; se bloquean el path traversal y los enlaces simbólicos.',
    tftp:
      '<0>TFTP:</0> UDP (puerto 69 por defecto). El método clásico para cargar firmware en Cisco IOS con <1>copy tftp: flash:</1>. Solo lectura por defecto; activa <2>Allow uploads</2> para transferencias dispositivo→PC.',
    sftp:
      '<0>SFTP:</0> Basado en SSH (puerto 2222 por defecto) con autenticación por usuario/contraseña. La clave de host se genera automáticamente y se guarda cifrada.',
    firewall:
      '<0>Firewall de Windows:</0> Si el tráfico entrante está bloqueado, el panel lo indica y ofrece <1>Allow through firewall</1> (un clic, requiere administrador).',
    security:
      '<0>Seguridad:</0> Iniciar un servidor expone la carpeta elegida a tu red local. Comparte solo archivos de confianza y mantén las subidas desactivadas salvo que las necesites.',
  },

  webBrowser: {
    summary: 'Navegador web y marcadores',
    intro:
      'Abre páginas web dentro de HoTTY en un navegador integrado, práctico para las interfaces web de administración de dispositivos de red (routers, switches, iLO/iDRAC) junto a tus terminales. Ábrelo desde la pestaña <1>🌐 Web</1> del diálogo <0>Nueva sesión</0>: haz clic en <2>🆕 Nuevo navegador web</2> para una pestaña en blanco, o haz doble clic en un marcador guardado para abrir ese sitio.',
    bookmarks:
      '<0>Marcadores:</0> Organiza los sitios en un árbol de carpetas bajo la pestaña <1>Web</1>: añade, renombra, elimina y arrastra para reordenar. Haz doble clic en un marcador para abrirlo en un nuevo panel de navegador. Mientras navegas, el botón de marcadores de la barra de herramientas muestra tus marcadores guardados para un acceso rápido.',
    openAll:
      '<0>Abrir todos los marcadores:</0> Haz clic derecho en una carpeta de marcadores —en la pestaña <1>Web</1> o en la lista de marcadores del navegador— y elige <2>Abrir todo</2> para abrir cada marcador que contiene (incluidas las subcarpetas), cada uno en su propio panel de navegador. Si la carpeta tiene 5 o más marcadores, se te pide confirmación primero.',
    star:
      '<0>★ Añadir esta página:</0> Mientras navegas, haz clic en el botón <1>★</1> de la barra de herramientas para guardar la página actual en la carpeta que elijas.',
    toolbar:
      '<0>Barra de herramientas:</0> Atrás, Adelante, Recargar/Detener y una barra de direcciones. Solo se permiten direcciones <1>http://</1> y <2>https://</2>; una dirección escrita sin esquema usa <3>http://</3> de forma predeterminada. El texto que no sea una dirección web se busca en la web.',
    passwords:
      '<0>Inicios de sesión y contraseñas:</0> El navegador conserva tus sesiones y puede guardar y autocompletar contraseñas, almacenadas en el perfil de navegador cifrado propio de HoTTY (separado de tu Edge/Chrome del sistema).',
    clearData:
      '<0>Borrar datos de navegación:</0> Abre el menú ⋯ Más de la barra de herramientas y elige Borrar datos de navegación para borrar cookies y datos de sitios, caché, historial, contraseñas guardadas y autocompletado — eliges qué eliminar. Tus marcadores y la configuración de HoTTY se conservan siempre.',
    enable:
      '<0>Activar / desactivar:</0> La pestaña Web se puede desactivar en <1>Ajustes → Funciones</1>.',
  },

  fileExplorer: {
    summary: 'Explorador de archivos',
    intro:
      'Abra un panel de explorador de archivos integrado mediante <0><1></1></0> (Funciones) → <2>"Explorador de archivos"</2>. Examine sus unidades y directorios en una estructura de árbol contraíble.',
    navigate:
      '<0>Navegar:</0> haga clic en las carpetas para expandirlas/contraerlas. Use la ruta de migas de pan de la parte superior para una navegación rápida.',
    openFiles: '<0>Abrir archivos:</0> haga doble clic en un archivo para abrirlo en el Editor de texto.',
    hiddenFiles:
      '<0>Archivos ocultos:</0> alterne la visibilidad de los archivos ocultos con el icono del ojo en la barra de herramientas.',
    refresh: '<0>Actualizar:</0> haga clic en el botón de actualizar para recargar el directorio actual.',
  },

  aiQuickStart: {
    summary: 'Guía de inicio rápido de la IA',
    intro:
      'HoTTY tiene una IA integrada que puede analizar la salida del terminal, explicar errores, sugerir soluciones e incluso ejecutar comandos por usted. Aquí le mostramos cómo empezar en 3 pasos:',
    step1:
      '<0>Elija un proveedor:</0> vaya a <1>Configuración → IA → Proveedor de IA</1> y seleccione uno. Se recomiendan <2>Google AI Studio (Gemini)</2> o <3>Vertex AI</3> — consulte la tabla comparativa a continuación.',
    step2:
      '<0>Autentíquese:</0> abra una pestaña de chat de IA (<1><2></2></1> → Chat de IA) y siga las indicaciones en pantalla para iniciar sesión o introducir sus credenciales.',
    step3:
      '<0>Empiece a chatear:</0> escriba una pregunta, o seleccione texto en el terminal, haga clic derecho y escriba su pregunta en el cuadro <1>"Preguntar a la IA"</1>.',
    outro:
      '¡Eso es todo! Puede empezar a hacer preguntas de inmediato — no se necesita una configuración compleja.',
  },

  aiFeatures: {
    summary: 'Resumen de las funciones de IA',
    aiChatHeading: 'Chat de IA',
    aiChatIntro:
      'Haga clic en <0><1></1></0> (Funciones) en la barra de pestañas → <2>"Chat de IA"</2> para abrir el panel de chat de IA. Dentro, la tira de pestañas de la parte superior le permite mantener varias conversaciones en paralelo — use <3>+ Nuevo chat</3> para iniciar una pestaña nueva. Escriba su pregunta y pulse <4>Ctrl + Enter</4> para enviarla.',
    linkedTerminal:
      '<0>Terminal enlazado:</0> cuando inicia el Monitor de IA en un terminal, el panel de chat de IA enlaza una pestaña a ese terminal automáticamente — al activar el Monitor de IA en terminales adicionales se crea una nueva pestaña por terminal para que los flujos de salida permanezcan separados. El terminal enlazado actualmente se muestra como una etiqueta junto a la entrada. Al hacer clic en una pestaña también se resalta brevemente su panel de terminal enlazado para que pueda ver a qué sesión pertenece de un vistazo.',
    streamWatchdog:
      '<0>Vigilante de transmisión:</0> si un proveedor de IA deja de enviar datos a mitad de una respuesta (caída de red, backend colgado), la solicitud en curso se cancela automáticamente tras 3 minutos de silencio y aparece un mensaje de error en el chat — se acabaron los estados de "transmisión" atascados.',
    askAiHeading: 'Preguntar a la IA (clic derecho)',
    askAiBody:
      'Seleccione texto en el terminal (o haga clic en un <0>Marcador de terminal</0> para seleccionar un bloque de salida completo), luego haga clic derecho y escriba su pregunta en el cuadro <1>"Preguntar a la IA"</1> — pulse Enter para enviar. HoTTY abre el chat de IA con su pregunta y el texto seleccionado.',
    interactiveHeading: 'Modo interactivo (ejecución de comandos)',
    interactiveBody:
      'Cuando la IA sugiere un comando, puede enviarlo directamente a su sesión de terminal para ejecutarlo. Verá el comando antes de que se ejecute, por lo que mantiene el control.',
    executionHeading: 'Modo de ejecución y ejecución automática',
    executionBody:
      'La <0>etiqueta de modo de ejecución</0> en la parte inferior del panel de chat de IA controla cómo se ejecutan los comandos sugeridos por la IA — elija entre Preguntar, Ejecutar automáticamente los seguros o Pausar. Cuando la ejecución automática está activada, cada comando se juzga y se ejecuta automáticamente o espera una confirmación manual; Pausar detiene el bucle de ejecución automática sin cambiar el modo, y los controles de la etiqueta le permiten reanudarlo. Configure el límite de ejecuciones consecutivas y el <1>tiempo de espera de inactividad de respuesta del dispositivo</1> (predeterminado 10 segundos; 0 lo desactiva) en <2>Configuración → IA → Ejecución de comandos</2>. Cuando un comando comienza con <3>sleep N</3> (p. ej. <4>sleep 120 &amp;&amp; validate</4>), HoTTY espera esos segundos localmente en lugar de enviar el sleep al dispositivo — para que el tiempo de espera de inactividad no se active erróneamente durante la espera — y luego ejecuta cualquier comando encadenado después; active esto y su retardo máximo en <5>Configuración → IA</5>.',
    safetyHeading: 'Clasificador de seguridad de comandos (lista blanca / lista negra / IA)',
    safetyBody:
      'Cómo se juzga cada comando para la ejecución automática lo deciden tres capas, configurables en <0>Configuración → IA → Ejecución de comandos</0>. La <1>lista negra</1> se comprueba primero — una coincidencia nunca se ejecuta automáticamente (todavía se ofrece una ejecución manual). La <2>lista blanca</2> ejecuta automáticamente comandos obvios de solo lectura. Cualquier cosa intermedia se envía a la <3>IA</3>, que juzga si cambia la configuración; solo los comandos juzgados como de solo lectura con suficiente confianza se ejecutan automáticamente, todo lo demás pregunta. Ambas listas son totalmente editables: una sola palabra coincide con un comando base (p. ej. <4>docker</4>), y una entrada con espacios coincide como subcadena (p. ej. <5>rm -rf</5>, <6>git push</6>); cada lista tiene un botón de <7>Restablecer valores predeterminados</7>. Elija la estrategia (Estático / IA / <8>Híbrido</8>, el predeterminado) y el umbral de confianza de la IA en el mismo lugar. Cada bloque de ejecución muestra cómo se juzgó — En lista blanca, Veredicto de la IA, En lista negra o necesita confirmación — para que la decisión nunca quede oculta.',
    personasHeading: 'Perfiles',
    personasBody:
      'Cambie entre roles de IA (Asistente general, Experto en redes, Analista de seguridad, etc.) usando el selector de perfiles en la parte superior del chat. Cada perfil tiene un prompt del sistema adaptado a ese dominio. Haga clic en el indicador <0>prompt del sistema</0> para inspeccionar la instrucción exacta enviada al modelo y copiarla al portapapeles.',
    personasNetworkExpert:
      'El perfil <0>Experto en redes</0> prepara automáticamente un terminal enlazado: cuando su chat está enlazado a una sesión en vivo, identifica automáticamente el dispositivo y desactiva la paginación antes de que pregunte nada. Cambiar el terminal enlazado a un dispositivo diferente inicia primero un chat nuevo, mientras que volver a conectarse al mismo dispositivo solo vuelve a desactivar la paginación y mantiene su conversación.',
  },

  watchMode: {
    summary: 'Modo de monitoreo (monitoreo con IA)',
    intro:
      'El modo de monitoreo permite que la IA supervise la salida de una sesión de terminal y la analice a demanda — ideal para comandos de larga ejecución o el seguimiento de registros.',
    step1:
      'Haga clic en el icono <0><1></1></0> de cualquier pestaña de terminal para empezar a monitorear. El icono se vuelve azul y la pestaña obtiene un resaltado arcoíris.',
    step2: 'Ejecute comandos como de costumbre. Toda la salida se captura en un búfer.',
    step3:
      'En la <0>pestaña de chat de IA</0> enlazada, simplemente escriba su pregunta — o haga clic derecho en el texto del terminal y elija <1>Preguntar a la IA</1>. La salida capturada se incluye automáticamente para el análisis.',
    tip:
      '<0>Sugerencia:</0> deje que recopile salida y pida a la IA que la resuma o que encuentre errores cuando esté listo. El límite de tamaño del búfer se puede ajustar en <1>Configuración → IA → Límite del búfer del Monitor de IA</1>.',
  },

  chooseProvider: {
    summary: 'Elegir un proveedor de IA',
    intro:
      'HoTTY admite cuatro proveedores de IA. Elija el que mejor se adapte a sus necesidades:',
    thProvider: 'Proveedor',
    thBestFor: 'Mejor para',
    thAuth: 'Autenticación',
    thStatus: 'Estado',
    geminiName: 'Google AI Studio<0></0>(Gemini)',
    geminiBestFor: 'Uso personal, nivel gratuito disponible',
    geminiAuth: 'OAuth2',
    geminiStatus: 'Totalmente probado',
    vertexName: 'Google Cloud<0></0>Vertex AI',
    vertexBestFor: 'Uso empresarial / en producción',
    vertexAuth: 'ADC / Cuenta de servicio',
    vertexStatus: 'Totalmente probado',
    anthropicName: 'Anthropic<0></0>(Claude)',
    anthropicBestFor: 'Modelos de Claude mediante clave de API',
    anthropicAuth: 'Clave de API',
    experimental: 'Experimental',
    experimentalNote: '(sin probar — puede que no funcione como se espera)',
    openaiName: 'OpenAI',
    openaiBestFor: 'Modelos GPT mediante clave de API',
    openaiAuth: 'Clave de API',
    recommendation:
      '<0>Recomendación:</0> si no está seguro, empiece con <1>Google AI Studio (Gemini)</1> — tiene un nivel gratuito y es el proveedor más exhaustivamente probado.',
  },

  aiSetup: {
    summary: 'Configuración y autenticación de la IA',
    geminiHeading: 'Google AI Studio (Gemini) — Configuración de OAuth2',
    geminiStep1: 'Vaya a Google Cloud Console → APIs y servicios → Credenciales.',
    geminiStep2: 'Cree un <0>ID de cliente de OAuth 2.0</0> (tipo aplicación de escritorio).',
    geminiStep3:
      'En HoTTY, seleccione <0>Google AI Studio</0> como su proveedor, abra una pestaña de chat de IA e introduzca su ID de cliente y secreto de cliente.',
    geminiStep4:
      'Haga clic en <0>"Iniciar sesión con Google"</0> — se abrirá una ventana del navegador para la autorización.',
    geminiNote:
      'Las cuentas de nivel gratuito pueden tener datos usados para el entrenamiento de modelos. Active la facturación en su proyecto de Google Cloud para excluirse.',
    vertexHeading: 'Google Cloud Vertex AI — ADC o cuenta de servicio',
    vertexStep1:
      '<0>ADC (lo más fácil):</0> instale Google Cloud CLI y luego ejecute:<1></1><2>gcloud auth application-default login</2><3></3>HoTTY detecta estas credenciales automáticamente.',
    vertexStep2:
      '<0>Cuenta de servicio:</0> descargue un archivo de clave JSON desde Google Cloud Console → IAM → Cuentas de servicio, luego proporcione la ruta del archivo en Configuración.',
    vertexStep3:
      'Introduzca su <0>ID de proyecto de Google Cloud</0> y seleccione una <1>Región</1> en la pestaña de chat de IA.',
    anthropicHeading: 'Anthropic (Claude) — Clave de API',
    anthropicExperimental: '( Experimental)',
    anthropicStep1: 'Obtenga una clave de API desde Anthropic Console → API Keys.',
    anthropicStep2:
      'En HoTTY, seleccione <0>Anthropic</0> como su proveedor, abra una pestaña de chat de IA e introduzca su clave de API.',
    anthropicNote:
      'Este proveedor es experimental y no se ha probado por completo. Algunas funciones (modo de monitoreo, modo interactivo, etc.) pueden no funcionar como se espera. Informe de cualquier problema que encuentre.',
    openaiHeading: 'OpenAI — Clave de API',
    openaiExperimental: '( Experimental)',
    openaiStep1: 'Obtenga una clave de API desde OpenAI Platform → API Keys.',
    openaiStep2:
      'En HoTTY, seleccione <0>OpenAI</0> como su proveedor, abra una pestaña de chat de IA e introduzca su clave de API.',
    openaiNote:
      'Este proveedor es experimental y no se ha probado por completo. Algunas funciones (modo de monitoreo, modo interactivo, etc.) pueden no funcionar como se espera. Informe de cualquier problema que encuentre.',
    credentialsNote:
      'Todas las credenciales se cifran con Windows DPAPI y se almacenan localmente — nunca se transmiten fuera de su máquina, salvo al proveedor de IA correspondiente.',
  },

  customizing: {
    summary: 'Personalizar comandos y perfiles de IA',
    customPersonas:
      '<0>Perfiles personalizados:</0> en <1>Configuración → IA → Perfiles</1>, cree perfiles con prompts del sistema personalizados. El perfil elegido se aplica como instrucción inicial del sistema para cada nueva sesión de chat de IA.',
    proactiveInvestigation:
      '<0>Investigación proactiva:</0> la IA sugiere automáticamente comandos del terminal cuando necesita más información para cumplir su solicitud, y puede capturar resultados para continuar el análisis en el modo de monitoreo.',
  },

  themes: {
    summary: 'Temas y apariencia',
    builtIn:
      'Cambie entre los temas integrados (<0>Oscuro</0>, <1>Medio</1>, <2>Claro</2>) en <3>Configuración → Apariencia → Tema</3>.',
    customThemes:
      '<0>Temas personalizados:</0> haga clic en <1>"+ Crear tema personalizado"</1> para abrir el editor de temas. Ajuste cualquier variable de color y guárdela con un nombre personalizado. Los temas personalizados se pueden editar o eliminar en cualquier momento.',
    providerColors:
      '<0>Colores de proveedores de IA:</0> el editor de temas incluye una sección de <1>Proveedores de IA</1> para personalizar los colores de marca usados por los iconos de Gemini, OpenAI, Anthropic y Vertex AI.',
    futuristic:
      '<0>Efectos futuristas:</0> la sección <1>Efectos futuristas</1> del editor de temas añade un brillo neón opcional en los paneles activos y los iconos de la barra lateral, desenfoque de fondo con glassmorfismo en los modales y un ancho de trazo de iconos configurable.',
    unusedPane:
      '<0>Fondo del panel sin usar:</0> en <1>Configuración → Apariencia</1>, elija un color sólido o una imagen personalizada para mostrar en los paneles de cuadrícula vacíos.',
    language:
      '<0>Idioma de la interfaz:</0> cambie el idioma de la interfaz en <1>Configuración → General → Idioma de la interfaz</1>. HoTTY está disponible en English, 日本語, 简体中文, 繁體中文, 한국어, Русский, Español y Français; el cambio se aplica al instante. (El idioma de respuesta de la IA se configura por separado en el panel de chat de IA.)',
  },
};
