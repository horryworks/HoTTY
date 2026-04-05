import { spawn, execFile, ChildProcess } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from './Logger';

// GCP validation patterns (reused from VertexAI provider)
const VALID_PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const VALID_ZONE_PATTERN = /^[a-z]+-[a-z]+[0-9]+-[a-z]$/;
const VALID_INSTANCE_PATTERN = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/;

const TUNNEL_READY_TIMEOUT_MS = 30_000;
const GCLOUD_CMD_TIMEOUT_MS = 15_000;

export interface IapTunnelConfig {
    project: string;
    zone: string;
    instance: string;
    port?: number; // default 22
}

export interface IapTunnelResult {
    localPort: number;
    process: ChildProcess;
}

/** Validate GCP resource identifiers. Throws on invalid input. */
export function validateIapConfig(config: IapTunnelConfig): void {
    if (!VALID_PROJECT_PATTERN.test(config.project)) {
        throw new Error(`Invalid GCP project ID: "${config.project}"`);
    }
    if (!VALID_ZONE_PATTERN.test(config.zone)) {
        throw new Error(`Invalid GCP zone: "${config.zone}"`);
    }
    if (!VALID_INSTANCE_PATTERN.test(config.instance)) {
        throw new Error(`Invalid GCE instance name: "${config.instance}"`);
    }
    const port = config.port ?? 22;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid port: ${port}`);
    }
}

/** Find gcloud executable path. On Windows, gcloud is typically gcloud.cmd. */
function findGcloudPath(): string | null {
    // Check common Windows locations (user-local and system-wide installs)
    const envDirs = [
        process.env.LOCALAPPDATA,
        process.env.APPDATA,
        process.env.ProgramFiles,
        process.env['ProgramFiles(x86)'],
    ].filter((d): d is string => !!d);

    const candidates: string[] = [];
    for (const dir of envDirs) {
        candidates.push(path.join(dir, 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.cmd'));
    }
    // Also check HOME-based install (gcloud installer default)
    const home = process.env.USERPROFILE || process.env.HOME;
    if (home) {
        candidates.push(path.join(home, 'google-cloud-sdk', 'bin', 'gcloud.cmd'));
    }

    for (const candidate of candidates) {
        const resolved = path.resolve(candidate);
        if (fs.existsSync(resolved)) {
            return resolved;
        }
    }

    // Fallback: search PATH for gcloud.cmd
    const pathDirs = (process.env.PATH || '').split(path.delimiter);
    for (const dir of pathDirs) {
        const candidate = path.resolve(dir, 'gcloud.cmd');
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    // Last resort: return null and rely on shell resolution
    return null;
}

/** Run a gcloud command and return stdout. */
function runGcloud(args: string[], timeoutMs: number = GCLOUD_CMD_TIMEOUT_MS): Promise<string> {
    return new Promise((resolve, reject) => {
        const gcloudPath = findGcloudPath();
        // On Windows, .cmd files require shell: true. When using shell mode,
        // paths with spaces must be quoted to prevent the shell from splitting them.
        const command = gcloudPath || 'gcloud';
        // On Windows, .cmd files need shell: true for execution.
        // Avoid manual quoting — let the OS handle path resolution.
        const useShell = process.platform === 'win32' || !gcloudPath;

        logger.debug('iap', 'Running gcloud command', { command, args });

        const child = execFile(command, args, {
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024, // 1MB
            shell: useShell,
            windowsHide: true,
        }, (error, stdout, stderr) => {
            if (error) {
                logger.error('iap', 'gcloud command failed', { args: args.join(' '), error: error.message, stderr });
                reject(new Error(stderr || error.message));
                return;
            }
            resolve(stdout);
        });

        child.on('error', (err) => {
            reject(new Error(`Failed to execute gcloud: ${err.message}`));
        });
    });
}

/** Check if gcloud CLI is installed. */
export async function checkGcloudAvailable(): Promise<{ available: boolean; version?: string }> {
    try {
        const stdout = await runGcloud(['--version']);
        const match = stdout.match(/Google Cloud SDK\s+([\d.]+)/);
        return { available: true, version: match ? match[1] : undefined };
    } catch {
        return { available: false };
    }
}

/** Check if gcloud has an active authenticated account. */
export async function checkGcloudAuth(): Promise<{ authenticated: boolean; account?: string }> {
    try {
        const stdout = await runGcloud(['auth', 'list', '--format=json']);
        const accounts = JSON.parse(stdout);
        if (!Array.isArray(accounts)) {
            return { authenticated: false };
        }
        const active = accounts.find((a: { status?: string }) => a.status === 'ACTIVE');
        if (active && typeof active.account === 'string') {
            return { authenticated: true, account: active.account };
        }
        return { authenticated: false };
    } catch {
        return { authenticated: false };
    }
}

/** List GCP projects accessible by the current user. */
export async function listProjects(): Promise<{ id: string; name: string }[]> {
    try {
        const stdout = await runGcloud(['projects', 'list', '--format=json', '--limit=100', '--sort-by=projectId']);
        const projects = JSON.parse(stdout);
        if (!Array.isArray(projects)) return [];
        return projects
            .filter((p: { projectId?: string }) => typeof p.projectId === 'string')
            .map((p: { projectId: string; name?: string }) => ({
                id: p.projectId,
                name: typeof p.name === 'string' ? p.name : p.projectId,
            }));
    } catch (error) {
        logger.error('iap', 'Failed to list projects', { error: String(error) });
        return [];
    }
}

/** List GCP zones that have at least one VM instance in the given project. */
export async function listZones(project: string): Promise<string[]> {
    if (!VALID_PROJECT_PATTERN.test(project)) return [];
    try {
        const stdout = await runGcloud([
            'compute', 'instances', 'list',
            '--format=json(zone)',
            `--project=${project}`,
        ]);
        const instances = JSON.parse(stdout);
        if (!Array.isArray(instances)) return [];
        const zoneSet = new Set<string>();
        for (const i of instances) {
            // zone can be a full URL like "projects/.../zones/us-central1-a" or just the name
            const raw = typeof i.zone === 'string' ? i.zone : '';
            const name = raw.includes('/') ? raw.split('/').pop()! : raw;
            if (name) zoneSet.add(name);
        }
        return [...zoneSet].sort();
    } catch (error) {
        logger.error('iap', 'Failed to list zones with instances', { error: String(error) });
        return [];
    }
}

/** List GCE instances for a given project and zone. */
export async function listInstances(project: string, zone: string): Promise<{ name: string; status: string }[]> {
    if (!VALID_PROJECT_PATTERN.test(project)) return [];
    if (!VALID_ZONE_PATTERN.test(zone)) return [];
    try {
        const stdout = await runGcloud([
            'compute', 'instances', 'list',
            '--format=json',
            `--project=${project}`,
            `--filter=zone:(${zone})`,
            '--sort-by=name',
        ]);
        const instances = JSON.parse(stdout);
        if (!Array.isArray(instances)) return [];
        return instances
            .filter((i: { name?: string }) => typeof i.name === 'string')
            .map((i: { name: string; status?: string }) => ({
                name: i.name,
                status: typeof i.status === 'string' ? i.status : 'UNKNOWN',
            }));
    } catch (error) {
        logger.error('iap', 'Failed to list instances', { error: String(error) });
        return [];
    }
}

/** Probe a local TCP port until it accepts a connection, or the caller signals to stop. */
function probePort(localPort: number, child: ChildProcess, isCancelled: () => boolean): Promise<void> {
    const PROBE_INTERVAL_MS = 500;
    const MAX_PROBES = 60; // 30 seconds max
    return new Promise((resolve, reject) => {
        let attempt = 0;
        const tryConnect = () => {
            if (isCancelled()) { reject(new Error('probe cancelled')); return; }
            if (attempt >= MAX_PROBES) { reject(new Error('probe timeout')); return; }
            attempt++;
            const sock = net.createConnection({ host: '127.0.0.1', port: localPort }, () => {
                sock.destroy();
                resolve();
            });
            sock.on('error', () => {
                sock.destroy();
                setTimeout(tryConnect, PROBE_INTERVAL_MS);
            });
            sock.setTimeout(PROBE_INTERVAL_MS, () => {
                sock.destroy();
                setTimeout(tryConnect, PROBE_INTERVAL_MS);
            });
        };
        tryConnect();
    });
}

/** Start an IAP tunnel via gcloud and return the local port + child process. */
export function startIapTunnel(config: IapTunnelConfig): Promise<IapTunnelResult> {
    validateIapConfig(config);

    const port = config.port ?? 22;

    return new Promise((resolve, reject) => {
        const gcloudPath = findGcloudPath();
        const command = gcloudPath || 'gcloud';
        const useShell = process.platform === 'win32' || !gcloudPath;

        const args = [
            'compute', 'start-iap-tunnel',
            config.instance,
            String(port),
            `--zone=${config.zone}`,
            `--project=${config.project}`,
            '--local-host-port=localhost:0',
        ];

        logger.info('iap', 'Starting IAP tunnel', { instance: config.instance, zone: config.zone, project: config.project });

        const child = spawn(command, args, {
            shell: useShell,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let settled = false;
        let stderrBuf = '';

        const timeout = setTimeout(() => {
            if (!settled) {
                // If gcloud picked a port and is still running (testing connection),
                // resolve with the picked port — the tunnel may still become ready.
                if (parsedPort !== null && child.exitCode === null && !child.killed) {
                    settled = true;
                    logger.warn('iap', 'Tunnel "Listening" not received within timeout, using picked port', { localPort: parsedPort });
                    resolve({ localPort: parsedPort, process: child });
                } else {
                    settled = true;
                    child.kill();
                    reject(new Error('IAP tunnel startup timed out (30s). Check your network connection and gcloud configuration.'));
                }
            }
        }, TUNNEL_READY_TIMEOUT_MS);

        let parsedPort: number | null = null;
        let probing = false;

        // gcloud outputs "Picking local unused port [NNNNN]." first, then
        // "Listening on port [NNNNN]." once the tunnel is ready.
        // We capture the port from either message but only resolve on "Listening".
        child.stderr?.on('data', (data: Buffer) => {
            const text = data.toString();
            stderrBuf += text;
            logger.debug('iap', 'gcloud stderr', { text: text.trim() });

            // Capture port from "Picking local unused port [NNNNN]"
            if (parsedPort === null) {
                const pickMatch = stderrBuf.match(/Picking local unused port \[(\d+)\]/);
                if (pickMatch) {
                    parsedPort = parseInt(pickMatch[1], 10);
                }
            }

            // Some gcloud versions never emit "Listening on port" — once we see
            // "Testing if tunnel connection works", start probing the local port.
            if (parsedPort !== null && !settled && !probing && /Testing if tunnel connection works/.test(stderrBuf)) {
                probing = true;
                probePort(parsedPort, child, () => settled || child.killed || child.exitCode !== null)
                    .then(() => {
                        if (!settled) {
                            settled = true;
                            clearTimeout(timeout);
                            logger.info('iap', 'IAP tunnel ready (probe)', { localPort: parsedPort });
                            resolve({ localPort: parsedPort!, process: child });
                        }
                    })
                    .catch(() => { /* timeout handler or exit handler will deal with it */ });
            }

            const listenMatch = stderrBuf.match(/Listening on port \[(\d+)\]/);
            if (listenMatch && !settled) {
                settled = true;
                clearTimeout(timeout);
                const localPort = parseInt(listenMatch[1], 10);
                logger.info('iap', 'IAP tunnel ready', { localPort });
                resolve({ localPort, process: child });
            }
        });

        child.on('error', (err) => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                reject(new Error(`Failed to start IAP tunnel: ${err.message}`));
            }
        });

        child.on('exit', (code) => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                const errorMsg = stderrBuf.trim() || `gcloud exited with code ${code}`;
                reject(new Error(`IAP tunnel failed: ${errorMsg}`));
            }
        });
    });
}

/** Stop an IAP tunnel process. */
export function stopIapTunnel(proc: ChildProcess): void {
    if (proc.exitCode !== null || proc.killed) return;

    logger.info('iap', 'Stopping IAP tunnel');

    // On Windows, spawned .cmd processes need taskkill
    if (process.platform === 'win32' && proc.pid) {
        try {
            spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
                windowsHide: true,
                stdio: 'ignore',
            });
        } catch {
            proc.kill('SIGKILL');
        }
    } else {
        proc.kill('SIGTERM');
        // Force kill after 5 seconds if still alive
        setTimeout(() => {
            if (proc.exitCode === null && !proc.killed) {
                proc.kill('SIGKILL');
            }
        }, 5000);
    }
}
