# HoTTY

**Current Version: v0.1.5 (Latest)**

HoTTY is a modern, high-performance terminal emulator built with Electron, React, and TypeScript. It is designed to provide a seamless terminal experience with advanced window management and customization options.

## Features

- **Multi-protocol Support**: Seamlessly connect via **SSH**, **Telnet**, and **Serial** port.
- **Advanced Grid Layout**: 
    - Flexible multi-pane interface.
    - Drag-and-drop tabs to re-organize panes.
    - Intuitive resizing including **2D intersection resizing** (drag the junction between 4 panes to resize all at once).
- **Customization**:
    - **Themes**: Built-in **Dark**, **Medium**, and **Light** themes, plus a **Custom** mode for independent color settings.
    - **Visual Identity**: Features a modern black "H" logo with optimized visibility across all themes (including a rounded white background for dark mode icons).
    - **Advanced Backgrounds**: Support for solid colors or tiled image patterns.
    - **File Picker**: Easily select custom local images as your terminal background via a built-in file explorer integration.
- **Session Management**:
    - Persistent settings (fonts, encoding, colors) across sessions.
    - **SSH KeepAlive**: Stay connected to remote hosts without timeouts.
    - **Secure Credential Handling**: SSH passwords are cached in memory only and never written to disk.
- **AI Integration**:
    - **Gemini Chat**: Built-in AI assistant pane powered by Google Gemini.
    - **Context Aware**: Helper for coding, debugging, or general questions within the terminal environment.
    - **Dynamic Models**: Automatically creates a list of available models from your API key.
- **Security & Reliability**:
    - **Path Traversal Protection**: Secure `media://` protocol with path validation.
    - **Sandboxed Execution**: Enhanced security with Electron's sandbox mode.
    - **Clean Uninstallation**: Option to fully remove user data during uninstallation.
- **Modern Tech Stack**: Built on Electron, React, and Vite for performance and stability.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (Recommended version: LTS)

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
- **SSH Connectivity**: If connections time out, check your "SSH KeepAlive" settings in the Settings modal.

## License

Copyright (c) 2026 HoTTY Contributors.
