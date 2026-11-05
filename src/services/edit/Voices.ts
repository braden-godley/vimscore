/**
 * A staff's voices: up to four independent lines of chords and rests in each measure, which
 * insert mode writes into one at a time.
 */

import { Composition } from '../composition/Composition';
import { voiceLeaves } from '../cursor/Cursor';
import { Duration, restsFilling } from '../duration/Duration';
import { Event, leaves } from '../event/Event';
import { Fraction, ZERO, sub } from '../fraction/Fraction';
import { PartMeasure, Voice, resolveMeasures } from '../measure/Measure';

/** Voices are numbered 1 to 4 on screen, 0 to 3 here */
export const MAX_VOICES = 4;

/** Names a voice of one part in one measure */
export interface VoicePlace {
    part: number;
    measure: number;
    voice: number;
}

const rests = (durations: Duration[]): Event[] => durations.map((duration) => ({ kind: 'rest', duration }));

/** Rests across a measure, with one starting at `offset` so there's something to write over there */
function restsSplitAt(length: Fraction, offset: Fraction): Event[] {
    try {
        return rests([...restsFilling(ZERO, offset), ...restsFilling(offset, sub(length, offset))]);
    } catch {
        // A time inside a tuplet can't be reached with plain rests
        return rests(restsFilling(ZERO, length));
    }
}

/** Swaps in new voices for one part's measure */
function withVoices(composition: Composition, part: number, measure: number, voices: Voice[]): Composition {
    const edit = (m: PartMeasure, mi: number) => (mi === measure ? { ...m, voices } : m);
    return {
        ...composition,
        parts: composition.parts.map((p, pi) => (pi === part ? { ...p, measures: p.measures.map(edit) } : p)),
    };
}

/**
 * Gives a part's measure a voice to write into, filled with rests, along with any voice before
 * it that's missing or empty. `added` lists the voices that got rests.
 */
export function withVoice(
    composition: Composition,
    { part, measure, voice }: VoicePlace,
    offset: Fraction,
): { composition: Composition; added: number[] } {
    const partMeasure = composition.parts[part]?.measures[measure];
    const length = resolveMeasures(composition.measures)[measure]?.length;
    if (!partMeasure || !length || voice >= MAX_VOICES || voiceLeaves(composition, part, measure, voice).length > 0) {
        return { composition, added: [] };
    }

    const added: number[] = [];
    const voices = Array.from({ length: Math.max(partMeasure.voices.length, voice + 1) }, (_, v) => {
        const existing = partMeasure.voices[v];
        if (v > voice || (existing && existing.events.length > 0)) return existing ?? { events: [] };
        added.push(v);
        return { events: restsSplitAt(length, v === voice ? offset : ZERO) };
    });
    return { composition: withVoices(composition, part, measure, voices), added };
}

const onlyRests = (events: Event[]) => [...leaves(events)].every(({ event }) => event.kind === 'rest');

/**
 * Takes off the voices of a part's measure past `keep` that hold nothing but rests, from the
 * last one back, so the voices left keep their numbers. Only voices `removable` allows go, and
 * never the first.
 */
export function withoutRestVoices(
    composition: Composition,
    part: number,
    measure: number,
    keep: number,
    removable: (voice: number) => boolean,
): Composition {
    const voices = composition.parts[part]?.measures[measure]?.voices;
    if (!voices) return composition;
    let count = voices.length;
    while (count > Math.max(1, keep + 1) && removable(count - 1) && onlyRests(voices[count - 1]!.events)) count--;
    return count === voices.length ? composition : withVoices(composition, part, measure, voices.slice(0, count));
}
