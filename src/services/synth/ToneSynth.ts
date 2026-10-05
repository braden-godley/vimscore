import { Synth } from './Synth';

/** Short fades on each note so the oscillator doesn't click when it starts and stops */
const ATTACK_SECONDS = 0.005;
const RELEASE_SECONDS = 0.03;

/** Pitch is a MIDI note number, where 69 is A4 */
function pitchToFrequency(pitch: number): number {
    return 440 * 2 ** ((pitch - 69) / 12);
}

/**
 * Plays every note as a plain triangle wave. A stand-in until soundfont playback exists.
 */
export class ToneSynth implements Synth {
    private output: GainNode;
    private voices = new Set<OscillatorNode>();

    constructor(private ctx: AudioContext) {
        this.output = ctx.createGain();
        this.output.gain.value = 0.2;
        this.output.connect(ctx.destination);
    }

    playNote(pitch: number, when: number, duration: number) {
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = pitchToFrequency(pitch);

        const envelope = this.ctx.createGain();
        const releaseAt = Math.max(when + ATTACK_SECONDS, when + duration - RELEASE_SECONDS);
        envelope.gain.setValueAtTime(0, when);
        envelope.gain.linearRampToValueAtTime(1, when + ATTACK_SECONDS);
        envelope.gain.setValueAtTime(1, releaseAt);
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
