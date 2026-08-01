/* Videofast account roster — the channel presets the batch pipeline renders
 * as. One JSON per account in <videofastDir>/accounts; read fresh per query so
 * hand-edits show up without a studiod restart. */

import fs from "node:fs";
import path from "node:path";
import type { SettingsStore } from "./settings.js";

export interface VideofastAccount {
  /** file basename — what videofastPayloadSchema.account expects */
  id: string;
  handle?: string;
  niche: string;
  /** format id from the videofast registry the account was built for */
  format: string;
  /** the account's style-pack pool (empty = legacy themePreset look) */
  stylePacks: string[];
  voice: string;
  lang: string;
  cta?: string;
}

export function listVideofastAccounts(settings: SettingsStore): VideofastAccount[] {
  const vf = settings.get().paths.videofastDir;
  if (!vf) return [];
  const dir = path.join(vf, "accounts");
  if (!fs.existsSync(dir)) return [];
  const accounts: VideofastAccount[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      accounts.push({
        id: path.basename(file, ".json"),
        handle: typeof raw.handle === "string" ? raw.handle : undefined,
        niche: typeof raw.niche === "string" ? raw.niche : "",
        format: typeof raw.format === "string" ? raw.format : "motivational",
        stylePacks: Array.isArray(raw.stylePacks) ? raw.stylePacks.filter((p: unknown) => typeof p === "string") : [],
        voice: typeof raw.voice === "string" ? raw.voice : "gravel",
        lang: typeof raw.lang === "string" ? raw.lang : "english",
        cta: typeof raw.cta === "string" ? raw.cta : undefined,
      });
    } catch {
      // unparseable account file — leave it out rather than fail the roster
    }
  }
  return accounts;
}
