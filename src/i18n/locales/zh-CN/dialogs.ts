// Modal dialogs — confirmation, paste, SSH host key, system prompt,
// Ask AI, IAP VM start, and Save-to-Host-Tree. Grouped one key block per dialog.
export const dialogs = {
  closeAiWindow: {
    title: '关闭 AI Chat',
    message_one: '关闭此窗口将结束 {{count}} 个对话。',
    message_other: '关闭此窗口将结束 {{count}} 个对话。',
    workers_one: 'AI 打开的 {{count}} 个终端也会断开。',
    workers_other: 'AI 打开的 {{count}} 个终端也会断开。',
    hint: '想保留的话，请改用「移回」。',
    confirmLabel: '关闭',
  },
  confirm: {
    title: '确认',
    // Default confirm-button label when a caller does not pass one.
    confirmLabel: '删除',
  },
  paste: {
    header: '粘贴确认',
    newlineWarning: '⚠️ 警告：包含换行符',
    paste: '粘贴',
  },
  sshHostKey: {
    titleChanged: '主机密钥已更改',
    titleUnknown: '未知的主机密钥',
    warning:
      '警告：此服务器的主机密钥自上次连接以来已发生变化。这可能表示存在中间人攻击。',
    host: '主机：',
    keyType: '密钥类型：',
    fingerprint: '指纹：',
    reject: '拒绝',
    acceptOnce: '仅本次接受',
    acceptRemember: '接受并记住',
  },
  systemPrompt: {
    ariaLabel: '系统提示词查看器',
    // {{persona}} is interpolated.
    title: '系统提示词 — {{persona}}',
  },
  iapVmStart: {
    title: '启动 GCE 虚拟机？',
    // <0>{{status}}</0> wraps the current status in a <strong> via <Trans>.
    message:
      '目标虚拟机当前处于 <0>{{status}}</0> 状态。是否立即启动它以继续 IAP 连接？',
    instance: '实例：',
    project: '项目：',
    zone: '区域：',
    startVm: '启动虚拟机',
  },
  moveByPrefix: {
    title: '按 IP 网段归类',
    scopeFolder: '{{name}} 中的主机',
    scopeTree: '所有主机',
    matchIn: '匹配范围',
    matchScope: '{{name}} 及其下级（{{count}}）',
    matchTree: '整棵树（{{count}}）',
    scopeHint: '当 NetBox 在每个站点重复使用同一段私有地址时，缩小匹配范围是唯一的办法。',
    willMove: '将移动（{{count}}）',
    alreadyPlaced: '已在正确的文件夹（{{count}}）',
    ambiguous: '多个文件夹同时声明（{{count}}）',
    ambiguousHint: '保持不动：对声明同一网段的文件夹，HoTTY 不替你选择。请自行移动，或在 NetBox 中修正重叠。',
    unmatched: '无匹配（{{count}}）',
    reasonNotAnAddress: '不是 IP 地址',
    reasonNoMatch: '不在任何前缀内',
    moveRow: '{{from}} → {{to}}',
    topLevel: '顶层',
    noPrefixes: '树中还没有带 NetBox 前缀的文件夹。请打开自动归类后再与 NetBox 同步。',
    nothingToDo: '每台主机都已在其地址所指的位置。',
    apply: '移动 {{count}} 项',
    cancel: '取消',
    moved: '已移动 {{count}} 台主机',
  },
  saveToHostTree: {
    title: '保存到主机树',
    unsupported:
      '无法保存此会话（仅支持 SSH 和 Telnet 会话）。',
    nameLabel: '名称',
    folderLabel: '文件夹',
    rootFolder: '（根目录）',
    newFolderPlaceholder: '新文件夹名称',
    create: '创建',
    newFolder: '+ 新建文件夹',
    netboxSuggested: '已选中 NetBox 中包含 {{prefix}} 的文件夹。',
    netboxAmbiguous: '有多个 NetBox 文件夹包含 {{prefix}}，因此未做选择：{{folders}}',
  },
};
