// モーダルダイアログ — 確認・貼り付け・SSHホスト鍵・システムプロンプト・
// AIへの質問・IAP VM起動・ホストツリーへの保存。ダイアログごとにキーをまとめています。
export const dialogs = {
  closeAiWindow: {
    title: 'AI Chat を閉じる',
    message_one: 'このウィンドウを閉じると、会話 {{count}} 件が終了します。',
    message_other: 'このウィンドウを閉じると、会話 {{count}} 件が終了します。',
    workers_one: 'AI が開いた端末 {{count}} 本も切断します。',
    workers_other: 'AI が開いた端末 {{count}} 本も切断します。',
    hint: '残したいときは「戻す」を使ってください。',
    confirmLabel: '閉じる',
  },
  confirm: {
    title: '確認',
    // 呼び出し元がラベルを渡さない場合の既定の確認ボタンラベル。
    confirmLabel: '削除',
  },
  paste: {
    header: '貼り付けの確認',
    newlineWarning: '⚠️ 警告: 改行文字が含まれています',
    paste: '貼り付け',
  },
  sshHostKey: {
    titleChanged: 'ホスト鍵が変更されました',
    titleUnknown: '不明なホスト鍵',
    warning:
      '警告: このサーバーのホスト鍵が前回の接続から変更されています。中間者攻撃の可能性があります。',
    host: 'ホスト:',
    keyType: '鍵の種類:',
    fingerprint: 'フィンガープリント:',
    reject: '拒否',
    acceptOnce: '今回のみ受け入れる',
    acceptRemember: '受け入れて記憶する',
  },
  systemPrompt: {
    ariaLabel: 'システムプロンプトビューア',
    // {{persona}} が挿入されます。
    title: 'システムプロンプト — {{persona}}',
  },
  iapVmStart: {
    title: 'GCE VM を起動しますか？',
    // <0>{{status}}</0> は <Trans> で現在のステータスを <strong> で囲みます。
    message:
      '対象の VM は現在 <0>{{status}}</0> です。IAP 接続を続行するために今すぐ起動しますか？',
    instance: 'インスタンス:',
    project: 'プロジェクト:',
    zone: 'ゾーン:',
    startVm: 'VM を起動',
  },
  // 一括配置。フォルダ配下のホストを NetBox のプレフィクスに照合し、
  // 何が動くかを見せてから、チェックが残っているものだけを動かす。
  moveByPrefix: {
    title: 'IP レンジで振り分け',
    // {{name}} は右クリックしたフォルダ。ツリー全体のときは別のキーを使う。
    scopeFolder: '{{name}} の中のホスト',
    scopeTree: 'すべてのホスト',
    matchIn: '照合する範囲',
    // {{name}} はフォルダ名、{{count}} はその配下で見つかったプレフィクス数。
    matchScope: '{{name}} 以下（{{count}}）',
    matchTree: 'ツリー全体（{{count}}）',
    scopeHint: '同じプライベートレンジを全拠点で使い回している NetBox では、照合範囲を絞るのが唯一の逃げ道です。',
    willMove: '移動する（{{count}}）',
    alreadyPlaced: 'すでに正しいフォルダにある（{{count}}）',
    ambiguous: '複数のフォルダが主張している（{{count}}）',
    ambiguousHint: '触りません。同じレンジを主張するフォルダ同士を HoTTY は選び分けません。手で動かすか、NetBox 側の重複を直してください。',
    unmatched: '一致しない（{{count}}）',
    reasonNotAnAddress: 'IP アドレスではありません',
    reasonNoMatch: 'どのプレフィクスにも入りません',
    // {{from}} は今のフォルダ、{{to}} は移動先。
    moveRow: '{{from}} → {{to}}',
    topLevel: '最上位',
    noPrefixes: 'NetBox のプレフィクスを持つフォルダがまだありません。自動配置をオンにしてから NetBox と同期してください。',
    nothingToDo: 'すべてのホストが、アドレスの示すとおりの場所にあります。',
    apply: '{{count}} 件を移動',
    cancel: 'キャンセル',
    // 適用後に出す。
    moved_one: '{{count}} 件のホストを移動しました',
    moved_other: '{{count}} 件のホストを移動しました',
  },
  saveToHostTree: {
    title: 'ホストツリーに保存',
    unsupported:
      'このセッションは保存できません（SSH と Telnet のセッションのみ対応しています）。',
    nameLabel: '名前',
    folderLabel: 'フォルダ',
    rootFolder: '(ルート)',
    newFolderPlaceholder: '新しいフォルダ名',
    create: '作成',
    newFolder: '+ 新しいフォルダ',
    // NetBox のプレフィクスによる配置提案。フォルダ一覧の上に出す。
    // 提案されたフォルダは最初から選ばれているので、変えるのは別の行を 1 回押すだけ。
    netboxSuggested: 'NetBox で {{prefix}} を含むフォルダを選びました。',
    netboxAmbiguous: '{{prefix}} を含む NetBox フォルダが複数あるため、選んでいません: {{folders}}',
  },
};
