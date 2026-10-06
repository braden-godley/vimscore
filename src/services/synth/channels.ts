/**
 * Which channel each part plays on through a soundfont, live and in audio exports: every part
 * gets its own, skipping channel 10 (index 9), which General MIDI keeps for drums, and one kept
 * back for auditioning instruments. Past 16 channels the synth adds more, in blocks of 16 laid
 * out like the first, so no two parts ever share one.
 */

export const AUDITION_CHANNEL = 15;

/** Channels for parts in each block of 16: all but drums and the audition channel */
const PART_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14];

export const channelFor = (part: number) =>
    Math.floor(part / PART_CHANNELS.length) * 16 + PART_CHANNELS[part % PART_CHANNELS.length]!;

/** MIDI controller 0, which picks the soundfont bank for the next program change */
export const BANK_SELECT = 0;

/** MIDI velocity for a volume from 0 to 1; 0 means the note isn't played */
export const velocity = (volume: number) => Math.round(Math.max(0, Math.min(1, volume)) * 127);

/** MIDI controller 7, a channel's volume, which the mixer sets */
export const CHANNEL_VOLUME = 7;

/** The channel volume for a part's mix, where 1 is MIDI's usual 100 */
export const channelVolume = (mix: number) => Math.round(Math.max(0, Math.min(127, mix * 100)));
