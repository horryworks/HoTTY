// Help & Documentation modal. This is the most prose-heavy surface in the app,
// so most values carry inline markup and are rendered via <Trans> with indexed
// component placeholders (<0>, <1>, …). Keyboard-shortcut KEYS (e.g. "Ctrl + N")
// stay literal in the component; only their descriptions live here. Code
// identifiers, command snippets, file paths, URLs, regex, and protocol/product
// names (SSH, Telnet, WSL, GCP, IAP, gcloud) are intentionally NOT translated.
export const help = {
  title: 'Aide et documentation',

  shortcuts: {
    summary: 'Raccourcis',
    newSession: 'Boîte de dialogue Nouvelle session',
    newWindow: 'Nouvelle fenêtre',
    focusNext: 'Activer le volet suivant',
    focusPrev: 'Activer le volet précédent',
    closeTab: "Fermer l'onglet actuel",
    clearOrSigint: 'Effacer la sélection / Envoyer SIGINT',
    paste: 'Coller dans le terminal (avec vérification de sécurité)',
    sendMessage: "Envoyer le message dans la boîte de dialogue Demander à l'IA",
    closeModal: 'Fermer la fenêtre modale / boîte de dialogue',
  },

  gettingStarted: {
    summary: 'Premiers pas',
    openDialog:
      'Ouvrez la boîte de dialogue de connexion via <0>Ctrl + N</0> ou le bouton <1>« Nouveau »</1> dans la barre latérale. Vous pouvez gérer vos hôtes et dossiers dans l\'arborescence des hôtes.',
    doubleClick:
      '<0>Double-clic :</0> double-cliquez sur un hôte dans l\'arborescence pour vous connecter immédiatement.',
    supportedTypes: '<0>Types de connexion pris en charge :</0>',
    typeSsh:
      '<0>SSH</0> — Shell distant chiffré (authentification par mot de passe ou par clé)',
    typeTelnet:
      '<0>Telnet</0> — Shell distant non chiffré pour les appareils anciens',
    typeSerial:
      '<0>Série</0> — Connexion directe par port COM (routeurs, appareils embarqués, etc.)',
    typeWsl: '<0>WSL</0> — Distributions Windows Subsystem for Linux',
    typeLocal: '<0>Local</0> — Shell local (CMD ou PowerShell)',
    typeGitBash:
      '<0>Git Bash</0> — Shell de connexion interactif Git Bash (détecté automatiquement)',
    jumpbox:
      '<0>Jumpbox (hôte bastion) :</0> les connexions SSH et Telnet peuvent être routées via un jumpbox. Marquez n\'importe quel hôte SSH comme jumpbox dans l\'arborescence des hôtes, puis sélectionnez-le comme hôte « via » lors de la modification d\'un hôte cible.',
    gcpIap:
      '<0>Google Cloud IAP :</0> connectez-vous aux VM Google Compute Engine via Identity-Aware Proxy sans exposer les VM à l\'Internet public. Ouvrez l\'onglet <1>GCP</1> dans la boîte de dialogue Nouvelle session pour parcourir toutes vos instances GCE de chaque projet auquel vous avez accès — regroupées par projet, avec un statut en direct (🟢 RUNNING / 🔴 arrêtée / 🟡 en transition) — puis double-cliquez sur une instance pour vous connecter. Le volet dispose aussi de boutons pour <2>démarrer</2> ou <3>arrêter</3> une instance directement, et d\'une action <4>Actualiser</4> pour réinterroger vos projets et instances. Une <5>zone de recherche</5> filtre la liste par nom de projet ou d\'instance au fur et à mesure de la saisie. La dernière liste connue est affichée <6>instantanément au lancement</6> et revalidée en arrière-plan, pour que vous n\'attendiez pas une requête complète à chaque ouverture du volet. Si vous double-cliquez sur une VM arrêtée, HoTTY demande confirmation avant de la démarrer (ou la démarre automatiquement lorsque c\'est configuré sur un hôte IAP enregistré). <7>Aucun nom d\'utilisateur SSH, mot de passe ni clé privée n\'est requis</7> — HoTTY délègue la connexion à <8>gcloud compute ssh --tunnel-through-iap</8>, qui gère le tunneling IAP, le mappage OS Login, la génération automatique de clé SSH (<9>~/.ssh/google_compute_engine</9>), l\'enregistrement de la clé et l\'authentification en votre nom. Nécessite le Google Cloud SDK et un <10>gcloud auth login</10> effectué.',
    gcpFiltering:
      '<0>Filtrage GCP sensible aux accès :</0> le volet GCP sonde <1>iap.tunnelInstances.accessViaIAP</1> au niveau du projet et de l\'instance (via <2>gcloud projects test-iam-permissions</2>) et masque les VM pour lesquelles vous n\'avez aucune autorisation de tunnel IAP. Un bouton compteur 🔒 dans l\'en-tête du volet permet de réafficher les instances masquées ; les instances sans autorisation OS Login restent affichées mais montrent un symbole d\'avertissement 🔑 car SSH peut tout de même fonctionner via une clé de métadonnées. Lorsque la sonde IAM elle-même échoue (coupure réseau, projet supprimé), les instances restent visibles afin que les VM accessibles ne soient jamais masquées par accident.',
    updateNotifications:
      '<0>Notifications de mise à jour :</0> au démarrage, HoTTY vérifie le flux des versions GitHub et affiche une notification que vous pouvez ignorer lorsqu\'une version plus récente est disponible, avec un lien direct vers la page de la version.',
    connectionStatus:
      '<0>État de la connexion :</0> une superposition « Connexion » est affichée pendant l\'établissement du transport. Les sessions SSH et Telnet expirent après un intervalle configurable (par défaut 5 secondes) — voir <1>Paramètres → Protocoles</1>. Les échecs de connexion apparaissent sous forme de notifications que vous pouvez ignorer, avec des libellés courts et clairs — <2>Connexion refusée</2>, <3>Hôte introuvable</3>, <4>Délai de connexion dépassé (15 s)</4>, <5>Aucun algorithme kex commun avec le serveur</5>, <6>Phrase secrète incorrecte pour la clé privée</6>, etc. — au lieu du texte d\'erreur brut de la bibliothèque. Les échecs sur un saut jumpbox sont clairement étiquetés <7>Jumpbox : …</7> pour que vous sachiez quel saut a échoué.',
    sshAlgorithms:
      '<0>Algorithmes SSH :</0> activez ou désactivez les algorithmes d\'échange de clés, de chiffrement, de MAC et de clé d\'hôte proposés lors de la poignée de main SSH sous <1>Paramètres → Protocoles → Algorithmes SSH</1>. Les valeurs par défaut modernes telles que <2>curve25519-sha256</2> et <3>diffie-hellman-group14-sha256</3> sont activées d\'emblée. Les anciennes options SHA-1 (<4>diffie-hellman-group14-sha1</4>, <5>3des-cbc</5>, <6>ssh-dss</6>, etc.) restent disponibles pour les appareils plus anciens (ex. Cisco Catalyst 3650 / anciens IOS) qui ne négocient pas les algorithmes modernes. L\'activation de <7>diffie-hellman-group-exchange-sha1</7> affiche une demande de confirmation car SHA-1 est considéré comme compromis — utilisez un KEX plus robuste dès que possible.',
    algorithmsMerge:
      'Lors d\'une mise à niveau, tout algorithme nouvellement ajouté dans une version est fusionné dans votre configuration enregistrée, de sorte que vous n\'avez pas besoin d\'adhérer manuellement aux améliorations de sécurité.',
  },

  hostTree: {
    summary: "Organiser l'arborescence des hôtes",
    dragDrop:
      '<0>Glisser-déposer :</0> vous pouvez réordonner les hôtes et les dossiers en les faisant glisser dans la boîte de dialogue « Nouvelle session ».',
    exportImportPrefix: '<0>Exporter et importer :</0> utilisez les icônes',
    exportLabel: '<0>Exporter</0>',
    importLabel: '<0>Importer</0>',
    exportImportSuffix:
      'en haut à droite du panneau des hôtes pour sauvegarder ou charger vos configurations.',
    management:
      '<0>Gestion :</0> utilisez les icônes d\'action à côté des éléments pour ajouter des dossiers, ajouter de nouveaux hôtes, modifier les paramètres ou supprimer des entrées.',
    showPassword:
      '<0>Afficher le mot de passe :</0> utilisez le bouton de visibilité du mot de passe pour révéler les mots de passe enregistrés dans l\'arborescence des hôtes au besoin.',
    newConnection:
      '<0>🆕 Entrée Nouvelle connexion :</0> la première ligne de l\'arborescence des hôtes démarre une nouvelle connexion — elle efface le formulaire de protocole à droite de la boîte de dialogue afin que vous puissiez vous connecter à un hôte ponctuel sans d\'abord désélectionner un hôte enregistré.',
    saveAdHoc:
      '<0>Enregistrer une session ponctuelle dans l\'arborescence des hôtes :</0> après vous être connecté via <1>Nouvelle connexion</1>, faites un clic droit sur l\'onglet de la session et choisissez <2>Enregistrer dans l\'arborescence des hôtes…</2> pour conserver la connexion pour plus tard. Les sessions SSH et Telnet sont prises en charge (le chemin de la clé privée et la phrase secrète sont conservés). Dans la boîte de dialogue d\'enregistrement, les dossiers de l\'arborescence des hôtes sont affichés sous forme d\'arborescence afin que vous puissiez choisir directement le dossier de destination, et <3>+ Nouveau dossier</3> crée un dossier sous celui actuellement sélectionné — imbriquable aussi profondément que vous le souhaitez.',
  },

  layout: {
    summary: 'Maîtriser la disposition',
    flexibleTabs:
      '<0>Onglets flexibles :</0> glissez-déposez les onglets non seulement pour les réordonner, mais aussi pour les déplacer entre les volets de grille, les barres latérales ou les barres supérieure/inférieure.',
    resizing:
      '<0>Redimensionnement :</0> redimensionnez tout en faisant glisser les séparateurs ou le <1>point d\'intersection 2D</1> (là où 4 volets se rejoignent).',
    emptyPaneHints:
      '<0>Indices des volets vides :</0> les cellules de grille vides affichent leur numéro de volet et une invite « Déposer l\'onglet ici » pour que vous sachiez où déposer un onglet.',
    lineWrap:
      '<0>Bascule du retour à la ligne :</0> désactivez <1>Paramètres → Apparence → Retour à la ligne</1> pour activer une barre de défilement horizontale sur les volets de terminal. La vue défile automatiquement pour garder le curseur visible lorsque vous tapez au-delà du bord droit, et revient à la colonne 0 sur Entrée. La barre de défilement verticale et le marqueur de prompt restent ancrés au bord droit du volet quelle que soit la position de défilement horizontal.',
    multiWindow:
      '<0>Fenêtres multiples :</0> ouvrez une autre fenêtre avec le bouton <1>Nouvelle fenêtre</1> de la barre latérale ou avec <2>Ctrl + Shift + N</2> — relancer HoTTY ouvre également une nouvelle fenêtre dans le même processus. Chaque fenêtre conserve ses propres volets et sessions de terminal, tandis que vos paramètres, votre thème, votre arborescence d\'hôtes et vos favoris restent partagés et synchronisés entre toutes les fenêtres. Un chat IA peut même être lié à un terminal exécuté dans une autre fenêtre.',
  },

  copyPaste: {
    summary: 'Copier et coller',
    copy:
      '<0>Copier :</0> sélectionnez simplement du texte dans le terminal ou cliquez sur un <1>Marqueur de terminal</1> pour sélectionner un bloc entier. Le contenu est automatiquement copié dans votre presse-papiers lors de la sélection.',
    paste:
      '<0>Coller :</0> faites un clic droit n\'importe où dans le terminal ou utilisez <1>Ctrl + V</1>.',
    safety:
      '<0>Vérification de sécurité :</0> une boîte de dialogue <1>Confirmation de collage</1> apparaîtra si vous essayez de coller plusieurs lignes. Cela empêche l\'exécution accidentelle de commandes dangereuses.',
  },

  markers: {
    summary: 'Marqueurs de terminal',
    redTitle: 'Ligne rouge/orange : Prompt',
    redDesc: 'Indique où vous avez saisi une commande.',
    blueTitle: 'Ligne bleue : Sortie',
    blueDesc: 'Indique le résultat/la sortie d\'une commande.',
    tip:
      '<0>Astuce :</0> cliquez sur un marqueur pour sélectionner le bloc entier. Faites un clic droit dessus pour interroger rapidement l\'IA à propos de cette sortie spécifique.',
  },

  logging: {
    summary: 'Journalisation de session et Visionneuse de journaux',
    sessionLogging:
      '<0>Journalisation de session :</0> activez la journalisation automatique dans <1>Paramètres → Général</1>. Toute la sortie du terminal est enregistrée sous forme de fichiers <2>.log</2> horodatés dans le dossier que vous spécifiez.',
    folderApproval:
      '<0>Approbation du dossier :</0> la première fois que HoTTY utilise un dossier de journalisation — que vous démarriez une session, activiez la journalisation ou ouvriez la Visionneuse de journaux — une boîte de dialogue de confirmation native vous demande d\'approuver ce dossier. Choisir un dossier via le bouton <1>Parcourir...</1> l\'approuve automatiquement. Les approbations persistent d\'un lancement à l\'autre de l\'application (enregistrées sous <2>%APPDATA%\\com.hotty.terminal\\approved_log_dirs.json</2>), de sorte que vous ne voyez la boîte de dialogue qu\'une fois par dossier. Ce mécanisme existe pour qu\'un chemin saisi ou importé ne puisse pas accorder silencieusement l\'accès aux journaux.',
    logViewer:
      '<0>Visionneuse de journaux :</0> cliquez sur le bouton <1>Visionneuse de journaux</1> dans la barre d\'onglets pour ouvrir un volet dédié à la navigation des journaux. Il répertorie tous les fichiers journaux enregistrés et vous permet de les ouvrir et de les rechercher sans quitter HoTTY.',
    search:
      '<0>Recherche :</0> utilisez la barre de recherche dans la Visionneuse de journaux pour filtrer les lignes. Basculez le bouton <1>.*</1> pour passer entre la recherche en texte brut et par expression régulière.',
  },

  textEditor: {
    summary: 'Éditeur de texte',
    intro:
      'Ouvrez un volet d\'éditeur de texte intégré via <0><1></1></0> (Fonctionnalités) → <2>« Éditeur de texte »</2>. Vous pouvez ouvrir plusieurs volets d\'éditeur et modifier plusieurs fichiers simultanément à l\'aide de sous-onglets.',
    fileMenu:
      '<0>Menu Fichier :</0> actions Nouveau, Ouvrir, Enregistrer, Enregistrer sous et Fermer pour chaque sous-onglet.',
    viewMenu:
      '<0>Menu Affichage :</0> basculez <1>Afficher les codes de retour</1> pour afficher les caractères de saut de ligne sous forme de symboles visibles dans l\'éditeur.',
    findReplace:
      '<0>Rechercher et remplacer :</0> appuyez sur <1>Ctrl + F</1> pour ouvrir la barre de recherche. Utilisez <2>Ctrl + H</2> pour rechercher et remplacer. Les correspondances sont surlignées et le nombre total est affiché.',
    gotoLine:
      '<0>Aller à la ligne :</0> appuyez sur <1>Ctrl + G</1> pour sauter à un numéro de ligne spécifique.',
    encoding:
      '<0>Encodage et fins de ligne :</0> cliquez sur l\'indicateur d\'encodage ou de fin de ligne dans la barre d\'état pour les modifier pour le fichier actuel.',
    lineWrap:
      '<0>Retour à la ligne :</0> contrôlé par la bascule globale <1>Paramètres → Apparence → Retour à la ligne</1>. Les numéros de ligne visuels se mettent à jour automatiquement pour refléter les lignes renvoyées à la ligne.',
    fileAssociation:
      '<0>Association de fichiers :</0> les fichiers ouverts depuis l\'Explorateur Windows (double-clic ou « Ouvrir avec ») se lancent directement dans l\'Éditeur de texte.',
    tip:
      '<0>Astuce :</0> un fichier non enregistré affiche un point <1>•</1> sur le titre de son sous-onglet. Enregistrez avec <2>Ctrl + S</2>.',
    unsavedPrompt:
      '<0>Invite de modifications non enregistrées :</0> fermer un sous-onglet ou quitter avec des éditeurs modifiés ouvre une boîte de dialogue <1>Enregistrer / Abandonner / Annuler</1> afin que vous ne perdiez jamais votre travail par accident.',
  },

  fileServer: {
    summary:
      'Serveur de fichiers (TFTP / SFTP)',
    intro:
      'Ouvrez le panneau Serveur de fichiers via <0><1></1></0> (Features) → <2>« File Server »</2>. Choisissez un dossier à partager et démarrez un serveur TFTP ou SFTP pour que les équipements réseau (p. ex. Cisco) téléchargent ou envoient le firmware via le LAN.',
    serve:
      '<0>Dossier partagé :</0> Choisissez le dossier avec Parcourir. Seuls les fichiers qu\'il contient sont accessibles ; la traversée de chemin et les liens symboliques sont bloqués.',
    tftp:
      '<0>TFTP :</0> UDP (port 69 par défaut). La méthode classique pour charger le firmware Cisco IOS avec <1>copy tftp: flash:</1>. Lecture seule par défaut ; activez <2>Allow uploads</2> pour les transferts équipement→PC.',
    sftp:
      '<0>SFTP :</0> Basé sur SSH (port 2222 par défaut) avec authentification par identifiant/mot de passe. La clé d\'hôte est générée automatiquement et stockée chiffrée.',
    firewall:
      '<0>Pare-feu Windows :</0> Si le trafic entrant est bloqué, le panneau l\'indique et propose <1>Allow through firewall</1> (un clic, administrateur requis).',
    security:
      '<0>Sécurité :</0> Démarrer un serveur expose le dossier choisi à votre réseau local. Ne partagez que des fichiers de confiance et laissez les envois désactivés sauf si nécessaire.',
  },

  webBrowser: {
    summary: 'Navigateur web et favoris',
    intro:
      'Ouvrez des pages web dans HoTTY grâce à un navigateur intégré — pratique pour les interfaces web d’administration des équipements réseau (routeurs, commutateurs, iLO/iDRAC) à côté de vos terminaux. Ouvrez-le depuis l’onglet <1>🌐 Web</1> de la boîte de dialogue <0>Nouvelle session</0> : cliquez sur <2>🆕 Nouveau navigateur web</2> pour un onglet vierge, ou double-cliquez sur un favori enregistré pour ouvrir ce site.',
    bookmarks:
      '<0>Favoris :</0> Organisez les sites dans une arborescence de dossiers sous l’onglet <1>Web</1> : ajoutez, renommez, supprimez et glissez pour réorganiser. Double-cliquez sur un favori pour l’ouvrir dans un nouveau volet de navigateur. Pendant la navigation, le bouton des favoris de la barre d’outils affiche vos favoris enregistrés pour un accès rapide.',
    star:
      '<0>★ Ajouter cette page aux favoris :</0> Pendant la navigation, cliquez sur le bouton <1>★</1> de la barre d’outils pour enregistrer la page actuelle dans le dossier de votre choix.',
    toolbar:
      '<0>Barre d’outils :</0> Précédent, Suivant, Recharger/Arrêter et une barre d’adresse. Seules les adresses <1>http://</1> et <2>https://</2> sont autorisées ; une adresse saisie sans schéma utilise <3>http://</3> par défaut. Le texte qui n’est pas une adresse web fait l’objet d’une recherche sur le web.',
    passwords:
      '<0>Connexions et mots de passe :</0> Le navigateur conserve vos sessions de connexion et peut enregistrer et remplir automatiquement les mots de passe, stockés dans le profil de navigateur chiffré propre à HoTTY (distinct de votre Edge/Chrome système).',
    clearData:
      '<0>Effacer les données de navigation :</0> Cliquez sur le bouton corbeille de la barre d’outils pour effacer les cookies et données de sites, le cache, l’historique, les mots de passe enregistrés et la saisie automatique — vous choisissez quoi supprimer. Vos favoris et les paramètres de HoTTY sont toujours conservés.',
    enable:
      '<0>Activer / désactiver :</0> L’onglet Web peut être désactivé dans <1>Paramètres → Fonctionnalités</1>.',
  },

  fileExplorer: {
    summary: 'Explorateur de fichiers',
    intro:
      'Ouvrez un volet d\'explorateur de fichiers intégré via <0><1></1></0> (Fonctionnalités) → <2>« Explorateur de fichiers »</2>. Parcourez vos lecteurs et répertoires dans une structure arborescente repliable.',
    navigate:
      '<0>Naviguer :</0> cliquez sur les dossiers pour les développer/réduire. Utilisez le fil d\'Ariane en haut pour une navigation rapide.',
    openFiles: '<0>Ouvrir des fichiers :</0> double-cliquez sur un fichier pour l\'ouvrir dans l\'Éditeur de texte.',
    hiddenFiles:
      '<0>Fichiers cachés :</0> basculez la visibilité des fichiers cachés avec l\'icône en forme d\'œil dans la barre d\'outils.',
    refresh: '<0>Actualiser :</0> cliquez sur le bouton d\'actualisation pour recharger le répertoire actuel.',
  },

  aiQuickStart: {
    summary: 'Guide de démarrage rapide de l\'IA',
    intro:
      'HoTTY intègre une IA capable d\'analyser la sortie du terminal, d\'expliquer les erreurs, de suggérer des correctifs et même d\'exécuter des commandes pour vous. Voici comment démarrer en 3 étapes :',
    step1:
      '<0>Choisissez un fournisseur :</0> allez dans <1>Paramètres → IA → Fournisseur d\'IA</1> et sélectionnez-en un. <2>Google AI Studio (Gemini)</2> ou <3>Vertex AI</3> sont recommandés — voir le tableau comparatif ci-dessous.',
    step2:
      '<0>Authentifiez-vous :</0> ouvrez un onglet de chat IA (<1><2></2></1> → Chat IA) et suivez les invites à l\'écran pour vous connecter ou saisir vos identifiants.',
    step3:
      '<0>Commencez à discuter :</0> saisissez une question, ou sélectionnez du texte dans le terminal, faites un clic droit et saisissez votre question dans le champ <1>« Demander à l\'IA »</1>.',
    outro:
      'C\'est tout ! Vous pouvez commencer à poser des questions tout de suite — aucune configuration complexe nécessaire.',
  },

  aiFeatures: {
    summary: 'Aperçu des fonctionnalités d\'IA',
    aiChatHeading: 'Chat IA',
    aiChatIntro:
      'Cliquez sur <0><1></1></0> (Fonctionnalités) dans la barre d\'onglets → <2>« Chat IA »</2> pour ouvrir le volet de chat IA. À l\'intérieur, la bande d\'onglets en haut vous permet de conserver plusieurs conversations en parallèle — utilisez <3>+ Nouveau chat</3> pour démarrer un nouvel onglet. Saisissez votre question et appuyez sur <4>Ctrl + Entrée</4> pour l\'envoyer.',
    linkedTerminal:
      '<0>Terminal lié :</0> lorsque vous démarrez la Surveillance IA sur un terminal, le volet de chat IA lie automatiquement un onglet à ce terminal — activer la Surveillance IA sur d\'autres terminaux crée un nouvel onglet par terminal afin que les flux de sortie restent séparés. Le terminal actuellement lié est affiché sous forme de pastille à côté de la zone de saisie. Cliquer sur un onglet met aussi brièvement en surbrillance son volet de terminal lié afin que vous voyiez d\'un coup d\'œil à quelle session il appartient.',
    streamWatchdog:
      '<0>Chien de garde du flux :</0> si un fournisseur d\'IA cesse d\'envoyer des données au milieu d\'une réponse (coupure réseau, backend bloqué), la requête en cours est automatiquement annulée après 3 minutes de silence et un message d\'erreur apparaît dans le chat — finis les états « diffusion » bloqués.',
    askAiHeading: 'Demander à l\'IA (clic droit)',
    askAiBody:
      'Sélectionnez du texte dans le terminal (ou cliquez sur un <0>Marqueur de terminal</0> pour sélectionner tout un bloc de sortie), puis faites un clic droit et saisissez votre question dans le champ <1>« Demander à l\'IA »</1> — appuyez sur Entrée pour envoyer. HoTTY ouvre le chat IA avec votre question et le texte sélectionné.',
    interactiveHeading: 'Mode interactif (exécution de commandes)',
    interactiveBody:
      'Lorsque l\'IA suggère une commande, elle peut l\'envoyer directement à votre session de terminal pour exécution. Vous verrez la commande avant son exécution, vous gardez donc le contrôle.',
    executionHeading: 'Mode d\'exécution et exécution automatique',
    executionBody:
      'La <0>pastille Mode d\'exécution</0> en bas du volet de chat IA contrôle la façon dont les commandes suggérées par l\'IA s\'exécutent — choisissez entre Demander, Exécuter automatiquement les commandes sûres ou Pause. Lorsque l\'exécution automatique est activée, chaque commande est jugée et s\'exécute automatiquement ou attend une confirmation manuelle ; Pause interrompt la boucle d\'exécution automatique sans changer le mode, et les commandes de la pastille permettent de reprendre. Configurez la limite d\'exécutions consécutives et le <1>délai d\'inactivité de réponse de l\'appareil</1> (par défaut 10 secondes ; 0 désactive) dans <2>Paramètres → IA → Exécution de commandes</2>. Lorsqu\'une commande commence par <3>sleep N</3> (ex. <4>sleep 120 &amp;&amp; validate</4>), HoTTY attend ces secondes localement au lieu d\'envoyer le sleep à l\'appareil — afin que le délai d\'inactivité ne se déclenche pas à tort pendant l\'attente — puis exécute ensuite toute commande chaînée ; basculez cela et son délai maximal dans <5>Paramètres → IA</5>.',
    safetyHeading: 'Classificateur de sûreté des commandes (liste blanche / liste noire / IA)',
    safetyBody:
      'La façon dont chaque commande est jugée pour l\'exécution automatique est décidée par trois couches, configurables dans <0>Paramètres → IA → Exécution de commandes</0>. La <1>liste noire</1> est vérifiée en premier — une correspondance ne s\'exécute jamais automatiquement (une exécution manuelle reste proposée). La <2>liste blanche</2> exécute automatiquement les commandes manifestement en lecture seule. Tout ce qui se situe entre les deux est envoyé à l\'<3>IA</3>, qui juge si cela modifie la configuration ; seules les commandes jugées en lecture seule avec une confiance suffisante s\'exécutent automatiquement, tout le reste demande confirmation. Les deux listes sont entièrement modifiables : un mot unique correspond à une commande de base (ex. <4>docker</4>), et une entrée avec des espaces correspond comme sous-chaîne (ex. <5>rm -rf</5>, <6>git push</6>) ; chaque liste possède un bouton <7>Réinitialiser par défaut</7>. Choisissez la stratégie (Statique / IA / <8>Hybride</8>, par défaut) et le seuil de confiance de l\'IA au même endroit. Chaque bloc d\'exécution montre comment il a été jugé — En liste blanche, Verdict de l\'IA, En liste noire ou Confirmation requise — afin que la décision ne soit jamais cachée.',
    personasHeading: 'Personas',
    personasBody:
      'Basculez entre les rôles d\'IA (Assistant général, Expert réseau, Analyste sécurité, etc.) à l\'aide du sélecteur de persona en haut du chat. Chaque persona possède un prompt système adapté à ce domaine. Cliquez sur l\'indicateur <0>prompt système</0> pour inspecter l\'instruction exacte envoyée au modèle et la copier dans le presse-papiers.',
    personasNetworkExpert:
      'Le persona <0>Expert réseau</0> prépare automatiquement un terminal lié : lorsque son chat est lié à une session active, il identifie automatiquement l\'appareil et désactive la pagination avant même que vous ne demandiez quoi que ce soit. Basculer le terminal lié vers un autre appareil démarre d\'abord un nouveau chat, tandis que se reconnecter au même appareil ne fait que redésactiver la pagination et conserve votre conversation.',
  },

  watchMode: {
    summary: 'Mode Surveillance (surveillance par IA)',
    intro:
      'Le mode Surveillance permet à l\'IA de surveiller la sortie d\'une session de terminal et de l\'analyser à la demande — idéal pour les commandes de longue durée ou le suivi de journaux.',
    step1:
      'Cliquez sur l\'icône <0><1></1></0> de n\'importe quel onglet de terminal pour commencer à surveiller. L\'icône devient bleue et l\'onglet reçoit un surlignage arc-en-ciel.',
    step2: 'Exécutez les commandes comme d\'habitude. Toute la sortie est capturée dans une mémoire tampon.',
    step3:
      'Dans l\'<0>onglet de chat IA</0> lié, saisissez simplement votre question — ou faites un clic droit sur le texte du terminal et choisissez <1>Demander à l\'IA</1>. La sortie capturée est automatiquement incluse pour l\'analyse.',
    tip:
      '<0>Astuce :</0> laissez-le collecter la sortie et demandez à l\'IA de résumer ou de trouver les erreurs lorsque vous êtes prêt. La taille limite de la mémoire tampon peut être ajustée dans <1>Paramètres → IA → Limite de la mémoire tampon de la Surveillance IA</1>.',
  },

  chooseProvider: {
    summary: 'Choisir un fournisseur d\'IA',
    intro:
      'HoTTY prend en charge quatre fournisseurs d\'IA. Choisissez celui qui correspond le mieux à vos besoins :',
    thProvider: 'Fournisseur',
    thBestFor: 'Idéal pour',
    thAuth: 'Authentification',
    thStatus: 'Statut',
    geminiName: 'Google AI Studio<0></0>(Gemini)',
    geminiBestFor: 'Usage personnel, offre gratuite disponible',
    geminiAuth: 'OAuth2',
    geminiStatus: 'Entièrement testé',
    vertexName: 'Google Cloud<0></0>Vertex AI',
    vertexBestFor: 'Usage entreprise / production',
    vertexAuth: 'ADC / Compte de service',
    vertexStatus: 'Entièrement testé',
    anthropicName: 'Anthropic<0></0>(Claude)',
    anthropicBestFor: 'Modèles Claude via clé API',
    anthropicAuth: 'Clé API',
    experimental: 'Expérimental',
    experimentalNote: '(non testé — peut ne pas fonctionner comme prévu)',
    openaiName: 'OpenAI',
    openaiBestFor: 'Modèles GPT via clé API',
    openaiAuth: 'Clé API',
    recommendation:
      '<0>Recommandation :</0> en cas de doute, commencez par <1>Google AI Studio (Gemini)</1> — il dispose d\'une offre gratuite et est le fournisseur le plus minutieusement testé.',
  },

  aiSetup: {
    summary: 'Configuration et authentification de l\'IA',
    geminiHeading: 'Google AI Studio (Gemini) — Configuration OAuth2',
    geminiStep1: 'Allez dans Google Cloud Console → API et services → Identifiants.',
    geminiStep2: 'Créez un <0>ID client OAuth 2.0</0> (type Application de bureau).',
    geminiStep3:
      'Dans HoTTY, sélectionnez <0>Google AI Studio</0> comme fournisseur, ouvrez un onglet de chat IA et saisissez votre ID client et votre secret client.',
    geminiStep4:
      'Cliquez sur <0>« Se connecter avec Google »</0> — une fenêtre de navigateur s\'ouvrira pour l\'autorisation.',
    geminiNote:
      'Les comptes de l\'offre gratuite peuvent voir leurs données utilisées pour l\'entraînement des modèles. Activez la facturation sur votre projet Google Cloud pour vous y soustraire.',
    vertexHeading: 'Google Cloud Vertex AI — ADC ou compte de service',
    vertexStep1:
      '<0>ADC (le plus simple) :</0> installez le Google Cloud CLI, puis exécutez :<1></1><2>gcloud auth application-default login</2><3></3>HoTTY détecte ces identifiants automatiquement.',
    vertexStep2:
      '<0>Compte de service :</0> téléchargez un fichier de clé JSON depuis Google Cloud Console → IAM → Comptes de service, puis indiquez le chemin du fichier dans les Paramètres.',
    vertexStep3:
      'Saisissez votre <0>ID de projet Google Cloud</0> et sélectionnez une <1>Région</1> dans l\'onglet de chat IA.',
    anthropicHeading: 'Anthropic (Claude) — Clé API',
    anthropicExperimental: '( Expérimental)',
    anthropicStep1: 'Obtenez une clé API depuis Anthropic Console → API Keys.',
    anthropicStep2:
      'Dans HoTTY, sélectionnez <0>Anthropic</0> comme fournisseur, ouvrez un onglet de chat IA et saisissez votre clé API.',
    anthropicNote:
      'Ce fournisseur est expérimental et n\'a pas été entièrement testé. Certaines fonctionnalités (mode Surveillance, mode interactif, etc.) peuvent ne pas fonctionner comme prévu. Veuillez signaler tout problème rencontré.',
    openaiHeading: 'OpenAI — Clé API',
    openaiExperimental: '( Expérimental)',
    openaiStep1: 'Obtenez une clé API depuis OpenAI Platform → API Keys.',
    openaiStep2:
      'Dans HoTTY, sélectionnez <0>OpenAI</0> comme fournisseur, ouvrez un onglet de chat IA et saisissez votre clé API.',
    openaiNote:
      'Ce fournisseur est expérimental et n\'a pas été entièrement testé. Certaines fonctionnalités (mode Surveillance, mode interactif, etc.) peuvent ne pas fonctionner comme prévu. Veuillez signaler tout problème rencontré.',
    credentialsNote:
      'Tous les identifiants sont chiffrés avec Windows DPAPI et stockés localement — ils ne sont jamais transmis hors de votre machine, sauf au fournisseur d\'IA concerné.',
  },

  customizing: {
    summary: 'Personnaliser les commandes d\'IA et les personas',
    customPersonas:
      '<0>Personas personnalisés :</0> dans <1>Paramètres → IA → Personas</1>, créez des personas avec des prompts système personnalisés. Le persona choisi est appliqué comme instruction système initiale pour chaque nouvelle session de chat IA.',
    proactiveInvestigation:
      '<0>Investigation proactive :</0> l\'IA suggère automatiquement des commandes de terminal lorsqu\'elle a besoin de plus d\'informations pour répondre à votre demande, et peut capturer les résultats pour une analyse continue en mode Surveillance.',
  },

  themes: {
    summary: 'Thèmes et apparence',
    builtIn:
      'Basculez entre les thèmes intégrés (<0>Dark</0>, <1>Medium</1>, <2>Light</2>) dans <3>Paramètres → Apparence → Thème</3>.',
    customThemes:
      '<0>Thèmes personnalisés :</0> cliquez sur <1>« + Créer un thème personnalisé »</1> pour ouvrir l\'éditeur de thème. Ajustez n\'importe quelle variable de couleur et enregistrez sous un nom personnalisé. Les thèmes personnalisés peuvent être modifiés ou supprimés à tout moment.',
    providerColors:
      '<0>Couleurs des fournisseurs d\'IA :</0> l\'éditeur de thème comprend une section <1>Fournisseurs d\'IA</1> pour personnaliser les couleurs de marque utilisées par les icônes Gemini, OpenAI, Anthropic et Vertex AI.',
    futuristic:
      '<0>Effets futuristes :</0> la section <1>Effets futuristes</1> de l\'éditeur de thème ajoute une lueur néon optionnelle sur les volets actifs et les icônes de la barre latérale, un flou d\'arrière-plan glassmorphisme sur les fenêtres modales, et une épaisseur de trait d\'icône configurable.',
    unusedPane:
      '<0>Arrière-plan des volets inutilisés :</0> dans <1>Paramètres → Apparence</1>, choisissez une couleur unie ou une image personnalisée à afficher dans les volets de grille vides.',
    language:
      '<0>Langue de l\'interface :</0> changez la langue de l\'interface dans <1>Paramètres → Général → Langue d\'affichage</1>. HoTTY est disponible en English, 日本語, 简体中文, 繁體中文, 한국어, Русский, Español et Français — le changement s\'applique instantanément. (La langue de réponse de l\'IA se configure séparément dans le panneau de chat IA.)',
  },
};
