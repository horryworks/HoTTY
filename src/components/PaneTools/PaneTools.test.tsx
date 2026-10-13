import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BarSparkline, LineSparkline, RunButton, RunStatus, Segmented, StartButton } from './PaneTools';

describe('RunStatus', () => {
  it('shows the label as a status in the given tone', () => {
    render(<RunStatus tone="waiting" label="Waiting" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Waiting');
    expect(status.classList.contains('waiting')).toBe(true);
  });
});

describe('RunButton', () => {
  it('offers Start while stopped and calls onStart', () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    render(<RunButton running={false} startLabel="Start" stopLabel="Stop" onStart={onStart} onStop={onStop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });

  it('offers Stop while running and calls onStop', () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    render(<RunButton running startLabel="Start" stopLabel="Stop" onStart={onStart} onStop={onStop} />);
    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop.classList.contains('stop')).toBe(true);
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('never submits a surrounding form', () => {
    render(<RunButton running={false} startLabel="Start" stopLabel="Stop" onStart={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Start' }).getAttribute('type')).toBe('button');
  });

  it('can be disabled', () => {
    render(<RunButton running={false} startLabel="Start" stopLabel="Stop" onStart={vi.fn()} onStop={vi.fn()} disabled />);
    expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('StartButton', () => {
  it('looks like the start half of RunButton', () => {
    render(<StartButton label="Go" className="extra" />);
    const button = screen.getByRole('button', { name: 'Go' });
    expect(button.classList.contains('pt-run-btn')).toBe(true);
    expect(button.classList.contains('start')).toBe(true);
    expect(button.classList.contains('extra')).toBe(true);
    // The play icon comes first, as in RunButton.
    expect(button.firstElementChild?.tagName.toLowerCase()).toBe('svg');
  });

  it('submits its form when asked to', () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <StartButton submit label="Connect" />
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Connect' });
    expect(button.getAttribute('type')).toBe('submit');
    fireEvent.submit(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('acts on its own click otherwise', () => {
    const onClick = vi.fn();
    render(<StartButton label="Go" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Go' });
    expect(button.getAttribute('type')).toBe('button');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('Segmented', () => {
  const options = [
    { value: 5, label: '5s' },
    { value: 10, label: '10s' },
  ] as const;

  it('marks the chosen option and reports a press at once', () => {
    const onChange = vi.fn();
    render(<Segmented options={options} value={5} onChange={onChange} ariaLabel="Interval" />);
    expect(screen.getByRole('group', { name: 'Interval' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '5s' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '10s' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '10s' }));
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it('disables every option together', () => {
    render(<Segmented options={options} value={5} onChange={vi.fn()} ariaLabel="Interval" disabled />);
    for (const b of screen.getAllByRole('button')) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

describe('BarSparkline', () => {
  it('draws one bar per probe, a miss as a full-height red bar', () => {
    const { container } = render(<BarSparkline values={[10, null, 20]} slots={3} height={18} />);
    expect(container.querySelectorAll('rect')).toHaveLength(3);
    const fail = container.querySelector('.pt-spark-fail')!;
    expect(fail.getAttribute('height')).toBe('18');
    expect(container.querySelectorAll('.pt-spark-ok')).toHaveLength(2);
  });

  it('keeps only the newest probes that fit', () => {
    const { container } = render(<BarSparkline values={[1, 2, 3, 4, 5]} slots={3} />);
    expect(container.querySelectorAll('rect')).toHaveLength(3);
  });
});

describe('LineSparkline', () => {
  it('draws a line and marks the newest point', () => {
    const { container } = render(<LineSparkline values={[1, 2, 3]} />);
    expect(container.querySelector('.pt-spark-line')).toBeTruthy();
    expect(container.querySelector('.pt-spark-end')).toBeTruthy();
  });

  it('skips polls with no value and draws no line from a single point', () => {
    const { container } = render(<LineSparkline values={[undefined, 4, undefined]} />);
    expect(container.querySelector('.pt-spark-line')).toBeNull();
    expect(container.querySelector('.pt-spark-end')).toBeTruthy();
  });

  it('paints the warning colour when hot', () => {
    const { container } = render(<LineSparkline values={[1, 2]} hot />);
    expect(container.querySelector('svg')!.classList.contains('hot')).toBe(true);
  });
});
