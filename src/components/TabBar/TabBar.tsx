import { useState } from 'react';
import type { SessionRecord } from '../../hooks/useSessionManager';
import './TabBar.css';

interface TabBarProps {
  sessions: SessionRecord[];
  activeSessionId: string | null;
  visibleSessionIds: string[];
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

type DragOverSide = 'left' | 'right' | null;

export function TabBar({
  sessions,
  activeSessionId,
  visibleSessionIds,
  onSelect,
  onClose,
  onNew,
  onReorder,
}: TabBarProps) {
  const [dragSourceIndex, setDragSourceIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragOverSide, setDragOverSide] = useState<DragOverSide>(null);

  const visibleSet = new Set(visibleSessionIds);

  const handleDragStart = (index: number, sessionId: string) => (e: React.DragEvent) => {
    setDragSourceIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-hotty-session', sessionId);
    e.dataTransfer.setData('text/plain', sessionId);
  };

  const handleDragOver = (index: number) => (e: React.DragEvent) => {
    if (dragSourceIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const side: DragOverSide = e.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
    setDragOverIndex(index);
    setDragOverSide(side);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
    setDragOverSide(null);
  };

  const handleDrop = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragSourceIndex === null) return;
    let target = index;
    if (dragOverSide === 'right') target = index + 1;
    if (target > dragSourceIndex) target -= 1;
    if (target !== dragSourceIndex) onReorder(dragSourceIndex, target);
    setDragSourceIndex(null);
    setDragOverIndex(null);
    setDragOverSide(null);
  };

  const handleDragEnd = () => {
    setDragSourceIndex(null);
    setDragOverIndex(null);
    setDragOverSide(null);
  };

  return (
    <div className="tab-bar">
      <div className="tab-list">
        {sessions.map((s, i) => {
          const isActive = s.id === activeSessionId;
          const isHidden = !visibleSet.has(s.id);
          const dragOverCls =
            dragOverIndex === i && dragOverSide
              ? ` drag-over-${dragOverSide}`
              : '';
          return (
            <div
              key={s.id}
              data-session-id={s.id}
              draggable
              className={`tab${isActive ? ' active' : ''}${
                s.status === 'error' ? ' error' : ''
              }${isHidden ? ' hidden-tab' : ''}${dragOverCls}`}
              onClick={() => onSelect(s.id)}
              onDragStart={handleDragStart(i, s.id)}
              onDragOver={handleDragOver(i)}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop(i)}
              onDragEnd={handleDragEnd}
              title={s.errorMessage ?? s.displayName}
            >
              <span className={`tab-status tab-status-${s.status}`} />
              <span className="tab-label">{s.displayName}</span>
              <button
                type="button"
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(s.id);
                }}
                aria-label="Close session"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <div className="new-tab-btn" onClick={onNew} title="New Session" role="button" tabIndex={0}>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 3a8 8 0 0 1 8 7.2" />
          <rect x="16" y="12" width="6" height="8" rx="1" />
          <path d="M19 12V10" />
          <line x1="12" y1="8" x2="12" y2="14" />
          <line x1="9" y1="11" x2="15" y2="11" />
        </svg>
      </div>
    </div>
  );
}
