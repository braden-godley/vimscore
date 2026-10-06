import { describe, expect, it } from 'vitest';
import { AUDITION_CHANNEL, channelFor } from './channels';

describe('channelFor', () => {
    it('gives every part its own channel, past 16, never the drum or audition channel', () => {
        const channels = Array.from({ length: 40 }, (_, part) => channelFor(part));
        expect(new Set(channels).size).toBe(channels.length);
        expect(channels.some((channel) => channel % 16 === 9 || channel % 16 === AUDITION_CHANNEL)).toBe(false);
        // The 15th and 16th parts once shared the first two parts' channels, and their instruments
        expect([channelFor(14), channelFor(15)]).toEqual([16, 17]);
    });
});
