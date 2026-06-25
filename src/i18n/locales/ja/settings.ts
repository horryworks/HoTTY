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
    logFolderPathHelp: 'ログは YYYYMMDDHHMMSS-(プロトコル)-(IP).txt として保存されます',
    logFolderPathPlaceholder: 'フォルダを選択するかパスを入力...',
    // ターミナル
    terminalSection: 'ターミナル',
    scrollbackBuffer: 'スクロールバックバッファ',
    scrollbackHelp: 'ターミナルごとにメモリに保持する最大行数（デフォルト: 10000）。',
    enableLineWrap: '行の折り返しを有効にする',
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
      'Vertex AI と Gemini は Google OAuth を使用します。Anthropic と OpenAI は API キーが必要です。',
    providerVertexAi: 'Google Cloud Vertex AI',
    providerGemini: 'Google AI Studio (Gemini)',
    providerAnthropic: 'Anthropic (Claude)',
    providerOpenai: 'OpenAI',
    // 認証
    authentication: '認証',
    authenticated: '認証済み',
    notAuthenticated: '未認証',
    logout: 'ログアウト',
    // ペルソナ
    personasSection: 'ペルソナ',
    addPersona: 'ペルソナを追加',
    personaName: 'ペルソナ名',
    displayNamePlaceholder: '表示名',
    systemPrompt: 'システムプロンプト',
    systemPromptPlaceholder: 'システムプロンプト',
    askAiCommands: 'AIに質問コマンド',
    dragToReorder: 'ドラッグして並べ替え',
    labelPlaceholder: 'ラベル',
    promptTemplatePlaceholder: 'プロンプトテンプレート（{selection} が置き換えられます）',
    promptTemplateHelp: '選択したテキストには {selection} プレースホルダーを使用します。',
    addCommand: '+ コマンドを追加',
    resetCommands: 'コマンドをリセット',
    deletePersona: 'ペルソナを削除',
    atLeastOnePersona: '少なくとも1つのペルソナが必要です',
    deletePersonaTitle: '「{{label}}」を削除',
    resetAllPersonas: 'すべてのペルソナをリセット',
    newPersonaLabel: '新しいペルソナ',
    newCommandLabel: '新しいコマンド',
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
      'ここで一致したコマンドは自動実行されます。単語1つはベースコマンドとして一致します（例: 「docker」はあらゆる docker コマンドに一致します）。スペースを含むエントリは部分文字列として一致します（例: 「git log」）。安全なデフォルトで初期化されており、完全に編集可能です。',
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
