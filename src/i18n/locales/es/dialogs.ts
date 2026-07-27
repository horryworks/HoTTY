// Diálogos modales — confirmación, pegar, clave de host SSH,
// prompt del sistema, Preguntar a la IA, inicio de VM IAP y Guardar en árbol de hosts.
export const dialogs = {
  confirm: {
    title: 'Confirmar',
    // Etiqueta predeterminada del botón de confirmación cuando quien lo invoca no la pasa.
    confirmLabel: 'Eliminar',
  },
  paste: {
    header: 'Confirmación de pegado',
    newlineWarning: '⚠️ Advertencia: contiene caracteres de salto de línea',
    paste: 'Pegar',
  },
  sshHostKey: {
    titleChanged: 'La clave del host CAMBIÓ',
    titleUnknown: 'Clave de host desconocida',
    warning:
      'ADVERTENCIA: la clave de host de este servidor ha cambiado desde la última conexión. Esto podría indicar un ataque de intermediario (man-in-the-middle).',
    host: 'Host:',
    keyType: 'Tipo de clave:',
    fingerprint: 'Huella digital:',
    reject: 'Rechazar',
    acceptOnce: 'Aceptar una vez',
    acceptRemember: 'Aceptar y recordar',
  },
  systemPrompt: {
    ariaLabel: 'Visor del prompt del sistema',
    // {{persona}} se interpola.
    title: 'Prompt del sistema — {{persona}}',
  },
  iapVmStart: {
    title: '¿Iniciar VM de GCE?',
    // <0>{{status}}</0> envuelve el estado actual en un <strong> mediante <Trans>.
    message:
      'La VM de destino está actualmente <0>{{status}}</0>. ¿Iniciarla ahora para continuar con la conexión IAP?',
    instance: 'Instancia:',
    project: 'Proyecto:',
    zone: 'Zona:',
    startVm: 'Iniciar VM',
  },
  saveToHostTree: {
    title: 'Guardar en el árbol de hosts',
    unsupported:
      'Esta sesión no se puede guardar (solo se admiten sesiones SSH y Telnet).',
    nameLabel: 'Nombre',
    folderLabel: 'Carpeta',
    rootFolder: '(Raíz)',
    newFolderPlaceholder: 'Nombre de la nueva carpeta',
    create: 'Crear',
    newFolder: '+ Nueva carpeta',
  },
};
