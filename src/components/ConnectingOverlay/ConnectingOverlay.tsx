import './ConnectingOverlay.css';

interface ConnectingOverlayProps {
  displayName: string;
}

export function ConnectingOverlay({ displayName }: ConnectingOverlayProps) {
  return (
    <div className="connecting-overlay" role="status" aria-live="polite">
      <div className="connecting-overlay-content">
        <div className="connecting-overlay-label">Connecting to</div>
        <div className="connecting-overlay-target">{displayName}</div>
        <div className="connecting-overlay-dots" aria-hidden="true">
          <span className="connecting-overlay-dot" />
          <span className="connecting-overlay-dot" />
          <span className="connecting-overlay-dot" />
        </div>
      </div>
    </div>
  );
}
