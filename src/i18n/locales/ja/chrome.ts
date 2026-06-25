// アプリのクローム（タブバー・サイドバー・アプリサイドバーのレイアウト/端/
// ユーティリティボタン）。リージョンごとにキーブロックを分けています。
export const chrome = {
  tabBar: {
    newSession: '新規セッション',
    closeTab: 'タブを閉じる',
    features: 'その他',
    aiMonitorActive: 'AIモニター（実行中）',
    aiMonitorStart: 'AIで監視',
    aiMonitorStopAria: 'AI監視を停止',
    aiMonitorStartAria: 'AI監視を開始',
    logViewer: 'ログビューア',
    pingMonitor: 'Pingモニター',
    textEditor: 'テキストエディター',
    fileExplorer: 'ファイルエクスプローラー',
    aiChat: 'AIチャット',
    saveToHostTree: 'ホストツリーに保存…',
  },
  appSidebar: {
    layout: {
      single: '単一（1x1）',
      splitVertical: '垂直分割（1x2）',
      splitHorizontal: '水平分割（2x1）',
      grid2x2: 'グリッド（2x2）',
      grid2x3: 'グリッド（2x3）',
      grid3x2: 'グリッド（3x2）',
    },
    edge: {
      left: '左サイドバーを切り替え',
      right: '右サイドバーを切り替え',
      top: '上バーを切り替え',
      bottom: '下バーを切り替え',
    },
    disableLineWrap: '行の折り返しを無効化',
    enableLineWrap: '行の折り返しを有効化',
    help: 'ヘルプ / ドキュメント',
    settings: '設定',
  },
  pane: {
    crashed: 'ペインがクラッシュしました',
    label: 'ペイン {{number}}',
    dropTabHere: 'ここにタブをドロップ',
  },
};
