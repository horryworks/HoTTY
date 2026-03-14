# HoTTY Theme Configuration Guide

[日本語版はこちら (Japanese version)](file:///c:/Users/horry/development/HoTTY/THEMES_GUIDE.ja.md)

This guide explains the properties available in theme files. Each theme is defined as an individual JSON file (e.g., `dark.json`, `medium.json`, `light.json`) located in the `resources/` directory of the application.


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
- `text-on-accent`: Text color used on top of accent-colored elements (e.g., buttons).

### Borders & Accents
- `border-color`: Color for pane borders and dividers.
- `accent-color`: Primary color for buttons, active indicators, and links.
- `accent-hover`: Hover state color for accented elements.
- `accent-light`: A lighter variation of the accent color.
- `accent-secondary`: A secondary accent color for additional highlights.
- `active-pane-color`: Color used to highlight the currently active terminal pane.

### Inputs, Buttons & Hovers
- `input-bg`: Background color for text input fields and setting rows.
- `btn-bg`: Background color for standard buttons.
- `btn-hover-bg`: Background color for standard buttons on hover.
- `btn-secondary-bg`: Background color for secondary buttons (e.g., Cancel).
- `btn-secondary-hover-bg`: Hover background for secondary buttons.
- `btn-danger-bg`: Background color for destructive action buttons.
- `btn-danger-hover-bg`: Hover background for danger buttons.
- `hover-bg`: General hover background for list items or interactive rows.
- `placeholder-color`: Color for placeholder text in input fields.

### Status & Signals
- `success-color`: Color used for success indicators (connection established, etc.).
- `error-color`: General color for error messages.
- `color-danger`: Color indicating destructive actions or errors.
- `color-danger-bg`: Background tint for danger elements.
- `color-danger-border`: Border color for danger elements.
- `color-warning`: Color for warning or attention-required text.

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

### UI Specific Components
- `select-arrow`: An SVG data URL for the dropdown arrow icon.
- `sidebar-bg`: Background color specifically for the left sidebar.
- `sidebar-btn-color`: Icon/Text color for sidebar buttons (default).
- `sidebar-btn-hover-bg`: Background color when hovering over sidebar buttons.
- `sidebar-btn-hover-color`: Icon/Text color when hovering over sidebar buttons.
- `sidebar-btn-active-bg`: Background color for the currently selected sidebar button.
- `tab-bg`: Background color for inactive tabs.
- `tab-text`: Text color for inactive tabs.
- `tab-active-bg`: Background color for the currently selected tab.
- `tab-active-text`: Text color for the currently selected tab.
- `tab-close-bg`: Color of the tab's close button.
- `tab-close-hover-bg`: Hover color of the tab's close button.
- `tab-drag-indicator`: Color of the line indicating tab insertion position.
- `context-menu-bg`: Background for right-click menus.
- `context-menu-border`: Border for right-click menus.
- `context-menu-text`: Text color for right-click menus.
- `context-menu-hover-bg`: Hover background for menu items.
- `hidden-item-bg`: Special background for hidden items (debug/admin).
- `tree-meta-color`: Color for metadata in list views (e.g., file sizes).
- `icon-folder`: Color for folder icons in the host tree.
- `icon-host`: Color for host/connection icons in the host tree.

### Search & Highlight
- `search-highlight-bg`: Background tint for lines that contain a search match.
- `search-highlight-current-bg`: Background for the currently focused search match line.
- `search-highlight-current-border`: Outline color for the currently focused match line.
- `search-highlight-mark-bg`: Background highlight for the matched text span inside a line.
- `search-highlight-mark-solid`: Solid background for the matched text span on the currently focused line.
- `search-highlight-mark-text`: Text color for highlighted match spans.

### Overlays & Modals
- `modal-overlay-bg`: Background dimming for modal dialogs.
- `modal-shadow`: Shadow effects for modals.
- `modal-header-info-bg`: Header background for info modals.
- (Additional specific variants like `modal-header-warning-*` also exist)

---

## 2. Terminal Section (`terminal`)

These settings directly configure the terminal emulator (xterm.js).

- `foreground`: Default text color inside the terminal.
- `background`: Background color for the **active/focused** terminal.
- `backgroundInactive`: Background color for **inactive/unfocused** terminals.
- `paneBackground`: Color of the space surrounding the terminal.

---

## How to Apply Changes

After modifying a theme JSON file, you may need to:
1. Restart the application or reload the developer window (**Ctrl+R**).
2. If changes are not visible, go to **Settings** and re-select your theme (e.g., switch to Light and back to Dark) to force a refresh.
3. Check the **Browser Console** (if in dev mode) for any CSS variable errors.
