/* F5 — the look contact sheet (VIDEO-LAB-FREEFORM-PLAN.md §2.6).
 *
 * Every shipped look renders ONE clip from ONE neutral subject, composed the
 * way the panel composes it (composeFreeform, t2v, the look's own engine,
 * canvas, tier, enhancer state, negative and installed adapters). When the
 * batch settles the script pulls a mid-clip frame out of each take, files it
 * into the project as a library still, and writes it back onto the look as
 * its `sample` — so the Looks rail shows a picture of what the look does,
 * not a word. It also lays every frame out on one labelled sheet and writes
 * an HTML page with the clips, which is what gets reviewed.
 *
 * Run (against a studiod on the dev port):
 *   npx tsx scripts/look-contact-sheet.mts [lookId…] [--reuse] [--no-sample]
 *     --reuse       keep a take already recorded in scripts/out/look-contact-sheet.json
 *                   (re-extracts frames and rebuilds the sheet without re-rendering)
 *     --no-sample   build the sheet but leave the looks' `sample` fields alone
 * Env: STUDIOD_PORT / STUDIOD_TOKEN (default 4199 / uiverify), LOOK_PROJECT
 * (default playground — the takes and samples are filed there). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const { createStudiodApi } = await import("../packages/core/src/tools.js");
const { SHIPPED_LOOKS } = await import("../packages/core/src/promptlib.js");
const { composeFreeform, resolveLoraByFile } = await import("../packages/shared/src/freeform.js");

const port = Number(process.env.STUDIOD_PORT ?? 4199);
const token = process.env.STUDIOD_TOKEN ?? "uiverify";
const project = process.env.LOOK_PROJECT ?? "playground";
const api = createStudiodApi(port, token);

const OUT = path.join("scripts", "out", "look-contact-sheet");
const SUMMARY = path.join("scripts", "out", "look-contact-sheet.json");
fs.mkdirSync(OUT, { recursive: true });

/** one subject for every look, so the sheet reads ACROSS: a creature, a
 * set, a small action, no text anywhere. The same fox the style-LoRA A/B
 * used, so the two measurements line up. */
const SUBJECT =
  "a red fox trots across a cobbled market square at dusk, stops at a fruit stall and looks up at the lanterns";

const argv = process.argv.slice(2);
const reuse = argv.includes("--reuse");
const noSample = argv.includes("--no-sample");
const wanted = argv.filter((a) => !a.startsWith("--"));
const looks = SHIPPED_LOOKS.filter((l) => !wanted.length || wanted.includes(l.id));
if (!looks.length) throw new Error("no looks matched");

interface Entry {
  look: string;
  label: string;
  engine: string;
  prompt: string;
  negative?: string;
  loras?: { name: string; strength: number }[];
  droppedLoras?: string[];
  job?: string;
  status: "queued" | "running" | "completed" | "failed" | "reused";
  elapsed?: string;
  output?: string;
  error?: string;
  frame?: string;
  tile?: string;
  sample?: string;
  rules?: string[];
}

const previous: Entry[] = reuse && fs.existsSync(SUMMARY) ? (JSON.parse(fs.readFileSync(SUMMARY, "utf8")) as Entry[]) : [];
const caps = await api.labs.video.capabilities.query();
const available: string[] = caps.availableLoras ?? [];

/* ---- 1 · file one render per look ---- */
const entries: Entry[] = [];
for (const look of looks) {
  const p = look.payload;
  const engine = p.engine ?? "ltx25";
  const isLtx = engine.startsWith("ltx");
  const composed = composeFreeform({ subject: SUBJECT, mode: "t2v", look, engine, durationSec: p.durationSec });
  const droppedLoras: string[] = [];
  const loras = isLtx
    ? (p.loras ?? []).flatMap((l) => {
        const name = resolveLoraByFile(available, l.name);
        if (!name) droppedLoras.push(l.name);
        return name ? [{ ...l, name }] : [];
      })
    : undefined;

  const old = previous.find((e) => e.look === look.id);
  if (old && old.status !== "failed" && old.output && fs.existsSync(old.output)) {
    entries.push({ ...old, status: "reused", prompt: composed.prompt });
    console.log(`${look.id}: reusing ${path.basename(old.output)}`);
    continue;
  }

  const job = await api.labs.video.generate.mutate({
    project,
    prompt: composed.prompt,
    engine,
    resolution: p.resolution ?? "1280 × 704 (16:9)",
    durationSec: composed.durationSec,
    fps: p.fps,
    fast: p.fast ?? true,
    enhance: composed.enhance,
    minimaxTier: p.minimaxTier,
    ...(isLtx ? { negativePrompt: composed.negative, loras } : {}),
  });
  console.log(`${look.id}: job ${job.id} on ${engine} (${p.resolution}, ${composed.durationSec}s${loras?.length ? `, +${loras.map((l) => path.basename(l.name)).join("+")}` : ""})`);
  console.log(`  prompt: ${composed.prompt.slice(0, 160)}…`);
  entries.push({
    look: look.id,
    label: look.label,
    engine,
    prompt: composed.prompt,
    negative: isLtx ? composed.negative : undefined,
    loras,
    droppedLoras: droppedLoras.length ? droppedLoras : undefined,
    job: job.id,
    status: "queued",
    rules: composed.rules,
  });
}
save();

/* ---- 2 · wait for the batch ---- */
while (entries.some((e) => e.status === "queued" || e.status === "running")) {
  await new Promise((r) => setTimeout(r, 15_000));
  const jobs = await api.jobs.list.query();
  for (const e of entries) {
    if (!e.job || e.status === "completed" || e.status === "failed" || e.status === "reused") continue;
    const job = jobs.find((j) => j.id === e.job);
    if (!job) continue;
    e.status = job.status;
    e.elapsed = job.elapsed;
    if (job.status === "completed") e.output = job.output;
    if (job.status === "failed") e.error = job.error;
  }
  const line = entries.map((e) => `${e.look.replace(/^look-/, "")}:${e.status[0]}`).join(" ");
  console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);
  save();
}

/* ---- 3 · a frame per take, a tile per frame, one sheet ---- */
const dataRoot = path.join(os.homedir(), "Aurea");
const ready = entries.filter((e) => e.output);
ready.forEach((e, i) => {
  const src = path.isAbsolute(e.output!) ? e.output! : path.join(dataRoot, e.output!);
  if (!fs.existsSync(src)) {
    e.error = `output missing on disk: ${src}`;
    return;
  }
  const look = looks.find((l) => l.id === e.look)!;
  const mid = (look.payload.durationSec ?? 5) / 2;
  const frame = path.join(OUT, `${e.look}.png`);
  const tile = path.join(OUT, `tile-${String(i).padStart(2, "0")}.png`);
  // the sample: a mid-clip frame at 480 wide (the rail shows it at 24 px,
  // a bigger preview can use the same file)
  ffmpeg(["-y", "-ss", String(mid), "-i", src, "-frames:v", "1", "-vf", "scale=480:-2", frame]);
  // the sheet tile: letterboxed to one size, labelled — the label is the
  // look's name with drawtext's special characters dropped. The font path is
  // drive-less on purpose: a `C:` inside a filter string is an option
  // separator however it is escaped, and ffmpeg resolves the bare path on
  // the drive it runs from.
  const text = look.label.replace(/[^A-Za-z0-9 \-]/g, "").trim();
  const vf =
    "scale=384:216:force_original_aspect_ratio=decrease,pad=384:216:(ow-iw)/2:(oh-ih)/2:color=black," +
    `drawtext=fontfile=/Windows/Fonts/arial.ttf:text=${text}:x=8:y=h-26:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4`;
  const labelled = ffmpeg(["-y", "-i", frame, "-vf", vf, tile], false);
  if (!labelled) ffmpeg(["-y", "-i", frame, "-vf", vf.split(",drawtext")[0], tile]);
  e.frame = frame;
  e.tile = tile;
});
const tiles = ready.filter((e) => e.tile);
if (tiles.length) {
  const cols = Math.min(4, tiles.length);
  const rows = Math.ceil(tiles.length / cols);
  ffmpeg([
    "-y",
    "-framerate", "1",
    "-i", path.join(OUT, "tile-%02d.png"),
    "-vf", `tile=${cols}x${rows}:padding=6:margin=6:color=0x111111`,
    "-frames:v", "1",
    path.join("scripts", "out", "look-contact-sheet.png"),
  ]);
}

/* ---- 4 · the frames become the looks' samples ---- */
if (!noSample) {
  const onDisk = await api.prompts.videoPresets.query({});
  for (const e of ready) {
    if (!e.frame) continue;
    const { relPath } = await api.labs.video.importStill.mutate({
      project,
      name: `look-sample-${e.look.replace(/^look-/, "")}`,
      pngBase64: fs.readFileSync(e.frame).toString("base64"),
    });
    const current = onDisk.find((p) => p.id === e.look);
    if (!current) {
      console.warn(`${e.look}: not on disk (deleted here?) — sample not set`);
      continue;
    }
    const { builtin: _b, ...rest } = current;
    await api.prompts.videoPresetSave.mutate({ ...rest, sample: relPath });
    e.sample = relPath;
    console.log(`${e.look}: sample → ${relPath}`);
  }
}
save();

/* ---- 5 · the review page ---- */
const page = `<!doctype html><meta charset="utf-8"><title>Look contact sheet</title>
<style>body{background:#111;color:#eee;font:14px system-ui;margin:24px}h1{font-weight:500}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:18px}
figure{margin:0;background:#1a1a1a;border-radius:8px;padding:10px}video,img{width:100%;border-radius:4px;background:#000}
figcaption b{display:block;font-size:15px}small{color:#9a9a9a;display:block;margin:4px 0}p{font-size:12px;color:#bbb;margin:6px 0 0;line-height:1.4}
.bad{color:#f88}</style>
<h1>Look contact sheet — ${new Date().toISOString().slice(0, 10)} · "${SUBJECT}"</h1>
<div class="grid">${entries
  .map((e) => {
    const src = e.output && (path.isAbsolute(e.output) ? e.output : path.join(dataRoot, e.output));
    const media = src
      ? `<video src="file:///${src.replace(/\\/g, "/")}" controls loop muted playsinline></video>`
      : `<div class="bad">${e.error ?? e.status}</div>`;
    return `<figure>${media}<figcaption><b>${e.label}</b><small>${e.engine} · ${e.elapsed ?? e.status}${
      e.loras?.length ? ` · +${e.loras.map((l) => path.basename(l.name)).join(", ")}` : ""
    }${e.droppedLoras?.length ? ` · <span class="bad">missing ${e.droppedLoras.join(", ")}</span>` : ""}${
      e.rules?.length ? ` · ${e.rules.join(", ")}` : ""
    }</small><p>${e.prompt.replace(/</g, "&lt;")}</p></figcaption></figure>`;
  })
  .join("\n")}</div>`;
fs.writeFileSync(path.join("scripts", "out", "look-contact-sheet.html"), page);

console.log(JSON.stringify(entries.map(({ prompt: _p, ...e }) => e), null, 2));
console.log(`sheet: scripts/out/look-contact-sheet.png · page: scripts/out/look-contact-sheet.html`);
process.exit(0);

function save(): void {
  fs.writeFileSync(SUMMARY, JSON.stringify(entries, null, 2));
}

function ffmpeg(args: string[], mustSucceed = true): boolean {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (r.status !== 0) {
    if (mustSucceed) throw new Error(`ffmpeg ${args.join(" ")}\n${r.stderr}`);
    return false;
  }
  return true;
}
