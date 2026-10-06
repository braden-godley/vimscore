/** Encodes rendered audio as a stereo MP3 with LAME */

import { Mp3Encoder } from '@breezystack/lamejs';
import { RenderedAudio } from './renderAudio';

const KBPS = 192;
/** Samples per call: a whole number of MP3 frames (1152 samples each) */
const CHUNK = 1152 * 20;

function toInt16(samples: Float32Array): Int16Array {
    const result = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        const clipped = Math.max(-1, Math.min(1, samples[i]!));
        result[i] = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
    }
    return result;
}

export function encodeMp3({ left, right, sampleRate }: RenderedAudio, onProgress: (fraction: number) => void = () => {}): Uint8Array {
    const encoder = new Mp3Encoder(2, sampleRate, KBPS);
    const [leftPcm, rightPcm] = [toInt16(left), toInt16(right)];
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < leftPcm.length; i += CHUNK) {
        chunks.push(encoder.encodeBuffer(leftPcm.subarray(i, i + CHUNK), rightPcm.subarray(i, i + CHUNK)));
        onProgress(i / leftPcm.length);
    }
    chunks.push(encoder.flush());

    const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}
