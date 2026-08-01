/* Re-board one crowded frame, with the two levers that matter.
 *
 * The chained "add one character" recipe holds to three subjects and then
 * breaks: asked for a fourth, qwen-edit stops adding and starts SUBSTITUTING —
 * the penguin came back as a tiger wearing her tactical vest, and the elephant
 * simply left the room. Two things to try against that:
 *
 *   --sheet   composite every cast member into ONE reference image and board
 *             the whole group in a single pass off the empty plate, instead of
 *             walking them in one at a time. No pass ever has to preserve a
 *             character it can't see in its own subject ref.
 *   --order   scene-first ref order ([board, newcomer] rather than
 *             [newcomer, board]), which biases qwen-edit toward keeping what
 *             is already in the frame.
 *
 *   npx tsx scripts/debate/reboard.ts <boardKey> --sheet --cast a,b,c --plate <key> --prompt "…"
 */

import fs from "node:fs";
import path from "node:path";
import { composeRefSheet } from "../../packages/core/src/adapters/ref-sheet.js";
import { createStudiodApi } from "../../packages/core/src/tools.js";
import { readPortFile } from "../../packages/core/src/portfile.js";

const PROJECT = "playground";
const DATA_ROOT = path.join(process.env.USERPROFILE!, "Aurea");
const HERE = path.join(process.cwd(), "scripts", "debate");
const BOARDS = path.join(HERE, "boards.json");
const W = 896;
const H = 704;

const STYLE_TAIL =
  "Stylized 3D animation, Pixar / Illumination quality, soft subsurface scattering, detailed fur " +
  "and fabric, cinematic 3D render. No text, no labels, no captions anywhere in the image.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rel = (abs: string) => path.relative(DATA_ROOT, abs).split(path.sep).join("/");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const key = process.argv[2];
  if (!key) throw new Error("usage: reboard.ts <boardKey> [--sheet] --cast a,b,c --plate <key> --prompt '…'");

  const pf = await readPortFile();
  if (!pf) throw new Error("no studiod port file");
  const api = createStudiodApi(pf.port, pf.token);

  const boards: Record<string, string> = JSON.parse(fs.readFileSync(BOARDS, "utf8"));
  const bible: any = await api.studio.bible.get.query({ project: PROJECT });
  const byId = (id: string) => {
    const c = bible.characters.find((x: any) => x.id === id);
    if (!c?.refs?.keyframeRef) throw new Error(`"${id}" has no keyframeRef`);
    return c;
  };

  const cast = (arg("cast") ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(byId);
  const plateKey = arg("plate")!;
  const plate = boards[plateKey] ?? plateKey;
  const prompt = `${arg("prompt")} ${STYLE_TAIL}`;

  let refs: string[];
  if (flag("sheet")) {
    /* One image holding the whole cast, so a single pass can read every
     * subject at once. Same compositor the Director uses for LTX cast refs —
     * white ground, padded cells, no cropping. */
    const out = path.join(DATA_ROOT, "projects", PROJECT, "assets", "image", `castsheet-${key}.png`);
    const sheet = await composeRefSheet({
      images: cast.map((c) => path.join(DATA_ROOT, c.refs.keyframeRef)),
      out,
      aspect: W / H,
    });
    console.log(`cast sheet: ${sheet.cols}×${sheet.rows} → ${rel(sheet.file)}`);
    refs = [rel(sheet.file), plate];
  } else {
    refs = flag("order") ? [plate, ...cast.map((c) => c.refs.keyframeRef)] : [...cast.map((c) => c.refs.keyframeRef), plate];
  }

  console.log(`\n${key}\n  refs: ${refs.join("\n        ")}\n  prompt: ${prompt}\n`);

  const job: any = await api.labs.image.generate.mutate({
    project: PROJECT,
    prompt,
    model: "qwen-edit",
    refs,
    width: W,
    height: H,
    count: 1,
  });
  console.log(`job=${job.id}`);

  const deadline = Date.now() + 30 * 60_000;
  while (Date.now() < deadline) {
    const jobs: any[] = await api.jobs.list.query();
    const j = jobs.find((x) => x.id === job.id);
    if (j?.status === "completed" && j.output) {
      const out = rel(j.output as string);
      console.log(`OK  ${out}`);
      if (!flag("dry")) {
        const current: Record<string, string> = JSON.parse(fs.readFileSync(BOARDS, "utf8"));
        current[key] = out;
        fs.writeFileSync(BOARDS, JSON.stringify(current, null, 2));
        console.log(`saved boards.json["${key}"]`);
      }
      process.exit(0);
    }
    if (j?.status === "failed") throw new Error(`failed: ${j.error}`);
    await sleep(4000);
  }
  throw new Error("timed out");
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
