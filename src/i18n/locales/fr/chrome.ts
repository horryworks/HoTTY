// App chrome — tab bar, sidebars, and the app-level sidebar (layout / edge /
// utility buttons). One key block per chrome region. English is the source of
// truth; values are byte-identical to the in-component literals they replace.
export const chrome = {
  tabBar: {
    fileServer: 'Serveur de fichiers',
    newSession: 'Nouvelle session',
    closeTab: "Fermer l'onglet",
    features: 'Fonctionnalités',
    aiMonitorActive: 'Surveillance IA (active)',
    aiMonitorStart: "Surveiller avec l'IA",
    aiMonitorStopAria: 'Arrêter la surveillance IA',
    aiMonitorStartAria: 'Démarrer la surveillance IA',
    logViewer: 'Visionneuse de journaux',
    pingMonitor: 'Surveillance Ping',
    textEditor: 'Éditeur de texte',
    fileExplorer: 'Explorateur de fichiers',
    aiChat: 'Chat IA',
    saveToHostTree: "Enregistrer dans l'arborescence des hôtes…",
    fixedTerminalSize: 'Largeur fixe ({{cols}})',
    watchAi: "Surveiller avec l'IA",
    stopWatchAi: 'Arrêter la surveillance IA',
    watchInTitle: 'Surveiller dans',
    watchInNew: 'Nouvelle conversation',
    bookmark: 'Ajouter un favori…',
  },
  appSidebar: {
    layout: {
      single: 'Unique (1x1)',
      splitVertical: 'Division verticale (1x2)',
      splitHorizontal: 'Division horizontale (2x1)',
      grid2x2: 'Grille (2x2)',
      grid2x3: 'Grille (2x3)',
      grid3x2: 'Grille (3x2)',
    },
    edge: {
      left: 'Basculer la barre latérale gauche',
      right: 'Basculer la barre latérale droite',
      top: 'Basculer la barre supérieure',
      bottom: 'Basculer la barre inférieure',
    },
    disableLineWrap: 'Désactiver le retour à la ligne',
    enableLineWrap: 'Activer le retour à la ligne',
    newWindow: 'Nouvelle fenêtre',
    help: 'Aide / Documentation',
    settings: 'Paramètres',
  },
  pane: {
    crashed: 'Le volet a planté',
    label: 'Volet {{number}}',
    dropTabHere: "Déposer l'onglet ici",
  },
};
