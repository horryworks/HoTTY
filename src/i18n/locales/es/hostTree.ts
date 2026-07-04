// Barra lateral del árbol de hosts — barra de herramientas, menú contextual, la
// pseudofila de Nueva conexión, la sugerencia de estado vacío, el modal de
// añadir/editar/exportar/importar, la confirmación de eliminación y los mensajes
// de notificación de éxito/fallo.
export const hostTree = {
  toolbar: {
    addFolder: 'Añadir carpeta',
    addHost: 'Añadir host',
    exportTree: 'Exportar árbol',
    importTree: 'Importar árbol',
  },
  newConnection: 'Nueva conexión',
  newConnectionTitle: 'Iniciar una nueva conexión (limpia el formulario)',
  empty: 'Haga clic con el botón derecho o use los botones + de arriba para añadir hosts y carpetas',
  contextMenu: {
    openAll: 'Abrir todo',
    addFolder: 'Añadir carpeta',
    addHost: 'Añadir host',
    rename: 'Cambiar nombre (F2)',
    export: 'Exportar',
    import: 'Importar',
    sortAscending: 'Ordenar ascendente',
    sortDescending: 'Ordenar descendente',
  },
  openAll: {
    confirmTitle: 'Abrir todos los hosts',
    // {{count}} = número de hosts, {{name}} = nombre de la carpeta.
    confirmMessage: '¿Abrir los {{count}} hosts de "{{name}}"?',
  },
  modal: {
    renameFolder: 'Cambiar nombre de carpeta',
    addFolder: 'Añadir carpeta',
    editHost: 'Editar host',
    addHost: 'Añadir host',
    exportTitle: 'Exportar árbol de hosts',
    importTitle: 'Importar árbol de hosts',
    displayName: 'Nombre para mostrar',
    setEncryptionPassword: 'Establecer contraseña de cifrado:',
    enterDecryptionPassword: 'Introducir contraseña de descifrado:',
    exportPasswordHint: 'Esta contraseña será necesaria para importar el archivo más adelante.',
    importPasswordHint: 'Introduzca la contraseña que se usó para exportar este archivo.',
    protocol: 'Protocolo',
    useAsJumpbox: 'Usar como jumpbox',
    hostLabel: 'Host/IP',
    hostPlaceholder: '192.168.1.1',
    portLabel: 'Puerto',
    usernameLabel: 'Nombre de usuario',
    passwordLabel: 'Contraseña',
    export: 'Exportar',
    import: 'Importar',
  },
  delete: {
    titleFolder: 'Eliminar carpeta',
    titleHost: 'Eliminar host',
    // {{name}} es el nombre para mostrar del nodo. {{warning}} se añade solo cuando el
    // host se usa como jumpbox (ver jumpboxWarning abajo); vacío en caso contrario.
    message: '¿Está seguro de que desea eliminar "{{name}}"?\nEsta acción no se puede deshacer.{{warning}}',
    // {{count}} hosts, {{names}} = lista de nombres de host separada por comas.
    jumpboxWarning:
      '\n\nEste host se usa como jumpbox en {{count}} host(s): {{names}}. Su configuración de jumpbox se borrará.',
  },
  messages: {
    importErrorTitle: 'Error de importación',
    // {{error}} es el texto del error subyacente.
    importErrorBody: 'No se pudo abrir el archivo: {{error}}',
    exportSuccessTitle: 'Exportación correcta',
    exportSuccessBody: 'El árbol de hosts se ha exportado correctamente.',
    exportFailedTitle: 'Error de exportación',
    importSuccessTitle: 'Importación correcta',
    importSuccessBody: 'Hosts importados correctamente.',
    // {{folderName}} es el nombre de carpeta generado "Imported_<archivo>".
    importSuccessIntoFolder: 'Hosts importados y añadidos a la carpeta "{{folderName}}".',
    importFailedTitle: 'Error de importación',
  },
};
