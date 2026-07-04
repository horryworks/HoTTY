import { describe, it, expect, beforeEach } from 'vitest';
import { useWebBrowserZoomStore } from './webBrowserZoomStore';

describe('webBrowserZoomStore', () => {
  beforeEach(() => {
    useWebBrowserZoomStore.setState({ zoom: {} });
  });

  it('starts empty', () => {
    expect(useWebBrowserZoomStore.getState().zoom).toEqual({});
  });

  it('setZoom records a per-pane zoom level', () => {
    useWebBrowserZoomStore.getState().setZoom('pane-1', 125);
    expect(useWebBrowserZoomStore.getState().zoom).toEqual({ 'pane-1': 125 });
  });

  it('setZoom keeps panes independent', () => {
    const { setZoom } = useWebBrowserZoomStore.getState();
    setZoom('pane-1', 110);
    setZoom('pane-2', 90);
    expect(useWebBrowserZoomStore.getState().zoom).toEqual({
      'pane-1': 110,
      'pane-2': 90,
    });
  });

  it('setZoom overwrites the same pane', () => {
    const { setZoom } = useWebBrowserZoomStore.getState();
    setZoom('pane-1', 100);
    setZoom('pane-1', 150);
    expect(useWebBrowserZoomStore.getState().zoom['pane-1']).toBe(150);
  });

  it('setZoom is a no-op (same state reference) when the value is unchanged', () => {
    useWebBrowserZoomStore.getState().setZoom('pane-1', 100);
    const before = useWebBrowserZoomStore.getState().zoom;
    useWebBrowserZoomStore.getState().setZoom('pane-1', 100);
    // Unchanged value must not produce a new object (avoids needless re-renders).
    expect(useWebBrowserZoomStore.getState().zoom).toBe(before);
  });

  it('removeZoom deletes a pane entry without touching others', () => {
    const { setZoom, removeZoom } = useWebBrowserZoomStore.getState();
    setZoom('pane-1', 110);
    setZoom('pane-2', 90);
    removeZoom('pane-1');
    expect(useWebBrowserZoomStore.getState().zoom).toEqual({ 'pane-2': 90 });
  });

  it('removeZoom is a no-op (same state reference) for an absent pane', () => {
    useWebBrowserZoomStore.getState().setZoom('pane-1', 110);
    const before = useWebBrowserZoomStore.getState().zoom;
    useWebBrowserZoomStore.getState().removeZoom('missing');
    expect(useWebBrowserZoomStore.getState().zoom).toBe(before);
  });
});
