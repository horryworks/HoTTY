// App chrome — tab bar, sidebars, and the app-level sidebar (layout / edge /
// utility buttons). One key block per chrome region. English is the source of
// truth; values are byte-identical to the in-component literals they replace.
export const chrome = {
  tabBar: {
    fileServer: '파일 서버',
    newSession: '새 세션',
    closeTab: '탭 닫기',
    features: '기능',
    aiMonitorActive: 'AI 모니터링 (활성)',
    aiMonitorStart: 'AI로 모니터링',
    aiMonitorStopAria: 'AI 모니터링 중지',
    aiMonitorStartAria: 'AI 모니터링 시작',
    logViewer: '로그 뷰어',
    pingMonitor: 'Ping 모니터',
    textEditor: '텍스트 편집기',
    fileExplorer: '파일 탐색기',
    aiChat: 'AI 채팅',
    saveToHostTree: '호스트 트리에 저장…',
    watchAi: 'AI로 모니터링',
    stopWatchAi: 'AI 모니터링 중지',
    bookmark: '북마크 추가…',
  },
  appSidebar: {
    layout: {
      single: '단일 (1x1)',
      splitVertical: '세로 분할 (1x2)',
      splitHorizontal: '가로 분할 (2x1)',
      grid2x2: '그리드 (2x2)',
      grid2x3: '그리드 (2x3)',
      grid3x2: '그리드 (3x2)',
    },
    edge: {
      left: '왼쪽 사이드바 전환',
      right: '오른쪽 사이드바 전환',
      top: '상단 바 전환',
      bottom: '하단 바 전환',
    },
    disableLineWrap: '줄 바꿈 사용 안 함',
    enableLineWrap: '줄 바꿈 사용',
    newWindow: '새 창',
    help: '도움말 / 문서',
    settings: '설정',
  },
  pane: {
    crashed: '창이 충돌했습니다',
    label: '창 {{number}}',
    dropTabHere: '여기에 탭 놓기',
  },
};
