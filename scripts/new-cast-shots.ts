/* Two Shot-Director two-handers proving the 4 new Zoo Logic characters render
 * on-model with their own cloned voices. Same recipe as the V6 acceptance:
 * the empty-breakroom start frame + cast refs off the bible + voice takes on
 * the audio lane + beats that name the speaker. */
import { castRef } from "@aurea/shared";
import { createStudiodApi } from "../packages/core/src/tools.js";
import { readPortFile } from "../packages/core/src/portfile.js";

const PROJECT = "playground";
/* Boarded start frames (scripts/new-cast-keyframes.ts): the cast already staged
 * in the breakroom. Starting from the EMPTY plate loses — over a shot with beats
 * and an audio lane the reference sheet out-votes the set and LTX animates the
 * sheet instead of the scene (three passes proved it). */
const START_FRAMES: Record<string, string> = {
  "zoologic-hood": "projects/playground/assets/image/put-both-characters-into-the-office-breakro.png",
  "zoologic-oh-nine-hundred": "projects/playground/assets/image/put-both-characters-into-the-office-breakro-2.png",
};
const RES = "896 × 704";

const TAKES = {
  valentino: { rel: "projects/playground/assets/audio/darling-you-have-been-wearing-that-hood-fo.wav", sec: 3.2 },
  silas: { rel: "projects/playground/assets/audio/it-s-not-a-hood-it-s-a-personality.wav", sec: 3.6 },
  alli: { rel: "projects/playground/assets/audio/new-plan-everyone-reports-here-at-oh-nine.wav", sec: 4.5 },
  omar: { rel: "projects/playground/assets/audio/mm-hmm-or-we-could-just-have-breakfast.wav", sec: 3.4 },
};

const LEAD_IN = 0.4; // beat of room before the first line
const GAP = 0.8; // < 1.5s or LTX invents dialogue
const TAIL = 0.5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const pf = await readPortFile();
  if (!pf) throw new Error("no studiod port file");
  const api = createStudiodApi(pf.port, pf.token);

  const bible: any = await api.studio.bible.get.query({ project: PROJECT });
  const byId = (id: string) => {
    const c = bible.characters.find((x: any) => x.id === id);
    if (!c) throw new Error(`no bible character "${id}"`);
    if (!c.refs.keyframeRef) throw new Error(`"${id}" has no keyframeRef`);
    return c;
  };

  /* Prompts stay SCENE-first and short, anchored to a prop in the room. The
   * first pass described both characters head-to-toe standing side by side —
   * which is exactly what the reference sheet looks like, so LTX animated the
   * sheet (white ground, garbled cell labels) instead of the breakroom. The
   * sheet's own description block already carries the wardrobe; the prompt's
   * job is only to say where they are and who is talking. */
  const shots = [
    {
      slug: "zoologic-hood",
      a: "valentino",
      b: "silas",
      prompt:
        "An office breakroom in warm late-afternoon sitcom light. A big hippo in a floral silk robe " +
        "and a lean tiger in a hooded denim jacket stand either side of the coffee machine, talking. " +
        "Static two-shot, waist up.",
      beatA:
        "Inside the office breakroom, either side of the coffee machine, warm sitcom light through " +
        "the window blinds. Valentino the hippo is talking — mouth moving, one brow arched, amused. " +
        "Silas the tiger listens with his MOUTH CLOSED, jaw set.",
      beatB:
        "Inside the office breakroom, either side of the coffee machine, warm sitcom light through " +
        "the window blinds. Silas the tiger is talking — mouth moving, deadpan sliding into a small " +
        "sarcastic smirk, chin tipping away. Valentino the hippo watches him, unimpressed, MOUTH CLOSED.",
    },
    {
      slug: "zoologic-oh-nine-hundred",
      a: "alli",
      b: "omar",
      prompt:
        "An office breakroom in warm late-afternoon sitcom light. A compact penguin in a tactical " +
        "vest and a large elephant in a linen shirt stand either side of the coffee machine, talking. " +
        "Static two-shot, waist up.",
      beatA:
        "Inside the office breakroom, either side of the coffee machine, warm sitcom light through " +
        "the window blinds. Allistaire the penguin is talking — beak moving, crisp and commanding, " +
        "one flipper snapped out pointing off-frame. Omar the elephant listens with his MOUTH CLOSED, " +
        "heavy-lidded.",
      beatB:
        "Inside the office breakroom, either side of the coffee machine, warm sitcom light through " +
        "the window blinds. Omar the elephant is talking — mouth moving, slow and dry, a faint knowing " +
        "smile. Allistaire the penguin stares at him, deflated, BEAK CLOSED.",
    },
  ];

  /* fights the observed failure directly: the sheet's own look leaking in */
  const NEG =
    (bible.style?.negativePrompt ?? "") +
    ", reference sheet, contact sheet, character sheet, split screen, side-by-side portraits, " +
    "studio backdrop, plain white background, full-body turnaround, text, labels, captions";

  const jobIds: Record<string, string> = {};

  for (const s of shots) {
    const ca = byId(s.a);
    const cb = byId(s.b);
    const ta = TAKES[s.a as keyof typeof TAKES];
    const tb = TAKES[s.b as keyof typeof TAKES];

    const aAt = LEAD_IN;
    const bAt = aAt + ta.sec + GAP;
    const total = Number((bAt + tb.sec + TAIL).toFixed(2));
    const split = Number((bAt - GAP / 2).toFixed(2));

    const globalPrompt = s.prompt;
    const startFrame = START_FRAMES[s.slug];

    const spec = {
      globalPrompt,
      negativePrompt: NEG,
      fps: 24,
      keyframes: [{ image: startFrame, atSec: 0, strength: 1 }],
      promptZones: [
        { prompt: s.beatA, atSec: 0, lengthSec: split },
        { prompt: s.beatB, atSec: split, lengthSec: Number((total - split).toFixed(2)) },
      ],
      audio: [
        { take: ta.rel, atSec: aAt },
        { take: tb.rel, atSec: Number(bAt.toFixed(2)) },
      ],
      refs: [castRef(ca, ca.refs.keyframeRef), castRef(cb, cb.refs.keyframeRef)],
      refStrength: 1,
      inpaintAudio: true,
    };

    console.log(`\n=== ${s.slug} — ${ca.name} + ${cb.name} ===`);
    console.log(` duration ${total}s | ${ca.name} @${aAt}s (${ta.sec}s) | ${cb.name} @${bAt.toFixed(2)}s (${tb.sec}s) | beat split ${split}s`);
    console.log(` refs: ${spec.refs.map((r) => `${r.name} <- ${r.image.split("/").pop()}`).join(" | ")}`);

    const job: any = await api.labs.video.generate.mutate({
      project: PROJECT,
      prompt: globalPrompt,
      engine: "ltx2",
      startFrame,
      durationSec: total,
      resolution: RES,
      director: spec,
    });
    jobIds[s.slug] = job.id;
    console.log(` queued job=${job.id}`);
  }

  console.log("\nwaiting…");
  const done: Record<string, any> = {};
  const deadline = Date.now() + 60 * 60_000;
  let lastLog = 0;
  while (Object.keys(done).length < shots.length && Date.now() < deadline) {
    const jobs: any[] = await api.jobs.list.query();
    for (const s of shots) {
      if (done[s.slug]) continue;
      const j = jobs.find((x) => x.id === jobIds[s.slug]);
      if (j && (j.status === "completed" || j.status === "failed")) {
        done[s.slug] = j;
        console.log(`${j.status === "completed" ? "OK  " : "FAIL"} ${s.slug}: ${j.output ?? j.error ?? ""}`);
      }
    }
    if (Date.now() - lastLog > 60_000) {
      lastLog = Date.now();
      const live = jobs.filter((j) => Object.values(jobIds).includes(j.id));
      console.log(` … ${live.map((j) => `${j.id}:${j.status}${j.stage ? "/" + j.stage : ""} ${j.progress}%`).join("  ")}`);
    }
    if (Object.keys(done).length < shots.length) await sleep(10_000);
  }
  console.log("\n=== results ===");
  for (const s of shots) console.log(`${s.slug}: ${done[s.slug]?.status ?? "TIMED OUT"} ${done[s.slug]?.output ?? ""}`);
  process.exit(0);
}
main().catch((e) => { console.error(e?.message ?? e, e?.stack); process.exit(1); });
