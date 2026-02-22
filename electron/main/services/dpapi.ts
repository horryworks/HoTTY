import { spawn } from 'child_process';

const DPAPI_PREFIX = '[DPAPI]';

/**
 * Checks if a value was encrypted by DPAPI.
 */
export function isDpapiEncrypted(value: string): boolean {
    return value.startsWith(DPAPI_PREFIX);
}

/**
 * Runs a PowerShell script with stdin input, returns stdout.
 */
function runPowerShell(script: string, input: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const ps = spawn('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            script,
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
 * On non-Windows platforms, returns a base64-encoded plaintext as a fallback.
 * @param plaintext - The string to encrypt.
 * @returns A prefixed, base64-encoded ciphertext string.
 */
export async function encryptString(plaintext: string): Promise<string> {
    if (!plaintext) return plaintext;

    if (process.platform !== 'win32') {
        // Fallback for non-Windows: base64 encode only (no real encryption)
        return DPAPI_PREFIX + Buffer.from(plaintext, 'utf8').toString('base64');
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
        console.error('[DPAPI] Encryption failed:', err);
        throw new Error('Failed to encrypt credential using DPAPI');
    }
}

/**
 * Decrypts a DPAPI-encrypted string produced by encryptString().
 * On non-Windows platforms, decodes the base64 fallback.
 * If the value is not DPAPI-encrypted (legacy plaintext), returns it as-is.
 * @param ciphertext - The prefixed, base64-encoded ciphertext string.
 * @returns The original plaintext string.
 */
export async function decryptString(ciphertext: string): Promise<string> {
    if (!ciphertext) return ciphertext;

    if (!isDpapiEncrypted(ciphertext)) {
        // Not encrypted (legacy plaintext) — return as-is for backward compatibility
        return ciphertext;
    }

    const base64Data = ciphertext.slice(DPAPI_PREFIX.length);

    if (process.platform !== 'win32') {
        // Fallback for non-Windows: base64 decode only
        return Buffer.from(base64Data, 'base64').toString('utf8');
    }

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
        console.error('[DPAPI] Decryption failed:', err);
        throw new Error('Failed to decrypt credential using DPAPI');
    }
}
