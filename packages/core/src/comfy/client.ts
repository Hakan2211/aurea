/* ComfyClient — the TS port of videofast's comfy_client.py (extraction map:
 * "comfy_client.py ported to TS; drop port-scan — we spawn Comfy and know the
 * port; use WS progress").
 *
 * Submits an API-format graph over HTTP, follows execution over the /ws
 * socket (sampler step progress, node transitions, execution errors), then
 * pulls the output images via /view. History polling backs up the socket so
 * a dropped WS never strands a finished job. */

import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { InfrastructureError } from "../adapters/types.js";

export type ComfyGraph = Record<string, { inputs: Record<string, unknown>; class_type: string }>;

export interface ComfyRunHooks {
  /** sampler progress: value/max over the current node's steps */
  onProgress?: (value: number, max: number) => void;
  /** class_type of the node that just started (loader, sampler, decode…) */
  onNode?: (classType: string) => void;
}

export interface ComfyOutputImage {
  filename: string;
  data: Buffer;
}

/** any saved artifact — SaveImage lists under "images", SaveVideo under
 * "videos"/"video"; collectOutputs walks every key so both arrive */
export type ComfyOutputFile = ComfyOutputImage;

/** the result of one /history poll — see ComfyClient.history */
type HistoryPoll = { reachable: true; entry: unknown | null } | { reachable: false };

const HISTORY_POLL_MS = 2_000;
/** One /history poll's own patience. ComfyUI serves it off the same thread the
 * sampler runs on, so a heavy step can stall the answer for a while — this is
 * "slow", not "gone", and only ENGINE_GONE_MS of them in a row is a verdict. */
const HISTORY_TIMEOUT_MS = 10_000;
/** How long BOTH channels may stay silent before we call the render dead.
 * A crashed ComfyUI is indistinguishable from a slow one at the /history level
 * — both simply fail to say the job finished — so a render used to sit out its
 * whole timeoutMs (two hours, for H3) after the process was already gone. An
 * OOM kill or a GPU driver fault leaves no execution_error to read, so silence
 * is the only signal there is.
 *
 * Which is why the socket gets a vote (see lastWsActivity). ComfyUI serves
 * /history off the thread the sampler runs on, and the renders most likely to
 * die are exactly the ones heavy enough to stall it — judging on HTTP alone
 * would abort healthy jobs in precisely the case this exists for. A process
 * that is gone sends nothing on either channel; one that is merely busy keeps
 * pushing progress frames.
 *
 * Three minutes, not one, and deliberately lopsided: aborting a real
 * forty-minute render because the box was thrashing is far worse than taking
 * an extra two minutes to report a corpse. H3's slowest observed step is over
 * two minutes, and a step boundary is the only thing that emits a progress
 * frame, so a shorter window would put a healthy render inside the margin. */
const ENGINE_GONE_MS = 180_000;
/** how long a node-presence answer stays good (see hasNode) */
const CAPABILITY_TTL_MS = 60_000;
/** "<baseUrl>::<class_type>" → last answer; module-scoped so every client
 * instance against the same ComfyUI shares it */
const nodeCache = new Map<string, { present: boolean; until: number }>();

/** server url → the engine whose weights it was last left holding (process-
 * wide: every adapter makes its own ComfyClient for the same url) */
const warmEngine = new Map<string, string>();

export class ComfyClient {
  constructor(private baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /** is a ComfyUI answering at baseUrl? */
  async health(timeoutMs = 3_000): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/system_stats`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Queue a graph, wait for it to finish, return every output image. */
  async run(
    graph: ComfyGraph,
    opts: { signal?: AbortSignal; timeoutMs?: number } & ComfyRunHooks = {},
  ): Promise<ComfyOutputImage[]> {
    const clientId = randomUUID();
    const deadline = Date.now() + (opts.timeoutMs ?? 600_000);

    // socket first so no progress events race past us while /prompt queues
    const ws = new WebSocket(`${this.baseUrl.replace(/^http/, "ws")}/ws?clientId=${clientId}`);
    let wsError: Error | null = null;
    let executionError: string | null = null;
    let wsDone = false;
    let promptId: string | null = null;
    /** last time the socket said anything; 0 until it does */
    let lastWsActivity = 0;
    ws.on("error", (err) => {
      wsError = err instanceof Error ? err : new Error(String(err));
    });
    ws.on("message", (raw, isBinary) => {
      // any frame at all — including the binary previews we don't decode — is
      // the server saying it is alive, which is the half of the liveness test
      // a stalled HTTP thread cannot answer for
      lastWsActivity = Date.now();
      if (isBinary) return; // preview frames
      try {
        const msg = JSON.parse(String(raw)) as { type: string; data?: Record<string, unknown> };
        const forUs = !promptId || !msg.data?.prompt_id || msg.data.prompt_id === promptId;
        if (!forUs) return;
        if (msg.type === "progress" && msg.data) {
          opts.onProgress?.(Number(msg.data.value), Number(msg.data.max));
        } else if (msg.type === "executing" && msg.data) {
          if (msg.data.node === null) wsDone = true;
          else {
            const node = (graph as ComfyGraph)[String(msg.data.node)];
            if (node) opts.onNode?.(node.class_type);
          }
        } else if (msg.type === "execution_error" && msg.data) {
          executionError = String(
            msg.data.exception_message ?? msg.data.node_type ?? "execution error",
          );
        } else if (msg.type === "execution_success") {
          wsDone = true;
        }
      } catch {
        /* non-JSON frame */
      }
    });

    try {
      // a network-level failure here is the engine, not the graph — an HTTP
      // error response is the opposite (validation) and stays terminal
      let queued: Response;
      try {
        queued = await this.post("/prompt", { prompt: graph, client_id: clientId });
      } catch {
        throw new InfrastructureError(
          `ComfyUI at ${this.baseUrl} did not answer /prompt — the connection failed ` +
            "before the render was queued.",
        );
      }
      if (!queued.ok) {
        throw new Error(await formatPromptError(queued));
      }
      promptId = ((await queued.json()) as { prompt_id: string }).prompt_id;

      // wait: WS says done (or errors), history confirms and carries outputs
      let lastPoll = 0;
      /** when the server first stopped answering, 0 while it is answering */
      let unreachableSince = 0;
      for (;;) {
        if (opts.signal?.aborted) {
          await this.interrupt(promptId, clientId);
          throw new Error("Canceled");
        }
        if (Date.now() > deadline) {
          await this.interrupt(promptId, clientId);
          throw new Error("ComfyUI render timed out");
        }
        if (executionError) throw new Error(`ComfyUI: ${executionError}`);
        if (wsDone || wsError || Date.now() - lastPoll > HISTORY_POLL_MS) {
          lastPoll = Date.now();
          const poll = await this.history(promptId);
          if (!poll.reachable) {
            const wsQuietFor = Date.now() - lastWsActivity;
            if (unreachableSince === 0) unreachableSince = Date.now();
            else if (
              Date.now() - unreachableSince > ENGINE_GONE_MS &&
              wsQuietFor > ENGINE_GONE_MS
            ) {
              throw new InfrastructureError(
                "ComfyUI stopped responding mid-render — the engine process is gone. " +
                  "Its log is the only place the reason survives: an out-of-memory kill " +
                  "or a GPU driver fault takes the process down without writing an error " +
                  "into the graph.",
              );
            }
            await sleep(HISTORY_POLL_MS);
            continue;
          }
          unreachableSince = 0;
          const entry = poll.entry;
          if (entry) {
            const status = (entry as { status?: { status_str?: string; messages?: unknown[][] } })
              .status;
            if (status?.status_str === "error") {
              const msg = (status.messages ?? [])
                .filter((m) => m?.[0] === "execution_error")
                .map((m) => (m[1] as { exception_message?: string })?.exception_message)
                .filter(Boolean)
                .join("; ");
              throw new Error(`ComfyUI: ${msg || "execution error"}`);
            }
            const images = await this.collectImages(entry);
            if (images.length > 0) return images;
            if (status?.status_str === "success") {
              throw new Error("ComfyUI finished without producing images");
            }
          }
        }
        await sleep(wsDone ? 200 : 250);
      }
    } finally {
      ws.close();
    }
  }

  /* ---------- plumbing ---------- */

  /** Drop whatever this server is holding resident. An external ComfyUI keeps
   * the last model warm, which is usually what you want — but a graph whose
   * peak is close to the card's limit has to start from an empty board. Best
   * effort: a server that refuses is no reason not to try the render. */
  async freeMemory(): Promise<void> {
    warmEngine.delete(this.baseUrl);
    try {
      await this.post("/free", { unload_models: true, free_memory: true });
    } catch {
      /* it will either fit or it won't */
    }
  }

  /** Which engine's weights this server was left holding by the last render
   * that chose to keep them (see markWarm). A render arriving to its OWN
   * weights can skip the clear: on ComfyUI 0.32 the clear costs the next
   * prompt a full re-stage of the model — measured 2026-09-02 on a 2s LTX 2.5
   * preview: 4s of sampling inside a 113s prompt, the rest "Model
   * Initializing" after an unconditional /free. */
  isWarm(engine: string): boolean {
    return warmEngine.get(this.baseUrl) === engine;
  }

  /** Record that this server now holds `engine`'s weights. Any freeMemory()
   * on the same server — from any adapter — forgets it again. */
  markWarm(engine: string): void {
    warmEngine.set(this.baseUrl, engine);
  }

  private async post(pathname: string, payload: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  /** One history poll. Distinguishes "the server answered and the job isn't
   * done" from "nothing answered" — they used to collapse into the same null,
   * which is how a dead engine read as a slow one. A non-ok status still counts
   * as reachable: something served it. */
  private async history(promptId: string): Promise<HistoryPoll> {
    try {
      const res = await fetch(`${this.baseUrl}/history/${promptId}`, {
        signal: AbortSignal.timeout(HISTORY_TIMEOUT_MS),
      });
      if (!res.ok) return { reachable: true, entry: null };
      const all = (await res.json()) as Record<string, unknown>;
      return { reachable: true, entry: all[promptId] ?? null };
    } catch {
      return { reachable: false };
    }
  }

  private async collectImages(entry: unknown): Promise<ComfyOutputImage[]> {
    const files: ComfyOutputFile[] = [];
    const outputs =
      (entry as { outputs?: Record<string, Record<string, unknown>> }).outputs ?? {};
    for (const node of Object.values(outputs)) {
      for (const value of Object.values(node)) {
        if (!Array.isArray(value)) continue;
        for (const item of value as Array<Record<string, string>>) {
          if (!item || typeof item !== "object" || !item.filename) continue;
          if (item.type && item.type !== "output") continue; // skip previews/temp
          const q = new URLSearchParams({
            filename: item.filename,
            subfolder: item.subfolder ?? "",
            type: item.type ?? "output",
          });
          const res = await fetch(`${this.baseUrl}/view?${q}`);
          if (!res.ok) throw new Error(`ComfyUI /view failed for ${item.filename}`);
          files.push({ filename: item.filename, data: Buffer.from(await res.arrayBuffer()) });
        }
      }
    }
    return files;
  }

  /** Is this node class registered on the running ComfyUI? Uses the
   * per-class endpoint (/object_info/<class> answers {} for unknown classes)
   * because the full /object_info is multi-megabyte. Answers are cached per
   * URL for CAPABILITY_TTL_MS so a screen paint costs at most one request per
   * node — short enough that installing a pack and restarting Comfy shows up
   * without restarting studiod. */
  async hasNode(classType: string, timeoutMs = 5_000): Promise<boolean> {
    const key = `${this.baseUrl}::${classType}`;
    const hit = nodeCache.get(key);
    if (hit && Date.now() < hit.until) return hit.present;
    let present = false;
    try {
      const res = await fetch(`${this.baseUrl}/object_info/${encodeURIComponent(classType)}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const body = (await res.json()) as Record<string, unknown>;
        present = Object.keys(body).length > 0;
      }
    } catch {
      return false; // unreachable — don't cache, the server may still be booting
    }
    nodeCache.set(key, { present, until: Date.now() + CAPABILITY_TTL_MS });
    return present;
  }

  /** true only when every class is registered (probed concurrently) */
  async hasNodes(classTypes: string[], timeoutMs = 5_000): Promise<boolean> {
    const found = await Promise.all(classTypes.map((c) => this.hasNode(c, timeoutMs)));
    return found.every(Boolean);
  }

  /** The options a node offers for a combo input — e.g. every lora filename
   * via LoraLoaderModelOnly.lora_name. Lets a capability probe see which
   * weights an external ComfyUI has without reaching into its disk. */
  async comboOptions(classType: string, inputName: string, timeoutMs = 5_000): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/object_info/${encodeURIComponent(classType)}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return [];
      const body = (await res.json()) as Record<
        string,
        { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } }
      >;
      const input = body[classType]?.input;
      const spec = input?.required?.[inputName] ?? input?.optional?.[inputName];
      // combo inputs arrive as [["a.safetensors", "b.safetensors"], {…opts}]
      const options = Array.isArray(spec) ? spec[0] : undefined;
      return Array.isArray(options) ? options.filter((o): o is string => typeof o === "string") : [];
    } catch {
      return [];
    }
  }

  /** The output slot names a node class declares. Node packs are versioned by
   * nobody — /object_info carries no version — so the only honest way to ask
   * "is this pack new enough?" is to look for a surface only the new version
   * has. An added output is the safest such marker: it can't be confused with a
   * user setting, and reading it costs the same request hasNode() already made. */
  async outputNames(classType: string, timeoutMs = 5_000): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/object_info/${encodeURIComponent(classType)}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return [];
      const body = (await res.json()) as Record<string, { output_name?: unknown }>;
      const names = body[classType]?.output_name;
      return Array.isArray(names) ? names.filter((n): n is string => typeof n === "string") : [];
    } catch {
      return [];
    }
  }

  /** Stage a file into ComfyUI's input tree (multipart /upload/image — the
   * endpoint takes any media; LoadImage and LoadAudio both read from input).
   * Returns the staged name ("subfolder/file") for graph inputs. */
  async uploadInput(filename: string, data: Buffer, subfolder = "aurea"): Promise<string> {
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(data)]), filename);
    form.append("type", "input");
    form.append("subfolder", subfolder);
    form.append("overwrite", "true");
    const res = await fetch(`${this.baseUrl}/upload/image`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`ComfyUI /upload/image failed (HTTP ${res.status})`);
    const body = (await res.json()) as { name?: string; subfolder?: string };
    const name = body.name ?? filename;
    return body.subfolder ? `${body.subfolder}/${name}` : name;
  }

  /** best-effort: stop the running graph and drop it from the queue */
  private async interrupt(promptId: string, clientId: string): Promise<void> {
    try {
      await this.post("/interrupt", { client_id: clientId });
      await this.post("/queue", { delete: [promptId] });
    } catch {
      /* going away anyway */
    }
  }
}

/** POST /prompt failures carry per-node validation errors — surface the gist */
async function formatPromptError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as {
      error?: { message?: string };
      node_errors?: Record<string, { errors?: Array<{ message?: string; details?: string }> }>;
    };
    const parts: string[] = [];
    if (body.error?.message) parts.push(body.error.message);
    for (const [node, info] of Object.entries(body.node_errors ?? {})) {
      for (const e of info.errors ?? []) {
        parts.push(`node ${node}: ${e.message}${e.details ? ` (${e.details})` : ""}`);
      }
    }
    if (parts.length) return `ComfyUI rejected the graph — ${parts.join("; ")}`;
  } catch {
    /* not JSON */
  }
  return `ComfyUI /prompt returned HTTP ${res.status}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
