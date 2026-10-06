/**
 * Reading the manual, like a pager: j/k scroll a line, <C-d>/<C-u> half a page, gg/G to the
 * ends, `/` searches and n/N step through the matches. How many lines fit on a page is up to
 * the window, so it comes in with each key.
 */

import { HELP_LINES } from './helpText';

export interface HelpView {
    /** The first line in view */
    top: number;
    /** The last search, for highlighting and n/N */
    query?: string;
    /** The line of the match last gone to, which n and N search on from */
    match?: number;
    /** What's typed after `/`, while it's being typed */
    typing?: string;
    /** Why the last search went nowhere */
    error?: string;
    /** A count or the first g of gg, still being typed */
    pending: string;
}

export type HelpOutcome = { help: HelpView } | { closed: true };

/** Lines kept above a match, so it doesn't sit right against the top */
const CONTEXT_LINES = 2;

const LINE_STEPS: Record<string, number> = { j: 1, '<Down>': 1, '<C-e>': 1, k: -1, '<Up>': -1, '<C-y>': -1 };

/** Like vim's smartcase: lowercase matches either case, a capital anywhere matches exactly */
export function matchesQuery(line: string, query: string): boolean {
    return query === query.toLowerCase() ? line.toLowerCase().includes(query) : line.includes(query);
}

const maxTop = (pageLines: number) => Math.max(0, HELP_LINES.length - pageLines);
const clampTop = (top: number, pageLines: number) => Math.max(0, Math.min(maxTop(pageLines), top));

/** The next line matching after `from` (or before it, going back), wrapping around the ends */
function findMatch(query: string, from: number, direction: 1 | -1): number | undefined {
    const count = HELP_LINES.length;
    for (let step = 1; step <= count; step++) {
        const line = (((from + direction * step) % count) + count) % count;
        if (matchesQuery(HELP_LINES[line]!, query)) return line;
    }
    return undefined;
}

/** Goes to the next match in a direction, or says there isn't one */
function search(help: HelpView, query: string, from: number, direction: 1 | -1, pageLines: number): HelpView {
    const match = findMatch(query, from, direction);
    if (match === undefined) return { ...help, query, match: undefined, error: `Pattern not found: ${query}` };
    return { ...help, query, match, error: undefined, top: clampTop(match - CONTEXT_LINES, pageLines) };
}

/** The manual, open at the top, or at the first match for a topic */
export function openHelp(topic: string, pageLines: number): HelpView {
    const help: HelpView = { top: 0, pending: '' };
    return topic ? search(help, topic, -1, 1, pageLines) : help;
}

function typingKey(help: HelpView, typing: string, key: string, text: string | undefined, pageLines: number): HelpView {
    if (key === '<Esc>') return { ...help, typing: undefined };
    if (key === '<CR>') {
        const done = { ...help, typing: undefined };
        // An empty search repeats the last one, like vim
        const query = typing || help.query;
        return query ? search(done, query, help.match ?? help.top - 1, 1, pageLines) : done;
    }
    if (key === '<BS>') return typing === '' ? { ...help, typing: undefined } : { ...help, typing: typing.slice(0, -1) };
    const typed = key === '<Space>' ? ' ' : (text ?? (key.length === 1 ? key : undefined));
    return typed === undefined ? help : { ...help, typing: typing + typed };
}

export function helpKey(help: HelpView, key: string, pageLines: number, text?: string): HelpOutcome {
    if (help.typing !== undefined) return { help: typingKey(help, help.typing, key, text, pageLines) };

    const typed = help.pending + key;
    const [, digits, command = ''] = /^([1-9][0-9]*)?(.*)$/.exec(typed)!;
    const count = digits === undefined ? 1 : Number(digits);
    const ready: HelpView = { ...help, pending: '', error: undefined };
    const scroll = (lines: number) => ({ help: { ...ready, top: clampTop(help.top + lines, pageLines) } });
    const half = Math.max(1, Math.floor(pageLines / 2));
    const page = Math.max(1, pageLines - CONTEXT_LINES);

    if (command === 'q' || command === '<Esc>') return { closed: true };
    if (Object.hasOwn(LINE_STEPS, command)) return scroll(LINE_STEPS[command]! * count);
    if (command === '<C-d>') return scroll(half * count);
    if (command === '<C-u>') return scroll(-half * count);
    if (command === '<C-f>' || command === '<Space>') return scroll(page * count);
    if (command === '<C-b>') return scroll(-page * count);
    if (command === 'gg') return { help: { ...ready, top: digits === undefined ? 0 : clampTop(count - 1, pageLines) } };
    if (command === 'G') return { help: { ...ready, top: digits === undefined ? maxTop(pageLines) : clampTop(count - 1, pageLines) } };
    if (command === '/') return { help: { ...ready, typing: '' } };
    if ((command === 'n' || command === 'N') && help.query) {
        // From the last match while it's in view; otherwise from wherever the page is now
        const inView = help.match !== undefined && help.match >= help.top && help.match < help.top + pageLines;
        const direction = command === 'n' ? 1 : -1;
        const from = inView ? help.match! : direction === 1 ? help.top - 1 : help.top + pageLines;
        return { help: search(ready, help.query, from, direction, pageLines) };
    }
    // Still typing a count or gg
    if (command === '' || command === 'g') return { help: { ...help, pending: typed } };
    return { help: ready };
}
