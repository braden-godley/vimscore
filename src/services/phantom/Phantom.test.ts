import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import {
    Phantom,
    phantomAt,
    setDuration,
    shiftPitch,
    stepDuration,
    stepScale,
    toggleDot,
    toggleStaccato,
} from './Phantom';

const at = (part: number, measure: number, leaf: number, note = 0) => ({ part, measure, voice: 0, leaf, note });
const quarterC: Phantom = { pitch: 60, duration: { base: 4, dots: 0 }, staccato: false };

describe('phantomAt', () => {
    it('copies the selected note and its written value', () => {
        expect(phantomAt(exampleComposition, at(0, 0, 0, 1))).toEqual({ ...quarterC, pitch: 64 });
        // Inside a quintuplet: a written sixteenth
        expect(phantomAt(exampleComposition, at(0, 1, 3))).toEqual({ ...quarterC, pitch: 69, duration: { base: 16, dots: 0 } });
        expect(phantomAt(exampleComposition, at(1, 1, 0)).duration).toEqual({ base: 2, dots: 1 });
    });

    it('starts on the middle line of the stave from a rest', () => {
        expect(phantomAt(exampleComposition, at(0, 2, 3))).toEqual({ ...quarterC, pitch: 71, duration: { base: 8, dots: 0 } });
    });
});

describe('adjusting', () => {
    it('moves by half steps within MIDI range', () => {
        expect(shiftPitch(quarterC, -1).pitch).toBe(59);
        expect(shiftPitch({ ...quarterC, pitch: 127 }, 1).pitch).toBe(127);
    });

    it('steps through the scale of the key', () => {
        expect(stepScale(quarterC, { fifths: 0 }, 1).pitch).toBe(62);
        expect(stepScale(quarterC, { fifths: 0 }, -1).pitch).toBe(59);
        // In G major the F is sharp
        expect(stepScale({ ...quarterC, pitch: 64 }, { fifths: 1 }, 1).pitch).toBe(66);
    });

    it('lengthens and shortens through note values, dropping the dot and staccato', () => {
        expect(stepDuration(quarterC, 1).duration).toEqual({ base: 2, dots: 0 });
        expect(stepDuration(toggleStaccato(toggleDot(quarterC)), -1)).toEqual({ ...quarterC, duration: { base: 8, dots: 0 } });
        expect(stepDuration(stepDuration(quarterC, 2), 1).duration.base).toBe(1);
        expect(stepDuration({ ...quarterC, duration: { base: 64, dots: 0 } }, -1).duration.base).toBe(64);
    });

    it('sets a value outright, plain', () => {
        expect(setDuration(toggleStaccato(toggleDot(quarterC)), 2)).toEqual({ ...quarterC, duration: { base: 2, dots: 0 } });
        // Even the same value: it's a quick way to clear the dot and staccato
        expect(setDuration(toggleDot(quarterC), 4)).toEqual(quarterC);
    });

    it('toggles the dot and staccato', () => {
        expect(toggleDot(toggleDot(quarterC))).toEqual(quarterC);
        expect(toggleStaccato(quarterC).staccato).toBe(true);
        expect(toggleStaccato(toggleStaccato(quarterC))).toEqual(quarterC);
    });
});
