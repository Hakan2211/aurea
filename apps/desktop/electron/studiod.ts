/* Forked by main.ts via utilityProcess — this is the desktop shell's copy of
 * studiod (PRD tier 3). Random port + per-boot token; main relays them to the
 * renderer over the bridge. Headless clients discover the same instance
 * through ~/.aurea/studiod.json. */

import { startStudiod } from "@aurea/core";

const handle = await startStudiod({ writePortFile: true });

process.parentPort.postMessage({ port: handle.port, token: handle.token });
