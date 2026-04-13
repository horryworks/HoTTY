import { describe, it, expect, vi } from 'vitest';

vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => ({
    render: vi.fn(),
  })),
}));

vi.mock('./App', () => ({
  default: () => null,
}));

describe('main', () => {
  it('calls createRoot with root element', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);

    const { createRoot } = await import('react-dom/client');
    await import('./main');

    expect(createRoot).toHaveBeenCalledWith(root);

    document.body.removeChild(root);
  });
});
