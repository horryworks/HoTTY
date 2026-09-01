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
  // Toast text for logError() call sites. logError pushes into the error
  // notification store, so every literal handed to it is user-facing UI and
  // must be a key here rather than an inline string.
  errors: {
    aiChatSendFailed: 'Could not send the AI request',
    aiChatLogDisabled: 'AI chat logging has been turned off',
    aiCredentialEncrypt: 'Could not encrypt the AI credentials',
    aiSignInStart: 'Sign-in could not be started',
    aiLogout: 'Sign-out failed',
    aiAutoAuth: 'Automatic sign-in failed',
    aiAuthListener: 'Could not listen for sign-in results',
    aiLogoutListener: 'Could not listen for sign-out events',
    aiResponseListener: 'Could not listen for AI responses',
    iapVmPromptListen: 'Could not listen for VM start prompts',
    iapVmPromptRespond: 'Could not respond to the VM start prompt',
    sshHostKeyListen: 'Could not listen for SSH host key prompts',
    browserPaneCreate: 'Could not open the web browser pane',
    browserNavigate: 'Navigation failed',
    browserClearData: 'Could not clear browsing data',
    trafficSettingsRestore: 'Could not restore the traffic pane settings',
    trafficListener: 'Could not listen for traffic events',
    pingMonitorListener: 'Could not listen for ping monitor events',
    fileServerListener: 'Could not listen for file server events',
    credentialBatch: 'Could not process {{label}} credentials',
    hostTreeEncrypt: 'Could not encrypt the host tree',
    credentialMigration: 'Credential migration failed',
    credentialPreload: 'Background credential decryption failed',
    sessionLoggingUpdate: 'Could not update session logging',
    sessionListener: 'Could not listen for session events',
    clipboardCopy: 'Could not copy the selection',
  },
  errorBoundary: {
    title: 'Something went wrong',
    reload: 'Reload',
    dismiss: 'Dismiss',
  },
} as const;
