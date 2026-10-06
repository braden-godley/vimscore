import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { Composition } from '../composition/Composition';
import { Event, eventsLength, leaves } from '../event/Event';
import { midi, pitchName } from '../pitch/Pitch';
import { compare } from '../fraction/Fraction';
import { resolveMeasures } from '../measure/Measure';
import { timeline } from '../timeline/timeline';
import { readMuseScore } from './MuseScore';

/** A MuseScore 3 file around some staves and measures, with a piano part of two staves */
function mscx(staves: string, parts = PIANO_PART) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="3.02">
  <Score>
    <Division>480</Division>
    <metaTag name="workTitle">Little Piece</metaTag>
    ${parts}
    ${staves}
  </Score>
</museScore>`;
}

const PIANO_PART = `
    <Part>
      <Staff id="1"><StaffType group="pitched"><name>stdNormal</name></StaffType></Staff>
      <Staff id="2"><StaffType group="pitched"><name>stdNormal</name></StaffType><defaultClef>F</defaultClef></Staff>
      <trackName>Piano</trackName>
      <Instrument><longName>Piano</longName><clef staff="2">F</clef><Channel><program value="0"/></Channel></Instrument>
    </Part>`;

const read = (xml: string) => readMuseScore(strToU8(xml)) as Composition;

/** A voice's events as `60,64/q`, `r/8`, `[...]` for tuplets, `~` for ties and `!` for staccato */
function show(events: Event[]): string {
    return events
        .map((event) => {
            if (event.kind === 'tuplet') return `[${event.actual}:${event.normal} ${show(event.events)}]`;
            const value = `${event.duration.base}${'.'.repeat(event.duration.dots)}`;
            if (event.kind === 'rest') return `r/${value}`;
            return `${event.notes.map((n) => `${midi(n.pitch)}${n.tie ? '~' : ''}${n.staccato ? '!' : ''}`).join(',')}/${value}`;
        })
        .join(' ');
}

const voice = (composition: Composition, part: number, measure: number, v = 0) =>
    show(composition.parts[part]!.measures[measure]!.voices[v]!.events);

describe('readMuseScore', () => {
    const score = read(
        mscx(`
    <Staff id="1">
      <Measure>
        <voice>
          <KeySig><accidental>-1</accidental></KeySig>
          <TimeSig><sigN>3</sigN><sigD>4</sigD></TimeSig>
          <Tempo><tempo>1.5</tempo><text>Andante</text></Tempo>
          <Dynamic><subtype>p</subtype><velocity>49</velocity></Dynamic>
          <Chord><dots>1</dots><durationType>quarter</durationType>
            <Note><Spanner type="Tie"><Tie/><next><location><fractions>3/8</fractions></location></next></Spanner><pitch>65</pitch><tpc>13</tpc></Note>
          </Chord>
          <Chord><durationType>eighth</durationType><Note><pitch>65</pitch><tpc>13</tpc></Note></Chord>
          <Chord><durationType>eighth</durationType><acciaccatura/><Note><pitch>67</pitch></Note></Chord>
          <Tuplet><normalNotes>2</normalNotes><actualNotes>3</actualNotes><baseNote>eighth</baseNote></Tuplet>
          <Chord><durationType>eighth</durationType><Articulation><subtype>articStaccatoAbove</subtype></Articulation><Note><pitch>69</pitch></Note><Note><pitch>72</pitch></Note></Chord>
          <Rest><durationType>eighth</durationType></Rest>
          <Chord><durationType>eighth</durationType><Note><pitch>70</pitch><tpc>24</tpc></Note></Chord>
          <endTuplet/>
        </voice>
        <voice>
          <location><fractions>1/4</fractions></location>
          <Chord><durationType>quarter</durationType><Note><pitch>60</pitch></Note></Chord>
        </voice>
      </Measure>
      <Measure>
        <voice>
          <Dynamic><subtype>f</subtype><velocity>96</velocity></Dynamic>
          <Rest><durationType>measure</durationType><duration>3/4</duration></Rest>
        </voice>
      </Measure>
    </Staff>
    <Staff id="2">
      <Measure>
        <voice><Chord><dots>1</dots><durationType>half</durationType><Note><pitch>41</pitch></Note></Chord></voice>
      </Measure>
      <Measure>
        <voice><Rest><durationType>measure</durationType><duration>3/4</duration></Rest></voice>
      </Measure>
    </Staff>`),
    );

    it('reads the title, and a part of two staves as two parts', () => {
        expect(score.title).toBe('Little Piece');
        expect(score.parts.map(({ name, clef, program }) => [name, clef, program])).toEqual([
            ['Acoustic Grand Piano', 'treble', 0],
            ['Acoustic Grand Piano', 'bass', 0],
        ]);
    });

    it('reads time and key signatures and tempo, marking only changes', () => {
        expect(score.measures).toEqual([
            { timeSignature: { beats: 3, beatValue: 4 }, keySignature: { fifths: -1 }, tempo: { bpm: 90, beat: { base: 4, dots: 0 } } },
            {},
        ]);
    });

    it('reads notes, ties, tuplets and staccato, skipping grace notes', () => {
        expect(voice(score, 0, 0)).toBe('65~/4. 65/8 [3:2 69!,72!/8 r/8 70/8]');
        expect(voice(score, 1, 0)).toBe('41/2.');
    });

    it('keeps MuseScore’s spelling of each note', () => {
        const spelled = (m: number, leaf: number) => {
            const event = [...leaves(score.parts[0]!.measures[m]!.voices[0]!.events)][leaf]!.event;
            return event.kind === 'chord' ? event.notes.map(({ pitch }) => pitchName(pitch)) : [];
        };
        expect(spelled(0, 0)).toEqual(['F4']);
        // A♯, not the B♭ the key would suggest, because that's how it was written
        expect(spelled(0, 4)).toEqual(['A#4']);
        // Without a spelling, a white key is natural
        expect(spelled(0, 2)).toEqual(['A4', 'C5']);
    });

    it('fills the gaps voices leave with rests', () => {
        expect(voice(score, 0, 0, 1)).toBe('r/4 60/4 r/4');
    });

    it('reads dynamics as volume markings', () => {
        expect(score.parts[0]!.measures[0]!.volumes).toEqual([{ offset: { num: 0, den: 1 }, percent: 39 }]);
        expect(score.parts[0]!.measures[1]!.volumes?.[0]?.percent).toBe(76);
        expect(voice(score, 0, 1)).toBe('r/2.');
    });

    it('reads hairpins and cresc. lines, with how long they last, into later measures', () => {
        const hairpin = (subtype: number, end: string) =>
            `<Spanner type="HairPin"><HairPin><subtype>${subtype}</subtype></HairPin><next><location>${end}</location></next></Spanner>`;
        const end = (back: string) => `<Spanner type="HairPin"><prev><location>${back}</location></prev></Spanner>`;
        const quarter = (pitch: number) => `<Chord><durationType>quarter</durationType><Note><pitch>${pitch}</pitch></Note></Chord>`;
        const marked = read(
            mscx(`<Staff id="1">
              <Measure><voice>
                <Dynamic><subtype>p</subtype><velocity>49</velocity></Dynamic>
                ${quarter(60)}${hairpin(0, '<measures>1</measures><fractions>-1/4</fractions>')}${quarter(62)}${quarter(64)}${quarter(65)}
              </voice></Measure>
              <Measure><voice>
                ${end('<measures>-1</measures><fractions>1/4</fractions>')}<Dynamic><subtype>f</subtype><velocity>96</velocity></Dynamic>
                ${hairpin(1, '<fractions>1/2</fractions>')}${quarter(67)}${quarter(65)}${end('<fractions>-1/2</fractions>')}${quarter(64)}${hairpin(3, '<measures>4</measures>')}${quarter(62)}
              </voice></Measure>
            </Staff>`, '<Part><Staff id="1"/><Instrument><Channel><program value="0"/></Channel></Instrument></Part>'),
        );
        expect(marked.parts[0]!.measures[0]!.hairpins).toEqual([
            { offset: { num: 1, den: 4 }, length: { num: 3, den: 4 }, kind: 'crescendo' },
        ]);
        // The dim. line runs past the last measure, so stops at its end
        expect(marked.parts[0]!.measures[1]!.hairpins).toEqual([
            { offset: { num: 0, den: 1 }, length: { num: 1, den: 2 }, kind: 'diminuendo' },
            { offset: { num: 3, den: 4 }, length: { num: 1, den: 4 }, kind: 'diminuendo' },
        ]);
        // The crescendo swells from p to the f at its end
        const volumes = timeline(marked).map(({ volume }) => Math.round(volume * 100));
        expect(volumes.slice(0, 5)).toEqual([39, 39, 51, 64, 76]);
    });

    it('reads arpeggios, but not the bracket that says to play a chord together', () => {
        const chord = (arpeggio: string) =>
            `<Chord><durationType>half</durationType><Note><pitch>60</pitch></Note><Note><pitch>64</pitch></Note>${arpeggio}</Chord>`;
        const rolled = read(
            mscx(`<Staff id="1"><Measure><voice>
                ${chord('<Arpeggio><subtype>0</subtype></Arpeggio>')}
                ${chord('<Arpeggio><subtype>3</subtype></Arpeggio>')}
            </voice></Measure></Staff>`),
        );
        const [first, second] = rolled.parts[0]!.measures[0]!.voices[0]!.events;
        expect(first).toMatchObject({ arpeggio: true });
        expect(second).not.toHaveProperty('arpeggio');
    });

    it('reads the zipped form too', () => {
        const xml = mscx('<Staff id="1"><Measure><voice><Rest><durationType>measure</durationType><duration>4/4</duration></Rest></voice></Measure></Staff>');
        const zipped = zipSync({
            'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="a.mscx"/></rootfiles></container>'),
            'a.mscx': strToU8(xml),
        });
        expect(readMuseScore(zipped)).toMatchObject({ title: 'Little Piece', measures: [{ timeSignature: { beats: 4, beatValue: 4 } }] });
    });

    it('reads clefs written the later MuseScore 3 way', () => {
        const bass = read(
            mscx(
                '<Staff id="1"><Measure><voice><Rest><durationType>measure</durationType><duration>4/4</duration></Rest></voice></Measure></Staff>',
                `<Part><Staff id="1"><defaultConcertClef>F8vb</defaultConcertClef></Staff><trackName>Bass Line</trackName>
                   <Instrument><concertClef>F8vb</concertClef><Channel><program value="32"/></Channel></Instrument></Part>`,
            ),
        );
        expect(bass.parts[0]).toMatchObject({ name: 'Acoustic Bass', clef: 'bass', program: 32 });
    });

    it('reads repeat barlines', () => {
        const repeat = (inner: string) => `<Measure>${inner}<voice><Rest><durationType>measure</durationType><duration>4/4</duration></Rest></voice></Measure>`;
        const withRepeats = read(mscx(`<Staff id="1">${repeat('<startRepeat/>')}${repeat('<endRepeat>2</endRepeat>')}${repeat('')}</Staff>`));
        expect(withRepeats.measures.map(({ repeatStart, repeatEnd }) => [!!repeatStart, !!repeatEnd])).toEqual([
            [true, false],
            [false, true],
            [false, false],
        ]);
    });

    it('says what it cannot read', () => {
        expect(readMuseScore(strToU8('<museScore version="2.06"><Score/></museScore>'))).toEqual({
            error: "MuseScore 2.06 files aren't supported, only 3 and 4",
        });
        expect(readMuseScore(strToU8('<other/>'))).toEqual({ error: 'not a MuseScore file' });
        expect(readMuseScore(new Uint8Array([0x50, 0x4b, 1, 2]))).toEqual({
            error: "can't unzip it; is it a MuseScore file?",
        });
    });
});

/** The developer's own MuseScore files; elsewhere these skip */
const DOWNLOADS = '/Users/bgodley/Downloads';
const realFiles = existsSync(DOWNLOADS) ? readdirSync(DOWNLOADS).filter((name) => name.endsWith('.mscz')) : [];

describe.skipIf(realFiles.length === 0)('real MuseScore files', () => {
    it.each(realFiles)('%s reads into a consistent score', (name) => {
        const result = readMuseScore(new Uint8Array(readFileSync(`${DOWNLOADS}/${name}`)));
        expect(result).not.toHaveProperty('error');
        const composition = result as Composition;
        const measures = resolveMeasures(composition.measures);
        for (const part of composition.parts) {
            expect(part.measures).toHaveLength(composition.measures.length);
            part.measures.forEach((partMeasure, m) => {
                for (const { events } of partMeasure.voices) {
                    // Every voice fills its measure exactly
                    expect(compare(eventsLength(events), measures[m]!.length), `${part.name} measure ${m + 1}`).toBe(0);
                }
            });
        }
        expect(timeline(composition).length).toBeGreaterThan(0);
    });
});
