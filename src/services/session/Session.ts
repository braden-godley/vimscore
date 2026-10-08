/**
 * An editing session: the composition, the editor's state, and the history of edits. Keys go
 * through here so that every edit keeps the score's invariants and can be undone, and the UI
 * only has to show the result.
 */

import { Composition, withTrailingEmptyMeasure } from '../composition/Composition';
import { clampCursor } from '../cursor/Cursor';
import { EditorEffect, EditorState, KeyInput, handleKey, initialEditorState } from '../editor/Editor';
import { EMPTY_HISTORY, History, Snapshot, record, redo, undo } from '../history/History';

export interface Session {
    composition: Composition;
    editor: EditorState;
    history: History;
    /**
     * Whether this stay in an insert mode, or the mixer, has recorded its undo step yet. Like
     * vim, everything entered in one go is undone together.
     */
    insertRecorded: boolean;
    /**
     * The versions before each edit made during this stay in an insert mode, most recent last,
     * so `u` there can take back one note at a time
     */
    insertSteps: Snapshot[];
    /** The keys of the last change, for `.` to make again */
    lastChange?: TypedKey[];
    /**
     * The keys typed since the editor was last waiting in normal mode, and whether they've
     * changed the score yet. Back in normal mode, they become the last change if they did.
     */
    typing?: { keys: TypedKey[]; changed: boolean };
}

/** A key as it was typed, with the character it typed for the command line and pickers */
export interface TypedKey {
    key: string;
    text?: string;
}

export function startSession(composition: Composition): Session {
    const ready = withTrailingEmptyMeasure(composition);
    return {
        composition: ready,
        editor: initialEditorState(ready),
        history: EMPTY_HISTORY,
        insertRecorded: false,
        insertSteps: [],
    };
}

const isInsert = ({ mode }: EditorState) => mode === 'insert' || mode === 'insertMelody';
/** Modes whose edits, made one after another while in them, are undone together */
const groupsEdits = (state: EditorState) => isInsert(state) || state.mode === 'mixer';

/**
 * `u` in an insert mode: takes back the last `count` notes (or rests) entered, putting the
 * cursor back where each was entered, so melody mode steps back too. With all of the stay's
 * entries gone, its undo step goes as well.
 */
function undoInsertSteps(session: Session, count: number): Session {
    const { insertSteps, history } = session;
    const taken = Math.min(count, insertSteps.length);
    if (taken === 0) return session;

    const restored = insertSteps[insertSteps.length - taken]!;
    const remaining = insertSteps.slice(0, insertSteps.length - taken);
    // The stay's undo step remembers the score from before it, which is this one again now
    const emptied = remaining.length === 0 && history.undo.at(-1)?.composition === restored.composition;
    return {
        ...session,
        composition: restored.composition,
        editor: { ...session.editor, cursor: clampCursor(restored.composition, restored.cursor) },
        history: emptied ? { ...history, undo: history.undo.slice(0, -1) } : history,
        insertRecorded: emptied ? false : session.insertRecorded,
        insertSteps: remaining,
    };
}

const isWaiting = ({ mode, pending }: EditorState) => mode === 'normal' && pending === '';

/**
 * `input` is what the key typed, and what the instrument picker offers; see `handleKey`. `.` in
 * normal mode makes the last change again, from the cursor.
 */
export function sessionKey(session: Session, key: string, input: KeyInput = {}): { session: Session; effect?: EditorEffect } {
    const { editor } = session;
    if (key === '.' && editor.mode === 'normal' && /^[0-9]*$/.test(editor.pending)) return repeatChange(session, input);

    const typing = session.typing ?? (isWaiting(editor) ? { keys: [], changed: false } : undefined);
    const result = applyKey(session, key, input);
    const changed = result.session.composition !== session.composition && !result.undone;
    const typed = typing && { keys: [...typing.keys, { key, text: input.text }], changed: typing.changed || changed };
    if (!isWaiting(result.session.editor)) return { session: { ...result.session, typing: typed }, effect: result.effect };

    const lastChange = typed?.changed ? typed.keys : session.lastChange;
    return { session: { ...result.session, typing: undefined, lastChange }, effect: result.effect };
}

/**
 * Types the last change's keys again. A count typed before `.` takes the place of the one the
 * change was typed with. However many edits the keys make, they're undone together.
 */
function repeatChange(session: Session, input: KeyInput): { session: Session; effect?: EditorEffect } {
    const count = session.editor.pending;
    const ready: Session = { ...session, editor: { ...session.editor, pending: '' } };
    if (!session.lastChange) return { session: ready };

    const uncounted = session.lastChange.slice(session.lastChange.findIndex(({ key }) => !/^[0-9]$/.test(key)));
    const keys = count ? [...[...count].map((digit) => ({ key: digit, text: digit })), ...uncounted] : session.lastChange;
    let repeated = ready;
    let effect: EditorEffect | undefined;
    for (const { key, text } of keys) {
        const result = sessionKey(repeated, key, { ...input, text });
        repeated = result.session;
        effect = result.effect ?? effect;
    }

    if (repeated.composition === session.composition) return { session: repeated, effect };
    const before = { composition: session.composition, cursor: session.editor.cursor };
    return { session: { ...repeated, history: record(session.history, before) }, effect };
}

/** One key, with the edit history kept. `undone` when it went back or forward through the history */
function applyKey(session: Session, key: string, input: KeyInput): { session: Session; effect?: EditorEffect; undone?: boolean } {
    const { composition, editor, history } = session;
    const result = handleKey(composition, editor, key, input);
    const next: Session = {
        ...session,
        editor: result.state,
        // Leaving insert mode ends the group, so the next stay gets its own undo step
        insertRecorded: session.insertRecorded && groupsEdits(result.state),
        insertSteps: isInsert(result.state) ? session.insertSteps : [],
    };

    if (result.history && isInsert(editor)) return { session: undoInsertSteps(next, result.history.count), undone: true };

    if (result.history) {
        const current = { composition, cursor: editor.cursor };
        const { direction, count } = result.history;
        const step = direction === 'undo' ? undo(history, current, count) : redo(history, current, count);
        if (!step) return { session: next };

        const { composition: restored, cursor } = step.snapshot;
        const restoredEditor = { ...next.editor, cursor: clampCursor(restored, cursor) };
        return {
            session: { ...next, composition: restored, history: step.history, editor: restoredEditor },
            undone: true,
        };
    }

    if (result.composition && result.composition !== composition) {
        // Undo goes back to the cursor from before the edit, or before a stay's first edit
        const grouped = groupsEdits(editor) && session.insertRecorded;
        const before = { composition, cursor: editor.cursor };
        const edited: Session = {
            ...next,
            composition: withTrailingEmptyMeasure(result.composition),
            history: grouped ? history : record(history, before),
            insertRecorded: groupsEdits(result.state),
            // Only what's entered in insert mode, not the deletion a visual `c` starts with
            insertSteps: isInsert(editor) ? [...next.insertSteps, before] : next.insertSteps,
        };
        return { session: edited, effect: result.effect };
    }

    return { session: next, effect: result.effect };
}

/**
 * An edit made from outside the keys, like loading a soundfont into the score: recorded for
 * undo like any other
 */
export function sessionEdit(session: Session, composition: Composition): Session {
    if (composition === session.composition) return session;
    const before = { composition: session.composition, cursor: session.editor.cursor };
    return {
        ...session,
        composition: withTrailingEmptyMeasure(composition),
        history: record(session.history, before),
        editor: { ...session.editor, cursor: clampCursor(composition, session.editor.cursor) },
    };
}
