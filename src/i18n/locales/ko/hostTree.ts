// Host tree sidebar — toolbar, context menu, the New Connection pseudo-row, the
// empty-state hint, the add/edit/export/import modal, the delete confirmation,
// and the success/failure notification messages.
export const hostTree = {
  toolbar: {
    addFolder: '폴더 추가',
    addHost: '호스트 추가',
    exportTree: '트리 내보내기',
    importTree: '트리 가져오기',
  },
  newConnection: '새 연결',
  newConnectionTitle: '새 연결 시작 (양식을 지웁니다)',
  empty: '마우스 오른쪽 버튼을 클릭하거나 위의 + 버튼을 사용하여 호스트와 폴더를 추가하세요',
  contextMenu: {
    addFolder: '폴더 추가',
    addHost: '호스트 추가',
    rename: '이름 바꾸기 (F2)',
    export: '내보내기',
    import: '가져오기',
    sortAscending: '오름차순 정렬',
  },
  modal: {
    renameFolder: '폴더 이름 바꾸기',
    addFolder: '폴더 추가',
    editHost: '호스트 편집',
    addHost: '호스트 추가',
    exportTitle: '호스트 트리 내보내기',
    importTitle: '호스트 트리 가져오기',
    displayName: '표시 이름',
    setEncryptionPassword: '암호화 비밀번호 설정:',
    enterDecryptionPassword: '복호화 비밀번호 입력:',
    exportPasswordHint: '나중에 파일을 가져오려면 이 비밀번호가 필요합니다.',
    importPasswordHint: '이 파일을 내보낼 때 사용한 비밀번호를 입력하세요.',
    protocol: '프로토콜',
    useAsJumpbox: '점프박스로 사용',
    hostLabel: '호스트/IP',
    hostPlaceholder: '192.168.1.1',
    portLabel: '포트',
    usernameLabel: '사용자 이름',
    passwordLabel: '비밀번호',
    export: '내보내기',
    import: '가져오기',
  },
  delete: {
    titleFolder: '폴더 삭제',
    titleHost: '호스트 삭제',
    // {{name}} is the node display name. {{warning}} is appended only when the
    // host is referenced as a jumpbox (see jumpboxWarning below); empty otherwise.
    message: '"{{name}}"을(를) 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.{{warning}}',
    // {{count}} hosts, {{names}} = comma-joined list of host names.
    jumpboxWarning:
      '\n\n이 호스트는 {{count}}개 호스트의 점프박스로 사용 중입니다: {{names}}. 해당 호스트의 점프박스 설정이 해제됩니다.',
  },
  messages: {
    importErrorTitle: '가져오기 오류',
    // {{error}} is the underlying error text.
    importErrorBody: '파일을 열지 못했습니다: {{error}}',
    exportSuccessTitle: '내보내기 성공',
    exportSuccessBody: '호스트 트리를 성공적으로 내보냈습니다.',
    exportFailedTitle: '내보내기 실패',
    importSuccessTitle: '가져오기 성공',
    importSuccessBody: '호스트를 성공적으로 가져왔습니다.',
    // {{folderName}} is the generated "Imported_<file>" folder name.
    importSuccessIntoFolder: '호스트를 가져와 "{{folderName}}" 폴더에 추가했습니다.',
    importFailedTitle: '가져오기 실패',
  },
};
