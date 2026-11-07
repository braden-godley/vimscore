import { describe, expect, it } from 'vitest';
import { Composition } from '../composition/Composition';
import { exampleComposition } from '../composition/example-composition';
import { fraction } from '../fraction/Fraction';
import { resolveMeasures } from '../measure/Measure';
import { spell } from '../pitch/Pitch';
import { addMeasures } from './AddMeasures';
import { written } from './written';

const whole = { base: 1, dots: 0 } as const;

// One part in 4/4: a C tied and slurred on, with a crescendo from halfway running a whole note |
// a C in bass clef, f, in D, with a repeat start
const tiedInto: Composition = {
    title: 'Test',
    measures: [{}, { keySignature: { fifths: 2 }, repeatStart: true }],
    parts: [
        {
            name: 'A',
            program: 0,
            clef: 'treble',
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
            ],
        },
    ],
    soundfonts: [],
};

describe('addMeasures', () => {
    it('puts measures of rests before the measure, in every part, moving the music after on', () => {
        const added = addMeasures(exampleComposition, 1, 2)!;
        expect(added.measures).toHaveLength(5);
        for (const [p, part] of added.parts.entries()) {
            const old = exampleComposition.parts[p]!.measures;
            expect(part.measures[0]).toEqual(old[0]);
            expect(part.measures.slice(3)).toEqual(old.slice(1));
            expect([1, 2].map((m) => written(added, p, m))).toEqual(['r/w', 'r/w']);
        }
    });

    it('writes them in the time signature before, and the measure after keeps its own changes', () => {
        const added = addMeasures(exampleComposition, 2, 1)!;
        // After the 3/4 measure and before the 6/8 one
        expect(written(added, 0, 2)).toBe('r/h.');
        expect(added.measures[2]).toEqual({});
        expect(added.measures[3]).toEqual(exampleComposition.measures[2]);
        expect(resolveMeasures(added.measures).map(({ timeSignature }) => timeSignature.beats)).toEqual([4, 3, 3, 6]);
    });

    it('keeps the clef, key and dynamic changes, and the repeat, with the music', () => {
        const added = addMeasures(tiedInto, 1, 1)!;
        expect(added.measures).toEqual([{}, {}, { keySignature: { fifths: 2 }, repeatStart: true }]);
        expect(added.parts[0]!.measures[1]).not.toHaveProperty('clef');
        expect(added.parts[0]!.measures[2]).toMatchObject({ clef: 'bass', dynamics: [{ offset: fraction(0), dynamic: 'f' }] });
    });

    it('takes off ties, slurs and glissandi into the new measures, and cuts hairpins short', () => {
        const added = addMeasures(tiedInto, 1, 1)!;
        expect(written(added, 0, 0)).toBe('60/w');
        expect(added.parts[0]!.measures[0]!.hairpins).toEqual([{ offset: fraction(1, 2), length: fraction(1, 2), kind: 'crescendo' }]);
    });

    it('moves the opening time signature, tempo and clef to new measures at the start', () => {
        const added = addMeasures(exampleComposition, 0, 1)!;
        expect(added.measures.slice(0, 2)).toEqual([exampleComposition.measures[0], {}]);
        expect(written(added, 0, 0)).toBe('r/w');

        const bass = { ...tiedInto, parts: [{ ...tiedInto.parts[0]!, measures: [tiedInto.parts[0]!.measures[1]!] }], measures: [{}] };
        const before = addMeasures(bass, 0, 1)!;
        expect(before.parts[0]!.clef).toBe('bass');
        expect(before.parts[0]!.measures.map((measure) => measure.clef)).toEqual([undefined, undefined]);
    });

    it('does nothing outside the score', () => {
        expect(addMeasures(exampleComposition, 3, 1)).toBeUndefined();
        expect(addMeasures(exampleComposition, -1, 1)).toBeUndefined();
    });
});
