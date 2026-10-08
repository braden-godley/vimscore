import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import {
    Phantom,
    phantomAt,
    setDuration,
    shiftDrums,
    shiftPitch,
    stepDuration,
    stepDrums,
    stepScale,
    toggleDot,
    toggleArticulation,
} from './Phantom';
import { Pitch, pitch, spell } from '../pitch/Pitch';
import { SNARE, drumName, drumNotation } from '../instrument/Drums';
import { Composition } from '../composition/Composition';
import { Event } from '../event/Event';
import { Clef } from '../clef/Clef';

const at = (part: number, measure: number, leaf: number, note = 0) => ({ part, measure, voice: 0, leaf, note });
const quarterC: Phantom = { pitch: pitch('C4'), duration: { base: 4, dots: 0 } };
/** One part of quarters in 4/4, each a chord of the pitches named or a rest (null) */
function compose(fifths: number, clef: Clef, ...measures: (string[] | null)[][]): Composition {
    const event = (notes: string[] | null): Event =>
        notes ? { kind: 'chord', duration: quarterC.duration, notes: notes.map((name) => ({ pitch: pitch(name) })) } : { kind: 'rest', duration: quarterC.duration };
    return {
        title: 'Test',
        measures: measures.map((_, i) => (i === 0 ? { keySignature: { fifths } } : {})),
        parts: [{ name: 'Test', program: 0, clef, measures: measures.map((events) => ({ voices: [{ events: events.map(event) }] })) }],
        soundfonts: [],
    };
}
const toggleStaccato = (phantom: Phantom) => toggleArticulation(phantom, 'staccato');

describe('phantomAt', () => {
    it('copies the selected note and its written value', () => {
        expect(phantomAt(exampleComposition, at(0, 0, 0, 1))).toEqual({ ...quarterC, pitch: pitch('E4') });
        // Inside a quintuplet: a written sixteenth
        expect(phantomAt(exampleComposition, at(0, 1, 3))).toEqual({ ...quarterC, pitch: pitch('A4'), duration: { base: 16, dots: 0 } });
        expect(phantomAt(exampleComposition, at(1, 1, 0)).duration).toEqual({ base: 2, dots: 1 });
    });

    it('starts on the top note of the last chord before a rest, across barlines', () => {
        expect(phantomAt(exampleComposition, at(0, 2, 3))).toEqual({ ...quarterC, pitch: pitch('C5'), duration: { base: 8, dots: 0 } });
        const rested = compose(0, 'treble', [['C4', 'G4'], null], [null]);
        expect(phantomAt(rested, at(0, 0, 1)).pitch).toEqual(pitch('G4'));
        expect(phantomAt(rested, at(0, 1, 0)).pitch).toEqual(pitch('G4'));
    });

    it("starts on the key's root nearest the middle line when nothing comes before a rest", () => {
        expect(phantomAt(compose(0, 'treble', [null]), at(0, 0, 0)).pitch).toEqual(pitch('C5'));
        expect(phantomAt(compose(2, 'treble', [null], [null]), at(0, 1, 0)).pitch).toEqual(pitch('D5'));
        expect(phantomAt(compose(-2, 'treble', [null]), at(0, 0, 0)).pitch).toEqual(pitch('Bb4'));
        expect(phantomAt(compose(-1, 'bass', [null]), at(0, 0, 0)).pitch).toEqual(pitch('F3'));
        expect(phantomAt(compose(0, 'percussion', [null]), at(0, 0, 0)).pitch).toEqual(SNARE);
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

describe('stepDrums', () => {
    const drum = (name: string, steps: number) => drumName(stepDrums({ ...quarterC, pitch: pitch(name) }, steps).pitch);

    it('walks the kit up and down the stave', () => {
        // Side stick, snare and electric snare share C5, in MIDI order, then the hand clap is on D5
        expect(drum('D2', 1)).toBe('Electric Snare');
        expect(drum('D2', 2)).toBe('Hand Clap');
        expect(drum('D2', -1)).toBe('Side Stick');
        expect(drum('D2', -2)).toBe('Low Tom');
        expect(drum('C2', -1)).toBe('Acoustic Bass Drum');
        expect(drum('C2', -2)).toBe('Pedal Hi-Hat');
        expect(drum('F#2', 1)).toBe('Open Hi-Hat');
        expect(drum('Bb2', 1)).toBe('Crash Cymbal');
    });

    it('stops at the ends of the kit', () => {
        expect(drum('G#1', -3)).toBe('Pedal Hi-Hat');
        expect(drum('Bb2', 50)).toBe('Vibraslap');
    });

    it('steps from a sound outside the kit to the nearest drum above or below it', () => {
        // C#4 is written on C4, below the whole kit
        expect(drum('C#4', 1)).toBe('Pedal Hi-Hat');
        expect(drum('C#4', -1)).toBe('Pedal Hi-Hat');
        // B4 (the middle line) shares its place with the low tom
        expect(drum('B4', 1)).toBe('Side Stick');
        expect(drum('B4', -1)).toBe('High Floor Tom');
    });
});

describe('shiftDrums', () => {
    const shift = (name: string, steps: number) => shiftDrums({ ...quarterC, pitch: pitch(name) }, steps).pitch;
    const written = (sound: Pitch) => {
        const { letter, octave } = drumNotation(sound).position;
        return `${letter}${octave}`;
    };

    it('never moves the other way on the stave', () => {
        let sound = spell(0);
        const lines = [written(sound)];
        for (let i = 0; i < 127; i++) {
            sound = shiftDrums({ ...quarterC, pitch: sound }, 1).pitch;
            if (written(sound) !== lines.at(-1)) lines.push(written(sound));
        }
        // Each line or space comes up once, so it only ever went up, and it reached the top
        expect(new Set(lines).size).toBe(lines.length);
        expect(sound).toEqual(pitch('G9'));
    });

    it('takes in sounds outside the kit on the way', () => {
        // The snare's line holds the side stick, snare and electric snare, then C5 and C♯5
        expect(shift('D2', 1)).toEqual(pitch('E2'));
        expect(shift('D2', 2)).toEqual(pitch('C5'));
        expect(shift('D2', 3)).toEqual(pitch('C#5'));
        expect(drumName(shift('D2', 4))).toBe('Hand Clap');
        expect(drumName(shift('D2', -1))).toBe('Side Stick');
    });
});
