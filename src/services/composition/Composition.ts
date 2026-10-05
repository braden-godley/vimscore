/**
 * A composition is the top-level data structure. It has the following attributes:
 * - Title
 * - Instruments
 * - Soundfont
 */

import { Instrument } from "../instrument/Instrument";
import { Soundfont } from "../soundfont/Soundfont";

export interface Composition {
    title: string;
    instruments: Instrument[];
    soundfont: Soundfont;
}
