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
      <span className="tab-watch-mark" aria-hidden="true">
        AI
      </span>
    </button>
  );
}
