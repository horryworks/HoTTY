//! Generating, listing and deleting SSH keys in the user's `~/.ssh`.
//!
//! ## This module never takes a path from the renderer
//!
//! `path_safety::is_sensitive_path` blocks `~/.ssh` outright, and it must keep
//! doing so: the File Server, the AI connect path and the log viewer all rely on
//! it. Rather than carving an exception into that shared guard, the write and
//! delete commands here accept a **file name** and build the path themselves.
//! Path traversal, UNC, SMB resolution during `canonicalize`, and symlink escape
//! then have nowhere to enter, because no renderer string ever becomes a path
//! except through `key_path_for`, which validates first.
//!
//! `is_managed_key_path` is a belt-and-braces assertion for the same reason a
//! compiler still bounds-checks a loop you can see is in range.
//!
//! ## Keys are written in the clear, on purpose
//!
//! Unlike the SFTP host key (DPAPI-sealed, `sftp_server`), a user's key is a
//! plain OpenSSH file. `ssh::try_authenticate` reads it with `load_secret_key`
//! straight off the path, and so do PuTTY, WinSCP and `ssh.exe`. Sealing it
//! would mean a decrypt path in both `ssh` and `jumpbox` and a key nothing else
//! on the machine could use. Protection is the ACL (`file_perms`) plus whatever
//! passphrase the user chose.
//!
//! ## Nothing here logs a path, a name, a comment or a fingerprint
//!
//! A user's key names, and the comments inside them (usually an email address),
//! are their own business -- and the debug log is a file we ask people to attach
//! to bug reports.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use russh::keys::ssh_key::public::KeyData;
use russh::keys::ssh_key::{HashAlg, LineEnding, PublicKey};
use russh::keys::PrivateKey;
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

use crate::services::atomic_file::atomic_write;
use crate::services::file_perms::{restrict_to_owner, OwnerOnly};
use crate::services::os_paths::home_dir;
use crate::services::path_safety::is_unc_path;

/// Long enough for `id_ed25519_some-host-name`, short enough that a name cannot
/// be used to push a path near any OS limit.
const MAX_KEY_NAME_LEN: usize = 64;

/// Windows refuses these as file names whatever the extension, and a create
/// attempt on one opens the device instead of failing cleanly.
const RESERVED_DEVICE_STEMS: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// Files that live in `~/.ssh` but are not keys. Listing any of these would at
/// best confuse the view and at worst invite someone to delete it.
const NON_KEY_FILE_NAMES: &[&str] = &[
    "known_hosts",
    "known_hosts.old",
    "config",
    "authorized_keys",
    "authorized_keys2",
    "environment",
    "rc",
    "ssh_keys.json",
];

/// Suffixes that mark a file as a companion or a leftover rather than a key.
const NON_KEY_SUFFIXES: &[&str] = &[".pub", ".old", ".bak", ".tmp", ".swp", ".hotty-new"];

#[derive(Debug, thiserror::Error)]
pub enum SshKeyError {
    #[error("Enter a name for the key")]
    EmptyName,
    #[error("That name is too long")]
    NameTooLong,
    #[error("A key name can only contain letters, digits, dot, underscore and hyphen")]
    NameHasInvalidCharacters,
    #[error("A key name cannot start with a dot")]
    NameStartsWithDot,
    #[error("A key name cannot end with a dot")]
    NameEndsWithDot,
    #[error("Names ending in .pub belong to public keys")]
    NameIsPublicKey,
    #[error("That name is reserved by Windows")]
    NameIsReservedDevice,
    #[error("Cannot find your home folder")]
    NoHome,
    #[error("SSH keys are unavailable because your home folder is on a network path")]
    HomeIsNetworkPath,
}

// ---------------------------------------------------------------------------
// Name validation
// ---------------------------------------------------------------------------

/// Whether `name` is acceptable as a file name directly inside `~/.ssh`.
///
/// This is the whole trust boundary for the write and delete paths. Path
/// separators and drive letters fall outside the permitted character set, so
/// they are refused without needing a rule of their own.
pub(crate) fn validate_key_name(name: &str) -> Result<(), SshKeyError> {
    if name.is_empty() {
        return Err(SshKeyError::EmptyName);
    }
    if name.len() > MAX_KEY_NAME_LEN {
        return Err(SshKeyError::NameTooLong);
    }
    if !name
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
    {
        return Err(SshKeyError::NameHasInvalidCharacters);
    }
    if name.starts_with('.') {
        return Err(SshKeyError::NameStartsWithDot);
    }
    if name.ends_with('.') {
        // Windows silently strips a trailing dot, so `id_x.` and `id_x` would be
        // one file wearing two names.
        return Err(SshKeyError::NameEndsWithDot);
    }
    if name.contains("..") {
        return Err(SshKeyError::NameHasInvalidCharacters);
    }
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".pub") {
        // We derive the public-key name ourselves; accepting one here would let
        // a caller reach the wrong half of a pair.
        return Err(SshKeyError::NameIsPublicKey);
    }
    let stem = lower.split('.').next().unwrap_or(&lower);
    if RESERVED_DEVICE_STEMS.contains(&stem) {
        return Err(SshKeyError::NameIsReservedDevice);
    }
    Ok(())
}

/// The public-key file name for a private key name. One place, so the two halves
/// of a pair can never be derived differently.
pub(crate) fn public_key_name(name: &str) -> String {
    format!("{name}.pub")
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/// `<home>/.ssh`, as a logical path -- it may not exist yet.
///
/// A network home is refused outright rather than handled: `icacls` semantics
/// change over SMB, so we could not keep the ACL promise this feature is built
/// on. A key we cannot protect is worse than no key management at all.
pub(crate) fn ssh_dir() -> Result<PathBuf, SshKeyError> {
    let dir = home_dir().ok_or(SshKeyError::NoHome)?.join(".ssh");
    if is_unc_path(&dir.to_string_lossy()) {
        return Err(SshKeyError::HomeIsNetworkPath);
    }
    Ok(dir)
}

/// The only place a renderer-supplied string becomes a path.
pub(crate) fn key_path_for(name: &str) -> Result<PathBuf, SshKeyError> {
    validate_key_name(name)?;
    Ok(ssh_dir()?.join(name))
}

/// Whether `resolved` names a file directly inside `ssh_root`.
///
/// Pure, and takes the root as an argument, so it can be tested against a
/// scratch directory without going near a real `~/.ssh`.
///
/// Depth one only: the parent must **equal** the root. `starts_with` would
/// accept `<root>/sub/key`, and a plain string-prefix test would additionally
/// accept a sibling directory whose name merely begins with the root's.
///
/// Both arguments must be canonicalized, or neither. On Windows `canonicalize`
/// returns the verbatim spelling even for an ordinary local file, so comparing a
/// canonicalized path against a raw root never matches -- that mismatch is
/// exactly the bug that would reject every legitimate key. `canonical_pair`
/// exists so callers do not have to remember.
///
/// A `.pub` sibling is accepted here, because deleting a pair has to reach both
/// halves. Whether a particular caller may touch the public half is its own
/// decision.
pub(crate) fn is_managed_key_path(resolved: &Path, ssh_root: &Path) -> bool {
    if resolved.parent() != Some(ssh_root) {
        return false;
    }
    let Some(name) = resolved.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    let stem = name.strip_suffix(".pub").unwrap_or(name);
    validate_key_name(stem).is_ok()
}

/// Canonicalize a path and a root together, so the two are comparable.
///
/// Fails when either does not exist, which is the right answer for a delete:
/// there is nothing to authorize.
pub(crate) fn canonical_pair(path: &Path, root: &Path) -> std::io::Result<(PathBuf, PathBuf)> {
    Ok((path.canonicalize()?, root.canonicalize()?))
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SshKeyFormat {
    /// `-----BEGIN OPENSSH PRIVATE KEY-----`. The only format whose public half
    /// is readable without the passphrase.
    Openssh,
    /// Any other `-----BEGIN ... PRIVATE KEY-----`. `load_secret_key` reads
    /// these, but an encrypted one tells us nothing until it is unlocked.
    Pem,
    /// PuTTY's own format. `load_secret_key` reads v2 and v3.
    Ppk,
    Unknown,
}

/// Identify a key file from its first line alone.
///
/// Used when a parse fails, so the list can say "PuTTY key" rather than
/// "unreadable" -- and so a file that is not a key at all can be dropped.
pub(crate) fn classify_key_bytes(bytes: &[u8]) -> SshKeyFormat {
    // A key file's first line is short; 128 bytes covers every marker below.
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(128)]);
    let head = head.trim_start();
    if head.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----") {
        return SshKeyFormat::Openssh;
    }
    if head.starts_with("PuTTY-User-Key-File-") {
        return SshKeyFormat::Ppk;
    }
    if head.starts_with("-----BEGIN ") && head.contains("PRIVATE KEY-----") {
        return SshKeyFormat::Pem;
    }
    SshKeyFormat::Unknown
}

/// Whether a `~/.ssh` entry should be skipped when listing keys.
///
/// Erring toward skipping is right: a missed key is a nuisance, whereas listing
/// `known_hosts` as a key invites someone to delete it.
pub(crate) fn is_probably_not_a_key(file_name: &str) -> bool {
    let lower = file_name.to_ascii_lowercase();
    if lower.starts_with('.') {
        return true;
    }
    if NON_KEY_FILE_NAMES.contains(&lower.as_str()) {
        return true;
    }
    NON_KEY_SUFFIXES.iter().any(|s| lower.ends_with(s))
}

// ---------------------------------------------------------------------------
// Ledger -- which keys this app created
// ---------------------------------------------------------------------------

/// The record of keys HoTTY generated, so destructive actions stay confined to
/// them. Stored beside the app's other state, **not** in `~/.ssh`: a key removed
/// by some other tool should not take its ledger entry with it. Nothing in here
/// is secret -- a name, a date, an algorithm and a *public* fingerprint -- so it
/// is not DPAPI-sealed either.
///
/// Marking our keys by their comment was the alternative, and is not sound: a
/// comment is user-editable, so any key could claim to be ours.
#[derive(Debug, Default, Serialize, Deserialize)]
pub(crate) struct Ledger {
    pub version: u32,
    pub keys: Vec<LedgerEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LedgerEntry {
    pub name: String,
    /// RFC3339.
    pub created_at: String,
    pub algorithm: String,
    /// `SHA256:...` of the public key, captured at generation time.
    pub fingerprint: String,
}

pub(crate) const LEDGER_VERSION: u32 = 1;
pub(crate) const LEDGER_FILE_NAME: &str = "ssh_keys.json";

/// An unreadable ledger is an empty one.
///
/// Fail-open here, unlike the encryption paths, because the direction is
/// reversed: an empty ledger **removes** permission -- every key lists as
/// unmanaged and cannot be deleted -- rather than granting it. Failing closed
/// would mean one corrupt byte makes the user's own keys undeletable forever.
pub(crate) fn parse_ledger(raw: &str) -> Ledger {
    serde_json::from_str(raw).unwrap_or_default()
}

/// Whether the ledger authorizes deleting `name`.
///
/// Three values must agree: the fingerprint the ledger recorded when we
/// generated the key, the fingerprint of the file on disk right now, and the one
/// the renderer is asking us to delete.
///
/// The on-disk comparison is the one that earns its keep. Without it: HoTTY
/// generates `id_ed25519_hotty`, the user later runs `ssh-keygen` over the same
/// name, and HoTTY cheerfully deletes a key it never made. The renderer's value
/// catches the smaller case of a stale list.
pub(crate) fn ledger_allows_delete(
    ledger: &Ledger,
    name: &str,
    on_disk_fingerprint: &str,
    expected_fingerprint: &str,
) -> bool {
    if on_disk_fingerprint != expected_fingerprint {
        return false;
    }
    ledger
        .keys
        .iter()
        .any(|e| e.name == name && e.fingerprint == on_disk_fingerprint)
}

// ---------------------------------------------------------------------------
// Ledger I/O
// ---------------------------------------------------------------------------

fn ledger_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    let _ = std::fs::create_dir_all(&dir);
    Ok(dir.join(LEDGER_FILE_NAME))
}

/// Read the ledger, treating every failure as "no keys are ours".
pub(crate) fn read_ledger(app: &AppHandle) -> Ledger {
    let Ok(path) = ledger_path(app) else {
        return Ledger::default();
    };
    std::fs::read_to_string(&path)
        .map(|raw| parse_ledger(&raw))
        .unwrap_or_default()
}

fn write_ledger(app: &AppHandle, ledger: &Ledger) -> Result<(), String> {
    let path = ledger_path(app)?;
    let raw = serde_json::to_vec_pretty(ledger).map_err(|e| e.to_string())?;
    atomic_write(&path, &raw).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Types crossing the IPC boundary
// ---------------------------------------------------------------------------

/// What to generate. An enum rather than a string plus a bit count, so an
/// unsupported combination cannot be expressed at the boundary at all.
///
/// The wire names are spelled out rather than derived: `rename_all` would turn
/// `Rsa2048` into `rsa2048` while `EcdsaP256` became `ecdsa-p256`, and the
/// TypeScript union has to match exactly. A round-trip test pins every one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SshKeyAlgorithm {
    #[serde(rename = "ed25519")]
    Ed25519,
    #[serde(rename = "ecdsa-p256")]
    EcdsaP256,
    #[serde(rename = "ecdsa-p384")]
    EcdsaP384,
    #[serde(rename = "ecdsa-p521")]
    EcdsaP521,
    #[serde(rename = "rsa-2048")]
    Rsa2048,
    #[serde(rename = "rsa-3072")]
    Rsa3072,
    #[serde(rename = "rsa-4096")]
    Rsa4096,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyInfo {
    /// The file name inside `~/.ssh`. This, not `path`, is the handle every
    /// other command takes.
    pub name: String,
    /// Absolute path. For display, and to fill the session dialog's key field.
    pub path: String,
    /// `ssh-ed25519`, `ssh-rsa`, `ecdsa-sha2-nistp256`... `None` when the key
    /// could not be parsed and had no public half to read.
    pub algorithm: Option<String>,
    /// RSA modulus size. Meaningless for the other algorithms, which have one
    /// size each.
    pub bits: Option<u32>,
    pub fingerprint: Option<String>,
    pub comment: Option<String>,
    /// Whether the private key is passphrase-protected.
    pub encrypted: bool,
    pub format: SshKeyFormat,
    pub has_public_file: bool,
    /// In the ledger with a matching fingerprint, so destructive actions are
    /// permitted. A key made by some other tool is always `false`.
    pub managed: bool,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyListResult {
    /// False when there is nowhere safe to keep keys -- a network home, or no
    /// home at all. The UI then explains rather than showing an empty list.
    pub available: bool,
    pub unavailable_reason: Option<String>,
    pub ssh_dir: Option<String>,
    pub keys: Vec<SshKeyInfo>,
    /// The directory held more entries than we were willing to walk.
    pub truncated: bool,
}

/// A directory with more entries than this is not a key store, and walking it
/// would stall the settings tab.
const MAX_LISTED_KEYS: usize = 200;

/// An RSA-4096 OpenSSH private key is about 3.4 KB. Anything past this is not a
/// key we can use, and reading it would only waste memory on someone's data.
const MAX_KEY_FILE_BYTES: u64 = 64 * 1024;

/// A comment ends up on the single line the user pastes into `authorized_keys`,
/// so it must not carry a newline.
const MAX_COMMENT_LEN: usize = 128;

fn validate_comment(comment: &str) -> Result<(), String> {
    if comment.len() > MAX_COMMENT_LEN {
        return Err("That comment is too long".into());
    }
    if comment.chars().any(|c| c.is_control()) {
        // A newline here would split the public key into two lines, and the
        // second one would silently become garbage in authorized_keys.
        return Err("A comment cannot contain line breaks".into());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/// Fill in whatever a public key can tell us. Used for both the `.pub` sibling
/// and the public half carried inside an OpenSSH private key.
fn describe_public(pk: &PublicKey, info: &mut SshKeyInfo) {
    info.algorithm = Some(pk.algorithm().as_str().to_string());
    info.fingerprint = Some(pk.fingerprint(HashAlg::Sha256).to_string());
    let comment = pk.comment();
    if !comment.is_empty() {
        info.comment = Some(comment.to_string());
    }
    if let KeyData::Rsa(rsa) = pk.key_data() {
        if let Some(n) = rsa.n.as_positive_bytes() {
            info.bits = Some((n.len() * 8) as u32);
        }
    }
}

fn read_key_info(dir: &Path, name: &str, ledger: &Ledger) -> SshKeyInfo {
    let priv_path = dir.join(name);
    let pub_path = dir.join(public_key_name(name));
    let has_public_file = pub_path.is_file();

    let mut info = SshKeyInfo {
        name: name.to_string(),
        path: priv_path.to_string_lossy().into_owned(),
        algorithm: None,
        bits: None,
        fingerprint: None,
        comment: None,
        encrypted: false,
        format: SshKeyFormat::Unknown,
        has_public_file,
        managed: false,
        created_at: None,
    };

    // Prefer the public half. It carries everything the list shows, and reading
    // it means another tool's private key never enters this process at all.
    if has_public_file {
        if let Ok(pk) = PublicKey::read_openssh_file(&pub_path) {
            describe_public(&pk, &mut info);
        }
    }

    if let Ok(bytes) = std::fs::read(&priv_path).map(Zeroizing::new) {
        info.format = classify_key_bytes(&bytes);
        // An OpenSSH private key keeps its public half in the clear, so this
        // works on a passphrase-protected key too -- which is the whole reason
        // the list can show a fingerprint without asking for anything. PEM and
        // PPK do not, so an encrypted one of those stays unidentified unless a
        // `.pub` sits beside it.
        if let Ok(pk) = PrivateKey::from_openssh(bytes.as_slice()) {
            info.encrypted = pk.is_encrypted();
            if info.fingerprint.is_none() {
                describe_public(pk.public_key(), &mut info);
            }
        }
    }

    if let Some(fp) = &info.fingerprint {
        if let Some(entry) = ledger
            .keys
            .iter()
            .find(|e| e.name == name && &e.fingerprint == fp)
        {
            info.managed = true;
            info.created_at = Some(entry.created_at.clone());
        }
    }
    info
}

/// List the keys in `~/.ssh`. Read-only, and blocking -- callers run it off the
/// async runtime.
pub fn list_keys(app: &AppHandle) -> SshKeyListResult {
    let dir = match ssh_dir() {
        Ok(d) => d,
        Err(e) => {
            return SshKeyListResult {
                available: false,
                unavailable_reason: Some(e.to_string()),
                ssh_dir: None,
                keys: Vec::new(),
                truncated: false,
            }
        }
    };

    let ledger = read_ledger(app);
    let mut keys = Vec::new();
    let mut truncated = false;

    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if keys.len() >= MAX_LISTED_KEYS {
                truncated = true;
                break;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_probably_not_a_key(&name) {
                continue;
            }
            // symlink_metadata, not metadata: a junction pointing at
            // ~/.aws/credentials must be judged on the link's own type, before
            // anything follows it.
            let Ok(meta) = entry.path().symlink_metadata() else {
                continue;
            };
            if !meta.is_file() || meta.len() > MAX_KEY_FILE_BYTES {
                continue;
            }
            keys.push(read_key_info(&dir, &name, &ledger));
        }
    }

    keys.sort_by(|a, b| a.name.cmp(&b.name));
    SshKeyListResult {
        available: true,
        unavailable_reason: None,
        ssh_dir: Some(dir.to_string_lossy().into_owned()),
        keys,
        truncated,
    }
}

/// Read the single-line public key for `name`, for the clipboard and the
/// `authorized_keys` box.
///
/// There is deliberately no counterpart that reads a private key.
pub fn read_public_key(name: &str) -> Result<String, String> {
    validate_key_name(name).map_err(|e| e.to_string())?;
    let dir = ssh_dir().map_err(|e| e.to_string())?;
    let pub_path = dir.join(public_key_name(name));
    let raw = std::fs::read_to_string(&pub_path)
        .map_err(|_| "Could not read the public key file".to_string())?;
    Ok(raw.trim().to_string())
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

struct GeneratedKey {
    pem: Zeroizing<String>,
    public_line: String,
    algorithm: String,
    bits: Option<u32>,
    fingerprint: String,
}

/// The CPU-bound half of generation. Blocking: RSA-4096 takes seconds.
fn build_key(
    algorithm: SshKeyAlgorithm,
    comment: &str,
    passphrase: Option<Zeroizing<String>>,
) -> Result<GeneratedKey, String> {
    use rand::RngCore;
    use russh::keys::ssh_key::private::{
        Ed25519Keypair, Ed25519PrivateKey, KeypairData, RsaKeypair,
    };
    use russh::keys::ssh_key::{Algorithm, EcdsaCurve};

    let key = match algorithm {
        SshKeyAlgorithm::Ed25519 => {
            // Same recipe as the SFTP host key in `sftp_server`: 32 OS-random
            // bytes, since rand 0.8's OsRng cannot satisfy ssh-key's CryptoRng
            // bound but can still fill a seed.
            let mut seed = [0u8; 32];
            rand::rngs::OsRng.fill_bytes(&mut seed);
            let kp = Ed25519Keypair::from(Ed25519PrivateKey::from_bytes(&seed));
            PrivateKey::new(KeypairData::Ed25519(kp), comment)
                .map_err(|_| "Could not create the key".to_string())?
        }
        SshKeyAlgorithm::EcdsaP256 | SshKeyAlgorithm::EcdsaP384 | SshKeyAlgorithm::EcdsaP521 => {
            let curve = match algorithm {
                SshKeyAlgorithm::EcdsaP256 => EcdsaCurve::NistP256,
                SshKeyAlgorithm::EcdsaP384 => EcdsaCurve::NistP384,
                _ => EcdsaCurve::NistP521,
            };
            let mut rng = rand_v010::rng();
            let mut key = PrivateKey::random(&mut rng, Algorithm::Ecdsa { curve })
                .map_err(|_| "Could not create the key".to_string())?;
            key.set_comment(comment);
            key
        }
        SshKeyAlgorithm::Rsa2048 | SshKeyAlgorithm::Rsa3072 | SshKeyAlgorithm::Rsa4096 => {
            let bits = match algorithm {
                SshKeyAlgorithm::Rsa2048 => 2048,
                SshKeyAlgorithm::Rsa3072 => 3072,
                _ => 4096,
            };
            // `PrivateKey::random` fixes RSA at its own default size, so the
            // keypair is built directly to honour the user's choice.
            // rand 0.10 here because ssh-key's RSA keygen needs a matching
            // rand_core major -- see the note in Cargo.toml.
            let mut rng = rand_v010::rng();
            let kp = RsaKeypair::random(&mut rng, bits)
                .map_err(|_| "Could not create the key".to_string())?;
            PrivateKey::new(KeypairData::Rsa(kp), comment)
                .map_err(|_| "Could not create the key".to_string())?
        }
    };

    // Read the public details before encrypting: they are identical either way,
    // and this keeps the borrow simple.
    let public = key.public_key();
    let algorithm_name = public.algorithm().as_str().to_string();
    let fingerprint = public.fingerprint(HashAlg::Sha256).to_string();
    let bits = match public.key_data() {
        KeyData::Rsa(rsa) => rsa.n.as_positive_bytes().map(|n| (n.len() * 8) as u32),
        _ => None,
    };
    let public_line = public
        .to_openssh()
        .map_err(|_| "Could not encode the public key".to_string())?;

    let key = match passphrase {
        Some(pp) if !pp.is_empty() => {
            let mut rng = rand_v010::rng();
            key.encrypt(&mut rng, pp.as_bytes())
                .map_err(|_| "Could not protect the key with that passphrase".to_string())?
        }
        _ => key,
    };

    let pem = key
        .to_openssh(LineEnding::LF)
        .map_err(|_| "Could not encode the key".to_string())?;

    Ok(GeneratedKey {
        pem,
        public_line,
        algorithm: algorithm_name,
        bits,
        fingerprint,
    })
}

/// Write a new private key, refusing to touch an existing file.
///
/// `atomic_file::atomic_write` is deliberately not used: it overwrites by
/// design, which is right for a known_hosts file and wrong for a private key.
///
/// The ACL is tightened on the temporary file, *before* the rename, so a file
/// with loose permissions never exists at the final path -- not even for the
/// moment between two syscalls.
async fn write_new_private_key(path: &Path, pem: &Zeroizing<String>) -> Result<(), String> {
    use std::io::Write;

    // Append rather than `with_extension`, which *replaces* an existing
    // extension: a key named `key.2026` would otherwise stage through
    // `key.hotty-new` and could collide with a different key's staging file.
    let tmp = path.with_file_name(format!(
        "{}.hotty-new",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("key")
    ));
    // `create_new` is atomic, so there is no window between checking and
    // creating. It also detects two windows generating the same name at once.
    let mut file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&tmp)
        .map_err(|_| "Could not create the key file".to_string())?;
    let write_result = file
        .write_all(pem.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|_| "Could not write the key file".to_string());
    drop(file);
    if let Err(e) = write_result {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }

    // Fail closed. A key the user believes is protected, but which anyone on the
    // machine can read, is the worst outcome here -- and a key generated one
    // moment ago has never been used, so deleting it costs nothing.
    if let Err(e) = restrict_to_owner(&tmp, OwnerOnly::File).await {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Could not lock down the key file: {e}"));
    }

    if path.exists() {
        let _ = std::fs::remove_file(&tmp);
        return Err("A key with that name already exists".to_string());
    }
    std::fs::rename(&tmp, path).map_err(|_| {
        let _ = std::fs::remove_file(&tmp);
        "Could not save the key file".to_string()
    })
}

/// Generate a key pair in `~/.ssh` and record it in the ledger.
pub async fn generate_key(
    app: &AppHandle,
    name: &str,
    algorithm: SshKeyAlgorithm,
    comment: &str,
    passphrase: Option<Zeroizing<String>>,
) -> Result<SshKeyInfo, String> {
    validate_comment(comment)?;

    // `key_path_for` validates the name; nothing else in this module turns a
    // renderer string into a path.
    let priv_path = key_path_for(name).map_err(|e| e.to_string())?;
    let dir = ssh_dir().map_err(|e| e.to_string())?;
    let pub_path = dir.join(public_key_name(name));

    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|_| "Could not create the .ssh folder".to_string())?;
        // Only tighten a directory we just made. An existing `~/.ssh` holds
        // other tools' files, and stripping inheritance there could take away
        // access someone else depends on.
        if let Err(e) = restrict_to_owner(&dir, OwnerOnly::Dir).await {
            log::warn!("ssh-keys: could not tighten the new .ssh folder: {e}");
        }
    }

    // Checked here for a clear message; `create_new` below is what actually
    // guarantees it.
    if priv_path.exists() || pub_path.exists() {
        return Err("A key with that name already exists".to_string());
    }

    let comment_owned = comment.to_string();
    let generated =
        tokio::task::spawn_blocking(move || build_key(algorithm, &comment_owned, passphrase))
            .await
            .map_err(|_| "Key generation was interrupted".to_string())??;

    write_new_private_key(&priv_path, &generated.pem).await?;

    // The public half is not secret, but it is still ours to create: refusing to
    // overwrite keeps a stray `.pub` from being silently replaced.
    let pub_write = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&pub_path)
        .and_then(|mut f| {
            use std::io::Write;
            f.write_all(generated.public_line.as_bytes())?;
            f.write_all(b"\n")
        });
    if pub_write.is_err() {
        // Roll the pair back rather than leaving half of it behind: a private
        // key with no public half cannot be handed to a server, so it is not a
        // usable result.
        let _ = std::fs::remove_file(&priv_path);
        return Err("Could not write the public key file".to_string());
    }

    let created_at = crate::services::timefmt::now_rfc3339();
    let mut ledger = read_ledger(app);
    ledger.version = LEDGER_VERSION;
    ledger.keys.push(LedgerEntry {
        name: name.to_string(),
        created_at: created_at.clone(),
        algorithm: generated.algorithm.clone(),
        fingerprint: generated.fingerprint.clone(),
    });
    if let Err(e) = write_ledger(app, &ledger) {
        // Fail open: the key itself is written, usable, and protected. Losing
        // the ledger entry only means HoTTY will not offer to delete it.
        log::warn!("ssh-keys: could not record the new key in the ledger: {e}");
    }

    Ok(SshKeyInfo {
        name: name.to_string(),
        path: priv_path.to_string_lossy().into_owned(),
        algorithm: Some(generated.algorithm),
        bits: generated.bits,
        fingerprint: Some(generated.fingerprint),
        comment: (!comment.is_empty()).then(|| comment.to_string()),
        encrypted: false,
        format: SshKeyFormat::Openssh,
        has_public_file: true,
        managed: true,
        created_at: Some(created_at),
    })
}

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

/// Delete a key pair HoTTY generated.
///
/// Four gates, in order: the name is a name and not a path; the resolved file
/// really is directly inside `~/.ssh`; it is not one of `~/.ssh`'s housekeeping
/// files; and the ledger, the file on disk and the caller all agree on the
/// fingerprint. The renderer supplying an arbitrary name cannot get past any of
/// them.
pub fn delete_key(app: &AppHandle, name: &str, expected_fingerprint: &str) -> Result<(), String> {
    // `key_path_for` validates the name; nothing else in this module turns a
    // renderer string into a path.
    let priv_path = key_path_for(name).map_err(|e| e.to_string())?;
    if is_probably_not_a_key(name) {
        return Err("That file is not an SSH key".into());
    }
    let dir = ssh_dir().map_err(|e| e.to_string())?;

    let (resolved, root) =
        canonical_pair(&priv_path, &dir).map_err(|_| "That key no longer exists".to_string())?;
    if !is_managed_key_path(&resolved, &root) {
        return Err("That file is not in your .ssh folder".into());
    }

    let ledger = read_ledger(app);
    let on_disk = read_key_info(&dir, name, &ledger);
    let Some(on_disk_fp) = on_disk.fingerprint.as_deref() else {
        return Err("Could not read that key, so it was not deleted".into());
    };
    if !ledger_allows_delete(&ledger, name, on_disk_fp, expected_fingerprint) {
        return Err("HoTTY did not create that key, so it will not delete it".into());
    }

    // Public half first: if the second removal fails, a private key with no
    // public half is easier to recover from than the reverse.
    let pub_path = dir.join(public_key_name(name));
    if pub_path.exists() {
        let _ = std::fs::remove_file(&pub_path);
    }
    std::fs::remove_file(&priv_path).map_err(|_| "Could not delete the key file".to_string())?;

    let mut ledger = ledger;
    ledger.keys.retain(|e| e.name != name);
    if let Err(e) = write_ledger(app, &ledger) {
        log::warn!("ssh-keys: could not update the ledger after a delete: {e}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // -- validate_key_name: the whole trust boundary for writes and deletes --

    #[test]
    fn ordinary_key_names_are_accepted() {
        for name in [
            "id_ed25519_hotty",
            "id_rsa_hotty",
            "router-01_ed25519",
            "a",
            "key.2026",
        ] {
            assert!(validate_key_name(name).is_ok(), "{name:?} should be valid");
        }
    }

    #[test]
    fn a_name_can_never_be_a_path() {
        // Separators and drive letters sit outside the permitted character set,
        // so they need no rule of their own. This test is here to keep that true
        // if the set is ever widened.
        let separators = ["a/b", "a\\b", "C:key", "../id_rsa", "..\\id_rsa"];
        let absolutes = ["/etc/passwd", "\\\\server\\share", "sub/../id_rsa"];
        for name in separators.iter().chain(absolutes.iter()) {
            assert!(
                validate_key_name(name).is_err(),
                "{name:?} must be rejected"
            );
        }
    }

    #[test]
    fn empty_and_overlong_names_are_rejected() {
        assert!(matches!(validate_key_name(""), Err(SshKeyError::EmptyName)));
        assert!(matches!(
            validate_key_name(&"a".repeat(MAX_KEY_NAME_LEN + 1)),
            Err(SshKeyError::NameTooLong)
        ));
        assert!(validate_key_name(&"a".repeat(MAX_KEY_NAME_LEN)).is_ok());
    }

    #[test]
    fn dot_rules_keep_hidden_and_windows_trimmed_names_out() {
        assert!(matches!(
            validate_key_name(".hidden"),
            Err(SshKeyError::NameStartsWithDot)
        ));
        // Windows silently strips a trailing dot, so this would collide with
        // `id_x` while looking like a different file.
        assert!(matches!(
            validate_key_name("id_x."),
            Err(SshKeyError::NameEndsWithDot)
        ));
        assert!(matches!(
            validate_key_name("a..b"),
            Err(SshKeyError::NameHasInvalidCharacters)
        ));
    }

    #[test]
    fn a_public_key_name_is_not_a_private_key_name() {
        assert!(matches!(
            validate_key_name("id_ed25519.pub"),
            Err(SshKeyError::NameIsPublicKey)
        ));
        assert!(matches!(
            validate_key_name("id_ed25519.PUB"),
            Err(SshKeyError::NameIsPublicKey)
        ));
    }

    #[test]
    fn windows_device_names_are_rejected_with_or_without_an_extension() {
        for name in ["con", "CON", "nul", "com1", "lpt9", "nul.txt", "COM1.key"] {
            assert!(
                matches!(
                    validate_key_name(name),
                    Err(SshKeyError::NameIsReservedDevice)
                ),
                "{name:?} must be rejected as a device name"
            );
        }
    }

    #[test]
    fn non_ascii_names_are_rejected() {
        // Not hostility to other scripts: a key name has to survive a round trip
        // through OpenSSH config files and Windows console tooling, and a
        // lookalike name is a real hazard when the name is what authorizes a
        // delete.
        for name in ["\u{9375}", "cl\u{e9}", "id_ed25519\u{200b}"] {
            assert!(validate_key_name(name).is_err(), "{name:?}");
        }
    }

    // -- is_managed_key_path: depth-one containment --

    fn root() -> PathBuf {
        PathBuf::from("/home/alice/.ssh")
    }

    #[test]
    fn a_key_directly_inside_the_root_is_managed() {
        assert!(is_managed_key_path(&root().join("id_ed25519"), &root()));
        assert!(is_managed_key_path(&root().join("id_ed25519.pub"), &root()));
    }

    #[test]
    fn a_subdirectory_is_not_managed() {
        assert!(!is_managed_key_path(
            &root().join("sub").join("id_ed25519"),
            &root()
        ));
    }

    #[test]
    fn the_root_itself_is_not_managed() {
        assert!(!is_managed_key_path(&root(), &root()));
    }

    #[test]
    fn a_sibling_directory_sharing_the_prefix_is_not_managed() {
        // The `starts_with` regression test: `/home/alice/.ssh-evil/id_rsa`
        // shares a string prefix with the root and must still be refused.
        let evil = PathBuf::from("/home/alice/.ssh-evil/id_rsa");
        assert!(!is_managed_key_path(&evil, &root()));
    }

    #[test]
    fn an_unrelated_root_is_not_managed() {
        assert!(!is_managed_key_path(
            &PathBuf::from("/home/bob/.ssh/id_rsa"),
            &root()
        ));
    }

    #[test]
    fn a_name_the_validator_rejects_is_not_managed_even_inside_the_root() {
        assert!(!is_managed_key_path(&root().join("con"), &root()));
        assert!(!is_managed_key_path(&root().join(".hidden"), &root()));
        assert!(!is_managed_key_path(&root().join("id_x."), &root()));
    }

    #[test]
    fn containment_is_about_the_path_not_about_being_a_key() {
        // `known_hosts.old` is a perfectly legal file name directly inside the
        // root, so the containment check accepts it. Deciding it is not a key is
        // `is_probably_not_a_key`'s job -- the two answer different questions,
        // and the delete path asks both.
        assert!(is_managed_key_path(
            &root().join("known_hosts.old"),
            &root()
        ));
        assert!(is_probably_not_a_key("known_hosts.old"));
    }

    // -- classify_key_bytes --

    #[test]
    fn key_formats_are_identified_from_the_first_line() {
        assert_eq!(
            classify_key_bytes(b"-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blb"),
            SshKeyFormat::Openssh
        );
        assert_eq!(
            classify_key_bytes(b"-----BEGIN RSA PRIVATE KEY-----\nMIIE"),
            SshKeyFormat::Pem
        );
        assert_eq!(
            classify_key_bytes(b"-----BEGIN EC PRIVATE KEY-----\nMHc"),
            SshKeyFormat::Pem
        );
        assert_eq!(
            classify_key_bytes(b"-----BEGIN ENCRYPTED PRIVATE KEY-----\nMII"),
            SshKeyFormat::Pem
        );
        assert_eq!(
            classify_key_bytes(b"PuTTY-User-Key-File-2: ssh-rsa\n"),
            SshKeyFormat::Ppk
        );
        assert_eq!(
            classify_key_bytes(b"PuTTY-User-Key-File-3: ssh-ed25519\n"),
            SshKeyFormat::Ppk
        );
    }

    #[test]
    fn anything_else_is_unknown_and_short_input_does_not_panic() {
        assert_eq!(classify_key_bytes(b""), SshKeyFormat::Unknown);
        assert_eq!(classify_key_bytes(b"-"), SshKeyFormat::Unknown);
        assert_eq!(classify_key_bytes(b"hello"), SshKeyFormat::Unknown);
        // A public key is not a private key.
        assert_eq!(
            classify_key_bytes(b"ssh-ed25519 AAAAC3Nz alice@example.com"),
            SshKeyFormat::Unknown
        );
    }

    // -- is_probably_not_a_key --

    #[test]
    fn ssh_housekeeping_files_are_not_listed_as_keys() {
        for name in [
            "known_hosts",
            "known_hosts.old",
            "config",
            "authorized_keys",
            "ssh_keys.json",
            "id_rsa.pub",
            "id_rsa.bak",
            "id_rsa.hotty-new",
            ".hushlogin",
        ] {
            assert!(is_probably_not_a_key(name), "{name:?} should be skipped");
        }
    }

    #[test]
    fn actual_key_names_are_listed() {
        for name in ["id_ed25519", "id_rsa", "id_ecdsa", "id_ed25519_hotty"] {
            assert!(!is_probably_not_a_key(name), "{name:?} should be listed");
        }
    }

    #[test]
    fn public_key_name_derives_one_way_only() {
        assert_eq!(public_key_name("id_ed25519"), "id_ed25519.pub");
    }

    // -- Ledger --

    fn ledger_with(name: &str, fingerprint: &str) -> Ledger {
        Ledger {
            version: LEDGER_VERSION,
            keys: vec![LedgerEntry {
                name: name.into(),
                created_at: "2026-09-11T00:00:00Z".into(),
                algorithm: "ssh-ed25519".into(),
                fingerprint: fingerprint.into(),
            }],
        }
    }

    #[test]
    fn the_ledger_round_trips() {
        let ledger = ledger_with("id_ed25519_hotty", "SHA256:aaaa");
        let raw = serde_json::to_string(&ledger).unwrap();
        let back = parse_ledger(&raw);
        assert_eq!(back.version, LEDGER_VERSION);
        assert_eq!(back.keys.len(), 1);
        assert_eq!(back.keys[0].name, "id_ed25519_hotty");
        assert_eq!(back.keys[0].fingerprint, "SHA256:aaaa");
    }

    #[test]
    fn a_corrupt_ledger_reads_as_empty_rather_than_failing() {
        // Fail-open: an empty ledger removes permission, it does not grant it.
        for raw in ["", "{", "not json at all", "[]", "{\"version\":\"one\"}"] {
            let ledger = parse_ledger(raw);
            assert!(ledger.keys.is_empty(), "{raw:?}");
        }
    }

    #[test]
    fn delete_is_allowed_only_when_all_three_fingerprints_agree() {
        let ledger = ledger_with("id_ed25519_hotty", "SHA256:aaaa");
        assert!(ledger_allows_delete(
            &ledger,
            "id_ed25519_hotty",
            "SHA256:aaaa",
            "SHA256:aaaa"
        ));
    }

    #[test]
    fn a_key_regenerated_outside_hotty_under_the_same_name_is_not_deletable() {
        // The case the on-disk comparison exists for: same name, different key.
        let ledger = ledger_with("id_ed25519_hotty", "SHA256:aaaa");
        assert!(!ledger_allows_delete(
            &ledger,
            "id_ed25519_hotty",
            "SHA256:bbbb",
            "SHA256:bbbb"
        ));
    }

    #[test]
    fn a_stale_renderer_fingerprint_blocks_the_delete() {
        let ledger = ledger_with("id_ed25519_hotty", "SHA256:aaaa");
        assert!(!ledger_allows_delete(
            &ledger,
            "id_ed25519_hotty",
            "SHA256:aaaa",
            "SHA256:bbbb"
        ));
    }

    #[test]
    fn a_key_not_in_the_ledger_is_not_deletable() {
        let ledger = ledger_with("id_ed25519_hotty", "SHA256:aaaa");
        assert!(!ledger_allows_delete(
            &ledger,
            "id_rsa",
            "SHA256:aaaa",
            "SHA256:aaaa"
        ));
        assert!(!ledger_allows_delete(
            &Ledger::default(),
            "id_ed25519_hotty",
            "SHA256:aaaa",
            "SHA256:aaaa"
        ));
    }

    // -- ssh_dir / key_path_for --

    #[test]
    fn ssh_dir_is_the_dot_ssh_folder_under_home() {
        let dir = ssh_dir().expect("home should resolve in a test environment");
        assert_eq!(dir.file_name().and_then(|n| n.to_str()), Some(".ssh"));
        assert!(dir.parent().is_some());
    }

    #[test]
    fn key_path_for_rejects_a_bad_name_before_building_a_path() {
        assert!(key_path_for("../id_rsa").is_err());
        assert!(key_path_for("id_ed25519.pub").is_err());
        let p = key_path_for("id_ed25519_hotty").expect("valid name");
        assert_eq!(
            p.file_name().and_then(|n| n.to_str()),
            Some("id_ed25519_hotty")
        );
    }

    // -- validate_comment --

    #[test]
    fn a_comment_cannot_break_the_authorized_keys_line() {
        // The comment ends up on the single line the user pastes into
        // authorized_keys. A newline would split it, and the tail would become
        // silent garbage on the server.
        assert!(validate_comment("alice@example.com").is_ok());
        assert!(validate_comment("").is_ok());
        assert!(validate_comment("work laptop").is_ok());
        assert!(validate_comment("two\nlines").is_err());
        assert!(validate_comment("carriage\rreturn").is_err());
        assert!(validate_comment("bell\u{7}").is_err());
        assert!(validate_comment(&"a".repeat(MAX_COMMENT_LEN + 1)).is_err());
    }

    // -- build_key: generation, without touching the filesystem --

    fn build(algorithm: SshKeyAlgorithm, passphrase: Option<&str>) -> GeneratedKey {
        build_key(
            algorithm,
            "alice@example.com",
            passphrase.map(|p| Zeroizing::new(p.to_string())),
        )
        .expect("key generation should succeed")
    }

    #[test]
    fn an_ed25519_key_round_trips_through_openssh_encoding() {
        let generated = build(SshKeyAlgorithm::Ed25519, None);
        let parsed = PrivateKey::from_openssh(generated.pem.as_bytes()).expect("re-read the key");

        assert_eq!(parsed.algorithm().as_str(), "ssh-ed25519");
        assert_eq!(generated.algorithm, "ssh-ed25519");
        assert_eq!(parsed.comment(), "alice@example.com");
        assert!(!parsed.is_encrypted());
        assert_eq!(
            parsed.public_key().fingerprint(HashAlg::Sha256).to_string(),
            generated.fingerprint
        );
        assert!(generated.fingerprint.starts_with("SHA256:"));
        assert!(generated.bits.is_none());
    }

    #[test]
    fn the_public_line_is_one_line_in_authorized_keys_form() {
        let generated = build(SshKeyAlgorithm::Ed25519, None);
        assert!(!generated.public_line.contains('\n'));
        let mut parts = generated.public_line.split(' ');
        assert_eq!(parts.next(), Some("ssh-ed25519"));
        assert!(parts.next().is_some_and(|b| b.starts_with("AAAA")));
        assert_eq!(parts.next(), Some("alice@example.com"));
    }

    #[test]
    fn a_passphrase_encrypts_the_key_and_only_the_right_one_opens_it() {
        let generated = build(SshKeyAlgorithm::Ed25519, Some("correct horse"));
        let parsed = PrivateKey::from_openssh(generated.pem.as_bytes()).expect("re-read the key");

        assert!(parsed.is_encrypted());
        assert!(parsed.decrypt("wrong passphrase").is_err());
        assert!(parsed.decrypt("correct horse").is_ok());

        // The public half stays readable without the passphrase -- this is what
        // lets the list show a fingerprint for a protected key.
        assert_eq!(
            parsed.public_key().fingerprint(HashAlg::Sha256).to_string(),
            generated.fingerprint
        );
    }

    #[test]
    fn an_empty_passphrase_means_no_passphrase() {
        // The UI sends "" for an untouched field; treating that as a passphrase
        // would produce a key locked with the empty string.
        let generated = build(SshKeyAlgorithm::Ed25519, Some(""));
        let parsed = PrivateKey::from_openssh(generated.pem.as_bytes()).expect("re-read the key");
        assert!(!parsed.is_encrypted());
    }

    #[test]
    fn ecdsa_curves_produce_their_own_algorithms() {
        for (algorithm, expected) in [
            (SshKeyAlgorithm::EcdsaP256, "ecdsa-sha2-nistp256"),
            (SshKeyAlgorithm::EcdsaP384, "ecdsa-sha2-nistp384"),
            (SshKeyAlgorithm::EcdsaP521, "ecdsa-sha2-nistp521"),
        ] {
            let generated = build(algorithm, None);
            assert_eq!(generated.algorithm, expected);
            let parsed =
                PrivateKey::from_openssh(generated.pem.as_bytes()).expect("re-read the key");
            // `PrivateKey::random` takes no comment, so the builder sets it
            // afterwards -- a regression here would ship keys with no comment.
            assert_eq!(parsed.comment(), "alice@example.com");
        }
    }

    #[test]
    fn rsa_honours_the_requested_size() {
        // `PrivateKey::random` would silently use ssh-key's own default size, so
        // this asserts the builder goes through `RsaKeypair::random` instead.
        let generated = build(SshKeyAlgorithm::Rsa2048, None);
        assert_eq!(generated.bits, Some(2048));
        assert_eq!(generated.algorithm, "ssh-rsa");
    }

    #[test]
    #[ignore = "RSA-4096 takes seconds; run with --ignored"]
    fn rsa_4096_honours_the_requested_size() {
        assert_eq!(build(SshKeyAlgorithm::Rsa4096, None).bits, Some(4096));
    }

    #[test]
    fn the_algorithm_enum_survives_the_ipc_round_trip() {
        // The TypeScript side is a string-literal union. One character of drift
        // in a serde name is an error only the running app would find.
        for (algorithm, wire) in [
            (SshKeyAlgorithm::Ed25519, "\"ed25519\""),
            (SshKeyAlgorithm::EcdsaP256, "\"ecdsa-p256\""),
            (SshKeyAlgorithm::EcdsaP384, "\"ecdsa-p384\""),
            (SshKeyAlgorithm::EcdsaP521, "\"ecdsa-p521\""),
            (SshKeyAlgorithm::Rsa2048, "\"rsa-2048\""),
            (SshKeyAlgorithm::Rsa3072, "\"rsa-3072\""),
            (SshKeyAlgorithm::Rsa4096, "\"rsa-4096\""),
        ] {
            assert_eq!(serde_json::to_string(&algorithm).unwrap(), wire);
            assert_eq!(
                serde_json::from_str::<SshKeyAlgorithm>(wire).unwrap(),
                algorithm
            );
        }
    }

    #[test]
    fn the_key_format_enum_survives_the_ipc_round_trip() {
        for (format, wire) in [
            (SshKeyFormat::Openssh, "\"openssh\""),
            (SshKeyFormat::Pem, "\"pem\""),
            (SshKeyFormat::Ppk, "\"ppk\""),
            (SshKeyFormat::Unknown, "\"unknown\""),
        ] {
            assert_eq!(serde_json::to_string(&format).unwrap(), wire);
        }
    }

    // -- write_new_private_key: never overwrites, never leaves a stage file --

    fn scratch_dir(name: &str) -> PathBuf {
        // The OS temp dir, never ~/.ssh: these tests must not be able to touch a
        // real key even if something below is wrong.
        let dir =
            std::env::temp_dir().join(format!("hotty-ssh-keys-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create scratch dir");
        dir
    }

    #[tokio::test]
    async fn a_new_key_is_written_and_no_stage_file_is_left_behind() {
        let dir = scratch_dir("write-new");
        let path = dir.join("id_ed25519_hotty");
        let pem = Zeroizing::new("not a real key, just bytes\n".to_string());

        write_new_private_key(&path, &pem).await.expect("write");

        assert_eq!(std::fs::read_to_string(&path).unwrap(), pem.as_str());
        assert!(!dir.join("id_ed25519_hotty.hotty-new").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn an_existing_key_is_never_overwritten() {
        let dir = scratch_dir("no-overwrite");
        let path = dir.join("id_ed25519_hotty");
        std::fs::write(&path, "the key that was already there").unwrap();

        let pem = Zeroizing::new("a different key\n".to_string());
        assert!(write_new_private_key(&path, &pem).await.is_err());

        // The point of the test: the original is untouched.
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "the key that was already there"
        );
        assert!(!dir.join("id_ed25519_hotty.hotty-new").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_dotted_name_stages_through_its_own_file() {
        // `with_extension` would have staged `key.2026` through `key.hotty-new`,
        // which two different keys could collide on.
        let dir = scratch_dir("dotted");
        let path = dir.join("key.2026");
        let pem = Zeroizing::new("bytes\n".to_string());

        write_new_private_key(&path, &pem).await.expect("write");

        assert!(path.exists());
        assert!(!dir.join("key.hotty-new").exists());
        assert!(!dir.join("key.2026.hotty-new").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_leftover_stage_file_blocks_the_write_rather_than_being_reused() {
        // Two windows generating the same name at once, or a previous crash.
        // Reusing the stage file would mean writing over whatever is in it.
        let dir = scratch_dir("stale-stage");
        let path = dir.join("id_ed25519_hotty");
        std::fs::write(dir.join("id_ed25519_hotty.hotty-new"), "half-written").unwrap();

        let pem = Zeroizing::new("bytes\n".to_string());
        assert!(write_new_private_key(&path, &pem).await.is_err());
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
