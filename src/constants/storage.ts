/** All localStorage keys used by HoTTY, centralised to avoid magic strings. */
export const STORAGE_KEYS = {
    // UI layout
    UI_SHOW_LEFT_SIDEBAR:   'hterm_ui_showLeftSidebar',
    UI_SHOW_RIGHT_SIDEBAR:  'hterm_ui_showRightSidebar',
    UI_SHOW_TOP_BAR:        'hterm_ui_showTopBar',
    UI_SHOW_BOTTOM_BAR:     'hterm_ui_showBottomBar',
    UI_LEFT_SIDEBAR_PCT:    'hterm_ui_leftSidebarPercent',
    UI_RIGHT_SIDEBAR_PCT:   'hterm_ui_rightSidebarPercent',
    UI_TOP_BAR_PCT:         'hterm_ui_topBarPercent',
    UI_BOTTOM_BAR_PCT:      'hterm_ui_bottomBarPercent',
    UI_LAYOUT_MODE:         'hterm_ui_layoutMode',
    UI_GRID_COL_SIZES:      (cols: number) => `hterm_ui_gridColSizes_${cols}`,
    UI_GRID_ROW_SIZES:      (rows: number) => `hterm_ui_gridRowSizes_${rows}`,

    // Terminal appearance
    THEME:                  'hterm_theme',
    FONT_SIZE:              'hterm_font_size',
    FONT_FAMILY:            'hterm_font_family',
    TERMINAL_FOREGROUND:    'hterm_terminal_foreground',
    TERMINAL_BACKGROUND:    'hterm_terminal_background',
    TERMINAL_BG_INACTIVE:   'hterm_terminal_background_inactive',
    PANE_BACKGROUND:        'hterm_pane_background',
    PANE_BACKGROUND_MODE:   'hterm_pane_background_mode',
    PANE_BACKGROUND_IMAGE:  'hterm_pane_background_image',
    CUSTOM_FOREGROUND:      'hterm_custom_terminal_foreground',
    CUSTOM_BACKGROUND:      'hterm_custom_terminal_background',
    CUSTOM_BG_INACTIVE:     'hterm_custom_terminal_background_inactive',
    CUSTOM_PANE_BG:         'hterm_custom_pane_background',
    SIDEBAR_POSITION:       'hterm_sidebar_position',

    // Terminal behaviour
    GLOBAL_ENCODING:        'hterm_global_encoding',
    LINE_WRAP_ENABLED:      'hterm_line_wrap_enabled',
    SCROLLBACK:             'hterm_scrollback',
    BACKSPACE_SENDS_DEL:    'hterm_backspace_sends_del',
    RIGHT_CLICK_PASTE:      'hterm_right_click_paste',

    // SSH / Telnet
    SSH_KEEPALIVE_ENABLED:    'hterm_ssh_keepalive_enabled',
    SSH_KEEPALIVE_INTERVAL:   'hterm_ssh_keepalive_interval',
    TELNET_KEEPALIVE_ENABLED: 'hterm_telnet_keepalive_enabled',
    TELNET_KEEPALIVE_INTERVAL:'hterm_telnet_keepalive_interval',

    // Logging
    LOGGING_ENABLED: 'hterm_logging_enabled',
    LOGGING_PATH:    'hterm_logging_path',

    // Hosts
    HOST_TREE:    'hterm_host_tree',
    HOST_HISTORY: 'hterm_host_history',
    USERNAME_MAP: 'hterm_username_map',

    // AI / Gemini
    GEMINI_CLIENT_ID:      'hotty_gemini_client_id',
    GEMINI_CLIENT_SECRET:  'hotty_gemini_client_secret',
    GEMINI_LANGUAGE:       'hotty_gemini_language',
    GEMINI_MODEL:          'hotty_gemini_model',

    // AI provider selection
    ACTIVE_AI_PROVIDER:       'hotty_active_ai_provider',
    VERTEXAI_PROJECT_ID:      'hotty_vertexai_project_id',
    VERTEXAI_LOCATION:        'hotty_vertexai_location',
    VERTEXAI_AUTH_TYPE:       'hotty_vertexai_auth_type',
    VERTEXAI_KEY_FILE_PATH:   'hotty_vertexai_key_file_path',

    // HoTTY features
    WATCH_BUFFER_LIMIT:              'hotty_watch_buffer_limit',
    SHOW_SYSTEM_PROMPT:              'hotty_show_system_prompt',
    ENABLE_PROMPT_HIGHLIGHT:         'hotty_enable_prompt_highlight',
    PROMPT_HIGHLIGHT_COLOR:          'hotty_prompt_highlight_color',
    PROMPT_PATTERNS:                 'hotty_prompt_patterns',
    AI_PERSONAS:                     'hotty_ai_personas',
    ASK_GEMINI_COMMANDS:             'hotty_ask_gemini_commands',
    PROACTIVE_INSTRUCTION:           'hotty_gemini_proactive_instruction',
    INTERACTIVE_STABILIZATION_TIMEOUT: 'hotty_interactive_stabilization_timeout',

    // Update
    SKIPPED_UPDATE_VERSION: 'hotty_skipped_update_version',
    NEVER_NOTIFY_UPDATE:    'hotty_never_notify_update',

    // Font cache
    SYSTEM_FONTS_CACHE: 'hotty_system_fonts_cache',
} as const;
