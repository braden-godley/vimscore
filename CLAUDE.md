# CLAUDE.md

Instructions for anyone, human or agent, changing vimscore.

## Keep the manual up to date

`:help` opens the manual, a man page kept in `src/services/help/helpText.ts`. It is the
reference for everything someone using vimscore can do.

**Every user-facing change has to be explained in the manual, in the same change.** That
includes:

- a new key or command, or a new alias for one
- a change to what an existing key or command does, or a new argument it takes
- a new mode, picker or dialog, and the keys that work in it
- removing a key, command or feature (take it out of the manual too)
- behavior someone would notice, like what gets saved between runs or when something is refused

Put it in the section where someone would look for it, using the format around it: the keys
or command on the left, a short plain description on the right, with continuation lines lined
up. Section headings are lines in capitals. Changes that nothing on screen or in a saved file
reflects, like refactors and internal fixes, don't need an entry.

A change isn't done until the manual describes it.

## Checks

Run `npm run typecheck` and `npm test` before committing.
