import { describe, expect, it } from 'vitest';
import { exampleComposition } from '../composition/example-composition';
import { newDocument } from '../file/Commands';
import { ExportHost, besideScore, runExport } from './runExport';

function fakeHost(files: string[] = []) {
    const written: Record<string, Uint8Array> = {};
    const host: ExportHost = {
        resolve: async (path, base = '/home') => (path.startsWith('/') ? path : `${base}/${path}`),
        exists: async (path) => files.includes(path) || path in written,
        writeBinary: async (path, data) => {
            written[path] = data;
        },
    };
    return { host, written };
}

const render = async () => new Uint8Array([1, 2, 3]);
const saved = { ...newDocument(exampleComposition), path: '/music/song.vimscore' };

describe('besideScore', () => {
    it('swaps the extension', () => {
        expect(besideScore('/music/song.vimscore', 'mp3')).toBe('/music/song.mp3');
        expect(besideScore('/music/v1.2/song', 'mp3')).toBe('/music/v1.2/song.mp3');
    });
});

describe('runExport', () => {
    it('writes beside the score without a path, replacing an earlier export', async () => {
        const { host, written } = fakeHost(['/music/song.mp3']);
        const result = await runExport({ format: 'mp3', force: false }, saved, host, render);
        expect(result).toEqual({ message: '"song.mp3" exported' });
        expect(written['/music/song.mp3']).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('names a video after the score too, and hands the renderer the format', async () => {
        const { host, written } = fakeHost();
        const formats: string[] = [];
        const result = await runExport({ format: 'mp4', force: false }, saved, host, async (_, format) => {
            formats.push(format);
            return new Uint8Array([4]);
        });
        expect(result.message).toBe('"song.mp4" exported');
        expect(Object.keys(written)).toEqual(['/music/song.mp4']);
        expect(formats).toEqual(['mp4']);
    });

    it("writes where it's told, relative to the score, adding the extension", async () => {
        const { host, written } = fakeHost();
        await runExport({ format: 'mp3', path: 'mixes/take', force: false }, saved, host, render);
        expect(Object.keys(written)).toEqual(['/music/mixes/take.mp3']);
    });

    it("won't replace a file it's told to write without !", async () => {
        const { host } = fakeHost(['/music/other.mp3']);
        const command = { format: 'mp3' as const, path: 'other.mp3', force: false };
        expect(await runExport(command, saved, host, render)).toEqual({
            message: '"other.mp3" exists (add ! to override)',
            error: true,
        });
        expect((await runExport({ ...command, force: true }, saved, host, render)).error).toBeUndefined();
    });

    it('needs a path for a score never saved', async () => {
        expect(await runExport({ format: 'mp3', force: false }, newDocument(), fakeHost().host, render)).toEqual({
            message: 'No file name: save the score first, or :export mp3 file',
            error: true,
        });
    });

    it('reports a render that fails', async () => {
        const failing = async () => {
            throw new Error('No soundfont loaded');
        };
        expect(await runExport({ format: 'mp3', force: false }, saved, fakeHost().host, failing)).toEqual({
            message: 'Export failed: No soundfont loaded',
            error: true,
        });
    });
});
