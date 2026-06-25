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
  errorBoundary: {
    title: '問題が発生しました',
    reload: '再読み込み',
    dismiss: '閉じる',
  },
};
