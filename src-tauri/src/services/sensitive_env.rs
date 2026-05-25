// Filter environment variables that may carry credentials before inheriting
// the process env into a child process (gcloud, wsl.exe, local shell). Shared
// by `gcloud_iap`, `local`, and `wsl` so the allow-list stays in one place.

const SENSITIVE_PATTERNS: &[&str] = &[
    "API_KEY",
    "SECRET",
    "TOKEN",
    "PASSWORD",
    "PASSWD",
    "PASSPHRASE",
    "CREDENTIAL",
    "PRIVATE_KEY",
    "ACCESS_KEY",
    // SSH_AUTH_SOCK, AUTH_TOKEN, *_AUTH, etc. Inheriting SSH_AUTH_SOCK into
    // wsl.exe in particular gives the WSL user access to the host SSH agent.
    "AUTH",
    // OP_SESSION_* (1Password), session pointers in general.
    "SESSION",
    // Pointers to credential files — not secrets themselves but expose the
    // credential indirectly when inherited.
    "AWS_PROFILE",
    "KUBECONFIG",
];

pub fn is_sensitive_env_var(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    SENSITIVE_PATTERNS.iter().any(|pat| upper.contains(pat))
}

pub fn sanitized_env() -> Vec<(String, String)> {
    std::env::vars()
        .filter(|(k, _)| !is_sensitive_env_var(k))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catches_basic_credential_patterns() {
        assert!(is_sensitive_env_var("OPENAI_API_KEY"));
        assert!(is_sensitive_env_var("GITHUB_TOKEN"));
        assert!(is_sensitive_env_var("AWS_SECRET_ACCESS_KEY"));
        assert!(is_sensitive_env_var("DB_PASSWORD"));
        assert!(is_sensitive_env_var("MYSQL_PASSWD"));
        assert!(is_sensitive_env_var("GOOGLE_APPLICATION_CREDENTIALS"));
        assert!(is_sensitive_env_var("SSH_PRIVATE_KEY"));
    }

    #[test]
    fn catches_auth_and_session_carriers() {
        assert!(is_sensitive_env_var("SSH_AUTH_SOCK"));
        assert!(is_sensitive_env_var("OP_SESSION_abc123"));
        assert!(is_sensitive_env_var("KEY_PASSPHRASE"));
    }

    #[test]
    fn catches_credential_file_pointers() {
        assert!(is_sensitive_env_var("AWS_PROFILE"));
        assert!(is_sensitive_env_var("KUBECONFIG"));
    }

    #[test]
    fn case_insensitive() {
        assert!(is_sensitive_env_var("openai_api_key"));
        assert!(is_sensitive_env_var("Ssh_Auth_Sock"));
    }

    #[test]
    fn lets_benign_vars_through() {
        assert!(!is_sensitive_env_var("PATH"));
        assert!(!is_sensitive_env_var("HOME"));
        assert!(!is_sensitive_env_var("USERPROFILE"));
        assert!(!is_sensitive_env_var("APPDATA"));
        assert!(!is_sensitive_env_var("LANG"));
    }

    #[test]
    fn sanitized_env_excludes_sensitive() {
        std::env::set_var("TEST_SENSITIVE_API_KEY", "secret");
        std::env::set_var("TEST_BENIGN_PATH_LIKE", "value");
        let env = sanitized_env();
        assert!(!env.iter().any(|(k, _)| k == "TEST_SENSITIVE_API_KEY"));
        assert!(env.iter().any(|(k, _)| k == "TEST_BENIGN_PATH_LIKE"));
        std::env::remove_var("TEST_SENSITIVE_API_KEY");
        std::env::remove_var("TEST_BENIGN_PATH_LIKE");
    }
}
