// Modal dialogs — confirmation, save/discard, paste, SSH host key, system prompt,
// Ask AI, IAP VM start, and Save-to-Host-Tree. Grouped one key block per dialog.
export const dialogs = {
  unsavedEditors: {
    title: 'Unsaved changes',
    bodyOne: 'You have {{count}} unsaved text editor tab. Close anyway and discard changes?',
    bodyMany: 'You have {{count}} unsaved text editor tabs. Close anyway and discard changes?',
    discardQuit: 'Discard & Quit',
  },
  confirm: {
    title: 'Confirm',
    // Default confirm-button label when a caller does not pass one.
    confirmLabel: 'Delete',
  },
  saveConfirm: {
    heading: 'Unsaved changes',
    // {{filename}} is rendered in its own styled span via <Trans>.
    body: '<0>{{filename}}</0> has unsaved changes. Do you want to save before closing?',
    dontSave: "Don't save",
  },
  paste: {
    header: 'Paste Confirmation',
    newlineWarning: '⚠️ Warning: Contains newline characters',
    paste: 'Paste',
  },
  sshHostKey: {
    titleChanged: 'Host key CHANGED',
    titleUnknown: 'Unknown host key',
    warning:
      'WARNING: The host key for this server has changed since last connection. This could indicate a man-in-the-middle attack.',
    host: 'Host:',
    keyType: 'Key type:',
    fingerprint: 'Fingerprint:',
    reject: 'Reject',
    acceptOnce: 'Accept once',
    acceptRemember: 'Accept & remember',
  },
  systemPrompt: {
    ariaLabel: 'System prompt viewer',
    // {{persona}} is interpolated.
    title: 'System Prompt — {{persona}}',
  },
  iapVmStart: {
    title: 'Start GCE VM?',
    // <0>{{status}}</0> wraps the current status in a <strong> via <Trans>.
    message:
      'The target VM is currently <0>{{status}}</0>. Start it now to continue the IAP connection?',
    instance: 'Instance:',
    project: 'Project:',
    zone: 'Zone:',
    startVm: 'Start VM',
  },
  saveToHostTree: {
    title: 'Save to Host Tree',
    unsupported:
      'This session cannot be saved (only SSH and Telnet sessions are supported).',
    nameLabel: 'Name',
    folderLabel: 'Folder',
    rootFolder: '(Root)',
    newFolderPlaceholder: 'New folder name',
    create: 'Create',
    newFolder: '+ New Folder',
  },
} as const;
