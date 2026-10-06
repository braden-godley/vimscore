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
    toggleArticulation,
} from './Phantom';
import { pitch } from '../pitch/Pitch';

const at = (part: number, measure: number, leaf: number, note = 0) => ({ part, measure, voice: 0, leaf, note });
const quarterC: Phantom = { pitch: pitch('C4'), duration: { base: 4, dots: 0 } };
const toggleStaccato = (phantom: Phantom) => toggleArticulation(phantom, 'staccato');

describe('phantomAt', () => {
    it('copies the selected note and its written value', () => {
        expect(phantomAt(exampleComposition, at(0, 0, 0, 1))).toEqual({ ...quarterC, pitch: pitch('E4') });
        // Inside a quintuplet: a written sixteenth
        expect(phantomAt(exampleComposition, at(0, 1, 3))).toEqual({ ...quarterC, pitch: pitch('A4'), duration: { base: 16, dots: 0 } });
        expect(phantomAt(exampleComposition, at(1, 1, 0)).duration).toEqual({ base: 2, dots: 1 });
    });

    it('starts on the middle line of the stave from a rest', () => {
        expect(phantomAt(exampleComposition, at(0, 2, 3))).toEqual({ ...quarterC, pitch: pitch('B4'), duration: { base: 8, dots: 0 } });
    });
});

describe('adjusting', () => {
    it('moves by half steps within MIDI range', () => {
        expect(shiftPitch(quarterC, -1).pitch).toEqual(pitch('B3'));
        expect(shiftPitch({ ...quarterC, pitch: pitch('G9') }, 1).pitch).toEqual(pitch('G9'));
        expect(shiftPitch({ ...quarterC, pitch: pitch('F9') }, 5).pitch).toEqual(pitch('G9'));
    });

    it('spells a black key sharp going up and flat going down', () => {
        expect(shiftPitch(quarterC, 1).pitch).toEqual(pitch('C#4'));
        expect(shiftPitch(quarterC, -2).pitch).toEqual(pitch('Bb3'));
        expect(shiftPitch(shiftPitch(quarterC, 1), 1).pitch).toEqual(pitch('D4'));
        expect(shiftPitch(quarterC, 12).pitch).toEqual(pitch('C5'));
    });

    it('steps through the scale of the key', () => {
        expect(stepScale(quarterC, { fifths: 0 }, 1).pitch).toEqual(pitch('D4'));
        expect(stepScale(quarterC, { fifths: 0 }, -1).pitch).toEqual(pitch('B3'));
        // In G major the F is sharp, and in F major the B flat
        expect(stepScale({ ...quarterC, pitch: pitch('E4') }, { fifths: 1 }, 1).pitch).toEqual(pitch('F#4'));
        expect(stepScale(quarterC, { fifths: -1 }, -1).pitch).toEqual(pitch('Bb3'));
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

    it('sets a value with no accent or tenuto either', () => {
        const marked = toggleArticulation(toggleArticulation(quarterC, 'accent'), 'tenuto');
        expect(setDuration(marked, 8)).toEqual({ ...quarterC, duration: { base: 8, dots: 0 } });
    });

    it('swaps an accent for a marcato and back, keeping the others', () => {
        const accented = toggleArticulation(toggleStaccato(quarterC), 'accent');
        const marcato = toggleArticulation(accented, 'marcato');
        expect(marcato).toEqual({ ...quarterC, staccato: true, marcato: true });
        expect(toggleArticulation(marcato, 'accent')).toEqual({ ...quarterC, staccato: true, accent: true });
        expect(toggleArticulation(marcato, 'marcato')).toEqual({ ...quarterC, staccato: true });
    });
});
