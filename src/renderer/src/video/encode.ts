/**
 * Encodes frames and sound into an MP4. Frames are drawn as fast as they encode rather than in
 * real time, so the video is smooth and in sync on any machine. Encoding is Chromium's (H.264
 * and AAC through WebCodecs); mediabunny puts them in the MP4.
 */

import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality } from 'mediabunny';
import { RenderedAudio } from '../../../services/export/renderAudio';

export const WIDTH = 1920;
export const HEIGHT = 1080;
/**
 * Silence the AAC encoder puts before the sound, in samples. Starting the sound this far before
 * zero has the MP4 skip it; otherwise every note would play about 48ms late.
 */
const AAC_PRIMING = 2112;

/** Gives the page a moment to show progress */
const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A video as long as the sound at `fps` frames a second, each frame drawn by `draw` at its time in seconds */
export async function encodeVideo(
    audio: RenderedAudio,
    draw: (context: CanvasRenderingContext2D, seconds: number) => void,
    onProgress: (fraction: number) => void,
    fps = 30,
): Promise<Uint8Array> {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext('2d')!;

    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const video = new CanvasSource(canvas, { codec: 'avc', quality: new Quality('high') });
    const sound = new AudioBufferSource(
        { codec: 'aac', quality: new Quality('high') },
        { startTimestamp: -AAC_PRIMING / audio.sampleRate },
    );
    output.addVideoTrack(video, { frameRate: fps });
    output.addAudioTrack(sound);
    await output.start();

    const seconds = audio.left.length / audio.sampleRate;
    const frames = Math.ceil(seconds * fps);
    for (let frame = 0; frame < frames; frame++) {
        const time = frame / fps;
        // A frame stays up for its whole span, so it shows the middle of it: drawn at its start,
        // everything would land up to a frame late
        draw(context, time + 0.5 / fps);
        await video.add(time, 1 / fps);
        if (frame % fps === 0) {
            onProgress(0.95 * (frame / frames));
            await breathe();
        }
    }

    const buffer = new AudioBuffer({ numberOfChannels: 2, length: audio.left.length, sampleRate: audio.sampleRate });
    buffer.copyToChannel(audio.left as Float32Array<ArrayBuffer>, 0);
    buffer.copyToChannel(audio.right as Float32Array<ArrayBuffer>, 1);
    await sound.add(buffer);
    await output.finalize();
    onProgress(1);
    return new Uint8Array(output.target.buffer!);
}
