import { describe, expect, it } from 'vitest';
import { written } from '../edit/written';
import { readOrganya } from './Organya';

interface OrgNote {
    at: number;
    key: number;
    length: number;
    volume?: number;
}

/** An Organya song: tracks by number, each with its waveform or drum and notes */
function org(
    { wait = 125, beats = 4, steps = 4, loop = [0, 16] }: { wait?: number; beats?: number; steps?: number; loop?: [number, number] },
    tracks: Record<number, { wave: number; notes: OrgNote[] }>,
): Uint8Array {
    const bytes: number[] = [...'Org-02'].map((c) => c.charCodeAt(0));
    const u16 = (n: number) => bytes.push(n & 0xff, n >> 8);
    const i32 = (n: number) => bytes.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
    u16(wait);
    bytes.push(beats, steps);
    i32(loop[0]);
    i32(loop[1]);
    for (let t = 0; t < 16; t++) {
        u16(1000);
        bytes.push(tracks[t]?.wave ?? 0, 0);
        u16(tracks[t]?.notes.length ?? 0);
    }
    for (let t = 0; t < 16; t++) {
        const notes = tracks[t]?.notes ?? [];
        for (const { at } of notes) i32(at);
        bytes.push(...notes.map(({ key }) => key));
        bytes.push(...notes.map(({ length }) => length));
        bytes.push(...notes.map(({ volume = 200 }) => volume));
        bytes.push(...notes.map(() => 6));
    }
    return new Uint8Array(bytes);
}

const read = (data: Uint8Array) => {
    const result = readOrganya(data);
    if ('error' in result) throw new Error(result.error);
    return result;
};

describe('readOrganya', () => {
    it('writes each melodic track as a part, its steps as sixteenths, its keys from C1', () => {
        // Key 36 is C4, middle C; 125 ms a sixteenth is 120 to the quarter
        const song = read(
            org({ loop: [0, 32] }, {
                0: { wave: 11, notes: [{ at: 0, key: 36, length: 4 }, { at: 4, key: 40, length: 2 }, { at: 8, key: 43, length: 8 }] },
                1: { wave: 92, notes: [{ at: 0, key: 12, length: 16 }, { at: 16, key: 14, length: 16 }] },
            }),
        );
        expect(song.measures[0]).toMatchObject({ tempo: { bpm: 120, beat: { base: 4, dots: 0 } } });
        expect(song.parts.map(({ name, program, clef }) => ({ name, program, clef }))).toEqual([
            { name: 'Wave 11', program: 80, clef: 'treble' },
            { name: 'Wave 92', program: 38, clef: 'bass' },
        ]);
        expect(written(song, 0, 0)).toBe('60/q 64/8 r/8 67/h');
        expect(written(song, 1, 1)).toBe('38/w');
    });

    it('lets the next note cut one short, and takes only the later of two on one step', () => {
        const song = read(
            org({}, { 0: { wave: 0, notes: [{ at: 0, key: 36, length: 8 }, { at: 2, key: 38, length: 1 }, { at: 4, key: 40, length: 4 }, { at: 4, key: 41, length: 4 }] } }),
        );
        expect(written(song, 0, 0)).toBe('60/8 62/16 r/16 65/q r/h');
    });

    it('leaves out what only changes the volume of a sounding note, and writes volumes as dynamics', () => {
        const song = read(
            org({ loop: [0, 32] }, {
                0: {
                    wave: 0,
                    notes: [
                        { at: 0, key: 36, length: 16 },
                        { at: 2, key: 255, length: 1, volume: 60 },
                        { at: 16, key: 36, length: 16, volume: 80 },
                    ],
                },
            }),
        );
        expect(written(song, 0, 0)).toBe('60/w');
        expect(song.parts[0]!.measures[0]).not.toHaveProperty('dynamics');
        expect(song.parts[0]!.measures[1]!.dynamics).toMatchObject([{ dynamic: 'p' }]);
    });

    it('puts every drum track in one drum part, each drum as its General MIDI one', () => {
        const song = read(
            org({}, {
                8: { wave: 0, notes: [{ at: 0, key: 24, length: 1 }, { at: 8, key: 24, length: 1 }] },
                9: { wave: 2, notes: [{ at: 4, key: 30, length: 1 }, { at: 12, key: 30, length: 1 }] },
                10: { wave: 5, notes: [0, 4, 8, 12].map((at) => ({ at, key: 40, length: 1 })) },
            }),
        );
        expect(song.parts).toHaveLength(1);
        expect(song.parts[0]).toMatchObject({ name: 'Drums', clef: 'percussion', drums: true, bank: 128 });
        expect(written(song, 0, 0)).toBe('36,42/16 r/16 r/8 38,42/16 r/16 r/8 36,42/16 r/16 r/8 38,42/16 r/16 r/8');
    });

    it('marks the loop with repeat barlines, and ends where it does', () => {
        const notes = Array.from({ length: 6 }, (_, i) => ({ at: i * 16, key: 36, length: 16 }));
        const song = read(org({ loop: [16, 48] }, { 0: { wave: 0, notes } }));
        expect(song.measures).toHaveLength(3);
        expect(song.measures[1]).toMatchObject({ repeatStart: true });
        expect(song.measures[2]).toMatchObject({ repeatEnd: true });
        // A loop off the barlines has no repeat barlines
        const offBeat = read(org({ loop: [4, 32] }, { 0: { wave: 0, notes } }));
        expect(offBeat.measures.some((info) => info.repeatStart || info.repeatEnd)).toBe(false);
    });

    it('writes three steps to the beat in compound time', () => {
        const song = read(org({ beats: 4, steps: 3, loop: [0, 12] }, { 0: { wave: 0, notes: [{ at: 0, key: 36, length: 3 }, { at: 3, key: 38, length: 1 }] } }));
        expect(song.measures[0]).toMatchObject({ timeSignature: { beats: 12, beatValue: 8 } });
        expect(written(song, 0, 0)).toBe('60/q. 62/8 r/q r/h.');
    });

    it("says what's wrong with one it can't read", () => {
        expect(readOrganya(new TextEncoder().encode('MThd'))).toEqual({ error: 'Not an Organya song' });
        expect(readOrganya(org({}, {}).slice(0, 40))).toEqual({ error: 'A damaged Organya song' });
        expect(readOrganya(org({}, {}))).toEqual({ error: 'No notes in it' });
    });
});
