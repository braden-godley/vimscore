/**
 * Renders a composition to audio through its soundfonts, faster than real time and without an
 * audio device, using spessasynth's processor directly. It runs anywhere, including a worker.
 */

import { SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core';
import { Composition } from '../composition/Composition';
import { partInstrument } from '../instrument/Instrument';
import { LoadedSoundfont, soundfontFor } from '../soundfont/Soundfont';
import { partMix } from '../edit/Mixer';
import { BANK_SELECT, CHANNEL_VOLUME, channelFor, channelVolume, velocity } from '../synth/channels';
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
    /** Which of the layers plays it */
    layer: number;
    sample: number;
    on: boolean;
    channel: number;
    pitch: number;
    velocity: number;
}

/** A soundfont's file, and what's in it */
export interface SoundfontData {
    path: string;
    data: ArrayBuffer;
}

interface Layer extends LoadedSoundfont {
    processor: SpessaSynthProcessor;
    /** The parts it plays */
    parts: Set<number>;
}

/** A processor for a soundfont: the instruments in it, and nothing playing yet */
async function loadLayer({ path, data }: SoundfontData): Promise<Layer> {
    const processor = new SpessaSynthProcessor(SAMPLE_RATE, { eventsEnabled: false });
    await processor.processorInitialized;
    processor.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(data), 'main');
    const instruments = processor.soundBankManager.presetList.map(({ name, program, bankMSB, isDrum }) => ({
        name,
        program,
        bank: bankMSB,
        drums: isDrum,
    }));
    return { path, instruments, processor, parts: new Set() };
}

/**
 * Each part plays through the soundfont it chose, or the first with its bank and program, as
 * it does live (see `soundfontFor`); each soundfont gets a processor of its own, and they mix.
 */
export async function renderAudio(
    composition: Composition,
    /** In priority order */
    soundfonts: SoundfontData[],
    onProgress: (fraction: number) => void = () => {},
): Promise<RenderedAudio> {
    const loaded = await Promise.all(soundfonts.map(loadLayer));
    const mix = partMix(composition);
    composition.parts.forEach((part, index) => {
        const instrument = partInstrument(part);
        const layer = soundfontFor(instrument, loaded);
        if (!layer) return;
        layer.parts.add(index);
        const { processor } = layer;
        const channel = channelFor(index);
        processor.midiChannels[channel]?.setDrums(instrument.drums);
        processor.controllerChange(channel, BANK_SELECT, instrument.bank);
        processor.programChange(channel, instrument.program);
        processor.controllerChange(channel, CHANNEL_VOLUME, channelVolume(mix[index]!));
    });
    // Soundfonts no part plays through needn't be rendered
    const layers = loaded.filter((layer) => {
        if (layer.parts.size === 0) layer.processor.destroySynthProcessor();
        return layer.parts.size > 0;
    });

    const notes = timeline(composition);
    const events: MidiEvent[] = notes
        // Velocity 0 would be read as the note ending
        .filter(({ volume }) => velocity(volume) > 0)
        .flatMap(({ part, pitch, start, duration, volume }) => {
            const layer = layers.findIndex(({ parts }) => parts.has(part));
            const [channel, noteVelocity] = [channelFor(part), velocity(volume)];
            if (layer === -1) return [];
            return [
                { layer, sample: Math.round(start * SAMPLE_RATE), on: true, channel, pitch, velocity: noteVelocity },
                { layer, sample: Math.round((start + duration) * SAMPLE_RATE), on: false, channel, pitch, velocity: 0 },
            ];
        })
        // At the same moment, a note ends before the next one on its pitch starts
        .sort((a, b) => a.sample - b.sample || Number(a.on) - Number(b.on));

    const end = Math.max(0, ...notes.map(({ start, duration }) => start + duration));
    const length = Math.ceil((end + TAIL_SECONDS) * SAMPLE_RATE);
    const left = new Float32Array(length);
    const right = new Float32Array(length);

    // Each layer renders a block on its own, then it's added in
    const blockLeft = new Float32Array(BLOCK);
    const blockRight = new Float32Array(BLOCK);
    let next = 0;
    let reported = 0;
    for (let position = 0; position < length; position += BLOCK) {
        while (next < events.length && events[next]!.sample <= position) {
            const { layer, on, channel, pitch, velocity: noteVelocity } = events[next++]!;
            const { processor } = layers[layer]!;
            if (on) processor.noteOn(channel, pitch, noteVelocity);
            else processor.noteOff(channel, pitch);
        }
        const size = Math.min(BLOCK, length - position);
        for (const { processor } of layers) {
            blockLeft.fill(0);
            blockRight.fill(0);
            processor.process(blockLeft, blockRight, 0, size);
            for (let i = 0; i < size; i++) {
                left[position + i]! += blockLeft[i]!;
                right[position + i]! += blockRight[i]!;
            }
        }

        // Every few percent, so the messages don't outnumber the work
        if (position - reported > length / 50) {
            reported = position;
            onProgress(position / length);
        }
    }
    layers.forEach(({ processor }) => processor.destroySynthProcessor());
    return { left, right, sampleRate: SAMPLE_RATE };
}
