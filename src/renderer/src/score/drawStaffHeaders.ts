/**
 * The staff headers pinned to the left edge once the start of the score is scrolled away: each
 * part's name, and the start of its stave with the clef and key signature in effect at the
 * left edge, so the staves read as if they began there.
 */

import { BarlineType, Renderer, Stave, StaveConnector } from 'vexflow/bravura';
import { CLEFS, Clef } from '../../../services/clef/Clef';
import { KeySignature } from '../../../services/key/KeySignature';
import { VEX_CLEFS, keySpec } from './notation';
import { NAME_FONT, ScoreLayout, textWidth } from './renderScore';

/** Room left of the names */
const PADDING = 10;
/** Between the names and the staves, leaving room for the bracket, as in the score */
const NAME_GAP = 24;
/** Past the widest clef, before the header ends */
const CLEF_PADDING = 10;
/** Past a key signature's last sharp or flat */
const KEY_PADDING = 8;

let clefRoom: number | undefined;

/** How much of a stave the widest clef takes up, so the header's width doesn't depend on the clefs */
function widestClef(): number {
    clefRoom ??= Math.max(
        ...CLEFS.map((clef) => {
            const { clef: name, annotation } = VEX_CLEFS[clef];
            return new Stave(0, 0, 100).addClef(name, 'default', annotation).getNoteStartX();
        }),
    );
    return clefRoom + CLEF_PADDING;
}

/** How much more of a stave a key signature takes up, with room after its sharps or flats */
function keyRoom(keySignature: KeySignature): number {
    if (keySignature.fifths === 0) return 0;
    const bare = new Stave(0, 0, 100);
    const keyed = new Stave(0, 0, 100).addKeySignature(keySpec(keySignature));
    return keyed.getNoteStartX() - bare.getNoteStartX() + KEY_PADDING;
}

/** Where the header's staves start, and its whole width, in score units */
export function staffHeaderSize(names: string[], keySignature: KeySignature): { staveX: number; width: number } {
    const staveX = PADDING + Math.max(0, ...names.map(textWidth)) + NAME_GAP;
    return { staveX, width: staveX + widestClef() + keyRoom(keySignature) };
}

/**
 * Draws the headers in score units, each stave at the height of the part's stave in the score.
 * Drums have no key signature, as in the score.
 */
export function drawStaffHeaders(
    container: HTMLElement,
    layout: ScoreLayout,
    parts: { name: string; clef: Clef }[],
    keySignature: KeySignature,
) {
    container.replaceChildren();
    const { staveX, width } = staffHeaderSize(parts.map(({ name }) => name), keySignature);
    const renderer = new Renderer(container as HTMLDivElement, Renderer.Backends.SVG);
    renderer.resize(width, layout.height);
    const ctx = renderer.getContext();

    const staves = parts.map(({ clef }, p) => {
        const { clef: name, annotation } = VEX_CLEFS[clef];
        const stave = new Stave(staveX, layout.parts[p]?.y ?? 0, width - staveX).addClef(name, 'default', annotation);
        if (clef !== 'percussion') stave.addKeySignature(keySpec(keySignature));
        // Open on the right, where the score carries on
        stave.setEndBarType(BarlineType.NONE);
        stave.setContext(ctx).draw();
        return stave;
    });
    if (staves.length > 1) {
        new StaveConnector(staves[0]!, staves.at(-1)!).setType('bracket').setContext(ctx).draw();
        new StaveConnector(staves[0]!, staves.at(-1)!).setType('singleLeft').setContext(ctx).draw();
    }

    ctx.save();
    ctx.setFont(NAME_FONT);
    parts.forEach(({ name }, p) => {
        const stave = layout.parts[p];
        if (stave) ctx.fillText(name, staveX - NAME_GAP - textWidth(name), (stave.top + stave.bottom) / 2 + 4);
    });
    ctx.restore();
}
