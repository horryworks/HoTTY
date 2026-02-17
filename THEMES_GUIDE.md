# HoTTY Theme Configuration Guide

[日本語版はこちら (Japanese version)](file:///c:/Users/horry/development/HoTTY/THEMES_GUIDE.ja.md)

This guide explains the properties available in `src/themes.json`. Since JSON does not support comments, use this file as a reference for customizing HoTTY's appearance.

## Structure Overview

Each theme (e.g., `dark`, `light`, `medium`) consists of two main sections:
1. `variables`: CSS custom properties used across the UI components.
2. `terminal`: Specific settings for the xterm.js terminal instances.

---

## 1. Variables Section (`variables`)

These values are applied as CSS variables (e.g., `--bg-primary`).

### Backgrounds & Text
- `bg-primary`: The main background color for the application and active panes.
- `bg-secondary`: Background color for sidebars, headers, and UI elements.
- `bg-tertiary`: Background color for inactive tabs and dropdowns.
- `text-primary`: The main text color.
- `text-secondary`: Color for less important text or hints.

### Borders & Accents
- `border-color`: Color for pane borders and dividers.
- `accent-color`: Primary color for buttons, active indicators, and links.
- `accent-hover`: Hover state color for accented elements.

### Inputs & Messages
- `input-bg`: Background color for text input fields.
- `success-color`: Color used for success indicators (greenish).
- `error-color`: Color used for error messages or destructive actions (reddish).

### AI Chat (Gemini)
- `chat-msg-user-bg`: Background color for messages sent by the user.
- `chat-msg-model-bg`: Background color for messages from the AI.
- `chat-msg-user-text`: Text color for user messages.
- `chat-msg-model-text`: Text color for AI responses.
- `code-bg`: Background color for code blocks within the chat.
- `code-text`: Text color for code blocks.
- `ai-header-bg`: Background tint for the AI chat header.
- `ai-welcome-text`: Color for the large welcome heading.
- `ai-welcome-subtext`: Color for the descriptive text in the empty chat state.

### UI Components
- `select-arrow`: An SVG data URL for the dropdown arrow icon.
- `sidebar-bg`: Background color specifically for the left sidebar.
- `sidebar-btn-color`: Icon/Text color for sidebar buttons.
- `sidebar-btn-hover-bg`: Background color when hovering over sidebar buttons.
- `sidebar-btn-hover-color`: Icon/Text color when hovering over sidebar buttons.
- `tab-bg`: Background color for inactive tabs.
- `tab-text`: Text color for inactive tabs.
- `tab-active-bg`: Background color for the currently selected tab.
- `tab-active-text`: Text color for the currently selected tab.
- `tab-close-bg`: Background color for the tab's close button (default).
- `tab-close-hover-bg`: Background color for the tab's close button on hover.
- `tab-drag-indicator`: Color of the line indicating where a tab will be dropped.

### Overlays
- `pane-overlay-active`: A semi-transparent overlay applied to the focused pane.
- `pane-overlay-inactive`: A semi-transparent overlay applied to non-focused panes.

---

## 2. Terminal Section (`terminal`)

These settings directly configure the terminal emulator.

- `foreground`: The default text color inside the terminal.
- `background`: The background color for the **active/focused** terminal.
- `backgroundInactive`: The background color for **inactive/unfocused** terminals.
- `paneBackground`: The color of the space behind the terminal (visible if there is padding or empty space).

---

## How to Apply Changes

After modifying `src/themes.json`, you may need to:
1. Restart the application or reload the developer window (**Ctrl+R**).
2. If changes are not visible, go to **Settings** and re-select your theme (e.g., switch to Light and back to Dark) to force a refresh of the cached values in `localStorage`.
3. Check the **Browser Console** (if in dev mode) for any CSS variable errors.
