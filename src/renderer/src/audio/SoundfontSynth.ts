/**
 * Plays through a soundfont (SF2, SF3 or DLS) with spessasynth, which runs in an AudioWorklet.
 * Each part plays on a MIDI channel of its own; see `channelFor`.
 */

import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import { Instrument } from '../../../services/instrument/Instrument';
import { Synth } from '../../../services/synth/Synth';
import { DEFAULT_VOLUME } from '../../../services/measure/Measure';
import { AUDITION_CHANNEL, BANK_SELECT, channelFor, velocity } from '../../../services/synth/channels';

export class SoundfontSynth implements Synth {
    private instruments: Instrument[] = [];

    private constructor(private readonly synth: WorkletSynthesizer) {}

    /** Starts the synth's worklet; it's silent until a soundfont is loaded */
    static async create(ctx: AudioContext): Promise<SoundfontSynth> {
        await ctx.audioWorklet.addModule(processorUrl);
        const synth = new WorkletSynthesizer(ctx);
        synth.connect(ctx.destination);
        await synth.isReady;
        return new SoundfontSynth(synth);
    }

    /** Replaces the soundfont, returning the instruments it has */
    async load(data: ArrayBuffer): Promise<Instrument[]> {
        await this.synth.soundBankManager.addSoundBank(data, 'main');
        await this.synth.isReady;
        // The channels look their presets up again in the new soundfont
        this.setInstruments(this.instruments);
        return this.synth.presetList
            .map(({ name, program, bankMSB, isDrum }) => ({ name, program, bank: bankMSB, drums: isDrum }))
            .sort((a, b) => Number(a.drums) - Number(b.drums) || a.bank - b.bank || a.program - b.program);
    }

    setInstruments(instruments: Instrument[]) {
        this.instruments = instruments;
        instruments.forEach((instrument, part) => this.select(channelFor(part), instrument));
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
