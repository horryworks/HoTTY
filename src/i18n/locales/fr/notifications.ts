// Notifications & overlays — transient app-level UI (error toasts, connecting
// overlay, update banner, crash fallback). English is the source of truth; values
// are byte-identical to the in-component literals they replace.
export const notifications = {
  error: {
    dismiss: "Ignorer la notification d'erreur",
  },
  connecting: {
    label: 'Connexion à',
  },
  update: {
    titleAvailable: 'Nouvelle version disponible : v{{version}}',
    prereleaseSuffix: ' (préversion)',
    running: 'Vous utilisez la v{{version}}',
    viewRelease: 'Changer de version',
    dismiss: 'Ignorer',
    dismissAria: 'Ignorer la notification de mise à jour',
  },
  // Toast text for logError() call sites. logError pushes into the error
  // notification store, so every literal handed to it is user-facing UI and
  // must be a key here rather than an inline string.
  errors: {
    aiChatSendFailed: "Impossible d'envoyer la requête à l'IA",
    aiChatLogDisabled: 'La journalisation du chat IA a été désactivée',
    aiCredentialEncrypt: 'Impossible de chiffrer les identifiants IA',
    aiSignInStart: 'Impossible de démarrer la connexion',
    aiLogout: 'Échec de la déconnexion',
    aiAutoAuth: 'Échec de la connexion automatique',
    aiAuthListener: 'Impossible de recevoir les résultats de connexion',
    aiLogoutListener: 'Impossible de recevoir les événements de déconnexion',
    aiResponseListener: "Impossible de recevoir les réponses de l'IA",
    iapVmPromptListen: 'Impossible de recevoir les invites de démarrage de VM',
    iapVmPromptRespond: "Impossible de répondre à l'invite de démarrage de VM",
    sshHostKeyListen: "Impossible de recevoir les invites de clé d'hôte SSH",
    browserPaneCreate: "Impossible d'ouvrir le panneau du navigateur web",
    browserNavigate: 'Échec de la navigation',
    browserClearData: "Impossible d'effacer les données de navigation",
    trafficSettingsRestore: 'Impossible de restaurer les paramètres du panneau de trafic',
    trafficListener: 'Impossible de recevoir les événements de trafic',
    pingMonitorListener: 'Impossible de recevoir les événements du moniteur ping',
    fileServerListener: 'Impossible de recevoir les événements du serveur de fichiers',
    credentialBatch: 'Impossible de traiter les identifiants {{label}}',
    hostTreeEncrypt: "Impossible de chiffrer les identifiants — l'arborescence des hôtes n'a pas été enregistrée",
    credentialMigration: 'Échec de la migration des identifiants',
    credentialPreload: 'Échec du déchiffrement des identifiants en arrière-plan',
    sessionLoggingUpdate: 'Impossible de mettre à jour la journalisation de la session',
    sessionListener: 'Impossible de recevoir les événements de session',
    clipboardCopy: 'Impossible de copier la sélection',
  },
  errorBoundary: {
    title: "Une erreur s'est produite",
    reload: 'Recharger',
    dismiss: 'Ignorer',
  },
};
