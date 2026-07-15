/* The Director — Aurea's chat copilot, powered by the Claude Agent SDK (the
 * locally installed Claude Code with the user's subscription login; no API
 * key). Its tool surface is the exact registry the MCP server exposes to
 * external agents (tools.ts), mounted as an in-process SDK MCP server, so
 * "everything the app can do" and "everything the Director can do" are the
 * same list by construction.
 *
 * One chat thread per project, persisted at
 * <dataRoot>/projects/<id>/director.json; conversation continuity rides on
 * Claude Code's own session store via resume. State updates stream to the
 * renderer through the director.onUpdate subscription. */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  createSdkMcpServer,
  query,
  tool,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  directorChatFileSchema,
  jobStatusSchema,
  type DirectorChatFile,
  type DirectorMessage,
  type DirectorState,
} from "@aurea/shared";
import type { SettingsStore } from "./settings.js";
import { buildTools, createStudiodApi, type AureaTool } from "./tools.js";

const RUN_TIMEOUT_MS = 15 * 60_000;
const MAX_TURNS = 24;

const systemPrompt = (project: string) =>
  [
    "You are the Director — the creative copilot inside Aurea, a local-first AI video studio",
    "running entirely on the user's machine (their own GPU does the generating). You are talking",
    "to the studio operator in the Director chat panel.",
    "",
    "Your tools are the aurea studio surface: system status, projects, the asset library, the job",
    "queue, four generation labs (image / speech / music / video) and the videofast finished-video",
    "pipeline.",
    "",
    "Ground rules:",
    `- Pass project: "${project}" to every tool that takes a project.`,
    "- Check lab_catalog before your first generation in a lab — models, voices, aspects and",
    "  resolutions come from this machine, not from memory.",
    "- Every job you enqueue appears live in the job rail the user is already watching, and",
    "  finished artifacts import into the project library automatically.",
    "- Quick jobs (image, speech): you may wait_for_job once (timeoutSec <= 120) and then talk",
    "  about the result. Long jobs (music, video clips, create_video): enqueue, say it's running,",
    "  and do not block on it — never poll the same job twice.",
    "- Be a director: concrete suggestions, short production-minded replies. At most one",
    "  clarifying question, and only when the request is truly ambiguous.",
  ].join("\n");

/** compact one-line rendering of a tool input for the chat card */
function summarize(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const parts = Object.entries(input as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  const line = parts.join(" · ");
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

/** a tool result that is a Job means the tool enqueued something trackable */
function extractJobId(raw: string): string | undefined {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      value &&
      typeof value.id === "string" &&
      jobStatusSchema.safeParse(value.status).success &&
      typeof value.progress === "number"
    ) {
      return value.id;
    }
  } catch {
    /* not JSON — not a job */
  }
  return undefined;
}

export class DirectorService extends EventEmitter {
  private chats = new Map<string, DirectorChatFile>();
  private busy = new Set<string>();

  constructor(
    private settings: SettingsStore,
    /** studiod's own loopback coords — known only once the server is listening */
    private coords: () => { port: number; token: string },
  ) {
    super();
  }

  get(project: string): DirectorState {
    return this.state(project);
  }

  /** append the user message and kick off a Claude run (async, streams updates) */
  send(project: string, text: string): DirectorState {
    if (this.busy.has(project)) throw new Error("the Director is still working on the last message");
    const chat = this.chat(project);
    chat.messages.push({ id: randomUUID(), role: "user", at: new Date().toISOString(), text });
    this.persist(project);
    this.busy.add(project);
    this.emitState(project);
    void this.run(project, text).finally(() => {
      this.busy.delete(project);
      this.persist(project);
      this.emitState(project);
    });
    return this.state(project);
  }

  /* ---------- the run ---------- */

  private async run(project: string, prompt: string): Promise<void> {
    const chat = this.chat(project);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), RUN_TIMEOUT_MS);
    /** tool_use id → the chat message rendering that call */
    const toolMessages = new Map<string, DirectorMessage>();

    try {
      const q = query({ prompt, options: this.options(project, chat.sessionId, abort) });
      for await (const message of q) {
        this.absorb(project, chat, message, toolMessages);
      }
    } catch (err) {
      const detail = String((err as Error)?.message ?? err);
      this.push(chat, {
        text:
          "I couldn't reach the local Claude engine. Make sure Claude Code is installed and " +
          `logged in (run \`claude\` in a terminal once). — ${detail}`,
      });
      this.persist(project);
      this.emitState(project);
    } finally {
      clearTimeout(timer);
    }
  }

  private options(project: string, sessionId: string | null, abort: AbortController): Options {
    const { port, token } = this.coords();
    const registry = buildTools(createStudiodApi(port, token));
    const sdkTools = registry.map((t: AureaTool) =>
      tool(t.name, t.description, t.schema, async (args: Record<string, unknown>) => t.handler(args)),
    );
    return {
      abortController: abort,
      cwd: this.projectDir(project),
      systemPrompt: systemPrompt(project),
      maxTurns: MAX_TURNS,
      mcpServers: {
        aurea: createSdkMcpServer({ name: "aurea", version: "0.1.0", tools: sdkTools }),
      },
      // chat + the aurea surface only — no filesystem/bash builtins
      tools: [],
      allowedTools: registry.map((t) => `mcp__aurea__${t.name}`),
      ...(sessionId ? { resume: sessionId } : {}),
      // under Electron process.execPath is electron.exe — make the SDK spawn real node
      ...(process.versions.electron ? { executable: "node" as const } : {}),
    };
  }

  /** fold one SDK stream message into the chat (and stream it to the renderer) */
  private absorb(
    project: string,
    chat: DirectorChatFile,
    message: SDKMessage,
    toolMessages: Map<string, DirectorMessage>,
  ): void {
    let dirty = false;

    if (message.type === "system" && message.subtype === "init") {
      chat.sessionId = message.session_id;
      dirty = true;
    } else if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text" && block.text.trim()) {
          this.push(chat, { text: block.text.trim() });
          dirty = true;
        } else if (block.type === "tool_use") {
          const entry = this.push(chat, {
            tool: {
              name: block.name.replace(/^mcp__aurea__/, ""),
              summary: summarize(block.input),
              status: "running",
            },
          });
          toolMessages.set(block.id, entry);
          dirty = true;
        }
      }
    } else if (message.type === "user") {
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type !== "tool_result") continue;
          const entry = toolMessages.get(block.tool_use_id);
          if (!entry?.tool) continue;
          entry.tool.status = block.is_error ? "error" : "done";
          const text = Array.isArray(block.content)
            ? block.content.find((c: { type: string }) => c.type === "text")?.text
            : typeof block.content === "string"
              ? block.content
              : undefined;
          if (text && !block.is_error) entry.tool.jobId = extractJobId(text);
          dirty = true;
        }
      }
    } else if (message.type === "result") {
      chat.sessionId = message.session_id ?? chat.sessionId;
      if (message.subtype !== "success") {
        this.push(chat, { text: `The Director run stopped early (${message.subtype}).` });
      }
      dirty = true;
    }

    if (dirty) {
      this.persist(project);
      this.emitState(project);
    }
  }

  /* ---------- state + persistence ---------- */

  private push(
    chat: DirectorChatFile,
    body: Pick<DirectorMessage, "text" | "tool">,
  ): DirectorMessage {
    const entry: DirectorMessage = {
      id: randomUUID(),
      role: "director",
      at: new Date().toISOString(),
      ...body,
    };
    chat.messages.push(entry);
    return entry;
  }

  private state(project: string): DirectorState {
    return {
      project,
      status: this.busy.has(project) ? "thinking" : "idle",
      messages: this.chat(project).messages,
    };
  }

  private emitState(project: string): void {
    this.emit("update", this.state(project));
  }

  private projectDir(project: string): string {
    return path.join(this.settings.get().storage.dataRoot, "projects", project);
  }

  private chatFile(project: string): string {
    return path.join(this.projectDir(project), "director.json");
  }

  private chat(project: string): DirectorChatFile {
    let chat = this.chats.get(project);
    if (!chat) {
      try {
        chat = directorChatFileSchema.parse(
          JSON.parse(fs.readFileSync(this.chatFile(project), "utf8")),
        );
      } catch {
        chat = { sessionId: null, messages: [] };
      }
      this.chats.set(project, chat);
    }
    return chat;
  }

  private persist(project: string): void {
    const file = this.chatFile(project);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.chat(project), null, 2));
    fs.renameSync(tmp, file);
  }
}
