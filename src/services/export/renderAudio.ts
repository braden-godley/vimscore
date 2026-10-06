/**
 * Renders a composition to audio through a soundfont, faster than real time and without an
 * audio device, using spessasynth's processor directly. It runs anywhere, including a worker.
 */

import { SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core';
import { Composition } from '../composition/Composition';
import { partInstrument } from '../instrument/Instrument';
import { BANK_SELECT, channelFor, velocity } from '../synth/channels';
import { timeline } from '../timeline/timeline';

export const SAMPLE_RATE = 44100;
/** Time after the last note for it, and any reverb, to ring out */
const TAIL_SECONDS = 2;
/** Events land at the start of the block they fall in: under 3ms */
const BLOCK = 128;

export interface RenderedAudio {
    left: Float32Array;
    right: Float32Array;
    sampleRate: number;
}

interface MidiEvent {
    sample: number;
    on: boolean;
    channel: number;
    pitch: number;
    velocity: number;
}

export async function renderAudio(
    composition: Composition,
    soundfont: ArrayBuffer,
    onProgress: (fraction: number) => void = () => {},
): Promise<RenderedAudio> {
    const processor = new SpessaSynthProcessor(SAMPLE_RATE, { eventsEnabled: false });
    await processor.processorInitialized;
    processor.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(soundfont), 'main');

    composition.parts.forEach((part, index) => {
        const { program, bank, drums } = partInstrument(part);
        const channel = channelFor(index);
        processor.midiChannels[channel]?.setDrums(drums);
        processor.controllerChange(channel, BANK_SELECT, bank);
        processor.programChange(channel, program);
    });

    const notes = timeline(composition);
    const events: MidiEvent[] = notes
        // Velocity 0 would be read as the note ending
        .filter(({ volume }) => velocity(volume) > 0)
        .flatMap(({ part, pitch, start, duration, volume }) => {
            const [channel, noteVelocity] = [channelFor(part), velocity(volume)];
            return [
                { sample: Math.round(start * SAMPLE_RATE), on: true, channel, pitch, velocity: noteVelocity },
                { sample: Math.round((start + duration) * SAMPLE_RATE), on: false, channel, pitch, velocity: 0 },
            ];
        })
        // At the same moment, a note ends before the next one on its pitch starts
        .sort((a, b) => a.sample - b.sample || Number(a.on) - Number(b.on));

    const end = Math.max(0, ...notes.map(({ start, duration }) => start + duration));
    const length = Math.ceil((end + TAIL_SECONDS) * SAMPLE_RATE);
    const left = new Float32Array(length);
    const right = new Float32Array(length);

    let next = 0;
    let reported = 0;
    for (let position = 0; position < length; position += BLOCK) {
        while (next < events.length && events[next]!.sample <= position) {
            const { on, channel, pitch, velocity: noteVelocity } = events[next++]!;
            if (on) processor.noteOn(channel, pitch, noteVelocity);
            else processor.noteOff(channel, pitch);
        }
        processor.process(left, right, position, Math.min(BLOCK, length - position));

        // Every few percent, so the messages don't outnumber the work
        if (position - reported > length / 50) {
            reported = position;
            onProgress(position / length);
        }
    }
    processor.destroySynthProcessor();
    return { left, right, sampleRate: SAMPLE_RATE };
}
