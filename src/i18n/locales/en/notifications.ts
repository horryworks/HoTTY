// Notifications & overlays — transient app-level UI (error toasts, connecting
// overlay, update banner, crash fallback). English is the source of truth; values
// are byte-identical to the in-component literals they replace.
export const notifications = {
  error: {
    dismiss: 'Dismiss error notification',
  },
  connecting: {
    label: 'Connecting to',
  },
  update: {
    titleAvailable: 'New version available: v{{version}}',
    prereleaseSuffix: ' (pre-release)',
    running: 'You are running v{{version}}',
    viewRelease: 'View release',
    dismiss: 'Dismiss',
    dismissAria: 'Dismiss update notification',
  },
  errorBoundary: {
    title: 'Something went wrong',
    reload: 'Reload',
    dismiss: 'Dismiss',
  },
} as const;
