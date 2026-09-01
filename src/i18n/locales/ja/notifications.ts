// 通知・オーバーレイ（エラートースト・接続中オーバーレイ・アップデート
// バナー・クラッシュ時のフォールバック）。
export const notifications = {
  error: {
    dismiss: 'エラー通知を閉じる',
  },
  connecting: {
    label: '接続中',
  },
  update: {
    titleAvailable: '新しいバージョンがあります: v{{version}}',
    prereleaseSuffix: '（プレリリース）',
    running: '現在のバージョン: v{{version}}',
    viewRelease: 'リリースを表示',
    dismiss: '閉じる',
    dismissAria: 'アップデート通知を閉じる',
  },
  // Toast text for logError() call sites. logError pushes into the error
  // notification store, so every literal handed to it is user-facing UI and
  // must be a key here rather than an inline string.
  errors: {
    aiChatSendFailed: 'AI へのリクエストを送信できませんでした',
    aiChatLogDisabled: 'AI チャットのログ記録を無効にしました',
    aiCredentialEncrypt: 'AI の認証情報を暗号化できませんでした',
    aiSignInStart: 'サインインを開始できませんでした',
    aiLogout: 'サインアウトに失敗しました',
    aiAutoAuth: '自動サインインに失敗しました',
    aiAuthListener: 'サインイン結果を受信できませんでした',
    aiLogoutListener: 'サインアウトの通知を受信できませんでした',
    aiResponseListener: 'AI の応答を受信できませんでした',
    iapVmPromptListen: 'VM 起動の確認を受信できませんでした',
    iapVmPromptRespond: 'VM 起動の確認に応答できませんでした',
    sshHostKeyListen: 'SSH ホストキーの確認を受信できませんでした',
    browserPaneCreate: 'Web ブラウザペインを開けませんでした',
    browserNavigate: 'ページを開けませんでした',
    browserClearData: '閲覧データを消去できませんでした',
    trafficSettingsRestore: 'トラフィックペインの設定を復元できませんでした',
    trafficListener: 'トラフィックの通知を受信できませんでした',
    pingMonitorListener: 'Ping モニターの通知を受信できませんでした',
    fileServerListener: 'ファイルサーバーの通知を受信できませんでした',
    credentialBatch: '{{label}} の認証情報を処理できませんでした',
    hostTreeEncrypt: 'ホストツリーを暗号化できませんでした',
    credentialMigration: '認証情報の移行に失敗しました',
    credentialPreload: 'バックグラウンドでの認証情報の復号に失敗しました',
    sessionLoggingUpdate: 'セッションのログ設定を更新できませんでした',
    sessionListener: 'セッションの通知を受信できませんでした',
    clipboardCopy: '選択範囲をコピーできませんでした',
  },
  errorBoundary: {
    title: '問題が発生しました',
    reload: '再読み込み',
    dismiss: '閉じる',
  },
};
