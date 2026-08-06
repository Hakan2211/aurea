# UI Mockup Review — 2026-08-06 (round 2)

Twelve AI-generated mockups, **two options per screen**, generated from the
prompts in `../2026-08-06-route-merges-and-mockup-prompts.md` (which also holds
the route-merge decisions these screens assume: Director+Storyboard merged at
`/`, Studio+WritersRoom merged with a Script|Board toggle, Formats recipe-stack
redesign). Same ground rules as round 1: unify under existing Aurea tokens
(ink/surface/raised, gold #c9a96e, Fraunces + Inter); mockups are moodboards,
not specs; invented nav items are ignored, not built.

**Standing rejections that recur across almost every mockup:** invented
sidebar destinations (Look Dev, Shot List, Scout, Research, Inspiration,
Analytics, Channels, Worldbuilding…), "Pro Plan / Unlimited renders" SaaS
badges, photoreal human cast in Studio (our cast is stylized-3D animals).
Not repeated per screen below.

---

## Director — chat + storyboard. **WINNER: v1** (`director-v1.jpg`)

v1 nails the planned structure almost exactly: chat pane left with the
`generate_keyframes` tool-call card + inline keyframe result + shot context
chip above the composer; board canvas right as horizontal scene rows; the
S01-05 inspector as a **slide-over** (takes grid with starred best take,
prompt, seed, gold "Send to Video Lab"); top status strip with GPU · VRAM ·
"2 rendering · ETA". The giant serif numerals over the keyframes are the
signature — keep them at that scale.

v2's inspector is a *fixed* third column — exactly what the plan rejected
(steals board width permanently).

**Adopt from v2 anyway:**
- The calmer top header: episode chip + "Boarded 9/14" as quiet text, no
  heavy title block.
- Wide cinematic scene strips (one dominant frame per scene row) as the
  *zoomed-in* board density; v1's card row is the default zoom.
- Aspect control sitting next to Seed in the inspector.
- In-frame "62% · Rendering" progress treatment (v1's circular overlay is
  fine too; pick one, in-frame text reads better on wide cards).

## Studio — screenplay + board. **WINNER: v1** (`studio-v1.jpg`)

The typeset cream screenplay page is the star of both — a paper-toned page
floating on ink, Courier-style body, centered dialogue blocks, gold selection
rail on the active block. v1 wins on chrome: logline in italic serif next to
the episode picker, stats row, gold 9/14 progress ring, and the centered
**SCRIPT | BOARD** segmented toggle; left rail = Outline (numbered scenes +
shot chips) over Bible; right rail = Writers' Room (premise, Draft outline /
Write script, live "The Director is in the room…" + Stop, Latest from the
Director).

**Adopt from v2:**
- Shot-count badge per outline scene ("5 shots").
- Bible rail entries with a one-line character description under the name.
- The **docked kanban strip along the bottom** while in Script view — a
  persistent mini-board (columns with counts) is arguably better than a hard
  toggle; worth prototyping as "Board peek" before committing to toggle-only.

**Shipped 2026-08-06** — all three grafts are in, Board peek built *alongside*
the toggle (episode-wide columns + counts, collapsible, remembered) rather than
replacing it; the merge itself is written up in the route-merge doc §2.

**Reject:** v2's "Confidence: 87%" on Director feedback — a fake metric; the
Director gives notes, not scores.

## Bible. **WINNER: v1** (`bible-v1.jpg`)

v1 is closest to the live app: breadcrumb `Bible / Cast / Sterling`, cast rail
with circular portraits, hero portrait card with name + `LEAD · MALE · ARCTIC
FOX` meta line, TURNAROUND strip, References 6/9 with upload tile,
Personality / Speech pattern / Delivery notes as edit-in-place cards, right
rail Voice card (waveform, Chatterbox chip, play, RVC-ready pill) over a LoRA
card with live training % + ETA + steps.

**Adopt from v2:** ✅ all three shipped 2026-08-06
- Role subtitle under each cast name (Protagonist / Antagonist / Rival…) —
  cheap and orienting.
- The small gold **CANON** tag pinned on the canonical reference still.
- Section headers with a subtle gold "+" affordance for adding entries.

**Reject:** v2's engraved ornaments, compass roses, letterspaced display
name plates — "luxury print" kitsch that fights the working-tool feel; and
its LoRA card loses the live training telemetry v1 shows.

## Voice Lab. **WINNER: v1** (`voice-lab-v1.jpg`)

v1 carries the full real surface: voices rail with mini-waveforms +
cloned/preset chips, serif voice name + RVC-ready pill, hero waveform player,
numbered ① Script ② Engine ③ Delivery flow, engine chip row (Chatterbox ·
Fish S2-Pro · VibeVoice · Kokoro), pace/emotion sliders, SPEAK | CONVERT
segment with the Convert panel (source drop zone, Seed-VC·local vs RVC·cloud
cards, Auto match / Keep / Oct± pitch chips), Takes rail with star ratings +
durations + "Load more", persistent bottom player bar.

**Adopt from v2:** the roomier vertical rhythm (v1 is dense), the character
counter placed under the script field, and the **playback-speed control
(1.0×)** in the bottom player bar. **Reject:** v2's double AUREA wordmark,
single-dropdown engine row (hides the roster), unlabeled takes.

**Shipped 2026-08-06** — build notes in
`../2026-08-06-route-merges-and-mockup-prompts.md` §5. All three v2 grafts are
in. Two deliberate departures from the mockup:

- **Star, not a 5-star rating.** Both mockups draw per-take star *ratings*; no
  such number exists (takes carried `rating: 0`, so every row rendered five
  empty stars). Shipped as a single gold star per take, persisted through the
  existing `useLikes` localStorage store — the same star the Asset library
  uses, so starring here shows up in Favourites — plus a "Starred" filter in
  the rail header.
- **Durations are real.** The rail used to print the take's *file size* where
  the mockup shows `0:12`; it now probes the file's metadata client-side
  (`useMediaDuration`, the trick Music lab already used) and the size moved
  into the per-take ⋯ menu.

Also unlike the mockup, the column is re-ordered so it reads **write →
configure → generate → hear**: SPEAK|CONVERT first (it decides what ①②③
contain), then the steps, then the take player and one primary button per mode
— replacing both the mockup's top-of-column hero player and the old pair of
buttons where the irrelevant half sat dimmed at 40%. Demoting the player also
settles which of the screen's two players is which: the card is the take you
just made, the pinned bar is whatever is playing. Script stays ① ahead of
Engine ② on frequency grounds; the reasoning is in the plan doc §5.

## Music Lab. **WINNER: v1** (`music-lab-v1.jpg`) — narrowly

v1 = the honest current surface: numbered Create rail (description, style
chips, duration, Instrumental|Vocals, lyrics, cloned-voice dropdown, Advanced
BPM/Seed/Key/Time-sig), track list with generating card pinned on top, right
inspector Lyrics / Brief / Stems (per-stem mute + gain) + gold Send to
timeline.

**Adopt from v2:** ✅ all four shipped 2026-08-06
- **Cover-art thumbnails per track** — the biggest visual lift in either
  mockup. We can auto-generate a poster per track via the Image lab (fire a
  low-priority job on track completion); until then a style-pack gradient
  tile, same trick Formats uses.
- Date **+ time** metadata per track, and the "Generating your track…"
  status line inside the generating card.
- Per-stem toggle switches read better than v1's mute icon buttons.

**Shipped 2026-08-06** — build notes in
`../2026-08-06-route-merges-and-mockup-prompts.md` §6. The cover job is built
as specced (chained on the finished song, `batch` priority, gradient tile until
it lands) plus a manual re-roll, since a picture generated unasked needs a way
to say "not that one". Three departures and one finding worth naming here:

- **The real problem wasn't visual.** Held next to the mockup, the live screen
  had the right columns and no *names*: every row was its filename
  (`german-party-rock-duet-male-and-female-voc-2`), no date, no styles. Titles
  and style chips are now kept in the provenance sidecar; the back catalogue
  falls back to its filename de-slugged. §4's lesson keeps earning its keep.
- **Play sits on the cover, not beside it.** Both mockups draw a cover tile
  *and* a play circle; folded into one, because the picture is already the
  obvious thing to press and the title needed the width back.
- **The inspector stacks, and the screen gains a player bar.** v1's stacked
  Lyrics / Brief / Stems beat the live tabs and shipped as drawn. The transport
  under all three columns is *not* in either mockup — but a three-minute track
  you can only start and stop isn't something you can listen to, and Voice lab
  already had one for four-second takes.
- **A bug the cover chain exposed:** sidecar inheritance keyed off `source`
  alone, so the first generated cover came out carrying the song's lyrics,
  tempo and key — a PNG claiming to have a second verse. Now gated to voice
  conversions, with tests.

Also fixed while here, both the same bug class the Voice lab round found: the
track list was capped at a hard 12 (now 120, paged 15 at a time), and
`MusicTrack.starred` was a *rendered* field nothing ever set (now the shared
`useLikes` store, with a Starred filter).

## Formats. **WINNER: v2** (`formats-v2.jpg`)

v2 implements the whole intuitiveness plan; v1 misses two pieces of it.
- Header: search + category pills + **ghost "Blend formats"** + gold "Create
  with AI" (v1 has no Blend button — the exact bug the redesign fixes).
- Poster grid with hover peek (tagline + `script → scenes → render` chain +
  duration chip); one tile showing live "Rendering · 62% · 2 min left" with a
  **Recent runs** thumbnail strip.
- Create panel: **RECIPE STACK with named values** — "Format — Data Story /
  Style pack — Metrics Noir / Channel preset — Business Pro" joined by the
  vertical gold line. Naming the current value on each layer is what makes
  the override chain legible; v1's stack shows the layer types only.
- "THIS FORMAT ASKS FOR:" labeled input block; **paradigm rows with
  descriptions** ("Charts & counters — make data visual and believable")
  under a collapsed "How it's built".
- **Create now** gold primary over ghost "Refine with the Director" —
  the flipped hierarchy from the plan.

**Adopt from v1:** the slightly larger serif poster titles, and the
checkmark-selected state on the active tile.

**Shipped 2026-08-06** — build notes in
`../2026-08-06-route-merges-and-mockup-prompts.md` §3. All six of v2's pieces
are in, plus both v1 grafts. Four departures worth naming here:

- **No duration chip in the gallery peek.** Both mockups draw one, but every
  format's Auto target is the same writer's-natural 25–45s, so a per-tile
  duration chip would print the same number ten times. The third peek line is
  what the format actually draws with instead — "Charts · 2D metaphors", or
  "LLM-written scenes" for the four formats with no paradigm menu.
- **The poster headlines survived.** v2's tile shows only the format name,
  which would have retired ten lines of real exit-video copy
  ("DISCIPLINE TODAY. FREEDOM TOMORROW."). They now open the hover peek in
  serif italic — the format's own voice, above the tagline that describes it.
- **The peek carries its own scrim.** The poster's title gradient is enough
  behind one serif line and nowhere near enough behind a paragraph of 11px on
  a light pack — Whiteboard (Sketchbook) and Metaphor (Therapy Minimal) were
  unreadable until the peek got a darkness of its own that fades in with it.
- **Recent runs play in place.** The strip is thumbnails of the delivered
  videos (probed off the library by the job's own output filename); clicking
  one opens it in the house modal rather than sending you to Assets to hunt
  for it.

The blend keeps its own panel behind the new header action, rebuilt on the
same grammar — its recipe stack's top layer is the mix itself
("60% Charts · 40% 2D metaphors"), and blend runs bucket under the blend
rather than piling onto the Strategist tile they all enqueue as.

---

## Build order (delta on top of the round-1 rollout)

1. ~~**Formats** per v2 — pure recomposition of the existing create panel +
   gallery; no schema changes. Quick win.~~ **DONE 2026-08-06** — notes above
   and in `../2026-08-06-route-merges-and-mockup-prompts.md` §3. It stayed a
   recomposition: no schema changes, one new read-only hook.
2. **Studio merge** per v1 (+ prototype v2's bottom board-peek strip).
3. ~~**Director merge** per v1 — needs the inspector slide-over and the global
   status-bar strip (which also serves every other screen).~~ **DONE
   2026-08-06** — build notes in `../2026-08-06-route-merges-and-mockup-prompts.md` §1.
4. ~~**Bible polish** per v1 + v2 details (role subtitles, CANON tag).~~
   **DONE 2026-08-06** — notes in `../2026-08-06-route-merges-and-mockup-prompts.md` §4.
5. ~~**Voice lab** — spacing pass + takes treatment.~~ **DONE 2026-08-06** —
   notes above and in `../2026-08-06-route-merges-and-mockup-prompts.md` §5.
6. ~~**Music lab** — tracks treatment; the cover-art job is the only new backend
   touch in the whole round.~~ **DONE 2026-08-06** — notes above and in
   `../2026-08-06-route-merges-and-mockup-prompts.md` §6. **The round is
   complete**: all six screens shipped.
