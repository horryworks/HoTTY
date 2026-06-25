// Catalogue français. Les clés non traduites se replient sur l'anglais à l'exécution (LocaleCatalog).
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

export const fr: LocaleCatalog<Messages> = {
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
