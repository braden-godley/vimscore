import { describe, expect, it } from 'vitest';
import { C_MAJOR } from '../key/KeySignature';
import { comparePitch, fromTpc, keyAlter, midi, parsePitch, pitch, pitchName, scaleStep, spell, transpose } from './Pitch';

const G_MAJOR = { fifths: 1 };
const F_MAJOR = { fifths: -1 };
const E_FLAT_MAJOR = { fifths: -3 };
const C_SHARP_MAJOR = { fifths: 7 };
const C_FLAT_MAJOR = { fifths: -7 };

describe('midi', () => {
    it('sounds enharmonic spellings the same', () => {
        expect(midi(pitch('C4'))).toBe(60);
        expect(midi(pitch('A#4'))).toBe(70);
        expect(midi(pitch('Bb4'))).toBe(70);
        expect(midi(pitch('B#3'))).toBe(60);
        expect(midi(pitch('Cb4'))).toBe(59);
        expect(midi(pitch('Ebb4'))).toBe(62);
    });
});

describe('names', () => {
    it('round-trip', () => {
        for (const name of ['C4', 'F#3', 'Bb5', 'Ebb2', 'G##1', 'A0', 'C-1']) expect(pitchName(pitch(name))).toBe(name);
    });

    it('refuse what is not a pitch, or is past MIDI range', () => {
        expect(parsePitch('H4')).toBeUndefined();
        expect(parsePitch('C#b4')).toBeUndefined();
        expect(parsePitch('60')).toBeUndefined();
        expect(parsePitch('G#9')).toBeUndefined();
        expect(parsePitch('Cb-1')).toBeUndefined();
    });
});

describe('keyAlter', () => {
    it('follows the order sharps and flats are added', () => {
        expect(keyAlter('F', G_MAJOR)).toBe(1);
        expect(keyAlter('C', G_MAJOR)).toBe(0);
        expect(keyAlter('B', F_MAJOR)).toBe(-1);
        expect(keyAlter('E', F_MAJOR)).toBe(0);
        expect(['E', 'A', 'B'].map((letter) => keyAlter(letter as 'E', E_FLAT_MAJOR))).toEqual([-1, -1, -1]);
    });
});

describe('spell', () => {
    it('uses the key’s own notes', () => {
        expect(spell(66, G_MAJOR)).toEqual(pitch('F#4'));
        expect(spell(70, F_MAJOR)).toEqual(pitch('Bb4'));
        expect(spell(60, C_SHARP_MAJOR)).toEqual(pitch('B#3'));
        expect(spell(59, C_FLAT_MAJOR)).toEqual(pitch('Cb4'));
    });

    it('spells other black keys sharp, or flat in flat keys', () => {
        expect(spell(61)).toEqual(pitch('C#4'));
        expect(spell(61, E_FLAT_MAJOR)).toEqual(pitch('Db4'));
        expect(spell(61, C_MAJOR, true)).toEqual(pitch('Db4'));
    });
});

describe('transpose', () => {
    it('spells black keys sharp going up and flat going down', () => {
        expect(transpose(pitch('A4'), 1)).toEqual(pitch('A#4'));
        expect(transpose(pitch('B4'), -1)).toEqual(pitch('Bb4'));
        expect(transpose(pitch('G4'), -3)).toEqual(pitch('E4'));
        expect(transpose(pitch('G4'), 4)).toEqual(pitch('B4'));
    });

    it('lands on naturals where it can', () => {
        expect(transpose(pitch('Bb4'), 1)).toEqual(pitch('B4'));
        expect(transpose(pitch('C#4'), -1)).toEqual(pitch('C4'));
        expect(transpose(pitch('E4'), 1)).toEqual(pitch('F4'));
    });

    it('keeps the spelling by octaves', () => {
        expect(transpose(pitch('Bb4'), 12)).toEqual(pitch('Bb5'));
        expect(transpose(pitch('A#4'), -24)).toEqual(pitch('A#2'));
        expect(transpose(pitch('C4'), 0)).toEqual(pitch('C4'));
    });

    it('stops at the ends of MIDI range', () => {
        expect(transpose(pitch('G9'), 1)).toBeUndefined();
        expect(transpose(pitch('C-1'), -1)).toBeUndefined();
    });
});

describe('scaleStep', () => {
    it('moves by letter through the key', () => {
        expect(scaleStep(pitch('C4'), C_MAJOR, 1)).toEqual(pitch('D4'));
        expect(scaleStep(pitch('E4'), C_MAJOR, 1)).toEqual(pitch('F4'));
        expect(scaleStep(pitch('C4'), C_MAJOR, -1)).toEqual(pitch('B3'));
        expect(scaleStep(pitch('E4'), G_MAJOR, 1)).toEqual(pitch('F#4'));
        expect(scaleStep(pitch('C5'), F_MAJOR, -1)).toEqual(pitch('Bb4'));
        expect(scaleStep(pitch('C4'), C_MAJOR, 7)).toEqual(pitch('C5'));
    });

    it('lands on the key’s own note from outside the key', () => {
        expect(scaleStep(pitch('C#4'), C_MAJOR, 1)).toEqual(pitch('D4'));
        expect(scaleStep(pitch('C#4'), C_MAJOR, -1)).toEqual(pitch('C4'));
        expect(scaleStep(pitch('Db4'), C_MAJOR, 1)).toEqual(pitch('D4'));
        expect(scaleStep(pitch('Db4'), C_MAJOR, -1)).toEqual(pitch('C4'));
        // C follows B♯ without moving, so it goes on to D
        expect(scaleStep(pitch('B#3'), C_MAJOR, 1)).toEqual(pitch('D4'));
    });

    it('stops at the ends of MIDI range', () => {
        expect(scaleStep(pitch('G9'), C_MAJOR, 1)).toEqual(pitch('G9'));
        expect(scaleStep(pitch('C-1'), C_MAJOR, -1)).toEqual(pitch('C-1'));
    });
});

describe('comparePitch', () => {
    it('sorts by sound, then by letter', () => {
        const sorted = ['C5', 'Bb4', 'A#4', 'C4'].map(pitch).sort(comparePitch).map(pitchName);
        expect(sorted).toEqual(['C4', 'A#4', 'Bb4', 'C5']);
    });
});

describe('fromTpc', () => {
    it('reads MuseScore’s spelling on the line of fifths', () => {
        expect(fromTpc(14, 60)).toEqual(pitch('C4'));
        expect(fromTpc(12, 70)).toEqual(pitch('Bb4'));
        expect(fromTpc(24, 70)).toEqual(pitch('A#4'));
        expect(fromTpc(26, 60)).toEqual(pitch('B#3'));
        expect(fromTpc(7, 59)).toEqual(pitch('Cb4'));
        expect(fromTpc(4, 62)).toEqual(pitch('Ebb4'));
    });

    it('refuses a spelling that doesn’t match the pitch', () => {
        expect(fromTpc(14, 61)).toBeUndefined();
    });
});
