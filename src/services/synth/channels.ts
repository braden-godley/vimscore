/**
 * Which MIDI channel each part plays on, the same for live playback and exports: every part
 * gets its own, skipping channel 10 (index 9), which General MIDI keeps for drums, and one kept
 * back for auditioning instruments.
 */

export const AUDITION_CHANNEL = 15;

/** Channels for parts: all but drums and the audition channel. More parts than this share */
const PART_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14];

export const channelFor = (part: number) => PART_CHANNELS[part % PART_CHANNELS.length]!;

/** MIDI controller 0, which picks the soundfont bank for the next program change */
export const BANK_SELECT = 0;

/** MIDI velocity for a volume from 0 to 1; 0 means the note isn't played */
export const velocity = (volume: number) => Math.round(Math.max(0, Math.min(1, volume)) * 127);
