import { describe, it, expect } from 'vitest';
import { PROTOCOLS } from './protocols';
import { chrome as en } from '../i18n/locales/en/chrome';
import { chrome as ja } from '../i18n/locales/ja/chrome';
import { chrome as es } from '../i18n/locales/es/chrome';
import { chrome as fr } from '../i18n/locales/fr/chrome';
import { chrome as ko } from '../i18n/locales/ko/chrome';
import { chrome as ru } from '../i18n/locales/ru/chrome';
import { chrome as zhCN } from '../i18n/locales/zh-CN/chrome';
import { chrome as zhTW } from '../i18n/locales/zh-TW/chrome';

const LOCALES = { en, ja, es, fr, ko, ru, 'zh-CN': zhCN, 'zh-TW': zhTW };

describe('PROTOCOLS', () => {
  it('lists each protocol once, in menu order, without gcloud-iap', () => {
    const values = PROTOCOLS.map((p) => p.value);
    expect(values).toEqual(['ssh', 'telnet', 'serial', 'wsl', 'cmd', 'powershell', 'git-bash']);
    expect(new Set(values).size).toBe(values.length);
  });

  it('translates the ordinary words and keeps product names as they are', () => {
    const translated = PROTOCOLS.filter((p) => p.labelKey).map((p) => p.value);
    expect(translated).toEqual(['serial', 'cmd']);
  });

  it('has every label key in every language', () => {
    for (const p of PROTOCOLS) {
      if (!p.labelKey) continue;
      const key = p.labelKey.replace(/^chrome\.tabBar\./, '') as keyof typeof en.tabBar;
      for (const [lang, chrome] of Object.entries(LOCALES)) {
        expect(chrome.tabBar[key], `${lang} ${p.labelKey}`).toBeTruthy();
      }
    }
  });

  it('keeps the English fallback equal to the English translation', () => {
    expect(PROTOCOLS.find((p) => p.value === 'serial')?.label).toBe(en.tabBar.protocolSerial);
    expect(PROTOCOLS.find((p) => p.value === 'cmd')?.label).toBe(en.tabBar.protocolCmd);
  });
});
