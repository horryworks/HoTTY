# HoTTY

**AI-Integrated Advanced Terminal Emulator** built with Rust (Tauri v2) + React + TypeScript.

HoTTY is a multi-protocol terminal emulator for Windows that supports SSH, Telnet, Serial, WSL, and local shell (cmd / PowerShell / Git Bash) connections. It features a multi-pane layout, integrated utility tools, theming, and session logging.

> This is a ground-up rewrite of [HoTTY (Electron)](https://github.com/horryworks/HoTTY) using Tauri v2 for significantly improved memory efficiency and performance.

## Features

### Multi-Protocol Connections
- **SSH** with host key verification, private key authentication, and configurable algorithms
- **Telnet** with encoding support (UTF-8, Shift_JIS, EUC-JP)
- **Serial** with configurable baud rate, data bits, parity, stop bits, and flow control
- **WSL** with distribution selection
- **Local shells** — cmd, PowerShell, and Git Bash

### Multi-Pane Layout
- Flexible grid layouts: 1x1, 1x2, 2x1, 2x2, 2x3, 3x2
- Collapsible sidebars on all four edges (left, right, top, bottom)
- Keyboard pane focus navigation (`Ctrl+Tab` / `Ctrl+Shift+Tab`)
- Drag-and-drop tab reordering and pane assignment
- Tab bar with session and feature pane management

### Integrated Utility Tools
- **Log Viewer** — browse and read session log files
- **Text Editor** — open, edit, and save files with line ending support
- **File Explorer** — browse directories and drives, open files in the editor
- **Ping Monitor** — monitor multiple targets with configurable intervals

### Theming & Appearance
- Built-in themes: Dark, Medium, Light
- Custom theme support with full CSS variable control
- Configurable font family and font size

### Localization
- Multilingual UI with an in-app **Display language** selector (Settings → General)
- 8 languages: English, 日本語, 简体中文, 繁體中文, 한국어, Русский, Español, Français — switches instantly, no restart

### Security & Credentials
- Windows DPAPI encryption for stored credentials
- SSH host key verification with fingerprint display
- Paste confirmation modal for clipboard content review

### Session Management
- Per-session encoding selection
- Session logging to file
- Connection host tree export/import (encrypted .htree format)

### AI Integration
- Multi-provider support: Google AI Studio (Gemini), Vertex AI, Anthropic (Claude), OpenAI (GPT)
- AI Chat pane with streaming responses, personas, and token cost tracking
- Ask AI — right-click terminal output to query AI with built-in or custom commands
- Interactive Mode — AI suggests and executes terminal commands, gated by a managed Whitelist / Blacklist + AI safety classifier
- Watch Mode — monitor terminal output and send captured logs to AI for analysis
- Customizable personas and Ask AI commands

### Additional Features
- GCE IAP tunnel support for Google Cloud instances
- SSH algorithm configuration (KEX, cipher, MAC, host key)
- System font detection
- Context menu support
- Debug log management

## Installation

Download the latest installer from the [Releases](https://github.com/horryworks/HoTTY/releases) page.

## Development

### Prerequisites
- [Node.js](https://nodejs.org/) (LTS)
- [Rust](https://www.rust-lang.org/tools/install) (1.77.2+)
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)

### Commands

```bash
npm install              # Install frontend dependencies
npm run tauri:dev        # Start dev server + Tauri window
npm run tauri:build      # Production build with installer
npm run test             # Run frontend tests (Vitest)
npm run lint             # Run ESLint
cd src-tauri && cargo test   # Run backend tests
cd src-tauri && cargo clippy # Run Clippy lints
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, TypeScript, Vite |
| Backend | Rust, Tauri v2 |
| Terminal | @xterm/xterm |
| State | Zustand (with persist middleware) |
| Testing | Vitest (frontend), cargo test (backend) |

## License

GPL-3.0-or-later
