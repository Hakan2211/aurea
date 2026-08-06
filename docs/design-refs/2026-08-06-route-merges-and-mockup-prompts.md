# Route merges + next mockup round — 2026-08-06

Follow-up to `2026-08-05-ui-mockups/DECISIONS.md`. Three questions answered here:
should Director + Storyboard become one route (as the mockup draws them), should
Studio + Writers Room become one route, and how to make Formats intuitive.
Plus the image-gen prompts for the next mockup batch (combined Director,
combined Studio, Bible, Voice Lab, Music Lab, Formats).

---

## 1. Director + Storyboard → one route. **YES — merge.** ✅ SHIPPED 2026-08-06

Built as specced, verified in Chrome against the live core (episode picker,
board card → slide-over, Esc, resize, density, `/storyboard` → `/` redirect):

- `screens/Director.tsx` — resizable split (chat 340–720px, default 420,
  width + density remembered in localStorage; double-click the handle resets).
- `screens/director/{chat,board,inspector,shared}.tsx` — the old
  `DirectorChat.tsx` and `Storyboard.tsx` are gone; the asset rail and the job
  rail went with them.
- Context chip above the composer; a selected shot prefixes the sent message
  with `[Shot S01-02 · INT. THE LOFT — NIGHT · title]` — visible, not hidden
  state. The chip's × drops the context; Esc closes the inspector but *keeps*
  the selection, so the composer stays pointed at the shot.
- Inspector is a slide-over (`anim-slide-over`, new in `styles/index.css`),
  absolute over the board's right edge.
- Adopted from v2: quiet episode-chip header + "Boarded 1/1" readout with a
  hairline bar; in-frame `62% · Rendering` caption on cards instead of the
  circular lens-cap overlay; a density toggle (cards ⇄ cinematic strips).
- `components/GlobalStatus.tsx` — the global strip (GPU · VRAM · "N rendering ·
  ETA", links to Jobs), mounted in `AppShell` above every screen.
- "Send to Director" → **"Send to Video Lab"**. Nav: Storyboard entry removed.

Gotcha worth keeping: wrapping the chat pane in the split's column flex item
made its `min-height:auto` inflate past the viewport — the header and composer
left the layout and `scrollIntoView` scrolled the whole app instead of the
thread. `min-h-0` on the pane fixes it.



**Why it makes sense.** The Director chat is the control plane and the
storyboard is the artifact it produces — exactly the Cursor pattern (chat panel
+ editor in one window). Today the loop is broken across routes: you ask the
Director for shots on `/`, then navigate to `/storyboard` to see whether the
board changed. The mockup's split view closes that loop: tool-call cards stream
on the left while the affected shot card updates in place on the right.

**Layout.**
- **Left pane (~420px, resizable): Director chat.** Keeps the composer, model
  picker, attach, tool-call cards, result cards. Chat becomes *context-aware*:
  when a shot card is selected on the board, a small context chip
  (`S01-02 · The Loft`) sits above the composer and prompts act on that shot.
- **Right pane: the storyboard canvas.** Scene rows of keyframe cards exactly
  as today (serif numeral, status chip, takes count, job overlay).
- **Inspector becomes a slide-over**, not a third fixed column. Clicking a card
  opens the takes/references/prompt/seed panel over the right edge; Esc closes.
  Two persistent 3-column layouts side by side don't fit; slide-over does.
- **Job center leaves this screen.** The right-rail VRAM/queue panel moves to a
  global status bar strip (GPU + queue count + ETA — already adopted from the
  Image Lab mockup); full detail stays in Jobs.
- **Asset rail is demoted** to the attach popover (it only exists to attach
  images to messages; the board is now the main visual surface).

**What carries over unchanged:** episode picker + "Boarded N/M" header, the
state machine chips (draft / boarded / generated / synced / approved),
Generate keyframes vs Send to Director primary-action switch.

**Naming/renaming honesty:** Storyboard's "Send to Director" actually opens the
*Video Lab*. Once chat and board share a screen that label becomes actively
wrong — rename to **"Send to Video Lab"** during the merge.

**Route plan:** merged screen lives at `/` ("Director"). `/storyboard`
redirects. Empty-episode state shows chat full-width with a "board appears
here" hint, so plain chat use (no episode) still works.

## 2. Studio + Writers Room → one route. **YES — merge as views.** ✅ SHIPPED 2026-08-06

Built as specced, verified in Chrome against the live core (episode picker,
Script ⇄ Board toggle, shared selection both directions, Esc, `/script` →
`/studio` redirect, view choice remembered across reload):

- `screens/Studio.tsx` — the orchestrator: episode + view + shared selection.
  `screens/WritersRoom.tsx` is gone; `/script` redirects.
- `screens/studio/{header,rail,script,board,inspector,writers,shared}.tsx` —
  one header, one left rail (outline over cast over locations), one right rail
  with two occupants.
- **Header is a 3-column grid, and the toggle owns the centre.** First build
  put SCRIPT | BOARD at the far right, where it was easy to miss: 600px from
  the title, hard against the right rail, and camouflaged by four *passive*
  readouts (stats, ring, "0/0 approved") with the gold ring and the gold
  "Write script" button competing either side of it. Centred as studio-v1 drew
  it, in letterspaced caps a size up from the `Segmented` default — a flex row
  would let it drift with title length, so `grid-cols-[1fr_auto_1fr]` with
  `min-w-0` on both side columns holds it dead centre. Rule of thumb: don't
  park the only interactive control of a row inside a cluster of numbers.
- **Narrow windows** — three bugs the centring exposed, worth remembering as a
  set because they look identical on screen (things drawing on top of the
  toggle) and have different causes:
  1. The `<h1>` needs `min-w-0` as well as `truncate` — a flex item's implicit
     `min-width:auto` refuses to shrink below the title's min-content, so a
     long title overran its column.
  2. `min-w-0` on a `1fr` track only lets the *track* shrink; the `shrink-0`
     readouts inside it then overflow leftward across the centre column. They
     have to actually drop out, tier by tier, and the column carries
     `overflow-hidden` so a mis-set threshold clips instead of colliding.
  3. On a narrow pane the readout column is empty, and an empty `1fr` track
     still claims half the leftover width — so the header drops the grid for a
     flex row (title left, toggle right).
  Thresholds are **container** queries (`@container` on the pane `<section>`),
  not viewport ones: nav 208 + outline rail 220 + right rail 320 sit between
  the window and this header, so viewport width says nothing useful about it.
  Tiers: flex → grid + ring at `@2xl` (672), stats at `@4xl` (896),
  "N/N approved" at `@6xl` (1152). Screen-level, the outline rail hides below
  viewport `lg` and the right rail narrows 320 → 280 below `xl`.
- **Selection is shared and deliberate.** In Script view the shot's *code row*
  is the selection handle — clicking into dialogue keeps the writers' panel in
  place, so typing never swaps the right column out from under you. Selecting
  anywhere (script, board, board peek) rail-lights the block, scrolls it into
  view, and follows the board's scene tab.
- **Right rail = inspector when a shot is selected, writers' room when not.**
  Esc (or the inspector's ×) hands the rail back.
- Adopted from v2: shot-count badge per outline scene; one-line character
  description under each cast name (first sentence of `personality`); the
  docked **Board peek** strip under the Script view — episode-wide status
  columns with counts, collapsible, remembered.
- Nav: Direct = Director only; Story = **Studio**, Bible. 11 routes → 10.

Gotcha worth keeping: the episode-picker row was a `<button>` with the remove
`<button>` nested inside it — inherited from the pre-merge header and invalid
HTML (React logs a hydration error). The row is a `div` now with two sibling
buttons.


**Why.** They are already two views of the *same* `production.json` episode:
Writers Room renders it as a typeset screenplay, Studio as a kanban of the same
shots by status. Both duplicate the episode dropdown, scene structure, and
stats header. This is the Notion pattern: one document, switchable views —
not two destinations.

**Layout.**
- One header: episode picker, logline, stats (scenes/shots/lines/runtime),
  progress ring, and a **Script | Board** segmented view toggle.
- **Script view** = current Writers Room center (title block, sluglines, shot
  blocks, dialogue lines).
- **Board view** = current Studio kanban (five status columns, scene tabs).
- **Left rail merges**: episode outline (Writers Room) on top, bible
  Characters/Locations (Studio) below — both are navigation into the same doc.
- **Right rail merges**: the shot inspector (Studio) when a shot is selected;
  the Writers-room AI panel (premise, Draft outline, Write script, latest from
  the Director) when nothing is selected. Same slot, selection-driven — same
  pattern the new Timeline inspector uses.
- Selection is shared: click a shot in Board, switch to Script, the same shot
  block is scrolled/highlighted.

**Considered and rejected:** folding Storyboard in here too as a third view
(script / board / frames — all three do edit the same data). Rejected because
Storyboard's job is *generation* (keyframes, takes, seeds) and it needs the
Director chat beside it; Studio's job is *writing and planning*. Merging by
data model instead of by workflow would recreate the current problem — the
tool you need is always on the other route.

**Resulting nav** (was 5 sections / 13 routes → 11):
- Direct: **Director** (chat + board)
- Story: **Studio** (script + kanban views), **Bible**
- Labs: Image · Voice · Music · Video
- Assemble: Timeline · **Formats**
- Manage: Assets · Jobs

## 3. Formats — making it intuitive. ✅ SHIPPED 2026-08-06

What a format *is* (a videofast recipe: pipeline stages + paradigms + style
pack + duration) is currently explained by fine print and jargon chips. The
fixes, in impact order:

1. **Flip the primary action.** "Create now" (enqueue immediately) becomes the
   gold-gradient primary; "Refine with the Director" (chat seed handoff)
   becomes the ghost secondary. The fast path is the product; the chat is the
   escape hatch.
2. **Replace the fine-print override chain with a visible "recipe stack".**
   A vertical 3-layer summary in the create panel: **Format** (what it
   contributes: structure, stages) → **Style pack** (look) → **Channel preset**
   (voice, branding, aspect). Each layer one row with its contribution in plain
   words; overrides read top-down. Kills the "which setting wins?" confusion.
3. **Per-format fields, labeled.** The quote format silently swaps Topic for
   "The quote" + Attribution. Make the input block schema-driven and *titled*
   ("This format asks for:") so swapping fields reads as intent, not a glitch.
4. **Humanize paradigms.** Bare ids (`dataViz`, `figure2d`…) become chips with
   icon + plain name + one-line tooltip ("Charts & counters", "2D character
   scenes"). Collapse the whole row under "How it's built" — it's informative,
   not a decision the user usually makes.
5. **Blend tile gets a home.** It currently only appears under All + empty
   search. Make Blend a persistent header action next to "Create with AI", not
   a tile that vanishes when you filter.
6. **Close the loop after enqueue.** Replace "Watch it in Jobs" with an inline
   progress card on the format tile itself (thumbnail, stage, %, ETA), matching
   the Video Lab queue-panel pattern. Finished runs stack under the format as
   "Recent runs" with poster thumbnails — formats become a place you return to,
   not a fire-and-forget form.
7. **Gallery hover = recipe peek.** Hovering a poster reveals the tagline +
   3-word stage chain + duration range, so browsing teaches what each format
   does before opening the panel.

### 3b. Build notes — 2026-08-06

All seven fixes shipped, mockup `formats-v2.jpg` with v1's two grafts. The
screen was 1145 lines in one file; it is now `screens/Formats.tsx` (a 60-line
composition) over `screens/formats/{gallery,create,blend,shared}.tsx`, on the
2026-08 primitives (`ScreenHeader`, `SectionLabel`, `inputCls`, `Slider`,
`Modal`) instead of the bespoke classes it predated.

What each fix became:

1. **Create now is the primary.** One gold gradient button, full width, with
   "Refine with the Director" as a ghost under it. Both panels share the
   footer (`CreateFooter`), so the hierarchy can't drift apart again.
2. **The recipe stack** — three rows joined by a vertical gold line, each
   naming its *current value*: "Format — structure & pacing / Data Story",
   "Style pack — the look / Kurz Flat", "Channel preset — voice & branding /
   strategy-pro". Every row expands in place into its own picker, which is
   where the format's recipe paragraph + full 9-stage chain now live, and
   where the "which setting wins?" sentence sits: the two layers above
   override the channel's own format and look for this run.
3. **Per-format fields, labelled.** `FormatCard.asks` (data/formats.ts) gives
   every format its own `{ label, placeholder, extra? }`; the block is titled
   "This format asks for:". Quote asks for The quote + Attribution, Data Story
   for The claim, Math Explainer for The maths, Metaphor for "The idea to make
   felt". `extra` maps to the run's `titleHint` (the third topics-CSV cell) —
   the same wiring the quote format always had, now schema-driven instead of
   an `id === "quote"` branch.
4. **Humanised paradigms.** `d3Data` renders as an icon + "Charts" + "animated
   data stories — quantity, trend, comparison", inside a collapsed "How it's
   built". Formats with no paradigm menu say so in a sentence rather than
   showing an empty row.
5. **Blend is a header action** next to "Create with AI" — always reachable,
   no longer a tile that disappeared the moment you filtered or searched. Its
   panel was rebuilt on the same grammar (stack → titled ask block → footer),
   with the mix as the stack's top layer.
6. **The loop closes on the tile.** `useFormatRuns()` buckets every videofast
   job by `payload.format` (or the blend, when the run carries a hand-authored
   brief — those all enqueue as `strategist` and would otherwise pile onto
   that tile). A rendering format wears a gold bar and "Render · 62% · 2 min
   left" in-frame; finished runs sit under it as a "Recent runs" strip of
   video thumbnails, resolved by matching the job's imported `output`
   basename against the library. Clicking one plays it in the house modal.
   The create panel shows the same runs as an "In flight" list, so the ack
   after pressing Create now is a live progress bar, not "watch it in Jobs".
7. **Hover = recipe peek.** The exit-video headline in serif italic, the
   tagline, the `script → scenes → render` chain, and a chip naming the
   format's visual languages.

Departures from the mockup (and why) are written up in the mockup folder's
`DECISIONS.md` §Formats: no per-tile duration chip (it would print the same
25–45s on all ten), the poster headlines kept, the peek carrying its own
scrim so light packs stay readable, and recent runs playing in place.

**Two sample-data jobs** were added (`data/sample.ts` j6/j7 — one running
videofast run, one finished) so the gallery's progress band and Recent runs
strip still have something to draw when the core is dead, the same way every
other screen's placeholder set works. `Job.payload` in the sample mirror is
now the core's own `JobPayload`, so a sample job stays assignable everywhere
a live one goes.


## 4. Bible polish — the three v2 adopts. ✅ SHIPPED 2026-08-06

**First pass got this wrong.** DECISIONS' "v1 is closest to the live app" was
read as "the live app *is* v1", so only the three v2 grafts were built. Held
side by side, the centre column was nothing like the mockup: no hero portrait
card, no turnaround section, references as a horizontal strip, and the
character's prose stuffed into two cramped right-rail textareas. The lesson is
literal: **put the mockup and a screenshot of the live screen next to each
other before deciding what's left to build** — "closest to" is a ranking
between mockups, not a statement about the app.

The centre column is now laid out as v1 draws it:

- **Breadcrumb** `Bible / Cast / <name>` replaces the big `<h1>`, which moved
  onto the hero card.
- **Hero portrait card** — the canon key ref at 3:4 with a scrim, the name in
  serif over it and the gold `ROLE · SPECIES` meta line the cast rail echoes.
- **Turnaround** gets its own titled panel (falls back to the sheet slot). For a
  seeded cast it's empty — the char-sheet pipeline makes S1 frames, not
  turnarounds — so the empty state names the slot to set instead of hiding.
- **References as a grid** with the count, the gold "+", and the mockup's
  circular "Upload reference" tile; selecting a thumbnail exposes the slot
  buttons under it (which slot a picture holds is the only control here that
  changes what actually renders).
- **Personality / Speech pattern / Delivery notes** are full-width centre cards
  — serif heading, prose set to be read, an `Edit` pencil that swaps in the
  textarea. Reading is the common case; the seeded prose is already right.
- **Appearance & identity anchors** keeps the six slots + three anchors the
  mockup omits — `composeKeyframePrompt` is built out of exactly those strings.
  Role and species are editable inputs here; **species previously had no editor
  anywhere**, it was a read-only chip.
- **Right rail is production state only:** Voice (serif title, waveform, engine
  select, full-width gold Play, cast/engine chips, tuning sliders) over LoRA.
  The LoRA card takes v1's *shape* but not its telemetry — there is no training
  run to report a percentage for until S-P2, and a fake 87% bar is the same lie
  the Director's "Confidence 87%" was rejected for.

Verified in Chrome against the live core: Sterling and Grant both render, Edit
toggles to a counter-bearing textarea and back, no console errors.

The three v2 grafts, built in the first pass:

- **Role subtitle.** New `role` field on `bibleCharacterSchema` (defaults to
  `""`, so every existing `bible.json` parses unchanged). The cast rail's
  second line is now `ROLE · species` — letterspaced caps for the role, species
  after it, species alone when there's no role. All ten seeded characters got
  a role in `animalSitcomSeed.ts` (Lead / Coach / Comic engine / Gentle giant /
  Visionary / Sarcastic foil / Strategist / Guarded survivor / Diva / Wise
  elder) — lifted from the opening clause each `personality` already carried.
  Existing projects pick them up on **Re-run seed**; until then the field is
  empty and the rail falls back to species.
- **Where role is edited:** the character header's `CHARACTER PROFILE` subtitle
  became a transparent input in that exact type, so the line is edited where
  it's read. It's the only place the field appears, and inventing a "Role" box
  in the appearance grid would have put identity data among wardrobe fields.
- **CANON tag.** One `CanonTag` component now serves both halves of the screen:
  the character's key ref (thumbnail strip *and* the big preview — it replaces
  the crosshair dot, which said the same thing in a language you had to learn)
  and the location's first still, which already had an inline copy of the same
  pill. Its tooltip says what canon buys you: the reference every keyframe and
  shot prompt is built from.
- **Cast-rail portraits — the mockup caught a real bug.** bible-v1 draws a
  circular portrait per cast row; the live rail drew letter initials for the
  entire cast. The avatar read `hero ?? turnaround ?? sheet`, and the seed
  fills **`keyframeRef` + `frames`** — none of those three — so every seeded
  character missed. It now takes the first entry of `refEntries(c.refs)`, the
  same canon-first precedence the reference strip uses.
  Second half of the fix: the refs are full-body S1 frames, unreadable at 40px,
  so the image is magnified (`origin-[50%_14%] scale-[2]`) to sit on the head
  band. One crop can't frame a giraffe and a penguin equally well — the real
  fix is a head-shot frame per character out of the char-sheet pipeline
  (there's currently only `*-gpt-S1/self/v1`, all full-body), which is a
  content task, not a UI one.
- **Gold "+" on section headers.** Shared `AddButton` — rail header (holds the
  gold while its add-a-name form is open), References, and location Reference
  stills. The References header's ghost **Upload** button went away with it:
  with a "+" on the header, an "Add" tile in the strip and a drop zone in the
  empty state, a fourth upload control was noise. The "+" carries the uploading
  spinner the ghost button used to.

---

## 5. Voice lab polish — mockup v1 + the three v2 grafts. ✅ SHIPPED 2026-08-06

Screenshot next to `voice-lab-v1.jpg` first, per §4's lesson. The live screen
had all the *features* and none of the mockup's shape: engine hidden in a
header dropdown, an unnumbered script box, a clone drop zone eating the middle
of the canvas, and two side-by-side primary buttons with the irrelevant one
dimmed to 40%.

**Centre column is now the numbered flow the mockup draws.**

- **Header** — serif name at 28px with an inline pencil; kind chip, `RVC ready`
  pill / `Training RVC…` / the Train-RVC button on the right. It wraps to a
  second line rather than crushing the name when the column is narrow.
- **SPEAK | CONVERT sits directly under the header**, first thing in the
  column. The mockup parks it at the bottom, under the player; but it's the
  biggest branch on the screen — it decides what ①②③ contain and what the
  primary button does — so putting it last read like a footnote to the player
  rather than the switch governing everything below it.
- **The take player moved to the bottom**, under ③ and above the primary
  button. As the mockup draws it (hero card at the top) the column reads
  output → input → action, which is backwards for a creation flow; this way it
  reads write → configure → generate → hear. It also settles which of the
  screen's *two* players is which: this one is "the take you just made", the
  bar pinned to the window is "whatever is playing". Gold play button, big
  waveform, `0:00 / 0:12`, download; click the waveform to scrub, and the
  length shows *before* you press play, probed off the file.
- **① Script ② Engine ③ Delivery**, on the shared `SectionLabel step=` badge.
  Engine is a chip row — the whole roster stays visible, which is exactly what
  the review rejected v2's single dropdown for; engines that aren't installed
  are dimmed and say so. Delivery uses the house `Slider`, not a raw
  `accent-gold` range input. DramaBox keeps its own knob panel under ③.
- **Script stays ①, engine ②** — deliberately, against the obvious "configure
  before you write" reading. Engine is the only control that changes what the
  others *are* (DramaBox swaps Pace/Emotion for CFG/STG/Seed) but it's sticky:
  set once, then many lines written against it. Script is touched every single
  time. Opening on a chip row you rarely change, with the box you always type
  in pushed below it, lengthens the common path to serve the rare one. The
  dependency that argues for engine-first is fixed *in place* instead:
  DramaBox's stage-direction rule (`[brackets]` are performed, not spoken) now
  prints under the script box, where the writing happens, rather than down in
  ③ where it used to hide.
- **Convert mode gets the same three steps** — ① Source audio (drop zone +
  From-library picker), ② Engine (Seed-VC · local / RVC · cloud cards with why
  they're unavailable), ③ Delivery (Speech|Singing, pitch chips, steps,
  semitones).
- **One primary button per mode**, full width, disabled with a `title` that
  says *why* ("Write a script first"). ⌘/Ctrl+↵ in the script box generates.

**Rails and transport.**

- **Voices rail** — mini-waveform signature per row (hover the avatar to play
  the reference clip), compact kind/RVC chips, and the gold **Clone a voice**
  button in the footer, which is also a drop target. That let the centre's
  clone drop zone go, which is where the "roomier vertical rhythm" came from.
  The selected voice scrolls itself into view — with 18 voices it was usually
  off-screen.
- **Takes rail** — waveform per take, a real duration, a star, a ⋯ menu
  (download / delete / size on disk), a **Starred** filter, and **Load more
  takes · N** at 12 a page. The hook's take list went from a hard `slice(0,14)`
  to 120 with the paging in the view, so takes older than a day or two stopped
  being silently invisible.
- **Player bar** — prev/next walk the rail, the scrubber and the volume slider
  are draggable, and the **1.0× playback-speed menu** is the v2 graft. Volume,
  mute and speed persist (`aurea.audioPrefs`) — `useAudioPlayer` grew
  `seekFraction`/`nudge`/`setVolume`/`toggleMute`/`setRate`/`pause` to serve
  them, so Music lab inherits persisted volume for free.

**Two deliberate departures from the mockup** (both in DECISIONS.md): a single
star instead of a fake 5-star rating, and probed durations instead of the file
size the rail used to print in the duration slot.

**One shared-primitive bug the redesign surfaced:** `Waveform`'s bars were
`w-[2px]` flex children, so in a container narrower than `bars × 4px` they were
flex-shrunk to nothing — the whole waveform vanished instead of clipping. They
are now `min-w-[2px] flex-1` inside an `overflow-hidden` row, so a waveform
fills its box at any width. Music lab's track rows benefit too.

Verified in Chrome against the live core: 18 voices, 47 takes, playback with
the clock and gold fill advancing, star + speed surviving a reload, the ⋯ menu,
the Starred filter, Load-more paging, and Convert mode's disabled-with-reason
state. No console errors.

---

## 6. Music lab polish — mockup v1 + v2's four grafts. ✅ SHIPPED 2026-08-06

Screenshot beside `music-lab-v1.jpg` first, per §4's lesson — and it paid
again. The column structure was already right (create rail → tracks →
inspector), so the gap wasn't layout, it was that **every track was a
filename**: rows read `german-party-rock-duet-male-and-female-voc-2`,
`convert-to-hakan-2`, with no date, no styles, no picture, and a hard cap of
12. The mockup's "boutique listening room" and the live screen's directory
listing were the same screen with one difference — the live one had thrown
away everything a track is called.

`MusicLab.tsx` is now `screens/music/{create,tracks,inspector,player,shared}.tsx`
behind a 47-line orchestrator, matching director/studio/video.

**A track has a name again** — the round's real fix, and it's provenance, not
CSS. Three new `assetMetaSchema` fields (`title`, `styles`, `cover`) written
at import; every existing `bible.json`/sidecar parses unchanged because all
three are optional.

- `title` is cut from the description at the first clause break and **never
  mid-word** — deliberately *not* `job.title`, which is clipped to fit a queue
  row and produced "A short bright ukulele sting, cheerful sitc…". Tracks that
  predate the field fall back to their filename **de-slugged** (`unslug()` in
  the hook), so the back catalogue reads as sentences too.
- `styles` are kept apart from the caption so a row can show them as chips.
  They used to be dissolved into the ACE-Step prompt and unrecoverable.
- Date **+ time** per row (v2's graft): an evening of composing yields a dozen
  tracks that all say "Aug 6".

**Cover art — the round's only backend touch.** A finished song enqueues its
own picture:

- `imagePayloadSchema` gains `cover` (the track's relPath), modelled exactly on
  `board` — a "where does this belong when it lands" address, not a render knob.
- `Labs.coverArtJob()` builds it: whichever local generator is installed, 1:1,
  one image, an explicit *no lettering* prompt (an image model writing a band
  name gives you the misspelled-poster look), at **`batch` priority** — it must
  never make you wait behind your own picture for the next thing you asked for.
  Returns `null` when no engine is installed: a cover is a nicety, and a failed
  job card is a worse outcome than a track keeping its gradient tile.
- `server.ts` fires it on the **finished** song. When a cloned-voice conversion
  is chained (§ the singVoice pass), the music job *skips* the cover and the
  conversion's own import fires it instead — otherwise one song gets two.
- `ProjectStore.patchMeta()` is new: provenance is normally written once at
  import, but the picture lands minutes after the track, so it has to merge in
  afterwards.
- A manual re-roll (`labs.music.cover`, `interactive` priority) sits in the
  track's ⋯ menu and the inspector — covers are generated unasked, so there has
  to be a way to say "not that one", and it's also how tracks predating the
  feature get one at all.
- Covers are filtered out of the **Image lab** roll by `origin: "musicCover"`
  (both the in-flight job and the landed file, or the roll grows a phantom
  tile). They stay in **Assets**: it's a real file, it just isn't image-lab
  *work* — the same reasoning that keeps uploaded refs out of the asset roll.

**A bug the cover chain exposed.** `writeMeta` inherited the source's metadata
whenever `meta.source` was set — written for "a re-voiced song is the same
song", but `source` also means "the still this was enlarged from" and now "the
track this picture is art for". The first cover generated came out carrying the
song's German lyrics, tempo and key: a PNG claiming to have a second verse.
Inheritance is now gated on `origin === "voiceConvert"`. Two tests added
(`provenance.test.ts`, 9 passing).

**The rest of the screen, against the mockups:**

- **Rows** are the mockup's: cover tile, serif title, arrangement + style
  chips, duration, star, ⋯, waveform, date+time. Play lives **on** the cover
  rather than beside it — two 40px targets in a row is what both mockups draw,
  but the picture is the obvious thing to press and folding them gave the title
  its width back. The resting glyph needed its own dark chip; bare, it vanished
  into whatever the artwork happened to be.
- **Star + Starred filter**, on the same `useLikes` store as Voice lab and the
  Asset library — `MusicTrack.starred` had existed as a *rendered* field that
  nothing ever set. Dead flag deleted from the sample data too.
- **The 12-track cap → 120 with "Load more tracks · N"** at 15 a page. Same bug
  class as the Voice lab's `slice(0,14)`: everything older than an afternoon
  was silently invisible.
- **Inspector sections are stacked with chevrons, not tabs** — as v1 draws
  them. Lyrics and the Brief that produced them are what you read together, and
  tabs made the second one cost a click and a guess. Open/closed persists.
- **Send to timeline takes the gold and Download shrinks to a glyph** — the
  same hierarchy flip as Formats §3.1: placing the track on the sequence is why
  you made it; a wav on disk is the escape hatch.
- **A player bar**, pinned under all three columns. Voice lab grew one for
  4-second takes; a *three-minute* track that you can only start and stop isn't
  something you can listen to. Prev/next, drag-scrub, elapsed/total, volume,
  the 1.0× speed menu — and the row waveform scrubs too. Volume/mute/speed come
  from `useAudioPlayer`'s shared prefs, so the two labs agree without either
  owning the setting. `ScrubBar` was promoted out of VoiceLab into
  `components/ui/` rather than copied.
- **Create rail on the shared `SectionLabel step=` badges** (it still carried
  its own `PanelLabel`, the duplicate SectionLabel was written to replace), the
  house `Slider` instead of raw `accent-gold` ranges, and duration **presets**
  (30s · 1m · 90s · 3m) over the slider. 90 is "90s", not "1.5m".
- **The numerals count what's on screen.** Lyrics is vocals-only, and with it
  hidden the rail read 1·2·3·4·**6** — a numbered list with a gap in it says a
  step went missing, not that it doesn't apply.

Verified in Chrome against the live core: 26 tracks with real names, dates and
durations, star + Starred filter, Load-more paging, the stacked inspector, the
transport, **and both cover paths end to end** — the manual re-roll on a legacy
track, and the automatic chain on a freshly composed one (job enqueued at batch
priority, waited on VRAM as designed, landed, patched the sidecar, appeared in
row + inspector + player bar). No console errors. `typecheck:core`, the desktop
tsc and the production build all clean.

Gotcha worth keeping: the cover job correctly parked on **"Waiting for VRAM —
needs ~14 GB, 2.3 GB free"** because ComfyUI was holding the card. `POST
:8000/free` wasn't enough — the *second* ComfyUI on :8188 had it. Free both.

### 6b. Follow-up pass, same day — four review notes

- **Lyrics moved up, by moving Arrangement up.** The rail now reads
  description → **arrangement → lyrics → cloned voice** → style → duration.
  Lyrics couldn't rise on its own: Arrangement is the switch that *reveals*
  it, and a field sitting above its own toggle appears out of nowhere from a
  control below it. So the branch moves and takes its dependants with it —
  the same call §5 made putting SPEAK|CONVERT at the top of the Voice lab.
  The settings you set once (style, duration) sink below the box you retype
  every run.
- **MP3 as well as WAV.** New `library.transcode` (ffmpeg, LAME VBR ~190k),
  writing to **`<dataRoot>/exports/`** — deliberately outside the
  `projects/*/assets` tree the scanner walks, because an mp3 of a track you
  already have is a copy to send someone, not a second take, and filing it as
  an asset would put a duplicate row in the Music lab under the track's own
  name. It's a cache: reused unless the source is newer. Both formats sit in
  the row's ⋯ menu and behind the inspector's download glyph. Verified: 8s
  track → 171 KB mp3 vs 3.0 MB wav, downloaded as
  `A short bright ukulele sting.mp3`. ffmpeg-not-on-PATH gets its own message
  rather than a bare ENOENT.
- **The play button stopped moving.** It was a small corner glyph at rest and
  a gold disc in the centre on hover, so the target appeared to jump as the
  pointer arrived. One button, dead centre, in every state — only its
  *weight* changes (quiet disc → gold). Covers went 56 → 76px in rows and the
  inspector tile now plays too, which let the header's third control move
  down into Details, where a two-line serif title had been crushing it.
- **The waveform was the clumsy part.** One sine plus per-bar noise on a 0.25
  floor gave a repeating comb of near-equal fat bars — no dynamics, a visible
  period every ~18 bars, and rounded caps that turned short bars into a row
  of dots. Now: a fade envelope × two incommensurate slow waves (phrase and
  beat, so nothing lines up twice) × fine grit, floor 0.05, accents every few
  bars, seeded phases so no two tracks draw the same curve. Bars over 80 get
  hairline widths and 1px gutters; caps are 1px, not full-round. Tuning notes
  worth keeping: a gentle fade-out (`(1-p)*7`) reads as *the track ending
  early* — 14% of 140 bars is 20 flat bars hanging off the end — and a deep
  phrase swell (0.58 + 0.42) does the same wherever its trough lands. Landed
  on `(1-p)*16` and `0.68 + 0.32`. Voice lab's 54-bar rows inherit the
  improvement.

---

## Mockup prompts — next batch

Same procedure as 2026-08-05: generate as concept/mood images, review against
tokens, write ADOPT/REJECT into a DECISIONS file. Shared style block is baked
into each prompt so they can be pasted standalone. Brand every screen "AUREA";
mockups that invent nav items will again be treated as moodboards, not specs.

### Shared style (prefixed to every prompt)

> High-fidelity desktop application UI mockup, 16:9, dark luxury editorial
> aesthetic. Near-black ink background (#0a0a0b), matte charcoal surface panels
> (#141416), slightly raised card tier (#1c1c1f) with hairline 1px borders,
> warm antique-gold accent (#c9a96e) used sparingly, cream/ivory text.
> Elegant contemporary serif for headings (Fraunces-like, editorial not
> old-fashioned), clean grotesque sans for body/UI (Inter-like). Primary
> buttons use a vertical cream-gold to deep-gold gradient. Slim left icon
> rail navigation with tiny letter-spaced section labels. App wordmark
> "AUREA". No user avatars, no share buttons, no collaboration chrome —
> single-user professional tool. Crisp, realistic, production-grade UI.

### Prompt 1 — Director (chat + storyboard combined)

> [shared style] Screen: "Director" — an AI filmmaking copilot. Two-pane
> layout like a code editor with an AI chat. LEFT PANE (~1/3 width): chat
> thread with the AI Director — user and assistant message bubbles, one
> assistant message showing a "tool call card": monospace tool name
> "generate_keyframes", a small parameter table (shot, style, seed, takes), a
> green success check and a thin progress bar. Below it an inline image result
> card with two small keyframe thumbnails and "Approve & save" gold button.
> At the bottom a composer: text input, small model-picker chip, paperclip
> attach icon, gold gradient send button. Above the composer a small context
> chip reading "S01-02 · The Loft ×". RIGHT PANE (~2/3): the storyboard —
> horizontal rows per scene, each row titled "SCENE 01 — INT. THE LOFT —
> NIGHT" with wide cinematic keyframe cards: image thumbnail, a very large
> elegant serif shot numeral overlaid in the corner, shot code "S01-02",
> a small status pill (Draft / Boarded / Generated / Approved in different
> muted colors), takes count. One card shows a rendering overlay with a
> circular progress. One selected card has a gold ring and a slide-over
> inspector panel overlapping the right edge: larger keyframe preview, a
> "Takes (4)" thumbnail grid with a star on the best take, a prompt text
> area, seed and aspect controls, and a gold primary button "Send to Video
> Lab". Header: episode dropdown "S01E01 — Pilot" and a small "Boarded 9/14
> shots" progress readout. Top status bar strip shows GPU name, VRAM meter,
> and "2 rendering · ETA 4 min".

### Prompt 2 — Studio (screenplay + production board combined)

> [shared style] Screen: "Studio" — one episode document with two switchable
> views. Header: episode dropdown "S01E01 — Pilot", a logline in italic serif,
> stats row "4 scenes · 14 shots · 32 lines · ~3:40", a small gold progress
> ring "9/14 approved", and a prominent segmented toggle "SCRIPT | BOARD"
> with SCRIPT active. LEFT RAIL: "Outline" — scene list (INT. THE LOFT —
> NIGHT, EXT. ROOFTOP — DAY...) each with shot chips; below it a "Bible"
> section listing character names with tiny portrait thumbnails and
> locations. CENTER: a beautifully typeset screenplay page on a slightly
> lighter panel — centered serif title block, uppercase sluglines, action
> paragraphs in sans, dialogue blocks with centered character names in small
> caps, parenthetical delivery notes in italic; one dialogue block is
> highlighted with a soft gold left rail indicating selection. A faint ghost
> of the alternate BOARD view can appear as a second smaller frame in the
> mockup: five kanban columns labeled Draft / Boarded / Generated / Synced /
> Approved containing small shot cards with keyframe thumbnails. RIGHT RAIL:
> "Writers' room" AI panel — a premise textarea, two buttons "Draft outline"
> and "Write script" (gold gradient), a live status line "The Director is in
> the room…" with a stop button, and a "Latest from the Director" summary
> card. Editorial, literary, precise — a screenplay app that feels like a
> hardcover book inside a professional dark UI.

### Prompt 3 — Bible (cast, locations, style)

> [shared style] Screen: "Bible" — the canon reference for a show. LEFT RAIL:
> three tabs "CAST / LOCATIONS / STYLE" with CAST active; a list of character
> names (Sterling, Alli, Silas, Valentino, Omar…) each with a tiny circular
> portrait, an inline "+ add" field at the bottom. CENTER: a character detail
> page like a luxury lookbook spread — large hero portrait card of a stylized
> 3D animal character, a horizontal "turnaround" strip of 5 small poses
> beneath it, a "References 6/9" thumbnail grid with one marked "CANON" in a
> small gold tag and an upload tile. Below: elegant titled sections
> "Personality" (a paragraph of prompt text in a soft editable panel),
> "Speech pattern", "Delivery notes" — each a card with a serif section
> heading. RIGHT RAIL: a "Voice" card showing a waveform, voice engine chip
> "Chatterbox", a play button and "RVC ready" status pill; below it a "LoRA"
> card with a training status bar and version tag. The whole page should
> feel like a character's page in a beautifully printed production bible —
> museum-catalog typography, generous whitespace, gold hairline dividers.

### Prompt 4 — Voice Lab

> [shared style] Screen: "Voice Lab" — text-to-speech and voice conversion
> studio. LEFT PANEL "Your voices": rows of voice cards (name, small
> waveform glyph, kind chip "cloned" or "preset", one row selected with gold
> edge), a gold "Clone a voice" button and a subtle "Voice marketplace"
> entry. CENTER: large voice header (editable serif name "Sterling"), status
> pill "RVC ready"; a big audio take player — elegant rounded waveform in
> gold on charcoal, play button, timestamp; beneath it a numbered creation
> flow: ① Script — a roomy textarea with character counter, ② Engine — a
> dropdown chip row (Chatterbox · Fish S2-Pro · VibeVoice · Kokoro), ③
> Delivery — two sleek sliders labeled Pace and Emotion with gold thumbs; a
> gold gradient "Generate speech" primary button. At the bottom a segmented
> mode switch "SPEAK | CONVERT"; in a small secondary frame show CONVERT
> mode: source-audio drop zone, engine choice cards "Seed-VC · local" vs
> "RVC · cloud", and pitch chips "Auto match / Keep / Oct− / Oct+". RIGHT
> RAIL "Takes": a history list of generated takes with star ratings, small
> waveforms, durations, per-take menu; a persistent slim player bar pinned
> to the bottom. Feels like a high-end recording studio console rendered as
> a refined dark UI.

### Prompt 5 — Music Lab

> [shared style] Screen: "Music Lab" — AI music generation studio. LEFT
> PANEL "Create", numbered collapsible steps with small gold numeral badges:
> ① Song description (textarea), ② Style (genre chips: cinematic, lo-fi,
> orchestral, synthwave), ③ Duration (chip row 30s/60s/90s/3m), ④
> Arrangement (Instrumental | Vocals toggle), ⑤ Lyrics (textarea with a
> "[verse] [chorus]" structure hint), ⑥ Cloned voice (dropdown "No
> conversion — ACE-Step vocals"); a discreet "Advanced" row of tiny fields
> (BPM, Seed, Key, Time signature); gold gradient "Compose" button. CENTER
> "Generated tracks": a list of elegant track cards — title, style tags,
> duration, a long thin gold waveform, play button, date; the top card shows
> a generating state with an animated progress shimmer; sort control
> "Newest" and a filter chip. RIGHT RAIL inspector for the selected track:
> "Lyrics" panel with the sung text, "Brief" showing the original
> description, a "Stems" section with per-stem rows (Vocals, Drums, Bass,
> Other) each with a mute toggle and a small gain slider, and two actions
> "Send to timeline" (gold) and a download icon. The vibe: a boutique
> record-label listening room — vinyl-era editorial elegance on a modern
> dark interface.

### Prompt 6 — Formats (redesigned gallery + recipe stack)

> [shared style] Screen: "Formats" — a gallery of one-click video recipes.
> HEADER: serif title "Formats", a search field, category pills (All ·
> Motivational · Data story · Explainer · Cinematic · Strategist), and two
> header actions: a ghost "Blend formats" button and "Create with AI".
> CENTER: a poster grid of tall format cards — each a cinematic poster
> image with the format name in serif over a soft gradient scrim; one
> hovered card reveals a peek overlay: one-line tagline, a tiny 3-step
> pipeline chain "script → scenes → render", and a duration range chip. One
> card shows an inline progress state: thin gold progress bar, "Rendering ·
> 62% · 2 min left" and a small "Recent runs" strip of two tiny finished
> thumbnails under it. RIGHT PANEL (create panel, ~1/3 width) for the
> selected format "Data Story": its poster up top, then a clearly labeled
> "RECIPE STACK" — three stacked layer rows connected by a thin vertical
> gold line: "Format — structure & pacing", "Style pack — the look" (with a
> small style thumbnail and change chevron), "Channel preset — voice &
> branding"; then a titled input block "This format asks for:" with a Topic
> field, a Duration chip row, and a collapsed "How it's built" disclosure
> showing friendly paradigm chips with icons ("Charts & counters", "2D
> scenes"). Bottom: a large gold gradient primary button "Create now" and a
> ghost secondary "Refine with the Director". Confident, curated, like a
> streaming service's catalog crossed with a print design annual.

---

## Mockup verdicts — 2026-08-06 (picked winners + cross-version adopts)

The prompts above were run same day, **two options per screen**, saved as
`2026-08-06-ui-mockups/{screen}-v1/v2.jpg` — full review in that folder's
`DECISIONS.md`. The picks, with what gets grafted in from the losing version:

| Screen | Winner | Grafted from the other version |
|---|---|---|
| Director | **v1** | Calmer top header (episode chip + quiet "Boarded 9/14"); wide cinematic scene strips as the zoomed-in board density; Aspect control next to Seed; in-frame "62% · Rendering" text |
| Studio | **v1** | Shot-count badge per outline scene; one-line character description in the Bible rail; **bottom docked mini-kanban "board peek" strip** — prototype vs. the hard Script\|Board toggle before committing |
| Bible | **v1** | Role subtitle under cast names (Protagonist / Antagonist…); gold **CANON** tag on the canonical reference still; gold "+" affordance on section headers |
| Voice Lab | **v1** | Roomier vertical rhythm; char counter under the script field; **1.0× playback-speed control** in the bottom player bar |
| Music Lab | **v1** (narrow) | **Cover-art thumbnails per track** — auto-generate a poster via a low-priority Image-lab job on track completion, style-pack gradient tile until then; date+time metadata; "Generating your track…" status line; per-stem toggle switches |
| Formats | **v2** | Larger serif poster titles; checkmark-selected state on the active tile |

Why v1 swept the first five: each hewed closest to the planned structure and
the real feature set (Director v2's fixed third-column inspector violates the
slide-over decision; Bible/Voice/Music v2s traded information for ornament).
Formats v2 won because it's the only mockup implementing the full §3 plan —
Blend button in the header, recipe stack with *named* values (Data Story /
Metrics Noir / Business Pro), described paradigm rows, Create-now as primary.

Standing rejections (all mockups): invented nav destinations, "Pro Plan" SaaS
badges, photoreal human cast, fake "Confidence %" scores on Director notes.

## Suggested order

1. ~~Generate the six mockups~~ DONE — 12 images in `2026-08-06-ui-mockups/`.
2. ~~Review → DECISIONS file~~ DONE — verdicts above + in that folder.
3. Build order: ~~Formats quick wins (§3 items 1–5 are cheap)~~ →
   ~~Studio merge (mostly recomposition of existing panels)~~ →
   ~~Director merge (needs the inspector slide-over + status-bar strip)~~ →
   ~~Bible polish (§4)~~ → ~~Voice lab polish (§5)~~ → ~~Music lab polish
   (§6)~~ — **the round is complete**; all six screens shipped 2026-08-06.
