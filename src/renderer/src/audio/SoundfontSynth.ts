/**
 * Plays through a soundfont (SF2, SF3 or DLS) with spessasynth, which runs in an AudioWorklet.
 * Several soundfonts each get one of these; see `SoundfontLayers`.
 * Each part plays on a MIDI channel of its own; see `channelFor`.
 */

import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import { Instrument } from '../../../services/instrument/Instrument';
import { Synth } from '../../../services/synth/Synth';
import { DEFAULT_VOLUME } from '../../../services/measure/Measure';
import {
    AUDITION_CHANNEL,
    BANK_SELECT,
    CHANNEL_VOLUME,
    channelFor,
    channelVolume,
    velocity,
} from '../../../services/synth/channels';

/** Our own listeners' id on the synth's events */
const LISTENER = 'vimscore-soundfont';

let workletAdded: Promise<void> | undefined;

export class SoundfontSynth implements Synth {
    private instruments: Instrument[] = [];
    private mix: number[] = [];

    private constructor(private readonly synth: WorkletSynthesizer) {}

    /** Starts a synth's worklet; it's silent until a soundfont is loaded */
    static async create(ctx: AudioContext): Promise<SoundfontSynth> {
        // The processor's code is added once, for every synth
        workletAdded ??= ctx.audioWorklet.addModule(processorUrl);
        await workletAdded;
        const synth = new WorkletSynthesizer(ctx);
        synth.connect(ctx.destination);
        await synth.isReady;
        return new SoundfontSynth(synth);
    }

    /**
     * Loads the soundfont, returning the instruments it has. A file that isn't one is an error
     * rather than a wait forever.
     */
    async load(data: ArrayBuffer): Promise<Instrument[]> {
        const events = this.synth.eventHandler;
        await new Promise<void>((resolve, reject) => {
            events.addEvent('soundBankError', LISTENER, (error) => reject(error instanceof Error ? error : new Error(String(error))));
            this.synth.soundBankManager.addSoundBank(data, 'main').then(resolve);
        }).finally(() => events.removeEvent('soundBankError', LISTENER));
        // The channels look their presets up again in the new soundfont
        this.setInstruments(this.instruments);
        return this.synth.presetList
            .map(({ name, program, bankMSB, isDrum }) => ({ name, program, bank: bankMSB, drums: isDrum }))
            .sort((a, b) => Number(a.drums) - Number(b.drums) || a.bank - b.bank || a.program - b.program);
    }

    /** Stops its worklet for good */
    destroy() {
        this.synth.stopAll(true);
        this.synth.disconnect();
        this.synth.destroy();
    }

    setInstruments(instruments: Instrument[]) {
        this.instruments = instruments;
        instruments.forEach((instrument, part) => this.select(channelFor(part), instrument));
        this.setMix(this.mix);
    }

    setMix(mix: number[]) {
        this.mix = mix;
        mix.forEach((level, part) => this.synth.controllerChange(channelFor(part), CHANNEL_VOLUME, channelVolume(level)));
    }

    playNote(part: number, pitch: number, when: number, duration: number, volume: number) {
        // Velocity 0 would be read as the note ending
        if (velocity(volume) === 0) return;
        const channel = channelFor(part);
        this.synth.noteOn(channel, pitch, velocity(volume), { time: when });
        this.synth.noteOff(channel, pitch, { time: when + duration });
    }

    audition(instrument: Instrument, pitch: number, duration: number) {
        this.select(AUDITION_CHANNEL, instrument);
        const now = this.synth.context.currentTime;
        this.synth.noteOn(AUDITION_CHANNEL, pitch, velocity(DEFAULT_VOLUME / 100), { time: now });
        this.synth.noteOff(AUDITION_CHANNEL, pitch, { time: now + duration });
    }

    stopAll() {
        this.synth.stopAll(true);
    }

    private select(channel: number, { program, bank, drums }: Instrument) {
        this.synth.midiChannels[channel]?.setDrums(drums);
        this.synth.controllerChange(channel, BANK_SELECT, bank);
        this.synth.programChange(channel, program);
    }
}
