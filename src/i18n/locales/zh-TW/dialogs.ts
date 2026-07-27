// 強制回應對話方塊 — 確認、貼上、SSH 主機金鑰、系統提示詞、
// 詢問 AI、IAP VM 啟動，以及儲存至主機樹狀清單。每個對話方塊對應一個鍵區塊。
export const dialogs = {
  confirm: {
    title: '確認',
    // 呼叫端未傳入時的預設確認按鈕標籤。
    confirmLabel: '刪除',
  },
  paste: {
    header: '貼上確認',
    newlineWarning: '⚠️ 警告：內容含有換行字元',
    paste: '貼上',
  },
  sshHostKey: {
    titleChanged: '主機金鑰已變更',
    titleUnknown: '未知的主機金鑰',
    warning:
      '警告：此伺服器的主機金鑰自上次連線以來已變更。這可能表示遭受中間人攻擊。',
    host: '主機：',
    keyType: '金鑰類型：',
    fingerprint: '指紋：',
    reject: '拒絕',
    acceptOnce: '接受一次',
    acceptRemember: '接受並記住',
  },
  systemPrompt: {
    ariaLabel: '系統提示詞檢視器',
    // {{persona}} 會被插值。
    title: '系統提示詞 — {{persona}}',
  },
  iapVmStart: {
    title: '要啟動 GCE VM 嗎？',
    // <0>{{status}}</0> 透過 <Trans> 將目前狀態包在 <strong> 中。
    message:
      '目標 VM 目前為 <0>{{status}}</0>。是否立即啟動以繼續 IAP 連線？',
    instance: '執行個體：',
    project: '專案：',
    zone: '區域：',
    startVm: '啟動 VM',
  },
  saveToHostTree: {
    title: '儲存至主機樹狀清單',
    unsupported:
      '無法儲存此工作階段（僅支援 SSH 與 Telnet 工作階段）。',
    nameLabel: '名稱',
    folderLabel: '資料夾',
    rootFolder: '（根目錄）',
    newFolderPlaceholder: '新資料夾名稱',
    create: '建立',
    newFolder: '+ 新資料夾',
  },
};
