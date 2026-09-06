// Notificaciones y superposiciones — UI transitoria a nivel de aplicación (avisos de
// error, superposición de conexión, banner de actualización, pantalla de fallo).
export const notifications = {
  error: {
    dismiss: 'Descartar notificación de error',
  },
  connecting: {
    label: 'Conectando a',
  },
  update: {
    titleAvailable: 'Nueva versión disponible: v{{version}}',
    prereleaseSuffix: ' (versión preliminar)',
    running: 'Está ejecutando la v{{version}}',
    viewRelease: 'Cambiar de versión',
    dismiss: 'Descartar',
    dismissAria: 'Descartar notificación de actualización',
  },
  // Toast text for logError() call sites. logError pushes into the error
  // notification store, so every literal handed to it is user-facing UI and
  // must be a key here rather than an inline string.
  errors: {
    aiChatSendFailed: 'No se pudo enviar la solicitud a la IA',
    aiChatLogDisabled: 'Se ha desactivado el registro del chat de IA',
    aiCredentialEncrypt: 'No se pudieron cifrar las credenciales de IA',
    aiSignInStart: 'No se pudo iniciar el inicio de sesión',
    aiLogout: 'Error al cerrar la sesión',
    aiAutoAuth: 'Error en el inicio de sesión automático',
    aiAuthListener: 'No se pudieron recibir los resultados del inicio de sesión',
    aiLogoutListener: 'No se pudieron recibir los eventos de cierre de sesión',
    aiResponseListener: 'No se pudieron recibir las respuestas de la IA',
    iapVmPromptListen: 'No se pudieron recibir los avisos de inicio de VM',
    iapVmPromptRespond: 'No se pudo responder al aviso de inicio de VM',
    sshHostKeyListen: 'No se pudieron recibir los avisos de clave de host SSH',
    browserPaneCreate: 'No se pudo abrir el panel del navegador web',
    browserNavigate: 'Error de navegación',
    browserClearData: 'No se pudieron borrar los datos de navegación',
    trafficSettingsRestore: 'No se pudo restaurar la configuración del panel de tráfico',
    trafficListener: 'No se pudieron recibir los eventos de tráfico',
    pingMonitorListener: 'No se pudieron recibir los eventos del monitor de ping',
    fileServerListener: 'No se pudieron recibir los eventos del servidor de archivos',
    credentialBatch: 'No se pudieron procesar las credenciales de {{label}}',
    hostTreeEncrypt: 'No se pudieron cifrar las credenciales: el árbol de hosts no se guardó',
    credentialMigration: 'Error en la migración de credenciales',
    credentialPreload: 'Error al descifrar las credenciales en segundo plano',
    sessionLoggingUpdate: 'No se pudo actualizar el registro de la sesión',
    sessionListener: 'No se pudieron recibir los eventos de sesión',
    clipboardCopy: 'No se pudo copiar la selección',
  },
  errorBoundary: {
    title: 'Algo salió mal',
    reload: 'Recargar',
    dismiss: 'Descartar',
  },
};
