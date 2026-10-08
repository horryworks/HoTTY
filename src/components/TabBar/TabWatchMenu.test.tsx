import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { TabWatchMenu } from './TabWatchMenu';

const conversations = [
  { id: 'c1', title: 'Tab 1', colorIndex: 0 },
  { id: 'c2', title: 'Tab 2', colorIndex: 1 },
];

describe('TabWatchMenu', () => {
  // jsdom has no layout: give the menu a real size and the window a fixed one.
  const original = {
    w: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
    h: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
    iw: window.innerWidth,
    ih: window.innerHeight,
  };
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 200 });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 100 });
    window.innerWidth = 1000;
    window.innerHeight = 600;
  });
  afterEach(() => {
    if (original.w) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', original.w);
    if (original.h) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original.h);
    window.innerWidth = original.iw;
    window.innerHeight = original.ih;
  });

  const open = (x: number, y: number, anchorTop?: number) =>
    render(
      <TabWatchMenu
        menu={{ sessionId: 's1', x, y, anchorTop }}
        conversations={conversations}
        onWatchInConversation={() => {}}
        onClose={() => {}}
      />
    ).container.querySelector<HTMLElement>('.tab-watch-menu')!;

  it('stays inside the right edge when opened from a button at the far right', () => {
    const el = open(950, 40, 20);
    expect(el.style.left).toBe('796px');
    expect(el.style.top).toBe('40px');
  });

  it('opens above its button when there is no room below', () => {
    const el = open(100, 590, 570);
    expect(el.style.top).toBe('468px');
  });
});
