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
  // Toast text for logError() call sites. logError pushes into the error
  // notification store, so every literal handed to it is user-facing UI and
  // must be a key here rather than an inline string.
  errors: {
    aiChatSendFailed: 'AI 요청을 보내지 못했습니다',
    aiChatLogDisabled: 'AI 채팅 로깅이 비활성화되었습니다',
    aiCredentialEncrypt: 'AI 자격 증명을 암호화하지 못했습니다',
    aiSignInStart: '로그인을 시작하지 못했습니다',
    aiLogout: '로그아웃에 실패했습니다',
    aiAutoAuth: '자동 로그인에 실패했습니다',
    aiAuthListener: '로그인 결과를 수신하지 못했습니다',
    aiLogoutListener: '로그아웃 이벤트를 수신하지 못했습니다',
    aiResponseListener: 'AI 응답을 수신하지 못했습니다',
    iapVmPromptListen: 'VM 시작 확인을 수신하지 못했습니다',
    iapVmPromptRespond: 'VM 시작 확인에 응답하지 못했습니다',
    sshHostKeyListen: 'SSH 호스트 키 확인을 수신하지 못했습니다',
    browserPaneCreate: '웹 브라우저 창을 열지 못했습니다',
    browserNavigate: '페이지를 열지 못했습니다',
    browserClearData: '인터넷 사용 기록을 지우지 못했습니다',
    trafficSettingsRestore: '트래픽 창 설정을 복원하지 못했습니다',
    trafficListener: '트래픽 이벤트를 수신하지 못했습니다',
    pingMonitorListener: 'Ping 모니터 이벤트를 수신하지 못했습니다',
    fileServerListener: '파일 서버 이벤트를 수신하지 못했습니다',
    credentialBatch: '{{label}} 자격 증명을 처리하지 못했습니다',
    hostTreeEncrypt: '호스트 트리를 암호화하지 못했습니다',
    credentialMigration: '자격 증명 마이그레이션에 실패했습니다',
    credentialPreload: '백그라운드 자격 증명 복호화에 실패했습니다',
    sessionLoggingUpdate: '세션 로깅을 업데이트하지 못했습니다',
    sessionListener: '세션 이벤트를 수신하지 못했습니다',
    clipboardCopy: '선택 영역을 복사하지 못했습니다',
  },
  errorBoundary: {
    title: '문제가 발생했습니다',
    reload: '새로 고침',
    dismiss: '닫기',
  },
};
