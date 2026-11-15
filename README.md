# Lines

A small app for learning your part in a school play. Paste the script, pick your
character, then rehearse with spoken cues, first-letter hints and typing drills.

**Live version: <https://theocaswest.github.io/lines/>** — open it on your phone,
nothing to install.

Nothing is uploaded and there's no build step — your script and progress live in
the browser's local storage.

## Run it

**Easiest:** double-click `index.html`.

**On your phone** (same Wi-Fi as your computer):

```sh
node serve.mjs
```

Then open the URL it prints on your phone.

## Put your script in

Copy the script out of Google Docs / Word / PDF and paste it — or drop a `.txt`
file on the import screen. Three layouts work:

```
HAMLET: To be, or not to be, that is the question.
```

a name on its own line:

```
HAMLET
To be, or not to be, that is the question.
```

or a name column, which is how most printed school scripts are set:

```
SCROOGE Henry P      (Reaching the door) Home at last.
NARRATOR 5 Theo      As he sat in the chilly gloom, an eerie jangling sound...
  In any ordinary man, considering the icy temperature in the room...
```

In that last one the capitals are the role and the name after them is the actor,
so the character list reads "Narrator 5 (Theo)".

- `ACT 1`, `SCENE 2` headings become scenes you can practise separately.
- Stage directions in `(parentheses)` or `[brackets]` are shown for context but
  never tested or spoken.
- Wrapped lines (one speech across several lines) are joined automatically;
  indented lines continue the speech above them.
- Lines that are neither dialogue nor a direction land as stage directions, so
  nothing important disappears.

You can re-import an edited script later — progress is matched per line, so most
of it survives.

## The bundled script

`default-script.json` points at a script that loads automatically the first time
the app is opened on a device, so the URL opens straight into your part:

```json
{ "title": "A Christmas Carol", "path": "scripts/a-christmas-carol.txt", "character": "Narrator 5" }
```

Point `path` at another file, or delete the JSON, to start with an empty screen.
Actor names are left out of the published copy on purpose — the role is all the
app needs.

Each browser keeps its own copy of whatever it loaded, plus its own progress. To
pick up an edited `.txt` on a device that already has the old one, hit
**Start over** and reload the page.

## Practising

**Rehearse** — your line is blurred. Tap it (or press `space`) to check yourself,
`h` gives first letters only, `g` / `m` mark it got/missed and move on. Cue lines
from the other characters are read aloud with different system voices.

**Type** — type the line from memory; `enter` checks it word by word and scores
you.

**Trouble lines** filters to the lines you keep missing. **Whole scene** shows the
full scene around your line so you can see what comes next.

Progress is saved as you go; the **Progress** tab shows what's solid, what needs
drilling, and per-scene bars.

## Notes

- Voices come from your operating system (Windows/macOS/iOS have several). Pick
  them under **Voices**; if speech isn't available the app still works silently.
- Everything is stored in `localStorage` for this browser only. Clearing site
  data wipes your progress.
