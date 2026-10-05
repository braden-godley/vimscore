import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import { Composition } from '../composition/Composition';
import { cursorPitch } from '../cursor/Cursor';
import { leaves } from '../event/Event';
import { transposeSelection } from './Edit';

/** Every pitch in a part's measure, chord by chord, with null for rests */
function pitches(composition: Composition, part: number, measure: number) {
    const events = composition.parts[part]!.measures[measure]!.voices[0]!.events;
    return [...leaves(events)].map(({ event }) => (event.kind === 'chord' ? event.notes.map((n) => n.pitch) : null));
}

const at = (part: number, measure: number, leaf: number) => ({ part, measure, voice: 0, leaf, note: 0 });

describe('transposeSelection', () => {
    it('moves every note of whole measures, in every part', () => {
        const moved = transposeSelection(exampleComposition, { kind: 'measures', first: 2, last: 2 }, -1);
        expect(pitches(moved, 0, 2)).toEqual([[71], [71], [71], null]);
        expect(pitches(moved, 1, 2)).toEqual([[47]]);
        expect(moved.parts[0]!.measures[0]).toBe(exampleComposition.parts[0]!.measures[0]);
        // Ties and staccato come along
        expect(moved.parts[0]!.measures[2]!.voices[0]!.events[0]).toMatchObject({ notes: [{ pitch: 71, tie: true }] });
    });

    it('moves only what a block covers, inside tuplets too', () => {
        const start = { measure: 1, offset: { num: 1, den: 12 } };
        const end = { measure: 1, offset: { num: 1, den: 6 } };
        const moved = transposeSelection(exampleComposition, { kind: 'block', firstPart: 0, lastPart: 1, start, end }, 2);
        expect(cursorPitch(moved, at(0, 1, 0))).toBe(76);
        expect(cursorPitch(moved, at(0, 1, 1))).toBe(76);
        expect(cursorPitch(moved, at(0, 1, 2))).toBe(72);
        expect(cursorPitch(moved, at(1, 1, 0))).toBe(43);
    });

    it('leaves everything alone if a note would leave the MIDI range', () => {
        const selection = { kind: 'measures', first: 0, last: 2 } as const;
        expect(transposeSelection(exampleComposition, selection, 60)).toBe(exampleComposition);
    });
});
