import { spawn } from 'child_process';
import { safeStorage } from 'electron';
import { logger } from './Logger';

const DPAPI_PREFIX = '[DPAPI]';
const SAFE_PREFIX = '[SAFE]';

/**
 * Checks if a value was encrypted by legacy PowerShell DPAPI.
 */
function isDpapiEncrypted(value: string): boolean {
    return value.startsWith(DPAPI_PREFIX);
}

/**
 * Checks if a value was encrypted by Electron safeStorage.
 */
function isSafeEncrypted(value: string): boolean {
    return value.startsWith(SAFE_PREFIX);
}

/**
 * Checks if a value is encrypted by any supported method.
 */
export function isAnyEncrypted(value: string): boolean {
    return isDpapiEncrypted(value) || isSafeEncrypted(value);
}

/**
 * Encodes a PowerShell script as Base64 UTF-16 LE for use with -EncodedCommand.
 * This avoids passing the script via -Command, which is susceptible to shell injection.
 */
export function encodePowerShellScript(script: string): string {
    const utf16le = Buffer.allocUnsafe(script.length * 2);
    for (let i = 0; i < script.length; i++) {
        utf16le.writeUInt16LE(script.charCodeAt(i), i * 2);
    }
    return utf16le.toString('base64');
}

/**
 * Runs a PowerShell script with stdin input, returns stdout.
 */
function runPowerShell(script: string, input: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const ps = spawn('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            encodePowerShellScript(script),
        ]);

        let stdout = '';
        let stderr = '';

        ps.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        ps.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

        ps.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`PowerShell exited with code ${code}: ${stderr}`));
            } else {
                resolve(stdout);
            }
        });

        ps.on('error', reject);

        ps.stdin.write(input, 'utf8');
        ps.stdin.end();
    });
}

/**
 * Encrypts a plaintext string using Electron safeStorage (DPAPI on Windows).
 * @param plaintext - The string to encrypt.
 * @returns A prefixed, base64-encoded ciphertext string.
 */
export async function encryptString(plaintext: string): Promise<string> {
    if (!plaintext) return plaintext;

    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Credential encryption is not available on this system.');
    }

    try {
        const encrypted = safeStorage.encryptString(plaintext);
        return SAFE_PREFIX + encrypted.toString('base64');
    } catch (err) {
        logger.error('dpapi', 'Encryption failed', { error: String(err) });
        throw new Error('Failed to encrypt credential using safeStorage');
    }
}

/**
 * Decrypts a DPAPI-encrypted string produced by encryptString().
 * If the value is not DPAPI-encrypted (legacy plaintext), returns it as-is.
 * @param ciphertext - The prefixed, base64-encoded ciphertext string.
 * @returns The original plaintext string.
 */
/**
 * Verifies Windows user credentials using the Win32 LogonUser API.
 * @param password - The Windows password to verify for the current user.
 * @returns true if the credentials are valid, false otherwise.
 */
export async function verifyWindowsUser(password: string): Promise<boolean> {
    if (process.platform !== 'win32') {
        throw new Error('Windows user verification requires Windows. HoTTY is a Windows-only application.');
    }

    if (!password) return false;

    try {
        const script = `
            Add-Type -TypeDefinition @"
            using System;
            using System.Runtime.InteropServices;
            public class WinAuth {
                [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
                public static extern bool LogonUser(
                    string lpszUsername, string lpszDomain, string lpszPassword,
                    int dwLogonType, int dwLogonProvider, out IntPtr phToken);
                [DllImport("kernel32.dll")]
                public static extern bool CloseHandle(IntPtr hObject);
            }
"@
            $pw = [Console]::In.ReadToEnd()
            $token = [IntPtr]::Zero
            $user = [Environment]::UserName
            $domain = [Environment]::UserDomainName
            $result = [WinAuth]::LogonUser($user, $domain, $pw, 3, 0, [ref]$token)
            if ($token -ne [IntPtr]::Zero) { [WinAuth]::CloseHandle($token) | Out-Null }
            [Console]::Write($result.ToString())
        `;

        const result = await runPowerShell(script, password);
        return result.trim() === 'True';
    } catch (err) {
        logger.error('dpapi', 'Windows user verification failed', { error: String(err) });
        return false;
    }
}

export async function decryptString(ciphertext: string): Promise<string> {
    if (!ciphertext) return ciphertext;

    // Electron safeStorage format
    if (isSafeEncrypted(ciphertext)) {
        try {
            const buf = Buffer.from(ciphertext.slice(SAFE_PREFIX.length), 'base64');
            return safeStorage.decryptString(buf);
        } catch (err) {
            logger.error('dpapi', 'safeStorage decryption failed', { error: String(err) });
            throw new Error('Failed to decrypt credential using safeStorage');
        }
    }

    // Legacy PowerShell DPAPI format (migration path)
    if (isDpapiEncrypted(ciphertext)) {
        if (process.platform !== 'win32') {
            throw new Error('Credential decryption requires Windows (DPAPI). HoTTY is a Windows-only application.');
        }

        const base64Data = ciphertext.slice(DPAPI_PREFIX.length);

        try {
            const script = `
                Add-Type -AssemblyName System.Security
                $base64 = [Console]::In.ReadToEnd().Trim()
                $bytes = [Convert]::FromBase64String($base64)
                $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect(
                    $bytes,
                    $null,
                    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
                )
                [Console]::Write([System.Text.Encoding]::UTF8.GetString($decrypted))
            `;

            const result = await runPowerShell(script, base64Data);
            return result;
        } catch (err) {
            logger.error('dpapi', 'Legacy DPAPI decryption failed', { error: String(err) });
            throw new Error('Failed to decrypt credential using DPAPI');
        }
    }

    // Not encrypted (legacy plaintext) — return as-is for backward compatibility
    return ciphertext;
}

/**
 * Encrypts multiple plaintext strings using Electron safeStorage.
 * Non-string / empty values are passed through unchanged.
 */
export async function encryptBatch(plaintexts: (string | undefined)[]): Promise<(string | undefined)[]> {
    if (!plaintexts.length) return [];

    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Credential encryption is not available on this system.');
    }

    const results: (string | undefined)[] = [...plaintexts];

    try {
        for (let i = 0; i < plaintexts.length; i++) {
            const v = plaintexts[i];
            if (v && !isAnyEncrypted(v)) {
                const encrypted = safeStorage.encryptString(v);
                results[i] = SAFE_PREFIX + encrypted.toString('base64');
            }
        }
        return results;
    } catch (err) {
        logger.error('dpapi', 'Batch encryption failed', { error: String(err) });
        throw new Error('Failed to batch-encrypt credentials using safeStorage');
    }
}

/**
 * Decrypts multiple encrypted strings.
 * [SAFE]-prefixed values are decrypted synchronously via safeStorage.
 * [DPAPI]-prefixed values fall back to a single PowerShell invocation (legacy migration).
 * Non-encrypted / empty / undefined values are passed through unchanged.
 */
export async function decryptBatch(ciphertexts: (string | undefined)[]): Promise<(string | undefined)[]> {
    if (!ciphertexts.length) return [];

    const results: (string | undefined)[] = [...ciphertexts];
    const legacyToDecrypt: { index: number; base64: string }[] = [];

    // First pass: decrypt [SAFE] values synchronously, collect [DPAPI] values for batch
    for (let i = 0; i < ciphertexts.length; i++) {
        const v = ciphertexts[i];
        if (!v) continue;

        if (isSafeEncrypted(v)) {
            try {
                const buf = Buffer.from(v.slice(SAFE_PREFIX.length), 'base64');
                results[i] = safeStorage.decryptString(buf);
            } catch (err) {
                logger.error('dpapi', 'safeStorage batch decryption failed for item', { index: i, error: String(err) });
                throw new Error('Failed to decrypt credential using safeStorage');
            }
        } else if (isDpapiEncrypted(v)) {
            legacyToDecrypt.push({ index: i, base64: v.slice(DPAPI_PREFIX.length) });
        }
        // Non-encrypted values (legacy plaintext) stay as-is in results
    }

    // No legacy values to decrypt — done
    if (legacyToDecrypt.length === 0) return results;

    // Legacy [DPAPI] decryption via PowerShell (migration path)
    if (process.platform !== 'win32') {
        throw new Error('Credential decryption requires Windows (DPAPI). HoTTY is a Windows-only application.');
    }

    if (legacyToDecrypt.length === 1) {
        results[legacyToDecrypt[0].index] = await decryptString(ciphertexts[legacyToDecrypt[0].index]!);
        return results;
    }

    try {
        const script = `
            Add-Type -AssemblyName System.Security
            $json = [Console]::In.ReadToEnd()
            $items = $json | ConvertFrom-Json
            $results = @()
            foreach ($b64 in $items) {
                $bytes = [Convert]::FromBase64String($b64)
                $dec = [System.Security.Cryptography.ProtectedData]::Unprotect(
                    $bytes,
                    $null,
                    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
                )
                $results += [System.Text.Encoding]::UTF8.GetString($dec)
            }
            [Console]::Write(($results | ConvertTo-Json -Compress))
        `;

        const input = JSON.stringify(legacyToDecrypt.map(e => e.base64));
        const raw = await runPowerShell(script, input);
        const decrypted: string[] = JSON.parse(raw.trim());

        for (let i = 0; i < legacyToDecrypt.length; i++) {
            results[legacyToDecrypt[i].index] = decrypted[i];
        }

        return results;
    } catch (err) {
        logger.error('dpapi', 'Legacy DPAPI batch decryption failed', { error: String(err) });
        throw new Error('Failed to batch-decrypt credentials using DPAPI');
    }
}
