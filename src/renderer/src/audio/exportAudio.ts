/** Runs an export's audio in a worker, reporting progress */

import { Composition } from '../../../services/composition/Composition';
import { RenderedAudio } from '../../../services/export/renderAudio';
import type { ExportReply, ExportRequest } from './exportWorker';

function runWorker(request: ExportRequest, onProgress: (fraction: number) => void): Promise<ExportReply> {
    const worker = new Worker(new URL('./exportWorker.ts', import.meta.url), { type: 'module' });
    return new Promise((resolve, reject) => {
        worker.onmessage = ({ data }: MessageEvent<ExportReply>) => {
            if ('progress' in data) return onProgress(data.progress);
            worker.terminate();
            if ('error' in data) reject(new Error(data.error));
            else resolve(data);
        };
        worker.onerror = (event) => {
            worker.terminate();
            reject(new Error(event.message));
        };
        worker.postMessage(request, [request.soundfont]);
    });
}

export async function exportMp3(
    composition: Composition,
    soundfont: ArrayBuffer,
    onProgress: (fraction: number) => void,
): Promise<Uint8Array> {
    const reply = await runWorker({ composition, soundfont, format: 'mp3' }, onProgress);
    if (!('data' in reply)) throw new Error('no MP3 came back');
    return reply.data;
}

/** The piece's audio as samples, for a video */
export async function renderPcm(
    composition: Composition,
    soundfont: ArrayBuffer,
    onProgress: (fraction: number) => void,
): Promise<RenderedAudio> {
    const reply = await runWorker({ composition, soundfont, format: 'pcm' }, onProgress);
    if (!('audio' in reply)) throw new Error('no audio came back');
    return reply.audio;
}
