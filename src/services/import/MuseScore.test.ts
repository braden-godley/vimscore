import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { Composition } from '../composition/Composition';
import { Chord, Event, eventsLength, leaves } from '../event/Event';
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

    it('reads accents, marcatos and tenutos, alone or two to a mark', () => {
        const chord = (...subtypes: string[]) =>
            `<Chord><durationType>quarter</durationType>${subtypes
                .map((subtype) => `<Articulation><subtype>${subtype}</subtype></Articulation>`)
                .join('')}<Note><pitch>60</pitch></Note></Chord>`;
        const measure = (...chords: string[]) => `<Measure><voice>${chords.join('')}</voice></Measure>`;
        const marked = read(
            mscx(`
    <Staff id="1">
      ${measure(chord('articAccentAbove'), chord('articMarcatoBelow'), chord('articTenutoAbove', 'articStaccatissimoAbove'), chord('articMarcatoStaccatoAbove'))}
      ${measure(chord('articTenutoAccentBelow'), chord('articAccentStaccatoAbove'), chord('articTenutoStaccatoBelow'), chord('articFadeIn'))}
    </Staff>`),
        );
        const marks = (m: number) =>
            [...leaves(marked.parts[0]!.measures[m]!.voices[0]!.events)].map(({ event }) => {
                const { pitch: _, ...rest } = (event as Chord).notes[0]!;
                return rest;
            });
        expect(marks(0)).toEqual([{ accent: true }, { marcato: true }, { tenuto: true, staccato: true }, { marcato: true, staccato: true }]);
        expect(marks(1)).toEqual([{ tenuto: true, accent: true }, { accent: true, staccato: true }, { tenuto: true, staccato: true }, {}]);
    });

    it('reads slurs, across barlines, up to the chord they end on', () => {
        const quarter = (pitch: number, spanner = '') => `<Chord><durationType>quarter</durationType>${spanner}<Note><pitch>${pitch}</pitch></Note></Chord>`;
        const rest = (type: string) => `<Rest><durationType>${type}</durationType></Rest>`;
        // From the third beat to the second of the next measure
        const start = '<Spanner type="Slur"><Slur/><next><location><measures>1</measures><fractions>-1/4</fractions></location></next></Spanner>';
        const end = '<Spanner type="Slur"><prev><location><measures>-1</measures><fractions>1/4</fractions></location></prev></Spanner>';
        const slurred = read(
            mscx(`
    <Staff id="1">
      <Measure><voice>${rest('half')}${quarter(60, start)}${quarter(62)}</voice></Measure>
      <Measure><voice>${quarter(64)}${quarter(65, end)}${rest('half')}</voice></Measure>
    </Staff>`),
        );
        const slurs = (m: number) =>
            [...leaves(slurred.parts[0]!.measures[m]!.voices[0]!.events)].map(({ event }) => event.kind === 'chord' && !!event.slur);
        expect(slurs(0)).toEqual([false, true, true]);
        expect(slurs(1)).toEqual([true, false, false]);
    });

    it('reads a slur written between chords', () => {
        const slurred = read(
            mscx(`
    <Staff id="1">
      <Measure><voice>
        <Spanner type="Slur"><Slur/><next><location><fractions>1/2</fractions></location></next></Spanner>
        <Chord><durationType>half</durationType><Note><pitch>60</pitch></Note></Chord>
        <Chord><durationType>half</durationType><Note><pitch>62</pitch></Note></Chord>
      </voice></Measure>
    </Staff>`),
        );
        const events = slurred.parts[0]!.measures[0]!.voices[0]!.events;
        expect(events.map((event) => event.kind === 'chord' && !!event.slur)).toEqual([true, false]);
    });

    it('keeps an accent on the first piece of a note split to fit', () => {
        const long = read(
            mscx(`
    <Staff id="1">
      <Measure len="5/4">
        <voice>
          <Chord><durationType>breve</durationType><Articulation><subtype>articAccentAbove</subtype></Articulation><Note><pitch>60</pitch></Note></Chord>
        </voice>
      </Measure>
    </Staff>`),
        );
        const notes = [...leaves(long.parts[0]!.measures[0]!.voices[0]!.events)].map(({ event }) => (event as Chord).notes[0]);
        expect(notes[0]).toMatchObject({ accent: true, tie: true });
        expect(notes.slice(1).some((note) => note?.accent)).toBe(false);
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

    it('reads dynamics', () => {
        expect(score.parts[0]!.measures[0]!.dynamics).toEqual([{ offset: { num: 0, den: 1 }, dynamic: 'p' }]);
        expect(score.parts[0]!.measures[1]!.dynamics?.[0]?.dynamic).toBe('f');
        expect(voice(score, 0, 1)).toBe('r/2.');
    });

    it('reads dynamics past ppp and ff as those, and others by their velocity', () => {
        const dynamic = (inside: string) => `<Dynamic>${inside}</Dynamic><Rest><durationType>quarter</durationType></Rest>`;
        const marked = read(
            mscx(`<Staff id="1"><Measure><voice>
                ${dynamic('<subtype>mp</subtype>')}${dynamic('<subtype>fff</subtype>')}
                ${dynamic('<subtype>pppp</subtype>')}${dynamic('<subtype>sfz</subtype><velocity>112</velocity>')}
              </voice></Measure></Staff>`, '<Part><Staff id="1"/><Instrument><Channel><program value="0"/></Channel></Instrument></Part>'),
        );
        expect(marked.parts[0]!.measures[0]!.dynamics?.map(({ dynamic }) => dynamic)).toEqual(['mp', 'ff', 'ppp', 'f']);
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
        const velocities = timeline(marked).map(({ velocity }) => velocity);
        expect(velocities.slice(0, 5)).toEqual([49, 49, 69, 88, 108]);
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

    it('reads glissandi from the note they start on', () => {
        const slid = read(
            mscx(`<Staff id="1"><Measure><voice>
                <Chord><durationType>half</durationType><Note>
                    <Spanner type="Glissando"><Glissando><subtype>0</subtype></Glissando><next><location><fractions>1/2</fractions></location></next></Spanner>
                    <pitch>60</pitch>
                </Note></Chord>
                <Chord><durationType>half</durationType><Note>
                    <Spanner type="Glissando"><prev><location><fractions>-1/2</fractions></location></prev></Spanner>
                    <pitch>72</pitch>
                </Note></Chord>
            </voice></Measure></Staff>`),
        );
        const [from, to] = slid.parts[0]!.measures[0]!.voices[0]!.events;
        expect(from).toMatchObject({ notes: [{ glissando: true }] });
        expect(to).toMatchObject({ notes: [{}] });
        expect((to as Chord).notes[0]).not.toHaveProperty('glissando');
        // It plays as a run up to the C an octave above
        expect(timeline(slid).map(({ pitch }) => pitch)).toEqual([60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72]);
    });

    it('reads the zipped form too', () => {
        const xml = mscx('<Staff id="1"><Measure><voice><Rest><durationType>measure</durationType><duration>4/4</duration></Rest></voice></Measure></Staff>');
        const zipped = zipSync({
            'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="a.mscx"/></rootfiles></container>'),
            'a.mscx': strToU8(xml),
        });
        expect(readMuseScore(zipped)).toMatchObject({ title: 'Little Piece', measures: [{ timeSignature: { beats: 4, beatValue: 4 } }] });
    });

    it("reads MuseScore 3's channel volumes into the mixer", () => {
        const rest = '<Measure><voice><Rest><durationType>measure</durationType><duration>4/4</duration></Rest></voice></Measure>';
        const part = (id: number, channel: string) =>
            `<Part><Staff id="${id}"/><Instrument><Channel><program value="0"/>${channel}</Channel></Instrument></Part>`;
        const mixed = read(
            mscx(
                [1, 2, 3].map((id) => `<Staff id="${id}">${rest}</Staff>`).join(''),
                part(1, '<controller ctrl="7" value="116"/>') + part(2, '') + part(3, '<controller ctrl="7" value="80"/><mute>1</mute>'),
            ),
        );
        expect(mixed.parts.map(({ volume }) => volume)).toEqual([116, undefined, 0]);
        expect(mixed.volume).toBeUndefined();
    });

    it("reads MuseScore 4's mixer from its audio settings", () => {
        const rest = '<Measure><voice><Rest><durationType>measure</durationType><duration>4/4</duration></Rest></voice></Measure>';
        const xml = mscx(
            `<Staff id="1">${rest}</Staff><Staff id="2">${rest}</Staff><Staff id="3">${rest}</Staff>`,
            `<Part id="7"><Staff id="1"/><Staff id="2"/><Instrument><Channel><program value="0"/></Channel></Instrument></Part>
             <Part id="9"><Staff id="3"/><Instrument><Channel><program value="40"/></Channel></Instrument></Part>`,
        ).replace('version="3.02"', 'version="4.20"');
        const settings = {
            master: { volumeDb: -6, muted: false },
            tracks: [
                { partId: '7', instrumentId: 'piano', out: { volumeDb: -12, muted: false } },
                { partId: '9', instrumentId: 'violin', out: { volumeDb: 20, muted: false } },
            ],
        };
        const zipped = zipSync({ 'a.mscx': strToU8(xml), 'audiosettings.json': strToU8(JSON.stringify(settings)) });
        const mixed = readMuseScore(zipped) as Composition;
        // A piano's two staves both take its part's volume
        expect(mixed.parts.map(({ volume }) => volume)).toEqual([50, 50, 127]);
        expect(mixed.volume).toBe(71);
    });

    it('reads clefs written the later MuseScore 3 way', () => {
        const bass = read(
            mscx(
                '<Staff id="1"><Measure><voice><Rest><durationType>measure</durationType><duration>4/4</duration></Rest></voice></Measure></Staff>',
                `<Part><Staff id="1"><defaultConcertClef>F8vb</defaultConcertClef></Staff><trackName>Bass Line</trackName>
                   <Instrument><concertClef>F8vb</concertClef><Channel><program value="32"/></Channel></Instrument></Part>`,
            ),
        );
        expect(bass.parts[0]).toMatchObject({ name: 'Acoustic Bass', clef: 'bass8vb', program: 32 });
    });

    it('reads clef changes, including ones written at the end of the measure before', () => {
        const rest = '<Rest><durationType>measure</durationType><duration>4/4</duration></Rest>';
        const clef = (type: string) => `<Clef><concertClefType>${type}</concertClefType></Clef>`;
        const changing = read(
            mscx(
                `<Staff id="1">
                   <Measure><voice>${rest}${clef('PERC')}</voice></Measure>
                   <Measure><voice>${rest}</voice></Measure>
                   <Measure><voice>${clef('G8va')}${rest}</voice></Measure>
                   <Measure><voice>${clef('G8va')}${rest}</voice></Measure>
                 </Staff>`,
                `<Part><Staff id="1"/><Instrument><Channel><program value="0"/></Channel></Instrument></Part>`,
            ),
        );
        const part = changing.parts[0]!;
        expect([part.clef, ...part.measures.map(({ clef }) => clef)]).toEqual(['treble', undefined, 'percussion', 'treble8va', undefined]);
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
