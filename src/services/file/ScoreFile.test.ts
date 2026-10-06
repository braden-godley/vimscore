import { describe, expect, it } from 'vitest';
import { newComposition, withTrailingEmptyMeasure } from '../composition/Composition';
import { exampleComposition } from '../composition/example-composition';
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

    it('write short values, one event per line', () => {
        const text = writeScore(exampleComposition);
        expect(text).toContain('"format": "vimscore"');
        expect(text).toContain('\n    { "timeSignature": "6/8", "tempo": "q.=60" }');
        expect(text).toContain('\n              { "chord": [{ "pitch": 72, "tie": true }], "duration": "q." },');
        expect(text).toContain('{ "rest": "8" }');
        expect(text).toContain('"tuplet": "3:2"');
        expect(text).toContain('\n                  { "chord": [76], "duration": "8" },');
        expect(text.split('\n').every((line) => line.length <= 120)).toBe(true);
    });
});

describe('readScore errors', () => {
    const file = (changes: Record<string, unknown>) =>
        JSON.stringify({ ...JSON.parse(writeScore(exampleComposition)), ...changes });
    const parts = JSON.parse(writeScore(exampleComposition)).parts;

    it('say what is wrong and where', () => {
        expect(readScore('{')).toMatchObject({ error: expect.stringMatching(/^not valid JSON/) });
        expect(readScore('{"format":"other"}')).toEqual({ error: 'not a vimscore file' });
        expect(readScore(file({ version: 2 }))).toEqual({
            error: 'version: this file is version 2; this app reads up to version 1',
        });
        expect(readScore(file({ measures: [{ timeSignature: '3/5' }, {}, {}] }))).toEqual({
            error: 'measures[0].timeSignature: "3/5" isn\'t a time signature like 3/4',
        });

        parts[0].measures[0].voices[0][1] = { chord: [60], duration: 'x' };
        expect(readScore(file({ parts }))).toEqual({
            error: 'parts[0].measures[0].voices[0][1].duration: "x" isn\'t a note value like q, 8 or h.',
        });
    });

    it('check every part has a voice for every measure', () => {
        parts[1].measures.pop();
        expect(readScore(file({ parts: [parts[1]] }))).toEqual({
            error: 'parts[0].measures: has 2 measures but the score has 3',
        });
    });
});
