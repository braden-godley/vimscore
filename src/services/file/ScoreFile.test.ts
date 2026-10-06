import { describe, expect, it } from 'vitest';
import { newComposition, withTrailingEmptyMeasure } from '../composition/Composition';
import { exampleComposition } from '../composition/example-composition';
import { pitchName } from '../pitch/Pitch';
import { readScore, writeScore } from './ScoreFile';

describe('writeScore and readScore', () => {
    it('round-trip every kind of event, change and part', () => {
        for (const composition of [exampleComposition, withTrailingEmptyMeasure(newComposition())]) {
            expect(readScore(writeScore(composition))).toEqual(composition);
        }
    });

    it('keep a part’s soundfont bank and drums', () => {
        const kit = {
            ...exampleComposition,
            parts: exampleComposition.parts.map((part, i) => (i === 1 ? { ...part, program: 32, bank: 128, drums: true } : part)),
        };
        expect(readScore(writeScore(kit))).toEqual(kit);
        expect(writeScore(kit)).toContain('"bank": 128,\n      "drums": true');
    });

    it('keep the mixer’s volumes, leaving normal unwritten', () => {
        const mixed = { ...exampleComposition, volume: 80, parts: exampleComposition.parts.map((part, i) => (i === 0 ? { ...part, volume: 120 } : part)) };
        expect(readScore(writeScore(mixed))).toEqual(mixed);
        expect(writeScore(exampleComposition)).not.toContain('"volume": 1');
        expect(readScore(writeScore({ ...mixed, volume: 101 }))).toEqual({ error: expect.stringContaining('volume') });
    });

    it('keep soundfonts in priority order, and read the one of older files', () => {
        const layered = { ...exampleComposition, soundfonts: [{ filePath: '/sf/Strings.sf2' }, { filePath: '/sf/General.sf2' }] };
        expect(readScore(writeScore(layered))).toEqual(layered);
        expect(writeScore(layered)).toContain('"soundfonts": [\n    "/sf/Strings.sf2",\n    "/sf/General.sf2"\n  ]');

        const older = writeScore(exampleComposition).replace(/"soundfonts": \[\s*(".*?")\s*\]/, '"soundfont": $1');
        expect(older).toContain('"soundfont": "/Users');
        expect(readScore(older)).toEqual(exampleComposition);
        expect(writeScore({ ...exampleComposition, soundfonts: [] })).not.toContain('soundfont');

        // A part can choose its sound from any of them
        const [melody, ...rest] = layered.parts;
        const chosen = { ...layered, parts: [{ ...melody!, soundfont: '/sf/General.sf2' }, ...rest] };
        expect(readScore(writeScore(chosen))).toEqual(chosen);
    });

    it('keep arpeggios', () => {
        const melody = exampleComposition.parts[0]!;
        const [first, ...rest] = melody.measures[0]!.voices[0]!.events;
        const rolled = {
            ...exampleComposition,
            parts: [{ ...melody, measures: [{ voices: [{ events: [{ ...first!, arpeggio: true }, ...rest] }] }, ...melody.measures.slice(1)] }],
        };
        expect(readScore(writeScore(rolled))).toEqual(rolled);
        expect(writeScore(rolled)).toContain('{ "chord": ["C4", "E4", "G4"], "duration": "q", "arpeggio": true }');
    });

    it('keep glissandi', () => {
        const melody = exampleComposition.parts[0]!;
        const [first, ...rest] = melody.measures[0]!.voices[0]!.events;
        if (first?.kind !== 'chord') throw new Error('expected a chord');
        const sliding = { ...first, notes: first.notes.map((note, i) => (i === 2 ? { ...note, glissando: true } : note)) };
        const slid = {
            ...exampleComposition,
            parts: [{ ...melody, measures: [{ voices: [{ events: [sliding, ...rest] }] }, ...melody.measures.slice(1)] }],
        };
        expect(readScore(writeScore(slid))).toEqual(slid);
        expect(writeScore(slid)).toContain('{ "pitch": "G4", "glissando": true }');
    });

    it('write short values, one event per line', () => {
        const text = writeScore(exampleComposition);
        expect(text).toContain('"format": "vimscore"');
        expect(text).toContain('\n    { "timeSignature": "6/8", "tempo": "q.=60" }');
        expect(text).toContain('\n              { "chord": [{ "pitch": "C5", "tie": true }], "duration": "q." },');
        expect(text).toContain('{ "rest": "8" }');
        expect(text).toContain('"tuplet": "3:2"');
        expect(text).toContain('\n                  { "chord": ["E5"], "duration": "8" },');
        expect(text.split('\n').every((line) => line.length <= 120)).toBe(true);
    });
});

describe('version 1 files', () => {
    it('spell their MIDI numbers in the key of each measure', () => {
        const chord = (notes: unknown[]) => ({ voices: [[{ chord: notes, duration: 'w' }]] });
        const file = JSON.stringify({
            format: 'vimscore',
            version: 1,
            title: 'Old',
            measures: [{ timeSignature: '4/4', key: -2 }, {}, { key: 2 }],
            parts: [{ name: 'Piano', program: 0, measures: [chord([70]), chord([{ pitch: 63, tie: true }]), chord([66])] }],
        });
        const read = readScore(file);
        if ('error' in read) throw new Error(read.error);
        const names = read.parts[0]!.measures.map(({ voices }) => {
            const event = voices[0]!.events[0]!;
            return event.kind === 'chord' ? event.notes.map(({ pitch }) => pitchName(pitch)) : [];
        });
        expect(names).toEqual([['Bb4'], ['Eb4'], ['F#4']]);
    });
});

describe('readScore errors', () => {
    const file = (changes: Record<string, unknown>) =>
        JSON.stringify({ ...JSON.parse(writeScore(exampleComposition)), ...changes });
    const parts = JSON.parse(writeScore(exampleComposition)).parts;

    it('say what is wrong and where', () => {
        expect(readScore('{')).toMatchObject({ error: expect.stringMatching(/^not valid JSON/) });
        expect(readScore('{"format":"other"}')).toEqual({ error: 'not a vimscore file' });
        expect(readScore(file({ version: 3 }))).toEqual({
            error: 'version: this file is version 3; this app reads up to version 2',
        });
        expect(readScore(file({ measures: [{ timeSignature: '3/5' }, {}, {}] }))).toEqual({
            error: 'measures[0].timeSignature: "3/5" isn\'t a time signature like 3/4',
        });

        parts[0].measures[0].voices[0][1] = { chord: ['C4'], duration: 'x' };
        expect(readScore(file({ parts }))).toEqual({
            error: 'parts[0].measures[0].voices[0][1].duration: "x" isn\'t a note value like q, 8 or h.',
        });

        parts[0].measures[0].voices[0][1] = { chord: ['H4'], duration: 'q' };
        expect(readScore(file({ parts }))).toEqual({
            error: 'parts[0].measures[0].voices[0][1].chord[0]: "H4" isn\'t a pitch like C4, F#3 or Bb5',
        });
    });

    it('check every part has a voice for every measure', () => {
        parts[1].measures.pop();
        expect(readScore(file({ parts: [parts[1]] }))).toEqual({
            error: 'parts[0].measures: has 2 measures but the score has 3',
        });
    });
});
