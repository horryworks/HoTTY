// ホストツリーのサイドバー — ツールバー・コンテキストメニュー・
// 新規接続の擬似行・空状態のヒント・追加/編集/エクスポート/インポートモーダル・
// 削除の確認・成功/失敗の通知メッセージ。
export const hostTree = {
  toolbar: {
    addFolder: 'フォルダを追加',
    addHost: 'ホストを追加',
    exportTree: 'ツリーをエクスポート',
    importTree: 'ツリーをインポート',
  },
  newConnection: '新規接続',
  newConnectionTitle: '新しい接続を開始（フォームをクリアします）',
  empty: '右クリックまたは上部の + ボタンでホストやフォルダを追加してください',
  contextMenu: {
    openAll: 'すべて開く',
    addFolder: 'フォルダを追加',
    addHost: 'ホストを追加',
    rename: '名前を変更 (F2)',
    export: 'エクスポート',
    import: 'インポート',
    sortAscending: '昇順で並べ替え',
    sortDescending: '降順で並べ替え',
  },
  openAll: {
    confirmTitle: 'すべてのホストを開く',
    // {{count}} = ホスト数, {{name}} = フォルダ名
    confirmMessage: '「{{name}}」内のホスト {{count}} 件をすべて開きますか？',
  },
  modal: {
    renameFolder: 'フォルダ名を変更',
    addFolder: 'フォルダを追加',
    editHost: 'ホストを編集',
    addHost: 'ホストを追加',
    exportTitle: 'ホストツリーをエクスポート',
    importTitle: 'ホストツリーをインポート',
    displayName: '表示名',
    setEncryptionPassword: '暗号化パスワードを設定:',
    enterDecryptionPassword: '復号パスワードを入力:',
    exportPasswordHint: 'このパスワードは後でファイルをインポートする際に必要になります。',
    importPasswordHint: 'このファイルのエクスポートに使用したパスワードを入力してください。',
    protocol: 'プロトコル',
    useAsJumpbox: 'ジャンプボックスとして使用',
    hostLabel: 'ホスト/IP',
    hostPlaceholder: '192.168.1.1',
    portLabel: 'ポート',
    usernameLabel: 'ユーザー名',
    passwordLabel: 'パスワード',
    export: 'エクスポート',
    import: 'インポート',
  },
  delete: {
    titleFolder: 'フォルダを削除',
    titleHost: 'ホストを削除',
    // {{name}} はノードの表示名です。{{warning}} はそのホストがジャンプボックスとして
    // 参照されている場合のみ付加されます（下記 jumpboxWarning 参照）。それ以外は空です。
    message: '"{{name}}" を削除してもよろしいですか？\nこの操作は取り消せません。{{warning}}',
    // {{count}} はホスト数、{{names}} はホスト名のカンマ区切りリストです。
    jumpboxWarning:
      '\n\nこのホストは {{count}} 個のホストのジャンプボックスとして使用されています: {{names}}。それらのジャンプボックス設定は解除されます。',
  },
  messages: {
    importErrorTitle: 'インポートエラー',
    // {{error}} は元のエラーメッセージです。
    importErrorBody: 'ファイルを開けませんでした: {{error}}',
    exportSuccessTitle: 'エクスポート成功',
    exportSuccessBody: 'ホストツリーを正常にエクスポートしました。',
    exportFailedTitle: 'エクスポート失敗',
    importSuccessTitle: 'インポート成功',
    importSuccessBody: 'ホストを正常にインポートしました。',
    // {{folderName}} は生成された "Imported_<ファイル名>" フォルダ名です。
    importSuccessIntoFolder: 'ホストをインポートし、"{{folderName}}" フォルダに追加しました。',
    importFailedTitle: 'インポート失敗',
  },
};
