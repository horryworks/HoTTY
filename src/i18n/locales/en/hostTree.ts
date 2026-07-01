// Host tree sidebar — toolbar, context menu, the New Connection pseudo-row, the
// empty-state hint, the add/edit/export/import modal, the delete confirmation,
// and the success/failure notification messages.
export const hostTree = {
  toolbar: {
    addFolder: 'Add Folder',
    addHost: 'Add Host',
    exportTree: 'Export Tree',
    importTree: 'Import Tree',
  },
  newConnection: 'New Connection',
  newConnectionTitle: 'Start a new connection (clears the form)',
  empty: 'Right-click or use the + buttons above to add hosts and folders',
  contextMenu: {
    openAll: 'Open All',
    addFolder: 'Add Folder',
    addHost: 'Add Host',
    rename: 'Rename (F2)',
    export: 'Export',
    import: 'Import',
    sortAscending: 'Sort Ascending',
  },
  openAll: {
    confirmTitle: 'Open all hosts',
    // {{count}} = number of hosts, {{name}} = folder name.
    confirmMessage: 'Open all {{count}} hosts in "{{name}}"?',
  },
  modal: {
    renameFolder: 'Rename Folder',
    addFolder: 'Add Folder',
    editHost: 'Edit Host',
    addHost: 'Add Host',
    exportTitle: 'Export Host Tree',
    importTitle: 'Import Host Tree',
    displayName: 'Display Name',
    setEncryptionPassword: 'Set encryption password:',
    enterDecryptionPassword: 'Enter decryption password:',
    exportPasswordHint: 'This password will be required to import the file later.',
    importPasswordHint: 'Enter the password that was used to export this file.',
    protocol: 'Protocol',
    useAsJumpbox: 'Use as Jumpbox',
    hostLabel: 'Host/IP',
    hostPlaceholder: '192.168.1.1',
    portLabel: 'Port',
    usernameLabel: 'Username',
    passwordLabel: 'Password',
    export: 'Export',
    import: 'Import',
  },
  delete: {
    titleFolder: 'Delete Folder',
    titleHost: 'Delete Host',
    // {{name}} is the node display name. {{warning}} is appended only when the
    // host is referenced as a jumpbox (see jumpboxWarning below); empty otherwise.
    message: 'Are you sure you want to delete "{{name}}"?\nThis action cannot be undone.{{warning}}',
    // {{count}} hosts, {{names}} = comma-joined list of host names.
    jumpboxWarning:
      '\n\nThis host is used as a jumpbox by {{count}} host(s): {{names}}. Their jumpbox setting will be cleared.',
  },
  messages: {
    importErrorTitle: 'Import Error',
    // {{error}} is the underlying error text.
    importErrorBody: 'Failed to open file: {{error}}',
    exportSuccessTitle: 'Export Successful',
    exportSuccessBody: 'Host tree has been exported successfully.',
    exportFailedTitle: 'Export Failed',
    importSuccessTitle: 'Import Successful',
    importSuccessBody: 'Hosts imported successfully.',
    // {{folderName}} is the generated "Imported_<file>" folder name.
    importSuccessIntoFolder: 'Hosts imported and added to "{{folderName}}" folder.',
    importFailedTitle: 'Import Failed',
  },
} as const;
