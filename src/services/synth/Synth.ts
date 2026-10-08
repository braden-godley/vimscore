/**
 * A synth turns scheduled notes into sound. Times are on the AudioContext clock, in seconds.
 */

import { Instrument } from '../instrument/Instrument';

export interface Synth {
    /** Which instrument each part plays, by part index */
    setInstruments(instruments: Instrument[]): void;
    /** How loud each part plays from the mixer, by part index: 1 is normal */
    setMix(mix: number[]): void;
    /** `velocity` is MIDI's, 1 to 127 */
    playNote(part: number, pitch: number, when: number, duration: number, velocity: number): void;
    /** Plays a pitch right away on any instrument, for trying instruments out */
    audition(instrument: Instrument, pitch: number, duration: number): void;
    stopAll(): void;
}
