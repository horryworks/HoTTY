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
- **Multiple windows** — open additional windows (New Window / `Ctrl+Shift+N`) in a single process; each window has its own panes and sessions, while settings, theme, host tree and bookmarks stay shared and in sync across windows

### Integrated Utility Tools
- **Log Viewer** — browse and read session log files
- **Text Editor** — open, edit, and save files with line ending support
- **File Explorer** — browse directories and drives, open files in the editor
- **Ping Monitor** — monitor multiple targets with configurable intervals
- **File Server** — built-in TFTP & SFTP servers for uploading firmware/config to network devices (e.g. Cisco), with path-jailed serving and Windows Firewall detection
- **Web Browser** — embedded browser pane (Edge WebView2) for network-device web admin UIs, opened from New Session → Web with folder-organized bookmarks; keeps login sessions, can save/autofill passwords, supports per-page zoom, and can clear browsing data (cookies, cache, history, passwords) on demand

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
- Fixed terminal size — pin the terminal to the width negotiated at connect for devices that latch it and ignore later resizes (e.g. Huawei USG/VRP); auto-detected by default, with per-connection and per-tab overrides
- Session logging to file
- Connection host tree export/import (encrypted .htree format)

### AI Integration
- Multi-provider support: Google AI Studio (Gemini), Vertex AI, Anthropic (Claude), OpenAI (GPT)
- AI Chat pane with streaming responses, personas, and token cost tracking
- Ask AI — select terminal output, right-click, and type a free-form question to send it (with the selection) to the AI Chat
- Interactive Mode — AI suggests and executes terminal commands, gated by a managed Whitelist / Blacklist + AI safety classifier
- Watch Mode — monitor terminal output and send captured logs to AI for analysis
- Cross-window linking — link an AI Chat to a terminal running in another window
- One-time data-sharing disclosure shown before terminal data is first sent to a provider (reviewable in Settings → AI)
- Customizable personas

### Additional Features
- GCE IAP tunnel support for Google Cloud instances
- SSH algorithm configuration (KEX, cipher, MAC, host key)
- System font detection
- Context menu support
- Debug log management
- Third-Party Licenses viewer (Settings → About)

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

## Privacy / Data Handling

HoTTY runs locally and does **not** collect telemetry, analytics, or usage data.
The only network calls it makes on its own are an optional update check against
the GitHub Releases API.

When you use the **AI features** (AI Chat, Ask AI, Interactive Mode, Watch Mode),
data is sent to the third-party AI provider you configured (Google Gemini /
Vertex AI, Anthropic, or OpenAI) using **your own API key**, under that
provider's terms and privacy policy:

- **What is sent:** the messages you type, and — when you use Ask AI or enable
  Watch Mode — the relevant terminal output / commands captured from the session.
- **When:** only when you explicitly invoke an AI feature. HoTTY does not stream
  your terminal continuously.
- **Redaction:** known secret patterns are redacted from logs by default, but
  text you place into a chat message yourself is sent as-is — avoid pasting
  credentials into AI prompts.

On first use of an AI feature, HoTTY shows a one-time consent dialog summarizing
the above. Credentials and API keys are stored encrypted at rest via Windows
DPAPI.

## Trademarks

HoTTY is an independent project and is **not affiliated with, endorsed by, or
sponsored by** PuTTY, Tera Term, or any other terminal-emulator project. All
product names, logos, and trademarks referenced in this software or its
documentation are the property of their respective owners and are used for
identification purposes only.

## Export / Cryptography Notice

This software contains and uses encryption (SSH, TLS) provided by third-party
open-source libraries. It is distributed as publicly available open-source
software and the source is published openly; as such it is generally eligible
for the publicly-available-source exception under applicable export-control
regulations (e.g. U.S. EAR §742.15(b) / §740.13(e), and Japan's Foreign
Exchange and Foreign Trade Act). **You are responsible for complying with the
import, export, and use regulations of your own jurisdiction.**

## License

GPL-3.0-or-later

> The notices above are provided for transparency and are **not legal advice**.
> Consult a qualified professional for matters that require it.
