// App chrome — tab bar, sidebars, and the app-level sidebar (layout / edge /
// utility buttons). One key block per chrome region. English is the source of
// truth; values are byte-identical to the in-component literals they replace.
export const chrome = {
  tabBar: {
    fileServer: '文件服务器',
    newSession: '新建会话',
    closeTab: '关闭标签页',
    features: '功能',
    aiMonitorActive: 'AI 监控（已启用）',
    aiMonitorStart: '使用 AI 监控',
    aiMonitorStopAria: '停止 AI 监控',
    aiMonitorStartAria: '启动 AI 监控',
    logViewer: '日志查看器',
    pingMonitor: 'Ping 监控',
    aiChat: 'AI 聊天',
    saveToHostTree: '保存到主机树…',
    fixedTerminalSize: '固定宽度 ({{cols}})',
    watchAi: '使用 AI 监控',
    stopWatchAi: '停止 AI 监控',
    watchInTitle: '监控到',
    watchInNew: '新对话',
    bookmark: '添加书签…',
  },
  appSidebar: {
    layout: {
      single: '单窗格 (1x1)',
      splitVertical: '垂直拆分 (1x2)',
      splitHorizontal: '水平拆分 (2x1)',
      grid2x2: '网格 (2x2)',
      grid2x3: '网格 (2x3)',
      grid3x2: '网格 (3x2)',
    },
    edge: {
      left: '切换左侧边栏',
      right: '切换右侧边栏',
      top: '切换顶栏',
      bottom: '切换底栏',
    },
    disableLineWrap: '禁用自动换行',
    enableLineWrap: '启用自动换行',
    newWindow: '新建窗口',
    help: '帮助 / 文档',
    settings: '设置',
  },
  pane: {
    crashed: '窗格已崩溃',
    label: '窗格 {{number}}',
    dropTabHere: '将标签页拖放到此处',
  },
};
