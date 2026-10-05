/**
 * An editing session: the composition, the editor's state, and the history of edits. Keys go
 * through here so that every edit keeps the score's invariants and can be undone, and the UI
 * only has to show the result.
 */

import { Composition, withTrailingEmptyMeasure } from '../composition/Composition';
import { clampCursor } from '../cursor/Cursor';
import { EditorEffect, EditorState, handleKey, initialEditorState } from '../editor/Editor';
import { EMPTY_HISTORY, History, record, redo, undo } from '../history/History';

export interface Session {
    composition: Composition;
    editor: EditorState;
    history: History;
    /**
     * Whether this stay in an insert mode has recorded its undo step yet. Like vim, everything
     * entered in one go is undone together.
     */
    insertRecorded: boolean;
}

export function startSession(composition: Composition): Session {
    const ready = withTrailingEmptyMeasure(composition);
    return { composition: ready, editor: initialEditorState(ready), history: EMPTY_HISTORY, insertRecorded: false };
}

const isInsert = ({ mode }: EditorState) => mode === 'insert' || mode === 'insertMelody';

/** `text` is what the key typed, for prompts; see `handleKey` */
export function sessionKey(session: Session, key: string, text?: string): { session: Session; effect?: EditorEffect } {
    const { composition, editor, history } = session;
    const result = handleKey(composition, editor, key, text);
    const next: Session = {
        ...session,
        editor: result.state,
        // Leaving insert mode ends the group, so the next stay gets its own undo step
        insertRecorded: session.insertRecorded && isInsert(result.state),
    };

    if (result.history) {
        const current = { composition, cursor: editor.cursor };
        const { direction, count } = result.history;
        const step = direction === 'undo' ? undo(history, current, count) : redo(history, current, count);
        if (!step) return { session: next };

        const { composition: restored, cursor } = step.snapshot;
        const restoredEditor = { ...next.editor, cursor: clampCursor(restored, cursor) };
        return { session: { ...next, composition: restored, history: step.history, editor: restoredEditor } };
    }

    if (result.composition && result.composition !== composition) {
        // Undo goes back to the cursor from before the edit, or before a stay's first edit
        const grouped = isInsert(editor) && session.insertRecorded;
        const edited: Session = {
            ...next,
            composition: withTrailingEmptyMeasure(result.composition),
            history: grouped ? history : record(history, { composition, cursor: editor.cursor }),
            insertRecorded: isInsert(result.state),
        };
        return { session: edited, effect: result.effect };
    }

    return { session: next, effect: result.effect };
}
