import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { IapVmStartPromptPayload } from '../../types/appTypes';

const gceIapRespondVmStart = vi.fn().mockResolvedValue(undefined);
let emit: ((payload: IapVmStartPromptPayload) => void) | null = null;

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    onIapVmStartPrompt: (cb: (p: IapVmStartPromptPayload) => void) => {
      emit = cb;
      return Promise.resolve(() => {
        emit = null;
      });
    },
    gceIapRespondVmStart: (sessionId: string, approved: boolean) =>
      gceIapRespondVmStart(sessionId, approved),
  },
}));

import { IapVmStartModal } from './IapVmStartModal';

const samplePayload: IapVmStartPromptPayload = {
  sessionId: 'sess-iap-1',
  project: 'my-project-123',
  zone: 'us-central1-a',
  instance: 'vm-01',
  currentStatus: 'TERMINATED',
};

describe('IapVmStartModal', () => {
  beforeEach(() => {
    gceIapRespondVmStart.mockClear();
    emit = null;
  });

  it('renders nothing until a prompt is emitted', () => {
    const { container } = render(<IapVmStartModal />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the project, zone, instance, and current status on prompt', async () => {
    render(<IapVmStartModal />);
    await waitFor(() => expect(emit).not.toBeNull());
    act(() => emit!(samplePayload));
    expect(screen.getByText('Start GCE VM?')).toBeTruthy();
    expect(screen.getByText('vm-01')).toBeTruthy();
    expect(screen.getByText('my-project-123')).toBeTruthy();
    expect(screen.getByText('us-central1-a')).toBeTruthy();
    expect(screen.getByText('TERMINATED')).toBeTruthy();
  });

  it('Start VM calls gceIapRespondVmStart(sessionId, true)', async () => {
    render(<IapVmStartModal />);
    await waitFor(() => expect(emit).not.toBeNull());
    act(() => emit!(samplePayload));
    fireEvent.click(screen.getByText('Start VM'));
    expect(gceIapRespondVmStart).toHaveBeenCalledWith('sess-iap-1', true);
  });

  it('Cancel calls gceIapRespondVmStart(sessionId, false)', async () => {
    render(<IapVmStartModal />);
    await waitFor(() => expect(emit).not.toBeNull());
    act(() => emit!(samplePayload));
    fireEvent.click(screen.getByText('Cancel'));
    expect(gceIapRespondVmStart).toHaveBeenCalledWith('sess-iap-1', false);
  });
});
