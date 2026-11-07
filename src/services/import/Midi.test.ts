import { describe, expect, it } from 'vitest';
import { Composition } from '../composition/Composition';
import { Duration } from '../duration/Duration';
import { Chord, Event, Rest } from '../event/Event';
import { writeMidi } from '../export/midi';
import { written } from '../edit/written';
import { fraction } from '../fraction/Fraction';
import { Part } from '../part/Part';
import { pitch, spell } from '../pitch/Pitch';
import { readMidi } from './Midi';

const d = (base: Duration['base'], dots: Duration['dots'] = 0): Duration => ({ base, dots });
const chord = (duration: Duration, ...pitches: number[]): Chord => ({ kind: 'chord', duration, notes: pitches.map((p) => ({ pitch: spell(p) })) });
const tied = (duration: Duration, ...pitches: number[]): Chord => ({
    kind: 'chord',
    duration,
    notes: pitches.map((p) => ({ pitch: spell(p), tie: true })),
});
const rest = (duration: Duration): Rest => ({ kind: 'rest', duration });
const part = (name: string, program: number, ...measures: Event[][]): Part => ({
    name,
    program,
    measures: measures.map((events) => ({ voices: [{ events }] })),
});

const read = (data: Uint8Array) => {
    const result = readMidi(data);
    if ('error' in result) throw new Error(result.error);
    return result;
};

// Building files by hand

const variable = (value: number) => {
    const bytes = [value & 0x7f];
    for (let rest = value >> 7; rest > 0; rest >>= 7) bytes.unshift((rest & 0x7f) | 0x80);
    return bytes;
};
const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
const uint32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
/** A track from [delta ticks, ...bytes] events, ended for you */
const track = (...events: number[][]) => {
    const data = events.flatMap(([delta, ...bytes]) => [...variable(delta!), ...bytes]);
    data.push(0, 0xff, 0x2f, 0);
    return [...ascii('MTrk'), ...uint32(data.length), ...data];
};
const smf = (format: number, ticksPerQuarter: number, ...tracks: number[][]) =>
    new Uint8Array([...ascii('MThd'), ...uint32(6), 0, format, 0, tracks.length, ticksPerQuarter >> 8, ticksPerQuarter & 0xff, ...tracks.flat()]);
const name = (text: string) => [0, 0xff, 0x03, text.length, ...ascii(text)];

describe('readMidi', () => {
    it('writes back what vimscore exported: values, ties, chords, rests and triplets', () => {
        const composition: Composition = {
            title: 'Round Trip',
            measures: [{ keySignature: { fifths: 2 }, tempo: { bpm: 90, beat: d(4) } }, { timeSignature: { beats: 3, beatValue: 4 } }],
            parts: [
                part(
                    'Flute',
                    73,
                    [chord(d(4, 1), 74), chord(d(8), 76), { kind: 'tuplet', actual: 3, normal: 2, events: [chord(d(8), 78), chord(d(8), 79), chord(d(8), 81)] }, tied(d(4), 83)],
                    [chord(d(8), 83), rest(d(8)), chord(d(2), 74, 78, 81)],
                ),
                part('Cello', 42, [chord(d(1), 38)], [chord(d(2, 1), 45)]),
            ],
            soundfonts: [],
        };
        const imported = read(writeMidi(composition));

        expect(imported.title).toBe('Round Trip');
        expect(imported.measures).toEqual(composition.measures);
        expect(imported.parts.map(({ name, program, clef }) => ({ name, program, clef }))).toEqual([
            { name: 'Flute', program: 73, clef: 'treble' },
            { name: 'Cello', program: 42, clef: 'bass' },
        ]);
        expect(written(imported, 0, 0)).toBe('74/q. 76/8 [78/8 79/8 81/8] 83~/q');
        expect(written(imported, 0, 1)).toBe('83/8 r/8 74,78,81/h');
        expect(written(imported, 1, 0)).toBe('38/w');
        expect(written(imported, 1, 1)).toBe('45/h.');
        // Spelled in the key: F♯ and C♯ in D major
        const triplet = imported.parts[0]!.measures[0]!.voices[0]!.events[2];
        expect(triplet?.kind === 'tuplet' && triplet.events[0]).toMatchObject({ notes: [{ pitch: pitch('F#5') }] });
    });

    it('puts notes that overlap in voices of their own', () => {
        const composition: Composition = {
            title: 'Voices',
            measures: [{}],
            parts: [
                {
                    name: 'Piano',
                    program: 0,
                    measures: [{ voices: [{ events: [chord(d(2), 72), chord(d(2), 74)] }, { events: [chord(d(1), 60)] }] }],
                },
            ],
            soundfonts: [],
        };
        const imported = read(writeMidi(composition));
        expect(imported.parts[0]!.measures[0]!.voices.map(({ events }) => events)).toEqual(composition.parts[0]!.measures[0]!.voices.map(({ events }) => events));
    });

    it('reads drums onto a percussion staff, with their volume and dynamics', () => {
        const composition: Composition = {
            title: 'Beat',
            measures: [{}, {}],
            parts: [
                {
                    ...part('Drums', 0, [chord(d(4), 36), chord(d(4), 38), chord(d(4), 36), chord(d(4), 38)], [chord(d(1), 49)]),
                    bank: 128,
                    drums: true,
                    volume: 80,
                },
            ],
            soundfonts: [],
        };
        composition.parts[0]!.measures[1] = { ...composition.parts[0]!.measures[1]!, dynamics: [{ offset: fraction(0), dynamic: 'f' }] };
        const imported = read(writeMidi(composition));
        expect(imported.parts[0]).toMatchObject({ name: 'Drums', clef: 'percussion', bank: 128, drums: true, volume: 80 });
        expect(written(imported, 0, 0)).toBe('36/q 38/q 36/q 38/q');
        expect(imported.parts[0]!.measures[1]!.dynamics).toEqual([{ offset: fraction(0), dynamic: 'f' }]);
    });

    it('snaps loosely played notes to the grid, and lets notes let go a little early', () => {
        // A quarter a few ticks late and let go early, then an eighth a little early
        const file = smf(
            0,
            480,
            track(name('Loose'), [7, 0x90, 60, 90], [440, 0x80, 60, 0], [27, 0x90, 62, 90], [200, 0x80, 62, 0]),
        );
        const imported = read(file);
        expect(imported.title).toBe('Loose');
        expect(written(imported, 0, 0)).toBe('60/q 62/8 r/8 r/h');
    });

    it('reads running status, and a note on with no velocity as a note off', () => {
        const file = smf(0, 96, track([0, 0x90, 60, 80], [96, 60, 0], [0, 64, 80], [96, 64, 0]));
        expect(written(read(file), 0, 0)).toBe('60/q 64/q r/h');
    });

    it('makes a part of each channel, and of each instrument a channel changes to, named for it', () => {
        const file = smf(
            0,
            96,
            track(
                [0, 0xc0, 40],
                [0, 0xc1, 32],
                [0, 0x90, 76, 80],
                [0, 0x91, 40, 80],
                [384, 0x80, 76, 0],
                [0, 0x81, 40, 0],
                [0, 0xc0, 73],
                [0, 0x90, 79, 80],
                [384, 0x80, 79, 0],
            ),
        );
        const imported = read(file);
        expect(imported.parts.map(({ name, program }) => ({ name, program }))).toEqual([
            { name: 'Violin', program: 40 },
            { name: 'Flute', program: 73 },
            { name: 'Acoustic Bass', program: 32 },
        ]);
        expect(written(imported, 1, 1)).toBe('79/w');
        expect(written(imported, 1, 0)).toBe('r/w');
    });

    it('calls a type 1 track by its name, and takes the title from the first track', () => {
        const file = smf(1, 96, track(name('Song')), track(name('Lead'), [0, 0x90, 72, 80], [96, 0x80, 72, 0]));
        const imported = read(file);
        expect(imported.title).toBe('Song');
        expect(imported.parts[0]!.name).toBe('Lead');
    });

    it("says what's wrong with one it can't read", () => {
        expect(readMidi(new TextEncoder().encode('<museScore/>'))).toEqual({ error: 'Not a MIDI file' });
        expect(readMidi(smf(0, 96, track(name('Empty'))))).toEqual({ error: 'No notes in it' });
        expect(readMidi(smf(0, 96, track([0, 0x90, 60])).slice(0, -6))).toEqual({ error: 'Not a MIDI file, or a damaged one' });
        const smpte = smf(0, 96, track([0, 0x90, 60, 80], [96, 0x80, 60, 0]));
        smpte[12] = 0xe7;
        expect(readMidi(smpte)).toEqual({ error: "Timed in SMPTE frames rather than beats, which vimscore can't read" });
    });
});
