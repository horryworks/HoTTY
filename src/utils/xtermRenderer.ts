import type { Terminal } from '@xterm/xterm';
import { tauriService } from '../services/tauriService';

/**
 * Terminals a WebGL attach has already been attempted on. A WeakSet keyed by
 * the Terminal itself (not a component ref) because TerminalXtermHost re-runs
 * its mount effect whenever the pane re-attaches, while the Terminal instance
 * lives on in useSessionManager for the life of the session.
 */
const attempted = new WeakSet<Terminal>();

/**
 * Upgrade an already-opened terminal to the WebGL renderer.
 *
 * xterm's default DOM renderer is the slowest layer during heavy scrolling —
 * it mutates one span per styled run, per row, per frame. WebGL draws the whole
 * grid from a texture atlas instead, which is where the remaining terminal
 * throughput is.
 *
 * Every failure path silently keeps the DOM renderer, which is a fully
 * functional renderer and not something to interrupt the user about:
 *  - the chunk fails to load,
 *  - WebGL2 is unavailable (RDP sessions, old GPUs, driver blocklists) so
 *    `loadAddon` throws,
 *  - or the context is lost later, at which point disposing the addon hands
 *    rendering back to the DOM renderer mid-session.
 *
 * Loaded via dynamic `import()` so the addon lands in its own chunk rather than
 * the startup bundle. Must be called AFTER `term.open()` — the addon needs the
 * terminal's canvas.
 */
export function enableWebglRenderer(term: Terminal): void {
  if (attempted.has(term)) return;
  attempted.add(term);

  void import('@xterm/addon-webgl')
    .then(({ WebglAddon }) => {
      // The session can be closed while the chunk is in flight.
      if (!term.element) return;
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        tauriService
          .logDebug('warn', 'Terminal', 'WebGL context lost; falling back to the DOM renderer')
          .catch(() => {});
        addon.dispose();
      });
      term.loadAddon(addon);
    })
    .catch((err: unknown) => {
      tauriService
        .logDebug(
          'info',
          'Terminal',
          `WebGL renderer unavailable, using the DOM renderer: ${
            err instanceof Error ? err.message : String(err)
          }`
        )
        .catch(() => {});
    });
}
