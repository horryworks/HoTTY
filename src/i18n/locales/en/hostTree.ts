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
  netbox: {
    category: 'NetBox',
    syncTitle: 'Sync from NetBox',
    syncing: 'Syncing from NetBox…',
    missing: 'not in NetBox',
    missingTitle: 'This folder is no longer in NetBox. HoTTY keeps it because it may contain hosts you added.',
    managedTitle: 'Synced from NetBox. Its name and place are managed by the sync.',
    renameBlocked: 'This folder is named by NetBox and cannot be renamed here.',
    deleteWarning: 'This folder is synced from NetBox. The next sync will recreate it empty — any hosts you put inside it will not come back.',
    syncFailed: 'NetBox sync failed',
    syncDone: 'NetBox sync complete',
    // Prefix placement. Shown only when the tree carries NetBox prefixes AND
    // the typed address is an IP literal; otherwise the whole row is absent.
    placement: {
      // {{prefix}} = the CIDR that matched, e.g. 10.1.0.0/16.
      matched: 'Matches NetBox {{prefix}}',
      saveTo: 'Save to',
      // {{name}} = the folder the Add button would have used.
      here: 'Here: {{name}}',
      topLevel: 'Top level',
      // {{prefix}} = the CIDR two or more folders both claim.
      ambiguous: 'More than one NetBox folder covers {{prefix}}, so HoTTY will not choose: {{folders}}',
      unmatched: 'No NetBox folder covers this address.',
    },
  },
  // The folder details panel that replaces the connection form while a folder
  // is selected. Sections with nothing to say are not rendered at all.
  folderDetails: {
    // {{kind}} = kindRegion / kindSite below.
    badge: 'NetBox · {{kind}}',
    kindRegion: 'Region',
    kindSite: 'Site',
    // {{when}} = local date and time of the first sync that could not find it.
    missingSince: 'Not found in NetBox since {{when}}',
    ipRanges: 'IP ranges',
    // {{count}} = stored ranges HoTTY could not read. Hidden when zero.
    unreadableRanges: '{{count}} stored range(s) could not be read',
    contents: 'Contents',
    // {{folders}} / {{hosts}} = direct children only, not the whole subtree.
    counts: 'Folders {{folders}} · Hosts {{hosts}}',
    empty: 'This folder is empty.',
    // Marker on a host whose address is inside none of the folder ranges.
    outOfRange: 'out of range',
    outOfRangeTitle: 'This address is not inside any IP range on this folder. It may simply mean the range is not registered in NetBox.',
  },
  newConnection: 'New Connection',
  newConnectionTitle: 'Start a new connection (clears the form)',
  empty: 'Right-click or use the + buttons above to add hosts and folders',
  filter: {
    placeholder: 'Filter folders and hosts',
    ariaLabel: 'Filter folders and hosts',
    clear: 'Clear filter',
    // {{query}} = the text the user typed.
    noMatches: 'No folders or hosts match "{{query}}"',
  },
  contextMenu: {
    openAll: 'Open All',
    addFolder: 'Add Folder',
    addHost: 'Add Host',
    rename: 'Rename (F2)',
    export: 'Export',
    import: 'Import',
    sortAscending: 'Sort Ascending',
    sortDescending: 'Sort Descending',
    moveByPrefix: 'Sort by IP Range…',
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
    fixedTerminalSizeLabel: 'Fixed terminal size',
    fixedTerminalSizeDefault: 'Use global setting',
    fixedTerminalSizeOn: 'On',
    fixedTerminalSizeOff: 'Off',
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
