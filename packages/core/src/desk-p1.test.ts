/* Production Desk verdicts (P1) — the store half. Approve resolves WHICH take
 * gets locked (explicit id > the shot's selected take > the newest) and flips
 * the persisted status; retake-with-note appends direction that shot-spec.test
 * proves rides the composed prompt. First StudioStore-on-disk test: a temp
 * dataRoot and duck-typed settings/projects stand in for the real stores. */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { productionSchema, shotSchema } from "@aurea/shared";
import { StudioStore } from "./studio.js";
import type { SettingsStore } from "./settings.js";
import type { ProjectStore } from "./projects.js";

const take = (id: string) => ({ id, asset: `projects/p/assets/video/${id}.mp4`, engine: "ltx2", label: "" });

function makeStore(shotPatch: Record<string, unknown>) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aurea-desk-"));
  const settings = { get: () => ({ storage: { dataRoot: tmp } }) } as unknown as SettingsStore;
  const projects = { list: () => [{ id: "p", name: "P" }] } as unknown as ProjectStore;
  const store = new StudioStore(settings, projects);
  store.updateProduction(
    "p",
    productionSchema.parse({
      title: "P",
      seasons: [
        {
          id: "s1",
          number: 1,
          episodes: [
            {
              id: "e1",
              number: 1,
              title: "E1",
              scenes: [
                { id: "sc1", slugline: "INT.", shots: [shotSchema.parse({ id: "sh1", ...shotPatch })] },
              ],
            },
          ],
        },
      ],
    }),
  );
  return store;
}

const rendered = {
  videoTakes: [take("t1"), take("t2"), take("t3")],
  selectedTake: "t2",
  status: "generated",
};

test("approve locks the named take and flips the shot to approved", () => {
  const store = makeStore(rendered);
  const { shot, take: locked } = store.approveShot("p", "sh1", "t1");
  assert.equal(locked.id, "t1");
  assert.equal(shot.selectedTake, "t1");
  assert.equal(shot.status, "approved");
  // and it persisted — a fresh read agrees
  const back = store.getProduction("p").seasons[0].episodes[0].scenes[0].shots[0];
  assert.equal(back.status, "approved");
  assert.equal(back.selectedTake, "t1");
});

test("approve without a takeId locks the shot's selected take", () => {
  const store = makeStore(rendered);
  assert.equal(store.approveShot("p", "sh1").take.id, "t2");
});

test("approve with nothing selected locks the newest take", () => {
  const store = makeStore({ ...rendered, selectedTake: null });
  assert.equal(store.approveShot("p", "sh1").take.id, "t3");
});

test("approve refuses a shot with no rendered takes, and an unknown take id", () => {
  assert.throws(() => makeStore({}).approveShot("p", "sh1"), /no rendered takes/);
  assert.throws(() => makeStore(rendered).approveShot("p", "sh1", "nope"), /unknown take "nope"/);
});

test("retake notes accumulate on the shot, trimmed, oldest first", () => {
  const store = makeStore(rendered);
  store.addTakeNote("p", "sh1", "  tighter framing ");
  const { shot } = store.addTakeNote("p", "sh1", "let the pause land");
  assert.deepEqual(shot.takeNotes, ["tighter framing", "let the pause land"]);
  // a note is direction, not a verdict — the status stays put
  assert.equal(shot.status, "generated");
});
