# Release Notes - HoTTY

## [v0.1.15-beta6] - 2026-03-09
### Added
- **Interactive AI Improvements**:
    - **Multi-Timer Prevention**: Implemented a "clear-and-reserve" logic for the stabilization timer to prevent duplicate AI requests during rapid terminal output.
    - **Customizable Timeout**: Added an input field in Settings > AI to customize the interactive stabilization timeout (default: 10,000ms).
    - **Cancellation Sync**: Cancelling the "Waiting" state in AI chat now immediately stops background terminal tracking, resolving issues with persistent commands like `top`.
- **UI Refinements**:
    - **Settings Layout**: Moved "Proactive Investigation Instruction" directly below "Personas" in the AI settings tab for a more logical configuration flow.
- **Improved Prompt Detection**:
    - Implemented strict whole-line matching for prompt detection patterns to eliminate false positives from terminal output content.

## [v0.1.14-beta5] - 2026-03-08
### Added
- **Interactive AI Investigation**:
    - AI can now proactively propose investigation commands (e.g., `show version`).
    - **Interactive AI Investigation**: AI can now proactively propose investigation commands, automatically capture terminal output, and continue analysis.
- **Enhanced Stability**: Added a "silence detection" (300ms delay) during output capture to ensure full command results are received before analysis.
- **Improved Prompt Detection**: Refined ANSI/OSC stripping and strict suffix matching for more reliable command completion detection.
- **Wait Diagnostics**: The waiting indicator now displays real-time elapsed time and received data volume.
- **Manual Controls**: "Cancel" and "Send Now" buttons added to the waiting state for manual intervention.
- **Smart Chat Scrolling**: Long AI responses now automatically scroll to the beginning of the message for improved readability.
- **Prompt Detection Robustness**: Fixed specific edge cases in CMD and PowerShell prompt detection.
- **Data Listener Stability**: Refactored the terminal data listener to prevent data loss.
 or stale state issues during rapid output.

## [v0.1.14-beta4] - 2026-03-08
### Added
- **Watch Gemini**:
    - Introduced a "Watch" (👁️) feature for terminal sessions. When enabled, terminal output is recorded into an in-memory buffer.
    - **Tab Ask Button**: A new "✨ Ask" button appears on watched tabs. Clicking it opens a context menu with "Analyze Watched Output" and custom Gemini commands.
    - **Smart Buffer Limit**: Added a "Watch Buffer Limit" setting in Settings > AI to control the size of the recorded context (default: 500,000 characters).
- **Refined AI Tab Activation**: Clicking "Ask Gemini" now automatically focuses the target terminal tab before opening the AI chat to ensure correct context.
- **Improved UI Visuals**:
    - Replaced Watch status emojis with clean, theme-aware SVG icons.
    - Added a gentle pulsing animation to the active Watch icon for better visibility.
- **Ask Button Safety**: The ✨ Ask button is automatically disabled when the watch buffer is empty to prevent non-actionable states.

### Fixed
- **Context Menu Context**: Fixed an issue where the wrong terminal context was read when using "Ask Gemini" from background tabs.
- **Clean Context Menus**: Removed unnecessary options like "Paste" when opening Gemini menus from the tab bar ✨ button.

### Added
- **Gemini Logout**: Added a "Logout from Gemini" button in Settings > AI. This allows you to securely clear your Google authentication token.
- **Auto-Close AI Tabs**: When logging out from Gemini, all open AI chat tabs are now automatically closed for security and workspace cleanup.

### Security Enhancements
- **Content Security Policy (CSP)**: Implemented a strict CSP to mitigate XSS risks and restrict unauthorized script execution.
- **Capability-based Media Access**: Refactored the `media://` protocol to use a secure token-based lookup system. This replaces the vulnerable `authorizeMediaPath` IPC and prevents unauthorized access to local files.

## [v0.1.14-beta2] - 2026-03-08
### Fixed
- **Context Menu Interaction**: Fixed an issue where the context menu would stay open after selecting the "Export" option. The menu now closes automatically when the export password prompt appears.
- **Visual Cleanup**: Removed a redundant separator line that appeared at the top of the host-specific context menu.

## [v0.1.14-beta1] - 2026-03-04
### Added
- **Telnet KeepAlive**:
    - Implemented dual-layer keepalive for Telnet connections to prevent idle timeouts.
    - **TCP Keepalive**: OS-level connection health monitoring via `socket.setKeepAlive()`.
    - **Telnet NOP**: Periodically sends IAC NOP (`0xFF 0xF1`) to reset server-side idle timers.
    - Default interval: 30 seconds (configurable).
- **Telnet Settings Tab**: Added a dedicated "Telnet" tab in Settings for KeepAlive configuration (enable/disable checkbox and interval input).
- **Toolbar Position**: Added a "Toolbar Position" option in Settings > Appearance to switch the sidebar between Left and Right.

### Fixed
- **Close Button Consistency**: Unified the close button styling between the Settings modal and the New Connection dialog (matching font size, color, and removing the focus ring).

## [v0.1.13] - 2026-02-23
### Fixed
- **Terminal Marker Rendering**:
    - Fixed an issue where markers (orange/blue) were interrupted on long wrapped lines.
    - Improved consistency of output markers on empty lines within command outputs.
    - Resolved the issue of redundant markers remaining below the cursor in WSL and PowerShell by simplifying the marker lifecycle logic.

### Changed
- **Cleanup**:
    - Removed unnecessary test scripts (`test.js`) and backup files (`README.ja.md.bak`) to keep the project clean.


## [v0.1.12] - 2026-02-22
### Fixed
- **Host Tree Indentation**:
    - Fixed a bug where the indentation of deeply nested host entries was too large due to cumulative `paddingLeft` from wrapper `div` elements.
    - Moved `paddingLeft` from the outer `host-tree-node` wrapper to the `host-tree-row` element directly, ensuring each level adds exactly 14px regardless of nesting depth.
    - Hosts under deep folders (e.g., Global → APAC → Japan) now display at the same relative indentation as shallow hosts (e.g., Local → WSL local).

### Changed
- **Code Maintenance**:
    - Translated the remaining Japanese comment in `electron/main/index.ts` to English.

## [v0.1.11] - 2026-02-20
### Added
- **Top and Bottom Bars**:
    - Added toggleable **Top Bar** and **Bottom Bar** to the workspace.
    - Bars function like standard panes (drop tabs into them) but span the full width of the central grid.
    - Ideal for status monitoring, input fields, or dedicated tools.
- **Layout Persistence**:
    - The application now remembers your layout configuration across restarts!
    - **Persisted Settings**:
        - Visibility and size (percentage) of Left/Right Sidebars and Top/Bottom Bars.
        - Grid Layout Mode (1x1, 2x2, etc.).
        - Relative sizes of grid panes (dragged ratios).
    - **Smart Resizing**: Sidebars and Bars now use **percentage-based sizing**, ensuring your layout proportions remain consistent even when resizing the application window.
- **Host Manager**:
    - The **New Connection** dialog now features a two-panel layout.
    - **Left panel**: Tree-based host manager supporting unlimited nested folders (e.g., Global → APAC → Japan).
    - Hosts save protocol, host/IP, port, username, and password persistently.
    - **Right-click** tree nodes to Add Folder, Add Host, Rename, or Delete.
    - Clicking a saved host auto-fills the connection form. Credentials update automatically on Connect.

### Fixed
- **Tab-Pane Mapping**:
    - Fixed an issue where the "Show Tab-Pane Mapping" arrows were not displayed when tabs were placed in the Sidebars, Top Bar, or Bottom Bar.
- **Unread Data Indicator**:
    - Fixed an issue where terminal tabs placed in the Sidebars, Top Bar, or Bottom Bar did not turn red to indicate unread activity when their respective bar was hidden.

### Changed
- **UI Refinements**:
    - **Corner Priority**: Sidebars (Left/Right) now take vertical priority over Top/Bottom bars, creating a "sandwiched" center layout.
    - **Gap Consistency**: Unified spacing (2px) between all panes, sidebars, and bars for a cleaner look.
    - **Layout Selector**: Added icons for toggling Top/Bottom bars.
- **Terminal Allocation**:
    - **Fallback Allocation**: When the main grid is full, new terminal sessions will now automatically open in empty outer bars (if visible) in the following priority order: Left Sidebar -> Right Sidebar -> Top Bar -> Bottom Bar.



## [v0.1.11-beta2] - 2026-02-19
### Fixed
- **Installer Fixes**:
    - Fixed an issue where configuration files (`themes.json`, `ssh_algorithms.json`) were not included in the installer.
    - Changed the configuration storage location to the user data folder (e.g., `%APPDATA%`) to ensure settings are saved correctly.
- **Startup Issue Fix**:
    - Fixed an issue where the application would hang on a black screen at startup (due to missing IPC definitions).
- **Improved Backspace key compatibility for network devices**:
    - Changed default Backspace character from `0x7f` (DEL) to `0x08` (BS) for **SSH, Telnet, and Serial** sessions.
    - Kept `0x7f` (DEL) as default for WSL and local shells (CMD, PowerShell) to maintain compatibility with Unix-like environments.
    - Added "Backspace sends 0x7F (DEL)" option in Settings > System for cases where DEL is required.

### Added
- **SSH Algorithm Customization**: Added menu in Settings > SSH to individually enable/disable SSH Key Exchange, Cipher, Server Host Key, and HMAC algorithms.
- **External Configuration Files**: Separated theme definitions (`themes.json`) and SSH algorithm definitions (`ssh_algorithms.json`) as external resources. Users can now edit these files in the user data folder for advanced customization.
- **Settings UI improvements**: Reordered tabs (System, Appearance, SSH, AI, About) and moved Network settings to a dedicated "SSH" tab.


## [v0.1.10] - 2026-02-19
### Added
- **Multi-Window Support**: You can now open multiple HoTTY windows simultaneously. Clicking the app icon or running a second instance will open a new independent window.
- **Improved IPC Architecture**: Refactored internal communication to ensure each window manages its own sessions and AI chat independently.

## [v0.1.9] - 2026-02-18
### Added
- **Windows Local Shell Support**: Added direct connection to Command Prompt (CMD) and PowerShell.
- **PTY Implementation**: Integrated `node-pty` for perfect terminal experience (Backspace, Arrow keys, Ctrl+C support).
- **WSL Enhancement**: Refactored WSL connection to use `node-pty` for better stability and resizing.
- **SSH**: Externalized supported algorithms to `ssh_algorithms.json` with multi-tier fallback support.
- **SSH**: Added `enabled` flag to each SSH algorithm in the configuration file for granular control.

## [0.1.8] - 2026-02-18

### Added
- **WSL Connection Support**: Connect directly to Windows Subsystem for Linux (WSL) distributions.
  - Automatically lists installed distributions.
  - Implements a TTY simulation using the `script` command to ensure interactive shells work correctly without heavy dependencies.

### Changed
- **SSH UX Improvements**:
  - Replaced technical authentication error messages with a more user-friendly: "Username or password may be incorrect."
  - Suppressed redundant error popups for normal disconnections (e.g., "Connection closed by server").
- **Terminal Interaction**:
  - **Custom Ctrl+C Behavior**: If text is selected in the terminal, pressing `Ctrl+C` will now only clear the selection. This prevents accidental SIGINT signals from being sent to the remote process when you just want to copy/deselect.
- **Maintenance**:
  - Updated all documentation (README, Release Notes) to reflect the new connectivity options.

## [0.1.7] - 2026-02-17

### Added
- **Themes Guide**: Added [THEMES_GUIDE.md](file:///c:/Users/horry/development/HoTTY/THEMES_GUIDE.md) and [THEMES_GUIDE.ja.md](file:///c:/Users/horry/development/HoTTY/THEMES_GUIDE.ja.md) to explain the properties in `themes.json`.
- **Default Background Mode**: Added a "Default" option for empty pane backgrounds, allowing users to easily restore the original HoTTY logo background without manual file selection.
- **Further Improved SSH Compatibility**: Resolved the "Unknown DH group" error observed on certain devices by explicitly allowing all Key Exchange algorithms. This ensures even better connectivity with legacy network devices and industrial hardware.

### Changed
- **Visual Improvements**:
  - **Dark Theme**: Set active terminal background to pure black (`#000000`) for maximum contrast.
  - **Medium Theme**: Swapped active and inactive background colors for better consistency; removed unnecessary white overlays to ensure intended color depth.
  - **Light Theme**: Corrected a typo in `paneBackground`.
- **Code Maintenance**:
  - All source code comments have been translated from Japanese to English for global maintainability.
  - Removed non-ASCII separators and characters from the codebase.
- **Reliability**:
  - Improved theme application logic to correctly load values from `themes.json` and override potentially stale `localStorage` data on application startup.

## [0.1.6] - 2026-02-15

### Changed
- **Persona System Improvements**:
  - Fixed an issue where "Ask Gemini" would default to the "General Helper" persona instead of the selected one.
  - Ensured that the System Prompt is properly sent with manual chat messages, preserving the selected persona during conversation.
  - Removed the redundant Persona dropdown in the manual input area for a cleaner UI.
- **UI/UX Refinements**:
  - Reordered the "Settings -> AI" tabs to "Ask Gemini Commands", "Personas", and "Debugging".
  - Fixed text wrapping issues for "Show System Prompt" and "Enable Logging" labels in Settings.
- **AI Content Enriched**:
  - **New Commands**: Added "Explain code", "Interpret log", "Root cause analysis", and "Fix this" commands with improved prompt templates.
  - **New Personas**: Added "Security Analyst" persona.
  - **Refined Personas**: Updated "Network/Server/Cloud/Coding Expert" system prompts to be more specific and professional.
- **Installer Improvements**:
  - **Silent Updates**: The installer no longer asks to delete user data during silent installations (e.g., auto-updates). The prompt only appears during manual uninstallation.

## [0.1.5] - 2026-02-15

### Changed
- **Visual Refinements**:
  - Replaced the icon on the Setting -> About page with the official app icon (icon.png).
  - Added a white rounded background to the logo on the About page to ensure visibility for transparent icons on dark backgrounds.
  - Standardized the window and browser tab icons with the latest logo.

## [0.1.4] - 2026-02-14

### Added
- **Security Hardening**:
  - Implemented path validation for the `media://` protocol to prevent path traversal vulnerabilities.
  - Enabled Electron sandbox for all windows.
  - Added input validation for internal IPC handlers.
- **Uninstaller Improvements**:
  - Added an option to completely remove user data (settings, credentials, history) during uninstallation.
- **AI Integration**:
  - The default AI model is now "Unspecified" on startup.
  - Added a UI guard that disables the "Send" button until a model is selected, with a clear error message in English.

### Changed
- **Visual Refinements**:
  - Updated application icon to the new black "H" logo.
  - Refined tab close button: Now a red circle with a perfectly centered SVG cross.
  - Sidebar Refactoring: Moved "Show Tab-Pane Mapping" to the top group and aligned "Line Wrap" to the bottom. Replaced emoji icons with theme-aware SVG icons.
- **Customization**:
  - Added "Inactive Terminal Background" setting for Custom themes, allowing distinct background colors for active vs. inactive panes.

## [0.1.3] - 2026-02-14

### Changed
- **Default Theme**: Changed the default theme to "Medium" for a balanced visual experience.
- **Medium Theme Polishing**:
  - Fixed CSS variable definitions to ensuring consistent styling across all panes (including Gemini).
  - Improved color contrast for better readability.
- **App Icon**: Fixed the application icon configuration to ensure it appears correctly in the Windows taskbar and installer.
- **Settings UI**:
  - **Ask Gemini Commands**:
    - Fixed text area overflow issue.
    - Added drag-and-drop support for reordering commands.

## [0.1.2] - 2026-02-14

### Added
- **Log Saving**:
  - Enable auto-logging of terminal sessions to local text files.
  - Configurable log folder path with native directory picker.
  - Logs are named with timestamp, protocol, and host (e.g., `YYYYMMDDHHMMSS-SSH-192.168.1.1.txt`).
- **Local Log Buffer Control**:
  - Configurable scrollback limit (default 10,000 lines) to manage memory usage.
  - Auto-trimming of old logs from memory when the limit is exceeded.
- **Line Wrap Toggle**:
  - New sidebar button to toggle connecting line wrapping on/off.
  - **Horizontal Scrolling**: When line wrap is disabled, a horizontal scrollbar appears for long lines.

### Changed
- **Settings UI**: Added a dedicated "System" tab for logging and buffer settings.

## [0.1.1] - 2026-02-13

### Added
- **Dynamic AI Model Loading**: Automatically fetches available Gemini models from your Google account (e.g., Gemini 1.5 Pro, 2.0 Flash).
- **Theme System**: Full support for Light, Dark, and Custom themes with persistent color settings.
- **Settings Organization**: Split settings into "Appearance" and "Network" tabs for better navigation.

### Changed
- **UI Refinements**:
  - Standardized dropdown arrow sizing and positioning across all dialogs.
  - Adjusted modal overlay opacity for a more consistent look.
  - Made Settings and Connection dialogs scrollable for better accessibility on small screens.
- **AI Chat Experience**:
  - Chat state (history, input) is now preserved when moving the AI pane between grid slots.
  - Improved model fallback logic to ensure validity.

## [0.1.0] - 2026-02-13

### Added
- **Multi-protocol Support**: Full integration for SSH, Telnet, and Serial (COM) port connections.
- **Advanced Grid Layout**: Flexible multi-pane interface with drag-and-drop tab support.
- **2D Intersection Resizing**: Simultaneously resize 4 panes by dragging their intersection point.
- **Enhanced Visuals**:
  - Customizable terminal foreground and background colors.
  - Background image support for empty panes with tiling/repeat capability.
  - Built-in file explorer for easy background image selection.
- **Improved Resizer UX**: Wider resizer hitboxes (8px) and context-aware cursors (↔︎/↕︎/move).
- **Session Management**:
  - Persistent settings for fonts, encoding, and colors.
  - In-memory password caching for secure session resumption.
  - Configurable SSH KeepAlive to prevent idle disconnects.
 - **Installer**: Official Windows NSIS installer version 0.1.0.

### Changed
- Refactored core architecture to use `ISessionService` for better maintainability.
- Simplified `App.tsx` by delegating state management to custom hooks (`useSessionManager`, `usePaneManager`).
- Increased default resizer width from 4px to 8px for better accessibility.

### Technical Improvements
- Migrated to React 19 + Vite 7 stack.
- Improved local file loading through custom `media://` protocol in the Main process.
- Cleaner `.gitignore` configuration for production distribution.
