// Modal dialogs — confirmation, paste, SSH host key, system prompt,
// Ask AI, IAP VM start, and Save-to-Host-Tree. Grouped one key block per dialog.
export const dialogs = {
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
  },
};
