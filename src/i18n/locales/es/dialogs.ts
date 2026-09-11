// Diálogos modales — confirmación, pegar, clave de host SSH,
// prompt del sistema, Preguntar a la IA, inicio de VM IAP y Guardar en árbol de hosts.
export const dialogs = {
  closeAiWindow: {
    title: 'Cerrar AI Chat',
    message_one: 'Al cerrar esta ventana terminará {{count}} conversación.',
    message_other: 'Al cerrar esta ventana terminarán {{count}} conversaciones.',
    workers_one: 'También se desconectará la terminal que abrió la IA.',
    workers_other: 'También se desconectarán las {{count}} terminales que abrió la IA.',
    hint: 'Para conservarlas, usa «Devolver» en su lugar.',
    confirmLabel: 'Cerrar',
  },
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
  moveByPrefix: {
    title: 'Ordenar por rango de IP',
    scopeFolder: 'Hosts en {{name}}',
    scopeTree: 'Todos los hosts',
    matchIn: 'Comparar con',
    matchScope: '{{name}} y su contenido ({{count}})',
    matchTree: 'Todo el árbol ({{count}})',
    scopeHint: 'Reducir el ámbito es la salida cuando NetBox reutiliza el mismo rango privado en cada sede.',
    willMove: 'Se moverán ({{count}})',
    alreadyPlaced: 'Ya están en la carpeta correcta ({{count}})',
    ambiguous: 'Varias carpetas los reclaman ({{count}})',
    ambiguousHint: 'No se tocan: HoTTY no elige entre carpetas que reclaman el mismo rango. Muévelos tú o corrige el solapamiento en NetBox.',
    unmatched: 'Sin coincidencia ({{count}})',
    reasonNotAnAddress: 'no es una dirección IP',
    reasonNoMatch: 'fuera de todos los prefijos',
    moveRow: '{{from}} → {{to}}',
    topLevel: 'Nivel superior',
    noPrefixes: 'Ninguna carpeta del árbol tiene todavía un prefijo de NetBox. Sincroniza con NetBox con la colocación por prefijo activada.',
    nothingToDo: 'Todos los hosts ya están donde indica su dirección.',
    apply: 'Mover {{count}}',
    cancel: 'Cancelar',
    moved: 'Se movieron {{count}} hosts',
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
    netboxSuggested: 'Se eligió la carpeta que cubre {{prefix}} en NetBox.',
    netboxAmbiguous: 'Más de una carpeta de NetBox cubre {{prefix}}, así que no se eligió ninguna: {{folders}}',
  },
};
