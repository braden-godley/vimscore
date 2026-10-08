/**
 * The manual `:help` opens. Every change someone using vimscore would notice belongs here: a
 * key, a command, or a change in what one does. Section headings are the lines in capitals.
 */
export const HELP_TEXT = `VIMSCORE

NAME
    vimscore - a music notation editor driven by vim keys

DESCRIPTION
    Notes are entered and edited from the keyboard in modes, like vim. Normal mode moves the
    cursor and edits what's under it, the insert modes enter notes, the visual modes select,
    and the : command line does everything else. The status bar shows the mode, the keys typed
    so far, and the cursor's part and measure.

    Keys are written in vim notation: <C-d> is Ctrl-D, <S-Space> is Shift-Space, <CR> is
    Enter, <Esc> is Escape (Ctrl-[ works too). Most commands take a count typed before them,
    like 3l to move three chords right.

READING THIS PAGE
    j  k              Scroll down or up a line (also <Down> <Up> <C-e> <C-y>)
    <C-d>  <C-u>      Scroll down or up half a page
    <C-f>  <C-b>      Scroll down or up a page (<Space> scrolls down too)
    gg  G             Go to the top or the bottom
    /text<CR>         Search for text; lowercase matches either case, capitals match exactly
    n  N              Go to the next or previous match
    q  <Esc>          Close the manual
    :help topic       Open the manual at the first match for a topic, like :help tempo

MOVING
    h  l              Previous or next chord or rest, across barlines
    j  k              Next note down or up in the chord, then into the staff below or above
    {                 Back to the start of the measure, or the measure before
    }                 On to the next measure
    gg                The first measure, or with a count the measure numbered, like 12gg
    G                 The last measure, or with a count the measure numbered
    <C-j>  <C-k>      The part below or above, at the same time (also <C-w>j <C-w>k)

PLAYING
    <Space>           Play from the cursor
    While playing:
    <Space>  <Esc>    Stop
    r                 Skip repeats, or play them again. Playback carries on from the same
                      place, and later plays keep the choice
    g                 Carry on from the start of the score
    h  l              Carry on from the start of the measure before or after, going through
                      repeats as they're played. Past the last note, l does nothing
    m                 Open the mixer on the cursor's part, to change the mix as it plays.
                      Its keys work as in the mixer (see MIXER), so h and l turn the volume
                      instead of jumping; <Esc> closes it and playing carries on. <Space>
                      stops, leaving the mixer open

EDITING IN NORMAL MODE
    u  <C-r>          Undo or redo
    .                 Make the last change again at the cursor: the keys that made it, from
                      normal mode back to normal mode, like a whole stay in insert mode or
                      a visual selection and what was done to it. A count replaces the one
                      it was typed with. Undone in one step
    J  K           Move the cursor's note down or up a semitone
    <S-1> .. <S-6>    Give the cursor's chord or rest a value: <S-1> a 32nd, <S-2> a 16th,
                      <S-3> an eighth, <S-4> a quarter, <S-5> a half, <S-6> a whole
    gw                Dot the cursor's chord or rest, or take the dot off. A dot that
                      doesn't fit before the end of the measure or tuplet is refused
    g3 .. g7          Make the cursor's chord or rest a tuplet in the same time: g3 three in
                      the time of two, g4 four in the time of three, g5 g6 g7 five, six or
                      seven in the time of four. It becomes the first of them, with rests
                      for the others. g4 needs a dotted value, like a dotted quarter for four
                      eighths. Deleting every note in a tuplet takes it away again
    gs                Make the cursor's chord staccato, played half length, or full length again
    g-                Tenuto on the cursor's chord, or off. Held its full length, where other
                      notes are let go just before the next (unless under a slur);
                      with staccato too, it's played three quarters of its length
    g>                Accent the cursor's chord, struck louder, or take the accent off
    gv                Marcato on the cursor's chord, struck louder than an accent and played a
                      little short (unless tenuto too), or off. A chord has an accent or a
                      marcato, so each replaces the other
    gt                Tie the cursor's note to the same note in the next chord, or untie it.
                      Nothing is joined if the next chord doesn't have it
    ga                Roll the cursor's chord as an arpeggio, or play it straight again
    gl                Slide the cursor's note on to the next chord (a glissando), or stop it
    (                 Slur the cursor's chord on to the next, or with a count that many chords
                      on, across barlines; again over the same chords takes the slur off.
                      Notes under a slur with no other marking are held their full length
    vk  vj            The cursor's part a dynamic louder or softer from its beat on, or with a
                      count that many; back to the dynamic before takes it off (see DYNAMICS)
    vd                Take the dynamic marking at the cursor's beat off
    <  >              A crescendo or diminuendo over the cursor's chord, and count - 1 after it
    rs  re            Put a repeat start or end barline at the cursor's measure, or take it away
    gS                Pick the clef of the cursor's part from its measure on (see CLEFS)
    dd                Delete the cursor's note, keeping it to put back
    yy                Copy the cursor's note
    d{motion}         Delete from the cursor through a motion: dl the chord, dh the one before,
                      d} to the end of the measure, d{ to its start, d<C-j> the same time in
                      the part below, dG or dgg whole measures
    y{motion}         Copy, with the same motions as d
    p  P              Put what was deleted or copied after the cursor's chord, or at it
    z                 Show every staff at once, or back to the normal size
    m                 Open the mixer on the cursor's part (see MIXER)
    i                 Insert mode, staying on the chord
    a                 Melody insert mode, moving on after each note
    V                 Visual mode, selecting whole measures
    <C-v>             Visual block mode, selecting chords across parts
    :                 The command line

INSERT MODES
    A green phantom note shows what <Space> will place. It starts as a copy of the note under
    the cursor. In melody mode (a) the cursor moves on after each note, and the score grows
    as it fills; in insert mode (i) it stays.

    <Space>           Place the phantom. If that pitch is there already with the same value and
                      articulation, it's removed instead. A chord has one value, so all of its
                      notes change length together
    <S-Space>         Place a rest as long as the phantom
    j  k              The phantom's pitch a step down or up the scale. On a percussion
                      staff, the next drum down or up the kit as it's written
    J  K              The phantom's pitch a semitone down or up. On a percussion staff,
                      the next sound down or up the stave, in or out of the kit
    h  l              A shorter or longer value
    <C-h>  <C-l>      Back or on a chord or rest, across barlines, keeping the phantom
    <S-1> .. <S-6>    Pick a value outright, as in normal mode
    w                 Dot the value, or not
    s  -  >  v        Make the phantom staccato, tenuto, accented or marcato, or not; as gs g-
                      g> gv in normal mode. A new value starts with none
    m                 Switch between insert and melody insert
    u                 Take back the last note entered
    z                 Show every staff at once, or back to the normal size
    <Esc>             Back to normal mode

VISUAL MODES
    V selects whole measures from where it started to the cursor; h and l move a measure at a
    time. <C-v> selects a block of chords, across parts. Pressing the same key again leaves.

    o                 Go to the other end, to grow or shrink the selection from there
    d  y              Delete or copy the selection
    c                 Delete the selection and start inserting where it began (one part only)
    J  K              Move every selected note down or up a semitone
    gs  ga  gl  gt    Staccato, arpeggio, glissando or a tie on every selected chord, or off if
                      they all have it already
    g-  g>  gv        Tenuto, an accent or marcato on every selected chord, or off if they all
                      have it already
    (                 Slur the selected chords together, in each voice, or take the slur off
    <  >              A crescendo or diminuendo over the selection
    <Esc>             Back to normal mode

THE COMMAND LINE
    :                 Start a command, typed in the status bar
    <CR>              Run it. One it can't read stays open with the error, to fix
    <Esc>             Cancel (backspacing past the start does too)
    <Up>  <Down>      Go back or forward through the commands entered before. With something
                      typed, only the ones that start with it. The last 100 are kept between
                      runs
    <Tab>  <S-Tab>    Fill in a file name. With several that match, they're listed and the
                      first is filled in; <Tab> again goes to the next, <S-Tab> back, and past
                      the last comes back to what was typed. Type to keep the one shown; with
                      a folder, <Tab> then completes inside it. Offers folders, and the files
                      the command takes: scores for :w and :e, soundfonts for :soundfont and
                      :addsf, the format's files for :export. Names are from the score's
                      folder (or home), ~ is home

FILES
    :w [file]         Save, asking where if the score has never been saved. A name without an
                      extension gets .vimscore. :w! file writes over a file that's there
    :e [file]         Open a score. MuseScore files (.mscz, .mscx) are imported; :w then asks
                      where to save the .vimscore. :e alone reads the file again, and :e!
                      throws away changes
    :recent [filter]  Pick a score opened or saved before. Type to filter, <C-n> <C-p> or the
                      arrows to move, <CR> to open, <Esc> to close. It opens by itself
                      when vimscore starts, if there are any; <Esc> keeps the blank score
    :enew             A new, blank score
    :q                Close the window. :q! closes it with changes unsaved
    :wq  :x           Save and close
    Cmd-S             Save
    Cmd-Shift-S       Save as, asking where
    Cmd-O             Open, asking which file

    Double-clicking a .vimscore file in Finder opens it in vimscore, as :e would, starting
    vimscore if it isn't running, and Finder shows them with vimscore's own file icon.
    MuseScore files can be opened the same way with Open With.

    Opening, closing and starting a new score are refused while there are unsaved changes;
    add ! to go ahead anyway.

EXPORTING
    :export mp3 [file]       The audio, through the score's soundfonts
    :export mp4 [file]       A video of the score, following the music
    :export musanim [file]   A video of the music as colored bars of light, at 60 frames a
                             second. Drum parts play in their own band along the bottom,
                             a row for each drum
    :export midi [file]      A MIDI file (also :export mid)

    Without a file, it's written beside the score. Add ! to write over a file that's there.
    Audio and video need a soundfont loaded.

SOUNDFONTS
    :soundfont [file]   Play through just this soundfont, asking with a dialog without a file
                        (also :sf)
    :addsf [file]       Put a soundfont over the others; where several have a sound, the
                        first has it (also :addsoundfont)
    :delsf 2            Stop playing through a soundfont, by number or name (also :delsoundfont)
    :soundfonts         List them, first first (also :sfs)

    New scores start with the soundfonts last chosen.

PARTS
    :instrument [filter]   Pick the instrument of the cursor's part. Each one plays as you
                           move to it (also :inst)
    :addpart [filter]      Pick an instrument for a new part below the cursor's
    :delpart               Delete the cursor's part
    :parts                 Open the parts list, to add, delete and reorder parts
    :rename name           Rename the cursor's part
    :clef name             The cursor's part's clef from the cursor's measure on, by name:
                           treble, bass, alto, percussion, treble8va or bass8vb
                           (see CLEFS)

    In a picker, type to filter, <C-n> <C-p> <Tab> or the arrows to move, <CR> to choose,
    <Esc> to close.

    In the parts list, the selected part is the cursor's:
    j  k            The next or previous part
    J  K            Move the part down or up the score
    o  O            Pick an instrument for a new part below or above, then back to the list
    d  x            Delete the part; the last one stays
    u  <C-r>        Undo or redo, one change at a time
    q  <Esc>  <CR>  Close

CLEFS
    Each part starts in a clef, and can change to another at the start of any measure. A
    change holds until the next one, and shows as a small clef where it happens. Changing
    back to the clef already in effect takes the change away. A new part gets the clef for
    its instrument's range: bass for low instruments, percussion for drums, treble otherwise.

    gS              Pick the clef of the cursor's part from the cursor's measure on, starting
                    at the clef it has there. In the clef picker:
      j  k            The next or previous clef (the arrows work too)
      <CR>            Choose it
      <Esc>           Close, changing nothing
    :clef name      The same from the command line

    Treble          G clef
    Bass            F clef
    Alto            C clef, with middle C on the middle line, as violas read
    Percussion      A neutral clef, for drums; each drum is written on its own line or
                    space, as below
    Treble 8va      Treble clef with an 8 above: written an octave below how it sounds
    Bass 8vb        Bass clef with an 8 below: written an octave above how it sounds

    Clef changes are saved with the score, and come in from MuseScore files.

    On a percussion staff, notes are written the way drum parts usually are: each General
    MIDI drum on its own line or space with its own notehead, stems up, with no key
    signature or accidentals. The status bar names the phantom's drum, like Closed Hi-Hat
    F♯2. In insert mode, j and k move the phantom through the kit from line to line, drums
    sharing a line in the order below, and on a rest it starts on the snare. J and K move
    it through every MIDI sound the same way, taking in the sounds outside the kit, so the
    phantom only ever moves the way you asked. The kit, with
    lines and spaces named as in treble clef, from the bottom up, down the left column and
    then the right:

    Pedal Hi-Hat        D4 x            Cowbell             E5 triangle
    Acoustic Bass Drum  E4              Ride Cymbal 2       E5 x
    Bass Drum           F4              High Tom            F5
    Low Floor Tom       G4              Ride Cymbal         F5 x
    High Floor Tom      A4              Ride Bell           F5 diamond
    Low Tom             B4              Closed Hi-Hat       G5 x
    Side Stick          C5 circled x    Open Hi-Hat         G5 x, o above
    Acoustic Snare      C5              Crash Cymbal        A5 x
    Electric Snare      C5 diamond      Chinese Cymbal      B5 circled x
    Hand Clap           D5 x            Crash Cymbal 2      B5 x
    Low-Mid Tom         D5              Splash Cymbal       C6 x
    Tambourine          D5 triangle     Vibraslap           C6 triangle
    Hi-Mid Tom          E5

    Any other sound sits where its pitch would in treble clef, without an accidental.

THE SCORE
    :title name     Name the whole score
    :time 3/4       A time signature from the cursor's measure on, in every part
    :key D          A key from the cursor's measure on: :key Bb, :key F#m, :key 2#, :key 3b
    :tempo 120      A tempo from the cursor's measure on, counting the beat it had there.
                    :tempo q.=60 names the beat: w h q e s for whole to sixteenth, . to dot it

DYNAMICS
    Each part plays at a dynamic, which sets how hard its notes are struck (their MIDI
    velocity): ppp 10, pp 30, p 49, mp 69, mf 88, f 108, ff 127. A part starts at mf, and a
    marking holds until the next one. Markings show under the staff, at their beat.

    vk  vj          A dynamic louder or softer from the cursor's beat on, stopping at ff and
                    ppp; a count steps that many. Stepping back to the dynamic already in
                    effect takes the marking off
    vd              Take the marking at the cursor's beat off, so the dynamic before it
                    carries on
    <  >            A crescendo or diminuendo. It ramps to the dynamic marked where it ends,
                    or without one there, to one dynamic louder or softer
    g>  gv          An accent strikes 1.2 times as hard, a marcato 1.35 times, up to 127

    Scores saved with volumes in percent open with the nearest dynamic in their place.
    MuseScore dynamics come in by name; louder than ff or softer than ppp come in as those.

MIXER
    The mixer sets how loud each whole part plays, and the master over them all, without
    changing how hard the notes are struck.

    :mixer          Open the mixer (also :mix, or m in normal mode)

    In the mixer:
    j  k            The next or previous part, then the master
    h  l            Down or up by 5
    H  L            Down or up by 1
    =               Back to normal
    m               Mute the part, or unmute it
    s               Solo the part, or take its solo off. While any part is soloed, only
                    soloed parts are heard; a muted part stays silent even when soloed
    q  <Esc>  <CR>  Close

    Muted parts show M and soloed ones S, and any part not heard is dimmed. Mutes and
    solos are saved with the score and hold in exports too.
    Everything changed in one visit to the mixer is undone together.
    m while playing opens the mixer without stopping (see PLAYING).

HELP
    :help [topic]   This manual, open at the first match for a topic if one is given (also :h)
`;

export const HELP_LINES = HELP_TEXT.trimEnd().split('\n');
