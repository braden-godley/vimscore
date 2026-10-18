import { describe, expect, it } from 'vitest';
import { Composition } from '../composition/Composition';
import { exampleComposition } from '../composition/example-composition';
import { fraction } from '../fraction/Fraction';
import { spell } from '../pitch/Pitch';
import { removeMeasures } from './RemoveMeasures';
import { written } from './written';

const whole = { base: 1, dots: 0 } as const;

// One part in 4/4: a C tied and slurred on, with a crescendo from halfway running a whole note |
// a C in bass clef, f, in D, with repeat barlines | a D
const tiedInto: Composition = {
    title: 'Test',
    measures: [{}, { keySignature: { fifths: 2 }, repeatStart: true, repeatEnd: true }, {}],
    parts: [
        {
            name: 'A',
            program: 0,
            measures: [
                {
                    voices: [{ events: [{ kind: 'chord', duration: whole, slur: true, notes: [{ pitch: spell(60), tie: true, glissando: true }] }] }],
                    hairpins: [{ offset: fraction(1, 2), length: fraction(1), kind: 'crescendo' }],
                },
                {
                    voices: [{ events: [{ kind: 'chord', duration: whole, notes: [{ pitch: spell(60) }] }] }],
                    clef: 'bass',
                    dynamics: [{ offset: fraction(0), dynamic: 'f' }],
                },
                { voices: [{ events: [{ kind: 'chord', duration: whole, notes: [{ pitch: spell(62) }] }] }] },
            ],
        },
    ],
    soundfonts: [],
};

describe('removeMeasures', () => {
    it('takes the measures out of every part', () => {
        const removed = removeMeasures(exampleComposition, 1, 1)!;
        expect(removed.measures).toHaveLength(2);
        expect(removed.measures[1]).toEqual(exampleComposition.measures[2]);
        for (const [p, part] of removed.parts.entries()) {
            expect(part.measures).toEqual([0, 2].map((m) => exampleComposition.parts[p]!.measures[m]));
        }
    });

    it('carries changes made in the removed measures on to the measure after them', () => {
        // The 3/4 measure no longer follows a 4/4 one, so it has nothing new to say about the tempo
        expect(removeMeasures(exampleComposition, 0, 0)!.measures[0]).toEqual({ timeSignature: { beats: 3, beatValue: 4 } });

        const removed = removeMeasures(tiedInto, 1, 1)!;
        expect(removed.measures).toEqual([{}, { keySignature: { fifths: 2 } }]);
        expect(removed.parts[0]!.measures[1]).toMatchObject({ clef: 'bass', dynamics: [{ offset: fraction(0), dynamic: 'f' }] });
    });

    it('takes off ties, slurs and glissandi into the removed measures, and cuts hairpins short', () => {
        const removed = removeMeasures(tiedInto, 1, 1)!;
        expect(written(removed, 0, 0)).toBe('60/w');
        expect(removed.parts[0]!.measures[0]!.hairpins).toEqual([{ offset: fraction(1, 2), length: fraction(1, 2), kind: 'crescendo' }]);
    });

    it('stops at the end of the score, and does nothing past it', () => {
        expect(removeMeasures(exampleComposition, 1, 9)!.measures).toHaveLength(1);
        expect(removeMeasures(exampleComposition, 3, 3)).toBeUndefined();
    });
});
