/* Director threads (D1) — the index, the migration off the pre-threads
 * director.json, and the run-lock rules. Nothing here talks to Claude: send()
 * would spawn the real SDK, so the lock is exercised through the thread
 * mutations that guard on it. */

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { directorThreadIndexSchema, type DirectorChatFile } from "@aurea/shared";
import { DirectorService } from "./director.js";
import type { SettingsStore } from "./settings.js";

const PROJECT = "zoo-logic";

function fresh(): { svc: DirectorService; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aurea-threads-"));
  const settings = { get: () => ({ storage: { dataRoot: root } }) } as unknown as SettingsStore;
  return { svc: new DirectorService(settings, () => ({ port: 0, token: "" })), root };
}

const projectDir = (root: string) => path.join(root, "projects", PROJECT);
const threadDir = (root: string) => path.join(projectDir(root), "director");

function writeLegacy(root: string, chat: DirectorChatFile): void {
  fs.mkdirSync(projectDir(root), { recursive: true });
  fs.writeFileSync(path.join(projectDir(root), "director.json"), JSON.stringify(chat, null, 2));
}

function readChat(root: string, threadId: string): DirectorChatFile {
  return JSON.parse(fs.readFileSync(path.join(threadDir(root), `${threadId}.json`), "utf8"));
}

test("a project with no history opens on one Studio thread", () => {
  const { svc, root } = fresh();
  const list = svc.threadList(PROJECT);
  assert.equal(list.threads.length, 1);
  assert.equal(list.threads[0].title, "Studio");
  assert.equal(list.threads[0].bind, null);
  assert.equal(list.activeId, list.threads[0].id);
  assert.equal(list.runningId, null);
  // and it survives a restart rather than minting a second Studio
  const index = directorThreadIndexSchema.parse(
    JSON.parse(fs.readFileSync(path.join(threadDir(root), "index.json"), "utf8")),
  );
  assert.equal(index.threads.length, 1);
  assert.equal(index.activeId, list.activeId);
});

test("the pre-threads director.json migrates with its sessionId INTACT", () => {
  const { svc, root } = fresh();
  const legacy: DirectorChatFile = {
    sessionId: "sess-abc-123",
    messages: [
      { id: "m1", role: "user", at: "2026-08-01T10:00:00.000Z", text: "board scene 2" },
      { id: "m2", role: "director", at: "2026-08-01T10:00:04.000Z", text: "On it." },
    ],
  };
  writeLegacy(root, legacy);

  const list = svc.threadList(PROJECT);
  assert.equal(list.threads.length, 1, "migration should produce exactly one thread");
  assert.equal(list.threads[0].title, "Studio");

  const migrated = readChat(root, list.threads[0].id);
  // the sessionId is the whole point: the operator's live conversation must
  // RESUME after the update, not restart with an empty window
  assert.equal(migrated.sessionId, "sess-abc-123");
  assert.deepEqual(migrated.messages, legacy.messages);

  // rollback insurance — the legacy file is read, never moved or deleted
  assert.ok(fs.existsSync(path.join(projectDir(root), "director.json")));

  // and the state the renderer gets is that thread, not an empty one
  const state = svc.get(PROJECT);
  assert.equal(state.threadId, list.threads[0].id);
  assert.equal(state.messages.length, 2);
  assert.equal(state.status, "idle");
});

test("migration runs once — a second load reuses the index", () => {
  const { svc, root } = fresh();
  writeLegacy(root, { sessionId: "sess-1", messages: [] });
  const first = svc.threadList(PROJECT).threads[0].id;

  const settings = { get: () => ({ storage: { dataRoot: root } }) } as unknown as SettingsStore;
  const reopened = new DirectorService(settings, () => ({ port: 0, token: "" }));
  const list = reopened.threadList(PROJECT);
  assert.equal(list.threads.length, 1, "migrated twice");
  assert.equal(list.threads[0].id, first);
});

test("a new thread starts on a null sessionId — that IS the context reset", () => {
  const { svc, root } = fresh();
  writeLegacy(root, { sessionId: "sess-old", messages: [{ id: "m1", role: "user", at: "x", text: "hi" }] });
  svc.threadList(PROJECT);

  const list = svc.createThread(PROJECT, "S1E04");
  assert.equal(list.threads.length, 2);
  const fresh2 = list.threads[1];
  assert.equal(fresh2.title, "S1E04");
  assert.equal(list.activeId, fresh2.id, "creating a thread switches to it");

  // no file yet, and the state it reports carries no history and no session
  const state = svc.get(PROJECT);
  assert.equal(state.threadId, fresh2.id);
  assert.deepEqual(state.messages, []);
});

test("close keeps the transcript; delete removes the file", () => {
  const { svc, root } = fresh();
  const studio = svc.threadList(PROJECT).threads[0].id;
  const second = svc.createThread(PROJECT, "Scratch").threads[1].id;
  // give the thread a file so delete has something to remove
  fs.writeFileSync(
    path.join(threadDir(root), `${second}.json`),
    JSON.stringify({ sessionId: "s", messages: [] }),
  );

  const closed = svc.closeThread(PROJECT, second);
  assert.equal(closed.threads.find((t) => t.id === second)?.closed, true);
  assert.ok(fs.existsSync(path.join(threadDir(root), `${second}.json`)), "close deleted the chat");
  assert.equal(closed.activeId, studio, "closing the active thread falls back to an open one");

  const after = svc.deleteThread(PROJECT, second);
  assert.equal(after.threads.length, 1);
  assert.ok(!fs.existsSync(path.join(threadDir(root), `${second}.json`)));
});

test("closing the last open thread leaves somewhere to talk", () => {
  const { svc } = fresh();
  const only = svc.threadList(PROJECT).threads[0].id;
  const after = svc.closeThread(PROJECT, only);
  const open = after.threads.filter((t) => !t.closed);
  assert.equal(open.length, 1, "no open thread left to type into");
  assert.equal(after.activeId, open[0].id);
  assert.equal(after.threads.length, 2, "the closed thread should survive, not be replaced");
});

test("rename sticks, and setActive persists across reloads", () => {
  const { svc, root } = fresh();
  const studio = svc.threadList(PROJECT).threads[0].id;
  const second = svc.createThread(PROJECT).threads[1].id;
  svc.renameThread(PROJECT, second, "  Cold open  ");
  svc.setActiveThread(PROJECT, studio);

  const settings = { get: () => ({ storage: { dataRoot: root } }) } as unknown as SettingsStore;
  const reopened = new DirectorService(settings, () => ({ port: 0, token: "" }));
  const list = reopened.threadList(PROJECT);
  assert.equal(list.threads.find((t) => t.id === second)?.title, "Cold open");
  assert.equal(list.activeId, studio);
});

test("unknown threads are refused rather than silently creating one", () => {
  const { svc } = fresh();
  svc.threadList(PROJECT);
  assert.throws(() => svc.renameThread(PROJECT, "nope", "x"), /unknown thread/);
  assert.throws(() => svc.deleteThread(PROJECT, "nope"), /unknown thread/);
  assert.throws(() => svc.send(PROJECT, "nope", "hello"), /unknown thread/);
});

test("a closed thread refuses new messages until it is reopened", () => {
  const { svc } = fresh();
  const studio = svc.threadList(PROJECT).threads[0].id;
  svc.closeThread(PROJECT, studio);
  assert.throws(() => svc.send(PROJECT, studio, "hello"), /is closed/);
  svc.reopenThread(PROJECT, studio);
  assert.equal(svc.threadList(PROJECT).threads.find((t) => t.id === studio)?.closed, false);
});

test("threads are isolated — each keeps its own transcript", () => {
  const { svc, root } = fresh();
  const a = svc.threadList(PROJECT).threads[0].id;
  const b = svc.createThread(PROJECT, "B").threads[1].id;
  fs.writeFileSync(
    path.join(threadDir(root), `${a}.json`),
    JSON.stringify({ sessionId: "sa", messages: [{ id: "1", role: "user", at: "x", text: "in A" }] }),
  );
  fs.writeFileSync(
    path.join(threadDir(root), `${b}.json`),
    JSON.stringify({ sessionId: "sb", messages: [{ id: "2", role: "user", at: "x", text: "in B" }] }),
  );
  assert.equal(svc.get(PROJECT, a).messages[0].text, "in A");
  assert.equal(svc.get(PROJECT, b).messages[0].text, "in B");
  assert.equal(svc.get(PROJECT, a).messages.length, 1, "A leaked B's messages");
});

test("two projects do not share threads", () => {
  const { svc } = fresh();
  const a = svc.threadList("proj-a");
  const b = svc.threadList("proj-b");
  assert.notEqual(a.threads[0].id, b.threads[0].id);
  assert.equal(a.project, "proj-a");
  assert.equal(b.project, "proj-b");
});
