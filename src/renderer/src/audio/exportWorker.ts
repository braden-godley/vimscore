/// <reference lib="webworker" />
/**
 * Renders (and for MP3, encodes) an export's audio off the main thread, so the editor stays
 * responsive. Posts `{ progress }` as it goes, then `{ data }`, `{ audio }` or `{ error }`.
 */

import { Composition } from '../../../services/composition/Composition';
import { encodeMp3 } from '../../../services/export/encodeMp3';
import { RenderedAudio, SoundfontData, renderAudio } from '../../../services/export/renderAudio';

export interface ExportRequest {
    composition: Composition;
    /** In priority order */
    soundfonts: SoundfontData[];
    /** `mp3` for a finished file; `pcm` for the samples, which a video goes on to use */
    format: 'mp3' | 'pcm';
}

export type ExportReply = { progress: number } | { data: Uint8Array } | { audio: RenderedAudio } | { error: string };

const post = (reply: ExportReply, transfer: Transferable[] = []) => self.postMessage(reply, transfer);

self.onmessage = async ({ data: { composition, soundfonts, format } }: MessageEvent<ExportRequest>) => {
    try {
        // Rendering is most of an MP3's work
        const share = format === 'mp3' ? 0.8 : 1;
        const audio = await renderAudio(composition, soundfonts, (fraction) => post({ progress: fraction * share }));
        if (format === 'pcm') {
            post({ audio }, [audio.left.buffer, audio.right.buffer]);
            return;
        }
        const mp3 = encodeMp3(audio, (fraction) => post({ progress: 0.8 + fraction * 0.2 }));
        post({ data: mp3 }, [mp3.buffer]);
    } catch (error) {
        post({ error: (error as Error).message });
    }
};
