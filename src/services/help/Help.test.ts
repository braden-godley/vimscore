import { describe, expect, it } from 'vitest';
import { HelpView, helpKey, matchesQuery, openHelp } from './Help';
import { HELP_LINES } from './helpText';

const PAGE = 10;

/** Feeds keys one at a time; undefined once the manual closes */
function type(keys: string[], help: HelpView = openHelp('', PAGE)): HelpView | undefined {
    let view: HelpView | undefined = help;
    for (const key of keys) {
        if (!view) return undefined;
        const outcome = helpKey(view, key, PAGE, key.length === 1 ? key : undefined);
        view = 'closed' in outcome ? undefined : outcome.help;
    }
    return view;
}

const keys = (text: string) => text.split('');

describe('scrolling the manual', () => {
    it('moves a line with j and k, with a count, and not past the top', () => {
        expect(type(['j', 'j'])?.top).toBe(2);
        expect(type(['5', 'j', 'k'])?.top).toBe(4);
        expect(type(['k'])?.top).toBe(0);
    });

    it('moves half a page with <C-d> and <C-u>', () => {
        expect(type(['<C-d>'])?.top).toBe(5);
        expect(type(['<C-d>', '<C-d>', '<C-u>'])?.top).toBe(5);
    });

    it('goes to the ends with G and gg, stopping with the last page in view', () => {
        const bottom = HELP_LINES.length - PAGE;
        expect(type(['G'])?.top).toBe(bottom);
        expect(type(['G', 'j'])?.top).toBe(bottom);
        expect(type(['G', 'g', 'g'])?.top).toBe(0);
    });

    it('closes with q or <Esc>', () => {
        expect(type(['q'])).toBeUndefined();
        expect(type(['<Esc>'])).toBeUndefined();
    });
});

describe('searching the manual', () => {
    const lineOf = (help: HelpView | undefined) => help?.match;

    it('goes to the first match after /text<CR>, keeping a little above it', () => {
        const found = type(['/', ...keys('staccato'), '<CR>']);
        const first = HELP_LINES.findIndex((line) => line.toLowerCase().includes('staccato'));
        expect(lineOf(found)).toBe(first);
        expect(found?.top).toBe(Math.max(0, first - 2));
        expect(found?.typing).toBeUndefined();
    });

    it('steps through matches with n and N, wrapping around', () => {
        const found = type(['/', ...keys('staccato'), '<CR>'])!;
        const matches = HELP_LINES.flatMap((line, i) => (line.toLowerCase().includes('staccato') ? [i] : []));
        expect(lineOf(type(['n'], found))).toBe(matches[1]);
        expect(lineOf(type(['n', 'N'], found))).toBe(matches[0]);
        expect(lineOf(type(['N'], found))).toBe(matches.at(-1));
    });

    it('matches either case in lowercase, exactly with a capital', () => {
        expect(matchesQuery('Make it STACCATO', 'staccato')).toBe(true);
        expect(matchesQuery('make it staccato', 'Staccato')).toBe(false);
    });

    it("says when there's no match, and cancels typing with <Esc>", () => {
        expect(type(['/', ...keys('zzzz'), '<CR>'])?.error).toBe('Pattern not found: zzzz');
        const cancelled = type(['/', 'a', '<Esc>']);
        expect(cancelled?.typing).toBeUndefined();
        expect(cancelled?.query).toBeUndefined();
    });

    it('opens at a topic', () => {
        const help = openHelp('mixer', PAGE);
        expect(HELP_LINES[help.match!]!.toLowerCase()).toContain('mixer');
    });
});
