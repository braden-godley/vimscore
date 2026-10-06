import { BasicMIDI } from 'spessasynth_core';
import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import { toggleRepeat } from '../edit/Repeats';
import { setVolume } from '../edit/Volume';
import { fraction } from '../fraction/Fraction';
import { TICKS_PER_QUARTER, writeMidi } from './midi';

/** Reads the file back with a real MIDI parser, so a malformed file fails here */
const read = (data: Uint8Array) => BasicMIDI.fromArrayBuffer(data.slice().buffer);

/** A track's notes as [ticks, channel, pitch, velocity], note ons only */
function noteOns(midi: BasicMIDI, track: number) {
    return midi.tracks[track]!.events
        .filter(({ statusByte, data }) => statusByte >> 4 === 0x9 && data[1]! > 0)
        .map(({ ticks, statusByte, data }) => [ticks, statusByte & 0xf, data[0], data[1]]);
}

const QUARTER = TICKS_PER_QUARTER;

// Melody: C-E-G q, G-B-D q, C-E-G h (4/4) | triplet, quintuplet, sextuplet (3/4) | C~ q., C 8, C! 8, r 8 (6/8)
// Bass: C whole | G dotted half | C dotted half
describe('writeMidi', () => {
    const midi = read(writeMidi(exampleComposition));

    it('writes a conductor track and a track per part, named', () => {
        // The first track's name is the song's: a parser reports it as such
        const title = midi.tracks[0]!.events.find(({ statusByte }) => statusByte === 0x03);
        expect(new TextDecoder().decode(title?.data)).toBe('Example');
        expect(midi.tracks.slice(1).map(({ name }) => name)).toEqual(['Melody', 'Bass']);
        expect(midi.timeDivision).toBe(QUARTER);
    });

    it('places notes in ticks, through tuplets and time signature changes', () => {
        const melody = noteOns(midi, 1);
        expect(melody.slice(0, 3)).toEqual([
            [0, 0, 60, 102],
            [0, 0, 64, 102],
            [0, 0, 67, 102],
        ]);
        // The triplet starts measure 2, four quarters in; its second note a third of a beat later
        expect(melody[9]).toEqual([4 * QUARTER, 0, 76, 102]);
        expect(melody[10]?.[0]).toBe(4 * QUARTER + QUARTER / 3);
        // The bass on its own channel
        expect(noteOns(midi, 2).map(([ticks, channel, pitch]) => [ticks, channel, pitch])).toEqual([
            [0, 1, 48],
            [4 * QUARTER, 1, 43],
            [7 * QUARTER, 1, 48],
        ]);
    });

    it('joins ties into one note', () => {
        // The tied C's two notes in measure 3 sound as one, so one note on
        const cs = noteOns(midi, 1).filter(([ticks, , pitch]) => pitch === 72 && (ticks as number) >= 7 * QUARTER);
        expect(cs.map(([ticks]) => ticks)).toEqual([7 * QUARTER, 7 * QUARTER + 2 * QUARTER]);
    });

    it('writes tempo changes, as microseconds a quarter', () => {
        // 120 to the quarter, then 60 to the dotted quarter: 90 quarters a minute
        // The parser keeps a default of its own at the start too, so duplicates are dropped
        const changes = new Set(midi.tempoChanges.map(({ ticks, tempo }) => `${ticks}:${Math.round(tempo)}`));
        expect([...changes].map((change) => change.split(':').map(Number)).sort((a, b) => a[0]! - b[0]!)).toEqual([
            [0, 120],
            [7 * QUARTER, 90],
        ]);
    });

    it('lasts as long as the piece plays', () => {
        // 2s + 1.5s, then the 6/8 measure's notes end a little before its 2s are up
        expect(midi.duration).toBeGreaterThan(5);
        expect(midi.duration).toBeLessThan(5.6);
    });

    it('writes repeats out, and volume as velocity', () => {
        const repeated = read(writeMidi(setVolume(toggleRepeat(exampleComposition, 0, 'end'), 1, 0, fraction(0), 50)));
        const bass = noteOns(repeated, 2);
        expect(bass.map(([ticks, , pitch, velocity]) => [ticks, pitch, velocity])).toEqual([
            [0, 48, 64],
            [4 * QUARTER, 48, 64],
            [8 * QUARTER, 43, 64],
            [11 * QUARTER, 48, 64],
        ]);
    });

    it('puts drums on channel 10 without a program change', () => {
        const kit = {
            ...exampleComposition,
            parts: exampleComposition.parts.map((part, i) => (i === 1 ? { ...part, drums: true, bank: 128 } : part)),
        };
        const drums = read(writeMidi(kit));
        expect(noteOns(drums, 2).every(([, channel]) => channel === 9)).toBe(true);
        expect(drums.tracks[2]!.events.some(({ statusByte }) => statusByte >> 4 === 0xc)).toBe(false);
    });

    it('gives 15 parts and drums a channel each, never drums', () => {
        const melody = exampleComposition.parts[0]!;
        const band = {
            ...exampleComposition,
            parts: [...Array.from({ length: 14 }, () => melody), { ...melody, drums: true, bank: 128 }, melody],
        };
        const file = read(writeMidi(band));
        const channels = file.tracks
            .slice(1)
            .map(({ events }) => events.find(({ statusByte }) => statusByte >> 4 === 0xb)!.statusByte & 0xf);
        expect(channels).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 9, 15]);
    });

    it("sets each channel's volume from the mixer, master, mutes and solos included", () => {
        const mixed = { ...exampleComposition, volume: 50, parts: exampleComposition.parts.map((part, i) => (i === 0 ? { ...part, volume: 120 } : part)) };
        const channelVolumes = (data: BasicMIDI) =>
            data.tracks.slice(1).map(({ events }) =>
                events.find(({ statusByte, data }) => statusByte >> 4 === 0xb && data[0] === 7)?.data[1],
            );
        expect(channelVolumes(midi)).toEqual([100, 100]);
        expect(channelVolumes(read(writeMidi(mixed)))).toEqual([60, 50]);
        const withParts = (flags: object[]) => ({ ...exampleComposition, parts: exampleComposition.parts.map((part, i) => ({ ...part, ...flags[i] })) });
        expect(channelVolumes(read(writeMidi(withParts([{ muted: true }, {}]))))).toEqual([0, 100]);
        expect(channelVolumes(read(writeMidi(withParts([{}, { solo: true }]))))).toEqual([0, 100]);
        expect(channelVolumes(read(writeMidi(withParts([{}, { solo: true, muted: true }]))))).toEqual([0, 0]);
    });
});
