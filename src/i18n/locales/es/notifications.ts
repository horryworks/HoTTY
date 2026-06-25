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
    viewRelease: 'Ver versión',
    dismiss: 'Descartar',
    dismissAria: 'Descartar notificación de actualización',
  },
  errorBoundary: {
    title: 'Algo salió mal',
    reload: 'Recargar',
    dismiss: 'Descartar',
  },
};
