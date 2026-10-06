/** For tests: a voice's events in a short form that's easy to read in an expectation */

import { Composition } from '../composition/Composition';
import { Duration } from '../duration/Duration';
import { Event } from '../event/Event';
import { midi } from '../pitch/Pitch';

const VALUE_NAMES: Partial<Record<Duration['base'], string>> = { 1: 'w', 2: 'h', 4: 'q' };

/** `60,64/q` for a chord, `72~/8` tied, `72!/8` staccato, `60>/q` sliding on, `arp:60,64/q` rolled, `60/q(` slurred on, `r/h.` for a rest, tuplets in brackets */
export function written(composition: Composition, part: number, measure: number): string {
    const value = ({ base, dots }: Duration) => `${VALUE_NAMES[base] ?? base}${'.'.repeat(dots)}`;
    const show = (events: Event[]): string =>
        events
            .map((event) => {
                if (event.kind === 'tuplet') return `[${show(event.events)}]`;
                if (event.kind === 'rest') return `r/${value(event.duration)}`;
                const notes = event.notes.map((n) => `${midi(n.pitch)}${n.tie ? '~' : ''}${n.staccato ? '!' : ''}${n.glissando ? '>' : ''}`);
                return `${event.arpeggio ? 'arp:' : ''}${notes.join(',')}/${value(event.duration)}${event.slur ? '(' : ''}`;
            })
            .join(' ');
    return show(composition.parts[part]!.measures[measure]!.voices[0]!.events);
}
