import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useTabKeyboardNav } from './useTabKeyboardNav';

interface StripProps {
    ids: string[];
    activeId: string | null;
    onSelect: (id: string) => void;
    wrap?: boolean;
}

function Strip({ ids, activeId, onSelect, wrap }: StripProps) {
    const { onKeyDown } = useTabKeyboardNav({ ids, activeId, onSelect, wrap });
    return <div data-testid="strip" tabIndex={0} onKeyDown={onKeyDown} />;
}

const IDS = ['a', 'b', 'c'];

function press(key: string, init: Partial<KeyboardEventInit> = {}) {
    // fireEvent returns false when the event's default action was prevented.
    return fireEvent.keyDown(screen.getByTestId('strip'), { key, ...init });
}

describe('useTabKeyboardNav', () => {
    it('moves to the next and previous tab', () => {
        const onSelect = vi.fn();
        render(<Strip ids={IDS} activeId="b" onSelect={onSelect} />);

        press('ArrowRight');
        expect(onSelect).toHaveBeenCalledWith('c');

        onSelect.mockClear();
        press('ArrowLeft');
        expect(onSelect).toHaveBeenCalledWith('a');
    });

    it('wraps around at both ends by default', () => {
        const onSelect = vi.fn();
        const { rerender } = render(<Strip ids={IDS} activeId="c" onSelect={onSelect} />);
        press('ArrowRight');
        expect(onSelect).toHaveBeenCalledWith('a');

        onSelect.mockClear();
        rerender(<Strip ids={IDS} activeId="a" onSelect={onSelect} />);
        press('ArrowLeft');
        expect(onSelect).toHaveBeenCalledWith('c');
    });

    it('stops at the ends when wrapping is off', () => {
        const onSelect = vi.fn();
        render(<Strip ids={IDS} activeId="c" onSelect={onSelect} wrap={false} />);
        press('ArrowRight');
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('jumps to the first and last tab with Home and End', () => {
        const onSelect = vi.fn();
        render(<Strip ids={IDS} activeId="b" onSelect={onSelect} />);

        press('Home');
        expect(onSelect).toHaveBeenCalledWith('a');

        onSelect.mockClear();
        press('End');
        expect(onSelect).toHaveBeenCalledWith('c');
    });

    it('always swallows a handled key, even when the selection does not move', () => {
        const onSelect = vi.fn();
        render(<Strip ids={IDS} activeId="c" onSelect={onSelect} wrap={false} />);
        // The whole reason this hook exists: an unhandled arrow makes the
        // scroll container creep sideways, which is what it is replacing.
        expect(press('ArrowRight')).toBe(false);
    });

    it('leaves unrelated keys alone', () => {
        const onSelect = vi.fn();
        render(<Strip ids={IDS} activeId="b" onSelect={onSelect} />);
        expect(press('ArrowDown')).toBe(true);
        expect(press('a')).toBe(true);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('ignores modified arrows so app shortcuts still work', () => {
        const onSelect = vi.fn();
        render(<Strip ids={IDS} activeId="b" onSelect={onSelect} />);
        expect(press('ArrowRight', { ctrlKey: true })).toBe(true);
        expect(press('ArrowRight', { altKey: true })).toBe(true);
        expect(press('ArrowRight', { metaKey: true })).toBe(true);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('selects the first tab when nothing is active yet', () => {
        const onSelect = vi.fn();
        render(<Strip ids={IDS} activeId={null} onSelect={onSelect} />);
        press('ArrowRight');
        expect(onSelect).toHaveBeenCalledWith('a');
    });

    it('does nothing with an empty strip', () => {
        const onSelect = vi.fn();
        render(<Strip ids={[]} activeId={null} onSelect={onSelect} />);
        expect(press('ArrowRight')).toBe(true);
        expect(onSelect).not.toHaveBeenCalled();
    });
});
