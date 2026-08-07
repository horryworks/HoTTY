// 設定強制回應視窗 — 外框、分頁標籤，以及所有分頁內容。
export const settings = {
  title: '設定',
  tabs: {
    general: '一般',
    appearance: '外觀',
    protocols: '通訊協定',
    features: '功能',
    ai: 'AI',
    about: '關於',
  },
  general: {
    // 語言選擇器（此步驟）
    languageSection: '語言',
    languageLabel: '顯示語言',
    languageHelp:
      '變更應用程式介面的語言。（AI 回應語言預設跟隨此設定，也可在 AI 聊天面板中另行指定。）',
    // 記錄
    loggingSection: '記錄',
    enableLogging: '啟用記錄',
    logFolderPath: '記錄檔資料夾路徑',
    logFolderPathHelp: '終端機記錄檔會以 YYYYMMDDHHMMSS-(Protocol)-(IP).txt 格式儲存，AI 聊天記錄則以 YYYYMMDDHHMMSS-AICHAT-(聊天).md 格式儲存',
    logFolderPathPlaceholder: '選取資料夾或輸入路徑...',
    // 終端機
    terminalSection: '終端機',
    scrollbackBuffer: '回捲緩衝區',
    scrollbackHelp: '每個終端機保留在記憶體中的最大行數（預設值：10000）。',
    enableLineWrap: '啟用自動換行',
    fixedTerminalSizeMode: '固定終端機尺寸',
    fixedTerminalSizeModeHelp: '將終端機寬度固定為連線時協商的尺寸，而不在視窗調整時重新排版。登入時鎖定寬度並忽略後續調整的裝置（如華為 USG/VRP）需要此項——重新排版會使其行編輯錯位。「自動」僅在 SSH 伺服器被識別為此類裝置時才固定。可依連線個別覆寫。',
    fixedTerminalSizeModeOff: '關閉 — 從不固定',
    fixedTerminalSizeModeAuto: '自動 — 偵測裝置後固定（建議）',
    fixedTerminalSizeModeOn: '開啟 — 一律固定',
    // 輸入
    inputSection: '輸入',
    backspaceSendsDel: 'Backspace 傳送 DEL（0x7F）',
    backspaceSendsDelHelp:
      '若停用，Backspace 會傳送 0x08（BS）。若您的伺服器預期收到 0x7F，請啟用此選項。',
    rightClickPaste: '按右鍵以貼上',
    rightClickPasteHelp: '在終端機上按右鍵會顯示貼上確認對話方塊。',
    // 診斷
    diagnosticsSection: '診斷',
    debugLog: '偵錯記錄',
    debugLogHelp: '回報錯誤時請分享最新的記錄檔。',
    openDebugLogFolder: '開啟偵錯記錄資料夾',
  },
  appearance: {
    // 版面配置
    layoutSection: '版面配置',
    sidebarPosition: '側邊欄位置',
    sidebarLeft: '左側',
    sidebarRight: '右側',
    // 佈景主題
    themeSection: '佈景主題',
    themeLabel: '佈景主題',
    deleteTheme: '刪除',
    createCustomTheme: '建立自訂佈景主題',
    deleteThemeTitle: '刪除佈景主題',
    deleteThemeMessage:
      '要刪除自訂佈景主題「{{name}}」嗎？此動作無法復原。',
    // 未使用窗格的背景
    unusedPaneBackground: '未使用窗格的背景',
    paneBackgroundColor: '色彩',
    paneBackgroundImage: '影像',
    paneBackgroundImagePlaceholder: '例如 http://asset.localhost/...',
    browse: '瀏覽…',
    clearImage: '清除影像',
    clear: '清除',
    // 字型
    fontSection: '字型',
    fontFamily: '字型系列',
    systemMonospaceDefault: '系統等寬字型（預設）',
    scanning: '正在掃描...',
    rescan: '重新掃描',
    fontSize: '字型大小（px）',
    webBrowserSection: 'Web 瀏覽器',
    webBrowserDefaultZoom: '預設縮放（%）',
    webBrowserDefaultZoomHelp: '每個新開啟的 Web 瀏覽器窗格的初始縮放比例（25–500%）。之後每個窗格在工作階段期間保留各自的縮放比例。',
    // 終端機顯示
    terminalDisplaySection: '終端機顯示',
    defaultEncoding: '預設編碼',
    defaultEncodingHelp: '套用於新連線。',
    promptHighlight: '提示詞醒目顯示',
    enableUserInputHighlight: '啟用使用者輸入醒目顯示',
    highlightColor: '醒目顯示色彩',
    promptPatternsRegex: '提示詞模式（規則運算式）',
    namePlaceholder: '名稱',
    regexPlaceholder: '規則運算式',
    addPattern: '+ 新增模式',
    resetToDefault: '重設為預設值',
  },
  protocols: {
    // SSH
    sshSection: 'SSH',
    connectTimeout: '連線逾時',
    timeoutSeconds: '逾時（秒）',
    sshTimeoutHelp:
      '放棄前等待初始 TCP 與 SSH 交握的最長時間。預設值：5 秒。',
    keepAlive: 'KeepAlive',
    enable: '啟用',
    sshKeepAliveHelp: '傳送虛擬封包以防止逾時。',
    intervalSeconds: '間隔（秒）',
    // 演算法
    algorithms: '演算法',
    algorithmsHelp: '選擇要啟用哪些演算法。變更會套用至新工作階段。',
    categoryServerHostKey: '伺服器主機金鑰',
    categoryKex: '金鑰交換',
    categoryCipher: '加密演算法',
    categoryMac: 'MAC',
    // Telnet
    telnetSection: 'Telnet',
    telnetTimeoutHelp:
      '放棄前等待初始 TCP 連線的最長時間。預設值：5 秒。',
    telnetKeepAliveHelp: '傳送 Telnet NOP 指令以防止閒置逾時。',
    // DH-GEX SHA-1 警告
    dhGexTitle: '要啟用 diffie-hellman-group-exchange-sha1 嗎？',
    dhGexConfirm: '啟用',
    dhGexWarning:
      'diffie-hellman-group-exchange-sha1 依賴 SHA-1，而 SHA-1 已被視為' +
      '不安全，並已於 OpenSSH 8.2 從預設值中移除。僅在您必須' +
      '與沒有提供更強金鑰交換的舊式裝置通訊時才啟用它。\n\n' +
      '只要遠端裝置支援，請優先使用 diffie-hellman-group-exchange-sha256、' +
      'diffie-hellman-group14-sha256 或 curve25519-sha256。\n\n' +
      '仍要啟用 diffie-hellman-group-exchange-sha1 嗎？',
  },
  features: {
    fileServerLabel: '檔案伺服器',
    fileServerDescription: '用於向網路裝置上傳韌體的 TFTP / SFTP 伺服器',
    webBrowserLabel: '網頁瀏覽器',
    webBrowserDescription: '用於網路裝置網頁管理介面的內嵌瀏覽器窗格',
    section: '功能',
    sectionHelp: '啟用或停用功能窗格。已開啟的窗格不受影響。',
    aiChatLabel: 'AI 聊天',
    aiChatDescription: '由 AI 驅動的聊天面板，用於協助終端機操作',
    logViewerLabel: '記錄檢視器',
    logViewerDescription: '檢視並分析工作階段記錄',
    pingMonitorLabel: 'Ping 監控',
    pingMonitorDescription: '持續 ICMP Ping 監控',

    interfaceTrafficLabel: '介面流量',

    interfaceTrafficDescription: '透過 SNMP 即時檢視網路裝置的介面計數器（bps / pps / 錯誤）',
  },
  ai: {
    // 供應商
    providerSection: '供應商',
    aiProvider: 'AI 供應商',
    aiProviderHelp:
      '選擇供應商後在下方登入。Gemini 使用 Google 登入（OAuth），Vertex AI 使用您的 Google Cloud 專案（ADC 或服務帳戶金鑰），Anthropic 與 OpenAI 使用 API 金鑰。',
    providerVertexAi: 'Google Cloud Vertex AI',
    providerGemini: 'Google AI Studio（Gemini）',
    providerAnthropic: 'Anthropic（Claude）',
    providerOpenai: 'OpenAI',
    // 驗證
    authentication: '驗證',
    authenticated: '已驗證',
    notAuthenticated: '尚未驗證',
    logout: '登出',
    // 憑證輸入表單（依供應商）
    auth: {
      // Gemini（Google AI Studio）
      geminiTitle: '連線至 Gemini',
      clientId: '用戶端 ID',
      clientSecret: '用戶端密碼',
      connecting: '正在連線...',
      signInWithGoogle: '使用 Google 登入',
      // Vertex AI
      vertexTitle: '連線至 Vertex AI',
      gcpProjectId: 'GCP 專案 ID',
      gcpProjectIdPlaceholder: 'my-project-id',
      location: '位置',
      locationPlaceholder: 'us-central1',
      authMethod: '驗證方法',
      authMethodAdc: '應用程式預設憑證（ADC）',
      authMethodServiceAccount: '服務帳戶金鑰檔案',
      serviceAccountKeyFile: '服務帳戶金鑰檔案',
      serviceAccountKeyFilePlaceholder: '/path/to/service-account-key.json',
      browse: '瀏覽...',
      connectVertex: '連線至 Vertex AI',
      // OpenAI
      openaiTitle: '連線至 OpenAI',
      connectOpenai: '連線至 OpenAI',
      openaiKeyPlaceholder: 'sk-...',
      // Anthropic
      anthropicTitle: '連線至 Anthropic',
      connectAnthropic: '連線至 Anthropic',
      anthropicKeyPlaceholder: 'sk-ant-...',
      // 共用
      apiKey: 'API 金鑰',
      failed: '驗證失敗。請再試一次。',
      timedOut: '驗證逾時。請再試一次。',
    },
    // 角色
    personasSection: '角色',
    addPersona: '新增角色',
    personaName: '角色名稱',
    displayNamePlaceholder: '顯示名稱',
    systemPrompt: '系統提示詞',
    systemPromptPlaceholder: '系統提示詞',
    deletePersona: '刪除角色',
    atLeastOnePersona: '至少需要一個角色',
    deletePersonaTitle: '刪除「{{label}}」',
    resetAllPersonas: '重設所有角色',
    newPersonaLabel: '新角色',
    // 指令執行
    commandExecutionSection: '指令執行',
    commandExecutionHelp:
      '執行模式與自動執行上限在 AI 聊天窗格中設定（位於訊息輸入區下方）。',
    commandSafetyClassifier: '指令安全性分類器',
    commandSafetyClassifierHelp:
      'HoTTY 如何判斷是否自動執行 AI 建議的指令。黑名單一律最先檢查（命中時會先詢問再執行）。靜態：白名單自動執行，其餘皆詢問。AI：由 AI 判斷任何未列入黑名單的指令。混合（建議）：白名單自動執行，其餘交由 AI 判斷，否則詢問。',
    classifierStatic: '靜態白名單',
    classifierAi: 'AI 判斷',
    classifierHybrid: '混合（建議）',
    aiConfidenceThreshold: 'AI 信心門檻：{{percent}}%',
    aiConfidenceThresholdHelp:
      '自動執行被判定為唯讀的指令所需的最低 AI 信心度。低於此值時，指令會等待手動執行。值越高越謹慎。預設值：70%。',
    autoExecCountdown: '自動執行倒數（秒）',
    autoExecCountdownHelp:
      '在「安全自動執行」模式下，判定為安全的指令會在等待這些秒數後再執行，讓你能及時取消。0 表示立即執行。最大 10。預設：3。',
    concurrentStreams: 'AI 聊天並行回覆數',
    concurrentStreamsHelp:
      '一個窗格中可同時接收回覆的 AI 聊天分頁數量。超出的傳送會排入佇列，並在回覆完成後開始。1 表示嚴格一次一個（舊行為）。若你的供應商有速率限制（如 Gemini 免費層），請調低。最大 8。預設：3。',
    deviceResponseTimeout: '裝置回應逾時（秒）',
    deviceResponseTimeoutHelp:
      '若裝置在指令後的這麼多秒內未產生新輸出，系統會告知 AI 裝置已停止回應，以便迴圈得以繼續。0 會停用閒置偵測。預設值：10。',
    sleepAsClientDelay: '將開頭的 `sleep` 作為用戶端延遲執行',
    sleepAsClientDelayHelp:
      '當 AI 發出以 `sleep N` 開頭的指令（例如 `sleep 120 && validate`）時，在 HoTTY 中等待 N 秒，而非在裝置上執行 sleep。這可避免上述的裝置回應逾時在 sleep 期間誤觸發。任何串接的指令會在等待後執行。預設值：開啟。',
    maxClientDelay: '最大用戶端延遲（秒）',
    maxClientDelayHelp:
      '用戶端 sleep 延遲的上限；較長的 sleep 會被限制至此值並加註說明。0 = 無上限。預設值：900（15 分鐘）。',
    whitelist: '白名單（自動執行）',
    whitelistHelp:
      '在此處比對到的指令會自動執行。單一字詞會比對為基礎指令（例如「docker」可比對任何 docker 指令）；含空格的項目則會比對為指令前綴（例如「git log」）。已預先填入安全的預設值；可完整編輯。',
    whitelistPlaceholder: '例如 docker、kubectl get',
    add: '新增',
    resetToDefaults: '重設為預設值',
    resetWhitelistTitle: '將白名單重設為內建預設值',
    removeEntry: '移除 {{cmd}}',
    blacklist: '黑名單（執行前先詢問）',
    blacklistHelp:
      '在此處比對到的指令永遠不會自動執行 — 仍可手動執行，但會顯示警告。單一字詞會比對為基礎指令；含空格的項目則會比對為子字串（例如「rm -rf」、「git push」）。已預先填入具破壞性的預設值；可完整編輯。',
    blacklistPlaceholder: '例如 rm -rf、git push',
    resetBlacklistTitle: '將黑名單重設為內建預設值',
    // 強制回應視窗
    privacyNoticeTitle: '隱私權聲明',
    privacyNoticeMessage:
      'Google AI Studio（Gemini）在免費方案中可能會使用您的資料進行 AI 訓練。請在您的 Google Cloud 專案上啟用計費以選擇退出。',
    privacyNoticeConfirm: '確定',
    logoutTitle: '登出',
    logoutMessage:
      '確定要登出嗎？您將需要重新驗證才能使用 AI 供應商。',
    logoutConfirm: '登出',
    // 資料處理告知
    dataHandlingSection: '資料處理',
    dataHandlingHelp:
      '當您使用 AI 功能時，系統會使用您自己的 API 金鑰，將資料傳送給您設定的第三方 AI 供應商，並受該供應商的條款與隱私權政策約束。',
    dataHandlingBulletProviders:
      '供應商：Google Gemini / Vertex AI、Anthropic 或 OpenAI——以您在上方選取的為準。',
    dataHandlingBulletWhen:
      '僅在您明確使用 AI 功能（聊天、詢問 AI 或監看）時傳送。您的終端機絕不會被持續傳輸。',
    dataHandlingBulletRedaction:
      '已知的密鑰模式會從記錄中隱去，但您在訊息中輸入的文字會原樣傳送——請勿貼上憑證。',
    dataConsentStatus: '告知同意',
    dataConsentAccepted: '已接受',
    dataConsentNotAccepted: '尚未顯示',
    resetDataConsent: '重新顯示',
    resetDataConsentHelp:
      '重設同意，以便在下次 AI 傳送前再次顯示 AI 資料分享告知。',
  },
  about: {
    version: 'v{{version}}',
    author: 'Katsumasa "Horry" Horiuchi',
    descriptionLine1: 'SSH/Telnet/序列埠終端機模擬器',
    descriptionLine2: '以 Tauri、React 與 TypeScript 建構',
    licenseLine1: '本程式為自由軟體，依據',
    licenseLine2: 'GNU General Public License v3.0 或更新版本發行。',
    viewLicense: '檢視 GNU General Public License v3.0',
    logoAlt: 'HoTTY 標誌',
    // 第三方授權
    thirdPartyLicenses: '第三方授權',
    thirdPartyLicensesTitle: '第三方授權',
    thirdPartyLicensesIntro: 'HoTTY 包含來自以下專案的開放原始碼軟體：',
    thirdPartyLicensesLoading: '正在載入授權…',
    thirdPartyLicensesError: '載入授權資訊失敗。',
    thirdPartyLicensesEmpty: '沒有可用的第三方授權資訊。',
    thirdPartyLicensesClose: '關閉',
  },
  customTheme: {
    title: '自訂佈景主題建立工具',
    cancel: '取消',
    themeName: '佈景主題名稱',
    themeNamePlaceholder: '例如 My Dark Blue',
    baseTheme: '基底佈景主題',
    saveTheme: '儲存佈景主題',
    saving: '正在儲存...',
    terminalSectionTitle: '終端機',
    terminalSectionDesc: 'xterm.js 終端機色彩',
    // 驗證
    errorEmptyName: '請輸入佈景主題名稱。',
    errorNoAlphanumeric: '佈景主題名稱必須至少包含一個英數字元。',
    errorProtectedName: '無法使用「dark」、「medium」或「light」作為佈景主題名稱。',
    errorSaveFailed: '無法儲存佈景主題。',
    // 區段標題與說明
    sectionBackgroundsTitle: '背景與文字',
    sectionBackgroundsDesc: '主要背景與文字色彩',
    sectionBordersTitle: '邊框與強調',
    sectionBordersDesc: '邊框色彩與強調／醒目色彩',
    sectionInputsTitle: '輸入欄位、按鈕與停留',
    sectionInputsDesc: '輸入欄位、按鈕與停留狀態色彩',
    sectionStatusTitle: '狀態與訊號',
    sectionStatusDesc: '成功、錯誤、警告與危險指示色彩',
    sectionAiChatTitle: 'AI 聊天',
    sectionAiChatDesc: 'AI 聊天訊息與程式碼區塊的色彩',
    sectionUiTitle: 'UI 專屬元件',
    sectionUiDesc: '側邊欄、分頁、操作功能表、圖示及其他 UI 元素',
    sectionProvidersTitle: 'AI 供應商',
    sectionProvidersDesc:
      'AI 供應商圖示所使用的品牌色彩（Gemini、OpenAI、Anthropic、Vertex AI）',
    sectionSearchTitle: '搜尋與醒目顯示',
    sectionSearchDesc: '搜尋結果的醒目顯示色彩',
    sectionOverlaysTitle: '覆蓋層與強制回應視窗',
    sectionOverlaysDesc: '強制回應對話方塊、覆蓋層與通知橫幅',
    sectionEffectsTitle: '未來感效果',
    sectionEffectsDesc:
      '套用於使用中窗格、側邊欄與強制回應視窗的霓虹光暈與玻璃擬態效果',
    // 終端機色彩列
    terminalForeground: '前景',
    terminalForegroundDesc: '終端機內的預設文字色彩',
    terminalBackground: '背景（使用中）',
    terminalBackgroundDesc: '使用中／聚焦終端機的背景',
    terminalBackgroundInactive: '背景（非使用中）',
    terminalBackgroundInactiveDesc: '非使用中／未聚焦終端機的背景',
    terminalPaneBackground: '窗格背景',
    terminalPaneBackgroundDesc: '終端機周圍空間的色彩',
  },
};
