/**
 * The synth the player plays through, which can be swapped: the simple tone until a soundfont
 * loads, then the soundfont. It remembers the instruments so the new synth starts with them.
 */

import { Instrument } from '../../../services/instrument/Instrument';
import { Synth } from '../../../services/synth/Synth';

export class SwitchableSynth implements Synth {
    private instruments: Instrument[] = [];

    constructor(private current: Synth) {}

    use(synth: Synth) {
        if (synth === this.current) return;
        this.current.stopAll();
        this.current = synth;
        synth.setInstruments(this.instruments);
    }

    setInstruments(instruments: Instrument[]) {
        this.instruments = instruments;
        this.current.setInstruments(instruments);
    }

    playNote(part: number, pitch: number, when: number, duration: number, volume: number) {
        this.current.playNote(part, pitch, when, duration, volume);
    }

    audition(instrument: Instrument, pitch: number, duration: number) {
        this.current.audition(instrument, pitch, duration);
    }

    stopAll() {
        this.current.stopAll();
    }
}
