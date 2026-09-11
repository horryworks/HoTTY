// Modal dialogs — confirmation, paste, SSH host key, system prompt,
// Ask AI, IAP VM start, and Save-to-Host-Tree. Grouped one key block per dialog.
export const dialogs = {
  closeAiWindow: {
    title: 'AI Chat 닫기',
    message_one: '이 창을 닫으면 대화 {{count}}개가 끝납니다.',
    message_other: '이 창을 닫으면 대화 {{count}}개가 끝납니다.',
    workers_one: 'AI가 연 터미널 {{count}}개도 함께 끊습니다.',
    workers_other: 'AI가 연 터미널 {{count}}개도 함께 끊습니다.',
    hint: '남기려면 «되돌리기»를 사용하세요.',
    confirmLabel: '닫기',
  },
  confirm: {
    title: '확인',
    // Default confirm-button label when a caller does not pass one.
    confirmLabel: '삭제',
  },
  paste: {
    header: '붙여넣기 확인',
    newlineWarning: '⚠️ 경고: 줄 바꿈 문자가 포함되어 있습니다',
    paste: '붙여넣기',
  },
  sshHostKey: {
    titleChanged: '호스트 키가 변경됨',
    titleUnknown: '알 수 없는 호스트 키',
    warning:
      '경고: 이 서버의 호스트 키가 마지막 연결 이후 변경되었습니다. 이는 중간자(MITM) 공격의 징후일 수 있습니다.',
    host: '호스트:',
    keyType: '키 유형:',
    fingerprint: '지문:',
    reject: '거부',
    acceptOnce: '한 번만 허용',
    acceptRemember: '허용 및 기억',
  },
  systemPrompt: {
    ariaLabel: '시스템 프롬프트 뷰어',
    // {{persona}} is interpolated.
    title: '시스템 프롬프트 — {{persona}}',
  },
  iapVmStart: {
    title: 'GCE VM을 시작하시겠습니까?',
    // <0>{{status}}</0> wraps the current status in a <strong> via <Trans>.
    message:
      '대상 VM이 현재 <0>{{status}}</0> 상태입니다. IAP 연결을 계속하려면 지금 시작하시겠습니까?',
    instance: '인스턴스:',
    project: '프로젝트:',
    zone: '영역:',
    startVm: 'VM 시작',
  },
  moveByPrefix: {
    title: 'IP 대역으로 분류',
    scopeFolder: '{{name}} 안의 호스트',
    scopeTree: '모든 호스트',
    matchIn: '대조 범위',
    matchScope: '{{name}} 이하 ({{count}})',
    matchTree: '트리 전체 ({{count}})',
    scopeHint: '모든 사이트에서 같은 사설 대역을 재사용하는 NetBox에서는 범위를 좁히는 것이 유일한 해결책입니다.',
    willMove: '이동할 항목 ({{count}})',
    alreadyPlaced: '이미 올바른 폴더에 있음 ({{count}})',
    ambiguous: '여러 폴더가 주장함 ({{count}})',
    ambiguousHint: '건드리지 않습니다. 같은 대역을 주장하는 폴더 사이에서 HoTTY는 고르지 않습니다. 직접 옮기거나 NetBox에서 중복을 정리하세요.',
    unmatched: '일치 없음 ({{count}})',
    reasonNotAnAddress: 'IP 주소가 아님',
    reasonNoMatch: '어떤 프리픽스에도 속하지 않음',
    moveRow: '{{from}} → {{to}}',
    topLevel: '최상위',
    noPrefixes: '아직 NetBox 프리픽스를 가진 폴더가 없습니다. 자동 배치를 켜고 NetBox와 동기화하세요.',
    nothingToDo: '모든 호스트가 이미 주소대로의 위치에 있습니다.',
    apply: '{{count}}개 이동',
    cancel: '취소',
    moved: '호스트 {{count}}개를 옮겼습니다',
  },
  saveToHostTree: {
    title: '호스트 트리에 저장',
    unsupported:
      '이 세션은 저장할 수 없습니다 (SSH 및 Telnet 세션만 지원됩니다).',
    nameLabel: '이름',
    folderLabel: '폴더',
    rootFolder: '(루트)',
    newFolderPlaceholder: '새 폴더 이름',
    create: '만들기',
    newFolder: '+ 새 폴더',
    netboxSuggested: 'NetBox에서 {{prefix}}를 포함하는 폴더를 선택했습니다.',
    netboxAmbiguous: '{{prefix}}를 포함하는 NetBox 폴더가 여러 개라 선택하지 않았습니다: {{folders}}',
  },
};
