import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PingMonitorPane } from './PingMonitorPane';
import { tauriService } from '../../services/tauriService';

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    pingMonitorStart: vi.fn(),
    pingMonitorStop: vi.fn(),
    pingMonitorUpdateTargets: vi.fn(),
    pingMonitorUpdateInterval: vi.fn(),
    onPingMonitorData: vi.fn().mockResolvedValue(() => {}),
    onPingMonitorLogFile: vi.fn().mockResolvedValue(() => {}),
  },
}));

vi.mock('../../hooks/useResize', () => ({
  useResize: () => ({ startResize: vi.fn(), isResizing: false }),
}));

const mockStart = vi.mocked(tauriService.pingMonitorStart);
const mockStop = vi.mocked(tauriService.pingMonitorStop);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tauriService.onPingMonitorData).mockResolvedValue(() => {});
  vi.mocked(tauriService.onPingMonitorLogFile).mockResolvedValue(() => {});
});

describe('PingMonitorPane', () => {
  it('renders split layout with targets editor and Start button', () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    expect(screen.getByText('Start')).toBeTruthy();
    expect(screen.getByPlaceholderText(/8\.8\.8\.8/)).toBeTruthy();
    expect(screen.getByText('Enter targets in the editor and click Start')).toBeTruthy();
  });

  it('renders toolbar with title, interval selector, and start button', () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    expect(screen.getByText('Ping Monitor')).toBeTruthy();
    expect(screen.getByText('Interval:')).toBeTruthy();
    const select = document.querySelector('.ping-monitor-interval-select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe('5000');
  });

  it('renders targets panel with header and count', () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    expect(screen.getByText('Targets')).toBeTruthy();
    const countEl = document.querySelector('.ping-monitor-targets-count');
    expect(countEl).toBeTruthy();
    expect(countEl!.textContent).toContain('0 target');
  });

  it('renders status bar showing Stopped state', () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    expect(screen.getByText('Stopped')).toBeTruthy();
    expect(screen.getByText('Interval: 5s')).toBeTruthy();
  });

  it('renders divider with collapse toggle', () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    const divider = document.querySelector('.ping-monitor-divider');
    expect(divider).toBeTruthy();
    const toggle = document.querySelector('.ping-monitor-divider-toggle');
    expect(toggle).toBeTruthy();
  });

  it('collapses targets panel when toggle is clicked', () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    expect(document.querySelector('.ping-monitor-targets-panel')).toBeTruthy();

    const toggle = document.querySelector('.ping-monitor-divider-toggle') as HTMLButtonElement;
    fireEvent.click(toggle);

    expect(document.querySelector('.ping-monitor-targets-panel')).toBeNull();
    expect(toggle.classList.contains('collapsed')).toBe(true);
  });

  it('expands targets panel when toggle is clicked again', () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    const toggle = document.querySelector('.ping-monitor-divider-toggle') as HTMLButtonElement;

    fireEvent.click(toggle); // collapse
    expect(document.querySelector('.ping-monitor-targets-panel')).toBeNull();

    fireEvent.click(toggle); // expand
    expect(document.querySelector('.ping-monitor-targets-panel')).toBeTruthy();
  });

  it('shows error when starting without targets', async () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    fireEvent.click(screen.getByText('Start'));

    await waitFor(() => {
      expect(screen.getByText('Enter at least one target')).toBeTruthy();
    });
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('calls pingMonitorStart with correct parameters', async () => {
    mockStart.mockResolvedValue();

    render(<PingMonitorPane paneId="pm-1" active={true} />);
    const textarea = screen.getByPlaceholderText(/8\.8\.8\.8/);
    fireEvent.change(textarea, { target: { value: '8.8.8.8, 1.1.1.1' } });
    fireEvent.click(screen.getByText('Start'));

    await waitFor(() => {
      expect(mockStart).toHaveBeenCalledWith(
        'pm-1',
        ['8.8.8.8', '1.1.1.1'],
        5000,
        false,
        ''
      );
    });
  });

  it('shows Stop button and Running status when running', async () => {
    mockStart.mockResolvedValue();

    render(<PingMonitorPane paneId="pm-1" active={true} />);
    const textarea = screen.getByPlaceholderText(/8\.8\.8\.8/);
    fireEvent.change(textarea, { target: { value: '8.8.8.8' } });
    fireEvent.click(screen.getByText('Start'));

    await waitFor(() => {
      expect(screen.getByText('Stop')).toBeTruthy();
      expect(screen.getByText('Running')).toBeTruthy();
    });
  });

  it('calls pingMonitorStop and shows Start button after stopping', async () => {
    mockStart.mockResolvedValue();
    mockStop.mockResolvedValue();

    render(<PingMonitorPane paneId="pm-1" active={true} />);
    const textarea = screen.getByPlaceholderText(/8\.8\.8\.8/);
    fireEvent.change(textarea, { target: { value: '8.8.8.8' } });
    fireEvent.click(screen.getByText('Start'));

    await waitFor(() => {
      expect(screen.getByText('Stop')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Stop'));

    await waitFor(() => {
      expect(mockStop).toHaveBeenCalledWith('pm-1');
      expect(screen.getByText('Start')).toBeTruthy();
      expect(screen.getByText('Stopped')).toBeTruthy();
    });
  });

  it('renders CSV logging toggle', () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    expect(screen.getByText('CSV Logging')).toBeTruthy();
  });

  it('updates target count as targets are entered', () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    const textarea = screen.getByPlaceholderText(/8\.8\.8\.8/);
    fireEvent.change(textarea, { target: { value: '8.8.8.8\n1.1.1.1' } });
    const countEl = document.querySelector('.ping-monitor-targets-count');
    expect(countEl!.textContent).toContain('2 target');
  });
});
