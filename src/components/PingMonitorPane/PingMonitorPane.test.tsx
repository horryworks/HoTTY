import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PingMonitorPane } from './PingMonitorPane';

// Mock electronService
vi.mock('../../services/electronService', () => ({
    pingMonitorStart: vi.fn(),
    pingMonitorStop: vi.fn(),
    pingMonitorUpdateTargets: vi.fn(),
    pingMonitorUpdateInterval: vi.fn(),
    onPingMonitorData: vi.fn(() => vi.fn()),
    onPingMonitorLogFile: vi.fn(() => vi.fn()),
}));

// Mock settingsStore
vi.mock('../../stores/settingsStore', () => ({
    useSettingsStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) => selector({
        loggingEnabled: true,
        loggingPath: 'C:\\logs',
    })),
}));

vi.mock('zustand/react/shallow', () => ({
    useShallow: (fn: unknown) => fn,
}));

import * as electronService from '../../services/electronService';

describe('PingMonitorPane', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders with default state', () => {
        render(<PingMonitorPane sessionId="test-1" />);
        expect(screen.getByText('Ping Monitor')).toBeTruthy();
        expect(screen.getByText('Targets')).toBeTruthy();
        expect(screen.getByText('Stopped')).toBeTruthy();
    });

    it('renders with initial state', () => {
        render(
            <PingMonitorPane
                sessionId="test-1"
                initialState={{
                    targets: '192.168.1.1\ngoogle.com',
                    intervalSeconds: 10,
                    isRunning: false,
                }}
            />
        );
        const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
        expect(textarea.value).toBe('192.168.1.1\ngoogle.com');
        // "2 targets" appears in both editor header and status bar
        expect(screen.getAllByText('2 targets').length).toBeGreaterThanOrEqual(1);
    });

    it('updates targets on textarea change', () => {
        const onStateChange = vi.fn();
        render(
            <PingMonitorPane
                sessionId="test-1"
                onStateChange={onStateChange}
            />
        );
        const textarea = screen.getByRole('textbox');
        fireEvent.change(textarea, { target: { value: '10.0.0.1' } });
        expect(onStateChange).toHaveBeenCalledWith({ targets: '10.0.0.1' });
    });

    it('start button disabled when no targets', () => {
        render(<PingMonitorPane sessionId="test-1" />);
        const startBtn = screen.getByTitle('Start monitoring');
        expect(startBtn).toBeDisabled();
    });

    it('start button enabled when targets exist', () => {
        render(
            <PingMonitorPane
                sessionId="test-1"
                initialState={{ targets: '192.168.1.1', intervalSeconds: 5, isRunning: false }}
            />
        );
        const startBtn = screen.getByTitle('Start monitoring');
        expect(startBtn).not.toBeDisabled();
    });

    it('calls pingMonitorStart on start click', () => {
        render(
            <PingMonitorPane
                sessionId="test-1"
                initialState={{ targets: '192.168.1.1\n# comment\ngoogle.com', intervalSeconds: 5, isRunning: false }}
            />
        );
        const startBtn = screen.getByTitle('Start monitoring');
        fireEvent.click(startBtn);
        expect(electronService.pingMonitorStart).toHaveBeenCalledWith(
            'test-1',
            ['192.168.1.1', 'google.com'],
            5000,
            true,
            'C:\\logs',
        );
    });

    it('filters comment lines from targets', () => {
        render(
            <PingMonitorPane
                sessionId="test-1"
                initialState={{ targets: '# Server group\n192.168.1.1\n\n# Ignored\n10.0.0.1', intervalSeconds: 5, isRunning: false }}
            />
        );
        // "2 targets" appears in both editor header and status bar
        expect(screen.getAllByText('2 targets').length).toBeGreaterThanOrEqual(1);
    });

    it('calls pingMonitorStop on stop click', () => {
        render(
            <PingMonitorPane
                sessionId="test-1"
                initialState={{ targets: '192.168.1.1', intervalSeconds: 5, isRunning: false }}
            />
        );
        // Click start first
        fireEvent.click(screen.getByTitle('Start monitoring'));
        // Now stop should be visible
        const stopBtn = screen.getByTitle('Stop monitoring');
        fireEvent.click(stopBtn);
        expect(electronService.pingMonitorStop).toHaveBeenCalledWith('test-1');
    });

    it('changes interval', () => {
        const onStateChange = vi.fn();
        render(
            <PingMonitorPane
                sessionId="test-1"
                onStateChange={onStateChange}
            />
        );
        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: '10' } });
        expect(onStateChange).toHaveBeenCalledWith({ intervalSeconds: 10 });
    });

    it('displays results when provided via IPC', () => {
        // Get the onPingMonitorData callback
        let dataCallback: ((data: { sessionId: string; results: { target: string; status: string; rtt: number | null; ttl: number | null; timestamp: string }[] }) => void) | null = null;
        vi.mocked(electronService.onPingMonitorData).mockImplementation((cb) => {
            dataCallback = cb;
            return vi.fn();
        });

        render(
            <PingMonitorPane
                sessionId="test-1"
                initialState={{ targets: '192.168.1.1', intervalSeconds: 5, isRunning: false }}
            />
        );

        // Start monitoring to show results
        fireEvent.click(screen.getByTitle('Start monitoring'));

        // Simulate receiving data
        act(() => {
            if (dataCallback) {
                dataCallback({
                    sessionId: 'test-1',
                    results: [
                        { target: '192.168.1.1', status: 'ok', rtt: 5, ttl: 64, timestamp: '2026-03-21 12:30:15.123' },
                    ],
                });
            }
        });

        // "OK" appears in table and status bar
        expect(screen.getAllByText('OK').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('5ms')).toBeTruthy();
        expect(screen.getByText('64')).toBeTruthy();
        expect(screen.getByText('12:30:15')).toBeTruthy();
    });

    it('displays DNS status for dns resolution failures', () => {
        let dataCallback: ((data: { sessionId: string; results: { target: string; status: string; rtt: number | null; ttl: number | null; timestamp: string }[] }) => void) | null = null;
        vi.mocked(electronService.onPingMonitorData).mockImplementation((cb) => {
            dataCallback = cb;
            return vi.fn();
        });

        render(
            <PingMonitorPane
                sessionId="test-1"
                initialState={{ targets: 'invalid.host.xyz', intervalSeconds: 5, isRunning: false }}
            />
        );

        fireEvent.click(screen.getByTitle('Start monitoring'));

        act(() => {
            if (dataCallback) {
                dataCallback({
                    sessionId: 'test-1',
                    results: [
                        { target: 'invalid.host.xyz', status: 'dns', rtt: null, ttl: null, timestamp: '2026-03-21 12:30:15.123' },
                    ],
                });
            }
        });

        expect(screen.getAllByText('DNS failed').length).toBeGreaterThanOrEqual(1);
    });

    it('toggles editor collapse on tab click', () => {
        render(
            <PingMonitorPane
                sessionId="test-1"
                initialState={{ targets: '192.168.1.1', intervalSeconds: 5, isRunning: false }}
            />
        );
        const toggle = screen.getByTitle('Collapse target list');
        // Editor should be visible
        expect(screen.getByRole('textbox')).toBeTruthy();

        // Collapse
        fireEvent.click(toggle);
        expect(screen.getByTitle('Expand target list')).toBeTruthy();

        // Expand
        fireEvent.click(screen.getByTitle('Expand target list'));
        expect(screen.getByTitle('Collapse target list')).toBeTruthy();
    });

    it('registers and cleans up IPC listeners', () => {
        const cleanupData = vi.fn();
        const cleanupLog = vi.fn();
        vi.mocked(electronService.onPingMonitorData).mockReturnValue(cleanupData);
        vi.mocked(electronService.onPingMonitorLogFile).mockReturnValue(cleanupLog);

        const { unmount } = render(<PingMonitorPane sessionId="test-1" />);
        expect(electronService.onPingMonitorData).toHaveBeenCalled();
        expect(electronService.onPingMonitorLogFile).toHaveBeenCalled();

        unmount();
        expect(cleanupData).toHaveBeenCalled();
        expect(cleanupLog).toHaveBeenCalled();
    });
});
