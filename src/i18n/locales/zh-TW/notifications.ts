// 通知與覆蓋層 — 暫時性的應用程式層級 UI（錯誤快顯、連線中覆蓋層、
// 更新橫幅、當機後備畫面）。英文為來源真相。
export const notifications = {
  error: {
    dismiss: '關閉錯誤通知',
  },
  connecting: {
    label: '正在連線至',
  },
  update: {
    titleAvailable: '有新版本可用：v{{version}}',
    prereleaseSuffix: '（預先發行版）',
    running: '您目前使用的版本為 v{{version}}',
    viewRelease: '檢視發行版本',
    dismiss: '關閉',
    dismissAria: '關閉更新通知',
  },
  errorBoundary: {
    title: '發生錯誤',
    reload: '重新載入',
    dismiss: '關閉',
  },
};
