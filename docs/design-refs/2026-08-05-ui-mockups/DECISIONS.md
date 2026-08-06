# UI Mockup Review — 2026-08-05

Six AI-generated concept mockups (saved in this folder, originals from ~/Downloads).
Reviewed against the live app: `apps/desktop/src/styles/index.css` tokens
(ink #0a0a0b / surface #141416 / raised #1c1c1f / gold #c9a96e / cream, Fraunces + Inter),
the 2026-08-05 design-tokens/primitives pass, and the real feature set.

**Note:** the mockups use three different brand names (Aurelian / Aurea / Aurora Studio /
Echoes of Lumen) and two typefaces (Playfair+Satoshi vs. others). Treat them as mood
boards, not specs — we unify everything under the existing Aurea tokens.

---

## Design System.jpg — "Aurelian" component sheet

**ADOPT**
- Three named elevation levels for cards → maps 1:1 to existing ink/surface/raised; add a
  `raised-2` (or border-glow) for the "elevation 3 / focus" tier.
- Gold **gradient** primary button (vertical cream-gold → deep-gold) + distinct hover.
  Current primary is flat; the gradient is the single highest-impact "luxury" cue.
- Ghost button spec (1px gold-mix border, transparent fill, gold text).
- Chip set (default/active/disabled + icon chips) as a real primitive — used everywhere
  (engine badges, filters, prompt chips).
- Focused input state: gold border + soft outer glow. Currently inputs barely change on focus.
- Gold-tinted toggle/slider thumbs, table row hover, styled pagination.

**REJECT / DO DIFFERENTLY**
- **Do not switch fonts.** Playfair Display + Satoshi → we keep Fraunces + Inter.
  Fraunces is the more contemporary editorial serif; Playfair is the default "luxury"
  cliché, and a font swap invalidates every screen for zero functional gain.
- Palette: keep our tokens. Mockup's obsidian/charcoal/gold/cream is essentially ours already.

## Sidebar.jpg — grouped nav + dashboard home

**ADOPT**
- Grouped nav with tiny letter-spaced overline section labels (we have sections; adopt the
  typographic treatment + spacing).
- Active item: warm gold **left edge glow/rail** + gold text — clearer than a filled pill.
- Bottom identity card → repurpose as **project card** (current project name + thumbnail +
  switcher chevron), not a user account card.
- A **Home screen** with serif greeting-free header, Recent Projects list (thumb, updated,
  status pill) and a live status card — but ours shows **running jobs + GPU/VRAM**, not
  "Aurea Intelligence insights".

**REJECT**
- Inbox/Messages, "Enterprise Plan", user avatar/account chrome — SaaS boilerplate; Aurea is
  a local single-user tool.
- Marketing copy ("Continue building brilliance"). Feature-tile cards row is optional at best.

## Video Lab Design.jpg — 3-column lab (STRONGEST, closest to reality)

**ADOPT**
- Numbered-step left rail: ① Engine ② Prompt ③ Start frame ④ End frame ⑤ Camera
  ⑥ Duration & Size ⑦ Quality ⑧ Adapters — collapsible sections with numeral badges.
  Matches our real surface exactly (incl. new end-frame + LoRA slots).
- Engine cards with logo + badge (LTX "Best quality" / MiniMax-H3 "Fast+Audio" /
  Seedance "Balanced") and gold selected ring.
- Start/End frame as a linked pair with a swap control.
- **Takes filmstrip under the player** (numbered, duration, star on best take).
- **In-lab render queue panel** (right): thumbnail, engine·res·aspect, circular progress %,
  time-left, Queued/Rendering state, "Clear completed". Complements (not replaces) Jobs.
- Status bar: project name + queue count + ETA.

**REJECT / DIFFER**
- "4K" badges — reflect real output caps per engine, don't fake specs.
- Keep our video player controls; mockup's are generic.

## Image Lab.jpg — "Aurora Studio" composer + masonry

**ADOPT**
- Structured **prompt composer** chips (Subject/Details/Style/Lighting/Mood/Camera/Lens)
  with per-slot remove + "Add to prompt" — extends the chip builder shipped 2026-08-05.
- Prompt library rail with category groups, thumbnail previews, star favorites, search.
- **Masonry** generations grid with hover action row (favorite/download/copy/delete) and
  selected-item gold ring.
- **Hardware status bar** (GPU name, VRAM x/24 GB, RAM) — perfect for a local-first app;
  we already know the RTX 3090 Ti. Put it in the global status bar, not per-lab.

**REJECT / DIFFER**
- **No rainbow category chips.** Yellow/green/purple/orange per slot fights the dark-gold
  system. Use one neutral chip style + a small icon per slot, gold when active.
- Orange "New Generation" button → gold gradient primary.
- Left icon rail duplicating global nav — we already have global nav.

## Director and Storyboard.jpg — split Director/Storyboard

**ADOPT**
- **Tool-call cards in Director chat**: named tool (`generate_shot`), parameter table
  (shot_type/camera_motion/lens/time_of_day/mood), success check, "View details" — we
  already stream tool calls; render them like this instead of raw text.
- Proposed-shot mini video card inline in chat.
- Storyboard cards: **large serif shot numeral** overlay, title, one-line description,
  status pill (Draft / Boarded / Generated — our exact pipeline states), per-card ⋮ menu.
- Act/Sequence/shot-count breadcrumb header + grid/list toggle.
- **"Send to Director"** as prominent gold action (exists as V7 handoff — promote it).
- Suggested-action buttons under AI replies ("Refine camera move" / "Show alternatives").

**REJECT / DIFFER**
- Collaborator avatars, Share — no multiplayer.
- Nav items that don't exist (Scene Nexus, Cast & Crew, Locations, Mood Board, Notes) —
  don't fake destinations; Cast & Crew could later map to the Bible.

## Timeline.jpg — full NLE

**ADOPT**
- **Filmstrip thumbnails inside video clips** — biggest visual upgrade to the timeline.
- **Real waveforms** on audio clips (we ship ffmpeg; extract peaks once per asset).
- **Dialogue text rendered on voice clips** (♦ SPEAKER "line…") — we *know* the text from
  voice takes; almost no NLE has this. Signature feature.
- Timecode readouts (current TC big + in/out/duration in inspector), scene bin on the left
  fed by project structure, zoom slider + fit control.
- Per-track header block (V1/A1/A2, mute/solo/lock icons) — extends existing per-track gain.

**REJECT / DIFFER**
- **No Transform/Crop inspector** (position/scale/rotation/anchor). Export is ffmpeg
  cuts-first; shipping compositing controls that do nothing is a lie. Inspector shows
  clip metadata: in/out/duration, source take, engine, seed, prompt.
- Don't clone Premiere's whole chrome (CAM A monitor tabs, Effects/Metadata tabs) — keep
  the cuts-first scope, richer clip rendering.

---

## Timeline rebuild — 2026-08-06

The first pass adopted the mockup's *content* (filmstrips, waveforms, dialogue on
clips) but kept the old chrome, so it still read as a debug strip. Rebuilt as
`screens/timeline/` (TimelineScreen orchestrator + MediaRail / Monitor /
Inspector / Tracks / Clip + shared.ts):

- **Frame grid.** Every edit quantises to 1/24s instead of 0.1s; timecode is
  mm:ss:ff (hh: once the cut passes an hour) everywhere.
- **Program monitor.** Picture-first card with an in-frame HUD (timecode left,
  fps right, take name on a bottom scrim). A fresh `<video>` now seeks on
  `loadedmetadata`, so a clip under the playhead paints instead of showing black.
- **Transport.** Centred pill — start / previous cut / gold gradient play /
  next cut / end — with the big readout on the left. Keys: space, ←→ frame,
  ↑↓ cut, Home/End, S razor, ⌫ delete, +/− zoom, Esc deselect.
- **Ruler.** Zoom-aware tick plan (labelled majors ≥92px apart + minors),
  drag-anywhere scrubbing, a draggable playhead puck, and playhead-follow
  auto-scroll during playback.
- **Lanes.** Per-kind palette (video gold / voice blue / music green / sfx
  violet) driving the header chip, the lane accent, the clip edge and the
  waveform; alternating lane tint + a bar grid behind the clips.
- **Clips.** Rounded plates with an inset accent edge, hover lift, accent
  selection glow, mirrored round-capped waveforms, the crossfade drawn as the
  dissolve ramp it exports as, grip-pip trim handles, and magnetic snapping to
  clip edges / the playhead (toggle in the lane toolbar, guide line while
  dragging).
- **Inspector** (replaces the mockup's fake Transform/Crop): thumbnail, take
  name, engine / native-audio / voice chips, editable start + duration with
  their timecodes, crossfade, the spoken line or the prompt, remove. With
  nothing selected it shows sequence stats and the last export's state.
- **Layout.** Rail · monitor · inspector over a drag-resizable lane zone.

## Shots & takes rail — 2026-08-06

Asked whether the rail should split into "footage" and "shots used in the cut",
the way the mockup's left column reads. **Rejected the split, kept one list:**
the same file living in two panels means searching twice and neither panel
being authoritative — being in the sequence is *state*, not a location. What
shipped instead:

- Wider (300px default) and **drag-resizable** (220–460px, remembered); the grid
  goes to three columns past 380px.
- **In-cut state on the card**: gold check + count badge, a gold-tinted border,
  an `n/total in cut` readout in the header, and **All / Unused / In cut**
  filters — "what haven't I cut yet?" is one click.
- **Grid / list toggle** (remembered), duration badges, hover-to-add overlay.
- Cards mount their media only when they come near the viewport.

A **Group by: Kind | Scene** toggle was considered and deferred, not rejected:
the production spine (Scene → Shot → takes) is real, but Playground currently
has 2 scenes / 1 shot / 1 take against 275 assets, so scene bins would render
one populated bin and a 274-item "Unsorted" pile. Revisit when Storyboard /
Shot Director have filled the spine.

### The decoder pool (screens/timeline/frames.ts)

Building the above surfaced a genuine bug: the rail mounted one `<video>` per
card and the filmstrip one per *tile* (up to 24 per clip). Chrome allows six
connections per origin and caps how many media players a page may hold — past
that, every later load hangs at `readyState 0`, including the program monitor's,
and the whole timeline goes black. Posters, filmstrip frames and audio durations
now all go through one module that keeps **at most three media elements, reused
rather than recreated**, and caches every painted frame for the session. Zooming
or re-trimming a clip redraws from cache with no new requests.

## Rollout order (impact ÷ effort)

1. **Primitive upgrades** (gradient primary, ghost, chips, focus glow, elevation tier) —
   every screen improves at once.
2. **Video Lab**: numbered rail + engine cards + takes filmstrip + queue panel.
3. **Timeline**: filmstrips + waveforms + dialogue-on-clips + timecodes.
4. **Director/Storyboard**: tool-call cards + shot-card treatment + status pills.
5. **Sidebar polish + Home screen** (jobs/GPU aware).
6. **Image lab**: composer/library/masonry (chip builder already partly there).
