/* 3D lab E2E — a real textured GLB through labs.model3d, the same path the
 * lab's two buttons take.
 *
 * Needs: the operator's Hunyuan3D-2.1 checkout (settings engines.hunyuan3dDir
 * / hunyuan3dPython, or the D:\hunyuan3d convention probe).
 *
 * Default is the fast path — an existing still, shape only — because that is
 * the assertion that matters most often (does the runner still work, and does
 * the GLB reach the library). The slow paths are opt-in:
 *   --textured   paint PBR textures too (~3 min instead of ~1)
 *   --prompt     start from a subject, exercising the image → mesh chain
 * Run: npx tsx scripts/test-model3d.mts [--textured] [--prompt] */

import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const { startStudiod } = await import("../packages/core/src/server.js");
const { createStudiodApi } = await import("../packages/core/src/tools.js");

const argv = process.argv.slice(2);
const textured = argv.includes("--textured");
const fromPrompt = argv.includes("--prompt");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const handle = await startStudiod({ writePortFile: false });
const api = createStudiodApi(handle.port, handle.token);
const project = (await api.projects.list.query())[0].id;

try {
  const catalog = await api.labs.model3d.catalog.query();
  const engine = catalog.engines.find((e: { id: string }) => e.id === "hunyuan3d-2.1");
  check("hunyuan3d-2.1 engine in the catalog and available", !!engine?.available, engine?.note);
  check(
    "catalog carries the licence the output is bound by",
    /attribution/i.test(catalog.license),
    catalog.license,
  );

  const startedAt = new Date().toISOString();
  // Jobs carry no timestamp and finished ones linger in the list, so a run
  // that only matched on payload type latched onto the PREVIOUS run's mesh
  // job and "passed" in 0s. Everything already here is out of scope.
  const before = new Set((await api.jobs.list.query()).map((j) => j.id));
  let job: { id: string };
  if (fromPrompt) {
    job = await api.labs.model3d.fromPrompt.mutate({
      project,
      subject: "a dented brass kettle with a worn wooden handle",
      model: "z-image",
      textured,
      octree: 256,
      seed: 42,
    });
    console.log(`enqueued ${job.id} (concept still — the mesh job chains off it)`);
  } else {
    // any still in the library will do; the newest is the least surprising
    const stills = (await api.library.list.query()).assets
      .filter((a) => a.kind === "image")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!stills.length) throw new Error("no stills in the library — run with --prompt instead");
    job = await api.labs.model3d.generate.mutate({
      project,
      source: stills[0].relPath,
      name: "e2e test model",
      textured,
      octree: 256,
      seed: 42,
    });
    console.log(`enqueued ${job.id} from ${stills[0].relPath}`);
  }

  // The prompt path is two jobs: watch until a model3d job has finished, not
  // just the one that was enqueued — the mesh job does not exist yet.
  const stages = new Set<string>();
  // The bar has to MOVE, not just change stage name. Both long stages narrate
  // through tqdm, whose carriage-return redraws never reach a line parser
  // that splits on newlines alone — so this is wired and still frozen unless
  // proc.ts's splitCarriageReturns is on.
  const progresses = new Set<number>();
  const started = Date.now();
  let final: { id: string; status: string; error?: string | null; output?: string | null } | undefined;
  for (;;) {
    const jobs = await api.jobs.list.query();
    const fresh = jobs.filter((j) => !before.has(j.id));
    for (const j of fresh) {
      if (j.stage) stages.add(j.stage);
      if (j.payload?.type === "model3d" && typeof j.progress === "number") {
        progresses.add(Math.round(j.progress));
      }
    }
    const mesh = fresh.find((j) => j.payload?.type === "model3d");
    if (mesh && (mesh.status === "completed" || mesh.status === "failed")) {
      final = mesh;
      break;
    }
    const seed = fresh.find((j) => j.id === job.id);
    if (seed?.status === "failed" && !mesh) {
      final = seed;
      break;
    }
    if (Date.now() - started > 40 * 60_000) {
      await api.jobs.cancel.mutate({ id: job.id }).catch(() => {});
      throw new Error(`timed out after 40 min (stages: ${[...stages].join(" | ")})`);
    }
    await sleep(2000);
  }
  const tookSec = Math.round((Date.now() - started) / 1000);

  check("mesh job completed", final!.status === "completed", final!.error ?? `${tookSec}s`);
  const out = final!.output;
  check(
    "GLB on disk and not a stub",
    !!out && fs.existsSync(out) && fs.statSync(out).size > 100_000,
    out ? `${(fs.statSync(out).size / 1024).toFixed(0)} KB` : "",
  );
  // The shape stage caches to <out>.shape.ply so a texture retry is cheap.
  // It lives in the job's scratch dir, NOT beside the delivered file — job
  // .output is where the importer PUT the artifact, not where it was built.
  const scratch = path.join(homedir(), ".aurea", "runs", final!.id ?? job.id, "out", "model.glb");
  check("shape cache kept in the run dir for a cheap texture retry", fs.existsSync(`${scratch}.shape.ply`), scratch);
  check(
    "progress stages name both halves of the run",
    [...stages].some((s) => /shape|mesh|cubes/i.test(s)),
    [...stages].slice(0, 6).join(" | "),
  );
  const moving = [...progresses].filter((p) => p > 4 && p < 97);
  check(
    "the bar moved inside the stages, not just between them",
    moving.length >= 8,
    `${moving.length} distinct values in 5–96: ${moving.slice(0, 10).join(", ")}…`,
  );

  const asset = (await api.library.list.query()).assets.find(
    (a) => a.kind === "model3d" && a.createdAt >= startedAt,
  );
  check("model imported onto the 3D shelf", !!asset, asset?.relPath);
  check(
    "sidecar carries the face count and the licence obligation",
    !!asset?.meta?.faces && /attribution/i.test(asset?.meta?.license ?? ""),
    `${asset?.meta?.faces} faces · textured=${asset?.meta?.textured}`,
  );
  if (asset) {
    // the lab reads the still back off the sidecar to show "lifted from"
    check(
      "sidecar points back at the concept still it was lifted from",
      !!asset.meta?.source &&
        fs.existsSync(path.resolve((await api.settings.get.query()).storage.dataRoot, asset.meta.source)),
      asset.meta?.source,
    );
  }
  console.log(`\n${tookSec}s total (${textured ? "shape + PBR texture" : "shape only"})`);
} finally {
  await handle.close();
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
