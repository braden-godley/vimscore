/**
 * A part is one instrument's line through the whole composition
 */

import type { Clef } from '../clef/Clef';
import { PartMeasure } from '../measure/Measure';

export type { Clef };

export interface Part {
    name: string;
    /** The clef it starts in, treble when not set; measures can change it */
    clef?: Clef;
    /** Soundfont preset number, 0 to 127 */
    program: number;
    /** The soundfont bank the program is in, when it's not the standard bank 0 */
    bank?: number;
    /** Plays a drum kit, where each pitch is a different drum */
    drums?: boolean;
    /** The soundfont, by path, the sound was chosen from; see `Instrument.soundfont` */
    soundfont?: string;
    /** The mixer's volume for the whole part, in percent of normal (0 to 127); 100 when not set */
    volume?: number;
    /** Silenced in the mixer, whatever its volume */
    muted?: boolean;
    /** Soloed in the mixer: while any part is, only soloed parts are heard */
    solo?: boolean;
    /** Always the same length as the composition's measures */
    measures: PartMeasure[];
}
