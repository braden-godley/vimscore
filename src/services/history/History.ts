/**
 * Undo and redo, as stacks of whole snapshots. Edits never change a composition in place and
 * share everything they don't touch, so keeping every version costs little.
 */

import { Composition } from '../composition/Composition';
import { Cursor } from '../cursor/Cursor';

/** A version of the score, and where the cursor was in it */
export interface Snapshot {
    composition: Composition;
    cursor: Cursor;
}

export interface History {
    /** Most recent last */
    undo: Snapshot[];
    redo: Snapshot[];
}

export const EMPTY_HISTORY: History = { undo: [], redo: [] };

/** Oldest versions are dropped past this */
const LIMIT = 1000;

/** Where an undo or redo lands, and the history after it */
export interface Step {
    history: History;
    snapshot: Snapshot;
}

/** Remembers the version before an edit. A new edit means there's nothing left to redo */
export function record(history: History, before: Snapshot): History {
    return { undo: [...history.undo, before].slice(-LIMIT), redo: [] };
}

/**
 * Steps back `count` versions, or as many as there are. `current` goes on the redo stack so it
 * can come back. Undefined when there's nothing to undo.
 */
export function undo(history: History, current: Snapshot, count = 1): Step | undefined {
    return step(history.undo, history.redo, current, count, (undo, redo) => ({ undo, redo }));
}

export function redo(history: History, current: Snapshot, count = 1): Step | undefined {
    return step(history.redo, history.undo, current, count, (redo, undo) => ({ undo, redo }));
}

/** Moves snapshots from one stack to the other, `current` first, and lands on the last one taken */
function step(
    from: Snapshot[],
    to: Snapshot[],
    current: Snapshot,
    count: number,
    rebuild: (from: Snapshot[], to: Snapshot[]) => History,
): Step | undefined {
    const taken = Math.min(count, from.length);
    if (taken === 0) return undefined;

    // Taken newest first: each one passed over goes onto the other stack in the order it's met
    const passed = [current, ...from.slice(from.length - taken + 1).reverse()];
    return {
        history: rebuild(from.slice(0, from.length - taken), [...to, ...passed]),
        snapshot: from[from.length - taken]!,
    };
}
