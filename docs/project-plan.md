# Custom Music Notation Software — Project Plan

## Motivation
- Extensive experience composing video game music in MuseScore 3.
- MuseScore 3 is buggy; MuseScore 4 is disliked.
- Goal: build a personal desktop notation composition app for macOS with
  MuseScore-like functionality, but with a faster, keyboard-driven
  (vim-inspired) editing workflow.

## Tech Stack Decision

**Chosen stack: Electron + VexFlow**

### Why Electron
- Prior familiarity — faster to get productive.
- Full web tech stack (HTML/CSS/JS/TS) for UI, easy to iterate on.
- Packages as a native-feeling `.app` on macOS.

### Why VexFlow
- Low-level JS/TypeScript music notation rendering library (Canvas or SVG).
- Gives full control over note/stem/beam/layout placement.
- No built-in MusicXML import or editing — it's a rendering primitive,
  not an editor. This is a deliberate tradeoff: more work up front, but
  no constraints from someone else's editing model.
- Note: VexFlow is mid-migration between v4 and v5 — pin a version.

### Other options considered (and passed on for this project)
| Option | Notes |
|---|---|
| Swift/AppKit/SwiftUI | Most native, but requires building engraving engine from scratch (or embedding Verovio via interop). |
| JUCE (C++) | Best for audio/MIDI performance, steep learning curve, would still need a renderer (e.g., Verovio via C++). |
| Qt (C++/PySide) | What MuseScore itself is built on; good 2D canvas via QGraphicsView. |
| Tauri + Verovio/OSMD | Lightweight Electron alternative (native WebView, smaller bundle); good option if bundle size/performance becomes a concern later. |
| OpenSheetMusicDisplay (OSMD) | MusicXML → VexFlow renderer, display-only, no editing support. |
| Verovio | C++/WASM engine, MEI-native, excellent engraving quality, display-first (not an editor). Strong candidate if VexFlow route proves too laborious. |
| RiffScore | Only existing JS library that's an actual interactive editor (not just renderer). Young project, no MusicXML import yet. Considered but decided to build custom instead, to support fully custom vim-like modal editing. |

### Core hard problems regardless of stack
1. **Engraving/layout logic** — spacing, beaming, collision avoidance.
2. **Music theory data model** — pitches, durations, tuplets, voices, ties/slurs.
3. **Audio playback** — MIDI/soundfont synthesis in sync with the score.
4. **File I/O** — MusicXML support at minimum, for interoperability with MuseScore.

---

## Editing Paradigm: Vim-Like Modal Controls

### Goal
Enable fast, mouse-free score composition using modal, composable
keyboard commands — inspired by Vim's efficiency model, adapted for a
2D (time × pitch) musical structure instead of a 1D text buffer.

### Modes
- **Normal mode** — navigate the score (by beat, measure, voice, staff),
  select ranges, delete/copy/paste.
- **Insert / Note-entry mode** — letter keys (A–G) insert pitches at the
  cursor (similar to MuseScore's `N` toggle).
- **Visual mode** — select a range of notes/measures, then apply an
  operation (transpose, change duration, copy, delete) to the whole
  selection.
- **Command mode (`:`)** — text commands for less-common operations,
  e.g. `:transpose +M2`, `:goto m32`, `:voice 2`, `:export musicxml`.

### Composable verbs + motions
Borrowing Vim's `verb + count + motion` grammar:
- `d2b` → delete 2 beats
- `c4n` → change next 4 notes (re-enter pitches)
- `y1m` → yank 1 measure
- `3j` / `3k` → move cursor by pitch step or octave (context-dependent)
- `.` → repeat last edit (huge win for repetitive patterns like
  ostinatos/arpeggios common in game music)

### Registers
- Yank/paste measures or motifs into named registers — useful for
  reusing repeating motifs/loops common in game music.

### Design challenges unique to music notation (vs. text)
- **Two/three axes instead of one:** time (horizontal), pitch/voice
  (vertical), and staff (multiple instruments/parts). Need distinct
  motions for each:
  - `h`/`l` — step through time (beats)
  - `j`/`k` — step through pitch
  - `}`/`{` — jump by measure
  - Vim-style window navigation (`Ctrl-w` + direction) — candidate for
    jumping between staves/parts
- **Sticky duration state** — keep MuseScore's approach: pressing a
  number (e.g., `5` for eighth note) sets a sticky duration; subsequent
  letter keys place pitches at that duration until changed. This is a
  proven ergonomic pattern — no need to force a different vim analog.
- **Chords** — Shift + pitch key adds to current chord (MuseScore-style).
  Not especially vim-like, but functional and doesn't need
  reinventing.
- **Rests/ties/tuplets as operators** — e.g., `r` for rest, `t3(` to
  start a triplet over the next selection.

### Example grammar sketch

[count] [verb] [count] [motion/object]
- `n` — enter note-input mode
- `5` — set duration to eighth note (sticky)
- `a`–`g` — pitch letters (in note-entry mode)
- `Esc` — return to normal mode
- `w` / `b` — next / previous beat
- `}` / `{` — next / previous measure
- `v` — visual select, extend with motions, then `y`/`d`/`c`
- `p` / `P` — paste after / before
- `.` — repeat last edit
- `:` — command line for named/advanced operations

### Implementation approach
- Build the modal input system as an independent **state machine**,
  decoupled from rendering.
- The state machine:
  - Tracks current mode (normal/insert/visual/command)
  - Interprets keystrokes into commands (verb + count + motion)
  - Mutates the underlying music data model
  - Triggers a re-render via VexFlow after each mutation
- Benefit: this core editing engine can be built and unit-tested
  entirely without any graphics/rendering in place.

---

## Suggested Build Order
1. **Data model** — measures, voices, notes, durations, ties/slurs;
   designed to support undo/redo and structured mutation.
2. **Modal input engine** — keystroke → mode/state → command → data
   model mutation. Fully testable without rendering.
3. **VexFlow rendering layer** — render current data model state to
   Canvas/SVG; re-render on each mutation.
4. **File I/O** — MusicXML import/export for MuseScore interoperability.
5. **Audio playback** — MIDI/soundfont-based playback engine, synced to
   score position (e.g., highlight current note during playback).
6. **Polish** — dynamics, articulations, multi-voice/multi-staff
   support, palettes/UI chrome, packaging as a macOS `.app` via
   Electron.

## Open Questions / Future Decisions
- Full keybinding scheme for articulations, dynamics, multi-voice
  editing, and playback controls (start/stop/loop-region).
- Exact data model schema (how measures/voices/notes/ties are
  represented internally) to cleanly support undo/redo and the
  composable command grammar.
- Whether to eventually port the renderer to Verovio for engraving
  quality, or add Tauri packaging later if Electron's bundle
  size/performance becomes a problem.
