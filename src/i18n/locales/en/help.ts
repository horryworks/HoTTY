// Help & Documentation modal. This is the most prose-heavy surface in the app,
// so most values carry inline markup and are rendered via <Trans> with indexed
// component placeholders (<0>, <1>, …). Keyboard-shortcut KEYS (e.g. "Ctrl + N")
// stay literal in the component; only their descriptions live here. Code
// identifiers, command snippets, file paths, URLs, regex, and protocol/product
// names (SSH, Telnet, WSL, GCP, IAP, gcloud) are intentionally NOT translated.
export const help = {
  title: 'Help & Documentation',

  shortcuts: {
    summary: 'Shortcuts',
    newSession: 'New Session Dialog',
    newWindow: 'New Window',
    focusNext: 'Focus next pane',
    focusPrev: 'Focus previous pane',
    closeTab: 'Close current tab',
    clearOrSigint: 'Clear selection / Send SIGINT',
    paste: 'Paste to terminal (with security check)',
    sendMessage: 'Send message in Ask AI dialog',
    closeModal: 'Close modal / dialog',
  },

  gettingStarted: {
    summary: 'Getting Started',
    openDialog:
      'Open the connection dialog via <0>Ctrl + N</0> or the <1>"New"</1> button in the sidebar. You can manage your hosts and folders in the host tree.',
    doubleClick:
      '<0>Double-click:</0> Double-click a host in the tree to connect immediately.',
    supportedTypes: '<0>Supported connection types:</0>',
    typeSsh:
      '<0>SSH</0> — Encrypted remote shell (password or key authentication)',
    typeTelnet:
      '<0>Telnet</0> — Unencrypted remote shell for legacy devices',
    typeSerial:
      '<0>Serial</0> — Direct COM port connection (routers, embedded devices, etc.)',
    typeWsl: '<0>WSL</0> — Windows Subsystem for Linux distributions',
    typeLocal: '<0>Local</0> — Local shell (CMD or PowerShell)',
    typeGitBash:
      '<0>Git Bash</0> — Git Bash interactive login shell (auto-detected)',
    jumpbox:
      '<0>Jumpbox (Bastion Host):</0> SSH and Telnet connections can be routed through a jumpbox. Mark any SSH host as a jumpbox in the host tree, then select it as the "via" host when editing a target host.',
    gcpIap:
      '<0>Google Cloud IAP:</0> Connect to Google Compute Engine VMs via Identity-Aware Proxy without exposing VMs to the public internet. Open the <1>GCP</1> tab in the New Session dialog to browse all your GCE instances across every project you have access to — grouped by project, with live status (🟢 RUNNING / 🔴 stopped / 🟡 transitioning) — then double-click an instance to connect. The pane also has buttons to <2>start</2> or <3>stop</3> an instance directly, and a <4>Refresh</4> action to re-query your projects and instances. A <5>search box</5> filters the list by project or instance name as you type. The last-known list is shown <6>instantly on launch</6> and revalidated in the background, so you don\'t wait for a full query every time the pane opens. If you double-click a stopped VM, HoTTY prompts before starting it (or auto-starts when configured on a saved IAP host). <7>No SSH username, password, or private key is required</7> — HoTTY delegates the connection to <8>gcloud compute ssh --tunnel-through-iap</8>, which handles IAP tunneling, OS Login mapping, automatic SSH key generation (<9>~/.ssh/google_compute_engine</9>), key registration, and authentication on your behalf. Requires the Google Cloud SDK and a completed <10>gcloud auth login</10>.',
    gcpSshUser:
      '<0>SSH user (usually leave blank):</0> HoTTY works out which Linux account to log in as by asking gcloud, so the <1>SSH user</1> box in the GCP tab is normally left empty. Fill it in only if a VM accepts a different account than the one detected — the connection then fails with <2>Permission denied (publickey)</2> and the error names the account that was tried. Note that HoTTY reads gcloud\'s answer without changing anything on Google\'s side, so on a machine whose SSH key was never registered you still need to run <3>gcloud compute ssh &lt;instance&gt; --tunnel-through-iap</3> once to enroll it.',
    gcpFiltering:
      '<0>GCP access-aware filtering:</0> The GCP pane probes <1>iap.tunnelInstances.accessViaIAP</1> at the project and instance level (via <2>gcloud projects test-iam-permissions</2>) and hides VMs you have no IAP tunnel permission for. A 🔒 counter button in the pane header lets you toggle the hidden instances back on; instances without OS Login permission still show but display a 🔑 warning glyph because SSH may still work via a metadata key. When the IAM probe itself fails (network blip, deleted project), the instances stay visible so accessible VMs are never hidden by accident.',
    updateNotifications:
      '<0>Update Notifications:</0> On startup HoTTY checks the GitHub releases feed and shows a dismissible notification when a newer version is available, linking directly to the release page.',
    connectionStatus:
      '<0>Connection Status:</0> When you start a connection from the New Session dialog, the dialog stays open showing a Connecting indicator, and if the attempt fails the reason is shown inline so you can adjust the details and retry — or Cancel — without losing what you typed; the terminal opens only once the session connects. Reconnecting an already-open session shows a Connecting overlay in its pane instead. SSH and Telnet sessions time out after a configurable interval (default 5 seconds) — see <1>Settings → Protocols</1>. Failures are reported with short, plain-English labels — <2>Connection refused</2>, <3>Host not found</3>, <4>Connection timed out (15s)</4>, <5>No common kex algorithm with server</5>, <6>Wrong passphrase for private key</6>, etc. — instead of the raw library error text, appearing inline in the dialog or as a dismissible toast for an already-open session. Failures on a jumpbox hop are clearly tagged <7>Jumpbox: …</7> so you can tell which hop failed.',
    sshAlgorithms:
      '<0>SSH Algorithms:</0> Toggle which key-exchange, cipher, MAC, and host-key algorithms are offered during the SSH handshake under <1>Settings → Protocols → SSH Algorithms</1>. Modern defaults such as <2>curve25519-sha256</2> and <3>diffie-hellman-group14-sha256</3> are enabled out of the box. Legacy SHA-1 options (<4>diffie-hellman-group14-sha1</4>, <5>3des-cbc</5>, <6>ssh-dss</6>, etc.) remain available for older devices (e.g. Cisco Catalyst 3650 / older IOS) that do not negotiate modern algorithms. Enabling <7>diffie-hellman-group-exchange-sha1</7> shows a confirmation prompt because SHA-1 is considered broken — use a stronger KEX whenever possible.',
    algorithmsMerge:
      'When upgrading, any algorithms newly added in a release are merged into your saved configuration so you don\'t need to manually opt in to security improvements.',
  },

  hostTree: {
    summary: 'Organizing the Host Tree',
    dragDrop:
      '<0>Drag & Drop:</0> You can reorder hosts and folders by dragging them in the "New Session" dialog.',
    exportImportPrefix: '<0>Export & Import:</0> Use the',
    exportLabel: '<0>Export</0>',
    importLabel: '<0>Import</0>',
    exportImportSuffix:
      'icons at the top-right of the host panel to backup or load your configurations.',
    management:
      '<0>Management:</0> Use the action icons next to items to add folders, add new hosts, edit settings, or delete entries.',
    showPassword:
      '<0>Show Password:</0> Use the password visibility toggle to reveal saved passwords in the host tree when needed.',
    newConnection:
      '<0>🆕 New Connection entry:</0> The top row of the host tree starts a fresh connection — it clears the protocol form on the right of the dialog so you can dial an ad-hoc host without first deselecting a saved one.',
    saveAdHoc:
      '<0>Save an ad-hoc session to the Host Tree:</0> After connecting via <1>New Connection</1>, right-click the session\'s tab and choose <2>Save to Host Tree…</2> to keep the connection for later. SSH and Telnet sessions are supported (private-key path and passphrase are preserved). In the save dialog the host-tree folders are shown as a tree view so you can pick the destination folder directly, and <3>+ New Folder</3> creates a folder under the currently-selected one — nestable as deep as you like.',
    openAll:
      '<0>Open All in a folder:</0> Right-click a host-tree folder and choose <1>Open All</1> to connect to every host inside it at once, including hosts in sub-folders. When a folder holds 5 or more hosts you are asked to confirm first.',
  },

  layout: {
    summary: 'Layout Mastery',
    flexibleTabs:
      '<0>Flexible Tabs:</0> Drag and drop tabs not just to reorder them, but to move them between grid panes, sidebars, or top/bottom bars.',
    resizing:
      '<0>Resizing:</0> Resize everything by dragging the dividers or the <1>2D intersection point</1> (where 4 panes meet).',
    emptyPaneHints:
      '<0>Empty pane hints:</0> Empty grid cells show their pane number and a "Drop Tab Here" prompt so you know where to drop a tab.',
    lineWrap:
      '<0>Line Wrap toggle:</0> Disable <1>Settings → Appearance → Line Wrap</1> to enable a horizontal scrollbar on terminal panes. The view auto-scrolls to keep the cursor in sight as you type past the right edge, and snaps back to column 0 on Enter. The vertical scrollbar and prompt marker stay anchored to the pane\'s right edge regardless of horizontal scroll position.',
    fixedTerminalSize:
      '<0>Fixed terminal size:</0> Some network devices (e.g. Huawei USG/VRP) lock their terminal width at login and ignore later resizes, so editing a recalled command that wraps goes out of sync. <1>Settings → General → Terminal → Fixed terminal size</1> pins the grid to the width negotiated at connect. <2>Auto</2> pins only devices HoTTY recognises from the SSH identification; you can also force it on or off globally, per connection in the connection form, or for the current tab from its right-click menu. A pinned terminal shows a tinted letterbox when the pane is wider than the grid, and scrolls horizontally when it is narrower.',
    multiWindow:
      '<0>Multiple windows:</0> Open another window with the <1>New Window</1> button in the sidebar or <2>Ctrl + Shift + N</2> — launching HoTTY again opens a new window in the same process. Each window keeps its own panes and terminal sessions, while your settings, theme, host tree and bookmarks stay shared and in sync across all windows. An AI Chat can even link to a terminal running in another window.',
  },

  copyPaste: {
    summary: 'Copy & Paste',
    copy:
      '<0>Copy:</0> Simply select text in the terminal or click a <1>Terminal Marker</1> to select an entire block. Content is automatically copied to your clipboard upon selection.',
    paste:
      '<0>Paste:</0> Right-click anywhere in the terminal or use <1>Ctrl + V</1>.',
    safety:
      '<0>Safety Check:</0> A <1>Paste Confirmation</1> dialog will appear if you try to paste multiple lines. This prevents accidental execution of dangerous commands.',
  },

  markers: {
    summary: 'Terminal Markers',
    redTitle: 'Red/Orange line: Prompt',
    redDesc: 'Indicates where you typed a command.',
    blueTitle: 'Blue line: Output',
    blueDesc: 'Indicates the result/output of a command.',
    tip:
      '<0>Tip:</0> Click a marker to select the entire block. Right-click it to quickly ask AI about that specific output.',
  },

  logging: {
    summary: 'Session Logging & Log Viewer',
    sessionLogging:
      '<0>Session Logging:</0> Enable automatic logging in <1>Settings → General</1>. All terminal output is saved as timestamped <2>.log</2> files to the folder you specify.',
    folderApproval:
      '<0>Folder approval:</0> The first time HoTTY uses a logging folder — whether you start a session, toggle logging on, or open the Log Viewer — a native confirm dialog asks you to approve that folder. Picking a folder via the <1>Browse...</1> button approves it automatically. Approvals persist across app launches (saved under <2>%APPDATA%\\com.hotty.terminal\\approved_log_dirs.json</2>), so you only see the dialog once per folder. The mechanism exists so a typed or imported path can\'t silently grant log access.',
    logViewer:
      '<0>Log Viewer:</0> Click the <1>Log Viewer</1> button in the tab bar to open a dedicated log-browsing pane. It lists all saved log files and lets you open and search them without leaving HoTTY.',
    search:
      '<0>Search:</0> Use the search bar inside Log Viewer to filter lines. Toggle the <1>.*</1> button to switch between plain-text and regular expression search.',
  },

  textEditor: {
    summary: 'Text Editor',
    intro:
      'Open a built-in text editor pane via <0><1></1></0> (Features) → <2>"Text Editor"</2>. You can open multiple editor panes and edit multiple files simultaneously using sub-tabs.',
    fileMenu:
      '<0>File menu:</0> New, Open, Save, Save As, and Close actions for individual sub-tabs.',
    viewMenu:
      '<0>View menu:</0> Toggle <1>Show Return Codes</1> to display newline characters as visible symbols in the editor.',
    findReplace:
      '<0>Find & Replace:</0> Press <1>Ctrl + F</1> to open the search bar. Use <2>Ctrl + H</2> for find-and-replace. Matches are highlighted and the total count is shown.',
    gotoLine:
      '<0>Go to Line:</0> Press <1>Ctrl + G</1> to jump to a specific line number.',
    encoding:
      '<0>Encoding & Line Endings:</0> Click the encoding or line ending indicator in the status bar to change them for the current file.',
    lineWrap:
      '<0>Line Wrap:</0> Controlled by the global <1>Settings → Appearance → Line Wrap</1> toggle. Visual line numbers update automatically to reflect wrapped lines.',
    fileAssociation:
      '<0>File Association:</0> Files opened from Windows Explorer (double-click or "Open with") launch directly in the Text Editor.',
    tip:
      '<0>Tip:</0> An unsaved file shows a <1>•</1> dot on its sub-tab title. Save with <2>Ctrl + S</2>.',
    unsavedPrompt:
      '<0>Unsaved changes prompt:</0> Closing a sub-tab or exiting with dirty editors opens a <1>Save / Discard / Cancel</1> dialog so you never lose work by accident.',
  },

  fileServer: {
    summary:
      'File Server (TFTP / SFTP)',
    intro:
      'Open the File Server pane via <0><1></1></0> (Features) → <2>"File Server"</2>. Choose a folder to share, then start a TFTP and/or SFTP server so network devices (e.g. Cisco) can pull or push firmware over the LAN.',
    serve:
      '<0>Served folder:</0> Pick the folder with Browse. Only files inside it are accessible — path traversal and symlink escapes are blocked.',
    tftp:
      '<0>TFTP:</0> UDP (default port 69). The classic method for Cisco IOS <1>copy tftp: flash:</1> firmware loads. Read-only by default; enable <2>Allow uploads</2> for device→PC transfers.',
    sftp:
      '<0>SFTP:</0> SSH-based (default port 2222) with username/password auth. The host key is generated automatically and stored encrypted.',
    firewall:
      '<0>Windows Firewall:</0> If inbound is blocked, the pane shows it and offers <1>Allow through firewall</1> (one click, requires administrator).',
    security:
      '<0>Security:</0> Starting a server exposes the chosen folder to your local network. Serve only trusted files and keep uploads off unless you need them.',
  },

  webBrowser: {
    summary: 'Web Browser & Bookmarks',
    intro:
      'Open web pages inside HoTTY in an embedded browser — handy for network-device web admin UIs (routers, switches, iLO/iDRAC) right next to your terminals. Open it from the <0>New Session</0> dialog’s <1>🌐 Web</1> tab: click <2>🆕 New Web Browser</2> for a blank tab, or double-click a saved bookmark to open that site.',
    bookmarks:
      '<0>Bookmarks:</0> Organize sites in a folder tree under the <1>Web</1> tab — add, rename, delete, and drag to reorder. Double-click a bookmark to open it in a new browser pane. While browsing, the bookmarks button in the toolbar lists your saved bookmarks for quick access.',
    openAll:
      '<0>Open All bookmarks:</0> Right-click a bookmark folder — in the <1>Web</1> tab or the in-browser bookmarks list — and choose <2>Open All</2> to open every bookmark inside it (including sub-folders), each in its own browser pane. When a folder holds 5 or more bookmarks you are asked to confirm first.',
    star:
      '<0>★ Bookmark this page:</0> While browsing, click the <1>★</1> button in the toolbar to save the current page into a folder you choose.',
    toolbar:
      '<0>Toolbar:</0> Back, Forward, Reload/Stop, and an address bar. Only <1>http://</1> and <2>https://</2> addresses are allowed; a typed address without a scheme defaults to <3>http://</3>. Text that isn’t a web address is searched on the web. A zoom control zooms the page (also with Ctrl + mouse wheel), and you can set a default zoom that new panes start at.',
    passwords:
      '<0>Logins and passwords:</0> The browser keeps your login sessions and can save and autofill passwords, stored in HoTTY’s own encrypted browser profile (separate from your system Edge/Chrome).',
    clearData:
      '<0>Clear browsing data:</0> Open the ⋯ More menu in the toolbar and choose Clear browsing data to remove cookies and site data, cache, history, saved passwords, and autofill — you choose what to remove. Your bookmarks and HoTTY settings are always kept.',
    enable:
      '<0>Enable / disable:</0> The Web tab can be turned off in <1>Settings → Features</1>.',
  },

  fileExplorer: {
    summary: 'File Explorer',
    intro:
      'Open a built-in file browser pane via <0><1></1></0> (Features) → <2>"File Explorer"</2>. Browse your drives and directories in a collapsible tree structure.',
    navigate:
      '<0>Navigate:</0> Click folders to expand/collapse. Use the breadcrumb path at the top for quick navigation.',
    openFiles: '<0>Open files:</0> Double-click a file to open it in the Text Editor.',
    hiddenFiles:
      '<0>Hidden files:</0> Toggle hidden file visibility with the eye icon in the toolbar.',
    refresh: '<0>Refresh:</0> Click the refresh button to reload the current directory.',
  },

  aiQuickStart: {
    summary: 'AI Quick Start Guide',
    intro:
      'HoTTY has built-in AI that can analyze terminal output, explain errors, suggest fixes, and even execute commands for you. Here\'s how to get started in 3 steps:',
    step1:
      '<0>Choose a provider:</0> Go to <1>Settings → AI → AI Provider</1> and select one. <2>Google AI Studio (Gemini)</2> or <3>Vertex AI</3> are recommended — see the comparison table below.',
    step2:
      '<0>Sign in:</0> The sign-in form for the selected provider appears right below the provider selector in <1>Settings → AI</1> — enter your credentials there.',
    step3:
      '<0>Start chatting:</0> Type a question, or select terminal text, right-click, and type your question in the <1>"Ask AI"</1> box.',
    outro:
      'That\'s it! You can start asking questions right away — no complex configuration needed.',
  },

  aiFeatures: {
    summary: 'AI Features Overview',
    aiChatHeading: 'AI Chat',
    aiChatIntro:
      'Click <0><1></1></0> (Features) in the tab bar → <2>"AI Chat"</2> to open the AI Chat pane. Inside it, the tab strip at the top lets you keep multiple parallel conversations — use <3>+ New chat</3> to start a fresh tab. Type your question and press <4>Ctrl + Enter</4> to send.',
    linkedTerminal:
      '<0>Watched terminals:</0> Starting AI Watch on a terminal adds it to your active AI Chat conversation — toggle it on several terminals and one conversation watches them all at once. When more than one conversation is open, AI Watch opens a picker so you choose which one watches the terminal (a terminal belongs to a single conversation; picking another moves it there). Each conversation has its own color, shared by its watched terminal tabs, its conversation tab and its header chips, so you can see which conversation watches which terminals. Each watched terminal appears as a chip next to the input; click a chip to jump to that terminal, its × to stop watching it, or the + beside the chips to add another (a disconnected terminal greys out and re-links automatically when it reconnects). When several terminals are watched, the AI routes each command to the right one; otherwise it runs on the terminal you used most recently. Use + New chat in the tab strip for a separate conversation with its own set of terminals.',
    streamWatchdog:
      '<0>Stream watchdog:</0> If an AI provider stops sending data mid-response (network drop, hung backend), the in-flight request is automatically cancelled after 3 minutes of silence and an error message appears in the chat — no more stuck "streaming" states.',
    attachImages:
      '<0>Attach images:</0> Paste an image (Ctrl + V), drop image files onto the message box, or use the paperclip button to send screenshots to the AI. PNG, JPEG, WebP and GIF are supported (up to 5 images, 5 MB each). The selected model must support image input.',
    askAiHeading: 'Ask AI (Right-Click)',
    askAiBody:
      'Select text in the terminal (or click a <0>Terminal Marker</0> to select a whole output block), then right-click and type your question in the <1>"Ask AI"</1> box — press Enter to send. HoTTY opens the AI chat with your question and the selected text.',
    interactiveHeading: 'Interactive Mode (Command Execution)',
    interactiveBody:
      'When the AI suggests a command, it can send it directly to your terminal session for execution. You\'ll see the command before it runs, so you stay in control. Whenever a suggested command is waiting for your confirmation, you can run it or click "Don\'t Execute" to decline — declining lets the AI know so it can suggest a different approach.',
    executionHeading: 'Execution Mode & Auto-Execute',
    executionBody:
      'The <0>Execution Mode chip</0> at the bottom of the AI Chat pane controls how AI-suggested commands run — choose between Ask, Auto-execute safe, or Pause. When Auto-execute is on, each command is judged and either runs automatically or waits for a manual confirmation; Pause halts the auto-run loop without changing the mode, and the chip\'s controls let you resume. Configure the consecutive execution limit and the <1>device-response idle timeout</1> (default 10 seconds; 0 disables) in <2>Settings → AI → Command Execution</2>. When a command begins with <3>sleep N</3> (e.g. <4>sleep 120 &amp;&amp; validate</4>), HoTTY waits those seconds locally instead of sending the sleep to the device — so the idle timeout doesn\'t mis-fire during the wait — then runs any chained command afterward; toggle this and its maximum delay in <5>Settings → AI</5>.',
    safetyHeading: 'Command Safety Classifier (Whitelist / Blacklist / AI)',
    safetyBody:
      'How each command is judged for auto-execution is decided by three layers, configurable in <0>Settings → AI → Command Execution</0>. The <1>Blacklist</1> is checked first — a match never auto-runs (a manual Run is still offered). The <2>Whitelist</2> auto-runs obvious read-only commands. Anything in between is sent to the <3>AI</3>, which judges whether it changes configuration; only commands judged read-only with enough confidence auto-run, everything else asks. Both lists are fully editable: a single word matches a base command (e.g. <4>docker</4>), and an entry with spaces matches as a substring (e.g. <5>rm -rf</5>, <6>git push</6>); each list has a <7>Reset to defaults</7> button. Pick the strategy (Static / AI / <8>Hybrid</8>, the default) and the AI confidence threshold in the same place. Every execute block shows how it was judged — Whitelisted, AI verdict, Blacklisted, or needs confirmation — so the decision is never hidden.',
    personasHeading: 'Personas',
    personasBody:
      'Switch between AI roles (General Helper, Network Expert, Security Analyst, etc.) using the persona selector at the top of the chat. Each persona has a system prompt tailored for that domain. Click the <0>system prompt</0> indicator to inspect the exact instruction sent to the model and copy it to the clipboard.',
    personasNetworkExpert:
      'The <0>Network Expert</0> persona auto-preps a linked terminal: when its chat is linked to a live session, it automatically identifies the device and disables paging before you ask anything. Switching the linked terminal to a different device starts a fresh chat first, while reconnecting to the same device just re-disables paging and keeps your conversation.',
  },

  watchMode: {
    summary: 'Watch Mode (AI Monitoring)',
    intro:
      'Watch Mode lets AI monitor a terminal session\'s output and analyze it on demand — ideal for long-running commands or log tailing.',
    step1:
      'Click the <0><1></1></0> icon on any terminal tab to start watching — the icon and the tab underline light up in the watching conversation\'s color. With two or more AI Chat conversations open, the icon opens a picker so you choose which conversation watches the terminal.',
    step2: 'Run commands as usual. All output is captured into a buffer.',
    step3:
      'In the linked <0>AI chat tab</0>, just type your question — or right-click terminal text and choose <1>Ask AI</1>. The captured output is automatically included for analysis.',
    tip:
      '<0>Tip:</0> Let it collect output and ask AI to summarize or find errors when you\'re ready. The buffer size limit can be adjusted in <1>Settings → AI → AI Monitor Buffer Limit</1>.',
  },

  chooseProvider: {
    summary: 'Choosing an AI Provider',
    intro:
      'HoTTY supports four AI providers. Choose the one that best fits your needs:',
    thProvider: 'Provider',
    thBestFor: 'Best For',
    thAuth: 'Auth',
    thStatus: 'Status',
    geminiName: 'Google AI Studio<0></0>(Gemini)',
    geminiBestFor: 'Personal use, free tier available',
    geminiAuth: 'OAuth2',
    geminiStatus: 'Fully tested',
    vertexName: 'Google Cloud<0></0>Vertex AI',
    vertexBestFor: 'Enterprise / production use',
    vertexAuth: 'ADC / Service Account',
    vertexStatus: 'Fully tested',
    anthropicName: 'Anthropic<0></0>(Claude)',
    anthropicBestFor: 'Claude models via API key',
    anthropicAuth: 'API Key',
    experimental: 'Experimental',
    experimentalNote: '(untested — may not work as expected)',
    openaiName: 'OpenAI',
    openaiBestFor: 'GPT models via API key',
    openaiAuth: 'API Key',
    recommendation:
      '<0>Recommendation:</0> If you\'re unsure, start with <1>Google AI Studio (Gemini)</1> — it has a free tier and is the most thoroughly tested provider.',
  },

  aiSetup: {
    summary: 'AI Setup & Authentication',
    whereHeading: 'Where do I enter my credentials?',
    whereBody1:
      'Everything lives in <0>Settings → AI</0>: pick a provider there, and that provider\'s sign-in form appears right below, together with your authentication status and a Logout button.',
    whereBody2:
      'The <0>AI Chat pane</0> itself has no credential fields — while you are not signed in, it shows an <1>Open Settings</1> button that jumps straight to the AI tab. You sign in once; HoTTY re-authenticates automatically on later launches, and signing out is the Logout button in the same place.',
    geminiHeading: 'Google AI Studio (Gemini) — Sign in with Google (OAuth2)',
    geminiIntro:
      'This provider signs in with your Google account via OAuth2 — an AI Studio <0>API key cannot be used</0>. You create your own (free) OAuth client once:',
    geminiStep1:
      'In <0>Google Cloud Console</0> (console.cloud.google.com), create or select a project, then enable the <1>Generative Language API</1> (APIs & Services → Library).',
    geminiStep2:
      'Set up the <0>OAuth consent screen</0> (APIs & Services): "External" is fine. While the app is in <1>Testing</1> mode, add your own Google account under <2>Test users</2> — without this, Google blocks the sign-in.',
    geminiStep3:
      'Create the client under APIs & Services → Credentials → <0>Create credentials → OAuth client ID</0>, application type <1>Desktop app</1>, and copy the <2>Client ID</2> and <3>Client Secret</3>. No redirect URI is needed — HoTTY listens on a temporary localhost port automatically.',
    geminiStep4:
      'In HoTTY, open <0>Settings → AI</0>, select <1>Google AI Studio (Gemini)</1> as your provider, paste the Client ID and Client Secret into the sign-in form below, and click <2>"Sign in with Google"</2>.',
    geminiStep5:
      'Your browser opens Google\'s consent page — approve access within 5 minutes. HoTTY receives the sign-in locally and the chat is ready to use.',
    geminiNote:
      'Free-tier accounts may have data used for model training. Enable billing on your Google Cloud project to opt out.',
    vertexHeading: 'Google Cloud Vertex AI — ADC or Service Account',
    vertexStep1:
      'In Google Cloud Console, enable the <0>Vertex AI API</0> for your project and make sure your account (or the service account) has the <1>Vertex AI User</1> role (roles/aiplatform.user).',
    vertexStep2:
      '<0>ADC (easiest):</0> Install the Google Cloud CLI, then run:<1></1><2>gcloud auth application-default login</2><3></3>HoTTY detects these credentials automatically.',
    vertexStep3:
      '<0>Service Account (alternative):</0> Create a JSON key under IAM & Admin → Service Accounts and save it locally; in the sign-in panel choose <1>Service Account</1> and enter the key file path.',
    vertexStep4:
      'In <0>Settings → AI</0>, enter your <1>Google Cloud Project ID</1>, select a <2>Region</2>, choose the authentication type, and click <3>Sign in</3>.',
    anthropicHeading: 'Anthropic (Claude) — API Key',
    anthropicExperimental: '( Experimental)',
    anthropicStep1:
      'Create an account at <0>console.anthropic.com</0> and add API credits — API billing is separate from a Claude.ai subscription.',
    anthropicStep2:
      'Create a key under Settings → <0>API Keys</0> and copy it right away — it is shown only once (it starts with <1>sk-ant-</1>).',
    anthropicStep3:
      'In HoTTY, open <0>Settings → AI</0>, select <1>Anthropic</1> as your provider, paste the API key, and click Sign in.',
    anthropicNote:
      'This provider is experimental and has not been fully tested. Some features (Watch Mode, Interactive Mode, etc.) may not work as expected. Please report any issues you encounter.',
    openaiHeading: 'OpenAI — API Key',
    openaiExperimental: '( Experimental)',
    openaiStep1:
      'Create an account at <0>platform.openai.com</0> and set up billing or credits — API billing is separate from ChatGPT Plus.',
    openaiStep2:
      'Create a key under <0>API keys</0> and copy it right away — it is shown only once (it starts with <1>sk-</1>).',
    openaiStep3:
      'In HoTTY, open <0>Settings → AI</0>, select <1>OpenAI</1> as your provider, paste the API key, and click Sign in.',
    openaiNote:
      'This provider is experimental and has not been fully tested. Some features (Watch Mode, Interactive Mode, etc.) may not work as expected. Please report any issues you encounter.',
    troubleshootHeading: 'If sign-in fails',
    troubleshootGemini:
      '<0>Gemini:</0> An "Access blocked" / "app has not completed verification" page means your Google account is not listed under <1>Test users</1> on the OAuth consent screen. A sign-in attempt also expires after 5 minutes — just start it again.',
    troubleshootVertex:
      '<0>Vertex AI:</0> Permission (403) errors usually mean the Vertex AI API is not enabled or the <1>Vertex AI User</1> role is missing. If ADC has expired, re-run <2>gcloud auth application-default login</2>.',
    troubleshootKeys:
      '<0>OpenAI / Anthropic:</0> 401 means the key is invalid or revoked; 429 usually means you are out of credits or rate-limited.',
    credentialsNote:
      'All credentials are encrypted with Windows DPAPI and stored locally — they are never transmitted outside your machine except to the respective AI provider.',
  },

  customizing: {
    summary: 'Customizing AI Commands & Personas',
    customPersonas:
      '<0>Custom Personas:</0> In <1>Settings → AI → Personas</1>, create personas with custom system prompts. The chosen persona is applied as the initial system instruction for every new AI chat session.',
    proactiveInvestigation:
      '<0>Proactive Investigation:</0> The AI automatically suggests terminal commands when it needs more information to fulfill your request, and can capture results for continued analysis in Watch Mode.',
  },

  themes: {
    summary: 'Themes & Appearance',
    builtIn:
      'Switch between built-in themes (<0>Dark</0>, <1>Medium</1>, <2>Light</2>) in <3>Settings → Appearance → Theme</3>.',
    customThemes:
      '<0>Custom Themes:</0> Click <1>"+ Create Custom Theme"</1> to open the theme editor. Adjust any color variable and save under a custom name. Custom themes can be edited or deleted at any time.',
    providerColors:
      '<0>AI Provider Colors:</0> The theme editor includes an <1>AI Providers</1> section for customizing the brand colors used by the Gemini, OpenAI, Anthropic, and Vertex AI icons.',
    futuristic:
      '<0>Futuristic Effects:</0> The theme editor\'s <1>Futuristic Effects</1> section adds optional neon glow on active panes and sidebar icons, glassmorphism backdrop blur on modals, and configurable icon stroke width.',
    unusedPane:
      '<0>Unused Pane Background:</0> In <1>Settings → Appearance</1>, choose a solid color or custom image to show in empty grid panes.',
    language:
      '<0>Display Language:</0> Switch the interface language in <1>Settings → General → Display language</1>. HoTTY is available in English, 日本語, 简体中文, 繁體中文, 한국어, Русский, Español, and Français — the change applies instantly. (The AI response language is set separately in the AI chat panel.)',
  },
} as const;
