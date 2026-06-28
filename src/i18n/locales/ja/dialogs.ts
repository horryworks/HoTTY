// モーダルダイアログ — 確認・保存/破棄・貼り付け・SSHホスト鍵・システムプロンプト・
// AIへの質問・IAP VM起動・ホストツリーへの保存。ダイアログごとにキーをまとめています。
export const dialogs = {
  confirm: {
    title: '確認',
    // 呼び出し元がラベルを渡さない場合の既定の確認ボタンラベル。
    confirmLabel: '削除',
  },
  saveConfirm: {
    heading: '未保存の変更',
    // {{filename}} は <Trans> で専用スタイルの span として表示されます。
    body: '<0>{{filename}}</0> に未保存の変更があります。閉じる前に保存しますか？',
    dontSave: '保存しない',
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
  },
};
