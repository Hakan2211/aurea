/* Is this ComfyUI able to render cast references today? */
import { createStudiodApi } from "../../packages/core/src/tools.js";
import { readPortFile } from "../../packages/core/src/portfile.js";

async function main() {
  const pf = await readPortFile();
  if (!pf) throw new Error("no studiod port file");
  const api = createStudiodApi(pf.port, pf.token);
  console.log(JSON.stringify(await api.labs.video.capabilities.query(), null, 2));
  process.exit(0);
}
main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
