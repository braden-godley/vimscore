import { Instrument } from '../instrument/Instrument';
import { DEFAULT_VOLUME } from '../measure/Measure';
import { Synth } from './Synth';

/** Short fades on each note so the oscillator doesn't click when it starts and stops */
const ATTACK_SECONDS = 0.005;
const RELEASE_SECONDS = 0.03;

/** Pitch is a MIDI note number, where 69 is A4 */
function pitchToFrequency(pitch: number): number {
    return 440 * 2 ** ((pitch - 69) / 12);
}

/**
 * Plays every note as a plain triangle wave, whatever the instrument: what plays until a
 * soundfont is loaded.
 */
export class ToneSynth implements Synth {
    private output: GainNode;
    private voices = new Set<OscillatorNode>();
    private mix: number[] = [];

    constructor(private ctx: AudioContext) {
        this.output = ctx.createGain();
        this.output.gain.value = 0.2;
        this.output.connect(ctx.destination);
    }

    setInstruments(_instruments: Instrument[]) {}

    setMix(mix: number[]) {
        this.mix = mix;
    }

    audition(_instrument: Instrument, pitch: number, duration: number) {
        this.tone(pitch, this.ctx.currentTime, duration, DEFAULT_VOLUME / 100);
    }

    playNote(part: number, pitch: number, when: number, duration: number, volume: number) {
        // Squared, as a soundfont's channel volume is
        this.tone(pitch, when, duration, volume * (this.mix[part] ?? 1) ** 2);
    }

    private tone(pitch: number, when: number, duration: number, volume: number) {
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = pitchToFrequency(pitch);

        const envelope = this.ctx.createGain();
        const releaseAt = Math.max(when + ATTACK_SECONDS, when + duration - RELEASE_SECONDS);
        envelope.gain.setValueAtTime(0, when);
        // As loud as it's always been at the default volume
        const level = volume / (DEFAULT_VOLUME / 100);
        envelope.gain.linearRampToValueAtTime(level, when + ATTACK_SECONDS);
        envelope.gain.setValueAtTime(level, releaseAt);
        envelope.gain.linearRampToValueAtTime(0, releaseAt + RELEASE_SECONDS);

        osc.connect(envelope).connect(this.output);
        osc.start(when);
        osc.stop(releaseAt + RELEASE_SECONDS);

        this.voices.add(osc);
        osc.onended = () => {
            this.voices.delete(osc);
            envelope.disconnect();
        };
    }

    stopAll() {
        for (const osc of this.voices) osc.stop();
        this.voices.clear();
    }
}
