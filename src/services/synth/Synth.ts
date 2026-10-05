/**
 * A synth turns scheduled notes into sound. Times are on the AudioContext clock, in seconds.
 */

export interface Synth {
    playNote(pitch: number, when: number, duration: number): void;
    stopAll(): void;
}
