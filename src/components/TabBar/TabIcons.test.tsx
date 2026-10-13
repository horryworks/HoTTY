import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FeatureIcon, ProtocolIcon, PlusIcon, ChevronIcon } from './TabIcons';
import type { FeaturePaneType } from '../../utils/paneTypes';
import type { ProtocolId } from '../../types/appTypes';

const svgOf = (ui: React.ReactElement) => render(ui).container.querySelector('svg');
/** The drawing itself, so two icons can be told apart. */
const shapeOf = (ui: React.ReactElement) => svgOf(ui)?.innerHTML ?? '';

const FEATURE_TYPES: FeaturePaneType[] = [
  'log-viewer',
  'ping-monitor',
  'interface-traffic',
  'file-server',
  'ai-chat',
  'web-browser',
];

describe('FeatureIcon', () => {
  it.each(FEATURE_TYPES)('draws a decorative 14px icon for %s', (type) => {
    const svg = svgOf(<FeatureIcon type={type} />);
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('width')).toBe('14');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
  });

  it('draws a different icon for every pane type', () => {
    const shapes = new Set(FEATURE_TYPES.map((type) => shapeOf(<FeatureIcon type={type} />)));
    expect(shapes.size).toBe(FEATURE_TYPES.length);
  });
});

describe('ProtocolIcon', () => {
  it('shares one console icon among the local shells', () => {
    const local: ProtocolId[] = ['wsl', 'cmd', 'powershell', 'git-bash'];
    const shapes = new Set(local.map((p) => shapeOf(<ProtocolIcon protocol={p} />)));
    expect(shapes.size).toBe(1);
  });

  it('shares one prompt icon among SSH, Telnet and an unknown protocol', () => {
    const ssh = shapeOf(<ProtocolIcon protocol="ssh" />);
    expect(shapeOf(<ProtocolIcon protocol="telnet" />)).toBe(ssh);
    expect(shapeOf(<ProtocolIcon />)).toBe(ssh);
  });

  it('gives IAP, serial, local shells and SSH each their own icon', () => {
    const shapes = new Set(
      (['gcloud-iap', 'serial', 'wsl', 'ssh'] as ProtocolId[]).map((p) => shapeOf(<ProtocolIcon protocol={p} />))
    );
    expect(shapes.size).toBe(4);
  });

  it('is decorative', () => {
    expect(svgOf(<ProtocolIcon protocol="serial" />)?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('PlusIcon', () => {
  it('draws a slightly bolder decorative icon', () => {
    const svg = svgOf(<PlusIcon />);
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('stroke-width')).toBe('1.8');
  });
});

describe('ChevronIcon', () => {
  it('is a small 10px icon', () => {
    const svg = svgOf(<ChevronIcon up={false} />);
    expect(svg?.getAttribute('width')).toBe('10');
    expect(svg?.getAttribute('height')).toBe('10');
  });

  it('points the way its list opens', () => {
    expect(svgOf(<ChevronIcon up />)?.querySelector('path')?.getAttribute('d')).toBe('M6 15l6-6 6 6');
    expect(svgOf(<ChevronIcon up={false} />)?.querySelector('path')?.getAttribute('d')).toBe('M6 9l6 6 6-6');
  });
});
