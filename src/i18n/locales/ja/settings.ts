// 設定モーダル — 全体・タブラベル・各タブの内容。
export const settings = {
  title: '設定',
  tabs: {
    general: '一般',
    appearance: '外観',
    protocols: 'プロトコル',
    features: '機能',
    ai: 'AI',
    about: '情報',
  },
  general: {
    // 言語セレクター
    languageSection: '言語',
    languageLabel: '表示言語',
    languageHelp:
      'アプリのインターフェースの言語を変更します。（AIの応答言語はAIチャットパネルで個別に設定します。）',
    // ログ
    loggingSection: 'ログ',
    enableLogging: 'ログを有効にする',
    logFolderPath: 'ログフォルダのパス',
    logFolderPathHelp: 'ターミナルのログは YYYYMMDDHHMMSS-(プロトコル)-(IP).txt、AI チャットの履歴は YYYYMMDDHHMMSS-AICHAT-(チャット).md として保存されます',
    logFolderPathPlaceholder: 'フォルダを選択するかパスを入力...',
    // ターミナル
    terminalSection: 'ターミナル',
    scrollbackBuffer: 'スクロールバックバッファ',
    scrollbackHelp: 'ターミナルごとにメモリに保持する最大行数（デフォルト: 10000）。',
    enableLineWrap: '行の折り返しを有効にする',
    fixedTerminalSizeMode: '端末サイズの固定',
    fixedTerminalSizeModeHelp: 'ウィンドウのリサイズで再描画せず、接続時に決めた幅に端末を固定します。ログイン時に幅を固定して以後のリサイズを無視する機器（Huawei USG/VRP など）に必要です（再描画すると行編集がズレます）。「自動」はSSHサーバがそうした機器だと判別できた時だけ固定します。接続ごとに上書きできます。',
    fixedTerminalSizeModeOff: 'しない — 常に固定しない',
    fixedTerminalSizeModeAuto: '自動 — 機器を判別して固定（推奨）',
    fixedTerminalSizeModeOn: 'する — 常に固定する',
    // 入力
    inputSection: '入力',
    backspaceSendsDel: 'Backspace で DEL (0x7F) を送信',
    backspaceSendsDelHelp:
      '無効の場合、Backspace は 0x08 (BS) を送信します。サーバーが 0x7F を要求する場合は有効にしてください。',
    rightClickPaste: '右クリックで貼り付け',
    rightClickPasteHelp: 'ターミナルを右クリックすると貼り付け確認ダイアログが表示されます。',
    // 診断
    diagnosticsSection: '診断',
    debugLog: 'デバッグログ',
    debugLogHelp: 'バグ報告の際は最新のログファイルを共有してください。',
    openDebugLogFolder: 'デバッグログフォルダを開く',
  },
  appearance: {
    // レイアウト
    layoutSection: 'レイアウト',
    sidebarPosition: 'サイドバーの位置',
    sidebarLeft: '左',
    sidebarRight: '右',
    // テーマ
    themeSection: 'テーマ',
    themeLabel: 'テーマ',
    deleteTheme: '削除',
    createCustomTheme: 'カスタムテーマを作成',
    deleteThemeTitle: 'テーマを削除',
    deleteThemeMessage:
      'カスタムテーマ「{{name}}」を削除しますか？この操作は取り消せません。',
    // 未使用ペインの背景
    unusedPaneBackground: '未使用ペインの背景',
    paneBackgroundColor: '色',
    paneBackgroundImage: '画像',
    paneBackgroundImagePlaceholder: '例: http://asset.localhost/...',
    browse: '参照…',
    clearImage: '画像をクリア',
    clear: 'クリア',
    // フォント
    fontSection: 'フォント',
    fontFamily: 'フォントファミリー',
    systemMonospaceDefault: 'システム等幅フォント（デフォルト）',
    scanning: 'スキャン中...',
    rescan: '再スキャン',
    fontSize: 'フォントサイズ (px)',
    // Web ブラウザ
    webBrowserSection: 'Web ブラウザ',
    webBrowserDefaultZoom: '既定のズーム (%)',
    webBrowserDefaultZoomHelp: '新しく開く Web ブラウザペインの初期ズーム倍率です (25〜500%)。各ペインはその後、セッション中は個別のズームを保持します。',
    // ターミナル表示
    terminalDisplaySection: 'ターミナル表示',
    defaultEncoding: 'デフォルトのエンコーディング',
    defaultEncodingHelp: '新しい接続に適用されます。',
    promptHighlight: 'プロンプトのハイライト',
    enableUserInputHighlight: 'ユーザー入力のハイライトを有効にする',
    highlightColor: 'ハイライトの色',
    promptPatternsRegex: 'プロンプトのパターン（正規表現）',
    namePlaceholder: '名前',
    regexPlaceholder: '正規表現',
    addPattern: '+ パターンを追加',
    resetToDefault: 'デフォルトに戻す',
  },
  protocols: {
    // SSH
    sshSection: 'SSH',
    connectTimeout: '接続タイムアウト',
    timeoutSeconds: 'タイムアウト（秒）',
    sshTimeoutHelp:
      '最初の TCP および SSH ハンドシェイクを待つ最大時間。これを超えると中止します。デフォルト: 5秒。',
    keepAlive: 'キープアライブ',
    enable: '有効化',
    sshKeepAliveHelp: 'タイムアウトを防ぐためにダミーパケットを送信します。',
    intervalSeconds: '間隔（秒）',
    // アルゴリズム
    algorithms: 'アルゴリズム',
    algorithmsHelp: '有効にするアルゴリズムを選択します。変更は新しいセッションに適用されます。',
    categoryServerHostKey: 'サーバーホストキー',
    categoryKex: '鍵交換',
    categoryCipher: '暗号',
    categoryMac: 'MAC',
    // Telnet
    telnetSection: 'Telnet',
    telnetTimeoutHelp:
      '最初の TCP 接続を待つ最大時間。これを超えると中止します。デフォルト: 5秒。',
    telnetKeepAliveHelp: 'アイドルタイムアウトを防ぐために Telnet NOP コマンドを送信します。',
    // DH-GEX SHA-1 警告
    dhGexTitle: 'diffie-hellman-group-exchange-sha1 を有効にしますか？',
    dhGexConfirm: '有効化',
    dhGexWarning:
      'diffie-hellman-group-exchange-sha1 は SHA-1 に依存しており、SHA-1 は' +
      '破られているとみなされ、OpenSSH 8.2 でデフォルトから削除されました。' +
      'より強力な鍵交換を提供しないレガシー機器と通信する必要がある場合にのみ有効にしてください。\n\n' +
      'リモート機器が対応している場合は、diffie-hellman-group-exchange-sha256、' +
      'diffie-hellman-group14-sha256、または curve25519-sha256 を優先してください。\n\n' +
      'それでも diffie-hellman-group-exchange-sha1 を有効にしますか？',
  },
  features: {
    fileServerLabel: 'ファイルサーバー',
    fileServerDescription: 'ネットワーク機器へのファームウェアアップロード用 TFTP / SFTP サーバー',
    webBrowserLabel: 'Web ブラウザー',
    webBrowserDescription: 'ネットワーク機器の Web 管理画面を開く組み込みブラウザーペイン',
    section: '機能',
    sectionHelp: '機能ペインを有効または無効にします。既に開いているペインには影響しません。',
    aiChatLabel: 'AIチャット',
    aiChatDescription: 'ターミナル支援のためのAI搭載チャットパネル',
    logViewerLabel: 'ログビューア',
    logViewerDescription: 'セッションログの表示と分析',
    pingMonitorLabel: 'Pingモニター',
    pingMonitorDescription: '継続的な ICMP ping モニタリング',
    textEditorLabel: 'テキストエディター',
    textEditorDescription: '組み込みのテキストファイルエディター',
    fileExplorerLabel: 'ファイルエクスプローラー',
    fileExplorerDescription: 'ファイルの参照と管理',
  },
  ai: {
    // プロバイダー
    providerSection: 'プロバイダー',
    aiProvider: 'AIプロバイダー',
    aiProviderHelp:
      'プロバイダーを選び、下でサインインします。Gemini は Google サインイン（OAuth）、Vertex AI は Google Cloud プロジェクト（ADC またはサービスアカウント鍵）、Anthropic と OpenAI は API キーを使用します。',
    providerVertexAi: 'Google Cloud Vertex AI',
    providerGemini: 'Google AI Studio (Gemini)',
    providerAnthropic: 'Anthropic (Claude)',
    providerOpenai: 'OpenAI',
    // 認証
    authentication: '認証',
    authenticated: '認証済み',
    notAuthenticated: '未認証',
    logout: 'ログアウト',
    // 認証情報の入力フォーム（プロバイダー別）
    auth: {
      // Gemini (Google AI Studio)
      geminiTitle: 'Gemini に接続',
      clientId: 'クライアントID',
      clientSecret: 'クライアントシークレット',
      connecting: '接続中...',
      signInWithGoogle: 'Googleでサインイン',
      // Vertex AI
      vertexTitle: 'Vertex AI に接続',
      gcpProjectId: 'GCP プロジェクトID',
      gcpProjectIdPlaceholder: 'my-project-id',
      location: 'ロケーション',
      locationPlaceholder: 'us-central1',
      authMethod: '認証方式',
      authMethodAdc: 'アプリケーションのデフォルト認証情報 (ADC)',
      authMethodServiceAccount: 'サービスアカウントキーファイル',
      serviceAccountKeyFile: 'サービスアカウントキーファイル',
      serviceAccountKeyFilePlaceholder: '/path/to/service-account-key.json',
      browse: '参照...',
      connectVertex: 'Vertex AI に接続',
      // OpenAI
      openaiTitle: 'OpenAI に接続',
      connectOpenai: 'OpenAI に接続',
      openaiKeyPlaceholder: 'sk-...',
      // Anthropic
      anthropicTitle: 'Anthropic に接続',
      connectAnthropic: 'Anthropic に接続',
      anthropicKeyPlaceholder: 'sk-ant-...',
      // 共通
      apiKey: 'APIキー',
      failed: '認証に失敗しました。もう一度お試しください。',
      timedOut: '認証がタイムアウトしました。もう一度お試しください。',
    },
    // ペルソナ
    personasSection: 'ペルソナ',
    addPersona: 'ペルソナを追加',
    personaName: 'ペルソナ名',
    displayNamePlaceholder: '表示名',
    systemPrompt: 'システムプロンプト',
    systemPromptPlaceholder: 'システムプロンプト',
    deletePersona: 'ペルソナを削除',
    atLeastOnePersona: '少なくとも1つのペルソナが必要です',
    deletePersonaTitle: '「{{label}}」を削除',
    resetAllPersonas: 'すべてのペルソナをリセット',
    newPersonaLabel: '新しいペルソナ',
    // コマンド実行
    commandExecutionSection: 'コマンド実行',
    commandExecutionHelp:
      '実行モードと自動実行の上限は AI チャットペイン（メッセージ入力欄の下）で設定します。',
    commandSafetyClassifier: 'コマンド安全性分類器',
    commandSafetyClassifierHelp:
      'HoTTY が AI 提案コマンドを自動実行するかどうかを判断する方法。ブラックリストは常に最初にチェックされます（一致した場合は実行前に確認します）。静的: ホワイトリストは自動実行され、それ以外はすべて確認します。AI: ブラックリストに含まれないものを AI が判断します。ハイブリッド（推奨）: ホワイトリストは自動実行され、残りは AI が判断し、それ以外は確認します。',
    classifierStatic: '静的ホワイトリスト',
    classifierAi: 'AIによる判断',
    classifierHybrid: 'ハイブリッド（推奨）',
    aiConfidenceThreshold: 'AI信頼度のしきい値: {{percent}}%',
    aiConfidenceThresholdHelp:
      '読み取り専用と判断されたコマンドを自動実行するために必要な最小 AI 信頼度。これを下回ると、コマンドは手動の実行を待ちます。高いほど慎重になります。デフォルト: 70%。',
    autoExecCountdown: '自動実行までのカウントダウン（秒）',
    autoExecCountdownHelp:
      '自動実行（安全）モードで、安全と判定されたコマンドを実行する前にこの秒数だけ待機し、その間にキャンセルできます。0 で即時実行。最大10。既定: 3。',
    concurrentStreams: 'AI チャットの並列応答数',
    concurrentStreamsHelp:
      '1 つのペインで同時に応答を受信できる AI チャットのタブ数です。超過分はキューに入り、応答が終わり次第開始します。1 で従来どおり一度に 1 件のみ。プロバイダのレート制限（例: Gemini 無料枠）に掛かる場合は下げてください。最大8。既定: 3。',
    deviceResponseTimeout: 'デバイス応答タイムアウト（秒）',
    deviceResponseTimeoutHelp:
      'コマンド後にデバイスがこの秒数の間新しい出力を生成しない場合、ループを継続できるように、デバイスが応答を停止したことが AI に伝えられます。0 でアイドル検出を無効にします。デフォルト: 10。',
    sleepAsClientDelay: '先頭の `sleep` をクライアント側の遅延として実行する',
    sleepAsClientDelayHelp:
      'AI が `sleep N` で始まるコマンド（例: `sleep 120 && validate`）を発行した場合、デバイス上で sleep を実行する代わりに HoTTY 内で N 秒待機します。これにより、sleep 中に上記のデバイス応答タイムアウトが誤って発動するのを防ぎます。連結されたコマンドは待機後に実行されます。デフォルト: オン。',
    maxClientDelay: 'クライアント側の最大遅延（秒）',
    maxClientDelayHelp:
      'クライアント側の sleep 遅延の上限。これより長い sleep はこの値に制限され、その旨が記録されます。0 = 上限なし。デフォルト: 900（15分）。',
    whitelist: 'ホワイトリスト（自動実行）',
    whitelistHelp:
      'ここで一致したコマンドは自動実行されます。単語1つはベースコマンドとして一致します（例: 「docker」はあらゆる docker コマンドに一致します）。スペースを含むエントリはコマンドの先頭（プレフィックス）として一致します（例: 「git log」）。安全なデフォルトで初期化されており、完全に編集可能です。',
    whitelistPlaceholder: '例: docker, kubectl get',
    add: '追加',
    resetToDefaults: 'デフォルトに戻す',
    resetWhitelistTitle: 'ホワイトリストを組み込みのデフォルトに戻します',
    removeEntry: '{{cmd}} を削除',
    blacklist: 'ブラックリスト（実行前に確認）',
    blacklistHelp:
      'ここで一致したコマンドは決して自動実行されません。手動の実行は警告付きで引き続き許可されます。単語1つはベースコマンドとして一致します。スペースを含むエントリは部分文字列として一致します（例: 「rm -rf」「git push」）。破壊的なデフォルトで初期化されており、完全に編集可能です。',
    blacklistPlaceholder: '例: rm -rf, git push',
    resetBlacklistTitle: 'ブラックリストを組み込みのデフォルトに戻します',
    // モーダル
    privacyNoticeTitle: 'プライバシーに関する通知',
    privacyNoticeMessage:
      'Google AI Studio (Gemini) は、無料枠ではデータを AI トレーニングに使用する場合があります。オプトアウトするには、Google Cloud プロジェクトで請求を有効にしてください。',
    privacyNoticeConfirm: 'OK',
    logoutTitle: 'ログアウト',
    logoutMessage:
      'ログアウトしてもよろしいですか？AI プロバイダーを使用するには再認証が必要になります。',
    logoutConfirm: 'ログアウト',
    // データの取り扱いに関する開示
    dataHandlingSection: 'データの取り扱い',
    dataHandlingHelp:
      'AI 機能を使用すると、設定したサードパーティの AI プロバイダーに、お客様ご自身の API キーを使用してデータが送信されます。送信は当該プロバイダーの利用規約およびプライバシーポリシーに従って行われます。',
    dataHandlingBulletProviders:
      'プロバイダー: Google Gemini / Vertex AI、Anthropic、または OpenAI — 上で選択したいずれか。',
    dataHandlingBulletWhen:
      'AI 機能（チャット、AIに質問、監視）を明示的に使用したときのみ送信されます。端末が継続的に送信されることはありません。',
    dataHandlingBulletRedaction:
      '既知の機密パターンはログから秘匿されますが、メッセージに入力したテキストはそのまま送信されます。認証情報を貼り付けないでください。',
    dataConsentStatus: '開示への同意',
    dataConsentAccepted: '同意済み',
    dataConsentNotAccepted: '未表示',
    resetDataConsent: '再表示',
    resetDataConsentHelp:
      '同意をリセットし、次回の AI 送信前に AI データ共有の開示を再度表示します。',
  },
  about: {
    version: 'v{{version}}',
    author: 'Katsumasa "Horry" Horiuchi',
    descriptionLine1: 'SSH/Telnet/シリアル ターミナルエミュレーター',
    descriptionLine2: 'Tauri、React、TypeScript で構築',
    licenseLine1: 'このプログラムはフリーソフトウェアであり、',
    licenseLine2: 'GNU General Public License v3.0 以降の下で公開されています。',
    viewLicense: 'GNU General Public License v3.0 を表示',
    logoAlt: 'HoTTY ロゴ',
    // サードパーティライセンス
    thirdPartyLicenses: 'サードパーティライセンス',
    thirdPartyLicensesTitle: 'サードパーティライセンス',
    thirdPartyLicensesIntro: 'HoTTY には次のプロジェクトのオープンソースソフトウェアが含まれています:',
    thirdPartyLicensesLoading: 'ライセンスを読み込み中…',
    thirdPartyLicensesError: 'ライセンス情報の読み込みに失敗しました。',
    thirdPartyLicensesEmpty: '利用可能なサードパーティライセンス情報はありません。',
    thirdPartyLicensesClose: '閉じる',
  },
  customTheme: {
    title: 'カスタムテーマ作成',
    cancel: 'キャンセル',
    themeName: 'テーマ名',
    themeNamePlaceholder: '例: My Dark Blue',
    baseTheme: 'ベーステーマ',
    saveTheme: 'テーマを保存',
    saving: '保存中...',
    terminalSectionTitle: 'ターミナル',
    terminalSectionDesc: 'xterm.js ターミナルの色',
    // 検証
    errorEmptyName: 'テーマ名を入力してください。',
    errorNoAlphanumeric: 'テーマ名には少なくとも1つの英数字を含める必要があります。',
    errorProtectedName: '「dark」「medium」「light」はテーマ名として使用できません。',
    errorSaveFailed: 'テーマの保存に失敗しました。',
    // セクションのタイトルと説明
    sectionBackgroundsTitle: '背景とテキスト',
    sectionBackgroundsDesc: 'メインの背景色とテキストの色',
    sectionBordersTitle: '境界線とアクセント',
    sectionBordersDesc: '境界線の色とアクセント／ハイライトの色',
    sectionInputsTitle: '入力・ボタン・ホバー',
    sectionInputsDesc: '入力フィールド、ボタン、ホバー状態の色',
    sectionStatusTitle: 'ステータスとシグナル',
    sectionStatusDesc: '成功、エラー、警告、危険を示すインジケーターの色',
    sectionAiChatTitle: 'AIチャット',
    sectionAiChatDesc: 'AIチャットメッセージとコードブロックの色',
    sectionUiTitle: 'UI固有のコンポーネント',
    sectionUiDesc: 'サイドバー、タブ、コンテキストメニュー、アイコン、その他のUI要素',
    sectionProvidersTitle: 'AIプロバイダー',
    sectionProvidersDesc:
      'AIプロバイダーのアイコンに使用されるブランドカラー（Gemini、OpenAI、Anthropic、Vertex AI）',
    sectionSearchTitle: '検索とハイライト',
    sectionSearchDesc: '検索結果のハイライトの色',
    sectionOverlaysTitle: 'オーバーレイとモーダル',
    sectionOverlaysDesc: 'モーダルダイアログ、オーバーレイ、通知バナー',
    sectionEffectsTitle: '未来的なエフェクト',
    sectionEffectsDesc:
      'アクティブなペイン、サイドバー、モーダルに適用されるネオングローとグラスモーフィズムのエフェクト',
    // ターミナルの色の行
    terminalForeground: '前景',
    terminalForegroundDesc: 'ターミナル内のデフォルトのテキスト色',
    terminalBackground: '背景（アクティブ）',
    terminalBackgroundDesc: 'アクティブ／フォーカス中のターミナルの背景',
    terminalBackgroundInactive: '背景（非アクティブ）',
    terminalBackgroundInactiveDesc: '非アクティブ／非フォーカスのターミナルの背景',
    terminalPaneBackground: 'ペインの背景',
    terminalPaneBackgroundDesc: 'ターミナルを囲む空間の色',
  },
};
