/** All localStorage keys used by HoTTY, centralised to avoid magic strings. */
export const STORAGE_KEYS = {
    // UI layout
    UI_GRID_COL_SIZES:      (cols: number) => `hterm_ui_gridColSizes_${cols}`,
    UI_GRID_ROW_SIZES:      (rows: number) => `hterm_ui_gridRowSizes_${rows}`,

    // Terminal appearance
    THEME:                  'hterm_theme',

    // Hosts
    HOST_TREE:    'hterm_host_tree',
    HOST_HISTORY: 'hterm_host_history',
    USERNAME_MAP: 'hterm_username_map',

    // AI / Gemini
    GEMINI_CLIENT_ID:      'hotty_gemini_client_id',
    GEMINI_CLIENT_SECRET:  'hotty_gemini_client_secret',
    GEMINI_LANGUAGE:       'hotty_gemini_language',
    AI_SELECTED_MODEL:     'hotty_ai_selected_model',
    AI_SELECTED_MODEL_PER_PROVIDER: (provider: string) => `hotty_ai_selected_model_${provider}`,

    // AI provider selection
    VERTEXAI_PROJECT_ID:      'hotty_vertexai_project_id',
    VERTEXAI_LOCATION:        'hotty_vertexai_location',
    VERTEXAI_AUTH_TYPE:       'hotty_vertexai_auth_type',
    VERTEXAI_KEY_FILE_PATH:   'hotty_vertexai_key_file_path',
    VERTEXAI_SELECTED_REGION: 'hotty_vertexai_selected_region',

    // Ping Monitor
    PING_MONITOR_STATE: 'hotty_ping_monitor_state',

    // File Explorer
    FILE_EXPLORER_STATE: 'hotty_file_explorer_state',

    // Text Editor
    TEXT_EDITOR_STATE: 'hotty_text_editor_state',

    // AI auth
    AI_EXPLICIT_LOGOUT: 'hotty_ai_explicit_logout',

    // Update
    SKIPPED_UPDATE_VERSION: 'hotty_skipped_update_version',
    NEVER_NOTIFY_UPDATE:    'hotty_never_notify_update',

    // Font cache
    SYSTEM_FONTS_CACHE: 'hotty_system_fonts_cache',
} as const;
