/* MiniMax-Music3 E2E — a real song through labs.music.generate on engine
 * "minimax-music3", the same path the Music lab's engine picker takes.
 *
 * Needs: the operator's music3 venv and weights (settings engines.music3Python
 * / music3ModelDir, or the D:\ convention probe).
 *
 * Flags: --instrumental drops the lyrics and asks for no vocals.
 *        --warm renders a SECOND song in the same studiod and asserts the warm
 *        worker actually paid off — the whole point of keeping the 11B
 *        pipeline resident is that song two skips the ~100s cold start.
 * Run: npx tsx scripts/test-music3.mts [--instrumental] [--warm] */

import fs from "node:fs";

const { startStudiod } = await import("../packages/core/src/server.js");
const { createStudiodApi } = await import("../packages/core/src/tools.js");

const argv = process.argv.slice(2);
const instrumental = argv.includes("--instrumental");
const warm = argv.includes("--warm");

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
  const catalog = await api.labs.music.catalog.query();
  const engine = catalog.engines.find((e: { id: string }) => e.id === "minimax-music3");
  check("minimax-music3 engine in the catalog and available", !!engine?.available, engine?.note);

  // one render, reported the way the Music lab reports it
  async function render(seed: number, label: string) {
    const startedAt = new Date().toISOString();
    const job = await api.labs.music.generate.mutate({
      project,
      engine: "minimax-music3",
      description: instrumental
        ? "Genre: synthwave. BPM: 108. Key: A minor. Instrumental, no vocals. Analog synth arps, gated drums, warm bass."
        : "Genre: synthwave pop. BPM: 108. Key: A minor. Driving and nostalgic. Vocals: clear female lead. Analog synth arps, gated drums, warm bass.",
      arrangement: instrumental ? "instrumental" : "vocals",
      lyrics: instrumental
        ? undefined
        : "[verse]\nNeon rivers running through the midnight town\nEvery borrowed heartbeat pulls me further down\n[chorus]\nHold the line, we're almost home",
      durationSec: 30,
      seed,
    });
    console.log(`enqueued ${job.id} (${label})`);

    const stages = new Set<string>();
    // the bug this harness now guards: the bar used to jump to 45 and sit
    // there for the whole render, so record every distinct value it took
    const progresses = new Set<number>();
    const started = Date.now();
    let final: { status: string; error?: string | null; output?: string | null } | undefined;
    for (;;) {
      const j = (await api.jobs.list.query()).find((x) => x.id === job.id)!;
      if (j.stage) stages.add(j.stage);
      if (typeof j.progress === "number") progresses.add(Math.round(j.progress));
      if (j.status === "completed" || j.status === "failed") {
        final = j;
        break;
      }
      if (Date.now() - started > 30 * 60_000) {
        await api.jobs.cancel.mutate({ id: job.id }).catch(() => {});
        throw new Error(`timed out after 30 min (stages: ${[...stages].join(" | ")})`);
      }
      await sleep(1000);
    }
    const tookSec = Math.round((Date.now() - started) / 1000);

    check(`[${label}] job completed`, final!.status === "completed", final!.error ?? `${tookSec}s`);
    const out = final!.output;
    check(
      `[${label}] audio on disk`,
      !!out && fs.existsSync(out) && fs.statSync(out).size > 100_000,
      out ?? "",
    );
    const asset = (await api.library.list.query()).assets.find(
      // the music shelf, not "audio" — kind comes from the assets/<kind>/ dir
      (a) => a.kind === "music" && a.createdAt >= startedAt,
    );
    check(`[${label}] track imported into the library`, !!asset, asset?.relPath);

    // the "stuck at 45%" regression: a real render walks the bar, and the
    // stage line names the phase and an ETA rather than one frozen string
    const moving = [...progresses].filter((p) => p > 5 && p < 96);
    check(
      `[${label}] progress actually moved`,
      moving.length >= 5,
      `${moving.length} distinct values in 5–96: ${moving.slice(0, 8).join(", ")}…`,
    );
    check(
      `[${label}] stage names the phase and an ETA`,
      [...stages].some((st) => /Composing/.test(st)) &&
        [...stages].some((st) => /left/.test(st)),
      [...stages].slice(0, 3).join(" | "),
    );
    return tookSec;
  }

  const first = await render(7, warm ? "cold" : "only");
  if (warm) {
    const second = await render(8, "warm");
    console.log(`\ncold ${first}s -> warm ${second}s`);
    // measured 108s -> 46s for a 15s song; anything under a 25% saving means
    // the worker is being torn down between jobs
    check(
      "warm render is materially faster than the cold one",
      second < first * 0.75,
      `${first}s cold vs ${second}s warm`,
    );
  }
} finally {
  await handle.close();
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
