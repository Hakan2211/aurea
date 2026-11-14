/* Stage 1 of the multi-shot podcast pilot — the ONE boarded start frame the
 * whole thing runs from.
 *
 * The pilot's question (docs/VIDEO-SPEED-RELIABILITY-2026-08-31.md §3.1) is
 * whether LTX 2.5 will cut inside a single generation when the prompt is
 * written as multi-shot prose. That question is only answerable if identity is
 * already nailed down at t=0 — otherwise a "cut" and a "the lion turned into a
 * different lion" look the same on screen. So the board carries both hosts,
 * staged, on-model, in the set, exactly like the debate boards do.
 *
 * Recipe (proven in scripts/debate/01-boards.ts and the Krea2 memo):
 *   plate  — GPT-Image-2, because krea2's set rails fight artDirection's
 *            shallow-DoF look, and a booth full of mic hardware is exactly the
 *            kind of plate krea2 flattens into 2D game art
 *   board  — qwen-edit with THREE refs (host, host, plate): the local edit
 *            model is what holds a character on-model, and 3 is its ceiling
 *
 *   npx tsx scripts/podcast/01-board.ts [--replate] [--reboard]
 */

import fs from "node:fs";
import path from "node:path";

const { startStudiod } = await import("../../packages/core/src/server.js");
const { createStudiodApi } = await import("../../packages/core/src/tools.js");

const PROJECT = "zoo-logic";
const DATA_ROOT = path.join(process.env.USERPROFILE!, "Aurea");
/* the render canvas, so the board is already the right shape and the centre
 * crop in the graph takes nothing away */
const W = 1280;
const H = 704;

const HERE = path.join(process.cwd(), "scripts", "podcast");
const OUT = path.join(HERE, "boards.json");

const args = process.argv.slice(2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const STYLE_TAIL =
  "Stylized 3D animation, Pixar / Illumination feature quality, soft subsurface scattering, " +
  "detailed fur and fabric, warm bounce light, shallow cinematic depth of field, cinematic 3D " +
  "render. No text, no lettering, no labels, no captions, no signage anywhere in the image.";

const handle = await startStudiod({ writePortFile: false });
const api = createStudiodApi(handle.port, handle.token);
const rel = (abs: string) => path.relative(DATA_ROOT, abs).split(path.sep).join("/");

async function runImage(label: string, input: Record<string, unknown>): Promise<string> {
  const job: any = await api.labs.image.generate.mutate({ project: PROJECT, ...input } as any);
  process.stdout.write(`  ${label} … job=${job.id} `);
  const deadline = Date.now() + 30 * 60_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`${label} timed out`);
    const j: any = (await api.jobs.list.query()).find((x) => x.id === job.id);
    if (j?.status === "completed" && j.output) {
      const out = rel(j.output as string);
      console.log(`OK  ${out}`);
      return out;
    }
    if (j?.status === "failed") throw new Error(`${label} failed: ${j.error}`);
    await sleep(4000);
  }
}

try {
  const bible: any = await api.studio.bible.get.query({ project: PROJECT });
  const byId = (id: string) => {
    const c = bible.characters.find((x: any) => x.id === id);
    if (!c?.refs?.keyframeRef) throw new Error(`"${id}" has no keyframeRef in the bible`);
    return c;
  };
  /* the bible's own identity language — the same sentence the render prompt
   * will use to name each host, so the board and the beats agree */
  const subj = (c: any) =>
    `${c.name}, this exact ${c.species} character wearing ${c.wardrobe}` +
    (c.anchors?.face ? ` — ${c.anchors.face}` : "");

  const boards: Record<string, string> = fs.existsSync(OUT)
    ? JSON.parse(fs.readFileSync(OUT, "utf8"))
    : {};
  const save = () => fs.writeFileSync(OUT, JSON.stringify(boards, null, 2));

  console.log("== plate ==");
  if (!boards["plate-booth"] || args.includes("--replate")) {
    boards["plate-booth"] = await runImage("plate-booth", {
      prompt:
        "An empty small recording booth interior, warm lamplight, dark acoustic foam panels on " +
        "the back wall, a heavy wooden table across the middle of the frame with two large " +
        "studio microphones on black boom arms angled toward two empty chairs facing each other " +
        "across it, a pair of headphones resting on the table, a glass of water, soft practical " +
        "lamps in the background going out of focus. Shot from across the table at seated eye " +
        "level. No people, no animals, no screens, no posters, no text. " +
        STYLE_TAIL,
      model: "gpt-image-2",
      aspect: "16:9",
      quality: "high",
      count: 1,
    });
    save();
  } else console.log(`  plate-booth (cached) ${boards["plate-booth"]}`);

  console.log("\n== board — Sterling and Milo at the table ==");
  if (!boards["booth-two-shot"] || args.includes("--reboard")) {
    const a = byId("sterling");
    const b = byId("milo");
    boards["booth-two-shot"] = await runImage("booth-two-shot", {
      prompt:
        `Put both characters into the recording booth from the third reference image, seated at ` +
        `the table facing each other across it, each behind one of the studio microphones. On the ` +
        `left, ${subj(a)}, sitting upright and relaxed with his paws folded on the table. On the ` +
        `right, ${subj(b)}, perched forward on his chair with both paws on the table edge, ` +
        `headphones round his neck. Mid-conversation, waist-up two-shot from across the table, ` +
        `both faces clearly visible, warm lamplight, the foam panels behind them. Keep both ` +
        `characters exactly on-model. ${STYLE_TAIL}`,
      model: "qwen-edit",
      refs: [a.refs.keyframeRef, b.refs.keyframeRef, boards["plate-booth"]],
      width: W,
      height: H,
      count: 1,
    });
    save();
  } else console.log(`  booth-two-shot (cached) ${boards["booth-two-shot"]}`);

  console.log("\n=== boards ===");
  for (const [k, v] of Object.entries(boards)) console.log(`${k.padEnd(16)} ${v}`);
  console.log(`\nwritten to ${OUT}`);
} finally {
  await handle.close();
}
process.exit(0);
