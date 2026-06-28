export const STORAGE_KEYS = {
  HOST_TREE: 'hotty_host_tree',
  GEMINI_CLIENT_ID: 'hotty_gemini_client_id',
  GEMINI_CLIENT_SECRET: 'hotty_gemini_client_secret',
  GEMINI_LANGUAGE: 'hotty_gemini_language',
  VERTEXAI_PROJECT_ID: 'hotty_vertexai_project_id',
  VERTEXAI_LOCATION: 'hotty_vertexai_location',
  VERTEXAI_AUTH_TYPE: 'hotty_vertexai_auth_type',
  VERTEXAI_KEY_FILE_PATH: 'hotty_vertexai_key_file_path',
  VERTEXAI_SELECTED_REGION: 'hotty_vertexai_selected_region',
  AI_SELECTED_MODEL: 'hotty_ai_selected_model',
  AI_SELECTED_MODEL_PER_PROVIDER: (provider: string) => `hotty_ai_selected_model_${provider}`,
  AI_EXPLICIT_LOGOUT: 'hotty_ai_explicit_logout',
  UI_GRID_COL_SIZES: (cols: number) => `hotty_ui_gridColSizes_${cols}`,
  UI_GRID_ROW_SIZES: (rows: number) => `hotty_ui_gridRowSizes_${rows}`,
  GCP_SHOW_INACCESSIBLE: 'hotty_gcp_show_inaccessible',
  GCP_SEARCH_QUERY: 'hotty_gcp_search_query',
} as const;

/**
 * Namespace a localStorage base key by window label for multi-window isolation.
 *
 * The initial window keeps the legacy unsuffixed key so existing users' persisted
 * per-window state (pane layout, grid sizes, …) survives the upgrade; only
 * secondary windows get a `::<label>` suffix. Pass the label from
 * {@link ../utils/windowLabel WINDOW_LABEL}.
 */
export function windowScopedKey(base: string, label: string): string {
  return label === 'main' ? base : `${base}::${label}`;
}
