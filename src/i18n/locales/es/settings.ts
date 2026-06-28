// Modal de configuración — shell, etiquetas de pestañas y todo el contenido de las pestañas.
export const settings = {
  title: 'Configuración',
  tabs: {
    general: 'General',
    appearance: 'Apariencia',
    protocols: 'Protocolos',
    features: 'Funciones',
    ai: 'IA',
    about: 'Acerca de',
  },
  general: {
    // Selector de idioma (este paso)
    languageSection: 'Idioma',
    languageLabel: 'Idioma de visualización',
    languageHelp:
      'Cambia el idioma de la interfaz de la aplicación. (El idioma de respuesta de la IA se configura por separado en el panel de chat de IA.)',
    // Registro
    loggingSection: 'Registro',
    enableLogging: 'Activar registro',
    logFolderPath: 'Ruta de la carpeta de registros',
    logFolderPathHelp: 'Los registros se guardan como YYYYMMDDHHMMSS-(Protocolo)-(IP).txt',
    logFolderPathPlaceholder: 'Seleccione una carpeta o escriba la ruta...',
    // Terminal
    terminalSection: 'Terminal',
    scrollbackBuffer: 'Búfer de desplazamiento',
    scrollbackHelp: 'Máximo de líneas que se mantienen en memoria por terminal (predeterminado: 10000).',
    enableLineWrap: 'Activar ajuste de línea',
    // Entrada
    inputSection: 'Entrada',
    backspaceSendsDel: 'Retroceso envía DEL (0x7F)',
    backspaceSendsDelHelp:
      'Si se desactiva, Retroceso envía 0x08 (BS). Actívelo si su servidor espera 0x7F.',
    rightClickPaste: 'Clic derecho para pegar',
    rightClickPasteHelp: 'Al hacer clic derecho en el terminal se muestra el diálogo de confirmación de pegado.',
    // Diagnósticos
    diagnosticsSection: 'Diagnósticos',
    debugLog: 'Registro de depuración',
    debugLogHelp: 'Comparta el último archivo de registro al informar de un error.',
    openDebugLogFolder: 'Abrir carpeta de registros de depuración',
  },
  appearance: {
    // Diseño
    layoutSection: 'Diseño',
    sidebarPosition: 'Posición de la barra lateral',
    sidebarLeft: 'izquierda',
    sidebarRight: 'derecha',
    // Tema
    themeSection: 'Tema',
    themeLabel: 'Tema',
    deleteTheme: 'Eliminar',
    createCustomTheme: 'Crear tema personalizado',
    deleteThemeTitle: 'Eliminar tema',
    deleteThemeMessage:
      '¿Eliminar el tema personalizado "{{name}}"? Esto no se puede deshacer.',
    // Fondo del panel sin usar
    unusedPaneBackground: 'Fondo del panel sin usar',
    paneBackgroundColor: 'color',
    paneBackgroundImage: 'imagen',
    paneBackgroundImagePlaceholder: 'p. ej. http://asset.localhost/...',
    browse: 'Examinar…',
    clearImage: 'Quitar imagen',
    clear: 'Limpiar',
    // Fuente
    fontSection: 'Fuente',
    fontFamily: 'Familia de fuentes',
    systemMonospaceDefault: 'Monoespaciada del sistema (predeterminada)',
    scanning: 'Buscando...',
    rescan: 'Volver a buscar',
    fontSize: 'Tamaño de fuente (px)',
    // Visualización del terminal
    terminalDisplaySection: 'Visualización del terminal',
    defaultEncoding: 'Codificación predeterminada',
    defaultEncodingHelp: 'Se aplica a las nuevas conexiones.',
    promptHighlight: 'Resaltado del prompt',
    enableUserInputHighlight: 'Activar resaltado de entrada del usuario',
    highlightColor: 'Color de resaltado',
    promptPatternsRegex: 'Patrones de prompt (Regex)',
    namePlaceholder: 'Nombre',
    regexPlaceholder: 'Regex',
    addPattern: '+ Añadir patrón',
    resetToDefault: 'Restablecer valores predeterminados',
  },
  protocols: {
    // SSH
    sshSection: 'SSH',
    connectTimeout: 'Tiempo de espera de conexión',
    timeoutSeconds: 'Tiempo de espera (segundos)',
    sshTimeoutHelp:
      'Tiempo máximo de espera para el protocolo de enlace inicial TCP y SSH antes de cancelar. Predeterminado: 5 segundos.',
    keepAlive: 'KeepAlive',
    enable: 'Activar',
    sshKeepAliveHelp: 'Envía paquetes ficticios para evitar tiempos de espera.',
    intervalSeconds: 'Intervalo (segundos)',
    // Algoritmos
    algorithms: 'Algoritmos',
    algorithmsHelp: 'Elija qué algoritmos activar. Los cambios se aplican a las nuevas sesiones.',
    categoryServerHostKey: 'Clave de host del servidor',
    categoryKex: 'Intercambio de claves',
    categoryCipher: 'Cifrado',
    categoryMac: 'MAC',
    // Telnet
    telnetSection: 'Telnet',
    telnetTimeoutHelp:
      'Tiempo máximo de espera para la conexión TCP inicial antes de cancelar. Predeterminado: 5 segundos.',
    telnetKeepAliveHelp: 'Envía comandos NOP de Telnet para evitar tiempos de espera por inactividad.',
    // Advertencia de DH-GEX SHA-1
    dhGexTitle: '¿Activar diffie-hellman-group-exchange-sha1?',
    dhGexConfirm: 'Activar',
    dhGexWarning:
      'diffie-hellman-group-exchange-sha1 se basa en SHA-1, que se considera ' +
      'roto y se eliminó de los valores predeterminados de OpenSSH en la versión 8.2. Actívelo solo si ' +
      'debe comunicarse con dispositivos heredados que no ofrecen un intercambio de claves más sólido.\n\n' +
      'Prefiera diffie-hellman-group-exchange-sha256, diffie-hellman-group14-sha256, ' +
      'o curve25519-sha256 siempre que el dispositivo remoto los admita.\n\n' +
      '¿Activar diffie-hellman-group-exchange-sha1 de todos modos?',
  },
  features: {
    fileServerLabel: 'Servidor de archivos',
    fileServerDescription: 'Servidor TFTP / SFTP para subir firmware a dispositivos de red',
    webBrowserLabel: 'Navegador web',
    webBrowserDescription: 'Panel de navegador integrado para las interfaces web de administración de dispositivos de red',
    section: 'Funciones',
    sectionHelp: 'Active o desactive los paneles de funciones. Los paneles ya abiertos no se ven afectados.',
    aiChatLabel: 'Chat de IA',
    aiChatDescription: 'Panel de chat con IA para asistencia en el terminal',
    logViewerLabel: 'Visor de registros',
    logViewerDescription: 'Ver y analizar registros de sesión',
    pingMonitorLabel: 'Monitor de Ping',
    pingMonitorDescription: 'Monitoreo continuo de Ping ICMP',
    textEditorLabel: 'Editor de texto',
    textEditorDescription: 'Editor de archivos de texto integrado',
    fileExplorerLabel: 'Explorador de archivos',
    fileExplorerDescription: 'Examinar y gestionar archivos',
  },
  ai: {
    // Proveedor
    providerSection: 'Proveedor',
    aiProvider: 'Proveedor de IA',
    aiProviderHelp:
      'Vertex AI y Gemini usan OAuth de Google. Anthropic y OpenAI requieren claves de API.',
    providerVertexAi: 'Google Cloud Vertex AI',
    providerGemini: 'Google AI Studio (Gemini)',
    providerAnthropic: 'Anthropic (Claude)',
    providerOpenai: 'OpenAI',
    // Autenticación
    authentication: 'Autenticación',
    authenticated: 'Autenticado',
    notAuthenticated: 'No autenticado',
    logout: 'Cerrar sesión',
    // Perfiles
    personasSection: 'Perfiles',
    addPersona: 'Añadir perfil',
    personaName: 'Nombre del perfil',
    displayNamePlaceholder: 'Nombre para mostrar',
    systemPrompt: 'Prompt del sistema',
    systemPromptPlaceholder: 'Prompt del sistema',
    deletePersona: 'Eliminar perfil',
    atLeastOnePersona: 'Se requiere al menos un perfil',
    deletePersonaTitle: 'Eliminar "{{label}}"',
    resetAllPersonas: 'Restablecer todos los perfiles',
    newPersonaLabel: 'Nuevo perfil',
    // Ejecución de comandos
    commandExecutionSection: 'Ejecución de comandos',
    commandExecutionHelp:
      'El modo de ejecución y el límite de ejecución automática se configuran en el panel de chat de IA (debajo de la entrada de mensajes).',
    commandSafetyClassifier: 'Clasificador de seguridad de comandos',
    commandSafetyClassifierHelp:
      'Cómo decide HoTTY si un comando sugerido por la IA se ejecuta automáticamente. La lista negra siempre se comprueba primero (una coincidencia pregunta antes de ejecutar). Estático: la lista blanca se ejecuta automáticamente, todo lo demás pregunta. IA: la IA juzga todo lo que no esté en la lista negra. Híbrido (recomendado): la lista blanca se ejecuta automáticamente, la IA juzga el resto, de lo contrario pregunta.',
    classifierStatic: 'Lista blanca estática',
    classifierAi: 'Juicio de la IA',
    classifierHybrid: 'Híbrido (recomendado)',
    aiConfidenceThreshold: 'Umbral de confianza de la IA: {{percent}}%',
    aiConfidenceThresholdHelp:
      'Confianza mínima de la IA requerida para ejecutar automáticamente un comando juzgado como de solo lectura. Por debajo de esto, el comando espera una ejecución manual. Más alto = más cauteloso. Predeterminado: 70%.',
    deviceResponseTimeout: 'Tiempo de espera de respuesta del dispositivo (segundos)',
    deviceResponseTimeoutHelp:
      'Si el dispositivo no produce nueva salida durante esta cantidad de segundos tras un comando, se informa a la IA de que el dispositivo dejó de responder para que el bucle pueda continuar. 0 desactiva la detección de inactividad. Predeterminado: 10.',
    sleepAsClientDelay: 'Ejecutar el `sleep` inicial como retardo del lado del cliente',
    sleepAsClientDelayHelp:
      'Cuando la IA emite un comando que comienza con `sleep N` (p. ej. `sleep 120 && validate`), espere N segundos en HoTTY en lugar de ejecutar sleep en el dispositivo. Esto evita que el tiempo de espera de respuesta del dispositivo anterior se active erróneamente durante el sleep. Cualquier comando encadenado se ejecuta tras la espera. Predeterminado: activado.',
    maxClientDelay: 'Retardo máximo del lado del cliente (segundos)',
    maxClientDelayHelp:
      'Límite superior para un retardo de sleep del lado del cliente; los sleep más largos se limitan a esto y se anotan. 0 = sin límite. Predeterminado: 900 (15 min).',
    whitelist: 'Lista blanca (ejecución automática)',
    whitelistHelp:
      "Los comandos que coinciden aquí se ejecutan automáticamente. Una sola palabra coincide como comando base (p. ej. 'docker' coincide con cualquier comando de docker); una entrada con espacios coincide como prefijo de comando (p. ej. 'git log'). Se inicializa con valores predeterminados seguros; totalmente editable.",
    whitelistPlaceholder: 'p. ej., docker, kubectl get',
    add: 'Añadir',
    resetToDefaults: 'Restablecer valores predeterminados',
    resetWhitelistTitle: 'Restablecer la lista blanca a los valores predeterminados integrados',
    removeEntry: 'Quitar {{cmd}}',
    blacklist: 'Lista negra (preguntar antes de ejecutar)',
    blacklistHelp:
      "Los comandos que coinciden aquí nunca se ejecutan automáticamente — todavía se permite una ejecución manual, con una advertencia. Una sola palabra coincide como comando base; una entrada con espacios coincide como subcadena (p. ej. 'rm -rf', 'git push'). Se inicializa con valores predeterminados destructivos; totalmente editable.",
    blacklistPlaceholder: 'p. ej., rm -rf, git push',
    resetBlacklistTitle: 'Restablecer la lista negra a los valores predeterminados integrados',
    // Modales
    privacyNoticeTitle: 'Aviso de privacidad',
    privacyNoticeMessage:
      'Google AI Studio (Gemini) puede usar sus datos para el entrenamiento de la IA en el nivel gratuito. Active la facturación en su proyecto de Google Cloud para excluirse.',
    privacyNoticeConfirm: 'Aceptar',
    logoutTitle: 'Cerrar sesión',
    logoutMessage:
      '¿Está seguro de que desea cerrar sesión? Deberá volver a autenticarse para usar el proveedor de IA.',
    logoutConfirm: 'Cerrar sesión',
    // Divulgación sobre el tratamiento de datos
    dataHandlingSection: 'Tratamiento de datos',
    dataHandlingHelp:
      'Cuando usa las funciones de IA, los datos se envían al proveedor de IA externo que haya configurado, usando su propia clave de API, conforme a los términos y la política de privacidad de dicho proveedor.',
    dataHandlingBulletProviders:
      'Proveedores: Google Gemini / Vertex AI, Anthropic u OpenAI, el que seleccione más arriba.',
    dataHandlingBulletWhen:
      'Se envían solo cuando usa explícitamente una función de IA (chat, Preguntar a la IA o Monitorización). Su terminal nunca se transmite de forma continua.',
    dataHandlingBulletRedaction:
      'Los patrones de secretos conocidos se ocultan de los registros, pero el texto que escribe en un mensaje se envía tal cual: evite pegar credenciales.',
    dataConsentStatus: 'Consentimiento de divulgación',
    dataConsentAccepted: 'Aceptado',
    dataConsentNotAccepted: 'Aún no se ha mostrado',
    resetDataConsent: 'Mostrar de nuevo',
    resetDataConsentHelp:
      'Restablezca el consentimiento para que la divulgación sobre el envío de datos a la IA se muestre de nuevo antes del próximo envío a la IA.',
  },
  about: {
    version: 'v{{version}}',
    author: 'Katsumasa "Horry" Horiuchi',
    descriptionLine1: 'Emulador de terminal SSH/Telnet/Serie',
    descriptionLine2: 'Construido con Tauri, React y TypeScript',
    licenseLine1: 'Este programa es software libre publicado bajo la',
    licenseLine2: 'GNU General Public License v3.0 o posterior.',
    viewLicense: 'Ver GNU General Public License v3.0',
    logoAlt: 'Logotipo de HoTTY',
    // Licencias de terceros
    thirdPartyLicenses: 'Licencias de terceros',
    thirdPartyLicensesTitle: 'Licencias de terceros',
    thirdPartyLicensesIntro: 'HoTTY incluye software de código abierto de los siguientes proyectos:',
    thirdPartyLicensesLoading: 'Cargando licencias…',
    thirdPartyLicensesError: 'No se pudo cargar la información de licencias.',
    thirdPartyLicensesEmpty: 'No hay información de licencias de terceros disponible.',
    thirdPartyLicensesClose: 'Cerrar',
  },
  customTheme: {
    title: 'Creador de temas personalizados',
    cancel: 'Cancelar',
    themeName: 'Nombre del tema',
    themeNamePlaceholder: 'p. ej. Mi azul oscuro',
    baseTheme: 'Tema base',
    saveTheme: 'Guardar tema',
    saving: 'Guardando...',
    terminalSectionTitle: 'Terminal',
    terminalSectionDesc: 'Colores del terminal xterm.js',
    // Validación
    errorEmptyName: 'Introduzca un nombre de tema.',
    errorNoAlphanumeric: 'El nombre del tema debe contener al menos un carácter alfanumérico.',
    errorProtectedName: 'No se puede usar "dark", "medium" o "light" como nombre de tema.',
    errorSaveFailed: 'No se pudo guardar el tema.',
    // Títulos y descripciones de secciones
    sectionBackgroundsTitle: 'Fondos y texto',
    sectionBackgroundsDesc: 'Colores principales de fondo y texto',
    sectionBordersTitle: 'Bordes y acentos',
    sectionBordersDesc: 'Colores de borde y colores de acento/resaltado',
    sectionInputsTitle: 'Entradas, botones y estados de cursor',
    sectionInputsDesc: 'Campos de entrada, botones y colores del estado de cursor encima',
    sectionStatusTitle: 'Estado y señales',
    sectionStatusDesc: 'Colores de los indicadores de éxito, error, advertencia y peligro',
    sectionAiChatTitle: 'Chat de IA',
    sectionAiChatDesc: 'Colores para los mensajes de chat de IA y los bloques de código',
    sectionUiTitle: 'Componentes específicos de la UI',
    sectionUiDesc: 'Barra lateral, pestañas, menús contextuales, iconos y otros elementos de la UI',
    sectionProvidersTitle: 'Proveedores de IA',
    sectionProvidersDesc:
      'Colores de marca usados para los iconos de los proveedores de IA (Gemini, OpenAI, Anthropic, Vertex AI)',
    sectionSearchTitle: 'Búsqueda y resaltado',
    sectionSearchDesc: 'Colores de resaltado de resultados de búsqueda',
    sectionOverlaysTitle: 'Superposiciones y modales',
    sectionOverlaysDesc: 'Diálogos modales, superposiciones y banners de notificación',
    sectionEffectsTitle: 'Efectos futuristas',
    sectionEffectsDesc:
      'Efectos de brillo neón y glassmorfismo aplicados a los paneles activos, las barras laterales y los modales',
    // Filas de colores del terminal
    terminalForeground: 'Primer plano',
    terminalForegroundDesc: 'Color de texto predeterminado dentro del terminal',
    terminalBackground: 'Fondo (activo)',
    terminalBackgroundDesc: 'Fondo del terminal activo/enfocado',
    terminalBackgroundInactive: 'Fondo (inactivo)',
    terminalBackgroundInactiveDesc: 'Fondo de los terminales inactivos/no enfocados',
    terminalPaneBackground: 'Fondo del panel',
    terminalPaneBackgroundDesc: 'Color del espacio que rodea el terminal',
  },
};
