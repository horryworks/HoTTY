// Notifications & overlays — transient app-level UI (error toasts, connecting
// overlay, update banner, crash fallback). English is the source of truth; values
// are byte-identical to the in-component literals they replace.
export const notifications = {
  error: {
    dismiss: '오류 알림 닫기',
  },
  connecting: {
    label: '연결 중',
  },
  update: {
    titleAvailable: '새 버전 사용 가능: v{{version}}',
    prereleaseSuffix: ' (사전 릴리스)',
    running: '현재 v{{version}}을(를) 사용 중입니다',
    viewRelease: '릴리스 보기',
    dismiss: '닫기',
    dismissAria: '업데이트 알림 닫기',
  },
  errorBoundary: {
    title: '문제가 발생했습니다',
    reload: '새로 고침',
    dismiss: '닫기',
  },
};
