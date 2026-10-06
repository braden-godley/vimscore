import { Pitch } from '../pitch/Pitch';

export interface Note {
    /** As written, so A♯ and B♭ stay apart; `midi` gives the pitch it sounds */
    pitch: Pitch;

    /** Tied to the same pitch in the next chord of the same voice, so they sound as one note */
    tie?: boolean;

    /** Played for half its length, or three quarters along with tenuto */
    staccato?: boolean;

    /** Held its full length, where a plain note is let go just short; with staccato, three quarters */
    tenuto?: boolean;

    /** Struck louder. A note has an accent or a marcato, not both */
    accent?: boolean;

    /** Struck louder than an accent, and let go a little early unless tenuto */
    marcato?: boolean;

    /** Slides up or down to a note of the next chord in the same voice; see `glissandoTarget` */
    glissando?: boolean;
}

/** The marks over or under a chord that change how its notes are played, nearest the note first */
export const ARTICULATIONS = ['staccato', 'tenuto', 'accent', 'marcato'] as const;

export type Articulation = (typeof ARTICULATIONS)[number];

type Articulated = Partial<Record<Articulation, boolean>>;

/** Accents and marcatos replace each other, since a note is struck one way */
const EXCLUSIVE: Partial<Record<Articulation, Articulation>> = { accent: 'marcato', marcato: 'accent' };

/** Articulations that go with the attack, so a note split into tied pieces keeps them on the first */
const ATTACKS: readonly Articulation[] = ['accent', 'marcato'];

/**
 * One of the tied pieces a note is split into. The last keeps the note's own tie onward, its
 * staccato, tenuto and glissando; an accent or marcato is on the attack, so stays with the first.
 */
export function notePiece(note: Note, first: boolean, last: boolean): Note {
    if (first && last) return note;
    const attack = first ? articulationsOf(note, ATTACKS) : {};
    if (!last) return { pitch: note.pitch, tie: true, ...attack };
    return { ...withoutArticulations(note), ...articulationsOf(note, ['staccato', 'tenuto']) };
}

/** Puts an articulation on, or takes it off, clearing one it can't go with */
export function withArticulation<T extends Articulated>(target: T, articulation: Articulation, on: boolean): T {
    const { [articulation]: _, ...rest } = target;
    if (!on) return rest as T;
    const other = EXCLUSIVE[articulation];
    if (other) delete (rest as Articulated)[other];
    return { ...rest, [articulation]: true } as T;
}

/** Takes off every articulation */
export function withoutArticulations<T extends Articulated>(target: T): T {
    const rest = { ...target };
    for (const articulation of ARTICULATIONS) delete rest[articulation];
    return rest;
}

/** Whether two notes (or a note and a phantom) have the same articulations */
export function sameArticulations(a: Articulated, b: Articulated): boolean {
    return ARTICULATIONS.every((articulation) => !!a[articulation] === !!b[articulation]);
}

/** Just the articulations a note has, to copy onto another */
export function articulationsOf(note: Articulated, only: readonly Articulation[] = ARTICULATIONS): Articulated {
    const picked: Articulated = {};
    for (const articulation of only) if (note[articulation]) picked[articulation] = true;
    return picked;
}
