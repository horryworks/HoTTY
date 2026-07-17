// Host tree sidebar — toolbar, context menu, the New Connection pseudo-row, the
// empty-state hint, the add/edit/export/import modal, the delete confirmation,
// and the success/failure notification messages.
export const hostTree = {
  toolbar: {
    addFolder: 'Ajouter un dossier',
    addHost: 'Ajouter un hôte',
    exportTree: "Exporter l'arborescence",
    importTree: "Importer l'arborescence",
  },
  newConnection: 'Nouvelle connexion',
  newConnectionTitle: 'Démarrer une nouvelle connexion (efface le formulaire)',
  empty: 'Cliquez avec le bouton droit ou utilisez les boutons + ci-dessus pour ajouter des hôtes et des dossiers',
  contextMenu: {
    openAll: 'Tout ouvrir',
    addFolder: 'Ajouter un dossier',
    addHost: 'Ajouter un hôte',
    rename: 'Renommer (F2)',
    export: 'Exporter',
    import: 'Importer',
    sortAscending: 'Trier par ordre croissant',
    sortDescending: 'Trier par ordre décroissant',
  },
  openAll: {
    confirmTitle: 'Ouvrir tous les hôtes',
    // {{count}} = nombre d'hôtes, {{name}} = nom du dossier.
    confirmMessage: 'Ouvrir les {{count}} hôtes de « {{name}} » ?',
  },
  modal: {
    renameFolder: 'Renommer le dossier',
    addFolder: 'Ajouter un dossier',
    editHost: "Modifier l'hôte",
    addHost: 'Ajouter un hôte',
    exportTitle: "Exporter l'arborescence des hôtes",
    importTitle: "Importer l'arborescence des hôtes",
    displayName: "Nom d'affichage",
    setEncryptionPassword: 'Définir le mot de passe de chiffrement :',
    enterDecryptionPassword: 'Saisir le mot de passe de déchiffrement :',
    exportPasswordHint: "Ce mot de passe sera requis pour importer le fichier ultérieurement.",
    importPasswordHint: "Saisissez le mot de passe utilisé pour exporter ce fichier.",
    protocol: 'Protocole',
    useAsJumpbox: 'Utiliser comme jumpbox',
    hostLabel: 'Hôte/IP',
    hostPlaceholder: '192.168.1.1',
    portLabel: 'Port',
    usernameLabel: "Nom d'utilisateur",
    passwordLabel: 'Mot de passe',
    fixedTerminalSizeLabel: 'Taille de terminal fixe',
    fixedTerminalSizeDefault: 'Utiliser le réglage global',
    fixedTerminalSizeOn: 'Activé',
    fixedTerminalSizeOff: 'Désactivé',
    export: 'Exporter',
    import: 'Importer',
  },
  delete: {
    titleFolder: 'Supprimer le dossier',
    titleHost: "Supprimer l'hôte",
    // {{name}} is the node display name. {{warning}} is appended only when the
    // host is referenced as a jumpbox (see jumpboxWarning below); empty otherwise.
    message: 'Voulez-vous vraiment supprimer « {{name}} » ?\nCette action est irréversible.{{warning}}',
    // {{count}} hosts, {{names}} = comma-joined list of host names.
    jumpboxWarning:
      "\n\nCet hôte est utilisé comme jumpbox par {{count}} hôte(s) : {{names}}. Leur paramètre de jumpbox sera effacé.",
  },
  messages: {
    importErrorTitle: "Erreur d'importation",
    // {{error}} is the underlying error text.
    importErrorBody: "Échec de l'ouverture du fichier : {{error}}",
    exportSuccessTitle: 'Exportation réussie',
    exportSuccessBody: "L'arborescence des hôtes a été exportée avec succès.",
    exportFailedTitle: "Échec de l'exportation",
    importSuccessTitle: 'Importation réussie',
    importSuccessBody: 'Hôtes importés avec succès.',
    // {{folderName}} is the generated "Imported_<file>" folder name.
    importSuccessIntoFolder: 'Hôtes importés et ajoutés au dossier « {{folderName}} ».',
    importFailedTitle: "Échec de l'importation",
  },
};
