// 繁體中文（台灣）目錄。未翻譯的鍵會在執行時回退至英文（LocaleCatalog）。
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

export const zhTW: LocaleCatalog<Messages> = {
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
