# Video Lab freeform plan — image or text in, a good-looking clip out, no bible required

Date: 2026-09-02. Status: **F0 + F1 + F2 BUILT and verified live 2026-09-02** (see §6); F3–F4 still plan.
Scope: Aurea Video Lab (`apps/desktop/src/screens/video`, `packages/shared/src/{shotSpec,storyboard,multiShot}.ts`, `packages/core/src/{promptlib,labs,director}.ts`, `packages/core/src/adapters/{ltx25-video,minimax-video}.ts`).
Hardware: one RTX 3090 Ti (24 GB, Ampere). Every number below is from measured renders on that card unless marked *(est.)*.

Related: `VIDEO-LAB-ZOOLOGIC-UPGRADE-PLAN.md` (the sitcom-shaped lab this plan generalises; its §9 build log records the measurements quoted here), `VIDEO-SPEED-RELIABILITY-2026-08-31.md`, `MULTI-SHOT-PODCAST-PILOT.md`.

---

## 0. The problem in one paragraph

The lab is a very good sitcom camera. Every convenience it has grown — lanes, the look line, the shot picker, named-beat lip-sync, coverage, multi-shot — reads its aesthetics out of a **project bible** and assumes a **cast with dialogue**. A user who has *one image* and wants it to move, or *one sentence* and wants a clip, gets the raw panel: a prompt box, whichever library still is newest, the Zoo Logic lanes, and no help writing the kind of prompt these engines actually reward. This plan adds a second front door — **Freeform** — that needs no project, no cast and no bible, and gives the same craft the sitcom path gets: a look, a composed prompt, sane engine defaults, and fast iteration.

## 1. Audit — what exists, what is missing

What is already there and stays:

- Prompt-only rendering works on all engines: `noStartFrame` in `ParamsPanel.tsx:239-243` (LTX's bypass switch, H3's optional first frame, Seedance t2v).
- i2v works, but the start frame comes **only from the library** (`FramePicker.tsx` lists library stills; the "No stills yet — generate one in the Image lab" message is the whole story).
- `VideoPreset` (`shared/index.ts:2402`) already carries `payload`, `cine`, a nullable `look`, `rules`, and an optional `projectId` — so a global, project-less preset is a schema-legal object today. The four shipped presets are all Zoo Logic lanes.
- `withLook()` / `projectLook()` (`storyboard.ts:215-240`) append one look sentence and refuse to stack it twice.
- A one-shot local-Claude prompt enhancer exists (`director.ts:oneShot`, `router.ts:492 prompts.enhance`) with `intent: "video"` in its schema, steered by the project's art direction. **It is wired into the Image lab only** — zero references under `screens/video/`.
- LTX has a stackable LoRA row (`ParamsPanel.tsx:1724-1777`, up to 3) reading the ComfyUI lora folder. The folder holds only camera LoRAs and distills — **no style LoRA is installed**.
- The LTX 2.5 Gemma enhancer is on by default; measured 2026-09-02: it *helps* single-take prompts and *destroys* multi-shot structure.
- End frames (LTX core + H3 fl2va) and mid keyframes are live. Loops are therefore one toggle away.
- A/B queue (`AbStore`) renders one shot several ways at one seed.

Gaps this plan closes:

| # | Gap | Evidence |
|---|-----|----------|
| F-G1 | Cannot start from an image that is not in the library: no drop, paste or file-pick for the start/end frame. | `FramePicker.tsx:297`; only H3 refs have an import path (`importRef`, `router.ts:266`) |
| F-G2 | No looks outside a bible. `lookLine` is a bible field; presets are Zoo Logic lanes; `videoLaneSchema` has no look-shaped lane. | `shared/index.ts:1903, 2381` |
| F-G3 | No prompt help in the Video lab. The composer (`composeShotSpec`) needs a boarded shot with characters; the Claude enhancer is Image-lab only; the panel takes the prompt verbatim. | `ParamsPanel.tsx:630-637` |
| F-G4 | The rules learnt the hard way live in memory and skill text, not in code: i2v prompts must be **motion-only**, engines turn "shifts in his chair" into leaving the chair, LTX 2.5 emits digital silence on no-dialogue shots, text in frame must never be prompted. | `zoologic-acceptance-pilot`, plan §9 |
| F-G5 | No style LoRA, no reference-driven style. H3 ref2va accepts stills and clips but the lab only offers them as *subject* references. | `D:\models\loras\ltxv\ltx2` = camera LoRAs only |
| F-G6 | Iteration is one render at a time at a ~90 s floor; there is no seed spray and no loop toggle. | preview floor measured 2026-09-02 |

---

## 2. Design

### 2.1 The Freeform front door

A new lane value `look` in `videoLaneSchema` and a **Looks rail** that replaces the Zoo Logic lane rail whenever the active project has no bible (or the user flips the rail's toggle). Picking a look answers the same eight questions a lane does — engine, canvas, length, tier, enhancer state, camera, negative, look prose — but with aesthetics instead of a show's production shape.

Two inputs, one panel:

- **Image in.** Drop, paste (Ctrl+V), or file-pick a still straight onto the Start-frame tile. It is staged to `<dataRoot>/assets/imports/` (project-less) or `projects/<id>/refs/` (in a project), and appears in the FramePicker under an "Imported" tab. The same path serves the end frame and the H3 reference row.
- **Text in.** `noStartFrame` becomes the default when there is no image; the panel's copy says "Text to video" rather than "No start frame".

### 2.2 The look library

A look is a `VideoPreset` with `lane: "look"`, no `projectId`, and these fields used in earnest:

| Field | What a look sets |
|---|---|
| `look` | One or two sentences of look prose: stock/medium, lens, light, palette, texture, era. Appended once by `withLook`. |
| `cine` | Default camera for the look (a VHS look is handheld, a Wes look is static centred). |
| `payload` | Engine, canvas, duration, tier, `enhance`. |
| `negative` *(new)* | Look-specific negatives ("text, watermark, subtitles, logo" on every look; "clean, sharp, digital" on the analogue looks). |
| `loras` *(new, LTX only)* | Style LoRA names + strengths, applied when installed, silently skipped when not. |
| `sample` *(new)* | A dataRoot-relative still rendered once through the Image lab so the rail shows a thumbnail, not a word. |
| `refs` *(new, H3 only)* | Optional style-reference stills/clips fed to ref2va as *style*, tagged so the prompt says "in the style of the reference footage" rather than "the character in the reference". |

Ship ~14 looks in two families, seeded under their own marker (`.seeded-looks.json` — the Image-lab `.seeded.json` and the lanes' marker already exist everywhere, so reusing either would seed nobody):

**Artistic** — *16mm documentary*, *Anamorphic neon noir*, *Pastel symmetry* (static, centred, Anderson), *Watercolour animation*, *Claymation / stop-motion*, *Anime cel*, *Oil-paint impressionist*, *Macro nature*, *Drone golden hour*, *Liminal / empty interior*.

**Reactive / shitpost** — *Broadcast news* (studio, three-point, no graphics — text is post), *Security camera* (fixed high corner, timestamp look but no legible characters), *Phone footage vertical* (9:16, handheld, on-camera flash), *Corporate stock footage*, *1990s infomercial*.

Engine defaults per look follow the measurements: LTX 2.5 for silent single-take picture (25–30 % faster, better blocked, enhancer **on** because these are single takes), H3 Draft 1344×768 for anything that should arrive with sound, H3 9:16 native for the vertical look. Every look ships with `enhance` set explicitly so the enhancer never silently changes state with the engine.

### 2.3 The art-director composer

`composeFreeform()` in `packages/shared/src/freeform.ts`, a sibling of `composeShotSpec` that takes **no bible and no cast**:

```
input:  { subject: string, mode: "i2v" | "t2v", look: VideoPreset, cine?, motion?: string }
output: { prompt, negative, enhance, rules: string[] }
```

Order of the sentence stream (measured wording rules baked in, F-G4):

1. **Subject** — in t2v, the user's sentence verbatim; in i2v, the subject is *the image*, so the sentence is reduced to what changes ("the image already establishes the scene" — motion-only, acceptance-pilot defect).
2. **Motion** — one clause of what moves and what stays ("stays seated", "the camera holds"), because both engines escalate small motion into large.
3. **Camera** — `cineClause` from the look's `cine` (or the user's override).
4. **Look** — `withLook` with the look prose, once.
5. **Sound** *(H3 only)* — an `Audio:` block via `shared/h3Prompt.ts` naming ambience so the clip does not arrive silent; on LTX 2.5 the composer records `rules: ["silent"]` so the Post lane (a separate plan) knows to add room tone.
6. **Never** — text, captions, logos, signs. Always in the negative, never in the positive.

The **Claude enhance** button lands in the Video lab beside the Prompt label (reuse `useEnhanceControl` from `screens/image/EnhanceButton.tsx` with `intent: "video"`). Its system prompt is steered by the *look* when there is no project — `prompts.enhance` gains an optional `look` field and `director.ts` picks steering from `look ?? project art direction`. The enhance system prompt carries the same six rules above so the expansion cannot undo the composer. Result stays a before/after card the user accepts or dismisses, as in the Image lab.

### 2.4 Style: LoRAs and references

- **LTX style LoRAs** — triage on Hugging Face for LTX-2 / 2.3 22b style adapters (the 2.5 adapter loads the 2.3-named files; camera LoRAs proved the 480/480 key match). Register the keepers in `models/registry.ts` under `ltx-style-*` ids so `manager.ts` installs them into `loras/ltxv/ltx2/` like the camera set. Candidate looks to cover: anime, claymation, watercolour, film grain. **Measure each with the A/B queue at one seed against prose-only** before it ships in a look — the camera LoRA taught us prose alone already carries a lot (x1.30 of x1.40).
- **H3 style references** — add a `role: "subject" | "style"` on `minimaxRefs.images/videos`; a style ref is tagged in the prompt with the reference-footage wording and never named as a character. One measured run decides whether ref2va honours style separately from identity; if it does not, the field is removed rather than shipped as a placebo.

### 2.5 Fast iteration

- **Loop** toggle: sets `endFrame = startFrame` (LTX core end frame; H3 fl2va). Shown for i2v only. The take's sidecar records `loop: true` so export can trim the seam frame.
- **Seed spray**: "4 seeds" button that files one `AbStore` run with four seeds at the look's *sketch* tier and shows the four first frames as a contact sheet in the preview; clicking one promotes it to a full render with that seed. Reuses the A/B panel end to end; only the seed policy is new (`AbStore` currently forces one shared seed).
- **Sketch tier**: a look-level `sketch` payload override (2 s, draft, 1120×640 or 768×432) *(est.* 45–60 s on 2.5, to be measured). Never the deliverable; only for picking.

### 2.6 The look contact sheet

The one acceptance F1 left open: every shipped look rendered once, reviewed side by side, and the rail showing a picture instead of a word. `scripts/look-contact-sheet.mts` does the whole round against a studiod:

- **One subject for every look**, so the sheet reads across — the same fox in the same market the style-LoRA A/B used, t2v, composed by `composeFreeform` exactly as the panel would (the look's engine, canvas, tier, enhancer state, negative and whichever adapters the install carries).
- **A frame per take** (mid-clip, 480 wide) becomes the look's `sample`, filed into the project as a library still through `importStill` — the same contract a dropped image uses — and written onto the look through `videoPresetSave`. The rail's thumbnail is therefore an honest one: a frame the look itself rendered here.
- **A sample is not an edit.** `seedLooks` hashes a look *without* its `sample`, and carries the on-disk sample through an upstream refresh — otherwise the first sample set would freeze every look out of every later change to its prose, and the first refresh would wipe the picture.
- **The review**: one labelled PNG sheet (`scripts/out/look-contact-sheet.png`) and an HTML page with the clips and the exact prompt each rendered from. The verdicts go in the build log, and a look that does not read as its label is fixed in prose (or moved engine) and re-rendered alone.

The same script re-runs on one look after its prose changes (`--reuse` keeps the takes that already landed), which is how a look gets its sample back after a fix.

---

## 3. Phases

| Phase | Deliverable | Acceptance |
|---|---|---|
| **F0 Bring your own image** | Drop / paste / pick for start frame, end frame, H3 refs; `imports/` staging; "Imported" tab in FramePicker; "Text to video" default when no image. | Drop a PNG from Explorer onto the tile → it is the start frame → render lands. Paste a clipboard image → same. No project active → still works. |
| **F1 Looks** | `lane: "look"`, new preset fields (`negative`, `loras`, `sample`, `refs`), 14 seeded looks, Looks rail with thumbnails, rail toggle. | Pick a look → engine/canvas/tier/enhancer/camera/look prose all set and visible in the shape line; touching any detaches the chip. All 14 render one clip each in an overnight batch and the contact sheet is reviewed. |
| **F2 Composer + enhance** | `composeFreeform()` + tests; enhance button in the Video lab; `prompts.enhance` steered by look. | Unit tests for the six wording rules. Acceptance-pilot defect check: an i2v prompt from the composer contains no re-description of the plate. A t2v run with enhance produces a clip the user accepts without editing the prompt (three of five tries). |
| **F3 Style** | Style LoRA triage + registry + A/B; H3 style-ref role + one measured run. | Each shipped LoRA has an A/B record showing a visible difference over prose at one seed; anything that does not is dropped. |
| **F4 Iterate** | Loop toggle, seed spray, sketch tier. | Loop take plays seamlessly in the Timeline monitor. Seed spray of four finishes under 4 min at sketch tier on 2.5 *(est.)* and promoting one reuses its seed exactly. |
| **F5 Contact sheet** | `scripts/look-contact-sheet.mts`; every look rendered once from one subject; `sample` thumbnails on the rail; sample-preserving seeding; the `silence-25` lint refined to look for a sound cue. | Every shipped look has a take, a frame on the sheet and a thumbnail in the rail. Each is reviewed against its label; a look that does not read is fixed and re-rendered. A prompt that names its sound is no longer flagged silent. |

F0 and F1 are independent and can ship together. F2 needs F1's look object. F3 and F4 are independent of each other and of F2. F5 closes F1's open acceptance and needs F2's composer and F3's adapters in place.

## 4. Non-goals (deliberately)

- Text, captions, meme formats, grades applied in post — that is the **finish layer** plan (Remotion bridge), not this one. This plan only guarantees the *models* are never asked for text.
- Video-to-video restyle (depth/pose/canny IC-LoRAs) — a research bet with its own verification step; noted for a later plan.
- Touching the Zoo Logic lanes, the shot picker or `composeShotSpec`. The sitcom path stays exactly as measured.

## 5. Gotchas to carry in

- Restart Aurea before verifying anything in the app — Electron loads `dist-electron/studiod.js` once.
- New seeded content needs its **own** marker file, or existing installs never receive it.
- LTX 2.5 with enhancer on is right for single-take freeform; keep `enhance` explicit on every look so switching engine never flips it silently.
- Free Comfy VRAM via `/free` on both :8000 and :8188 before any H3 render.
- "Draft" on H3 means the 1344×768 · 4–6 s shape; longer offloads the unet to system RAM.

## 6. Build log

**2026-09-02 — F0 + F1 shipped.** 296 core tests green, desktop typecheck + build clean, verified in Chrome against a restarted studiod.

- F0: `labs.video.importStill` (same PNG contract as `image.addRef`) → `projects.importAsset()` → `assets/image/imports/`, so an import IS a library asset (thumbnail, media url, newest-still default). Panel: drop on the start/end tile, Ctrl+V anywhere outside a text field, "From your computer" under the tile, and the same three inside the FramePicker. `t2vOn` now also fires when the library has no still at all ("Text to video" is the switch's new name). Verified: a synthesised PNG pasted via a ClipboardEvent landed on disk and became the start frame with a thumbnail.
- F1: `lane: "look"` + preset fields `negative` / `sample` (style LoRAs ride `payload.loras`, which was already legal); `payload.negativePrompt` threaded to the 2.3 template's node 340:314 and 2.5's `neg` encoder (LTX only — H3/Seedance have no negative arm, the panel never sends it there). 15 looks seeded under `.seeded-looks.json`; the rail renders them under LOOK with a hint, thumbnails when `sample` is set (none are yet — the overnight contact sheet is still to run). Applying a look sets engine/canvas/length/tier/enhancer/camera, the look prose (appended once via `withLook` at submit) and the negative; installed-only LoRAs; the shape line reads e.g. `ltx25 · 1280 × 704 · 5s · draft · enhancer on · look prose · negative`.
- Not done from F1's acceptance: the 15-look overnight render + contact-sheet review, and `sample` thumbnails.
- Gotcha: running `vite` in the desktop package rebuilds `dist-electron/studiod.js`, which trips the "Update ready — restart Aurea" pill on the running app even though nothing changed. Relaunch after a dev-server session.

**2026-09-02 — F2 shipped.** 308 core tests green (12 new in `freeform.test.ts`), desktop typecheck + build clean, verified live in Chrome against a relaunched studiod.

- `composeFreeform()` in `packages/shared/src/freeform.ts` — no bible, no cast. Input `{ subject, motion?, mode: "i2v" | "t2v", look, cine?, engine?, durationSec?, bank?, hasAudio? }`, output `{ prompt, negative, enhance, engine, durationSec, rules, notes }`. The six rules as written: (1) t2v = the user's line verbatim first; i2v = the image is the subject, so only the motion is written — `motion` when given, otherwise the typed line is read as the motion, and the subject is NEVER re-described (`rules: ["i2v-motion-only"]`); (2) what stays, said once (`FRAME_HOLD_CLAUSE` in i2v unless the line already says "holds/stays/static…", `CAMERA_HOLD_CLAUSE` when no move is set); (3) camera ids → bank prose through `freeformBank()`, which falls back to the shipped doc-26 bank when the project has none — before F2 a look's `handheld` was pasted into the prompt as the bare id whenever there was no bible; (4) `withLook` once; (5) H3 gets `composeH3Prompt`'s block form with a soundscape line from the new preset field `sound` (the six H3 looks now name theirs; default "the natural ambient sound of the scene, no music"); LTX 2.5 records `rules: ["silent"]` off the `silence-25` lint; (6) `NO_TEXT_NEGATIVE` is always in the negative (deduplicated with the look's own), and a request for lettering in the positive is flagged `text-in-positive`, not rewritten. The craft table (`applyCraftRules`) runs over the user's part BEFORE the camera and look go on — a new `t2v` craft mode joins `stays-seated`, `enhance-on-single`, `no-camera-lora-25`, `silence-25` — so the lints judge what the user wrote, not the look's own lens clause (which is what the first cut did; caught live).
- Panel: a look now renders through the composer — `activeLook` (the applied preset when its lane is `look`) → `composeFreeform` with the panel's own `presetLook` / `negative` / `cine` state so a customised look composes with the edits; the payload takes `composed.prompt` and, on LTX, `composed.negative`. Composer notes show under the prompt (rule id kept, "Why" in the tooltip); an "Image to video · the image is the subject" hint appears in i2v. Lanes and shots without a look are untouched (`promptWithCine` + `withLook` as before).
- Enhance: the dead "Magic prompt" button is now the Image lab's `useEnhanceControl` with `intent: "video"`, `look: presetLook`, `mode: t2vOn ? "t2v" : "i2v"`; `prompts.enhance` gained optional `look` + `mode`, and its video system prompt is `videoEnhanceSystem()` in freeform.ts (same six rules, motion-only wording in i2v, look steer under the project's art direction when both exist). Image-lab behaviour unchanged.
- Verified live (16mm documentary look, "a kettle comes to the boil on a gas stove"): i2v enhance returned motion-only prose (steam, spout trembles, "kettle stays planted", "camera locked in a steady hold", the hiss and whistle — no set, no lens, no stock); t2v enhance returned a subject-led one-shot paragraph with what stays, no cuts, ambient sound, and no film stock (the look carries it); Accept replaced the prompt, Generate queued LTX-2.5 · 1280 × 704 · 5s · draft. **Render landed** (job `j-adfddbcc`, 3m32s on a cold engine): 5.0 s, h264 640×352 (draft half-size), a kettle on a gas ring, AAC track at mean −23 dB / peak −11.6 dB — **not silent**. The `silence-25` measurement was made on prompts with no sound cue; a 2.5 prompt that NAMES its ambient sound renders it. The composer's `silent` rule therefore over-fires when the user (or the enhancer, rule 5) wrote a sound line — refine the lint to look for one before F4.
- Defect found in the same payload and fixed: the shipped bank's shot-size clauses describe a character (`ms` = "medium shot from the waist up, hands visible and gesturing"), and the 16mm look's `film-grain` lens says "35mm". Both went into the kettle prompt. All 15 looks now set NO `shotSize` (framing is the subject's; angle, move, lens and light stay the look's) and the 16mm look sets no lens (its prose carries the stock). The Zoo Logic lanes keep theirs.
- Still open from F1: the 15-look overnight render + contact-sheet review, and `sample` thumbnails. Next = F3 (style LoRA triage + H3 style-ref role) or F4 (loop, seed spray, sketch tier) — independent of each other.

**2026-09-02 — F3 + F4 built.** 316 core tests green (5 new), core typecheck and desktop typecheck/build clean, verified live in Chrome against the dev studiod. Nothing committed.

- **F3 style LoRAs.** Five of vrgamedevgirl84's LTX 2.3 22b style adapters are in `models/registry.ts` as `ltx-style-*` (anime, claymation, painterly, CGI toon, paper cut-out; 336 MB each, sha256 from the publisher's LFS metadata, licence GATED because the cards state none — the user reads the card and accepts). All five installed into the managed store and appear in the live `availableLoras` probe. Two new looks ride them (`look-cgi-toon`, `look-paper-cutout`); `look-anime-cel` and `look-oil-paint` gained theirs.
- A look names its LoRA **by file**, never by path: `resolveLoraByFile()` in `freeform.ts` matches the bare filename against the install's own combo list (Aurea's store walks as `ltx-style-anime\loras\Fantasy_Anime.safetensors` on Windows, and ComfyUI validates the combo value verbatim). Both LTX adapters resolve through it, so a look renders on any install that carries the file under any name — and on one that does not, the panel drops it and says so under the Adapters row rather than failing the render.
- Resolution happens at **payload** time, not at apply time. The first cut resolved in `applyPreset`, which made the LoRA depend on whether the capability probe had answered yet — the user experiences that as "the look sometimes brings its adapter".
- **Seeding defect found and fixed (twice).** A look already on disk never received an upstream change, so the anime look kept its pre-F3 payload and the rail showed no adapter. `seedLooks` now records a per-id **hash of the exact bytes it wrote**: a look added in a later wave still arrives, a look the user deleted stays deleted, a look changed upstream refreshes **only if the file still matches what we wrote**, and an edited look is never overwritten. (The first attempt keyed on a count and inserted the new looks mid-list, so an old install counted them as already seeded — shipped looks are append-only for that reason, and the F3 pair sits at the end of `SHIPPED_LOOKS`.)
- **H3 style references.** `minimaxRefs.imageRoles[]` (index-aligned, missing = `subject`). A `style` still gets `styleRefClause()` appended by the adapter — reference footage whose palette, grade, texture and light are borrowed and whose content never appears — written **before** the unknown-tag check so a prompt that names only the subject still passes. The lane shows a subject/style toggle per still.
- **Measured (`scripts/ab-h3-style-ref.mts`, one seed, 3 arms, a watercolour lighthouse as the reference):** the role is REAL. Both reference arms carry the still's painterly softness and warm lantern palette; the no-reference control is crisp photographic video. Neither pulls the lighthouse into the market. The `style` arm is cleaner than naming the same still as a subject, which smears. The field ships.
- **F4 loop.** A `Loop` checkbox under the frames block (i2v only, and only where an end frame exists: H3 fl2va, LTX's core guides) sets `endFrame = startFrame`, shows the start frame in the end tile as "loops back here", and records `loop: true` in the take's sidecar (`AssetMeta.loop`) so an export can trim the seam frame. Verified in the lab: ticking it fills the end tile with the start frame.
- **F4 seed spray.** "Spray 4 seeds" files ONE A/B run at the new `seedPolicy: "spray"` — the store's shared-seed rule is the experiment's, and a spray is the one case where the seed IS the variable, so each variant draws its own and the run records it (`AbVariant.seed`). Variants render at `SKETCH_TIER` (3 s, draft, 896 × 704; H3 keeps its native canvas), a look may override it (`VideoPreset.sketch`), and the preview shows a contact sheet of the four sketches with their seeds; "Render full" re-renders the run's own base payload at exactly that seed. Verified live: one click queued four distinct seeds at the sketch tier with the look's resolved LoRA on the base.
- **The five LoRAs measured (`scripts/ab-style-loras.mts`, one seed each, enhancer off, 4 s draft t2v, the same fox in the same market):**

| adapter | verdict | what the frames showed |
|---|---|---|
| `Fantasy_Anime` | **ships** on Anime cel | prose renders a 3D CG fox; the adapter renders a true 2D cel frame with painted background |
| `Fantasy_Painterly` | **ships** on Oil-paint | prose is photographic; the adapter has impasto brushwork and canvas texture |
| `Pixar_Toon` | dropped from the look | prose already gives a clean CGI toon; the adapter's change (softer shading, tidier background) is marginal |
| `PaperCutOutStyle` | dropped from the look | props move toward card, the subject stays plush 3D — neither arm is true paper cut-out |
| `Claymation` | dropped | the prose arm is, if anything, more felted; the Claymation look renders on H3, which has no LoRA arm |

  All five stay in the registry and installable — the verdict is written into each entry's description so nobody re-runs it — but only the two that beat prose ride a look, and `video-presets.test.ts` now asserts exactly that pair. Prose first: the camera LoRA's lesson holds.
- **A/B card fix found while verifying the spray:** `useVideoAb().takeUrl` matched the variant's `output` verbatim against library `relPath`s, but a variant records the job's ABSOLUTE path, so every finished A/B and sketch sat on "rendering…" with the file already on disk. The match is now on the normalised tail. (This was live in the Desk's A/B tab too.)
- **Measurement gotcha, cost a full round:** with LTX 2.5's enhancer ON, Gemma runs **per render**, so the two arms of an A/B see different prompts — an enhanced oil-paint pair rendered two unrelated human faces from a prompt about a fox. `scripts/ab-style-loras.mts` therefore sets `enhance: false`; an A/B on anything but the enhancer itself must.
