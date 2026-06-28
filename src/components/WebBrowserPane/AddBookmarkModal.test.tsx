import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddBookmarkModal } from './AddBookmarkModal';
import { useBookmarkStore } from '../../stores/bookmarkStore';

beforeEach(() => {
  useBookmarkStore.setState({ tree: [] });
});

describe('AddBookmarkModal', () => {
  it('prefills the name with the URL host and shows the URL read-only', () => {
    render(<AddBookmarkModal url="http://router.test/admin" onClose={() => {}} />);
    expect(screen.getByDisplayValue('router.test')).toBeTruthy();
    const urlInput = screen.getByDisplayValue('http://router.test/admin') as HTMLInputElement;
    expect(urlInput.readOnly).toBe(true);
  });

  it('lists folders from the store in the folder tree', () => {
    useBookmarkStore.getState().addFolder(null, 'Tools');
    render(<AddBookmarkModal url="http://x.test" onClose={() => {}} />);
    expect(screen.getByRole('option', { name: /Tools/ })).toBeTruthy();
  });

  it('adds the bookmark to the folder picked from the tree and closes', () => {
    const fid = useBookmarkStore.getState().addFolder(null, 'Tools');
    const onClose = vi.fn();
    render(<AddBookmarkModal url="http://x.test/p" onClose={onClose} />);
    fireEvent.click(screen.getByText('Tools'));
    fireEvent.click(screen.getByText('Add'));
    const folder = useBookmarkStore.getState().tree.find((n) => n.id === fid);
    expect(folder?.children?.some((c) => c.url === 'http://x.test/p')).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it('adds to the top level by default', () => {
    render(<AddBookmarkModal url="http://y.test" onClose={() => {}} />);
    fireEvent.click(screen.getByText('Add'));
    expect(useBookmarkStore.getState().tree.some((n) => n.url === 'http://y.test')).toBe(true);
  });

  it('uses the edited name', () => {
    render(<AddBookmarkModal url="http://z.test" onClose={() => {}} />);
    fireEvent.change(screen.getByDisplayValue('z.test'), { target: { value: 'My Router' } });
    fireEvent.click(screen.getByText('Add'));
    expect(useBookmarkStore.getState().tree.some((n) => n.name === 'My Router')).toBe(true);
  });

  it('Cancel closes without adding', () => {
    const onClose = vi.fn();
    render(<AddBookmarkModal url="http://z.test" onClose={onClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(useBookmarkStore.getState().tree).toHaveLength(0);
  });
});
