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
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  directorChatFileSchema,
  jobStatusSchema,
  type DirectorAttachment,
  type DirectorChatFile,
  type DirectorMessage,
  type DirectorState,
} from "@aurea/shared";
import type { SettingsStore } from "./settings.js";
import { buildTools, createStudiodApi, type AureaTool } from "./tools.js";

const RUN_TIMEOUT_MS = 15 * 60_000;
/** a writers-room full-script draft is one tool call per scene and shot —
 * an episode skeleton alone can spend 20+ turns */
const MAX_TURNS = 60;
/** minimum gap between full-thread snapshots while text is streaming */
const STREAM_EMIT_MS = 80;

const systemPrompt = (project: string) =>
  [
    "You are the Director — the creative copilot inside Aurea, a local-first AI video studio",
    "running entirely on the user's machine (their own GPU does the generating). You are talking",
    "to the studio operator in the Director chat panel.",
    "",
    "Your tools are the aurea studio surface: system status, projects, the asset library, the job",
    "queue, four generation labs (image / speech / music / video), the videofast finished-video",
    "pipeline, the timeline (timeline_get / add_clip / update_clip / remove_clip / export), and",
    "the Studio production spine (production_* / shot_update / scene_update / bible_*).",
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
    "- Multi-shot videos are assembled on the timeline: generate takes, timeline_add_clip each one",
    "  in order (a 0.3–0.5s transitionSec makes cuts feel intentional), place voice/music on their",
    "  tracks, then timeline_export renders the finished mp4. The user sees the same sequence on",
    "  the Timeline screen and can re-cut by hand — never rebuild a timeline they may have edited",
    "  without checking timeline_get first.",
    "- Productions are structured Season → Episode → Scene → Shot (production_get shows the tree",
    "  and every node id). The bible (bible_get) is the persistent cast & world memory — consult",
    "  it BEFORE writing dialogue or describing a character, keep speech in each character's",
    "  documented voice, and record new recurring characters/locations with bible_upsert_* so",
    "  episode 12 still matches episode 1. Build episode skeletons with production_add_episode /",
    "  add_scene / add_shot, fill and advance shots with shot_update (status ladder:",
    "  draft→boarded→generated→synced→approved — never skip a human approval the user expects).",
    "- Storyboard: board shots with generate_keyframe — it composes the prompt from the shot's",
    "  script lines + camera spec + location + style bible and keeps the cast on-model via the",
    "  character reference images (finished stills attach to the shot and advance draft→boarded).",
    "  Give the shot its characters, location, and camera spec via shot_update FIRST — that is",
    "  what the prompt is built from. Pass prompt only to override the composition; use",
    "  count 2–4 for options, then mark the winner with shot_update selectedKeyframe.",
    "- Shot Director: a shot that needs more than one prompt and one frame is still ONE take, not",
    "  several. generate_shot renders a timeline — keyframes pinned at times (an end frame the take",
    "  morphs into), prompt beats that change the action or camera mid-take, cloned-voice takes",
    "  locked to timecodes so each character lip-syncs their own line, cast references, motion",
    "  transfer. shot_from_storyboard composes that whole spec from a BOARDED shot for you: beats",
    "  from its script lines, cast from the bible, the audio lane from voice takes you pass in",
    "  (generate_speech them first, one per line, then name the character each one belongs to).",
    "  Read the composed beats with dryRun before spending a render; the finished mp4 attaches to",
    "  the shot and advances it to generated. shot_retake re-renders a bad two seconds of a",
    "  finished take in place instead of re-rolling the whole thing. Check",
    "  lab_catalog(\"video\").director first — its capabilities say whether this machine can run",
    "  Director shots at all, and its rules are measured facts about LTX, not preferences.",
    "- Cinematography: when bible_get shows a cinematography bank, write camera specs in its",
    "  vocabulary — ids like shotSize \"ws\", angle \"low\", move \"push-in\", lighting",
    "  \"sitcom.warm-home\", notes \"symmetry\" — prompts expand them to the full clauses.",
    "  Follow the bank's rules field (one camera move + one lighting logic per shot, dance never",
    "  tighter than ws, arguments in colder light than resolutions) and reuse each dancer's",
    "  signature camera from danceSignatures. No bank installed? import_cinematography adds the",
    "  doc-26 banks.",
    "- Writers room: when drafting an episode, work outline-first — episode_update the synopsis,",
    "  production_add_scene the sluglines with 1–2 sentence summaries, then break scenes into",
    "  shots and write scriptLines via shot_update (character = bible id, null = action line,",
    "  deliveryNotes when the read matters). Sitcom pacing: short lines, interruptions, every",
    "  scene ends on a joke or a turn. The user watches the script fill in live on the Writers",
    "  Room screen, so save as you go — don't hold the whole script for one giant final edit.",
    "- Finished social videos: create_video runs the videofast pipeline end to end (script →",
    "  voiceover → music → render → thumbnails) and delivers a vertical short with covers. Pick",
    "  the format for the idea — motivational (kinetic type), quote (deterministic quote card,",
    "  titleHint = attribution), imageMotion (AI stills + 2.5D parallax dollies), metaphor",
    "  (choreographed 2D metaphors), dataStory (charts matched to claims), mathExplainer (Manim",
    "  math), generative (p5 physics moods), cinematic (3D heroes + parallax worlds), whiteboard",
    "  (hand-drawn strokes), strategist (the meta-format that plans its own paradigm mix) — plus",
    "  an optional stylePack to pin the look. Omit account and the channel built for that format",
    "  is picked for you. When a message opens with a format brief from the Formats screen, help",
    "  sharpen the topic into one strong spoken idea (hook, turn, payoff) and confirm the angle in",
    "  a reply or two before launching create_video — the render costs real GPU minutes.",
    "- Blending formats: create_video's paradigmMix mixes formats inside one video — one dominant",
    "  paradigm (share ≥ 0.5, it owns the recipe and the emotional peaks) plus any number of",
    "  contrasts. One contrast is the tuned sweet spot (e.g. 60% charts + 40% 2D metaphors); two",
    "  is experimental; past two, each visual language gets only a scene or two and the video",
    "  reads as a montage — say so plainly, then let the user decide. For MORE variety, steer to",
    "  a series: several videos, each with a different mix (that is what the strategist format",
    "  automates). narrativeArc, visualMetaphor, hookStrategy and avoid make the blend's creative",
    "  brief law for the writer; propose a concrete visualMetaphor yourself rather than leaving",
    "  it generic. A mix goes wrong by repeating itself before it goes wrong by looking busy —",
    "  when you propose one, say what each paradigm is FOR (the equation derives the number, the",
    "  chart shows its shape, the metaphor says why it matters), so they don't all prove the same",
    "  claim in different languages.",
    "- Duration: create_video's durationSec targets the runtime (word budget + scene count scale",
    "  to it; the finished video lands within ~±15% because scenes retime to the spoken VO).",
    "  When the user names a length ('about a minute', 'five minutes'), pass it (15-300s); a longer target with",
    "  many paradigms also relieves the busier-mix concern. Omitted, the channel preset's",
    "  targetDurationSec applies, else the writer's natural 25-45s.",
    "- Messages may end with an [Attached assets] block — library files the user pinned to that",
    "  message. Each relPath plugs directly into tool inputs (generate_video startFrame / audio,",
    "  etc.); attached images are also shown to you, so react to what you actually see.",
  ].join("\n");

/* ---------- attachments → SDK prompt ---------- */

const IMAGE_MEDIA: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
/** per-image cap — the API rejects oversized images and one huge base64 blob
 * would blow the whole turn; bigger attachments ride along as text references */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

type PromptBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

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

/** one in-flight Claude run — the handle director.stop aborts */
interface ActiveRun {
  abort: AbortController;
  /** set by stop() so the abort reads as "user pressed stop", not an engine failure */
  stopped: boolean;
}

export class DirectorService extends EventEmitter {
  private chats = new Map<string, DirectorChatFile>();
  private runs = new Map<string, ActiveRun>();
  private lastEmit = new Map<string, number>();
  private emitTimers = new Map<string, NodeJS.Timeout>();

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
  send(project: string, text: string, attachments: DirectorAttachment[] = []): DirectorState {
    if (this.runs.has(project)) throw new Error("the Director is still working on the last message");
    const chat = this.chat(project);
    chat.messages.push({
      id: randomUUID(),
      role: "user",
      at: new Date().toISOString(),
      text,
      ...(attachments.length ? { attachments } : {}),
    });
    this.persist(project);
    const run: ActiveRun = { abort: new AbortController(), stopped: false };
    this.runs.set(project, run);
    this.emitState(project);
    void this.run(project, this.buildPrompt(text, attachments), run).finally(() => {
      this.runs.delete(project);
      this.persist(project);
      this.emitState(project);
    });
    return this.state(project);
  }

  /** abort the in-flight run, if any — the thread gets a "Stopped." note, not an error */
  stop(project: string): DirectorState {
    const run = this.runs.get(project);
    if (run && !run.stopped) {
      run.stopped = true;
      run.abort.abort();
    }
    return this.state(project);
  }

  /* ---------- the run ---------- */

  /** the user's text, plus an [Attached assets] block when the message carries
   * pinned library files; attached images become real image content blocks
   * (streaming-input mode) so the Director sees them, not just their paths */
  private buildPrompt(
    text: string,
    attachments: DirectorAttachment[],
  ): string | AsyncIterable<SDKUserMessage> {
    if (!attachments.length) return text;
    const dataRoot = path.resolve(this.settings.get().storage.dataRoot);
    const lines = attachments.map((a) => `- ${a.kind} "${a.name}" — relPath: ${a.relPath}`);
    const blocks: PromptBlock[] = [
      { type: "text", text: `${text}\n\n[Attached assets]\n${lines.join("\n")}` },
    ];
    for (const a of attachments) {
      const media = IMAGE_MEDIA[a.relPath.split(".").pop()?.toLowerCase() ?? ""];
      if (!media) continue;
      const abs = path.resolve(dataRoot, a.relPath);
      if (!abs.startsWith(dataRoot)) continue; // attachment paths never escape the data root
      try {
        const buf = fs.readFileSync(abs);
        if (buf.byteLength <= MAX_IMAGE_BYTES) {
          blocks.push({
            type: "image",
            source: { type: "base64", media_type: media, data: buf.toString("base64") },
          });
        }
      } catch {
        /* file gone — the text reference still stands */
      }
    }
    async function* stream(): AsyncGenerator<SDKUserMessage> {
      yield {
        type: "user",
        message: { role: "user", content: blocks } as SDKUserMessage["message"],
        parent_tool_use_id: null,
      };
    }
    return stream();
  }

  private async run(
    project: string,
    prompt: string | AsyncIterable<SDKUserMessage>,
    run: ActiveRun,
  ): Promise<void> {
    const chat = this.chat(project);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      run.abort.abort();
    }, RUN_TIMEOUT_MS);
    /** tool_use id → the chat message rendering that call */
    const toolMessages = new Map<string, DirectorMessage>();
    /** content-block index → text message growing from stream deltas, until the
     * final assistant message confirms (or supersedes) it */
    const streams = new Map<number, DirectorMessage>();

    try {
      const q = query({ prompt, options: this.options(project, chat.sessionId, run.abort) });
      for await (const message of q) {
        this.absorb(project, chat, message, toolMessages, streams);
      }
    } catch (err) {
      if (run.stopped) {
        this.push(chat, { text: "*Stopped.*" });
      } else if (timedOut) {
        this.push(chat, { text: "The Director run timed out after 15 minutes." });
      } else {
        const detail = String((err as Error)?.message ?? err);
        this.push(chat, {
          text:
            "I couldn't reach the local Claude engine. Make sure Claude Code is installed and " +
            `logged in (run \`claude\` in a terminal once). — ${detail}`,
        });
      }
      this.persist(project);
      this.emitState(project);
    } finally {
      clearTimeout(timer);
      // an aborted run leaves loose ends — settle them so nothing spins forever
      for (const entry of streams.values()) {
        if (entry.text?.trim()) delete entry.streaming;
        else chat.messages.splice(chat.messages.indexOf(entry), 1);
      }
      for (const entry of toolMessages.values()) {
        if (entry.tool?.status === "running") entry.tool.status = "error";
      }
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
      // stream text deltas so replies render token by token
      includePartialMessages: true,
      // alias ("sonnet" | "opus" | "haiku") — the local Claude Code resolves it
      model: this.settings.get().providers.claudeModel,
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
    streams: Map<number, DirectorMessage>,
  ): void {
    let dirty = false;

    if (message.type === "stream_event") {
      if (message.parent_tool_use_id) return; // subagent chatter — not this thread
      const ev = message.event;
      if (ev.type === "content_block_start" && ev.content_block.type === "text") {
        const entry = this.push(chat, { text: "" });
        entry.streaming = true;
        streams.set(ev.index, entry);
      } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        const entry = streams.get(ev.index);
        if (entry) {
          entry.text = (entry.text ?? "") + ev.delta.text;
          this.emitStreaming(project);
        }
      }
      return; // deltas never persist — the final assistant message does
    }

    if (message.type === "system" && message.subtype === "init") {
      chat.sessionId = message.session_id;
      dirty = true;
    } else if (message.type === "assistant") {
      let index = -1;
      for (const block of message.message.content) {
        index += 1;
        if (block.type === "text") {
          const streamed = streams.get(index);
          const text = block.text.trim();
          if (streamed) {
            // finalize the message that grew from deltas instead of duplicating it
            streams.delete(index);
            if (text) {
              streamed.text = text;
              delete streamed.streaming;
            } else {
              chat.messages.splice(chat.messages.indexOf(streamed), 1);
            }
            dirty = true;
          } else if (text) {
            this.push(chat, { text });
            dirty = true;
          }
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
      status: this.runs.has(project) ? "thinking" : "idle",
      messages: this.chat(project).messages,
    };
  }

  private emitState(project: string): void {
    this.lastEmit.set(project, Date.now());
    this.emit("update", this.state(project));
  }

  /** deltas arrive token by token; coalesce full-thread snapshots to ~12/s */
  private emitStreaming(project: string): void {
    if (this.emitTimers.has(project)) return;
    const since = Date.now() - (this.lastEmit.get(project) ?? 0);
    if (since >= STREAM_EMIT_MS) {
      this.emitState(project);
      return;
    }
    this.emitTimers.set(
      project,
      setTimeout(() => {
        this.emitTimers.delete(project);
        this.emitState(project);
      }, STREAM_EMIT_MS - since),
    );
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
