// App chrome — tab bar, sidebars, and the app-level sidebar (layout / edge /
// utility buttons). One key block per chrome region. English is the source of
// truth; values are byte-identical to the in-component literals they replace.
export const chrome = {
  tabBar: {
    fileServer: 'File Server',
    newSession: 'New Session',
    closeTab: 'Close tab',
    features: 'Features',
    aiMonitorActive: 'AI Monitor (Active)',
    aiMonitorStart: 'Monitor with AI',
    aiMonitorStopAria: 'Stop AI monitoring',
    aiMonitorStartAria: 'Start AI monitoring',
    logViewer: 'Log Viewer',
    pingMonitor: 'Ping Monitor',
    textEditor: 'Text Editor',
    fileExplorer: 'File Explorer',
    aiChat: 'AI Chat',
    saveToHostTree: 'Save to Host Tree…',
  },
  appSidebar: {
    layout: {
      single: 'Single (1x1)',
      splitVertical: 'Split Vertical (1x2)',
      splitHorizontal: 'Split Horizontal (2x1)',
      grid2x2: 'Grid (2x2)',
      grid2x3: 'Grid (2x3)',
      grid3x2: 'Grid (3x2)',
    },
    edge: {
      left: 'Toggle Left Sidebar',
      right: 'Toggle Right Sidebar',
      top: 'Toggle Top Bar',
      bottom: 'Toggle Bottom Bar',
    },
    disableLineWrap: 'Disable Line Wrap',
    enableLineWrap: 'Enable Line Wrap',
    help: 'Help / Documentation',
    settings: 'Settings',
  },
  pane: {
    crashed: 'Pane crashed',
    label: 'Pane {{number}}',
    dropTabHere: 'Drop Tab Here',
  },
} as const;
