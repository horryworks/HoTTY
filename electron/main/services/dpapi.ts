import { spawn } from 'child_process';
import { logger } from './Logger';

const DPAPI_PREFIX = '[DPAPI]';

/**
 * Checks if a value was encrypted by DPAPI.
 */
function isDpapiEncrypted(value: string): boolean {
    return value.startsWith(DPAPI_PREFIX);
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
 * Encrypts a plaintext string using Windows DPAPI (CurrentUser scope).
 * @param plaintext - The string to encrypt.
 * @returns A prefixed, base64-encoded ciphertext string.
 */
export async function encryptString(plaintext: string): Promise<string> {
    if (!plaintext) return plaintext;

    if (process.platform !== 'win32') {
        throw new Error('Credential encryption requires Windows (DPAPI). HoTTY is a Windows-only application.');
    }

    const MAX_INPUT_SIZE = 1 * 1024 * 1024; // 1 MB
    if (Buffer.byteLength(plaintext, 'utf8') > MAX_INPUT_SIZE) {
        throw new Error('Input exceeds maximum size for encryption (1 MB)');
    }

    try {
        const script = `
            Add-Type -AssemblyName System.Security
            $bytes = [System.Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd())
            $encrypted = [System.Security.Cryptography.ProtectedData]::Protect(
                $bytes,
                $null,
                [System.Security.Cryptography.DataProtectionScope]::CurrentUser
            )
            [Console]::WriteLine([Convert]::ToBase64String($encrypted))
        `;

        const result = await runPowerShell(script, plaintext);
        return DPAPI_PREFIX + result.trim();
    } catch (err) {
        logger.error('dpapi', 'Encryption failed', { error: String(err) });
        throw new Error('Failed to encrypt credential using DPAPI');
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

    if (!isDpapiEncrypted(ciphertext)) {
        // Not encrypted (legacy plaintext) — return as-is for backward compatibility
        return ciphertext;
    }

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
        logger.error('dpapi', 'Decryption failed', { error: String(err) });
        throw new Error('Failed to decrypt credential using DPAPI');
    }
}

/**
 * Encrypts multiple plaintext strings in a single PowerShell invocation.
 * Non-string / empty values are passed through unchanged.
 */
export async function encryptBatch(plaintexts: (string | undefined)[]): Promise<(string | undefined)[]> {
    if (!plaintexts.length) return [];

    if (process.platform !== 'win32') {
        throw new Error('Credential encryption requires Windows (DPAPI). HoTTY is a Windows-only application.');
    }

    // Separate values that need encryption from pass-through values
    const results: (string | undefined)[] = [...plaintexts];
    const toEncrypt: { index: number; value: string }[] = [];

    for (let i = 0; i < plaintexts.length; i++) {
        const v = plaintexts[i];
        if (v && !isDpapiEncrypted(v)) {
            toEncrypt.push({ index: i, value: v });
        }
    }

    if (toEncrypt.length === 0) return results;

    // Single-item optimisation: reuse existing single-value path
    if (toEncrypt.length === 1) {
        results[toEncrypt[0].index] = await encryptString(toEncrypt[0].value);
        return results;
    }

    try {
        const script = `
            Add-Type -AssemblyName System.Security
            $json = [Console]::In.ReadToEnd()
            $items = $json | ConvertFrom-Json
            $results = @()
            foreach ($pt in $items) {
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($pt)
                $encrypted = [System.Security.Cryptography.ProtectedData]::Protect(
                    $bytes,
                    $null,
                    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
                )
                $results += [Convert]::ToBase64String($encrypted)
            }
            [Console]::Write(($results | ConvertTo-Json -Compress))
        `;

        const input = JSON.stringify(toEncrypt.map(e => e.value));
        const raw = await runPowerShell(script, input);
        const encrypted: string[] = JSON.parse(raw.trim());

        for (let i = 0; i < toEncrypt.length; i++) {
            results[toEncrypt[i].index] = DPAPI_PREFIX + encrypted[i];
        }

        return results;
    } catch (err) {
        logger.error('dpapi', 'Batch encryption failed', { error: String(err) });
        throw new Error('Failed to batch-encrypt credentials using DPAPI');
    }
}

/**
 * Decrypts multiple DPAPI-encrypted strings in a single PowerShell invocation.
 * Non-encrypted / empty / undefined values are passed through unchanged.
 */
export async function decryptBatch(ciphertexts: (string | undefined)[]): Promise<(string | undefined)[]> {
    if (!ciphertexts.length) return [];

    if (process.platform !== 'win32') {
        throw new Error('Credential decryption requires Windows (DPAPI). HoTTY is a Windows-only application.');
    }

    // Separate values that need decryption from pass-through values
    const results: (string | undefined)[] = [...ciphertexts];
    const toDecrypt: { index: number; base64: string }[] = [];

    for (let i = 0; i < ciphertexts.length; i++) {
        const v = ciphertexts[i];
        if (!v) continue;
        if (isDpapiEncrypted(v)) {
            toDecrypt.push({ index: i, base64: v.slice(DPAPI_PREFIX.length) });
        }
        // Non-DPAPI values (legacy plaintext) stay as-is in results
    }

    if (toDecrypt.length === 0) return results;

    // Single-item optimisation: reuse existing single-value path
    if (toDecrypt.length === 1) {
        results[toDecrypt[0].index] = await decryptString(ciphertexts[toDecrypt[0].index]!);
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

        const input = JSON.stringify(toDecrypt.map(e => e.base64));
        const raw = await runPowerShell(script, input);
        const decrypted: string[] = JSON.parse(raw.trim());

        for (let i = 0; i < toDecrypt.length; i++) {
            results[toDecrypt[i].index] = decrypted[i];
        }

        return results;
    } catch (err) {
        logger.error('dpapi', 'Batch decryption failed', { error: String(err) });
        throw new Error('Failed to batch-decrypt credentials using DPAPI');
    }
}
