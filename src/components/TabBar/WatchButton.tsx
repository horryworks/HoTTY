import type { CSSProperties, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { conversationColorVar } from '../../utils/conversationColor';

interface WatchButtonProps {
  isWatching: boolean;
  /** The watching conversation's color index, when watched. */
  colorIndex?: number;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * The AI link button: links a terminal to an AI Chat conversation (or shows
 * that it is linked, pulsing in that conversation's color). Shared by the tab
 * rows and the terminal pane header.
 */
export function WatchButton({ isWatching, colorIndex, onClick }: WatchButtonProps) {
  const { t } = useTranslation();
  const style =
    isWatching && colorIndex != null
      ? ({ '--tab-watch-color': conversationColorVar(colorIndex) } as CSSProperties)
      : undefined;
  return (
    <button
      type="button"
      className={`tab-watch-btn${isWatching ? ' watching' : ''}`}
      style={style}
      title={isWatching ? t('chrome.tabBar.aiMonitorActive') : t('chrome.tabBar.aiMonitorStart')}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      aria-label={isWatching ? t('chrome.tabBar.aiMonitorStopAria') : t('chrome.tabBar.aiMonitorStartAria')}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle
          cx="12"
          cy="12"
          r="10"
          fill={isWatching ? 'var(--tab-watch-color, var(--success-color))' : 'currentColor'}
          opacity={isWatching ? 1 : 0.7}
        />
        <circle
          cx="12"
          cy="12"
          r="6"
          fill={isWatching ? 'var(--tab-watch-color, var(--accent-light))' : 'currentColor'}
          opacity={isWatching ? 0.9 : 0.45}
        />
      </svg>
    </button>
  );
}
