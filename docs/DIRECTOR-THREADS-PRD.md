# Director Threads — PRD (2026-08-22)

Split the Director's single perpetual chat into **threads bound to production nodes**, so
context can be reclaimed deliberately instead of only by Claude Code's invisible auto-compact.

**Status:** D1–D3 shipped 2026-08-22 — see §12 for what landed, what deviated, and what is
still not true. D4 (episode binding) and D5 (handoff summary) are open.

---

## 1. Where the Director stands today

One thread per project, forever. From the file header (`packages/core/src/director.ts:1-11`):

> *One chat thread per project, persisted at `<dataRoot>/projects/<id>/director.json`;
> conversation continuity rides on Claude Code's own session store via resume.*

The load-bearing facts, verified in the code:

| Fact | Where |
|---|---|
| `chats`, `runs`, `lastEmit`, `emitTimers` are all `Map<project, …>` | `director.ts:208-211` |
| Real context is **not** `messages[]` — it's Claude Code's session, replayed via `resume` | `director.ts:408` |
| `messages[]` is the *render log* streamed to the panel | `director.ts:520-526`, `shared/src/index.ts:1585-1591` |
| The tRPC surface is only `get` / `send` / `stop` / `onUpdate` — no new-thread, no clear, no compact | `router.ts:390-419` |
| `MAX_TURNS = 60`, because "a writers-room full-script draft is one tool call per scene and shot — an episode skeleton alone can spend 20+ turns" | `director.ts:37-38` |
| One in-flight run per project, enforced by throw | `director.ts:229` |

### Four consequences

1. **Context is only ever reclaimed by auto-compact.** Claude Code compacts the resumed
   session when it fills. That is invisible to the operator, lossy in a way nobody chose, and
   it fires on its own schedule — which can be halfway through boarding a scene.
2. **Everything shares one thread.** A 60-turn episode script draft and "make me a thumbnail"
   land in the same window, and every later turn pays for both.
3. **The Writers Room is the same thread.** `writers.tsx:50` calls the same `useChat()` as the
   Director screen (`chat.tsx:79`). There is exactly one conversation in the app, and two
   screens both push 20+ turn workloads into it.
4. **There is no way back to "the E04 conversation."** It exists, interleaved with everything
   that happened since, with no seam to scroll to.

---

## 2. Decision: bind threads to episodes, not to time

**Rejected — session / time-boxed threads.** A session boundary is arbitrary against the work:
it cuts mid-episode and rejoins mid-episode. The operator's unit of recall is not "yesterday's
chat", it is "the E04 conversation."

**Chosen — one thread per production node (episode), plus a default *Studio* thread.**
Episode is the seam the data model already has (Season → Episode → Scene → Shot,
`shared/src/index.ts:1167-1195`) and the seam the creative work already has.

### Why discarding a thread is safe

This is the whole argument, and it rests on something already built: **the bible is the durable
cross-thread memory.** The system prompt already orders the Director to consult it before
writing anything (`director.ts:74-79`):

> *The bible (`bible_get`) is the persistent cast & world memory — consult it BEFORE writing
> dialogue or describing a character … and record new recurring characters/locations with
> `bible_upsert_*` so episode 12 still matches episode 1.*

Cast voice, locations, running gags, the cinematography bank: none of it lives in chat history.
`production_get` returns the whole tree with every node id. A fresh thread that can re-read the
store is not amnesia — it is a clean read of the same canon, minus the transcript of how we got
there.

### The precedent is already shipped

`chat.tsx:63-66` prefixes messages with `[Shot {code} · {scene} · {title}]` and the composer
chip reads *"Messages act on {code}. Click × to talk about the episode instead."*
(`chat.tsx:466`). Aurea already binds conversation to a production node — ephemerally, per
message, and it works. Threads are the durable version of the same idea, one level up the tree.

---

## 3. Non-goals

- **Not** replacing auto-compact *within* a thread. A long single episode thread still compacts
  the way it does today; this PRD gives the operator a boundary, not a new compaction engine.
- **Not** parallel Director runs. One in-flight run per *project* stays the rule — see §6.2.
- **Not** automatic thread closing. Explicitly rejected: post-render notes and retakes keep
  arriving after an episode is "done", and a thread that vanishes under you is worse than a
  long one.
- **Not** multi-user or thread sharing.
- **Not** a new memory system. The bible is the memory system; this PRD leans on it.

---

## 4. Data model

### 4.1 Storage layout

```
<dataRoot>/projects/<id>/
  director.json              # LEGACY — left in place one release for rollback
  director/
    index.json               # DirectorThreadIndex
    <threadId>.json          # DirectorChatFile, one per thread
```

### 4.2 Schemas (`packages/shared/src/index.ts`)

```ts
export const directorThreadSchema = z.object({
  id: z.string(),
  title: z.string(),                          // "Studio", "S1E04 — Cold Open", user-renameable
  /** the production node this thread works on; null = the project-wide Studio thread */
  bind: z.object({ kind: z.literal("episode"), episodeId: z.string() }).nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** closed threads are read-only and collapsed in the switcher; never deleted implicitly */
  closed: z.boolean().default(false),
  /** handoff written on close — seeds the preamble of the next thread on the same node */
  summary: z.string().default(""),
});

export const directorThreadIndexSchema = z.object({
  version: z.literal(1).default(1),
  threads: z.array(directorThreadSchema).default([]),
  activeId: z.string().nullable().default(null),
});
```

`directorChatFileSchema` (`shared/src/index.ts:1600-1605`) is unchanged — it already holds
exactly `{ sessionId, messages }`, which is the per-thread payload. It just moves file.

`directorStateSchema` (`:1585-1591`) gains `threadId: z.string()`. `directorSendSchema`
(`:1593-1597`) gains `threadId: z.string()`.

### 4.3 What actually frees the context

A new thread starts with **`sessionId: null`**. `options()` only spreads `resume` when a
sessionId exists (`director.ts:408`), so a null sessionId means Claude Code opens a genuinely
fresh session with a fresh window. That one line is the entire mechanism; everything else in
this PRD is plumbing and UI around it.

---

## 5. Bootstrapping a fresh thread

A fresh thread must warm up from durable storage, not from transcript. On creation, the first
turn is prefixed with a **bind preamble** (composed server-side in `buildPrompt`, so it is
visible in the thread the same way `withContext` is today — no invisible state):

```
[Thread: S1E04 — "Cold Open"]
Call production_get and bible_get before your first substantive reply — you are starting a
fresh thread on this episode and have no memory of earlier conversations about it.
{prior thread summaries, if any}
```

Two tool calls to load the canon, versus dragging three episodes of transcript. Prior
`summary` fields from closed threads on the same episode are appended verbatim — this is why
the summary lives on the thread record rather than on the episode.

### Close = explicit handoff

Closing a thread runs a **`oneShot`** — the tool-free, single-turn path that already exists for
`prompts.enhance` (`director.ts:246-274`) — over the thread's `messages[]`, asking for ≤200
words of "what a director picking this episode up next week needs to know that isn't in the
bible or the production tree." That lands in `thread.summary`.

This is strictly better than auto-compact on two counts: it is user-visible and editable, and
it is durable on disk rather than living inside Claude Code's session store. If the summary is
wrong, the operator fixes it.

> `episodeSchema` (`shared/src/index.ts:1167-1174`) has no `notes` field, and this PRD does not
> add one — keeping the summary on the thread record means zero blast radius on `production.json`.

---

## 6. Backend changes (`packages/core/src/director.ts`)

### 6.1 Composite keys

`chats` becomes keyed by `project + "/" + threadId`. `chat()`, `chatFile()`, `persist()` take
`(project, threadId)`. `state()` and `emitState()` take `(project, threadId)` and stamp
`threadId` into the emitted state.

New: `ThreadStore` — load/save `index.json`, `create`, `rename`, `close`, `delete`,
`setActive`. Small enough to live in `director.ts`; split only if it passes ~120 lines.

### 6.2 `runs` stays keyed by project — deliberately

Two threads mutating the same production tree concurrently is a real hazard: `shot_update`,
`timeline_add_clip` and `production_add_scene` are not written for concurrent writers, and the
system prompt's own rule — *"never rebuild a timeline they may have edited without checking
`timeline_get` first"* (`director.ts:68-69`) — assumes a single actor. Keep
`runs: Map<project, ActiveRun>` and keep the throw at `director.ts:229`, but change the message
to name the thread that holds the lock.

`lastEmit` / `emitTimers` can stay project-keyed for the same reason (only one thread streams
at a time), but `emitState` must be told which thread it is emitting.

### 6.3 Router (`packages/core/src/router.ts:390-419`)

- `director.threads.list` / `create` / `rename` / `close` / `delete` / `setActive`
- `threadId` added to `get`, `send`, `stop`
- **`onUpdate` must filter on threadId** (`router.ts:415-419` currently compares
  `state.project === input.project`). Missing this is the bug that makes the panel redraw from
  the wrong thread; it will look like "the Director answered in the wrong chat."
- `send` should 400 on an unknown or `closed` threadId, the same way it already 400s on an
  unknown project (`router.ts:396-398`).

---

## 7. Renderer changes

### 7.1 `useChat()` (`apps/desktop/src/hooks.ts:166-205`)

Takes an explicit `threadId`. Both call sites change:

- **Director screen** (`chat.tsx:79`) — passes the switcher's active thread.
- **Writers Room** (`writers.tsx:50`) — passes *the bound thread of the episode it is
  drafting*. This is the single highest-value line in the PRD: a full-script draft stops
  landing in the general chat and goes where it belongs.

Note `useActiveProjectId()` (`hooks.ts:599-602`) is "first project in the list" — the active
*thread* is properly persisted in `index.json.activeId`, not inferred. Don't copy that pattern.

### 7.2 Episode selection must be lifted

`Director.tsx:56` and `Studio.tsx:46` each hold their own independent, unpersisted
`useState<string | null>(episodeId)`. Thread binding rides on that selection, so it has to
become one shared, persisted value before the binding means anything. Lift it into a store
alongside the active thread.

### 7.3 The switcher

In the Director pane header (`chat.tsx:93-100`, today just a `Sparkles` + title block): the
active thread's title with a dropdown — open threads, then a collapsed *Closed* group. Row
actions: rename, close, delete (delete confirms; it is the only destructive one). A
`+ New thread` item, and on the episode rail a `Talk about this episode` action that creates or
jumps to the bound thread.

Empty state (`chat.tsx:104-113`, *"The set is quiet."*) should mention which thread you're in.

---

## 8. Migration

On first load of a project with no `director/index.json`:

1. Read the legacy `director.json` if present.
2. Write `director/<uuid>.json` with its exact `{ sessionId, messages }` — **sessionId
   preserved**, so the existing conversation resumes rather than restarting.
3. Write `index.json` with that one thread, `title: "Studio"`, `bind: null`, `activeId` set.
4. **Leave `director.json` on disk.** One release of rollback insurance; delete it in the round
   after.

No user-visible history is lost, and the first launch after the update looks identical except
for a new switcher showing one thread called "Studio".

---

## 9. Phases

| ID | Phase | Contents | Status |
|---|---|---|---|
| **D1** | Data + migration | Schemas in `shared`, `ThreadStore`, composite keys in `DirectorService`, migration on load. No UI. Verified by unit test + a real project's files on disk. | ✅ **SHIPPED 2026-08-22** |
| **D2** | tRPC surface | `threads.*`, `threadId` on get/send/stop, **onUpdate threadId filter**. | ✅ **SHIPPED 2026-08-22** |
| **D3** | Switcher UI | `useChat(threadId)`, header dropdown, new/rename/close/delete, persisted active thread. Both call sites updated. | ✅ **SHIPPED 2026-08-22** |
| **D4** | Binding | Lift episode selection, `bind` on create, the bind preamble in `buildPrompt`, Writers Room routes to the episode thread, `Talk about this episode` on the rail. | open |
| **D5** | Handoff | `oneShot` close-summary into `thread.summary`, prior summaries injected into new-thread preambles, editable in the UI. | open |

D1–D3 are shippable alone and already deliver the headline win (a fresh window on demand).
D4 is what makes it *episodes* rather than *manual threads*. D5 is the polish that makes
closing a thread feel safe.

---

## 10. Risks & gotchas

- **The onUpdate filter (§6.3).** Ship D2 without it and the symptom is subtle and confusing:
  streaming text from a background thread appearing in the foreground one.
- **Mid-run thread switch.** The user can switch threads while a run streams. The run belongs
  to the project, not the view — it must keep persisting into its own thread's file, and the
  header should show a "running in *<other thread>*" affordance. Do not abort on switch.
- **Stale `sessionId`.** Claude Code prunes its session store. A `resume` against a pruned
  session currently surfaces as the generic "I couldn't reach the local Claude engine" error
  (`director.ts:344-350`). With many threads this gets likelier — on resume failure, null the
  `sessionId`, warn once in-thread, and start fresh rather than showing an engine error.
- **Thread sprawl.** 65 episodes × threads plus Studio threads is a long list. The switcher
  needs the closed-group collapse from day one, not as a later fix.
- **Bind drift.** Deleting an episode orphans its thread. Keep the thread, mark the bind
  dangling, show it under Studio — never cascade-delete a conversation.

---

## 11. Verification

1. **Migration** — a project with an existing `director.json` opens on a "Studio" thread with
   every message present, and a follow-up reply demonstrates the resumed session still has
   prior context.
2. **The actual win** — create a thread, send a message, and confirm the SDK `init` message
   carries a *new* `session_id` (`director.ts:441-443`) rather than resuming the old one.
3. **Bind bootstrap** — a fresh episode thread's first reply shows `production_get` and
   `bible_get` tool cards, and the reply is accurate about the episode with zero prior
   transcript.
4. **Writers Room isolation** — drafting a script in the Writers Room leaves the Studio
   thread's message count unchanged.
5. **Concurrency** — sending on thread B while thread A runs returns the CONFLICT naming
   thread A; switching to A mid-run still shows its live stream.
6. **Handoff** — close a thread, open a new one on the same episode, confirm the summary text
   appears in the preamble.

---

## 12. Status — D1–D3 shipped (2026-08-22)

Core `tsc` clean, renderer `tsc` clean, **112 core tests pass** (101 existing + 11 new in
`packages/core/src/director-threads.test.ts`). Router surface driven end to end through
`appRouter.createCaller` over a throwaway data root, and the UI Chrome-verified against an
isolated studiod (own `USERPROFILE` + `AUREA_DATA_ROOT`, port 4177) so the running app and
the real `~/Aurea` were never touched.

### What landed

- **`packages/shared/src/index.ts`** — `directorThreadBindSchema`, `directorThreadSchema`,
  `directorThreadIndexSchema`, `directorThreadsSchema`; `threadId` on `directorStateSchema`
  and `directorSendSchema`.
- **`packages/core/src/director.ts`** — `ThreadStore` (index, files, migration, `repair()`),
  composite `${project}/${threadId}` chat keys, `ActiveRun.threadId`, per-thread
  `state`/`persist`/`emitState`/`emitStreaming`, and the thread mutations on
  `DirectorService`.
- **`packages/core/src/router.ts`** — `director.threads` / `onThreads` / `createThread` /
  `renameThread` / `closeThread` / `reopenThread` / `deleteThread` / `setActiveThread`;
  `threadId` on `get` / `send` / `stop`; the `onUpdate` threadId filter; `threadOp()`.
- **`apps/desktop/src/hooks.ts`** — `useDirectorThreads()`, `useChat(threadId?)` returning
  `{ threadId, threads, blockedBy, error }`.
- **`apps/desktop/src/screens/director/chat.tsx`** — `ThreadSwitcher` in the pane header,
  the closed/blocked/error bars, `readOnly` on the composer.

### Deviations from the plan above, and why

1. **Added `onThreads` + `runningId`** (not in §6.3 as written). `onUpdate` is filtered to one
   thread, so when a *background* thread's run ended nothing told the switcher — it would show
   a spinner on that row forever. A separate list subscription fixes it at the source.
2. **`activeId` may point at a CLOSED thread.** §4.2 implied closed threads were only
   archive; but you have to be able to open one to read it. So `repair()` guarantees an open
   thread *exists*, not that the active one is open — and closing the thread you are *in*
   still steps you off it, which is the case that would otherwise strand you.
3. **Added `reopenThread`.** Falls out of (2): if you can land on a closed thread, you need a
   way back. The composer shows "closed — its context is freed" with a Reopen action.
4. **`useChat` returns the threads object** rather than each pane calling
   `useDirectorThreads()` separately — two hooks meant two live `onThreads` subscriptions per
   screen.

### Two bugs the tests caught (worth keeping in mind for D4)

- `ThreadStore.index()` returned the cached index before running its invariant checks, so the
  "always leave somewhere to talk" repair only ever ran on the first load of a session.
  Closing your last open thread left the switcher with nothing selectable. Fixed by splitting
  `repair()` out and running it on **every** read.
- The closed-thread composer was wired as `busy={busy || readOnly}`, so an archived thread
  rendered "The Director is working…" plus a stop button — a straight lie about the state.
  `readOnly` is now its own prop.

### Not yet true (D4/D5)

- Threads carry a `bind` field but nothing sets it; every thread is a Studio thread.
- The Writers Room (`writers.tsx:50`) posts into the project's **active** thread. That is
  already better than one perpetual chat, but it is not yet the episode's own thread.
- `summary` is persisted and always `""`; closing a thread writes no handoff.
- The stale-`sessionId` recovery in §10 is NOT implemented — a resume against a session Claude
  Code has pruned still surfaces as the generic "couldn't reach the local Claude engine" error.
  Left out deliberately rather than guessing at SDK error strings.
