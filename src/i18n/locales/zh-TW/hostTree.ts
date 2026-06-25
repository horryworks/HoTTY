// 主機樹狀清單側邊欄 — 工具列、操作功能表、新連線虛擬列、空白狀態提示、
// 新增／編輯／匯出／匯入對話方塊、刪除確認，以及成功／失敗的通知訊息。
export const hostTree = {
  toolbar: {
    addFolder: '新增資料夾',
    addHost: '新增主機',
    exportTree: '匯出樹狀清單',
    importTree: '匯入樹狀清單',
  },
  newConnection: '新連線',
  newConnectionTitle: '開始新連線（清除表單）',
  empty: '在上方按右鍵或使用 + 按鈕來新增主機與資料夾',
  contextMenu: {
    addFolder: '新增資料夾',
    addHost: '新增主機',
    rename: '重新命名（F2）',
    export: '匯出',
    import: '匯入',
    sortAscending: '遞增排序',
  },
  modal: {
    renameFolder: '重新命名資料夾',
    addFolder: '新增資料夾',
    editHost: '編輯主機',
    addHost: '新增主機',
    exportTitle: '匯出主機樹狀清單',
    importTitle: '匯入主機樹狀清單',
    displayName: '顯示名稱',
    setEncryptionPassword: '設定加密密碼：',
    enterDecryptionPassword: '輸入解密密碼：',
    exportPasswordHint: '稍後匯入此檔案時將需要這組密碼。',
    importPasswordHint: '請輸入匯出此檔案時所使用的密碼。',
    protocol: '通訊協定',
    useAsJumpbox: '作為跳板主機使用',
    hostLabel: '主機／IP',
    hostPlaceholder: '192.168.1.1',
    portLabel: '連接埠',
    usernameLabel: '使用者名稱',
    passwordLabel: '密碼',
    export: '匯出',
    import: '匯入',
  },
  delete: {
    titleFolder: '刪除資料夾',
    titleHost: '刪除主機',
    // {{name}} 為節點顯示名稱。{{warning}} 僅在主機被當作跳板主機參照時附加
    //（見下方 jumpboxWarning）；否則為空字串。
    message: '確定要刪除「{{name}}」嗎？\n此動作無法復原。{{warning}}',
    // {{count}} 為主機數量，{{names}} = 以逗號連接的主機名稱清單。
    jumpboxWarning:
      '\n\n此主機被 {{count}} 台主機作為跳板主機使用：{{names}}。這些主機的跳板主機設定將會被清除。',
  },
  messages: {
    importErrorTitle: '匯入錯誤',
    // {{error}} 為底層錯誤文字。
    importErrorBody: '無法開啟檔案：{{error}}',
    exportSuccessTitle: '匯出成功',
    exportSuccessBody: '主機樹狀清單已成功匯出。',
    exportFailedTitle: '匯出失敗',
    importSuccessTitle: '匯入成功',
    importSuccessBody: '主機已成功匯入。',
    // {{folderName}} 為產生的「Imported_<file>」資料夾名稱。
    importSuccessIntoFolder: '主機已匯入並新增至「{{folderName}}」資料夾。',
    importFailedTitle: '匯入失敗',
  },
};
