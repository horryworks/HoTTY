# Release Notes - HoTTY v0.1.2

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
