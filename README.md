# HoTTY v1.0.9-beta3 - AI Integrated Advanced Terminal

[English] | [日本語 (Japanese)](README.ja.md)

**Current Version: v1.0.9-beta3**

Terminal emulator built with Electron, React, and TypeScript. Designed to provide a seamless terminal experience with advanced window management, deep AI integration, and extensive customization options.

## Features

- **Multi-protocol Support**: Seamlessly connect via **SSH**, **Telnet**, **Serial** port, **WSL** (Windows Subsystem for Linux), **Windows Local Shell (CMD/PowerShell)**, and **Git Bash**.
    - **Jumpbox (Bastion Host)**: Route SSH and Telnet connections through an intermediate SSH jumpbox. Mark any SSH host as a jumpbox in the host tree, then assign it to target hosts for tunneled connections.
    - **GCE IAP Tunnel**: Connect to Google Compute Engine VMs via Identity-Aware Proxy (IAP) without exposing VMs to the public internet. Autocomplete for GCP projects, zones, and instances with gcloud CLI integration.
    - **WSL Integration**: Connect directly to installed Linux distributions (Ubuntu, Debian, etc.) with automatic distribution discovery.
    - **Git Bash**: Auto-detects Git Bash installation and provides an interactive login shell session.
    - **Wide SSH Compatibility**: Supports a comprehensive range of algorithms, including ChaCha20-Poly1305, AES-GCM, DH Groups 1/14–18, 3DES, CBC/CTR ciphers, Arcfour, Blowfish, ETM HMAC variants, and all major Key Exchange methods.
- **Advanced Grid Layout**:
    - Flexible multi-pane interface with **Top/Bottom Bars** and **Left/Right Sidebars**.
    - **Layout Persistence**: Automatically saves and restores your workspace configuration (sizes, visibility, grid ratios).
    - **Smart Resizing**: Percentage-based responsive layout that adapts to any window size.
    - **Toolbar Position**: Switch the sidebar between left and right via Settings > Appearance.
    - Drag-and-drop tabs to re-organize panes.
    - Intuitive resizing including **2D intersection resizing** (drag the junction between 4 panes to resize all at once).
- **Customization**:
    - **Themes**: Built-in **Dark**, **Medium**, and **Light** themes, plus a **Custom** mode for fully independent color settings.
    - **Custom Theme Creator**: Visual theme editor lets you fine-tune every UI color interactively and save it as your own theme — no manual JSON editing required.
    - **Advanced Configuration**: Theme definitions (`themes.json`) and SSH algorithms (`ssh_algorithms.json`) are externalized to the user data folder (`%APPDATA%/HoTTY`), allowing for direct editing and advanced customization.
    - **Visual Identity**: Features a modern black "H" logo with optimized visibility across all themes (including a rounded white background for dark mode icons).
    - **Advanced Backgrounds**: Support for solid colors, tiled image patterns, or the **built-in Default logo background**.
    - **File Picker**: Easily select custom local images as your terminal background via a built-in file explorer integration.
- **Session Management**:
    - Persistent settings (fonts, encoding, colors) across sessions.
    - **SSH KeepAlive**: Stay connected to SSH hosts without timeouts.
    - **Telnet KeepAlive**: Dual-layer keepalive (TCP + Telnet NOP) to prevent idle disconnects on Telnet sessions. Configurable in Settings > Telnet.
    - **Secure Credential Handling**: SSH passwords are cached in memory only and never written to disk. A "Show Password" toggle lets you reveal saved passwords when needed.
    - **Log Viewer**: Open and view saved session log files directly inside HoTTY as a dedicated tab. Supports text/regex search, Ctrl+F to focus search, and a Refresh button to reload the current file.
- **AI Integration**:
    - **Multi-Provider Support**: Choose your AI backend from **Google Gemini** (Google AI Studio), **Vertex AI** (Google Cloud), **OpenAI**, or **Anthropic** — selectable in Settings > AI.
    - **AI Chat**: Built-in AI assistant pane for interactive terminal support.
    - **Interactive Investigation**: AI can proactively propose investigation commands, capture results, and continue analysis automatically.
    - **AI Monitor (Output Monitoring)**: Watch and record terminal output, requesting direct analysis from AI with tailored prompts (Explain, Research, Suggest Fixes).
    - **Smart Chat Scrolling**: AI responses automatically scroll to the beginning of the message for better readability of long outputs.
    - **Free Format Questions**: Ask custom questions directly from the terminal via the right-click context menu.
    - **Persona-Specific Ask Commands**: Each AI persona has its own set of Ask AI commands, allowing tailored quick actions per persona.
    - **Context Aware**: Helper for coding, debugging, or general questions within the terminal environment.
    - **Dynamic Models**: Automatically discovers available models from your selected AI provider.
    - **Reliable Command Execution**: Refined AI response parsing ensures terminal commands are always correctly extracted and executed.
    - **Auto-Execute Safe Commands**: Optionally auto-execute read-only commands (ls, cat, show, ping, etc.) suggested by AI. A built-in command safety classifier with customizable whitelist ensures only safe commands run automatically.
- **Security & Reliability**:
    - **Path Traversal Protection**: Secure `media://` protocol with path validation.
    - **Sandboxed Execution**: Enhanced security with Electron's sandbox mode.
    - **XSS Protection**: AI chat output is sanitized using DOMPurify to prevent cross-site scripting attacks.
    - **Clean Uninstallation**: Option to fully remove user data during uninstallation.
- **Text Editor**: Built-in text editor pane (open via **⊞** Features menu → **Text Editor**). Supports multi-tab editing, file open/save with encoding selection (UTF-8, ASCII, Latin-1) and line ending display (LF/CRLF), Find & Replace, Go to Line, visual line numbers (including wrapped lines), visible return code characters (toggleable via the View menu), and file association for opening files from the command line.
- **File Explorer**: Built-in file browser pane (open via **⊞** Features menu → **File Explorer**). Browse drives and directories in a tree structure, expand/collapse folders with lazy loading, toggle hidden files, and double-click files to open them directly in the Text Editor. Virtual scrolling for smooth performance with large directories.
- **Ping Monitor**: Built-in ICMP ping monitoring pane for tracking multiple hosts simultaneously. Configurable intervals (1s–60s), real-time RTT and TTL display, visual status indicators, and optional CSV log export.
- **Update Notification**: Automatically checks for new releases on GitHub at startup and shows a non-blocking banner when an update is available. Options to **Skip this version** or **Never Notify** let you control notification behavior. A download link is also shown in **Settings > About** when an update is pending.
- **Modern Tech Stack**: Built on Electron, React, and Vite for performance and stability.

## Core Concept: Synergy of Terminal & AI

HoTTY is more than just a terminal; it's designed to be a partner that works right alongside you.

- **"Watching" AI**: Enable `AI Monitor` to keep the AI informed of your terminal's output in real-time. You can ask "What just happened?" the moment an error occurs.
- **"Proactive" AI**: Using the `Interactive Investigation` feature, the AI doesn't just answer—it proposes solutions by suggesting commands and analyzing their results for you.
- **"Seamless" UI**: With the flexible 2D grid system, you can position the AI chat pane exactly where you need it without obscuring your terminal workspace.

## Installation & Getting Started

### For End Users
You can download the latest Windows installer (`.exe`) from the [Releases](https://github.com/horryworks/HoTTY/releases) page. Simply run the installer to get started.

### For Developers
If you want to build HoTTY from source:

### Prerequisites

- [Node.js](https://nodejs.org/) (Recommended version: LTS)
- **Windows Build Tools** (For native modules like `node-pty` and `serialport`):
    - Visual Studio 2022 with "Desktop development with C++" workload.
    - **Important**: "MSVC v143 - VS 2022 C++ x64/x86 Spectre-mitigated libs (Latest)" component is required.

### Installation

1. Clone or download the repository.
2. Install dependencies:
   ```bash
   npm install
   ```

### Running the Application

To start the development server and open the app:
```bash
npm run dev
```

Alternatively, you can use the provided batch files on Windows:
- `launch_dev.bat`: Starts the development environment.
- `launch.bat`: Runs the production build (if available).

## Troubleshooting

- **Image Loading**: If a custom background image does not appear, ensure the file is an image (PNG, JPG, SVG, WebP) and that the path is correctly selected via the "Browse" button in Settings.
- **SSH Connectivity**: If connections time out, check your "SSH KeepAlive" settings in the Settings modal. If an SSH connection fails with an algorithm mismatch, the error message will show the server's offered algorithms so you can enable the correct ones in Settings → Protocols → SSH Algorithms.
- **WSL Terminal**: If the WSL terminal doesn't show a prompt, ensure the distribution is correctly installed and initialized. HoTTY now uses `node-pty` for a native TTY experience.

HoTTY is a personal project. We do not accept Pull Requests, but bug reports and feature requests are welcome via [Issues](https://github.com/horryworks/HoTTY/issues). Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

Copyright (c) 2026 HoTTY Contributors.
Licensed under the [GPL-3.0-or-later](LICENSE).
