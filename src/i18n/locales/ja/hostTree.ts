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
  netbox: {
    category: 'NetBox',
    syncTitle: 'NetBox から同期',
    syncing: 'NetBox から同期中…',
    missing: 'NetBox にありません',
    missingTitle: 'このフォルダは NetBox にもうありません。中に自分で追加したホストが入っている可能性があるため、削除せずに残しています。',
    managedTitle: 'NetBox から同期されたフォルダです。名前と位置は同期が管理します。',
    renameBlocked: 'このフォルダの名前は NetBox が決めるため、ここでは変更できません。',
    deleteWarning: 'このフォルダは NetBox と同期しています。次の同期で空の状態で再作成されます。中に入れたホストは戻りません。',
    syncFailed: 'NetBox の同期に失敗しました',
    syncDone: 'NetBox の同期が完了しました',
    // プレフィクスによる配置提案。ツリーに NetBox のプレフィクスがあり、かつ
    // 入力されたアドレスが IP リテラルのときだけ表示する。それ以外は行ごと出さない。
    placement: {
      // {{prefix}} は一致した CIDR（例: 10.1.0.0/16）。
      matched: 'NetBox の {{prefix}} に一致',
      saveTo: '保存先',
      // {{name}} は「追加」ボタンが本来使うはずだったフォルダ。
      here: 'ここ: {{name}}',
      topLevel: '最上位',
      // {{prefix}} は複数のフォルダが同じだけ主張している CIDR。
      ambiguous: '{{prefix}} を含む NetBox フォルダが複数あるため、HoTTY は選びません: {{folders}}',
      unmatched: 'このアドレスを含む NetBox フォルダはありません。',
    },
  },
  folderDetails: {
    badge: 'NetBox · {{kind}}',
    kindRegion: 'Region',
    kindSite: 'Site',
    missingSince: '{{when}} 以降 NetBox に見つかりません',
    ipRanges: 'IP レンジ',
    unreadableRanges: '読めなかったレンジが {{count}} 件あります',
    contents: '中身',
    counts: 'フォルダ {{folders}} ・ ホスト {{hosts}}',
    empty: 'このフォルダは空です。',
    outOfRange: 'レンジ外',
    outOfRangeTitle: 'このアドレスは、このフォルダのどの IP レンジにも入っていません。NetBox にレンジが登録されていないだけの場合もあります。',
  },
  newConnection: '新規接続',
  newConnectionTitle: '新しい接続を開始（フォームをクリアします）',
  empty: '右クリックまたは上部の + ボタンでホストやフォルダを追加してください',
  filter: {
    placeholder: 'フォルダ・ホストを絞り込み',
    ariaLabel: 'フォルダ・ホストを絞り込み',
    clear: '絞り込みを解除',
    // {{query}} はユーザーが入力した文字列。
    noMatches: '「{{query}}」に一致するフォルダ・ホストはありません',
  },
  contextMenu: {
    openAll: 'すべて開く',
    addFolder: 'フォルダを追加',
    addHost: 'ホストを追加',
    rename: '名前を変更 (F2)',
    export: 'エクスポート',
    import: 'インポート',
    sortAscending: '昇順で並べ替え',
    sortDescending: '降順で並べ替え',
    moveByPrefix: 'IP レンジで振り分け…',
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
    fixedTerminalSizeLabel: '端末サイズの固定',
    fixedTerminalSizeDefault: 'グローバル設定に従う',
    fixedTerminalSizeOn: '固定する',
    fixedTerminalSizeOff: '固定しない',
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
