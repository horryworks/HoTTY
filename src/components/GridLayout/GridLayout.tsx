import { useState, type ReactNode } from 'react';
import { usePaneStore, gridPaneIds } from '../../stores/paneStore';
import './GridLayout.css';

interface GridLayoutProps {
  renderPane: (paneId: string) => ReactNode;
  onDropSession: (sessionId: string, targetPaneId: string) => void;
}

export function GridLayout({ renderPane, onDropSession }: GridLayoutProps) {
  const layoutMode = usePaneStore((s) => s.layoutMode);
  const [rows, cols] = layoutMode.split('x').map((n) => parseInt(n, 10));
  const paneIds = gridPaneIds(layoutMode);
  const [dragOverPaneId, setDragOverPaneId] = useState<string | null>(null);

  const handleDragOver = (paneId: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-hotty-session')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverPaneId(paneId);
  };

  const handleDragLeave = () => setDragOverPaneId(null);

  const handleDrop = (paneId: string) => (e: React.DragEvent) => {
    const sessionId = e.dataTransfer.getData('application/x-hotty-session');
    setDragOverPaneId(null);
    if (!sessionId) return;
    e.preventDefault();
    e.stopPropagation();
    onDropSession(sessionId, paneId);
  };

  return (
    <div
      className="grid-layout"
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
    >
      {paneIds.map((paneId) => (
        <div
          className={`grid-layout-cell${
            dragOverPaneId === paneId ? ' drop-target' : ''
          }`}
          key={paneId}
          data-pane-id={paneId}
          onDragOver={handleDragOver(paneId)}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop(paneId)}
        >
          {renderPane(paneId)}
        </div>
      ))}
    </div>
  );
}
