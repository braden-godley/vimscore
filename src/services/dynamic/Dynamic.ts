/**
 * Dynamics: how hard a part's notes are played, from ppp to ff. Each is a MIDI velocity, evenly
 * spaced from ppp at 10 up to ff at 127, the loudest a note can be struck.
 */

export const DYNAMICS = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff'] as const;
export type Dynamic = (typeof DYNAMICS)[number];

/** How a part plays before its first dynamic marking */
export const DEFAULT_DYNAMIC: Dynamic = 'mf';

export const SOFTEST_VELOCITY = 10;
export const LOUDEST_VELOCITY = 127;

/** The velocity between one dynamic and the next */
export const DYNAMIC_STEP = (LOUDEST_VELOCITY - SOFTEST_VELOCITY) / (DYNAMICS.length - 1);

export const isDynamic = (text: string): text is Dynamic => (DYNAMICS as readonly string[]).includes(text);

/** The velocity a dynamic strikes notes at: 10 30 49 69 88 108 127 */
export const dynamicVelocity = (dynamic: Dynamic) =>
    Math.round(SOFTEST_VELOCITY + DYNAMICS.indexOf(dynamic) * DYNAMIC_STEP);

/** The dynamic `steps` louder, or softer for a negative count, stopping at ppp and ff */
export function stepDynamic(dynamic: Dynamic, steps: number): Dynamic {
    const index = Math.max(0, Math.min(DYNAMICS.length - 1, DYNAMICS.indexOf(dynamic) + steps));
    return DYNAMICS[index]!;
}

/** The dynamic closest to a velocity, for files and imports that have only a number */
export function nearestDynamic(velocity: number): Dynamic {
    const index = Math.round((velocity - SOFTEST_VELOCITY) / DYNAMIC_STEP);
    return DYNAMICS[Math.max(0, Math.min(DYNAMICS.length - 1, index))]!;
}
