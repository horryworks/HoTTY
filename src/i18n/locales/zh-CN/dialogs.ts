// Modal dialogs — confirmation, save/discard, paste, SSH host key, system prompt,
// Ask AI, IAP VM start, and Save-to-Host-Tree. Grouped one key block per dialog.
export const dialogs = {
  confirm: {
    title: '确认',
    // Default confirm-button label when a caller does not pass one.
    confirmLabel: '删除',
  },
  saveConfirm: {
    heading: '未保存的更改',
    // {{filename}} is rendered in its own styled span via <Trans>.
    body: '<0>{{filename}}</0> 有未保存的更改。是否在关闭前保存？',
    dontSave: '不保存',
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
  askAi: {
    title: '询问 AI',
    questionLabel: '您的问题：',
    promptPlaceholder: '您想就所选内容询问什么？（Ctrl+Enter 提问）',
    selectedTextLabel: '所选文本：',
    ask: '提问',
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
  },
};
