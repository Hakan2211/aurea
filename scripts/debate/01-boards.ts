/* Stage 1 — plates and boarded start frames, all through the Aurea Image lab.
 *
 * Why boards at all: a Director shot that starts from an EMPTY room loses to
 * its own reference sheet — once beats and an audio lane are in play LTX
 * animates the sheet (white ground, cell labels) instead of the set. Starting
 * from a frame where the cast is already staged fixes it.
 *
 * Why chained passes: qwen-edit takes at most 3 reference images, and these
 * scenes hold up to five characters. So each board is built by adding cast to
 * the previous board — pass N's output becomes pass N+1's scene reference.
 * That also gets video 3 for free: its five-shot is literally its three-shot
 * with two more characters walked into it. */

import path from "node:path";
import fs from "node:fs";
import { createStudiodApi } from "../../packages/core/src/tools.js";
import { readPortFile } from "../../packages/core/src/portfile.js";

const PROJECT = "playground";
const DATA_ROOT = path.join(process.env.USERPROFILE!, "Aurea");
const W = 896;
const H = 704;

/* already in the library from the V6/V7 work */
const BREAKROOM_PLATE = "projects/playground/assets/image/an-empty-office-breakroom-interior-warm-si.png";

const STYLE_TAIL =
  "Stylized 3D animation, Pixar / Illumination quality, soft subsurface scattering, detailed fur " +
  "and fabric, cinematic 3D render. No text, no labels, no captions anywhere in the image.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Api = ReturnType<typeof createStudiodApi>;

/** dataRoot-relative, forward slashes — the form every lab takes */
const rel = (abs: string) => path.relative(DATA_ROOT, abs).split(path.sep).join("/");

async function runImage(
  api: Api,
  label: string,
  input: Record<string, unknown>,
): Promise<string> {
  const job: any = await api.labs.image.generate.mutate({ project: PROJECT, ...input } as any);
  process.stdout.write(`  ${label} … job=${job.id} `);
  const deadline = Date.now() + 30 * 60_000;
  while (Date.now() < deadline) {
    const jobs: any[] = await api.jobs.list.query();
    const j = jobs.find((x) => x.id === job.id);
    if (j?.status === "completed" && j.output) {
      const out = rel(j.output as string);
      console.log(`OK  ${out}`);
      return out;
    }
    if (j?.status === "failed") throw new Error(`${label} failed: ${j.error}`);
    await sleep(4000);
  }
  throw new Error(`${label} timed out`);
}

async function main() {
  const pf = await readPortFile();
  if (!pf) throw new Error("no studiod port file — run `npm run studiod`");
  const api = createStudiodApi(pf.port, pf.token);

  const bible: any = await api.studio.bible.get.query({ project: PROJECT });
  const byId = (id: string) => {
    const c = bible.characters.find((x: any) => x.id === id);
    if (!c?.refs?.keyframeRef) throw new Error(`"${id}" has no keyframeRef in the bible`);
    return c;
  };

  /* how a character is described when qwen-edit is asked to stage them: the
   * bible's own identity language, so every board says the same thing */
  const subj = (c: any) =>
    `${c.name}, this exact ${c.species} character wearing ${c.wardrobe}` +
    (c.anchors?.face ? ` — ${c.anchors.face}` : "");

  const boards: Record<string, string> = {};
  const outFile = path.join(process.cwd(), "scripts", "debate", "boards.json");
  if (fs.existsSync(outFile)) Object.assign(boards, JSON.parse(fs.readFileSync(outFile, "utf8")));
  const save = () => fs.writeFileSync(outFile, JSON.stringify(boards, null, 2));
  const have = (k: string) => Boolean(boards[k]);

  /* ---------------------------------------------------------------- plates */
  console.log("\n== plates ==");
  if (!have("plate-meeting")) {
    boards["plate-meeting"] = await runImage(api, "plate-meeting", {
      prompt:
        "An empty small office meeting room interior, cool daylight through blinds on the far wall, " +
        "a long pale table with six empty chairs, a whiteboard on the back wall wiped clean with no " +
        "writing on it, a water jug and glasses on the table. No people, no animals, no text. " +
        STYLE_TAIL,
      model: "krea2",
      width: W,
      height: H,
      count: 1,
    });
    save();
  }
  if (!have("plate-loft")) {
    boards["plate-loft"] = await runImage(api, "plate-loft", {
      prompt:
        "An empty warm cluttered warehouse loft interior in the evening, string lights overhead, a " +
        "battered sofa, mismatched armchairs, a low coffee table, brick wall and tall windows behind. " +
        "No people, no animals, no text. " +
        STYLE_TAIL,
      model: "krea2",
      width: W,
      height: H,
      count: 1,
    });
    save();
  }

  /* ------------------------------------------------- video 1 — breakroom */
  console.log("\n== video 1 · breakroom ==");
  if (!have("breakroom-pair")) {
    const a = byId("sterling");
    const b = byId("milo");
    boards["breakroom-pair"] = await runImage(api, "breakroom-pair", {
      prompt:
        `Put both characters into the office breakroom from the third reference image. On the left, ` +
        `${subj(a)}. On the right, ${subj(b)}. They face each other across the counter beside the ` +
        `coffee machine, mid-argument, waist-up two-shot with space between them. Warm late-afternoon ` +
        `sitcom light through the window blinds. Keep both characters exactly on-model. ${STYLE_TAIL}`,
      model: "qwen-edit",
      refs: [a.refs.keyframeRef, b.refs.keyframeRef, BREAKROOM_PLATE],
      width: W,
      height: H,
      count: 1,
    });
    save();
  }
  if (!have("breakroom-trio")) {
    const c = byId("bruno");
    boards["breakroom-trio"] = await runImage(api, "breakroom-trio", {
      prompt:
        `Add one more character to this breakroom scene, keeping the lion and the meerkat exactly as ` +
        `they are. Behind and between them, standing back against the counter, put ${subj(c)}, holding ` +
        `a coffee mug in both hands and listening. All three characters visible, waist-up three-shot. ` +
        `Same warm sitcom light, same room, same framing. ${STYLE_TAIL}`,
      model: "qwen-edit",
      refs: [c.refs.keyframeRef, boards["breakroom-pair"]],
      width: W,
      height: H,
      count: 1,
    });
    save();
  }
  if (!have("breakroom-trio-2")) {
    boards["breakroom-trio-2"] = await runImage(api, "breakroom-trio-2", {
      prompt:
        `Same three characters in the same office breakroom, same wardrobe, same light — re-frame the ` +
        `shot slightly tighter and from a little further to the right, so the meerkat is nearer camera ` +
        `leaning in and the lion is turned toward him, the gorilla still behind them with his mug. ` +
        `Waist-up three-shot. Keep all three characters exactly on-model. ${STYLE_TAIL}`,
      model: "qwen-edit",
      refs: [boards["breakroom-trio"]],
      width: W,
      height: H,
      count: 1,
    });
    save();
  }

  /* --------------------------------------------------- video 2 — meeting */
  console.log("\n== video 2 · meeting room ==");
  if (!have("meeting-pair")) {
    const a = byId("alli");
    const b = byId("valentino");
    boards["meeting-pair"] = await runImage(api, "meeting-pair", {
      prompt:
        `Put both characters into the meeting room from the third reference image, seated at the long ` +
        `table facing each other across it. On the left, ${subj(a)}. On the right, ${subj(b)}. ` +
        `Mid-discussion, waist-up two-shot, cool daylight. The whiteboard behind them stays blank. ` +
        `Keep both characters exactly on-model. ${STYLE_TAIL}`,
      model: "qwen-edit",
      refs: [a.refs.keyframeRef, b.refs.keyframeRef, boards["plate-meeting"]],
      width: W,
      height: H,
      count: 1,
    });
    save();
  }
  /* One character per pass. Adding TWO at once made qwen-edit REPLACE a sitter
   * instead of adding to them — the first attempt at this board came back with
   * the elephant and the tiger in the room and the penguin gone. Naming the
   * characters already in the frame, one new arrival at a time, holds them. */
  if (!have("meeting-trio")) {
    const c = byId("omar");
    boards["meeting-trio"] = await runImage(api, "meeting-trio", {
      prompt:
        `Add ONE more character to this meeting room. The penguin in the tactical vest and the hippo in ` +
        `the floral robe must both STAY exactly where they are, unchanged. Seated at the head of the ` +
        `same table between them, add ${subj(c)}. All three characters visible around the table, ` +
        `waist-up three-shot, same cool daylight, blank whiteboard. ${STYLE_TAIL}`,
      model: "qwen-edit",
      refs: [c.refs.keyframeRef, boards["meeting-pair"]],
      width: W,
      height: H,
      count: 1,
    });
    save();
  }
  if (!have("meeting-quartet")) {
    const d = byId("silas");
    boards["meeting-quartet"] = await runImage(api, "meeting-quartet", {
      prompt:
        `Add ONE more character to this meeting room. The penguin in the tactical vest, the hippo in the ` +
        `floral robe and the elephant in the linen shirt must ALL STAY exactly where they are, unchanged. ` +
        `Standing back against the wall behind the table, add ${subj(d)}, arms folded, saying nothing. ` +
        `All four characters visible, waist-up four-shot, same cool daylight, blank whiteboard. ${STYLE_TAIL}`,
      model: "qwen-edit",
      refs: [d.refs.keyframeRef, boards["meeting-trio"]],
      width: W,
      height: H,
      count: 1,
    });
    save();
  }
  if (!have("meeting-quartet-2")) {
    boards["meeting-quartet-2"] = await runImage(api, "meeting-quartet-2", {
      prompt:
        `Same four characters at the same meeting table, same wardrobe, same light — re-frame from the ` +
        `other end of the table so the elephant is nearer camera and the penguin and hippo are turned ` +
        `toward him, the tiger still slouched at the side. Waist-up four-shot, blank whiteboard. ` +
        `Keep all four characters exactly on-model. ${STYLE_TAIL}`,
      model: "qwen-edit",
      refs: [boards["meeting-quartet"]],
      width: W,
      height: H,
      count: 1,
    });
    save();
  }

  /* ------------------------------------------------------ video 3 — loft */
  console.log("\n== video 3 · loft ==");
  if (!have("loft-pair")) {
    const a = byId("grant");
    const b = byId("jax");
    boards["loft-pair"] = await runImage(api, "loft-pair", {
      prompt:
        `Put both characters into the warehouse loft from the third reference image. On the left, ` +
        `${subj(a)}, standing. On the right, ${subj(b)}, perched on the arm of the sofa. They are ` +
        `mid-argument, waist-up two-shot, warm evening light from the string lights. Keep both ` +
        `characters exactly on-model. ${STYLE_TAIL}`,
      model: "qwen-edit",
      refs: [a.refs.keyframeRef, b.refs.keyframeRef, boards["plate-loft"]],
      width: W,
      height: H,
      count: 1,
    });
    save();
  }
  if (!have("loft-trio")) {
    const c = byId("barney");
    boards["loft-trio"] = await runImage(api, "loft-trio", {
      prompt:
        `Add one more character to this loft scene, keeping the giraffe and the eagle exactly as they ` +
        `are. Draped along the back of the sofa between them, put ${subj(c)}, head raised and watching ` +
        `the argument. All three characters visible, waist-up three-shot, same warm string lights, ` +
        `same room, same framing. ${STYLE_TAIL}`,
      model: "qwen-edit",
      refs: [c.refs.keyframeRef, boards["loft-pair"]],
      width: W,
      height: H,
      count: 1,
    });
    save();
  }
  if (!have("loft-quartet")) {
    const d = byId("sterling");
    boards["loft-quartet"] = await runImage(api, "loft-quartet", {
      prompt:
        `ONE more character has just walked into this loft. The giraffe, the eagle and the snake must ALL ` +
        `STAY exactly where they are, unchanged. Entering from the right and standing at the edge of the ` +
        `group, add ${subj(d)}. All four characters visible in one wide waist-up group shot, same warm ` +
        `string lights, same room. ${STYLE_TAIL}`,
      model: "qwen-edit",
      refs: [d.refs.keyframeRef, boards["loft-trio"]],
      width: W,
      height: H,
      count: 1,
    });
    save();
  }
  if (!have("loft-quintet")) {
    const e = byId("milo");
    boards["loft-quintet"] = await runImage(api, "loft-quintet", {
      prompt:
        `ONE more character has just walked into this loft. The giraffe, the eagle, the snake and the lion ` +
        `must ALL STAY exactly where they are, unchanged. Just behind the lion on the right, add ` +
        `${subj(e)}, who has come in with him. All five characters visible in one wide waist-up group ` +
        `shot, same warm string lights, same room. ${STYLE_TAIL}`,
      model: "qwen-edit",
      refs: [e.refs.keyframeRef, boards["loft-quartet"]],
      width: W,
      height: H,
      count: 1,
    });
    save();
  }

  console.log("\n=== boards ===");
  for (const [k, v] of Object.entries(boards)) console.log(`${k.padEnd(20)} ${v}`);
  console.log(`\nwritten to ${outFile}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
