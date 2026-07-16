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

const HISTORY_POLL_MS = 2_000;

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
    ws.on("error", (err) => {
      wsError = err instanceof Error ? err : new Error(String(err));
    });
    ws.on("message", (raw, isBinary) => {
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
      const queued = await this.post("/prompt", { prompt: graph, client_id: clientId });
      if (!queued.ok) {
        throw new Error(await formatPromptError(queued));
      }
      promptId = ((await queued.json()) as { prompt_id: string }).prompt_id;

      // wait: WS says done (or errors), history confirms and carries outputs
      let lastPoll = 0;
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
          const entry = await this.history(promptId);
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

  private async post(pathname: string, payload: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  private async history(promptId: string): Promise<unknown | null> {
    try {
      const res = await fetch(`${this.baseUrl}/history/${promptId}`);
      if (!res.ok) return null;
      const all = (await res.json()) as Record<string, unknown>;
      return all[promptId] ?? null;
    } catch {
      return null;
    }
  }

  private async collectImages(entry: unknown): Promise<ComfyOutputImage[]> {
    const images: ComfyOutputImage[] = [];
    const outputs =
      (entry as { outputs?: Record<string, { images?: Array<Record<string, string>> }> })
        .outputs ?? {};
    for (const node of Object.values(outputs)) {
      for (const img of node.images ?? []) {
        if (img.type && img.type !== "output") continue; // skip previews/temp
        const q = new URLSearchParams({
          filename: img.filename,
          subfolder: img.subfolder ?? "",
          type: img.type ?? "output",
        });
        const res = await fetch(`${this.baseUrl}/view?${q}`);
        if (!res.ok) throw new Error(`ComfyUI /view failed for ${img.filename}`);
        images.push({ filename: img.filename, data: Buffer.from(await res.arrayBuffer()) });
      }
    }
    return images;
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
