// Help & Documentation modal. This is the most prose-heavy surface in the app,
// so most values carry inline markup and are rendered via <Trans> with indexed
// component placeholders (<0>, <1>, …). Keyboard-shortcut KEYS (e.g. "Ctrl + N")
// stay literal in the component; only their descriptions live here. Code
// identifiers, command snippets, file paths, URLs, regex, and protocol/product
// names (SSH, Telnet, WSL, GCP, IAP, gcloud) are intentionally NOT translated.
export const help = {
  title: '帮助与文档',

  shortcuts: {
    summary: '快捷键',
    newSession: '新建会话对话框',
    newWindow: '新建窗口',
    focusNext: '聚焦下一个窗格',
    focusPrev: '聚焦上一个窗格',
    closeTab: '关闭当前标签页',
    clearOrSigint: '清除选择 / 发送 SIGINT',
    paste: '粘贴到终端（带安全检查）',
    sendMessage: '在“询问 AI”对话框中发送消息',
    closeModal: '关闭模态框 / 对话框',
  },

  gettingStarted: {
    summary: '入门',
    openDialog:
      '通过 <0>Ctrl + N</0> 或侧边栏中的 <1>“新建”</1> 按钮打开连接对话框。您可以在主机树中管理主机和文件夹。',
    doubleClick:
      '<0>双击：</0>双击树中的主机即可立即连接。',
    supportedTypes: '<0>支持的连接类型：</0>',
    typeSsh:
      '<0>SSH</0> — 加密的远程 Shell（密码或密钥身份验证）',
    typeTelnet:
      '<0>Telnet</0> — 用于旧设备的未加密远程 Shell',
    typeSerial:
      '<0>Serial</0> — 直接的 COM 端口连接（路由器、嵌入式设备等）',
    typeWsl: '<0>WSL</0> — Windows Subsystem for Linux 发行版',
    typeLocal: '<0>Local</0> — 本地 Shell（CMD 或 PowerShell）',
    typeGitBash:
      '<0>Git Bash</0> — Git Bash 交互式登录 Shell（自动检测）',
    jumpbox:
      '<0>跳板机（堡垒主机）：</0>SSH 和 Telnet 连接可以通过跳板机路由。在主机树中将任意 SSH 主机标记为跳板机，然后在编辑目标主机时将其选为“经由”主机。',
    gcpIap:
      '<0>Google Cloud IAP：</0>通过 Identity-Aware Proxy 连接到 Google Compute Engine 虚拟机，无需将虚拟机暴露到公共互联网。在“新建会话”对话框中打开 <1>GCP</1> 标签页，即可浏览您有权访问的所有项目中的全部 GCE 实例 — 按项目分组，并带有实时状态（🟢 RUNNING / 🔴 stopped / 🟡 transitioning）— 然后双击某个实例即可连接。窗格还提供按钮以直接<2>启动</2>或<3>停止</3>实例，以及<4>刷新</4>操作来重新查询您的项目和实例。一个<5>搜索框</5>会在您输入时按项目或实例名称筛选列表。上次已知的列表会在<6>启动时立即显示</6>并在后台重新验证，因此您无需在每次打开窗格时都等待完整查询。如果您双击一个已停止的虚拟机，HoTTY 会在启动前提示（或在已保存的 IAP 主机上配置时自动启动）。<7>无需 SSH 用户名、密码或私钥</7> — HoTTY 将连接委托给 <8>gcloud compute ssh --tunnel-through-iap</8>，由它代您处理 IAP 隧道、OS Login 映射、自动 SSH 密钥生成（<9>~/.ssh/google_compute_engine</9>）、密钥注册和身份验证。需要 Google Cloud SDK 并已完成 <10>gcloud auth login</10>。',
    gcpSshUser:
      '<0>SSH 用户（通常留空）:</0> HoTTY 通过询问 gcloud 自动判定要登录的 Linux 账号，因此 GCP 标签页中的 <1>SSH user</1> 输入框通常留空即可。仅当虚拟机接受的账号与自动判定结果不同时才需填写——此时连接会以 <2>Permission denied (publickey)</2> 失败，错误信息中会显示尝试过的账号名。请注意，HoTTY 只读取 gcloud 的判定结果，不会更改 Google 侧的任何设置，因此在从未注册过 SSH 密钥的电脑上，仍需运行一次 <3>gcloud compute ssh &lt;instance&gt; --tunnel-through-iap</3> 来注册密钥。',
    gcpFiltering:
      '<0>GCP 访问感知筛选：</0>GCP 窗格会在项目和实例级别探测 <1>iap.tunnelInstances.accessViaIAP</1>（通过 <2>gcloud projects test-iam-permissions</2>），并隐藏您没有 IAP 隧道权限的虚拟机。窗格标题中的 🔒 计数按钮可让您重新切换显示这些隐藏的实例；没有 OS Login 权限的实例仍会显示，但会带有 🔑 警告标志，因为 SSH 仍可能通过元数据密钥工作。当 IAM 探测本身失败时（网络波动、已删除的项目），实例将保持可见，以免可访问的虚拟机被意外隐藏。',
    updateNotifications:
      '<0>更新通知：</0>启动时 HoTTY 会检查 GitHub 发布源，并在有更新版本可用时显示一个可关闭的通知，直接链接到发布页面。',
    connectionStatus:
      '<0>连接状态：</0>在建立传输连接时会显示“正在连接”覆盖层。SSH 和 Telnet 会话会在可配置的间隔（默认 5 秒）后超时 — 参见 <1>设置 → 协议</1>。连接失败会显示为可关闭的提示通知，带有简短易懂的标签 — 例如 <2>连接被拒绝</2>、<3>未找到主机</3>、<4>连接超时 (15s)</4>、<5>与服务器没有共同的 kex 算法</5>、<6>私钥的密码短语错误</6> 等 — 而不是原始的库错误文本。跳板机跃点上的失败会清晰地标记为 <7>跳板机：…</7>，以便您知道是哪一跳失败了。',
    sshAlgorithms:
      '<0>SSH 算法：</0>在 <1>设置 → 协议 → SSH 算法</1> 下切换在 SSH 握手期间提供哪些密钥交换、密码、MAC 和主机密钥算法。诸如 <2>curve25519-sha256</2> 和 <3>diffie-hellman-group14-sha256</3> 等现代默认算法已开箱即用。旧版 SHA-1 选项（<4>diffie-hellman-group14-sha1</4>、<5>3des-cbc</5>、<6>ssh-dss</6> 等）仍可供不协商现代算法的旧设备使用（例如 Cisco Catalyst 3650 / 较旧的 IOS）。启用 <7>diffie-hellman-group-exchange-sha1</7> 会显示确认提示，因为 SHA-1 被认为已不安全 — 请尽可能使用更强的 KEX。',
    algorithmsMerge:
      '升级时，发布版中新增的任何算法都会合并到您已保存的配置中，因此您无需手动选择启用安全改进。',
  },

  hostTree: {
    summary: '组织主机树',
    dragDrop:
      '<0>拖放：</0>您可以在“新建会话”对话框中通过拖动来重新排序主机和文件夹。',
    exportImportPrefix: '<0>导出与导入：</0>使用',
    exportLabel: '<0>导出</0>',
    importLabel: '<0>导入</0>',
    exportImportSuffix:
      '主机面板右上角的图标来备份或加载您的配置。',
    management:
      '<0>管理：</0>使用项目旁边的操作图标来添加文件夹、添加新主机、编辑设置或删除条目。',
    showPassword:
      '<0>显示密码：</0>需要时使用密码可见性切换按钮在主机树中显示已保存的密码。',
    newConnection:
      '<0>🆕 新建连接条目：</0>主机树的顶行用于开始一个全新的连接 — 它会清空对话框右侧的协议表单，以便您无需先取消选择已保存的主机即可拨入临时主机。',
    saveAdHoc:
      '<0>将临时会话保存到主机树：</0>通过 <1>新建连接</1> 连接后，右键单击该会话的标签页并选择 <2>保存到主机树…</2> 以便日后保留该连接。支持 SSH 和 Telnet 会话（私钥路径和密码短语会被保留）。在保存对话框中，主机树文件夹以树状视图显示，以便您直接选择目标文件夹，而 <3>+ 新建文件夹</3> 会在当前所选文件夹下创建一个文件夹 — 可任意深度嵌套。',
    openAll:
      '<0>打开文件夹中的全部:</0> 右键点击主机树中的文件夹并选择 <1>全部打开</1>，即可一次性连接其中的所有主机（包括子文件夹中的主机）。当文件夹包含 5 个或更多主机时，会先请求确认。',
  },

  layout: {
    summary: '布局精通',
    flexibleTabs:
      '<0>灵活的标签页：</0>拖放标签页不仅可以重新排序，还可以在网格窗格、侧边栏或顶/底栏之间移动它们。',
    resizing:
      '<0>调整大小：</0>通过拖动分隔条或 <1>二维交叉点</1>（4 个窗格相交处）来调整一切的大小。',
    emptyPaneHints:
      '<0>空窗格提示：</0>空的网格单元格会显示其窗格编号和“将标签页拖放到此处”提示，以便您知道在哪里放置标签页。',
    lineWrap:
      '<0>自动换行切换：</0>禁用 <1>设置 → 外观 → 自动换行</1> 可在终端窗格上启用水平滚动条。当您输入超过右边缘时，视图会自动滚动以保持光标可见，并在按 Enter 时回到第 0 列。无论水平滚动位置如何，垂直滚动条和提示符标记都会锚定在窗格的右边缘。',
    fixedTerminalSize:
      '<0>固定终端尺寸：</0>部分网络设备（如 Huawei USG/VRP）在登录时锁定终端宽度并忽略之后的尺寸变更，因此编辑从历史中调出的换行命令时会出现错位。<1>设置 → 常规 → 终端 → 固定终端尺寸</1> 可将网格固定为连接时协商的宽度。<2>自动</2> 仅对 HoTTY 通过 SSH 标识识别出的设备生效；您也可以全局强制开启或关闭、在连接表单中按连接设置，或通过标签页右键菜单只切换当前标签页。固定的终端在窗格比网格宽时会显示带底色的留白区域，比网格窄时则水平滚动。',
    multiWindow:
      '<0>多窗口：</0>通过侧边栏的 <1>新建窗口</1> 按钮或 <2>Ctrl + Shift + N</2> 打开另一个窗口——再次启动 HoTTY 也会在同一进程中打开新窗口。每个窗口拥有各自的窗格和终端会话，而设置、主题、主机树和书签会在所有窗口之间共享并同步。AI 聊天甚至可以链接到在另一个窗口中运行的终端。',
  },

  copyPaste: {
    summary: '复制与粘贴',
    copy:
      '<0>复制：</0>只需在终端中选择文本或点击 <1>终端标记</1> 即可选择整个块。选择后内容会自动复制到剪贴板。',
    paste:
      '<0>粘贴：</0>在终端中任意位置右键单击或使用 <1>Ctrl + V</1>。',
    safety:
      '<0>安全检查：</0>如果您尝试粘贴多行内容，将会出现 <1>粘贴确认</1> 对话框。这可以防止意外执行危险命令。',
  },

  markers: {
    summary: '终端标记',
    redTitle: '红/橙线：提示符',
    redDesc: '指示您输入命令的位置。',
    blueTitle: '蓝线：输出',
    blueDesc: '指示命令的结果/输出。',
    tip:
      '<0>提示：</0>点击标记可选择整个块。右键单击它可快速就该特定输出询问 AI。',
  },

  logging: {
    summary: '会话日志记录与日志查看器',
    sessionLogging:
      '<0>会话日志记录：</0>在 <1>设置 → 常规</1> 中启用自动日志记录。所有终端输出都会作为带时间戳的 <2>.log</2> 文件保存到您指定的文件夹。',
    folderApproval:
      '<0>文件夹批准：</0>HoTTY 首次使用某个日志文件夹时 — 无论是启动会话、开启日志记录还是打开日志查看器 — 都会弹出原生确认对话框要求您批准该文件夹。通过 <1>浏览...</1> 按钮选择文件夹会自动批准它。批准会在应用启动间保持（保存在 <2>%APPDATA%\\com.hotty.terminal\\approved_log_dirs.json</2> 下），因此每个文件夹您只会看到一次对话框。该机制的存在是为了防止键入或导入的路径在不知情的情况下授予日志访问权限。',
    logViewer:
      '<0>日志查看器：</0>点击标签栏中的 <1>日志查看器</1> 按钮可打开专用的日志浏览窗格。它会列出所有已保存的日志文件，让您无需离开 HoTTY 即可打开和搜索它们。',
    search:
      '<0>搜索：</0>使用日志查看器内的搜索栏筛选行。切换 <1>.*</1> 按钮可在纯文本搜索和正则表达式搜索之间切换。',
  },

  textEditor: {
    summary: '文本编辑器',
    intro:
      '通过 <0><1></1></0>（功能）→ <2>“文本编辑器”</2> 打开内置文本编辑器窗格。您可以打开多个编辑器窗格，并使用子标签页同时编辑多个文件。',
    fileMenu:
      '<0>文件菜单：</0>针对各个子标签页的新建、打开、保存、另存为和关闭操作。',
    viewMenu:
      '<0>视图菜单：</0>切换 <1>显示换行符</1> 可在编辑器中将换行符显示为可见符号。',
    findReplace:
      '<0>查找与替换：</0>按 <1>Ctrl + F</1> 打开搜索栏。使用 <2>Ctrl + H</2> 进行查找替换。匹配项会被高亮显示并显示总数。',
    gotoLine:
      '<0>转到行：</0>按 <1>Ctrl + G</1> 可跳转到指定的行号。',
    encoding:
      '<0>编码与行尾符：</0>点击状态栏中的编码或行尾符指示器可为当前文件更改它们。',
    lineWrap:
      '<0>自动换行：</0>由全局 <1>设置 → 外观 → 自动换行</1> 开关控制。可见的行号会自动更新以反映换行后的行。',
    fileAssociation:
      '<0>文件关联：</0>从 Windows 资源管理器打开的文件（双击或“打开方式”）会直接在文本编辑器中启动。',
    tip:
      '<0>提示：</0>未保存的文件会在其子标签页标题上显示一个 <1>•</1> 圆点。用 <2>Ctrl + S</2> 保存。',
    unsavedPrompt:
      '<0>未保存更改提示：</0>关闭子标签页或在有未保存的编辑器时退出会打开一个 <1>保存 / 放弃 / 取消</1> 对话框，让您永远不会意外丢失工作。',
  },

  fileServer: {
    summary:
      '文件服务器 (TFTP / SFTP)',
    intro:
      '通过 <0><1></1></0> (Features) → <2>“File Server”</2> 打开文件服务器面板。选择要共享的文件夹并启动 TFTP 或 SFTP 服务器，网络设备（如 Cisco）即可通过局域网下载或上传固件。',
    serve:
      '<0>共享文件夹：</0>用“浏览”选择文件夹。仅可访问其中的文件；路径穿越和符号链接逃逸都会被阻止。',
    tftp:
      '<0>TFTP：</0>UDP（默认端口 69）。Cisco IOS 使用 <1>copy tftp: flash:</1> 加载固件的经典方式。默认只读；需要设备→PC 传输时启用 <2>Allow uploads</2>。',
    sftp:
      '<0>SFTP：</0>基于 SSH（默认端口 2222），用户名/密码认证。主机密钥自动生成并加密保存。',
    firewall:
      '<0>Windows 防火墙：</0>若入站被阻止，面板会显示并提供 <1>Allow through firewall</1>（一键，需要管理员权限）。',
    security:
      '<0>安全：</0>启动服务器会将所选文件夹暴露到本地网络。请仅共享可信文件，除非需要否则请关闭上传。',
  },

  webBrowser: {
    summary: '网页浏览器与书签',
    intro:
      '在 HoTTY 内用内嵌浏览器打开网页，方便在终端旁边打开网络设备的网页管理界面（路由器、交换机、iLO/iDRAC 等）。从<0>新建会话</0>对话框的 <1>🌐 网页</1> 标签打开：点击 <2>🆕 新建网页浏览器</2> 打开空白标签，或双击已保存的书签打开该网站。',
    bookmarks:
      '<0>书签：</0> 在 <1>网页</1> 标签中以文件夹树整理网站——添加、重命名、删除并拖动排序。双击书签会在新的浏览器窗格中打开。浏览时，工具栏中的书签按钮会列出已保存的书签，便于快速打开。',
    openAll:
      '<0>打开全部书签:</0> 在 <1>网页</1> 标签或浏览器内的书签列表中右键点击书签文件夹，选择 <2>全部打开</2>，即可将其中的每个书签（包括子文件夹）分别在各自的浏览器窗格中打开。当文件夹包含 5 个或更多书签时，会先请求确认。',
    star:
      '<0>★ 收藏此页：</0> 浏览时点击工具栏中的 <1>★</1> 按钮，可将当前页面保存到所选文件夹。',
    toolbar:
      '<0>工具栏：</0> 后退、前进、刷新/停止以及地址栏。仅允许 <1>http://</1> 和 <2>https://</2> 地址；不带协议输入的地址默认使用 <3>http://</3>。不是网址的文字将进行网页搜索。',
    passwords:
      '<0>登录与密码：</0> 浏览器会保留你的登录会话，并可保存和自动填充密码，这些数据存储在 HoTTY 自有的加密浏览器配置文件中（与系统的 Edge/Chrome 分开）。',
    clearData:
      '<0>清除浏览数据：</0> 打开工具栏中的 ⋯ 更多菜单并选择“清除浏览数据”，即可清除 Cookie 和网站数据、缓存、历史记录、已保存的密码和自动填充 — 由你选择要清除的内容。你的书签和 HoTTY 设置始终保留。',
    enable:
      '<0>启用/停用：</0> 可在<1>设置 → 功能</1>中关闭“网页”标签。',
  },

  fileExplorer: {
    summary: '文件浏览器',
    intro:
      '通过 <0><1></1></0>（功能）→ <2>“文件浏览器”</2> 打开内置文件浏览器窗格。在可折叠的树状结构中浏览您的驱动器和目录。',
    navigate:
      '<0>导航：</0>点击文件夹可展开/折叠。使用顶部的面包屑路径可快速导航。',
    openFiles: '<0>打开文件：</0>双击文件可在文本编辑器中打开它。',
    hiddenFiles:
      '<0>隐藏文件：</0>使用工具栏中的眼睛图标切换隐藏文件的可见性。',
    refresh: '<0>刷新：</0>点击刷新按钮可重新加载当前目录。',
  },

  aiQuickStart: {
    summary: 'AI 快速入门指南',
    intro:
      'HoTTY 内置 AI，可以分析终端输出、解释错误、建议修复方案，甚至为您执行命令。以下是 3 个步骤的入门方法：',
    step1:
      '<0>选择提供商：</0>转到 <1>设置 → AI → AI 提供商</1> 并选择一个。推荐使用 <2>Google AI Studio (Gemini)</2> 或 <3>Vertex AI</3> — 参见下方的对比表。',
    step2:
      '<0>登录：</0>在 <1>设置 → AI</1> 中，提供商选择器正下方会显示所选提供商的登录表单 — 在那里输入您的凭据。',
    step3:
      '<0>开始聊天：</0>输入问题，或选择终端文本后右键单击，在出现的 <1>“询问 AI”</1> 框中输入您的问题。',
    outro:
      '就这么简单！您可以立即开始提问 — 无需复杂的配置。',
  },

  aiFeatures: {
    summary: 'AI 功能概览',
    aiChatHeading: 'AI 聊天',
    aiChatIntro:
      '点击标签栏中的 <0><1></1></0>（功能）→ <2>“AI 聊天”</2> 打开 AI 聊天窗格。在其中，顶部的标签条可让您保持多个并行对话 — 使用 <3>+ 新建聊天</3> 开始一个新标签页。输入您的问题并按 <4>Ctrl + Enter</4> 发送。',
    linkedTerminal:
      '<0>监视中的终端：</0>在某个终端上启动 AI 监视会将其添加到当前活动的 AI 聊天标签页 — 在多个终端上开启后，一个对话即可同时监视它们。每个监视中的终端会显示为输入框旁边的一个标记；点击标记可跳转到该终端，点击其 × 可停止监视，点击标记旁的 + 可添加另一个（已断开的终端会变灰，并在重新连接时自动重新链接）。当监视多个终端时，AI 会将每条命令发送到正确的终端；否则将在您最近使用的终端上执行。若需拥有各自终端集合的独立对话，请使用标签栏中的 + 新建聊天。',
    streamWatchdog:
      '<0>流监视器：</0>如果某个 AI 提供商在响应中途停止发送数据（网络中断、后端挂起），进行中的请求会在静默 3 分钟后自动取消，并在聊天中显示错误消息 — 不再有卡住的“流式传输”状态。',
    attachImages:
      '<0>附加图片：</0> 粘贴图片（Ctrl + V）、将图片文件拖入消息框，或使用回形针按钮，即可把截图发送给 AI。支持 PNG、JPEG、WebP 和 GIF（最多 5 张，每张 5 MB）。所选模型需支持图片输入。',
    askAiHeading: '询问 AI（右键单击）',
    askAiBody:
      '在终端中选择文本（或点击 <0>终端标记</0> 以选择整个输出块），然后右键单击，在出现的 <1>“询问 AI”</1> 框中输入问题 — 按 Enter 发送。HoTTY 会打开 AI 聊天，并附上您的问题和所选文本。',
    interactiveHeading: '交互模式（命令执行）',
    interactiveBody:
      '当 AI 建议某个命令时，它可以将该命令直接发送到您的终端会话以执行。您会在命令运行前看到它，因此始终掌控全局。当某个建议的命令正在等待您确认时，您可以运行它，或点击“不执行”来拒绝它；拒绝后会告知 AI，以便它提出其他方案。',
    executionHeading: '执行模式与自动执行',
    executionBody:
      'AI 聊天窗格底部的 <0>执行模式标记</0> 控制 AI 建议的命令如何运行 — 可在“询问”、“自动执行安全命令”或“暂停”之间选择。开启自动执行时，每条命令都会被判定，然后自动运行或等待手动确认；“暂停”会在不更改模式的情况下停止自动运行循环，标记的控件可让您恢复。在 <2>设置 → AI → 命令执行</2> 中配置连续执行上限和 <1>设备响应空闲超时</1>（默认 10 秒；0 表示禁用）。当某个命令以 <3>sleep N</3> 开头时（例如 <4>sleep 120 &amp;&amp; validate</4>），HoTTY 会在本地等待这些秒数，而不是将 sleep 发送到设备 — 这样空闲超时就不会在等待期间误触发 — 然后在之后运行任何链接的命令；在 <5>设置 → AI</5> 中切换此功能及其最大延迟。',
    safetyHeading: '命令安全分类器（白名单 / 黑名单 / AI）',
    safetyBody:
      '每条命令如何判定是否自动执行由三个层级决定，可在 <0>设置 → AI → 命令执行</0> 中配置。<1>黑名单</1> 首先检查 — 匹配项永不自动运行（仍提供手动运行）。<2>白名单</2> 会自动运行明显的只读命令。介于两者之间的任何命令都会发送给 <3>AI</3>，由它判断是否更改配置；只有被判定为只读且置信度足够的命令才会自动运行，其他一切都会询问。两个列表都完全可编辑：单个单词匹配基本命令（例如 <4>docker</4>），带空格的条目作为子字符串匹配（例如 <5>rm -rf</5>、<6>git push</6>）；每个列表都有一个 <7>恢复默认</7> 按钮。在同一处选择策略（静态 / AI / <8>混合</8>，默认）和 AI 置信度阈值。每个执行块都会显示它是如何被判定的 — 已列入白名单、AI 判定、已列入黑名单或需要确认 — 因此决策永远不会被隐藏。',
    personasHeading: '角色',
    personasBody:
      '使用聊天顶部的角色选择器在 AI 角色（通用助手、网络专家、安全分析师等）之间切换。每个角色都有为该领域量身定制的系统提示词。点击 <0>系统提示词</0> 指示器可查看发送给模型的确切指令并将其复制到剪贴板。',
    personasNetworkExpert:
      '<0>网络专家</0> 角色会自动准备已链接的终端：当其聊天链接到一个活动会话时，它会在您提问之前自动识别设备并禁用分页。将链接的终端切换到另一台设备会先开始一个新聊天，而重新连接到同一台设备只会重新禁用分页并保留您的对话。',
  },

  watchMode: {
    summary: '监视模式（AI 监控）',
    intro:
      '监视模式可让 AI 监控终端会话的输出并按需对其进行分析 — 非常适合长时间运行的命令或日志跟踪。',
    step1:
      '点击任意终端标签页上的 <0><1></1></0> 图标即可开始监视。图标会变为蓝色，标签页会获得彩虹高亮。',
    step2: '照常运行命令。所有输出都会被捕获到缓冲区中。',
    step3:
      '在已链接的 <0>AI 聊天标签页</0> 中直接输入您的问题 — 或右键单击终端文本并选择 <1>询问 AI</1>，捕获的输出会自动纳入分析。',
    tip:
      '<0>提示：</0>让它收集输出，并在您准备好时让 AI 进行总结或查找错误。缓冲区大小上限可在 <1>设置 → AI → AI 监控缓冲区上限</1> 中调整。',
  },

  chooseProvider: {
    summary: '选择 AI 提供商',
    intro:
      'HoTTY 支持四个 AI 提供商。选择最符合您需求的一个：',
    thProvider: '提供商',
    thBestFor: '最适合',
    thAuth: '身份验证',
    thStatus: '状态',
    geminiName: 'Google AI Studio<0></0>(Gemini)',
    geminiBestFor: '个人使用，提供免费层级',
    geminiAuth: 'OAuth2',
    geminiStatus: '已完全测试',
    vertexName: 'Google Cloud<0></0>Vertex AI',
    vertexBestFor: '企业 / 生产使用',
    vertexAuth: 'ADC / 服务账号',
    vertexStatus: '已完全测试',
    anthropicName: 'Anthropic<0></0>(Claude)',
    anthropicBestFor: '通过 API 密钥使用 Claude 模型',
    anthropicAuth: 'API 密钥',
    experimental: '实验性',
    experimentalNote: '（未经测试 — 可能无法按预期工作）',
    openaiName: 'OpenAI',
    openaiBestFor: '通过 API 密钥使用 GPT 模型',
    openaiAuth: 'API 密钥',
    recommendation:
      '<0>建议：</0>如果您不确定，请从 <1>Google AI Studio (Gemini)</1> 开始 — 它有免费层级，并且是经过最彻底测试的提供商。',
  },

  aiSetup: {
    summary: 'AI 设置与身份验证',
    whereHeading: '在哪里输入凭据？',
    whereBody1:
      '一切都在 <0>设置 → AI</0> 中：在那里选择提供商后，该提供商的登录表单会显示在正下方，旁边还有身份验证状态和注销按钮。',
    whereBody2:
      '<0>AI 聊天面板</0> 本身没有凭据输入框 — 未登录时，它会显示一个直接跳转到 AI 标签页的<1>打开设置</1>按钮。只需登录一次；之后启动时 HoTTY 会自动重新验证，注销也在同一处的注销按钮完成。',
    geminiHeading: 'Google AI Studio (Gemini) — 使用 Google 登录（OAuth2）',
    geminiIntro:
      '此提供商通过 OAuth2 使用您的 Google 账号登录 — <0>无法使用 AI Studio 的 API 密钥</0>。只需一次性创建您自己的（免费）OAuth 客户端：',
    geminiStep1:
      '在 <0>Google Cloud Console</0>（console.cloud.google.com）中创建或选择一个项目，然后启用 <1>Generative Language API</1>（APIs & Services → Library）。',
    geminiStep2:
      '配置 <0>OAuth 同意屏幕</0>（APIs & Services）：选择“外部”即可。应用处于<1>测试</1>模式期间，请在<2>测试用户</2>中添加您自己的 Google 账号 — 否则 Google 会阻止登录。',
    geminiStep3:
      '在 APIs & Services → Credentials → <0>创建凭据 → OAuth 客户端 ID</0> 中创建客户端，应用类型选择<1>桌面应用</1>，并复制 <2>Client ID</2> 和 <3>Client Secret</3>。无需设置重定向 URI — HoTTY 会自动监听一个临时的 localhost 端口。',
    geminiStep4:
      '在 HoTTY 中打开 <0>设置 → AI</0>，选择 <1>Google AI Studio (Gemini)</1> 作为您的提供商，将 Client ID 和 Client Secret 粘贴到下方的登录表单中，然后点击 <2>“使用 Google 登录”</2>。',
    geminiStep5:
      '浏览器会打开 Google 的同意页面 — 请在 5 分钟内批准访问。HoTTY 会在本地接收登录结果，聊天即可使用。',
    geminiNote:
      '免费层级账户的数据可能会用于模型训练。在您的 Google Cloud 项目上启用结算即可选择退出。',
    vertexHeading: 'Google Cloud Vertex AI — ADC 或服务账号',
    vertexStep1:
      '在 Google Cloud Console 中为您的项目启用 <0>Vertex AI API</0>，并确保您使用的账号（或服务账号）具有 <1>Vertex AI User</1> 角色（roles/aiplatform.user）。',
    vertexStep2:
      '<0>ADC（最简单）：</0>安装 Google Cloud CLI，然后运行：<1></1><2>gcloud auth application-default login</2><3></3>HoTTY 会自动检测这些凭据。',
    vertexStep3:
      '<0>服务账号（备选）：</0>在 IAM 和管理 → 服务账号中创建 JSON 密钥并保存到本地；在登录面板中选择<1>服务账号</1>并输入密钥文件路径。',
    vertexStep4:
      '在 <0>设置 → AI</0> 中输入您的 <1>Google Cloud Project ID</1>，选择一个<2>区域</2>，选择身份验证方式，然后点击<3>登录</3>。',
    anthropicHeading: 'Anthropic (Claude) — API 密钥',
    anthropicExperimental: '（实验性）',
    anthropicStep1:
      '在 <0>console.anthropic.com</0> 创建账号并购买 API 额度 — API 计费与 Claude.ai 订阅是分开的。',
    anthropicStep2:
      '在 Settings → <0>API Keys</0> 中创建密钥并立即复制 — 密钥只显示一次（以 <1>sk-ant-</1> 开头）。',
    anthropicStep3:
      '在 HoTTY 中打开 <0>设置 → AI</0>，选择 <1>Anthropic</1> 作为您的提供商，粘贴 API 密钥，然后点击登录。',
    anthropicNote:
      '此提供商为实验性，尚未经过全面测试。某些功能（监视模式、交互模式等）可能无法按预期工作。如遇任何问题，请反馈。',
    openaiHeading: 'OpenAI — API 密钥',
    openaiExperimental: '（实验性）',
    openaiStep1:
      '在 <0>platform.openai.com</0> 创建账号并设置计费或额度 — API 计费与 ChatGPT Plus 是分开的。',
    openaiStep2:
      '在 <0>API keys</0> 页面创建密钥并立即复制 — 密钥只显示一次（以 <1>sk-</1> 开头）。',
    openaiStep3:
      '在 HoTTY 中打开 <0>设置 → AI</0>，选择 <1>OpenAI</1> 作为您的提供商，粘贴 API 密钥，然后点击登录。',
    openaiNote:
      '此提供商为实验性，尚未经过全面测试。某些功能（监视模式、交互模式等）可能无法按预期工作。如遇任何问题，请反馈。',
    troubleshootHeading: '登录失败时',
    troubleshootGemini:
      '<0>Gemini：</0>出现“访问已被阻止”/“应用未完成验证流程”页面，表示您的 Google 账号未被添加到 OAuth 同意屏幕的<1>测试用户</1>中。登录尝试也会在 5 分钟后过期 — 重新开始即可。',
    troubleshootVertex:
      '<0>Vertex AI：</0>权限（403）错误通常表示未启用 Vertex AI API 或缺少 <1>Vertex AI User</1> 角色。如果 ADC 已过期，请重新运行 <2>gcloud auth application-default login</2>。',
    troubleshootKeys:
      '<0>OpenAI / Anthropic：</0>401 表示密钥无效或已被吊销；429 通常表示额度用尽或触发了速率限制。',
    credentialsNote:
      '所有凭据都使用 Windows DPAPI 加密并存储在本地 — 除了发送给相应的 AI 提供商外，它们绝不会传输到您的机器之外。',
  },

  customizing: {
    summary: '自定义 AI 命令与角色',
    customPersonas:
      '<0>自定义角色：</0>在 <1>设置 → AI → 角色</1> 中，创建带有自定义系统提示词的角色。所选角色会作为每个新 AI 聊天会话的初始系统指令应用。',
    proactiveInvestigation:
      '<0>主动调查：</0>当 AI 需要更多信息来完成您的请求时，它会自动建议终端命令，并可在监视模式中捕获结果以继续分析。',
  },

  themes: {
    summary: '主题与外观',
    builtIn:
      '在 <3>设置 → 外观 → 主题</3> 中切换内置主题（<0>深色</0>、<1>中等</1>、<2>浅色</2>）。',
    customThemes:
      '<0>自定义主题：</0>点击 <1>“+ 创建自定义主题”</1> 打开主题编辑器。调整任意颜色变量并以自定义名称保存。自定义主题可随时编辑或删除。',
    providerColors:
      '<0>AI 提供商颜色：</0>主题编辑器包含一个 <1>AI 提供商</1> 部分，用于自定义 Gemini、OpenAI、Anthropic 和 Vertex AI 图标所用的品牌色。',
    futuristic:
      '<0>未来感效果：</0>主题编辑器的 <1>未来感效果</1> 部分可为活动窗格和侧边栏图标添加可选的霓虹光晕、为模态框添加玻璃拟态背景模糊，以及可配置的图标描边宽度。',
    unusedPane:
      '<0>未使用窗格背景：</0>在 <1>设置 → 外观</1> 中，选择纯色或自定义图片以显示在空的网格窗格中。',
    language:
      '<0>显示语言：</0>在 <1>设置 → 常规 → 显示语言</1> 中切换界面语言。HoTTY 支持 English、日本語、简体中文、繁體中文、한국어、Русский、Español、Français，更改即时生效。（AI 回复语言在 AI 聊天面板中单独设置。）',
  },
};
