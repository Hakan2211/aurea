/* Voice → engine routing — a Qwen narrator preset requested on the default
 * chatterbox engine must route to Qwen3-TTS (and a cloned voice requested on
 * qwen must route back to Chatterbox) instead of failing minutes later inside
 * the adapter with "no reference clip". Jobs are canceled right after the
 * enqueue — this only checks routing, not synthesis.
 *
 * Run: npx tsx scripts/test-voice-routing.mts */

const { startStudiod } = await import("../packages/core/src/server.js");
const { createStudiodApi } = await import("../packages/core/src/tools.js");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const handle = await startStudiod({ writePortFile: false });
const api = createStudiodApi(handle.port, handle.token);

try {
  const { voices } = await api.labs.voice.catalog.query();
  const preset = voices.find((v) => v.kind === "preset");
  const cloned = voices.find((v) => v.kind === "cloned");
  check("catalog offers both preset and cloned voices", !!preset && !!cloned,
    `${voices.length} voices`);

  if (preset) {
    const job = await api.labs.voice.generate.mutate({
      text: "routing check", voice: preset.id, project: "playground",
    });
    check(`preset "${preset.id}" on default engine routes to Qwen3-TTS`,
      job.engine === "Qwen3-TTS", job.engine);
    await api.jobs.cancel.mutate({ id: job.id });
  }
  if (cloned) {
    const job = await api.labs.voice.generate.mutate({
      text: "routing check", voice: cloned.id, engine: "qwen", project: "playground",
    });
    check(`cloned "${cloned.id}" requested on qwen routes to Chatterbox`,
      job.engine === "Chatterbox", job.engine);
    await api.jobs.cancel.mutate({ id: job.id });
  }
  const job = await api.labs.voice.generate.mutate({
    text: "routing check", voice: "no-such-voice", project: "playground",
  });
  check("unknown voice keeps the requested engine (adapter reports it)",
    job.engine === "Chatterbox", job.engine);
  await api.jobs.cancel.mutate({ id: job.id });
} finally {
  await handle.close();
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
