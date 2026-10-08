import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { PingMonitorPane } from './PingMonitorPane';
import { tauriService } from '../../services/tauriService';
import { useSettingsStore } from '../../stores/settingsStore';
import type { PingResult } from '../../types/appTypes';

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    pingMonitorStart: vi.fn(),
    pingMonitorStop: vi.fn(),
    pingMonitorUpdateTargets: vi.fn(),
    pingMonitorUpdateInterval: vi.fn(),
    confirmLogDir: vi.fn(),
    onPingMonitorData: vi.fn().mockResolvedValue(() => {}),
    onPingMonitorLogFile: vi.fn().mockResolvedValue(() => {}),
  },
}));

const mockStart = vi.mocked(tauriService.pingMonitorStart);
const mockStop = vi.mocked(tauriService.pingMonitorStop);
const mockUpdateTargets = vi.mocked(tauriService.pingMonitorUpdateTargets);
const mockUpdateInterval = vi.mocked(tauriService.pingMonitorUpdateInterval);
const mockConfirm = vi.mocked(tauriService.confirmLogDir);

/** Point the app-wide log folder somewhere, as Settings → General would. */
const setLogFolder = (path: string) => {
  act(() => {
    useSettingsStore.getState().update('loggingPath', path);
  });
};

const addTarget = (text: string) => {
  const input = screen.getByRole('textbox', { name: 'Add a target' });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tauriService.onPingMonitorData).mockResolvedValue(() => {});
  vi.mocked(tauriService.onPingMonitorLogFile).mockResolvedValue(() => {});
  mockStart.mockResolvedValue();
  mockStop.mockResolvedValue();
  mockUpdateTargets.mockResolvedValue();
  mockUpdateInterval.mockResolvedValue();
  act(() => {
    useSettingsStore.getState().reset();
  });
  localStorage.clear();
});

describe('PingMonitorPane', () => {
  it('shows the state and Start together, and a row to add targets', () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    expect(screen.getByRole('status').textContent).toBe('Stopped');
    expect(screen.getByRole('button', { name: /Start/ })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Add a target' })).toBeTruthy();
  });

  it('picks the interval with buttons, 5s by default', () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    const group = screen.getByRole('group', { name: 'Interval' });
    expect(group.querySelector('[aria-pressed="true"]')!.textContent).toBe('5s');
  });

  it('adds a target with Enter and lists it as a row', () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    addTarget('192.0.2.1');
    expect(screen.getByText('192.0.2.1')).toBeTruthy();
  });

  it('adds every target from a pasted list, skipping duplicates', () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    addTarget('192.0.2.1');
    const input = screen.getByRole('textbox', { name: 'Add a target' });
    fireEvent.paste(input, { clipboardData: { getData: () => '192.0.2.1\n198.51.100.20, sw-01.example.com' } });
    expect(document.querySelectorAll('.ping-monitor-row')).toHaveLength(3);
  });

  it('removes a target with its × button', () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    addTarget('192.0.2.1 198.51.100.20');
    fireEvent.click(screen.getByRole('button', { name: 'Remove 192.0.2.1' }));
    expect(screen.queryByText('192.0.2.1')).toBeNull();
    expect(screen.getByText('198.51.100.20')).toBeTruthy();
  });

  it('says to add a target when Start is pressed with none', async () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    await waitFor(() => expect(screen.getByText('Add at least one target')).toBeTruthy());
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('starts with the listed targets and shows Monitoring and Stop', async () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    addTarget('192.0.2.1, 198.51.100.20');
    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    await waitFor(() => {
      expect(mockStart).toHaveBeenCalledWith('pm-1', ['192.0.2.1', '198.51.100.20'], 5000, false, '');
      expect(screen.getByRole('status').textContent).toBe('Monitoring');
      expect(screen.getByRole('button', { name: /Stop/ })).toBeTruthy();
    });
  });

  it('stops and goes back to Stopped', async () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    addTarget('192.0.2.1');
    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    await waitFor(() => screen.getByRole('button', { name: /Stop/ }));
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }));
    await waitFor(() => {
      expect(mockStop).toHaveBeenCalledWith('pm-1');
      expect(screen.getByRole('status').textContent).toBe('Stopped');
    });
  });

  it('sends an added target to the running monitor at once', async () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    addTarget('192.0.2.1');
    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    await waitFor(() => screen.getByRole('button', { name: /Stop/ }));
    addTarget('198.51.100.20');
    await waitFor(() =>
      expect(mockUpdateTargets).toHaveBeenCalledWith('pm-1', ['192.0.2.1', '198.51.100.20']),
    );
  });

  it('changes the interval of the running monitor at once', async () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    addTarget('192.0.2.1');
    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    await waitFor(() => screen.getByRole('button', { name: /Stop/ }));
    fireEvent.click(screen.getByRole('button', { name: '10s' }));
    await waitFor(() => expect(mockUpdateInterval).toHaveBeenCalledWith('pm-1', 10000));
  });

  it('is still monitoring after its tab was hidden and shown again', async () => {
    const first = render(<PingMonitorPane paneId="pm-1" active={true} />);
    addTarget('192.0.2.1');
    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    await waitFor(() => screen.getByRole('button', { name: /Stop/ }));
    first.unmount();
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    expect(screen.getByRole('status').textContent).toBe('Monitoring');
    expect(screen.getByText('192.0.2.1')).toBeTruthy();
  });

  it('remembers the targets and interval for the next pane', () => {
    const { unmount } = render(<PingMonitorPane paneId="pm-1" active={true} />);
    addTarget('192.0.2.1');
    fireEvent.click(screen.getByRole('button', { name: '30s' }));
    unmount();
    expect(useSettingsStore.getState().pingMonitorConfig).toEqual({ targets: ['192.0.2.1'], intervalMs: 30000 });
    render(<PingMonitorPane paneId="pm-2" active={true} />);
    expect(screen.getByText('192.0.2.1')).toBeTruthy();
  });

  it('opens the log folder setting when Record CSV is pressed with no folder', () => {
    const onOpenLogSettings = vi.fn();
    render(<PingMonitorPane paneId="pm-1" active={true} onOpenLogSettings={onOpenLogSettings} />);
    fireEvent.click(screen.getByRole('button', { name: /Record CSV/ }));
    expect(onOpenLogSettings).toHaveBeenCalledTimes(1);
  });

  it('approves the log folder and starts logging to it', async () => {
    mockConfirm.mockResolvedValue(true);
    setLogFolder('C:/logs');
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    addTarget('192.0.2.1');
    fireEvent.click(screen.getByRole('button', { name: /Record CSV/ }));
    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith('C:/logs');
      expect(mockStart).toHaveBeenCalledWith('pm-1', ['192.0.2.1'], 5000, true, 'C:/logs');
    });
  });

  it('restarts the running monitor when recording is turned on', async () => {
    mockConfirm.mockResolvedValue(true);
    setLogFolder('C:/logs');
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    addTarget('192.0.2.1');
    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    await waitFor(() => screen.getByRole('button', { name: /Stop/ }));
    fireEvent.click(screen.getByRole('button', { name: /Record CSV/ }));
    await waitFor(() => {
      expect(mockStop).toHaveBeenCalledWith('pm-1');
      expect(mockStart).toHaveBeenLastCalledWith('pm-1', ['192.0.2.1'], 5000, true, 'C:/logs');
    });
  });

  it('keeps monitoring without logging and says so when the folder is not approved', async () => {
    mockConfirm.mockResolvedValue(false);
    setLogFolder('C:/logs');
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    addTarget('192.0.2.1');
    fireEvent.click(screen.getByRole('button', { name: /Record CSV/ }));
    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    await waitFor(() => {
      expect(mockStart).toHaveBeenCalledWith('pm-1', ['192.0.2.1'], 5000, false, '');
      expect(screen.getByText('Log folder was not approved — CSV logging is off')).toBeTruthy();
      expect(screen.getByRole('status').textContent).toBe('Monitoring');
    });
  });

  it('shows results in words with loss and average from the history', async () => {
    let emit: ((p: { sessionId: string; results: PingResult[] }) => void) | null = null;
    vi.mocked(tauriService.onPingMonitorData).mockImplementation(async (cb) => {
      emit = cb as typeof emit;
      return () => {};
    });
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    addTarget('192.0.2.1 sw-01.example.com');
    await waitFor(() => expect(emit).not.toBeNull());
    const at = '2026-10-09 14:03:21.000';
    act(() => {
      emit!({ sessionId: 'pm-1', results: [
        { target: '192.0.2.1', status: 'ok', rtt: 10, ttl: 64, timestamp: at },
        { target: 'sw-01.example.com', status: 'dns', rtt: null, ttl: null, timestamp: at },
      ] });
      emit!({ sessionId: 'pm-1', results: [
        { target: '192.0.2.1', status: 'fail', rtt: null, ttl: null, timestamp: at },
        { target: 'sw-01.example.com', status: 'dns', rtt: null, ttl: null, timestamp: at },
      ] });
    });
    const rows = document.querySelectorAll('.ping-monitor-row');
    expect(rows[0].textContent).toContain('No reply');
    expect(rows[0].textContent).toContain('50%');
    expect(rows[0].textContent).toContain('10 ms');
    expect(rows[1].textContent).toContain('Name not found');
  });
});
