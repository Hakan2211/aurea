/* F3 — does H3's ref2va honour a STYLE reference separately from identity?
 * (VIDEO-LAB-FREEFORM-PLAN.md §2.4). Three renders of one prompt at ONE seed:
 *
 *   A  style   — the still attached with role "style": the adapter appends
 *                the reference-footage clause (withStyleRefs) and the prompt
 *                never names the picture as a subject
 *   B  subject — the same still attached the naive way (role "subject") and
 *                named in the prompt as a reference
 *   C  none    — no references at all (fl2va text-to-video), the control
 *
 * The role is real if A carries the still's palette/grade/texture WITHOUT its
 * content and B pulls the content in; if A and B look the same, or A looks
 * like C, the field is a placebo and comes out (the plan is explicit).
 *
 * Run: npx tsx scripts/ab-h3-style-ref.mts <style-still relPath> [seed]
 * Env: STUDIOD_PORT / STUDIOD_TOKEN (default 4199 / uiverify), AB_PROJECT. */
import fs from "node:fs";
import path from "node:path";

const { createStudiodApi } = await import("../packages/core/src/tools.js");
const { composeH3Prompt } = await import("../packages/shared/src/h3Prompt.js");

const still = process.argv[2];
if (!still) throw new Error("usage: ab-h3-style-ref.mts <style-still relPath> [seed]");
const seed = Number(process.argv[3] ?? 424242);
const port = Number(process.env.STUDIOD_PORT ?? 4199);
const token = process.env.STUDIOD_TOKEN ?? "uiverify";
const project = process.env.AB_PROJECT ?? "playground";
const api = createStudiodApi(port, token);

const ACTION =
  "A red fox trots across a cobbled market square at dusk, stops at a fruit stall and looks up at the lanterns. The camera holds still.";
const block = (action: string) =>
  composeH3Prompt({
    subjects: [],
    summary: action,
    beats: [{ fromSec: 0, toSec: 4, action, lines: [] }],
    soundscape: "evening market ambience: distant voices, a cart wheel, no music",
    music: null,
  });

const base = {
  project,
  engine: "minimax-h3",
  durationSec: 4,
  resolution: "1344 × 768 (16:9 · H3 native)",
  fast: true,
  minimaxTier: "draft" as const,
  seed,
};

const arms = [
  {
    label: "A style",
    prompt: block(ACTION),
    minimaxRefs: { images: [still], imageRoles: ["style" as const], videos: [], audios: [], imageSize: "match" as const },
  },
  {
    label: "B subject",
    prompt: block(`${ACTION} Use <Picture 1> as the reference for this shot.`),
    minimaxRefs: { images: [still], imageRoles: ["subject" as const], videos: [], audios: [], imageSize: "match" as const },
  },
  { label: "C none", prompt: block(ACTION), minimaxRefs: undefined },
];

const ids: { label: string; id: string }[] = [];
for (const arm of arms) {
  const job = await api.labs.video.generate.mutate({ ...base, prompt: arm.prompt, minimaxRefs: arm.minimaxRefs });
  console.log(`${arm.label}: job ${job.id}`);
  ids.push({ label: arm.label, id: job.id });
}

const done = new Set(["completed", "failed", "canceled", "cancelled"]);
for (;;) {
  await new Promise((r) => setTimeout(r, 15_000));
  const jobs = await api.jobs.list.query();
  const mine = ids.map((x) => ({ ...x, job: jobs.find((j) => j.id === x.id) }));
  console.log(
    `${new Date().toISOString().slice(11, 19)} ` +
      mine.map((m) => `${m.label}:${m.job?.status ?? "?"}${m.job?.status === "running" ? ` ${m.job.progress}%` : ""}`).join(" | "),
  );
  if (mine.every((m) => m.job && done.has(m.job.status))) {
    const out = mine.map((m) => ({
      label: m.label,
      status: m.job!.status,
      output: m.job!.output,
      error: m.job!.error,
      seed,
      still,
    }));
    fs.mkdirSync(path.join("scripts", "out"), { recursive: true });
    fs.writeFileSync(path.join("scripts", "out", "ab-h3-style-ref.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    break;
  }
}
process.exit(0);
