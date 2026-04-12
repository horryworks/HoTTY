# Release Notes

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
