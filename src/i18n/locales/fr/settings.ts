// Settings modal — shell, tab labels, and all tab content.
export const settings = {
  title: 'Paramètres',
  tabs: {
    general: 'Général',
    appearance: 'Apparence',
    protocols: 'Protocoles',
    features: 'Fonctionnalités',
    ai: 'IA',
    about: 'À propos',
  },
  general: {
    // Language selector (this step)
    languageSection: 'Langue',
    languageLabel: "Langue d'affichage",
    languageHelp:
      "Change la langue de l'interface de l'application. (La langue des réponses de l'IA se règle séparément dans le panneau de chat IA.)",
    // Logging
    loggingSection: 'Journalisation',
    enableLogging: 'Activer la journalisation',
    logFolderPath: 'Chemin du dossier de journaux',
    logFolderPathHelp: 'Les journaux de terminal sont enregistrés sous AAAAMMJJHHMMSS-(Protocole)-(IP).txt et les transcriptions du chat IA sous AAAAMMJJHHMMSS-AICHAT-(Chat).md',
    logFolderPathPlaceholder: 'Sélectionnez un dossier ou saisissez un chemin...',
    // Terminal
    terminalSection: 'Terminal',
    scrollbackBuffer: "Mémoire tampon de défilement",
    scrollbackHelp: 'Nombre maximal de lignes conservées en mémoire par terminal (par défaut : 10000).',
    enableLineWrap: 'Activer le retour à la ligne',
    fixedTerminalSizeMode: 'Taille de terminal fixe',
    fixedTerminalSizeModeHelp: 'Fige la largeur du terminal à la taille négociée à la connexion au lieu de la réajuster lors du redimensionnement. Nécessaire pour les appareils qui verrouillent la largeur à la connexion et ignorent les redimensionnements ultérieurs (ex. Huawei USG/VRP), où le réajustement désynchronise l’édition de ligne. « Auto » ne fige que si le serveur SSH s’identifie comme un tel appareil. Modifiable par connexion.',
    fixedTerminalSizeModeOff: 'Non — ne jamais figer',
    fixedTerminalSizeModeAuto: 'Auto — détecter l’appareil (recommandé)',
    fixedTerminalSizeModeOn: 'Oui — toujours figer',
    // Input
    inputSection: 'Saisie',
    backspaceSendsDel: 'Retour arrière envoie DEL (0x7F)',
    backspaceSendsDelHelp:
      "Si désactivé, Retour arrière envoie 0x08 (BS). Activez-le si votre serveur attend 0x7F.",
    rightClickPaste: 'Clic droit pour coller',
    rightClickPasteHelp: 'Un clic droit sur le terminal affiche la boîte de dialogue de confirmation de collage.',
    // Diagnostics
    diagnosticsSection: 'Diagnostics',
    debugLog: 'Journal de débogage',
    debugLogHelp: "Partagez le dernier fichier journal lors d'un signalement de bogue.",
    openDebugLogFolder: 'Ouvrir le dossier des journaux de débogage',
  },
  appearance: {
    // Layout
    layoutSection: 'Disposition',
    sidebarPosition: 'Position de la barre latérale',
    sidebarLeft: 'gauche',
    sidebarRight: 'droite',
    // Theme
    themeSection: 'Thème',
    themeLabel: 'Thème',
    deleteTheme: 'Supprimer',
    createCustomTheme: 'Créer un thème personnalisé',
    deleteThemeTitle: 'Supprimer le thème',
    deleteThemeMessage:
      'Supprimer le thème personnalisé « {{name}} » ? Cette action est irréversible.',
    // Unused pane background
    unusedPaneBackground: 'Arrière-plan des volets inutilisés',
    paneBackgroundColor: 'couleur',
    paneBackgroundImage: 'image',
    paneBackgroundImagePlaceholder: 'ex. http://asset.localhost/...',
    browse: 'Parcourir…',
    clearImage: "Effacer l'image",
    clear: 'Effacer',
    // Font
    fontSection: 'Police',
    fontFamily: 'Famille de police',
    systemMonospaceDefault: 'Police à chasse fixe du système (par défaut)',
    scanning: 'Analyse...',
    rescan: 'Réanalyser',
    fontSize: 'Taille de police (px)',
    webBrowserSection: 'Navigateur web',
    webBrowserDefaultZoom: 'Zoom par défaut (%)',
    webBrowserDefaultZoomHelp: 'Zoom initial de chaque nouveau panneau du navigateur web (25–500 %). Chaque panneau conserve ensuite son propre zoom pendant la session.',
    // Terminal Display
    terminalDisplaySection: 'Affichage du terminal',
    defaultEncoding: 'Encodage par défaut',
    defaultEncodingHelp: "S'applique aux nouvelles connexions.",
    promptHighlight: 'Surlignage du prompt',
    enableUserInputHighlight: 'Activer le surlignage de la saisie utilisateur',
    highlightColor: 'Couleur de surlignage',
    promptPatternsRegex: 'Motifs de prompt (Regex)',
    namePlaceholder: 'Nom',
    regexPlaceholder: 'Regex',
    addPattern: '+ Ajouter un motif',
    resetToDefault: 'Réinitialiser par défaut',
  },
  protocols: {
    // SSH
    sshSection: 'SSH',
    connectTimeout: 'Délai de connexion',
    timeoutSeconds: 'Délai (secondes)',
    sshTimeoutHelp:
      "Temps maximal d'attente de la poignée de main TCP et SSH initiale avant abandon. Par défaut : 5 secondes.",
    keepAlive: 'KeepAlive',
    enable: 'Activer',
    sshKeepAliveHelp: "Envoie des paquets factices pour éviter les délais d'expiration.",
    intervalSeconds: 'Intervalle (secondes)',
    // Algorithms
    algorithms: 'Algorithmes',
    algorithmsHelp: "Choisissez les algorithmes à activer. Les changements s'appliquent aux nouvelles sessions.",
    categoryServerHostKey: "Clé d'hôte du serveur",
    categoryKex: 'Échange de clés',
    categoryCipher: 'Chiffrement',
    categoryMac: 'MAC',
    // Telnet
    telnetSection: 'Telnet',
    telnetTimeoutHelp:
      "Temps maximal d'attente de la connexion TCP initiale avant abandon. Par défaut : 5 secondes.",
    telnetKeepAliveHelp: "Envoie des commandes Telnet NOP pour éviter les délais d'inactivité.",
    // DH-GEX SHA-1 warning
    dhGexTitle: 'Activer diffie-hellman-group-exchange-sha1 ?',
    dhGexConfirm: 'Activer',
    dhGexWarning:
      'diffie-hellman-group-exchange-sha1 repose sur SHA-1, qui est considéré comme ' +
      'compromis et a été retiré des valeurs par défaut d\'OpenSSH en 8.2. Ne l\'activez que si ' +
      'vous devez communiquer avec des appareils anciens qui n\'offrent aucun échange de clés plus robuste.\n\n' +
      'Préférez diffie-hellman-group-exchange-sha256, diffie-hellman-group14-sha256 ' +
      'ou curve25519-sha256 dès que l\'appareil distant les prend en charge.\n\n' +
      'Activer quand même diffie-hellman-group-exchange-sha1 ?',
  },
  features: {
    fileServerLabel: 'Serveur de fichiers',
    fileServerDescription: 'Serveur TFTP / SFTP pour téléverser le firmware vers les équipements réseau',
    webBrowserLabel: 'Navigateur web',
    webBrowserDescription: 'Volet de navigateur intégré pour les interfaces web d’administration des équipements réseau',
    section: 'Fonctionnalités',
    sectionHelp: 'Activez ou désactivez les volets de fonctionnalités. Les volets déjà ouverts ne sont pas affectés.',
    aiChatLabel: 'Chat IA',
    aiChatDescription: "Panneau de chat propulsé par l'IA pour l'assistance au terminal",
    logViewerLabel: 'Visionneuse de journaux',
    logViewerDescription: 'Consultez et analysez les journaux de session',
    pingMonitorLabel: 'Surveillance Ping',
    pingMonitorDescription: 'Surveillance ICMP ping continue',
  },
  ai: {
    // Provider
    providerSection: 'Fournisseur',
    aiProvider: "Fournisseur d'IA",
    aiProviderHelp:
      "Choisissez un fournisseur, puis connectez-vous ci-dessous. Gemini se connecte avec Google (OAuth), Vertex AI utilise votre projet Google Cloud (ADC ou clé de compte de service), Anthropic et OpenAI utilisent des clés API.",
    providerVertexAi: 'Google Cloud Vertex AI',
    providerGemini: 'Google AI Studio (Gemini)',
    providerAnthropic: 'Anthropic (Claude)',
    providerOpenai: 'OpenAI',
    // Authentication
    authentication: 'Authentification',
    authenticated: 'Authentifié',
    notAuthenticated: 'Non authentifié',
    logout: 'Déconnexion',
    // Formulaires d'identifiants (par fournisseur)
    auth: {
      // Gemini (Google AI Studio)
      geminiTitle: 'Se connecter à Gemini',
      clientId: 'ID client',
      clientSecret: 'Secret client',
      connecting: 'Connexion...',
      signInWithGoogle: 'Se connecter avec Google',
      // Vertex AI
      vertexTitle: 'Se connecter à Vertex AI',
      gcpProjectId: 'ID de projet GCP',
      gcpProjectIdPlaceholder: 'mon-id-de-projet',
      location: 'Emplacement',
      locationPlaceholder: 'us-central1',
      authMethod: "Méthode d'authentification",
      authMethodAdc: 'Identifiants par défaut de l\'application (ADC)',
      authMethodServiceAccount: 'Fichier de clé de compte de service',
      serviceAccountKeyFile: 'Fichier de clé de compte de service',
      serviceAccountKeyFilePlaceholder: '/chemin/vers/service-account-key.json',
      browse: 'Parcourir...',
      connectVertex: 'Se connecter à Vertex AI',
      // OpenAI
      openaiTitle: 'Se connecter à OpenAI',
      connectOpenai: 'Se connecter à OpenAI',
      openaiKeyPlaceholder: 'sk-...',
      // Anthropic
      anthropicTitle: 'Se connecter à Anthropic',
      connectAnthropic: 'Se connecter à Anthropic',
      anthropicKeyPlaceholder: 'sk-ant-...',
      // Shared
      apiKey: 'Clé API',
      failed: "Échec de l'authentification. Veuillez réessayer.",
      timedOut: "Délai d'authentification dépassé. Veuillez réessayer.",
    },
    // Personas
    personasSection: 'Personas',
    addPersona: 'Ajouter un persona',
    personaName: 'Nom du persona',
    displayNamePlaceholder: "Nom d'affichage",
    systemPrompt: 'Prompt système',
    systemPromptPlaceholder: 'Prompt système',
    deletePersona: 'Supprimer le persona',
    atLeastOnePersona: 'Au moins un persona est requis',
    deletePersonaTitle: 'Supprimer « {{label}} »',
    resetAllPersonas: 'Réinitialiser tous les personas',
    newPersonaLabel: 'Nouveau persona',
    // Command Execution
    commandExecutionSection: 'Exécution de commandes',
    commandExecutionHelp:
      "Le mode d'exécution et la limite d'exécution automatique se configurent dans le volet de chat IA (sous la zone de saisie des messages).",
    commandSafetyClassifier: 'Classificateur de sûreté des commandes',
    commandSafetyClassifierHelp:
      "Comment HoTTY décide si une commande suggérée par l'IA est exécutée automatiquement. La liste noire est toujours vérifiée en premier (une correspondance demande confirmation avant l'exécution). Statique : la liste blanche s'exécute automatiquement, tout le reste demande confirmation. IA : l'IA juge tout ce qui n'est pas en liste noire. Hybride (recommandé) : la liste blanche s'exécute automatiquement, l'IA juge le reste, sinon demande confirmation.",
    classifierStatic: 'Liste blanche statique',
    classifierAi: "Jugement de l'IA",
    classifierHybrid: 'Hybride (recommandé)',
    aiConfidenceThreshold: "Seuil de confiance de l'IA : {{percent}}%",
    aiConfidenceThresholdHelp:
      "Confiance minimale de l'IA requise pour exécuter automatiquement une commande jugée en lecture seule. En dessous, la commande attend une exécution manuelle. Plus élevé = plus prudent. Par défaut : 70%.",
    autoExecCountdown: 'Compte à rebours avant exécution (secondes)',
    autoExecCountdownHelp:
      "En mode exécution automatique sécurisée, attend ce nombre de secondes avant d'exécuter une commande jugée sûre, afin que vous puissiez l'annuler. 0 exécute immédiatement. Maximum 10. Par défaut : 3.",
    concurrentStreams: 'Réponses de chat IA en parallèle',
    concurrentStreamsHelp:
      "Combien d'onglets de conversation IA peuvent recevoir une réponse en même temps dans un volet. Les envois supplémentaires sont mis en file d'attente et démarrent à la fin des réponses. 1 = strictement une à la fois. Réduisez si votre fournisseur limite le débit (p. ex. l'offre gratuite de Gemini). Maximum 8. Par défaut : 3.",
    deviceResponseTimeout: "Délai de réponse de l'appareil (secondes)",
    deviceResponseTimeoutHelp:
      "Si l'appareil ne produit aucune nouvelle sortie pendant ce nombre de secondes après une commande, l'IA est informée que l'appareil a cessé de répondre afin que la boucle puisse continuer. 0 désactive la détection d'inactivité. Par défaut : 10.",
    sleepAsClientDelay: 'Exécuter le `sleep` initial comme un délai côté client',
    sleepAsClientDelayHelp:
      "Lorsque l'IA émet une commande commençant par `sleep N` (ex. `sleep 120 && validate`), attendre N secondes dans HoTTY au lieu d'exécuter sleep sur l'appareil. Cela empêche le délai de réponse de l'appareil ci-dessus de se déclencher à tort pendant le sleep. Toute commande chaînée s'exécute après l'attente. Par défaut : activé.",
    maxClientDelay: 'Délai maximal côté client (secondes)',
    maxClientDelayHelp:
      "Limite supérieure d'un délai sleep côté client ; les sleep plus longs sont ramenés à cette valeur et signalés. 0 = pas de limite. Par défaut : 900 (15 min).",
    whitelist: 'Liste blanche (exécution automatique)',
    whitelistHelp:
      "Les commandes correspondant ici s'exécutent automatiquement. Un mot unique correspond comme commande de base (ex. « docker » correspond à toute commande docker) ; une entrée avec des espaces correspond comme préfixe de commande (ex. « git log »). Préremplie avec des valeurs par défaut sûres ; entièrement modifiable.",
    whitelistPlaceholder: 'ex. docker, kubectl get',
    add: 'Ajouter',
    resetToDefaults: 'Réinitialiser par défaut',
    resetWhitelistTitle: 'Réinitialiser la liste blanche aux valeurs par défaut intégrées',
    removeEntry: 'Retirer {{cmd}}',
    blacklist: "Liste noire (confirmer avant l'exécution)",
    blacklistHelp:
      "Les commandes correspondant ici ne sont jamais exécutées automatiquement — une exécution manuelle reste autorisée, avec un avertissement. Un mot unique correspond comme commande de base ; une entrée avec des espaces correspond comme sous-chaîne (ex. « rm -rf », « git push »). Préremplie avec des valeurs par défaut destructrices ; entièrement modifiable.",
    blacklistPlaceholder: 'ex. rm -rf, git push',
    resetBlacklistTitle: 'Réinitialiser la liste noire aux valeurs par défaut intégrées',
    // Modals
    privacyNoticeTitle: 'Avis de confidentialité',
    privacyNoticeMessage:
      "Google AI Studio (Gemini) peut utiliser vos données pour l'entraînement de l'IA sur l'offre gratuite. Activez la facturation sur votre projet Google Cloud pour vous y soustraire.",
    privacyNoticeConfirm: 'OK',
    logoutTitle: 'Déconnexion',
    logoutMessage:
      "Voulez-vous vraiment vous déconnecter ? Vous devrez vous réauthentifier pour utiliser le fournisseur d'IA.",
    logoutConfirm: 'Déconnexion',
    // Divulgation sur le traitement des données
    dataHandlingSection: 'Traitement des données',
    dataHandlingHelp:
      "Lorsque vous utilisez les fonctionnalités d'IA, les données sont envoyées au fournisseur d'IA tiers que vous avez configuré, à l'aide de votre propre clé d'API, conformément aux conditions et à la politique de confidentialité de ce fournisseur.",
    dataHandlingBulletProviders:
      "Fournisseurs : Google Gemini / Vertex AI, Anthropic ou OpenAI — celui que vous sélectionnez ci-dessus.",
    dataHandlingBulletWhen:
      "Envoyées uniquement lorsque vous utilisez explicitement une fonctionnalité d'IA (chat, Demander à l'IA ou Surveillance). Votre terminal n'est jamais transmis en continu.",
    dataHandlingBulletRedaction:
      "Les motifs de secrets connus sont masqués dans les journaux, mais le texte que vous saisissez dans un message est envoyé tel quel — évitez de coller des identifiants.",
    dataConsentStatus: 'Consentement à la divulgation',
    dataConsentAccepted: 'Accepté',
    dataConsentNotAccepted: 'Pas encore affiché',
    resetDataConsent: 'Afficher à nouveau',
    resetDataConsentHelp:
      "Réinitialisez le consentement afin que la divulgation sur le partage de données avec l'IA soit affichée à nouveau avant le prochain envoi à l'IA.",
  },
  about: {
    version: 'v{{version}}',
    author: 'Katsumasa "Horry" Horiuchi',
    descriptionLine1: 'Émulateur de terminal SSH/Telnet/Série',
    descriptionLine2: 'Conçu avec Tauri, React et TypeScript',
    licenseLine1: 'Ce programme est un logiciel libre publié sous la',
    licenseLine2: 'GNU General Public License v3.0 ou ultérieure.',
    viewLicense: 'Voir la GNU General Public License v3.0',
    logoAlt: 'Logo HoTTY',
    // Licences tierces
    thirdPartyLicenses: 'Licences tierces',
    thirdPartyLicensesTitle: 'Licences tierces',
    thirdPartyLicensesIntro: 'HoTTY intègre des logiciels open source issus des projets suivants :',
    thirdPartyLicensesLoading: 'Chargement des licences…',
    thirdPartyLicensesError: 'Échec du chargement des informations de licence.',
    thirdPartyLicensesEmpty: "Aucune information de licence tierce n'est disponible.",
    thirdPartyLicensesClose: 'Fermer',
  },
  customTheme: {
    title: 'Créateur de thème personnalisé',
    cancel: 'Annuler',
    themeName: 'Nom du thème',
    themeNamePlaceholder: 'ex. Mon bleu foncé',
    baseTheme: 'Thème de base',
    saveTheme: 'Enregistrer le thème',
    saving: 'Enregistrement...',
    terminalSectionTitle: 'Terminal',
    terminalSectionDesc: 'Couleurs du terminal xterm.js',
    // Validation
    errorEmptyName: 'Veuillez saisir un nom de thème.',
    errorNoAlphanumeric: 'Le nom du thème doit contenir au moins un caractère alphanumérique.',
    errorProtectedName: 'Impossible d\'utiliser « dark », « medium » ou « light » comme nom de thème.',
    errorSaveFailed: "Échec de l'enregistrement du thème.",
    // Section titles & descriptions
    sectionBackgroundsTitle: 'Arrière-plans et texte',
    sectionBackgroundsDesc: "Couleurs principales d'arrière-plan et de texte",
    sectionBordersTitle: 'Bordures et accents',
    sectionBordersDesc: 'Couleurs de bordure et couleurs d\'accent/surlignage',
    sectionInputsTitle: 'Champs, boutons et survols',
    sectionInputsDesc: 'Couleurs des champs de saisie, des boutons et des états de survol',
    sectionStatusTitle: 'Statut et signaux',
    sectionStatusDesc: 'Couleurs des indicateurs de succès, erreur, avertissement et danger',
    sectionAiChatTitle: 'Chat IA',
    sectionAiChatDesc: 'Couleurs des messages de chat IA et des blocs de code',
    sectionUiTitle: "Composants d'interface spécifiques",
    sectionUiDesc: "Barre latérale, onglets, menus contextuels, icônes et autres éléments d'interface",
    sectionProvidersTitle: "Fournisseurs d'IA",
    sectionProvidersDesc:
      "Couleurs de marque utilisées pour les icônes des fournisseurs d'IA (Gemini, OpenAI, Anthropic, Vertex AI)",
    sectionSearchTitle: 'Recherche et surlignage',
    sectionSearchDesc: 'Couleurs de surlignage des résultats de recherche',
    sectionOverlaysTitle: 'Superpositions et fenêtres modales',
    sectionOverlaysDesc: 'Boîtes de dialogue modales, superpositions et bannières de notification',
    sectionEffectsTitle: 'Effets futuristes',
    sectionEffectsDesc:
      'Lueur néon et effets de glassmorphisme appliqués aux volets actifs, barres latérales et fenêtres modales',
    // Terminal color rows
    terminalForeground: 'Premier plan',
    terminalForegroundDesc: 'Couleur de texte par défaut dans le terminal',
    terminalBackground: 'Arrière-plan (actif)',
    terminalBackgroundDesc: "Arrière-plan du terminal actif/au premier plan",
    terminalBackgroundInactive: 'Arrière-plan (inactif)',
    terminalBackgroundInactiveDesc: 'Arrière-plan des terminaux inactifs/en arrière-plan',
    terminalPaneBackground: 'Arrière-plan du volet',
    terminalPaneBackgroundDesc: "Couleur de l'espace entourant le terminal",
  },
};
