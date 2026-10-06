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

EDITING IN NORMAL MODE
    u  U              Undo or redo
    J  K              Move the cursor's note down or up a semitone
    <S-1> .. <S-6>    Give the cursor's chord or rest a value: <S-1> a 32nd, <S-2> a 16th,
                      <S-3> an eighth, <S-4> a quarter, <S-5> a half, <S-6> a whole
    gw                Dot the cursor's chord or rest, or take the dot off. A dot that
                      doesn't fit before the end of the measure or tuplet is refused
    g3 .. g7          Make the cursor's chord or rest a tuplet in the same time: g3 three in
                      the time of two, g4 four in the time of three, g5 g6 g7 five, six or
                      seven in the time of four. It becomes the first of them, with rests
                      for the others. g4 needs a dotted value, like a dotted quarter for four
                      eighths. Deleting every note in a tuplet takes it away again
    gs                Make the cursor's chord staccato, or full length again
    gt                Tie the cursor's note to the same note in the next chord, or untie it.
                      Nothing is joined if the next chord doesn't have it
    ga                Roll the cursor's chord as an arpeggio, or play it straight again
    gl                Slide the cursor's note on to the next chord (a glissando), or stop it
    <  >              A crescendo or diminuendo over the cursor's chord, and count - 1 after it
    rs  re            Put a repeat start or end barline at the cursor's measure, or take it away
    dd                Delete the cursor's note, keeping it to put back
    yy                Copy the cursor's note
    d{motion}         Delete from the cursor through a motion: dl the chord, dh the one before,
                      d} to the end of the measure, d{ to its start, d<C-j> the same time in
                      the part below, dG or dgg whole measures
    y{motion}         Copy, with the same motions as d
    p  P              Put what was deleted or copied after the cursor's chord, or at it
    z                 Show every staff at once, or back to the normal size
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
    j  k              The phantom's pitch a step down or up the scale
    J  K              The phantom's pitch a semitone down or up
    h  l              A shorter or longer value
    <C-h>  <C-l>      Back or on a beat, across barlines, keeping the phantom. Beats are the
                      time signature's, or dotted quarters in 6/8, 9/8 and 12/8. A rest across
                      the beat is split there so a note can go on it; a chord held over the
                      beat is landed on, or passed if the cursor is already on it. u takes
                      back the notes entered, not the splits
    <S-1> .. <S-6>    Pick a value outright, as in normal mode
    w                 Dot the value, or not
    s                 Make the phantom staccato, or not
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

    Opening, closing and starting a new score are refused while there are unsaved changes;
    add ! to go ahead anyway.

EXPORTING
    :export mp3 [file]       The audio, through the score's soundfonts
    :export mp4 [file]       A video of the score, following the music
    :export musanim [file]   A video of the music as colored bars of light
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
    :rename name           Rename the cursor's part
    :clef treble|bass      The cursor's part's clef

    In a picker, type to filter, <C-n> <C-p> <Tab> or the arrows to move, <CR> to choose,
    <Esc> to close.

THE SCORE
    :title name     Name the whole score
    :time 3/4       A time signature from the cursor's measure on, in every part
    :key D          A key from the cursor's measure on: :key Bb, :key F#m, :key 2#, :key 3b
    :tempo 120      A tempo from the cursor's measure on, counting the beat it had there.
                    :tempo q.=60 names the beat: w h q e s for whole to sixteenth, . to dot it

VOLUME
    :volume 60      The cursor's part plays at 60% from its beat on (also :vol)
    :v 80           The mixer's volume for the cursor's whole part, up to 127
    :gv 80          The mixer's master volume, over every part, up to 100
    :mixer          Open the mixer (also :mix)

    In the mixer:
    j  k            The next or previous part, then the master
    h  l            Down or up by 5
    H  L            Down or up by 1
    =               Back to normal
    q  <Esc>  <CR>  Close

    Everything changed in one visit to the mixer is undone together.

HELP
    :help [topic]   This manual, open at the first match for a topic if one is given (also :h)
`;

export const HELP_LINES = HELP_TEXT.trimEnd().split('\n');
