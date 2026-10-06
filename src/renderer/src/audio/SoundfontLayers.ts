/**
 * Plays through several soundfonts, each in a synth of its own, so a part can play any one's
 * sound even where two have the same bank and program. Each part plays through the soundfont it
 * chose, or the first in the list with its bank and program; see `soundfontFor`.
 */

import { Instrument } from '../../../services/instrument/Instrument';
import { LoadedSoundfont, allInstruments, soundfontFor, soundfontName } from '../../../services/soundfont/Soundfont';
import { Synth } from '../../../services/synth/Synth';
import { SoundfontSynth } from './SoundfontSynth';

/** A soundfont that couldn't be read, or isn't one */
export interface SoundfontFailure {
    path: string;
    message: string;
}

interface Layer extends LoadedSoundfont {
    synth: SoundfontSynth;
}

export class SoundfontLayers implements Synth {
    /** In priority order */
    private layers: Layer[] = [];
    private instruments: Instrument[] = [];
    private mix: number[] = [];
    /** The layer each part plays through */
    private playing: (Layer | undefined)[] = [];

    constructor(private readonly ctx: AudioContext) {}

    /**
     * Plays through these soundfonts, first taking precedence, reading the ones that aren't
     * loaded already with `read`. Returns every instrument in them, each marked with its
     * soundfont, and the soundfonts that couldn't be loaded, which are left out. If one of
     * `required` fails, the soundfonts stay as they were and it throws instead.
     */
    async load(
        paths: string[],
        read: (path: string) => Promise<ArrayBuffer>,
        { required = [] as string[] } = {},
    ): Promise<{ instruments: Instrument[]; failed: SoundfontFailure[] }> {
        const added: Layer[] = [];
        const failed: SoundfontFailure[] = [];
        for (const path of paths.filter((path) => !this.layers.some((layer) => layer.path === path))) {
            let synth: SoundfontSynth | undefined;
            try {
                synth = await SoundfontSynth.create(this.ctx);
                const instruments = await synth.load(await read(path));
                added.push({ path, instruments, synth });
            } catch (error) {
                synth?.destroy();
                failed.push({ path, message: (error as Error).message });
            }
        }
        const blocking = failed.find(({ path }) => required.includes(path));
        if (blocking) {
            added.forEach(({ synth }) => synth.destroy());
            throw new Error(`"${soundfontName(blocking.path)}": ${blocking.message}`);
        }

        const available = [...this.layers, ...added];
        this.layers.filter(({ path }) => !paths.includes(path)).forEach(({ synth }) => synth.destroy());
        this.layers = paths.flatMap((path) => available.filter((layer) => layer.path === path));
        this.setInstruments(this.instruments);
        return { instruments: allInstruments(this.layers), failed };
    }

    setInstruments(instruments: Instrument[]) {
        this.instruments = instruments;
        const playing = instruments.map((instrument) => soundfontFor(instrument, this.layers));
        // A part moving to another soundfont stops ringing in the old one
        this.playing.forEach((layer, part) => {
            if (layer && layer !== playing[part]) layer.synth.stopAll();
        });
        this.playing = playing;
        // Every synth knows every part's instrument; only the part's own synth gets its notes
        this.layers.forEach(({ synth }) => {
            synth.setInstruments(instruments);
            synth.setMix(this.mix);
        });
    }

    setMix(mix: number[]) {
        this.mix = mix;
        this.layers.forEach(({ synth }) => synth.setMix(mix));
    }

    playNote(part: number, pitch: number, when: number, duration: number, volume: number) {
        this.playing[part]?.synth.playNote(part, pitch, when, duration, volume);
    }

    audition(instrument: Instrument, pitch: number, duration: number) {
        soundfontFor(instrument, this.layers)?.synth.audition(instrument, pitch, duration);
    }

    stopAll() {
        this.layers.forEach(({ synth }) => synth.stopAll());
    }
}
