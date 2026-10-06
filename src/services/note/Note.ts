import { Pitch } from '../pitch/Pitch';

export interface Note {
    /** As written, so A♯ and B♭ stay apart; `midi` gives the pitch it sounds */
    pitch: Pitch;

    /** Tied to the same pitch in the next chord of the same voice, so they sound as one note */
    tie?: boolean;

    staccato?: boolean;
}
