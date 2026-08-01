/* Videofast adapter — the first real engine adapter. Runs one topic through
 * the videofast batch pipeline (generate → tts → retime → render → mux →
 * thumbnail → deliver) by spawning its orchestrator as a child process and
 * mapping its stage transitions onto job progress.
 *
 * The videofast repo location comes from the settings store (detected on
 * first boot, editable in Settings) — no hardcoded paths. Each run gets a
 * scratch dir under ~/.aurea/runs/<jobId>/ holding the single-topic CSV and
 * the full child log for debugging. */

import { spawn, execFile, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Job } from "@aurea/shared";
import { AUREA_DIR } from "../portfile.js";
import type { SettingsStore } from "../settings.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

/** rough share of wall-clock per pipeline stage (render dominates) */
const STAGE_WEIGHT: Record<string, number> = {
  generate: 6,
  codegen: 6,
  assets: 8,
  tts: 16,
  retime: 3,
  render: 45,
  mux: 4,
  thumbnail: 9,
  deliver: 3,
};

const STAGE_LABEL: Record<string, string> = {
  generate: "Writing config",
  codegen: "Generating components",
  assets: "Building assets",
  tts: "Synthesizing voice",
  retime: "Retiming",
  render: "Rendering",
  mux: "Muxing audio",
  thumbnail: "Thumbnail",
  deliver: "Delivering",
};

const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`;

export class VideofastAdapter implements EngineAdapter {
  id = "videofast";

  constructor(private settings: SettingsStore) {}

  canRun(job: Job): boolean {
    return job.payload?.type === "videofast";
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    let child: ChildProcess | undefined;
    let canceled = false;

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type !== "videofast") throw new Error("not a videofast job");

      const vf = this.settings.get().paths.videofastDir;
      if (!vf) {
        throw new Error("videofast path not set — point Settings → Storage at your videofast checkout");
      }
      let accountFile = path.join(vf, "accounts", `${payload.account}.json`);
      if (!fs.existsSync(accountFile)) {
        throw new Error(`unknown videofast account "${payload.account}" (${accountFile})`);
      }

      const runDir = path.join(AUREA_DIR, "runs", job.id);
      fs.mkdirSync(runDir, { recursive: true });

      // Format/pack overrides ride on a per-run clone of the account — the
      // orchestrator only reads these knobs from the account file, and
      // loadAccount() accepts any absolute path. A blend brief forces the
      // strategist meta-format so the dominant paradigm picks the recipe.
      const base = JSON.parse(fs.readFileSync(accountFile, "utf8"));
      const format = payload.format ?? (payload.brief ? "strategist" : undefined);
      if (format || payload.stylePack || payload.durationSec) {
        if (format) base.format = format;
        if (payload.stylePack) base.stylePacks = [payload.stylePack];
        if (payload.durationSec) base.targetDurationSec = payload.durationSec;
        accountFile = path.join(runDir, "account.json");
        fs.writeFileSync(accountFile, JSON.stringify(base, null, 2));
      }

      // Hand-authored blend → a complete StyleBrief file. styleBriefSchema is
      // strict (arc enum, hook ≥ 10 chars, metaphor ≥ 8) and readBrief drops
      // invalid briefs SILENTLY, so every field is defaulted/guarded here and
      // the mix shares are renormalized to sum to 1.
      let briefFile: string | undefined;
      if (payload.brief) {
        const mix = payload.brief.paradigmMix;
        const sum = Object.values(mix).reduce((a, b) => a + b, 0);
        const hook = payload.brief.hookStrategy?.trim();
        const metaphor = payload.brief.visualMetaphor?.trim();
        const brief = {
          stylePack: payload.stylePack ?? base.stylePacks?.[0] ?? "noirLuxury",
          paradigmMix:
            sum > 0
              ? Object.fromEntries(Object.entries(mix).map(([k, v]) => [k, v / sum]))
              : mix,
          narrativeArc: payload.brief.narrativeArc ?? "problem-shift-payoff",
          hookStrategy:
            hook && hook.length >= 10
              ? hook
              : "Open on the most confronting, concrete line of the idea — no warm-up.",
          visualMetaphor:
            metaphor && metaphor.length >= 8
              ? metaphor
              : `one concrete, ownable image for "${payload.topic}" — never the topic restated`,
          avoid: payload.brief.avoid ?? [],
          varietyNotes: "hand-authored blend (Aurea)",
        };
        briefFile = path.join(runDir, "brief.json");
        fs.writeFileSync(briefFile, JSON.stringify(brief, null, 2));
      }
      const topicsFile = path.join(runDir, "topics.csv");
      const row = [
        csvCell(payload.topic),
        payload.seed !== undefined ? String(payload.seed) : "",
        payload.titleHint ? csvCell(payload.titleHint) : "",
      ].join(",");
      fs.writeFileSync(topicsFile, `topic\n${row}\n`);
      const log = fs.createWriteStream(path.join(runDir, "run.log"));

      const output = await new Promise<string | undefined>((resolve, reject) => {
        // npx resolves the webapp's local tsx; .cmd shims need a shell on Windows
        const cmd =
          `npx tsx scripts/batch/run-batch.ts --topics ${JSON.stringify(topicsFile)} ` +
          `--account ${JSON.stringify(accountFile)}` +
          (briefFile ? ` --brief ${JSON.stringify(briefFile)}` : "") +
          ` --limit 1`;
        child = spawn(cmd, {
          cwd: path.join(vf, "webapp"),
          shell: true,
          windowsHide: true,
          env: { ...process.env, FORCE_COLOR: "0" },
        });

        let buffer = "";
        let doneWeight = 0;
        let lastError: string | undefined;
        let delivered: string | undefined;

        const onLine = (line: string) => {
          // runJobStage logs: "[<jobId>] <stage>: attempt|done|skipping|FAILED"
          const stage = line.match(/^\[[^\]]+\] (\w+): (attempt \d+|done|artifact already valid, skipping|FAILED — (.*))/);
          if (stage) {
            const [, name, event, failure] = stage;
            if (event.startsWith("attempt")) {
              report({ progress: doneWeight, stage: STAGE_LABEL[name] ?? name });
            } else if (event.startsWith("FAILED")) {
              lastError = `${name}: ${failure}`;
            } else {
              doneWeight += STAGE_WEIGHT[name] ?? 0;
              report({ progress: Math.min(99, doneWeight) });
            }
            return;
          }
          const ok = line.match(/^\s*OK\s+\S+ -> (.+)$/);
          if (ok) delivered = ok[1].trim();
          const fatal = line.match(/^\[batch\] FATAL: (.*)/);
          if (fatal) lastError = fatal[1];
        };

        const onData = (chunk: Buffer) => {
          log.write(chunk);
          buffer += chunk.toString();
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          lines.forEach(onLine);
        };
        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);

        child.on("error", reject);
        child.on("close", (code) => {
          log.end();
          if (canceled) reject(new Error("Canceled by user"));
          else if (code === 0 && delivered) resolve(delivered);
          else reject(new Error(lastError ?? `videofast pipeline exited with code ${code}`));
        });
      });

      return { output };
    })();

    return {
      done,
      cancel: () => {
        canceled = true;
        if (!child?.pid) return;
        if (process.platform === "win32") {
          // shell:true means child is a cmd wrapper — kill the whole tree
          execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
        } else {
          child.kill("SIGTERM");
        }
      },
    };
  }
}
