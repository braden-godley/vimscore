import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import { fraction } from '../fraction/Fraction';
import { withVoice, withoutRestVoices } from './Voices';

const durations = (events: { kind: string }[]) => events.map((event) => ('duration' in event ? event.duration : event));

describe('withVoice', () => {
    it('fills a new voice with rests, one starting at the beat', () => {
        const { composition, added } = withVoice(exampleComposition, { part: 0, measure: 0, voice: 2 }, fraction(3, 4));
        expect(added).toEqual([1, 2]);
        const voices = composition.parts[0]!.measures[0]!.voices;
        // A voice skipped on the way gets rests too, from the start of the measure
        expect(durations(voices[1]!.events)).toEqual([{ base: 1, dots: 0 }]);
        expect(durations(voices[2]!.events)).toEqual([
            { base: 2, dots: 0 },
            { base: 4, dots: 0 },
            { base: 4, dots: 0 },
        ]);
    });

    it('fills the measure from its start when the beat is inside a tuplet', () => {
        // 3/4, starting with a triplet of eighths
        const { composition } = withVoice(exampleComposition, { part: 0, measure: 1, voice: 1 }, fraction(1, 12));
        expect(durations(composition.parts[0]!.measures[1]!.voices[1]!.events)).toEqual([
            { base: 2, dots: 0 },
            { base: 4, dots: 0 },
        ]);
    });

    it('leaves a voice that has something in it', () => {
        expect(withVoice(exampleComposition, { part: 0, measure: 0, voice: 0 }, fraction(0)).composition).toBe(exampleComposition);
        expect(withVoice(exampleComposition, { part: 0, measure: 0, voice: 4 }, fraction(0)).composition).toBe(exampleComposition);
    });
});

describe('withoutRestVoices', () => {
    const made = withVoice(exampleComposition, { part: 0, measure: 0, voice: 2 }, fraction(0)).composition;

    it('takes off trailing voices of rests past the one to keep', () => {
        expect(withoutRestVoices(made, 0, 0, 1, () => true).parts[0]!.measures[0]!.voices).toHaveLength(2);
        expect(withoutRestVoices(made, 0, 0, 0, () => true).parts[0]!.measures[0]).toEqual(exampleComposition.parts[0]!.measures[0]);
    });

    it('only takes off the voices it may', () => {
        expect(withoutRestVoices(made, 0, 0, 0, (voice) => voice === 1)).toBe(made);
    });
});
