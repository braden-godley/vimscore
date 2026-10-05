/**
 * An instrument describes an individual part of a composition
 */

import { Measure } from "../measure/Measure";

export interface Instrument {
    sound: number;
    measures: Measure[];
}
