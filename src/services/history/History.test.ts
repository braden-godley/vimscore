import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import { START } from '../cursor/Cursor';
import { EMPTY_HISTORY, Snapshot, record, redo, undo } from './History';

/** Snapshots told apart by title */
const version = (title: string): Snapshot => ({ composition: { ...exampleComposition, title }, cursor: START });
const title = (snapshot: Snapshot | undefined) => snapshot?.composition.title;

// Edits a → b → c, so c is current
const edited = record(record(EMPTY_HISTORY, version('a')), version('b'));

describe('History', () => {
    it('undoes and redoes one step at a time', () => {
        const back = undo(edited, version('c'))!;
        expect(title(back.snapshot)).toBe('b');
        const forward = redo(back.history, back.snapshot)!;
        expect(title(forward.snapshot)).toBe('c');
        expect(forward.history).toEqual(edited);
    });

    it('takes counts, stopping at the oldest version', () => {
        const back = undo(edited, version('c'), 5)!;
        expect(title(back.snapshot)).toBe('a');
        expect(back.history.undo).toEqual([]);

        // Redoing one step from a lands on b, then c
        const once = redo(back.history, back.snapshot)!;
        expect(title(once.snapshot)).toBe('b');
        expect(title(redo(once.history, once.snapshot)?.snapshot)).toBe('c');
    });

    it('has nothing to undo or redo at the ends', () => {
        expect(undo(EMPTY_HISTORY, version('a'))).toBeUndefined();
        expect(redo(edited, version('c'))).toBeUndefined();
    });

    it('forgets redo on a new edit', () => {
        const back = undo(edited, version('c'))!;
        expect(record(back.history, back.snapshot).redo).toEqual([]);
    });
});
