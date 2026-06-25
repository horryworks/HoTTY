// 한국어 카탈로그. 번역되지 않은 키는 런타임에 영어로 폴백됩니다 (LocaleCatalog).
import type { Messages } from '../en';
import type { LocaleCatalog } from '../../types';
import { common } from './common';
import { settings } from './settings';
import { dialogs } from './dialogs';
import { chrome } from './chrome';
import { sessionDialog } from './sessionDialog';
import { hostTree } from './hostTree';
import { panes } from './panes';
import { aiChat } from './aiChat';
import { notifications } from './notifications';
import { terminal } from './terminal';
import { help } from './help';

export const ko: LocaleCatalog<Messages> = {
  common,
  settings,
  dialogs,
  chrome,
  sessionDialog,
  hostTree,
  panes,
  aiChat,
  notifications,
  terminal,
  help,
};
