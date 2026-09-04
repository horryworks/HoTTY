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
    viewRelease: '切换版本',
    dismiss: '关闭',
    dismissAria: '关闭更新通知',
  },
  // Toast text for logError() call sites. logError pushes into the error
  // notification store, so every literal handed to it is user-facing UI and
  // must be a key here rather than an inline string.
  errors: {
    aiChatSendFailed: '无法发送 AI 请求',
    aiChatLogDisabled: '已关闭 AI 聊天日志记录',
    aiCredentialEncrypt: '无法加密 AI 凭据',
    aiSignInStart: '无法开始登录',
    aiLogout: '退出登录失败',
    aiAutoAuth: '自动登录失败',
    aiAuthListener: '无法接收登录结果',
    aiLogoutListener: '无法接收退出登录事件',
    aiResponseListener: '无法接收 AI 响应',
    iapVmPromptListen: '无法接收虚拟机启动提示',
    iapVmPromptRespond: '无法响应虚拟机启动提示',
    sshHostKeyListen: '无法接收 SSH 主机密钥提示',
    browserPaneCreate: '无法打开网页浏览器面板',
    browserNavigate: '导航失败',
    browserClearData: '无法清除浏览数据',
    trafficSettingsRestore: '无法恢复流量面板设置',
    trafficListener: '无法接收流量事件',
    pingMonitorListener: '无法接收 Ping 监视器事件',
    fileServerListener: '无法接收文件服务器事件',
    credentialBatch: '无法处理 {{label}} 凭据',
    hostTreeEncrypt: '无法加密主机树',
    credentialMigration: '凭据迁移失败',
    credentialPreload: '后台凭据解密失败',
    sessionLoggingUpdate: '无法更新会话日志记录',
    sessionListener: '无法接收会话事件',
    clipboardCopy: '无法复制所选内容',
  },
  errorBoundary: {
    title: '出现了问题',
    reload: '重新加载',
    dismiss: '关闭',
  },
};
