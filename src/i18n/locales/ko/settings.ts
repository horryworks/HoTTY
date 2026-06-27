// Settings modal — shell, tab labels, and all tab content.
export const settings = {
  title: '설정',
  tabs: {
    general: '일반',
    appearance: '모양',
    protocols: '프로토콜',
    features: '기능',
    ai: 'AI',
    about: '정보',
  },
  general: {
    // Language selector (this step)
    languageSection: '언어',
    languageLabel: '표시 언어',
    languageHelp:
      '앱 인터페이스의 언어를 변경합니다. (AI 응답 언어는 AI 채팅 패널에서 별도로 설정합니다.)',
    // Logging
    loggingSection: '로깅',
    enableLogging: '로깅 사용',
    logFolderPath: '로그 폴더 경로',
    logFolderPathHelp: '로그는 YYYYMMDDHHMMSS-(프로토콜)-(IP).txt 형식으로 저장됩니다',
    logFolderPathPlaceholder: '폴더를 선택하거나 경로를 입력하세요...',
    // Terminal
    terminalSection: '터미널',
    scrollbackBuffer: '스크롤백 버퍼',
    scrollbackHelp: '터미널당 메모리에 유지할 최대 줄 수 (기본값: 10000).',
    enableLineWrap: '줄 바꿈 사용',
    // Input
    inputSection: '입력',
    backspaceSendsDel: 'Backspace가 DEL(0x7F) 전송',
    backspaceSendsDelHelp:
      '사용 안 함으로 설정하면 Backspace가 0x08(BS)을 전송합니다. 서버가 0x7F를 예상하는 경우 사용하세요.',
    rightClickPaste: '마우스 오른쪽 버튼으로 붙여넣기',
    rightClickPasteHelp: '터미널에서 마우스 오른쪽 버튼을 클릭하면 붙여넣기 확인 대화 상자가 표시됩니다.',
    // Diagnostics
    diagnosticsSection: '진단',
    debugLog: '디버그 로그',
    debugLogHelp: '버그를 보고할 때 최신 로그 파일을 공유하세요.',
    openDebugLogFolder: '디버그 로그 폴더 열기',
  },
  appearance: {
    // Layout
    layoutSection: '레이아웃',
    sidebarPosition: '사이드바 위치',
    sidebarLeft: '왼쪽',
    sidebarRight: '오른쪽',
    // Theme
    themeSection: '테마',
    themeLabel: '테마',
    deleteTheme: '삭제',
    createCustomTheme: '사용자 지정 테마 만들기',
    deleteThemeTitle: '테마 삭제',
    deleteThemeMessage:
      '사용자 지정 테마 "{{name}}"을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',
    // Unused pane background
    unusedPaneBackground: '사용하지 않는 창 배경',
    paneBackgroundColor: '색상',
    paneBackgroundImage: '이미지',
    paneBackgroundImagePlaceholder: '예: http://asset.localhost/...',
    browse: '찾아보기…',
    clearImage: '이미지 지우기',
    clear: '지우기',
    // Font
    fontSection: '글꼴',
    fontFamily: '글꼴 모음',
    systemMonospaceDefault: '시스템 고정폭 (기본값)',
    scanning: '검색 중...',
    rescan: '다시 검색',
    fontSize: '글꼴 크기 (px)',
    // Terminal Display
    terminalDisplaySection: '터미널 표시',
    defaultEncoding: '기본 인코딩',
    defaultEncodingHelp: '새 연결에 적용됩니다.',
    promptHighlight: '프롬프트 강조',
    enableUserInputHighlight: '사용자 입력 강조 사용',
    highlightColor: '강조 색상',
    promptPatternsRegex: '프롬프트 패턴 (정규식)',
    namePlaceholder: '이름',
    regexPlaceholder: '정규식',
    addPattern: '+ 패턴 추가',
    resetToDefault: '기본값으로 초기화',
  },
  protocols: {
    // SSH
    sshSection: 'SSH',
    connectTimeout: '연결 시간 초과',
    timeoutSeconds: '시간 초과 (초)',
    sshTimeoutHelp:
      '초기 TCP 및 SSH 핸드셰이크를 포기하기 전까지 대기할 최대 시간입니다. 기본값: 5초.',
    keepAlive: 'KeepAlive',
    enable: '사용',
    sshKeepAliveHelp: '시간 초과를 방지하기 위해 더미 패킷을 전송합니다.',
    intervalSeconds: '간격 (초)',
    // Algorithms
    algorithms: '알고리즘',
    algorithmsHelp: '사용할 알고리즘을 선택하세요. 변경 사항은 새 세션에 적용됩니다.',
    categoryServerHostKey: '서버 호스트 키',
    categoryKex: '키 교환',
    categoryCipher: '암호화',
    categoryMac: 'MAC',
    // Telnet
    telnetSection: 'Telnet',
    telnetTimeoutHelp:
      '초기 TCP 연결을 포기하기 전까지 대기할 최대 시간입니다. 기본값: 5초.',
    telnetKeepAliveHelp: '유휴 시간 초과를 방지하기 위해 Telnet NOP 명령을 전송합니다.',
    // DH-GEX SHA-1 warning
    dhGexTitle: 'diffie-hellman-group-exchange-sha1을 사용하시겠습니까?',
    dhGexConfirm: '사용',
    dhGexWarning:
      'diffie-hellman-group-exchange-sha1은 손상된 것으로 간주되는 SHA-1에 의존하며 ' +
      'OpenSSH 8.2에서 기본값에서 제거되었습니다. 더 강력한 키 교환을 제공하지 않는 ' +
      '레거시 장치와 통신해야 하는 경우에만 사용하세요.\n\n' +
      '원격 장치가 지원하는 경우 diffie-hellman-group-exchange-sha256, diffie-hellman-group14-sha256, ' +
      '또는 curve25519-sha256을 사용하는 것이 좋습니다.\n\n' +
      '그래도 diffie-hellman-group-exchange-sha1을 사용하시겠습니까?',
  },
  features: {
    fileServerLabel: '파일 서버',
    fileServerDescription: '네트워크 장비에 펌웨어를 업로드하기 위한 TFTP / SFTP 서버',
    webBrowserLabel: '웹 브라우저',
    webBrowserDescription: '네트워크 장비 웹 관리 UI를 위한 내장 브라우저 창',
    section: '기능',
    sectionHelp: '기능 창을 사용하거나 사용 안 함으로 설정합니다. 이미 열려 있는 창에는 영향을 미치지 않습니다.',
    aiChatLabel: 'AI 채팅',
    aiChatDescription: '터미널 지원을 위한 AI 기반 채팅 패널',
    logViewerLabel: '로그 뷰어',
    logViewerDescription: '세션 로그 보기 및 분석',
    pingMonitorLabel: 'Ping 모니터',
    pingMonitorDescription: '지속적인 ICMP ping 모니터링',
    textEditorLabel: '텍스트 편집기',
    textEditorDescription: '내장 텍스트 파일 편집기',
    fileExplorerLabel: '파일 탐색기',
    fileExplorerDescription: '파일 찾아보기 및 관리',
  },
  ai: {
    // Provider
    providerSection: '공급자',
    aiProvider: 'AI 공급자',
    aiProviderHelp:
      'Vertex AI와 Gemini는 Google OAuth를 사용합니다. Anthropic과 OpenAI는 API 키가 필요합니다.',
    providerVertexAi: 'Google Cloud Vertex AI',
    providerGemini: 'Google AI Studio (Gemini)',
    providerAnthropic: 'Anthropic (Claude)',
    providerOpenai: 'OpenAI',
    // Authentication
    authentication: '인증',
    authenticated: '인증됨',
    notAuthenticated: '인증되지 않음',
    logout: '로그아웃',
    // Personas
    personasSection: '페르소나',
    addPersona: '페르소나 추가',
    personaName: '페르소나 이름',
    displayNamePlaceholder: '표시 이름',
    systemPrompt: '시스템 프롬프트',
    systemPromptPlaceholder: '시스템 프롬프트',
    askAiCommands: 'AI 질문 명령',
    dragToReorder: '드래그하여 순서 변경',
    labelPlaceholder: '레이블',
    promptTemplatePlaceholder: '프롬프트 템플릿 ({selection}이 대체됩니다)',
    promptTemplateHelp: '선택한 텍스트에 {selection} 자리 표시자를 사용하세요.',
    addCommand: '+ 명령 추가',
    resetCommands: '명령 초기화',
    deletePersona: '페르소나 삭제',
    atLeastOnePersona: '최소 하나의 페르소나가 필요합니다',
    deletePersonaTitle: '"{{label}}" 삭제',
    resetAllPersonas: '모든 페르소나 초기화',
    newPersonaLabel: '새 페르소나',
    newCommandLabel: '새 명령',
    // Command Execution
    commandExecutionSection: '명령 실행',
    commandExecutionHelp:
      '실행 모드와 자동 실행 한도는 AI 채팅 창(메시지 입력란 아래)에서 구성합니다.',
    commandSafetyClassifier: '명령 안전성 분류기',
    commandSafetyClassifierHelp:
      'AI가 제안한 명령을 자동으로 실행할지 HoTTY가 결정하는 방식입니다. 블랙리스트가 항상 먼저 확인됩니다(일치하면 실행 전에 확인을 요청합니다). 정적: 화이트리스트는 자동 실행되고 그 외 모든 것은 확인을 요청합니다. AI: 블랙리스트에 없는 항목을 AI가 판단합니다. 하이브리드(권장): 화이트리스트는 자동 실행되고, 나머지는 AI가 판단하며, 그렇지 않으면 확인을 요청합니다.',
    classifierStatic: '정적 화이트리스트',
    classifierAi: 'AI 판단',
    classifierHybrid: '하이브리드 (권장)',
    aiConfidenceThreshold: 'AI 신뢰도 임계값: {{percent}}%',
    aiConfidenceThresholdHelp:
      '읽기 전용으로 판단된 명령을 자동 실행하는 데 필요한 최소 AI 신뢰도입니다. 이 값 미만이면 명령이 수동 실행을 기다립니다. 높을수록 더 신중합니다. 기본값: 70%.',
    deviceResponseTimeout: '장치 응답 시간 초과 (초)',
    deviceResponseTimeoutHelp:
      '명령 실행 후 이 초 동안 장치에서 새 출력이 생성되지 않으면, 루프를 계속할 수 있도록 AI에게 장치가 응답을 멈췄다고 알립니다. 0이면 유휴 감지를 사용 안 함으로 설정합니다. 기본값: 10.',
    sleepAsClientDelay: '선행 `sleep`을 클라이언트 측 지연으로 실행',
    sleepAsClientDelayHelp:
      'AI가 `sleep N`으로 시작하는 명령(예: `sleep 120 && validate`)을 실행할 때, 장치에서 sleep을 실행하는 대신 HoTTY에서 N초를 대기합니다. 이렇게 하면 위의 장치 응답 시간 초과가 sleep 중에 잘못 작동하지 않습니다. 연결된 명령은 대기 후에 실행됩니다. 기본값: 켜짐.',
    maxClientDelay: '최대 클라이언트 측 지연 (초)',
    maxClientDelayHelp:
      '클라이언트 측 sleep 지연의 상한선입니다. 더 긴 sleep은 이 값으로 제한되며 표시됩니다. 0 = 제한 없음. 기본값: 900 (15분).',
    whitelist: '화이트리스트 (자동 실행)',
    whitelistHelp:
      "여기에서 일치하는 명령은 자동 실행됩니다. 단일 단어는 기본 명령으로 일치하며(예: 'docker'는 모든 docker 명령과 일치), 공백이 있는 항목은 부분 문자열로 일치합니다(예: 'git log'). 안전한 기본값으로 시드되며, 완전히 편집할 수 있습니다.",
    whitelistPlaceholder: '예: docker, kubectl get',
    add: '추가',
    resetToDefaults: '기본값으로 초기화',
    resetWhitelistTitle: '화이트리스트를 내장 기본값으로 초기화',
    removeEntry: '{{cmd}} 제거',
    blacklist: '블랙리스트 (실행 전 확인)',
    blacklistHelp:
      "여기에서 일치하는 명령은 절대 자동 실행되지 않습니다. 경고와 함께 수동 실행은 여전히 허용됩니다. 단일 단어는 기본 명령으로 일치하며, 공백이 있는 항목은 부분 문자열로 일치합니다(예: 'rm -rf', 'git push'). 파괴적인 기본값으로 시드되며, 완전히 편집할 수 있습니다.",
    blacklistPlaceholder: '예: rm -rf, git push',
    resetBlacklistTitle: '블랙리스트를 내장 기본값으로 초기화',
    // Modals
    privacyNoticeTitle: '개인정보 보호 고지',
    privacyNoticeMessage:
      'Google AI Studio (Gemini)는 무료 등급에서 사용자의 데이터를 AI 학습에 사용할 수 있습니다. 이를 거부하려면 Google Cloud 프로젝트에서 결제를 사용하도록 설정하세요.',
    privacyNoticeConfirm: '확인',
    logoutTitle: '로그아웃',
    logoutMessage:
      '로그아웃하시겠습니까? AI 공급자를 사용하려면 다시 인증해야 합니다.',
    logoutConfirm: '로그아웃',
  },
  about: {
    version: 'v{{version}}',
    author: 'Katsumasa "Horry" Horiuchi',
    descriptionLine1: 'SSH/Telnet/시리얼 터미널 에뮬레이터',
    descriptionLine2: 'Tauri, React 및 TypeScript로 제작',
    licenseLine1: '이 프로그램은 다음 라이선스로 배포되는 자유 소프트웨어입니다',
    licenseLine2: 'GNU General Public License v3.0 또는 이후 버전.',
    viewLicense: 'GNU General Public License v3.0 보기',
    logoAlt: 'HoTTY 로고',
  },
  customTheme: {
    title: '사용자 지정 테마 만들기',
    cancel: '취소',
    themeName: '테마 이름',
    themeNamePlaceholder: '예: My Dark Blue',
    baseTheme: '기본 테마',
    saveTheme: '테마 저장',
    saving: '저장 중...',
    terminalSectionTitle: '터미널',
    terminalSectionDesc: 'xterm.js 터미널 색상',
    // Validation
    errorEmptyName: '테마 이름을 입력하세요.',
    errorNoAlphanumeric: '테마 이름에는 영숫자 문자가 하나 이상 포함되어야 합니다.',
    errorProtectedName: '"dark", "medium", "light"는 테마 이름으로 사용할 수 없습니다.',
    errorSaveFailed: '테마를 저장하지 못했습니다.',
    // Section titles & descriptions
    sectionBackgroundsTitle: '배경 및 텍스트',
    sectionBackgroundsDesc: '기본 배경 및 텍스트 색상',
    sectionBordersTitle: '테두리 및 강조',
    sectionBordersDesc: '테두리 색상과 강조/하이라이트 색상',
    sectionInputsTitle: '입력란, 버튼 및 호버',
    sectionInputsDesc: '입력 필드, 버튼 및 호버 상태 색상',
    sectionStatusTitle: '상태 및 신호',
    sectionStatusDesc: '성공, 오류, 경고 및 위험 표시기 색상',
    sectionAiChatTitle: 'AI 채팅',
    sectionAiChatDesc: 'AI 채팅 메시지 및 코드 블록 색상',
    sectionUiTitle: 'UI 특정 구성 요소',
    sectionUiDesc: '사이드바, 탭, 컨텍스트 메뉴, 아이콘 및 기타 UI 요소',
    sectionProvidersTitle: 'AI 공급자',
    sectionProvidersDesc:
      'AI 공급자 아이콘에 사용되는 브랜드 색상 (Gemini, OpenAI, Anthropic, Vertex AI)',
    sectionSearchTitle: '검색 및 강조',
    sectionSearchDesc: '검색 결과 강조 색상',
    sectionOverlaysTitle: '오버레이 및 모달',
    sectionOverlaysDesc: '모달 대화 상자, 오버레이 및 알림 배너',
    sectionEffectsTitle: '미래지향적 효과',
    sectionEffectsDesc:
      '활성 창, 사이드바 및 모달에 적용되는 네온 글로우 및 글래스모피즘 효과',
    // Terminal color rows
    terminalForeground: '전경',
    terminalForegroundDesc: '터미널 내부의 기본 텍스트 색상',
    terminalBackground: '배경 (활성)',
    terminalBackgroundDesc: '활성/포커스된 터미널의 배경',
    terminalBackgroundInactive: '배경 (비활성)',
    terminalBackgroundInactiveDesc: '비활성/포커스되지 않은 터미널의 배경',
    terminalPaneBackground: '창 배경',
    terminalPaneBackgroundDesc: '터미널을 둘러싼 공간의 색상',
  },
};
