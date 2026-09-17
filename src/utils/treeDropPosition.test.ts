import { describe, it, expect } from 'vitest';
import { computeDropPosition } from './treeDropPosition';

/** A 20px row, the only height that makes the quarter boundaries whole numbers. */
const at = (
    offsetY: number,
    over: Partial<{ height: number; isFolder: boolean; showsChildren: boolean }> = {},
) =>
    computeDropPosition({
        offsetY,
        height: 20,
        isFolder: false,
        showsChildren: false,
        ...over,
    });

const leaf = (offsetY: number) => at(offsetY);
const folded = (offsetY: number) => at(offsetY, { isFolder: true });
const open = (offsetY: number) => at(offsetY, { isFolder: true, showsChildren: true });

describe('computeDropPosition', () => {
    describe('a leaf row', () => {
        it('splits in half', () => {
            expect(leaf(0)).toBe('before');
            expect(leaf(9)).toBe('before');
            expect(leaf(10)).toBe('after');
            expect(leaf(20)).toBe('after');
        });

        it('never offers "inside" — there is nothing to go into', () => {
            for (let y = 0; y <= 20; y++) expect(leaf(y)).not.toBe('inside');
        });
    });

    describe('a folder with its children hidden', () => {
        it('splits in quarters', () => {
            expect(folded(4)).toBe('before');
            expect(folded(5)).toBe('inside');
            expect(folded(15)).toBe('inside');
            expect(folded(16)).toBe('after');
        });
    });

    describe('a folder already showing its children', () => {
        // Its bottom edge touches its first child, not its next sibling, so an
        // "after" line drawn there would point at the wrong place.
        it('has no "after" band', () => {
            for (let y = 0; y <= 20; y++) expect(open(y)).not.toBe('after');
        });

        it('keeps the top quarter for "before" and drops inside everywhere else', () => {
            expect(open(4)).toBe('before');
            expect(open(5)).toBe('inside');
            expect(open(19)).toBe('inside');
        });
    });

    describe('a zero-height row', () => {
        // jsdom's getBoundingClientRect() returns zeroes, so every component
        // drag test in this repo measures rows this way. Pin the answers.
        it('reads as "after" for a leaf and "inside" for a folder', () => {
            expect(at(0, { height: 0 })).toBe('after');
            expect(at(0, { height: 0, isFolder: true })).toBe('inside');
            expect(at(0, { height: 0, isFolder: true, showsChildren: true })).toBe('inside');
        });
    });

    describe('a pointer that strays outside the row', () => {
        it('stays within the three positions', () => {
            expect(leaf(-5)).toBe('before');
            expect(leaf(25)).toBe('after');
            expect(folded(-5)).toBe('before');
            expect(folded(25)).toBe('after');
            expect(open(25)).toBe('inside');
        });
    });
});
