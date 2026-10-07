/**
 * The parts list, open over the score: a row for each part, top to bottom. The selected row is
 * the cursor's part, so j/k move the cursor from part to part. J/K move the part itself down or
 * up the score, o and O add one below or above it, choosing its instrument with the picker, and
 * d deletes it. u and <C-r> undo and redo, each change being its own step.
 */

import { Composition } from '../composition/Composition';
import { Cursor, cursorAtOffset, cursorOffset, movePart } from '../cursor/Cursor';
import { deletePart, shiftPart } from '../edit/Parts';

export type PartsOutcome =
    | { cursor: Cursor; composition?: Composition }
    /** Pick an instrument for a new part at this index */
    | { add: number }
    | { history: 'undo' | 'redo' }
    | { closed: true };

const DOWN = new Set(['j', '<Down>', '<C-n>', '<Tab>']);
const UP = new Set(['k', '<Up>', '<C-p>', '<S-Tab>']);
const CLOSE = new Set(['<Esc>', '<CR>', 'q']);

export function partsKey(composition: Composition, cursor: Cursor, key: string): PartsOutcome {
    if (CLOSE.has(key)) return { closed: true };
    if (key === 'u') return { history: 'undo' };
    if (key === '<C-r>') return { history: 'redo' };
    if (key === 'o') return { add: cursor.part + 1 };
    if (key === 'O') return { add: cursor.part };

    const move = DOWN.has(key) ? 1 : UP.has(key) ? -1 : 0;
    if (move !== 0) return { cursor: movePart(composition, cursor, move) };

    // The part keeps its notes, so the cursor goes with it as it is
    const shift = key === 'J' ? 1 : key === 'K' ? -1 : 0;
    if (shift !== 0) {
        const shifted = shiftPart(composition, cursor.part, cursor.part + shift);
        return shifted ? { cursor: { ...cursor, part: cursor.part + shift }, composition: shifted } : { cursor };
    }

    if (key === 'd' || key === 'x') {
        // The part below takes its place, or the one above at the bottom
        const deleted = deletePart(composition, cursor.part);
        if (!deleted) return { cursor };
        const part = Math.min(cursor.part, deleted.parts.length - 1);
        const moved = cursorAtOffset(deleted, part, cursor.measure, cursorOffset(composition, cursor));
        return { cursor: moved, composition: deleted };
    }
    return { cursor };
}
