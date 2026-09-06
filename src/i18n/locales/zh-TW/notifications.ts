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
    viewRelease: '切換版本',
    dismiss: '關閉',
    dismissAria: '關閉更新通知',
  },
  // Toast text for logError() call sites. logError pushes into the error
  // notification store, so every literal handed to it is user-facing UI and
  // must be a key here rather than an inline string.
  errors: {
    aiChatSendFailed: '無法傳送 AI 要求',
    aiChatLogDisabled: '已關閉 AI 交談記錄',
    aiCredentialEncrypt: '無法加密 AI 認證資訊',
    aiSignInStart: '無法開始登入',
    aiLogout: '登出失敗',
    aiAutoAuth: '自動登入失敗',
    aiAuthListener: '無法接收登入結果',
    aiLogoutListener: '無法接收登出事件',
    aiResponseListener: '無法接收 AI 回應',
    iapVmPromptListen: '無法接收虛擬機器啟動提示',
    iapVmPromptRespond: '無法回應虛擬機器啟動提示',
    sshHostKeyListen: '無法接收 SSH 主機金鑰提示',
    browserPaneCreate: '無法開啟網頁瀏覽器窗格',
    browserNavigate: '導覽失敗',
    browserClearData: '無法清除瀏覽資料',
    trafficSettingsRestore: '無法還原流量窗格設定',
    trafficListener: '無法接收流量事件',
    pingMonitorListener: '無法接收 Ping 監視器事件',
    fileServerListener: '無法接收檔案伺服器事件',
    credentialBatch: '無法處理 {{label}} 認證資訊',
    hostTreeEncrypt: '無法加密認證資訊 — 主機樹狀結構未儲存',
    credentialMigration: '認證資訊移轉失敗',
    credentialPreload: '背景認證資訊解密失敗',
    sessionLoggingUpdate: '無法更新工作階段記錄',
    sessionListener: '無法接收工作階段事件',
    clipboardCopy: '無法複製所選內容',
  },
  errorBoundary: {
    title: '發生錯誤',
    reload: '重新載入',
    dismiss: '關閉',
  },
};
