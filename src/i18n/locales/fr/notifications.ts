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
    viewRelease: 'Voir la version',
    dismiss: 'Ignorer',
    dismissAria: 'Ignorer la notification de mise à jour',
  },
  errorBoundary: {
    title: "Une erreur s'est produite",
    reload: 'Recharger',
    dismiss: 'Ignorer',
  },
};
