/* Board a start keyframe per shot: qwen-edit with the two character refs +
 * the empty-breakroom plate, so the Director shot starts from a frame where the
 * cast is ALREADY staged in the room. Rendering off an empty plate lets the
 * reference sheet out-vote the set once beats + an audio lane are in play. */
import { composeKeyframePrompt } from "@aurea/shared";
import { createStudiodApi } from "../packages/core/src/tools.js";
import { readPortFile } from "../packages/core/src/portfile.js";

const PROJECT = "playground";
const PLATE = "projects/playground/assets/image/an-empty-office-breakroom-interior-warm-si.png";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const pf = await readPortFile();
  if (!pf) throw new Error("no studiod port file");
  const api = createStudiodApi(pf.port, pf.token);
  const bible: any = await api.studio.bible.get.query({ project: PROJECT });
  const byId = (id: string) => bible.characters.find((c: any) => c.id === id);

  const shots = [
    { slug: "hood", a: "valentino", b: "silas" },
    { slug: "plan", a: "alli", b: "omar" },
  ];

  const ids: Record<string, string> = {};
  for (const s of shots) {
    const ca = byId(s.a);
    const cb = byId(s.b);
    const subj = (c: any) =>
      `${c.name}, this exact ${c.species} character wearing ${c.wardrobe}${
        c.anchors.face ? ` — ${c.anchors.face}` : ""
      }`;
    const prompt =
      `Put both characters into the office breakroom from the third reference image. ` +
      `On the left, ${subj(ca)}. On the right, ${subj(cb)}. They stand either side of the ` +
      `coffee machine facing each other, mid-conversation, waist-up two-shot. Warm ` +
      `late-afternoon sitcom light through the window blinds, the counter and cabinets ` +
      `behind them. Keep both characters exactly on-model. Stylized 3D animation, Pixar / ` +
      `Illumination quality, cinematic 3D render.`;

    const job: any = await api.labs.image.generate.mutate({
      project: PROJECT,
      prompt,
      model: "qwen-edit",
      refs: [ca.refs.keyframeRef, cb.refs.keyframeRef, PLATE],
      width: 896,
      height: 704,
      count: 1,
    });
    ids[s.slug] = job.id;
    console.log(`queued ${s.slug} (${ca.name} + ${cb.name}) job=${job.id}`);
  }

  const done: Record<string, any> = {};
  const deadline = Date.now() + 30 * 60_000;
  while (Object.keys(done).length < shots.length && Date.now() < deadline) {
    const jobs: any[] = await api.jobs.list.query();
    for (const s of shots) {
      if (done[s.slug]) continue;
      const j = jobs.find((x) => x.id === ids[s.slug]);
      if (j && (j.status === "completed" || j.status === "failed")) {
        done[s.slug] = j;
        console.log(`${j.status === "completed" ? "OK  " : "FAIL"} ${s.slug}: ${j.output ?? j.error ?? ""}`);
      }
    }
    if (Object.keys(done).length < shots.length) await sleep(5000);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
