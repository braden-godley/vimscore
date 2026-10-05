/** The parts of a KeyboardEvent we look at */
export interface KeyPress {
    key: string;
    ctrlKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
    altKey: boolean;
}

const NAMED: Record<string, string> = {
    Escape: '<Esc>',
    ' ': '<Space>',
    Enter: '<CR>',
    Backspace: '<BS>',
    Tab: '<Tab>',
};

/**
 * Converts a key press to vim notation: `h`, `G`, `<C-w>`, `<C-D>`, `<Esc>`. Returns undefined for
 * presses the editor shouldn't see, like bare modifiers and Cmd shortcuts, which belong to the app.
 */
export function keyName({ key, ctrlKey, shiftKey, metaKey, altKey }: KeyPress): string | undefined {
    if (metaKey || altKey) return undefined;
    const name = NAMED[key] ?? (key.length === 1 ? key : undefined);
    if (name === undefined) return undefined;
    if (ctrlKey) {
        // Ctrl-[ is vim's other escape
        if (key === '[') return '<Esc>';
        if (key.length !== 1) return undefined;
        // Case comes from Shift rather than `key`, which Caps Lock would turn <C-d> into <C-D>
        return `<C-${shiftKey ? key.toUpperCase() : key.toLowerCase()}>`;
    }
    return name;
}
