import { spawn } from 'child_process';
import { logger } from './Logger';

const DPAPI_PREFIX = '[DPAPI]';

/**
 * Checks if a value was encrypted by DPAPI.
 */
export function isDpapiEncrypted(value: string): boolean {
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
