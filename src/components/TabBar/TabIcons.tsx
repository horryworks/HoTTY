import type { ProtocolId } from '../../types/appTypes';
import type { FeaturePaneType } from '../../utils/paneTypes';

const SVG = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** Icon for what a feature pane is. Shared by the tab rows and the New Session menu. */
export function FeatureIcon({ type }: { type: FeaturePaneType }) {
  switch (type) {
    case 'log-viewer':
      return (
        <svg {...SVG}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="8" y1="13" x2="16" y2="13" />
          <line x1="8" y1="17" x2="14" y2="17" />
        </svg>
      );
    case 'ping-monitor':
      return (
        <svg {...SVG}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case 'interface-traffic':
      return (
        <svg {...SVG}>
          <polyline points="3 17 9 11 13 15 21 7" />
          <polyline points="15 7 21 7 21 13" />
        </svg>
      );
    case 'file-server':
      return (
        <svg {...SVG}>
          <rect x="2" y="3" width="20" height="6" rx="1" />
          <rect x="2" y="15" width="20" height="6" rx="1" />
          <line x1="6" y1="6" x2="6.01" y2="6" />
          <line x1="6" y1="18" x2="6.01" y2="18" />
        </svg>
      );
    case 'ai-chat':
      return (
        <svg {...SVG}>
          <path d="M12 2L14.8 9.2L22 12L14.8 14.8L12 22L9.2 14.8L2 12L9.2 9.2L12 2Z" />
        </svg>
      );
    case 'web-browser':
      return (
        <svg {...SVG}>
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2c3 3 3 17 0 20M12 2c-3 3-3 17 0 20" />
        </svg>
      );
  }
}

/** Icon for the kind of connection a terminal tab is. */
export function ProtocolIcon({ protocol }: { protocol?: ProtocolId }) {
  if (protocol === 'gcloud-iap') {
    return (
      <svg {...SVG}>
        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z" />
      </svg>
    );
  }
  if (protocol === 'serial') {
    return (
      <svg {...SVG}>
        <path d="M8 3v5M16 3v5M5 8h14v4a7 7 0 0 1-14 0zM12 19v2" />
      </svg>
    );
  }
  if (protocol === 'wsl' || protocol === 'cmd' || protocol === 'powershell' || protocol === 'git-bash') {
    return (
      <svg {...SVG}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 10l3 2.5L7 15M12 15h4" />
      </svg>
    );
  }
  return (
    <svg {...SVG}>
      <path d="M4 6l6 6-6 6M12 18h8" />
    </svg>
  );
}

/** "+": the New Session row. */
export function PlusIcon() {
  return (
    <svg {...SVG} strokeWidth={1.8}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Small chevron for the overflow button; points the way its list opens. */
export function ChevronIcon({ up }: { up: boolean }) {
  return (
    <svg {...SVG} width={10} height={10} strokeWidth={2.2}>
      <path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
    </svg>
  );
}
