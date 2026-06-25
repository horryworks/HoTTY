// Notifications & overlays — transient app-level UI (error toasts, connecting
// overlay, update banner, crash fallback). English is the source of truth; values
// are byte-identical to the in-component literals they replace.
export const notifications = {
  error: {
    dismiss: '关闭错误通知',
  },
  connecting: {
    label: '正在连接到',
  },
  update: {
    titleAvailable: '有新版本可用：v{{version}}',
    prereleaseSuffix: '（预发布）',
    running: '您当前运行的是 v{{version}}',
    viewRelease: '查看发布',
    dismiss: '关闭',
    dismissAria: '关闭更新通知',
  },
  errorBoundary: {
    title: '出现了问题',
    reload: '重新加载',
    dismiss: '关闭',
  },
};
