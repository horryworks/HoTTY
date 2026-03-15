import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ResizeGrip } from './ResizeGrip';

vi.mock('../../services/electronService', () => ({
    setWindowSize: vi.fn(),
}));

import * as electronService from '../../services/electronService';

describe('ResizeGrip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders a div with title "Drag to resize"', () => {
        const { getByTitle } = render(<ResizeGrip />);
        expect(getByTitle('Drag to resize')).toBeInTheDocument();
    });

    it('has cursor "se-resize" style', () => {
        const { getByTitle } = render(<ResizeGrip />);
        const grip = getByTitle('Drag to resize');
        expect(grip).toHaveStyle({ cursor: 'se-resize' });
    });

    it('mouse down event starts dragging (sets up mousemove/mouseup listeners)', () => {
        const addEventSpy = vi.spyOn(window, 'addEventListener');
        const { getByTitle } = render(<ResizeGrip />);
        const grip = getByTitle('Drag to resize');

        fireEvent.mouseDown(grip);

        expect(addEventSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
        expect(addEventSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));

        addEventSpy.mockRestore();
    });

    it('after mousedown + mousemove, calls electronService.setWindowSize with mouse coordinates', () => {
        const { getByTitle } = render(<ResizeGrip />);
        const grip = getByTitle('Drag to resize');

        fireEvent.mouseDown(grip);
        fireEvent.mouseMove(window, { clientX: 800, clientY: 600 });

        expect(electronService.setWindowSize).toHaveBeenCalledWith(800, 600);
    });

    it('after mouseup, stops calling setWindowSize on further mousemove', () => {
        const { getByTitle } = render(<ResizeGrip />);
        const grip = getByTitle('Drag to resize');

        fireEvent.mouseDown(grip);
        fireEvent.mouseMove(window, { clientX: 800, clientY: 600 });
        expect(electronService.setWindowSize).toHaveBeenCalledTimes(1);

        fireEvent.mouseUp(window);
        fireEvent.mouseMove(window, { clientX: 900, clientY: 700 });

        // No additional calls after mouseup
        expect(electronService.setWindowSize).toHaveBeenCalledTimes(1);
    });
});
