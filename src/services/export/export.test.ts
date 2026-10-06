import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import { Part } from '../part/Part';
import { encodeMp3 } from './encodeMp3';
import { timeline } from '../timeline/timeline';
import { SAMPLE_RATE, renderAudio } from './renderAudio';

/** Any soundfont will do; this one is on the developer's machine, so elsewhere the test skips */
const SOUNDFONT = '/Users/bgodley/Documents/MuseScore3/SoundFonts/RuneScape 2.sf2';

describe.skipIf(!existsSync(SOUNDFONT))('exporting through a soundfont', () => {
    const load = () => {
        const data = readFileSync(SOUNDFONT);
        return { path: SOUNDFONT, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
    };

    it('renders the whole piece and a tail, with sound in it', async () => {
        const progress: number[] = [];
        const audio = await renderAudio(exampleComposition, [load()], (fraction) => progress.push(fraction));
        // Until the last note ends, plus 2s to ring out
        const end = Math.max(...timeline(exampleComposition).map(({ start, duration }) => start + duration));
        expect(audio.left.length).toBe(Math.ceil((end + 2) * SAMPLE_RATE));
        const peak = audio.left.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
        expect(peak).toBeGreaterThan(0.01);
        // The last second is nearly silent
        const tail = audio.left.subarray(audio.left.length - SAMPLE_RATE);
        expect(tail.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0)).toBeLessThan(peak / 4);
        expect(progress.length).toBeGreaterThan(10);
    }, 30000);

    it('encodes MP3 frames', async () => {
        const mp3 = encodeMp3(await renderAudio(exampleComposition, [load()]));
        // Each frame starts with an 11-bit sync word
        expect(mp3[0]).toBe(0xff);
        expect(mp3[1]! & 0xe0).toBe(0xe0);
        // 192 kbps is 24 kB a second
        const seconds = 7.5;
        expect(mp3.length).toBeGreaterThan(seconds * 24_000 * 0.9);
        expect(mp3.length).toBeLessThan(seconds * 24_000 * 1.1);
    }, 30000);
});

/** A second soundfont, with the same instruments sounding different */
const OTHER = '/Users/bgodley/Documents/MuseScore3/SoundFonts/RuneScape HD (Lower Size).sf2';

describe.skipIf(!existsSync(SOUNDFONT) || !existsSync(OTHER))('exporting through several soundfonts', () => {
    const load = (path: string) => {
        const data = readFileSync(path);
        return { path, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
    };
    const render = async (paths: string[], composition = exampleComposition) =>
        (await renderAudio(composition, paths.map(load))).left;

    it('plays an instrument from the first soundfont that has it, unless the part chose one', async () => {
        const [first, other, both, reversed] = await Promise.all([
            render([SOUNDFONT]),
            render([OTHER]),
            render([SOUNDFONT, OTHER]),
            render([OTHER, SOUNDFONT]),
        ]);
        expect(first).not.toEqual(other);
        expect(both).toEqual(first);
        expect(reversed).toEqual(other);

        // Every part choosing the second soundfont's sound plays it, whatever comes first
        const chosen = { ...exampleComposition, parts: exampleComposition.parts.map((part) => ({ ...part, soundfont: OTHER })) };
        expect(await render([SOUNDFONT, OTHER], chosen)).toEqual(other);
    }, 60000);

    it('mixes parts from different soundfonts', async () => {
        const [melody, bass] = exampleComposition.parts as [Part, Part];
        const split = { ...exampleComposition, parts: [melody, { ...bass, soundfont: OTHER }] };
        const alone = (part: Part, path: string) => render([path], { ...exampleComposition, parts: [part] });
        const [mixed, melodyFirst, bassOther] = await Promise.all([
            render([SOUNDFONT, OTHER], split),
            alone(melody, SOUNDFONT),
            alone(bass, OTHER),
        ]);
        // Each soundfont's reverb is its own, so the sum is exact to rounding
        const error = mixed.reduce((max, sample, i) => Math.max(max, Math.abs(sample - (melodyFirst[i] ?? 0) - (bassOther[i] ?? 0))), 0);
        expect(error).toBeLessThan(1e-5);
    }, 60000);
});
