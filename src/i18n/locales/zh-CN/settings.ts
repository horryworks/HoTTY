// Settings modal — shell, tab labels, and all tab content.
export const settings = {
  title: '设置',
  tabs: {
    general: '常规',
    appearance: '外观',
    protocols: '协议',
    features: '功能',
    ai: 'AI',
    about: '关于',
  },
  general: {
    // Language selector (this step)
    languageSection: '语言',
    languageLabel: '显示语言',
    languageHelp:
      '更改应用界面的语言。（AI 响应语言在 AI 聊天面板中单独设置。）',
    // Logging
    loggingSection: '日志记录',
    enableLogging: '启用日志记录',
    logFolderPath: '日志文件夹路径',
    logFolderPathHelp: '日志将保存为 YYYYMMDDHHMMSS-(协议)-(IP).txt',
    logFolderPathPlaceholder: '选择文件夹或输入路径...',
    // Terminal
    terminalSection: '终端',
    scrollbackBuffer: '回滚缓冲区',
    scrollbackHelp: '每个终端在内存中保留的最大行数（默认：10000）。',
    enableLineWrap: '启用自动换行',
    // Input
    inputSection: '输入',
    backspaceSendsDel: '退格键发送 DEL (0x7F)',
    backspaceSendsDelHelp:
      '如果禁用，退格键将发送 0x08 (BS)。如果您的服务器需要 0x7F，请启用。',
    rightClickPaste: '右键单击粘贴',
    rightClickPasteHelp: '右键单击终端会显示粘贴确认对话框。',
    // Diagnostics
    diagnosticsSection: '诊断',
    debugLog: '调试日志',
    debugLogHelp: '报告错误时请分享最新的日志文件。',
    openDebugLogFolder: '打开调试日志文件夹',
  },
  appearance: {
    // Layout
    layoutSection: '布局',
    sidebarPosition: '侧边栏位置',
    sidebarLeft: '左侧',
    sidebarRight: '右侧',
    // Theme
    themeSection: '主题',
    themeLabel: '主题',
    deleteTheme: '删除',
    createCustomTheme: '创建自定义主题',
    deleteThemeTitle: '删除主题',
    deleteThemeMessage:
      '删除自定义主题“{{name}}”？此操作无法撤销。',
    // Unused pane background
    unusedPaneBackground: '未使用窗格的背景',
    paneBackgroundColor: '颜色',
    paneBackgroundImage: '图片',
    paneBackgroundImagePlaceholder: '例如 http://asset.localhost/...',
    browse: '浏览…',
    clearImage: '清除图片',
    clear: '清除',
    // Font
    fontSection: '字体',
    fontFamily: '字体',
    systemMonospaceDefault: '系统等宽字体（默认）',
    scanning: '正在扫描...',
    rescan: '重新扫描',
    fontSize: '字号 (px)',
    // Terminal Display
    terminalDisplaySection: '终端显示',
    defaultEncoding: '默认编码',
    defaultEncodingHelp: '适用于新连接。',
    promptHighlight: '提示符高亮',
    enableUserInputHighlight: '启用用户输入高亮',
    highlightColor: '高亮颜色',
    promptPatternsRegex: '提示符模式（正则表达式）',
    namePlaceholder: '名称',
    regexPlaceholder: '正则表达式',
    addPattern: '+ 添加模式',
    resetToDefault: '恢复默认',
  },
  protocols: {
    // SSH
    sshSection: 'SSH',
    connectTimeout: '连接超时',
    timeoutSeconds: '超时（秒）',
    sshTimeoutHelp:
      '放弃前等待初始 TCP 和 SSH 握手的最长时间。默认：5 秒。',
    keepAlive: 'KeepAlive',
    enable: '启用',
    sshKeepAliveHelp: '发送虚拟数据包以防止超时。',
    intervalSeconds: '间隔（秒）',
    // Algorithms
    algorithms: '算法',
    algorithmsHelp: '选择要启用的算法。更改将应用于新会话。',
    categoryServerHostKey: '服务器主机密钥',
    categoryKex: '密钥交换',
    categoryCipher: '密码',
    categoryMac: 'MAC',
    // Telnet
    telnetSection: 'Telnet',
    telnetTimeoutHelp:
      '放弃前等待初始 TCP 连接的最长时间。默认：5 秒。',
    telnetKeepAliveHelp: '发送 Telnet NOP 命令以防止空闲超时。',
    // DH-GEX SHA-1 warning
    dhGexTitle: '启用 diffie-hellman-group-exchange-sha1？',
    dhGexConfirm: '启用',
    dhGexWarning:
      'diffie-hellman-group-exchange-sha1 依赖于 SHA-1，该算法被认为已' +
      '不安全，并已在 OpenSSH 8.2 中从默认设置中移除。仅当您' +
      '必须与不提供更强密钥交换的旧设备通信时才启用它。\n\n' +
      '只要远程设备支持，请优先使用 diffie-hellman-group-exchange-sha256、diffie-hellman-group14-sha256 ' +
      '或 curve25519-sha256。\n\n' +
      '仍要启用 diffie-hellman-group-exchange-sha1 吗？',
  },
  features: {
    fileServerLabel: '文件服务器',
    fileServerDescription: '用于向网络设备上传固件的 TFTP / SFTP 服务器',
    webBrowserLabel: '网页浏览器',
    webBrowserDescription: '用于网络设备网页管理界面的内嵌浏览器窗格',
    section: '功能',
    sectionHelp: '启用或禁用功能窗格。已打开的窗格不受影响。',
    aiChatLabel: 'AI 聊天',
    aiChatDescription: '用于终端辅助的 AI 聊天面板',
    logViewerLabel: '日志查看器',
    logViewerDescription: '查看和分析会话日志',
    pingMonitorLabel: 'Ping 监控',
    pingMonitorDescription: '持续的 ICMP ping 监控',
    textEditorLabel: '文本编辑器',
    textEditorDescription: '内置文本文件编辑器',
    fileExplorerLabel: '文件浏览器',
    fileExplorerDescription: '浏览和管理文件',
  },
  ai: {
    // Provider
    providerSection: '提供商',
    aiProvider: 'AI 提供商',
    aiProviderHelp:
      'Vertex AI 和 Gemini 使用 Google OAuth。Anthropic 和 OpenAI 需要 API 密钥。',
    providerVertexAi: 'Google Cloud Vertex AI',
    providerGemini: 'Google AI Studio (Gemini)',
    providerAnthropic: 'Anthropic (Claude)',
    providerOpenai: 'OpenAI',
    // Authentication
    authentication: '身份验证',
    authenticated: '已通过身份验证',
    notAuthenticated: '未通过身份验证',
    logout: '退出登录',
    // Personas
    personasSection: '角色',
    addPersona: '添加角色',
    personaName: '角色名称',
    displayNamePlaceholder: '显示名称',
    systemPrompt: '系统提示词',
    systemPromptPlaceholder: '系统提示词',
    deletePersona: '删除角色',
    atLeastOnePersona: '至少需要一个角色',
    deletePersonaTitle: '删除“{{label}}”',
    resetAllPersonas: '重置所有角色',
    newPersonaLabel: '新角色',
    // Command Execution
    commandExecutionSection: '命令执行',
    commandExecutionHelp:
      '执行模式和自动运行上限在 AI 聊天窗格中配置（位于消息输入框下方）。',
    commandSafetyClassifier: '命令安全分类器',
    commandSafetyClassifierHelp:
      'HoTTY 如何决定是否自动执行 AI 建议的命令。黑名单始终首先检查（匹配则在执行前询问）。静态：白名单自动运行，其他一切都询问。AI：由 AI 判断任何未被列入黑名单的命令。混合（推荐）：白名单自动运行，由 AI 判断其余命令，否则询问。',
    classifierStatic: '静态白名单',
    classifierAi: 'AI 判断',
    classifierHybrid: '混合（推荐）',
    aiConfidenceThreshold: 'AI 置信度阈值：{{percent}}%',
    aiConfidenceThresholdHelp:
      '自动执行被判定为只读的命令所需的最低 AI 置信度。低于此值时，命令将等待手动运行。值越高越谨慎。默认：70%。',
    deviceResponseTimeout: '设备响应超时（秒）',
    deviceResponseTimeoutHelp:
      '如果设备在命令后这么多秒内没有产生新输出，系统会告知 AI 设备已停止响应，以便循环可以继续。0 将禁用空闲检测。默认：10。',
    sleepAsClientDelay: '将开头的 `sleep` 作为客户端延迟运行',
    sleepAsClientDelayHelp:
      '当 AI 发出以 `sleep N` 开头的命令时（例如 `sleep 120 && validate`），在 HoTTY 中等待 N 秒，而不是在设备上运行 sleep。这可以防止上述设备响应超时在 sleep 期间误触发。任何链接的命令将在等待后运行。默认：开启。',
    maxClientDelay: '最大客户端延迟（秒）',
    maxClientDelayHelp:
      '客户端 sleep 延迟的上限；更长的 sleep 将被限制到此值并予以注明。0 = 无上限。默认：900（15 分钟）。',
    whitelist: '白名单（自动执行）',
    whitelistHelp:
      "此处匹配的命令将自动执行。单个单词作为基本命令匹配（例如 'docker' 匹配任何 docker 命令）；带空格的条目作为命令前缀匹配（例如 'git log'）。已预置安全的默认值；完全可编辑。",
    whitelistPlaceholder: '例如 docker, kubectl get',
    add: '添加',
    resetToDefaults: '恢复默认',
    resetWhitelistTitle: '将白名单重置为内置默认值',
    removeEntry: '移除 {{cmd}}',
    blacklist: '黑名单（执行前询问）',
    blacklistHelp:
      "此处匹配的命令永远不会自动执行 — 仍允许手动运行，但会显示警告。单个单词作为基本命令匹配；带空格的条目作为子字符串匹配（例如 'rm -rf'、'git push'）。已预置破坏性的默认值；完全可编辑。",
    blacklistPlaceholder: '例如 rm -rf, git push',
    resetBlacklistTitle: '将黑名单重置为内置默认值',
    // Modals
    privacyNoticeTitle: '隐私声明',
    privacyNoticeMessage:
      'Google AI Studio (Gemini) 在免费层级可能会使用您的数据进行 AI 训练。在您的 Google Cloud 项目上启用结算即可选择退出。',
    privacyNoticeConfirm: '确定',
    logoutTitle: '退出登录',
    logoutMessage:
      '确定要退出登录吗？您需要重新进行身份验证才能使用该 AI 提供商。',
    logoutConfirm: '退出登录',
    // 数据处理告知
    dataHandlingSection: '数据处理',
    dataHandlingHelp:
      '当您使用 AI 功能时，系统会使用您自己的 API 密钥，将数据发送给您配置的第三方 AI 提供商，并受该提供商的条款和隐私政策约束。',
    dataHandlingBulletProviders:
      '提供商：Google Gemini / Vertex AI、Anthropic 或 OpenAI——以您在上方选择的为准。',
    dataHandlingBulletWhen:
      '仅在您明确使用 AI 功能（聊天、询问 AI 或监视）时发送。您的终端绝不会被持续传输。',
    dataHandlingBulletRedaction:
      '已知的密钥模式会从日志中隐去，但您在消息中输入的文本会原样发送——请勿粘贴凭据。',
    dataConsentStatus: '告知同意',
    dataConsentAccepted: '已接受',
    dataConsentNotAccepted: '尚未显示',
    resetDataConsent: '重新显示',
    resetDataConsentHelp:
      '重置同意，以便在下次 AI 发送前再次显示 AI 数据共享告知。',
  },
  about: {
    version: 'v{{version}}',
    author: 'Katsumasa "Horry" Horiuchi',
    descriptionLine1: 'SSH/Telnet/串口终端模拟器',
    descriptionLine2: '基于 Tauri、React 和 TypeScript 构建',
    licenseLine1: '本程序是自由软件，依据',
    licenseLine2: 'GNU General Public License v3.0 或更高版本发布。',
    viewLicense: '查看 GNU General Public License v3.0',
    logoAlt: 'HoTTY 徽标',
    // 第三方许可证
    thirdPartyLicenses: '第三方许可证',
    thirdPartyLicensesTitle: '第三方许可证',
    thirdPartyLicensesIntro: 'HoTTY 包含来自以下项目的开源软件：',
    thirdPartyLicensesLoading: '正在加载许可证…',
    thirdPartyLicensesError: '加载许可证信息失败。',
    thirdPartyLicensesEmpty: '没有可用的第三方许可证信息。',
    thirdPartyLicensesClose: '关闭',
  },
  customTheme: {
    title: '自定义主题创建器',
    cancel: '取消',
    themeName: '主题名称',
    themeNamePlaceholder: '例如 My Dark Blue',
    baseTheme: '基础主题',
    saveTheme: '保存主题',
    saving: '正在保存...',
    terminalSectionTitle: '终端',
    terminalSectionDesc: 'xterm.js 终端颜色',
    // Validation
    errorEmptyName: '请输入主题名称。',
    errorNoAlphanumeric: '主题名称必须至少包含一个字母数字字符。',
    errorProtectedName: '不能使用“dark”、“medium”或“light”作为主题名称。',
    errorSaveFailed: '保存主题失败。',
    // Section titles & descriptions
    sectionBackgroundsTitle: '背景与文本',
    sectionBackgroundsDesc: '主背景和文本颜色',
    sectionBordersTitle: '边框与强调色',
    sectionBordersDesc: '边框颜色和强调/高亮颜色',
    sectionInputsTitle: '输入框、按钮与悬停',
    sectionInputsDesc: '输入框、按钮和悬停状态颜色',
    sectionStatusTitle: '状态与信号',
    sectionStatusDesc: '成功、错误、警告和危险指示色',
    sectionAiChatTitle: 'AI 聊天',
    sectionAiChatDesc: 'AI 聊天消息和代码块的颜色',
    sectionUiTitle: 'UI 特定组件',
    sectionUiDesc: '侧边栏、标签页、上下文菜单、图标和其他 UI 元素',
    sectionProvidersTitle: 'AI 提供商',
    sectionProvidersDesc:
      'AI 提供商图标使用的品牌色（Gemini、OpenAI、Anthropic、Vertex AI）',
    sectionSearchTitle: '搜索与高亮',
    sectionSearchDesc: '搜索结果的高亮颜色',
    sectionOverlaysTitle: '覆盖层与模态框',
    sectionOverlaysDesc: '模态对话框、覆盖层和通知横幅',
    sectionEffectsTitle: '未来感效果',
    sectionEffectsDesc:
      '应用于活动窗格、侧边栏和模态框的霓虹光晕和玻璃拟态效果',
    // Terminal color rows
    terminalForeground: '前景色',
    terminalForegroundDesc: '终端内的默认文本颜色',
    terminalBackground: '背景（活动）',
    terminalBackgroundDesc: '活动/聚焦终端的背景',
    terminalBackgroundInactive: '背景（非活动）',
    terminalBackgroundInactiveDesc: '非活动/未聚焦终端的背景',
    terminalPaneBackground: '窗格背景',
    terminalPaneBackgroundDesc: '终端周围空间的颜色',
  },
};
