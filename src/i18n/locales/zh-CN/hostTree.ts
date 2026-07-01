// Host tree sidebar — toolbar, context menu, the New Connection pseudo-row, the
// empty-state hint, the add/edit/export/import modal, the delete confirmation,
// and the success/failure notification messages.
export const hostTree = {
  toolbar: {
    addFolder: '添加文件夹',
    addHost: '添加主机',
    exportTree: '导出树',
    importTree: '导入树',
  },
  newConnection: '新建连接',
  newConnectionTitle: '开始新的连接（清空表单）',
  empty: '右键单击或使用上方的 + 按钮添加主机和文件夹',
  contextMenu: {
    openAll: '全部打开',
    addFolder: '添加文件夹',
    addHost: '添加主机',
    rename: '重命名 (F2)',
    export: '导出',
    import: '导入',
    sortAscending: '升序排序',
  },
  openAll: {
    confirmTitle: '打开所有主机',
    // {{count}} = 主机数量, {{name}} = 文件夹名称
    confirmMessage: '打开“{{name}}”中的全部 {{count}} 个主机？',
  },
  modal: {
    renameFolder: '重命名文件夹',
    addFolder: '添加文件夹',
    editHost: '编辑主机',
    addHost: '添加主机',
    exportTitle: '导出主机树',
    importTitle: '导入主机树',
    displayName: '显示名称',
    setEncryptionPassword: '设置加密密码：',
    enterDecryptionPassword: '输入解密密码：',
    exportPasswordHint: '稍后导入此文件时将需要此密码。',
    importPasswordHint: '输入导出此文件时使用的密码。',
    protocol: '协议',
    useAsJumpbox: '用作跳板机',
    hostLabel: '主机/IP',
    hostPlaceholder: '192.168.1.1',
    portLabel: '端口',
    usernameLabel: '用户名',
    passwordLabel: '密码',
    export: '导出',
    import: '导入',
  },
  delete: {
    titleFolder: '删除文件夹',
    titleHost: '删除主机',
    // {{name}} is the node display name. {{warning}} is appended only when the
    // host is referenced as a jumpbox (see jumpboxWarning below); empty otherwise.
    message: '确定要删除“{{name}}”吗？\n此操作无法撤销。{{warning}}',
    // {{count}} hosts, {{names}} = comma-joined list of host names.
    jumpboxWarning:
      '\n\n此主机被 {{count}} 个主机用作跳板机：{{names}}。它们的跳板机设置将被清除。',
  },
  messages: {
    importErrorTitle: '导入错误',
    // {{error}} is the underlying error text.
    importErrorBody: '打开文件失败：{{error}}',
    exportSuccessTitle: '导出成功',
    exportSuccessBody: '主机树已成功导出。',
    exportFailedTitle: '导出失败',
    importSuccessTitle: '导入成功',
    importSuccessBody: '主机已成功导入。',
    // {{folderName}} is the generated "Imported_<file>" folder name.
    importSuccessIntoFolder: '主机已导入并添加到“{{folderName}}”文件夹。',
    importFailedTitle: '导入失败',
  },
};
