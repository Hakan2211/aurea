/* Headless model fetch — drives Aurea's own ModelManager so the manifest,
 * the sha256 verification and the resume behaviour are the real ones.
 *
 *   npx tsx fetch-models.mts minimax-h3-turbo-lora minimax-h3-w4a8 …
 */
import { SettingsStore } from "../packages/core/src/settings.js";
import { ModelManager } from "../packages/core/src/models/manager.js";

const ids = process.argv.slice(2);
if (!ids.length) throw new Error("usage: fetch-models.mts <model-id>…");

const models = new ModelManager(new SettingsStore());
const gb = (b: number) => (b / 1024 ** 3).toFixed(2);

for (const id of ids) {
  const entry = models.list().find((m) => m.id === id);
  if (!entry) throw new Error(`unknown model "${id}"`);
  if (entry.status.state === "installed") {
    console.log(`${id}: already installed (${gb(entry.sizeBytes)} GB)`);
    continue;
  }
  console.log(`${id}: ${gb(entry.sizeBytes)} GB — starting`);
  models.download(id, true);
  let lastLog = 0;
  await new Promise<void>((resolve, reject) => {
    const tick = setInterval(() => {
      const now = models.list().find((m) => m.id === id)!;
      const s = now.status;
      if (s.error) {
        clearInterval(tick);
        reject(new Error(`${id}: ${s.error}`));
        return;
      }
      if (s.state === "installed") {
        clearInterval(tick);
        console.log(`${id}: done`);
        resolve();
        return;
      }
      if (Date.now() - lastLog > 30_000) {
        lastLog = Date.now();
        const rate = s.bytesPerSec ? `${(s.bytesPerSec / 1e6).toFixed(1)} MB/s` : "";
        console.log(
          `${id}: ${s.progress.toFixed(1)}% ${gb(s.bytes)}/${gb(now.sizeBytes)} GB ${rate} ${s.file ?? ""}`,
        );
      }
    }, 2000);
  });
}
console.log("all done");
process.exit(0);
