# Release Notes

## v2.0.0-beta4

Fourth beta release, focused on jumpbox tunneling, auto-update notifications, safer editing workflows, and security hardening.

### New Features

- **SSH/Telnet Jumpbox (bastion) tunneling** — connect through an SSH bastion host to a target SSH or Telnet server via `direct-tcpip` channel forwarding, with its own host-key verification and keyboard-interactive auth
- **Auto-update notification** — on startup, checks the GitHub releases API for a newer version and shows a dismissible notification linking to the release page
- **Unsaved changes prompt** — Text Editor now shows a Save / Discard / Cancel modal when closing a tab or quitting with unsaved edits, backed by a dirty-editor tracker shared across panes
- **AI System Prompt viewer** — inspect the effective system instruction sent to the current AI persona, with copy-to-clipboard support
- **React Error Boundary** — top-level error boundary catches renderer crashes and shows a recoverable fallback instead of a blank window

### Improvements

- **Telnet service** — refactored connection path to share the jumbox tunnel abstraction with SSH, unifying transport handling
- **tauriService** — added typed wrappers for the new updater and jumpbox commands
- **useResize hook** — small ergonomics improvements for pane drag-to-resize
- **App shell** — composed UpdateNotification, SaveConfirmModal, SystemPromptModal, and ErrorBoundary into the top-level layout

### Security

- **SSH credential validation** — added length caps (host, username, password, passphrase) in `SshConfig::validate` to reject malformed or oversized inputs before they reach the SSH stack
- **Log viewer TOCTOU mitigation** — re-canonicalizes the resolved path immediately before reading and re-checks the allowed-directory guard, preventing symlink swap attacks between the check and the read
- **Font enumeration unsafe hardening** — added null-pointer and alignment validation in the Windows font-enumeration callback before dereferencing OS-supplied pointers

### Housekeeping

- **Removed unused asset** — deleted `public/HoTTY_logo.png` (not referenced by the app)
- **Added tests** — new unit tests for the dirty-editor tracker utility

## v2.0.0-beta3

Third beta release, focused on theme customization, UI refinements, and expanded test coverage.

### New Features

- **Custom Theme Creator** — in-app editor to create user-defined themes by adjusting any CSS variable, with save/edit/delete support from the Appearance tab
- **Help Tooltip component** — contextual help hints embedded next to settings and controls
- **Versioned window title** — main window title now includes the current application version

### Improvements

- **Settings modal** — refined styling across all tabs (Appearance, General, Features, Protocols, AI, About) for visual consistency
- **Settings store** — extended with additional feature toggles and configuration options
- **Sidebar icon spacing** — tightened and balanced icon layout in the app sidebar
- **Removed deprecated ConnectForm** — fully superseded by the Session Dialog; legacy component and styles deleted
- **Expanded test coverage** — added tests for AI chat panels, Ask AI modal, authentication panels, theme utilities, and color/HTML helpers
- **Help modal** — documentation updated to cover the new Custom Theme Creator workflow

### Bug Fixes

- **Modal CSS consistency** — unified padding, border-radius, and animation timing across PasteConfirmationModal, SettingsModal, and HelpModal
- **Pane toolbar consistency** — aligned TextEditorPane and PingMonitorPane toolbars with the standard 36px toolbar spec

## v2.0.0-beta2

Second beta release with AI integration, connection management UI, and enhanced utility panes.

### New Features

- **AI Chat pane** — multi-provider AI chat with streaming responses, personas, and token cost tracking
- **AI providers** — support for Google AI Studio (Gemini), Vertex AI, Anthropic (Claude), and OpenAI (GPT) with provider-specific authentication
- **AI backend services** — Rust-based AI provider infrastructure with SSE streaming support
- **Ask AI modal** — right-click terminal text to query AI with built-in or custom commands
- **AI Settings tab** — configure AI provider, model, personas, Ask AI commands, command execution mode, and monitor buffer limits
- **AI Interactive Mode** — AI can suggest and execute terminal commands with safety classification (safe/destructive/unknown)
- **AI Watch Mode** — monitor terminal output and send captured logs to AI for analysis
- **Host Tree** — connection management UI with folders, drag-and-drop reordering, and host tree export/import
- **Session Dialog** — connection dialog for creating and editing SSH, Telnet, Serial, WSL, Local, and Git Bash sessions with jumpbox and IAP tunnel support
- **Help modal** — comprehensive in-app documentation covering all features, shortcuts, and AI setup guides
- **Confirm modal** — reusable confirmation dialog for destructive actions
- **Command classifier** — categorizes terminal commands as safe, destructive, or unknown for AI auto-execution decisions
- **AI token pricing** — per-model pricing data for cost estimation across all supported providers

### Improvements

- **Text Editor** — major enhancement with find & replace, go-to-line, sub-tabs for multiple files, encoding/line-ending selection, line wrap, return code visualization, and file association support
- **File Explorer** — improved navigation with breadcrumb path, hidden file toggle, drive browsing, and double-click to open in editor
- **Ping Monitor** — enhanced with configurable intervals, log output, and improved layout
- **Log Viewer** — improved with search/filter, regex toggle, and better file browsing
- **Tab Bar** — updated with feature pane tab support and improved drag-and-drop
- **Settings store** — extended with AI settings, enabled features, and additional configuration options
- **Session manager** — updated to support AI chat terminal integration
- **App icons** — refreshed application icons across all platforms (Windows, macOS, iOS, Android)
- **New utility hooks** — useFocusTrap, useModalState, useResize for improved UI interactions
- **ANSI utilities** — added ANSI code processing functions for terminal output handling
- **Color and HTML utilities** — added helper functions for color manipulation and HTML processing

## v2.0.0-beta1

First functional beta of the Rust/Tauri rewrite. This release replaces the Electron-based HoTTY with a Tauri v2 backend for improved memory efficiency and performance.

### New Features

- **Multi-protocol connections** — SSH, Telnet, Serial, WSL, and local shell (cmd, PowerShell, Git Bash)
- **SSH host key verification** — fingerprint display with accept/reject prompt for new and changed host keys
- **SSH private key authentication** — support for key file and passphrase
- **SSH algorithm configuration** — configurable KEX, cipher, MAC, and host key algorithms
- **Serial port support** — configurable baud rate, data bits, parity, stop bits, and flow control
- **WSL distribution selection** — connect to any installed WSL distribution
- **Multi-pane layout** — grid layouts (1x1, 1x2, 2x1, 2x2, 2x3, 3x2) with collapsible sidebars on all four edges
- **Tab bar** — drag-and-drop reordering, session and feature pane tabs
- **Log Viewer pane** — browse and read session log files
- **Text Editor pane** — open, edit, and save files with line ending detection
- **File Explorer pane** — browse directories and drives, open files in the text editor
- **Ping Monitor pane** — monitor multiple targets with configurable intervals and log output
- **Theming** — built-in Dark, Medium, and Light themes with custom theme support
- **Settings modal** — tabbed interface with Appearance, General, Features, Protocols, and About sections
- **Windows DPAPI encryption** — secure credential storage for saved connections
- **Paste confirmation** — modal to review clipboard content before pasting into terminal
- **Session logging** — per-session log output to file
- **Host tree export/import** — encrypted .htree format for connection configuration backup
- **GCE IAP tunnel** — connect to Google Cloud instances via Identity-Aware Proxy
- **Encoding support** — UTF-8, Shift_JIS, and EUC-JP per session
- **Keepalive** — configurable keepalive interval for SSH and Telnet connections
- **System font detection** — list and select installed system fonts for terminal rendering
- **Context menu** — right-click context menu support
- **Debug log management** — view and open debug log folder

### Improvements

- **Rust/Tauri v2 backend** — complete rewrite from Electron for lower memory usage and faster startup
- **Zustand state management** — persistent settings via Zustand with localStorage middleware
- **Typed IPC layer** — all Tauri commands wrapped in tauriService.ts with full TypeScript types
- **Comprehensive test coverage** — Vitest tests for all frontend components, hooks, and services

## v0.1.1

Scaffold-only version bump. No functional changes.

## v0.1.0

- Initial Tauri v2 project scaffold with migration spec.
