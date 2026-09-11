// 強制回應對話方塊 — 確認、貼上、SSH 主機金鑰、系統提示詞、
// 詢問 AI、IAP VM 啟動，以及儲存至主機樹狀清單。每個對話方塊對應一個鍵區塊。
export const dialogs = {
  closeAiWindow: {
    title: '關閉 AI Chat',
    message_one: '關閉此視窗會結束 {{count}} 個對話。',
    message_other: '關閉此視窗會結束 {{count}} 個對話。',
    workers_one: 'AI 開啟的 {{count}} 個終端機也會中斷。',
    workers_other: 'AI 開啟的 {{count}} 個終端機也會中斷。',
    hint: '想保留的話，請改用「移回」。',
    confirmLabel: '關閉',
  },
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
  moveByPrefix: {
    title: '依 IP 網段歸類',
    scopeFolder: '{{name}} 中的主機',
    scopeTree: '所有主機',
    matchIn: '比對範圍',
    matchScope: '{{name}} 及其下層（{{count}}）',
    matchTree: '整棵樹（{{count}}）',
    scopeHint: '當 NetBox 在每個站台重複使用同一段私有位址時，縮小比對範圍是唯一的辦法。',
    willMove: '將移動（{{count}}）',
    alreadyPlaced: '已在正確的資料夾（{{count}}）',
    ambiguous: '多個資料夾同時宣告（{{count}}）',
    ambiguousHint: '維持不動：對宣告同一網段的資料夾，HoTTY 不替你選擇。請自行移動，或在 NetBox 中修正重疊。',
    unmatched: '無相符（{{count}}）',
    reasonNotAnAddress: '不是 IP 位址',
    reasonNoMatch: '不在任何前綴內',
    moveRow: '{{from}} → {{to}}',
    topLevel: '最上層',
    noPrefixes: '樹中還沒有帶 NetBox 前綴的資料夾。請開啟自動歸類後再與 NetBox 同步。',
    nothingToDo: '每台主機都已在其位址所指的位置。',
    apply: '移動 {{count}} 項',
    cancel: '取消',
    moved_one: '已移動 {{count}} 台主機',
    moved_other: '已移動 {{count}} 台主機',
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
    netboxSuggested: '已選取 NetBox 中包含 {{prefix}} 的資料夾。',
    netboxAmbiguous: '有多個 NetBox 資料夾包含 {{prefix}}，因此未做選擇：{{folders}}',
  },
};
