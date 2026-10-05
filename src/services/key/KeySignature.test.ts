import { describe, expect, it } from 'vitest';
import { C_MAJOR, inScale, scaleStep } from './KeySignature';

const G_MAJOR = { fifths: 1 };
const E_FLAT_MAJOR = { fifths: -3 };

describe('inScale', () => {
    it('follows the sharps and flats', () => {
        expect([60, 62, 64, 65, 67, 69, 71].every((pitch) => inScale(pitch, C_MAJOR))).toBe(true);
        expect(inScale(66, C_MAJOR)).toBe(false);
        expect(inScale(66, G_MAJOR)).toBe(true);
        expect(inScale(65, G_MAJOR)).toBe(false);
        expect([63, 68, 70].every((pitch) => inScale(pitch, E_FLAT_MAJOR))).toBe(true);
    });
});

describe('scaleStep', () => {
    it('moves by whole or half steps, as the scale goes', () => {
        expect(scaleStep(60, C_MAJOR, 1)).toBe(62);
        expect(scaleStep(64, C_MAJOR, 1)).toBe(65);
        expect(scaleStep(60, C_MAJOR, -1)).toBe(59);
        expect(scaleStep(65, G_MAJOR, 1)).toBe(66);
        expect(scaleStep(60, C_MAJOR, 7)).toBe(72);
    });

    it('lands on the nearest scale note from outside the scale', () => {
        expect(scaleStep(61, C_MAJOR, 1)).toBe(62);
        expect(scaleStep(61, C_MAJOR, -1)).toBe(60);
    });

    it('stops at the ends of MIDI range', () => {
        expect(scaleStep(127, C_MAJOR, 1)).toBe(127);
        expect(scaleStep(0, C_MAJOR, -1)).toBe(0);
    });
});
