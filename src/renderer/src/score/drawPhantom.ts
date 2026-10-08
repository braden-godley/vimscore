/**
 * Draws insert mode's phantom note on its own layer over the score, so shaping it redraws one
 * note rather than the whole score.
 */

import { Accidental, Dot, Formatter, Renderer, Stave, StaveNote, Voice } from 'vexflow/bravura';
import { KeySignature } from '../../../services/key/KeySignature';
import { Clef } from '../../../services/clef/Clef';
import { Phantom } from '../../../services/phantom/Phantom';
import { VEX_CLEFS, durationCode, keySpec, noteKey } from './notation';
import { ScoreLayout, addArticulations, addOpenMarks, placeArticulations, stemDirectionFor } from './renderScore';

export interface PhantomPlace {
    part: number;
    measure: number;
    /** Where the note it stands in for is drawn */
    x: number;
    clef: Clef;
    /** Decides which accidentals show */
    keySignature: KeySignature;
}

export function drawPhantom(container: HTMLElement, layout: ScoreLayout, phantom: Phantom, place: PhantomPlace) {
    container.replaceChildren();
    const box = layout.measures[place.measure];
    const stavePlace = layout.parts[place.part];
    if (!box || !stavePlace) return;

    const renderer = new Renderer(container as HTMLDivElement, Renderer.Backends.SVG);
    renderer.resize(layout.width, layout.height);
    const ctx = renderer.getContext();

    // Never drawn: it only gives the note its clef and line positions
    const stave = new Stave(box.x, stavePlace.y, box.width);
    const { duration, pitch } = phantom;
    const note = new StaveNote({
        keys: [noteKey(pitch, place.clef)],
        duration: durationCode(duration),
        dots: duration.dots,
        clef: VEX_CLEFS[place.clef].clef,
        octaveShift: VEX_CLEFS[place.clef].octaveShift,
        // Stemmed like a lone voice of the staff it's on
        stemDirection: stemDirectionFor(0, 1, place.clef),
        autoStem: place.clef !== 'percussion',
    });
    if (duration.dots) Dot.buildAndAttach([note], { all: true });
    addArticulations(note, [phantom]);
    addOpenMarks(note, [phantom], place.clef);
    placeArticulations(note);
    note.setStave(stave);

    const voice = new Voice().setMode(Voice.Mode.SOFT).addTickables([note]);
    if (place.clef !== 'percussion') Accidental.applyAccidentals([voice], keySpec(place.keySignature));
    new Formatter().joinVoices([voice]).format([voice], 0);

    // Line its notehead up with the note it stands in for
    const tickContext = note.getTickContext();
    tickContext.setX(tickContext.getX() + place.x - note.getAbsoluteX());
    voice.draw(ctx, stave);
}
