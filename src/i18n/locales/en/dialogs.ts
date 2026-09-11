// Modal dialogs — confirmation, paste, SSH host key, system prompt,
// Ask AI, IAP VM start, and Save-to-Host-Tree. Grouped one key block per dialog.
export const dialogs = {
  closeAiWindow: {
    title: 'Close AI Chat',
    message_one: 'Closing this window ends {{count}} conversation.',
    message_other: 'Closing this window ends {{count}} conversations.',
    workers_one: 'The terminal the AI opened will also be disconnected.',
    workers_other: 'The {{count}} terminals the AI opened will also be disconnected.',
    hint: 'To keep them, use "Move back" instead.',
    confirmLabel: 'Close',
  },
  confirm: {
    title: 'Confirm',
    // Default confirm-button label when a caller does not pass one.
    confirmLabel: 'Delete',
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
  // Bulk placement: match every host under a folder against the NetBox
  // prefixes, show what would move, then move only what is still ticked.
  moveByPrefix: {
    title: 'Sort by IP Range',
    // {{name}} = the folder right-clicked, or the whole tree.
    scopeFolder: 'Hosts in {{name}}',
    scopeTree: 'All hosts',
    matchIn: 'Match against',
    // {{name}} = folder name, {{count}} = prefixes found beneath it.
    matchScope: '{{name}} and below ({{count}})',
    matchTree: 'The whole tree ({{count}})',
    scopeHint: 'Narrowing the match is the way out of a NetBox that reuses the same private range at every site.',
    willMove: 'Will move ({{count}})',
    alreadyPlaced: 'Already in the right folder ({{count}})',
    ambiguous: 'More than one folder claims these ({{count}})',
    ambiguousHint: 'Left alone: HoTTY does not choose between folders that claim the same range. Move these yourself, or fix the overlap in NetBox.',
    unmatched: 'No match ({{count}})',
    reasonNotAnAddress: 'not an IP address',
    reasonNoMatch: 'outside every prefix',
    // {{from}} = current folder, {{to}} = folder it would move to.
    moveRow: '{{from}} → {{to}}',
    topLevel: 'Top level',
    noPrefixes: 'No folder in the tree carries a NetBox prefix yet. Sync from NetBox with prefix placement turned on.',
    nothingToDo: 'Every host is already where its address says it belongs.',
    apply: 'Move {{count}}',
    cancel: 'Cancel',
    // Shown after applying.
    moved: 'Moved {{count}} hosts',
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
    // NetBox prefix placement. Shown above the folder list; the folder itself
    // is preselected, so changing the suggestion is one click on another row.
    netboxSuggested: 'Picked the folder that covers {{prefix}} in NetBox.',
    netboxAmbiguous: 'More than one NetBox folder covers {{prefix}}, so none was picked: {{folders}}',
  },
} as const;
