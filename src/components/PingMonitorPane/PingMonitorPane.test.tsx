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

const mockStart = vi.mocked(tauriService.pingMonitorStart);
const mockStop = vi.mocked(tauriService.pingMonitorStop);

beforeEach(() => {
  vi.clearAllMocks();
  // Re-setup default mock implementations
  vi.mocked(tauriService.onPingMonitorData).mockResolvedValue(() => {});
  vi.mocked(tauriService.onPingMonitorLogFile).mockResolvedValue(() => {});
});

describe('PingMonitorPane', () => {
  it('renders configuration form with target input and Start button', () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    expect(screen.getByText('Start')).toBeTruthy();
    expect(screen.getByPlaceholderText(/8\.8\.8\.8/)).toBeTruthy();
    expect(screen.getByText('Configure targets and click Start')).toBeTruthy();
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
        1000,
        false,
        ''
      );
    });
  });

  it('shows Stop button when running', async () => {
    mockStart.mockResolvedValue();

    render(<PingMonitorPane paneId="pm-1" active={true} />);
    const textarea = screen.getByPlaceholderText(/8\.8\.8\.8/);
    fireEvent.change(textarea, { target: { value: '8.8.8.8' } });
    fireEvent.click(screen.getByText('Start'));

    await waitFor(() => {
      expect(screen.getByText('Stop')).toBeTruthy();
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
    });
  });

  it('renders interval input with default value', () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    const input = document.querySelector('.ping-monitor-interval-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('1000');
  });

  it('renders CSV logging toggle', () => {
    render(<PingMonitorPane paneId="pm-1" active={true} />);
    expect(screen.getByText('CSV Logging')).toBeTruthy();
  });
});
