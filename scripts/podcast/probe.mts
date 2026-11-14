/* What the machine will actually do to a multi-shot prompt, before spending a
 * render on it: is the 2.5 stack installed, and is the Gemma enhancer live (it
 * REWRITES the prompt, which is the whole experiment here). */

const { startStudiod } = await import("../../packages/core/src/server.js");
const { createStudiodApi } = await import("../../packages/core/src/tools.js");

const handle = await startStudiod({ writePortFile: false });
const api = createStudiodApi(handle.port, handle.token);
try {
  const models = await api.models.list.query();
  for (const id of ["ltx-25-22b-int8", "ltx-25-prompt-enhancer"]) {
    const m = models.find((x) => x.id === id);
    console.log(`${id.padEnd(26)} ${m?.status.state ?? "not in registry"}`);
  }
  const cat = await api.labs.video.catalog.query();
  const e = cat.engines.find((x: { id: string }) => x.id === "ltx25");
  console.log(`\nltx25 available=${e?.available}\n  ${cat.engineNotes.ltx25}`);
  console.log(`\nprojects: ${(await api.projects.list.query()).map((p) => p.id).join(", ")}`);
  const img = await api.labs.image.catalog.query();
  console.log(
    `image models: ${img.models.filter((m: any) => m.available).map((m: any) => m.id).join(", ")}`,
  );
} finally {
  await handle.close();
}
process.exit(0);
