// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('./Logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockExecFile = vi.fn();
const mockSpawn = vi.fn();

vi.mock('child_process', () => ({
    execFile: (...args: unknown[]) => mockExecFile(...args),
    spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock('fs', () => ({
    existsSync: vi.fn(() => false),
}));

const mockCreateConnection = vi.fn();
vi.mock('net', async (importOriginal) => {
    const actual = await importOriginal<typeof import('net')>();
    return {
        ...actual,
        createConnection: (...args: unknown[]) => mockCreateConnection(...args),
    };
});

import {
    validateIapConfig,
    checkGcloudAvailable,
    checkGcloudAuth,
    listProjects,
    listZones,
    listInstances,
    startIapTunnel,
    stopIapTunnel,
} from './iapTunnel';

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

// Helper: make execFile invoke its callback with given args
function setupExecFile(error: Error | null, stdout: string, stderr: string = '') {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        const emitter = new EventEmitter();
        // Call the callback asynchronously to mimic real behavior
        process.nextTick(() => cb(error, stdout, stderr));
        return emitter;
    });
}

// Helper: create a mock ChildProcess-like EventEmitter for spawn
function createMockChild(): EventEmitter & { pid: number; exitCode: number | null; killed: boolean; kill: ReturnType<typeof vi.fn>; stderr: EventEmitter; stdout: EventEmitter } {
    const child = new EventEmitter() as any;
    child.pid = 12345;
    child.exitCode = null;
    child.killed = false;
    child.kill = vi.fn(() => { child.killed = true; });
    child.stderr = new EventEmitter();
    child.stdout = new EventEmitter();
    return child;
}

// ── validateIapConfig ─────────────────────────────────────────────────────────

describe('validateIapConfig', () => {
    const validConfig = {
        project: 'my-gcp-project',
        zone: 'us-central1-a',
        instance: 'my-instance',
        port: 22,
    };

    it('accepts a valid config', () => {
        expect(() => validateIapConfig(validConfig)).not.toThrow();
    });

    it('accepts config without port (defaults to 22)', () => {
        expect(() => validateIapConfig({ project: 'my-gcp-project', zone: 'us-central1-a', instance: 'my-instance' })).not.toThrow();
    });

    it('accepts port 1 and port 65535', () => {
        expect(() => validateIapConfig({ ...validConfig, port: 1 })).not.toThrow();
        expect(() => validateIapConfig({ ...validConfig, port: 65535 })).not.toThrow();
    });

    // Invalid project IDs
    it('throws for empty project', () => {
        expect(() => validateIapConfig({ ...validConfig, project: '' })).toThrow('Invalid GCP project ID');
    });

    it('throws for project starting with digit', () => {
        expect(() => validateIapConfig({ ...validConfig, project: '1my-project' })).toThrow('Invalid GCP project ID');
    });

    it('throws for project with uppercase', () => {
        expect(() => validateIapConfig({ ...validConfig, project: 'My-Project' })).toThrow('Invalid GCP project ID');
    });

    it('throws for project too short (5 chars min)', () => {
        expect(() => validateIapConfig({ ...validConfig, project: 'abcd' })).toThrow('Invalid GCP project ID');
    });

    it('throws for project ending with hyphen', () => {
        expect(() => validateIapConfig({ ...validConfig, project: 'my-project-' })).toThrow('Invalid GCP project ID');
    });

    // Invalid zones
    it('throws for empty zone', () => {
        expect(() => validateIapConfig({ ...validConfig, zone: '' })).toThrow('Invalid GCP zone');
    });

    it('throws for zone without trailing letter', () => {
        expect(() => validateIapConfig({ ...validConfig, zone: 'us-central1-1' })).toThrow('Invalid GCP zone');
    });

    it('throws for zone with uppercase', () => {
        expect(() => validateIapConfig({ ...validConfig, zone: 'US-Central1-a' })).toThrow('Invalid GCP zone');
    });

    // Invalid instances
    it('throws for empty instance', () => {
        expect(() => validateIapConfig({ ...validConfig, instance: '' })).toThrow('Invalid GCE instance name');
    });

    it('throws for instance starting with digit', () => {
        expect(() => validateIapConfig({ ...validConfig, instance: '1bad-name' })).toThrow('Invalid GCE instance name');
    });

    it('throws for instance ending with hyphen', () => {
        expect(() => validateIapConfig({ ...validConfig, instance: 'my-instance-' })).toThrow('Invalid GCE instance name');
    });

    // Invalid ports
    it('throws for port 0', () => {
        expect(() => validateIapConfig({ ...validConfig, port: 0 })).toThrow('Invalid port');
    });

    it('throws for port 65536', () => {
        expect(() => validateIapConfig({ ...validConfig, port: 65536 })).toThrow('Invalid port');
    });

    it('throws for negative port', () => {
        expect(() => validateIapConfig({ ...validConfig, port: -1 })).toThrow('Invalid port');
    });

    it('throws for non-integer port', () => {
        expect(() => validateIapConfig({ ...validConfig, port: 22.5 })).toThrow('Invalid port');
    });
});

// ── checkGcloudAvailable ──────────────────────────────────────────────────────

describe('checkGcloudAvailable', () => {
    it('returns available=true with version when gcloud responds', async () => {
        setupExecFile(null, 'Google Cloud SDK 456.0.0\nbq 2.0\ncore 2024.01.01\n');
        const promise = checkGcloudAvailable();
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        expect(result).toEqual({ available: true, version: '456.0.0' });
    });

    it('returns available=true without version when format is unexpected', async () => {
        setupExecFile(null, 'some unknown output');
        const promise = checkGcloudAvailable();
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        expect(result).toEqual({ available: true, version: undefined });
    });

    it('returns available=false when gcloud is not installed', async () => {
        setupExecFile(new Error('ENOENT'), '', '');
        const promise = checkGcloudAvailable();
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        expect(result).toEqual({ available: false });
    });
});

// ── checkGcloudAuth ───────────────────────────────────────────────────────────

describe('checkGcloudAuth', () => {
    it('returns authenticated=true with active account', async () => {
        const authJson = JSON.stringify([
            { account: 'inactive@example.com', status: 'INACTIVE' },
            { account: 'user@example.com', status: 'ACTIVE' },
        ]);
        setupExecFile(null, authJson);
        const promise = checkGcloudAuth();
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        expect(result).toEqual({ authenticated: true, account: 'user@example.com' });
    });

    it('returns authenticated=false when no active account', async () => {
        const authJson = JSON.stringify([
            { account: 'user@example.com', status: 'INACTIVE' },
        ]);
        setupExecFile(null, authJson);
        const promise = checkGcloudAuth();
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        expect(result).toEqual({ authenticated: false });
    });

    it('returns authenticated=false when response is not an array', async () => {
        setupExecFile(null, '{}');
        const promise = checkGcloudAuth();
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        expect(result).toEqual({ authenticated: false });
    });

    it('returns authenticated=false when empty array', async () => {
        setupExecFile(null, '[]');
        const promise = checkGcloudAuth();
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        expect(result).toEqual({ authenticated: false });
    });

    it('returns authenticated=false when gcloud fails', async () => {
        setupExecFile(new Error('not authenticated'), '', 'ERROR');
        const promise = checkGcloudAuth();
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        expect(result).toEqual({ authenticated: false });
    });
});

// ── listProjects ──────────────────────────────────────────────────────────────

describe('listProjects', () => {
    it('parses project list correctly', async () => {
        const json = JSON.stringify([
            { projectId: 'proj-alpha', name: 'Alpha' },
            { projectId: 'proj-beta', name: 'Beta Project' },
        ]);
        setupExecFile(null, json);
        const promise = listProjects();
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        expect(result).toEqual([
            { id: 'proj-alpha', name: 'Alpha' },
            { id: 'proj-beta', name: 'Beta Project' },
        ]);
    });

    it('uses projectId as name when name is missing', async () => {
        const json = JSON.stringify([{ projectId: 'proj-no-name' }]);
        setupExecFile(null, json);
        const promise = listProjects();
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        expect(result).toEqual([{ id: 'proj-no-name', name: 'proj-no-name' }]);
    });

    it('filters out entries without projectId', async () => {
        const json = JSON.stringify([{ name: 'No ID' }, { projectId: 'valid-project', name: 'Valid' }]);
        setupExecFile(null, json);
        const promise = listProjects();
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        expect(result).toEqual([{ id: 'valid-project', name: 'Valid' }]);
    });

    it('returns empty array when response is not an array', async () => {
        setupExecFile(null, '{}');
        const promise = listProjects();
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        expect(result).toEqual([]);
    });

    it('returns empty array on gcloud error', async () => {
        setupExecFile(new Error('failed'), '', 'access denied');
        const promise = listProjects();
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        expect(result).toEqual([]);
    });
});

// ── listZones ─────────────────────────────────────────────────────────────────

describe('listZones', () => {
    it('parses zones from instances list output', async () => {
        const json = JSON.stringify([
            { zone: 'https://www.googleapis.com/compute/v1/projects/proj/zones/us-central1-a' },
            { zone: 'us-east1-b' },
            { zone: 'https://www.googleapis.com/compute/v1/projects/proj/zones/us-central1-a' },
        ]);
        setupExecFile(null, json);
        const promise = listZones('my-gcp-project');
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        // Deduplicated and sorted
        expect(result).toEqual(['us-central1-a', 'us-east1-b']);
    });

    it('returns empty array for invalid project ID', async () => {
        const result = await listZones('INVALID');
        expect(result).toEqual([]);
        expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('returns empty array when response is not an array', async () => {
        setupExecFile(null, '{}');
        const promise = listZones('my-gcp-project');
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        expect(result).toEqual([]);
    });

    it('returns empty array on gcloud error', async () => {
        setupExecFile(new Error('error'), '', 'failed');
        const promise = listZones('my-gcp-project');
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        expect(result).toEqual([]);
    });

    it('skips entries with empty zone string', async () => {
        const json = JSON.stringify([{ zone: '' }, { zone: 'us-west1-a' }]);
        setupExecFile(null, json);
        const promise = listZones('my-gcp-project');
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        expect(result).toEqual(['us-west1-a']);
    });
});

// ── listInstances ─────────────────────────────────────────────────────────────

describe('listInstances', () => {
    it('parses instance list correctly', async () => {
        const json = JSON.stringify([
            { name: 'vm-web', status: 'RUNNING' },
            { name: 'vm-db', status: 'TERMINATED' },
        ]);
        setupExecFile(null, json);
        const promise = listInstances('my-gcp-project', 'us-central1-a');
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        expect(result).toEqual([
            { name: 'vm-web', status: 'RUNNING' },
            { name: 'vm-db', status: 'TERMINATED' },
        ]);
    });

    it('defaults status to UNKNOWN when missing', async () => {
        const json = JSON.stringify([{ name: 'vm-no-status' }]);
        setupExecFile(null, json);
        const promise = listInstances('my-gcp-project', 'us-central1-a');
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        expect(result).toEqual([{ name: 'vm-no-status', status: 'UNKNOWN' }]);
    });

    it('filters out entries without name', async () => {
        const json = JSON.stringify([{ status: 'RUNNING' }, { name: 'valid-vm', status: 'RUNNING' }]);
        setupExecFile(null, json);
        const promise = listInstances('my-gcp-project', 'us-central1-a');
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        expect(result).toEqual([{ name: 'valid-vm', status: 'RUNNING' }]);
    });

    it('returns empty array for invalid project', async () => {
        const result = await listInstances('INVALID', 'us-central1-a');
        expect(result).toEqual([]);
        expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('returns empty array for invalid zone', async () => {
        const result = await listInstances('my-gcp-project', 'INVALID');
        expect(result).toEqual([]);
        expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('returns empty array on gcloud error', async () => {
        setupExecFile(new Error('error'), '', 'failed');
        const promise = listInstances('my-gcp-project', 'us-central1-a');
        await vi.advanceTimersByTimeAsync(0);
        const result = await promise;
        expect(result).toEqual([]);
    });
});

// ── startIapTunnel ────────────────────────────────────────────────────────────

describe('startIapTunnel', () => {
    const validConfig = {
        project: 'my-gcp-project',
        zone: 'us-central1-a',
        instance: 'my-instance',
        port: 22,
    };

    it('resolves with localPort when "Listening on port" is emitted', async () => {
        const child = createMockChild();
        mockSpawn.mockReturnValue(child);

        const promise = startIapTunnel(validConfig);

        // Emit the listening message
        child.stderr.emit('data', Buffer.from('Listening on port [54321].'));

        const result = await promise;
        expect(result.localPort).toBe(54321);
        expect(result.process).toBe(child);
    });

    it('resolves via "Listening" even after "Testing if tunnel connection works" is seen', async () => {
        const child = createMockChild();
        mockSpawn.mockReturnValue(child);

        // Prevent real net.createConnection from connecting (probe will fail harmlessly)
        mockCreateConnection.mockImplementation(() => {
            const mockSock = new EventEmitter() as any;
            mockSock.destroy = vi.fn();
            mockSock.setTimeout = vi.fn();
            return mockSock;
        });

        const promise = startIapTunnel(validConfig);

        // Emit picking + testing messages (starts probe path internally)
        child.stderr.emit('data', Buffer.from('Picking local unused port [44444].'));
        child.stderr.emit('data', Buffer.from('Testing if tunnel connection works.'));

        // The tunnel hasn't resolved yet since "Listening" hasn't appeared.
        // Now emit the "Listening" message — this should resolve the promise.
        child.stderr.emit('data', Buffer.from('Listening on port [44444].'));

        const result = await promise;
        expect(result.localPort).toBe(44444);
    });

    it('rejects when child process emits error', async () => {
        const child = createMockChild();
        mockSpawn.mockReturnValue(child);

        const promise = startIapTunnel(validConfig);

        child.emit('error', new Error('spawn failed'));

        await expect(promise).rejects.toThrow('Failed to start IAP tunnel: spawn failed');
    });

    it('rejects when child process exits before tunnel is ready', async () => {
        const child = createMockChild();
        mockSpawn.mockReturnValue(child);

        const promise = startIapTunnel(validConfig);

        child.stderr.emit('data', Buffer.from('ERROR: some auth error'));
        child.exitCode = 1;
        child.emit('exit', 1);

        await expect(promise).rejects.toThrow('IAP tunnel failed: ERROR: some auth error');
    });

    it('rejects with generic message when exit with no stderr', async () => {
        const child = createMockChild();
        mockSpawn.mockReturnValue(child);

        const promise = startIapTunnel(validConfig);

        child.exitCode = 1;
        child.emit('exit', 1);

        await expect(promise).rejects.toThrow('IAP tunnel failed: gcloud exited with code 1');
    });

    it('rejects on timeout when no port is picked', async () => {
        const child = createMockChild();
        mockSpawn.mockReturnValue(child);

        const promise = startIapTunnel(validConfig);
        // Attach a catch handler before advancing timers to prevent unhandled rejection
        const caught = promise.catch((e: Error) => e);

        // Advance past the 30s timeout
        await vi.advanceTimersByTimeAsync(30_000);

        const error = await caught;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('IAP tunnel startup timed out');
        expect(child.kill).toHaveBeenCalled();
    });

    it('resolves with picked port on timeout when process is still alive', async () => {
        const child = createMockChild();
        mockSpawn.mockReturnValue(child);

        const promise = startIapTunnel(validConfig);

        // Emit picking port but never listening
        child.stderr.emit('data', Buffer.from('Picking local unused port [55555].'));

        // Advance past the 30s timeout
        await vi.advanceTimersByTimeAsync(30_000);

        const result = await promise;
        expect(result.localPort).toBe(55555);
        expect(result.process).toBe(child);
    });

    it('throws synchronously for invalid config', () => {
        expect(() => startIapTunnel({ project: '', zone: 'us-central1-a', instance: 'vm' }))
            .toThrow('Invalid GCP project ID');
    });

    it('uses default port 22 when not specified', async () => {
        const child = createMockChild();
        mockSpawn.mockReturnValue(child);

        startIapTunnel({ project: 'my-gcp-project', zone: 'us-central1-a', instance: 'my-instance' });

        expect(mockSpawn).toHaveBeenCalled();
        const spawnArgs = mockSpawn.mock.calls[0][1];
        expect(spawnArgs).toContain('22');
    });
});

// ── stopIapTunnel ─────────────────────────────────────────────────────────────

describe('stopIapTunnel', () => {
    it('does nothing if process has already exited', () => {
        const proc = { exitCode: 0, killed: false, pid: 123, kill: vi.fn() } as unknown as ChildProcess;
        stopIapTunnel(proc);
        expect((proc as any).kill).not.toHaveBeenCalled();
    });

    it('does nothing if process is already killed', () => {
        const proc = { exitCode: null, killed: true, pid: 123, kill: vi.fn() } as unknown as ChildProcess;
        stopIapTunnel(proc);
        expect((proc as any).kill).not.toHaveBeenCalled();
    });

    it('sends SIGTERM on non-Windows platforms', () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

        const proc = { exitCode: null, killed: false, pid: 123, kill: vi.fn() } as unknown as ChildProcess;
        stopIapTunnel(proc);
        expect((proc as any).kill).toHaveBeenCalledWith('SIGTERM');

        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('uses taskkill on Windows', () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

        const proc = { exitCode: null, killed: false, pid: 999, kill: vi.fn() } as unknown as ChildProcess;
        stopIapTunnel(proc);

        expect(mockSpawn).toHaveBeenCalledWith(
            'taskkill',
            ['/pid', '999', '/T', '/F'],
            expect.objectContaining({ windowsHide: true, stdio: 'ignore' }),
        );

        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('falls back to SIGKILL on Windows when taskkill throws', () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        mockSpawn.mockImplementation(() => { throw new Error('taskkill not found'); });

        const proc = { exitCode: null, killed: false, pid: 999, kill: vi.fn() } as unknown as ChildProcess;
        stopIapTunnel(proc);

        expect((proc as any).kill).toHaveBeenCalledWith('SIGKILL');

        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('force-kills after 5 seconds on non-Windows if still alive', () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

        const proc = { exitCode: null, killed: false, pid: 123, kill: vi.fn() } as unknown as ChildProcess;
        stopIapTunnel(proc);

        expect((proc as any).kill).toHaveBeenCalledWith('SIGTERM');
        expect((proc as any).kill).not.toHaveBeenCalledWith('SIGKILL');

        // Advance 5 seconds for force-kill
        vi.advanceTimersByTime(5000);
        expect((proc as any).kill).toHaveBeenCalledWith('SIGKILL');

        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('does not force-kill if process exited within 5 seconds', () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

        const proc = { exitCode: null, killed: false, pid: 123, kill: vi.fn() } as unknown as ChildProcess;
        stopIapTunnel(proc);

        // Simulate the process exiting
        (proc as any).exitCode = 0;

        vi.advanceTimersByTime(5000);
        // SIGKILL should NOT have been called since exitCode is now set
        expect((proc as any).kill).not.toHaveBeenCalledWith('SIGKILL');

        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
});
