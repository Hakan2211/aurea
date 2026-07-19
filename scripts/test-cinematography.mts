/* Smoke test: cinematography bank resolution inside composeKeyframePrompt.
 * Run: npx tsx scripts/test-cinematography.mts */
import {
  CINEMATOGRAPHY_BANK,
  bibleSchema,
  composeKeyframePrompt,
  resolveCameraSpec,
  shotSchema,
  type Scene,
} from "../packages/shared/src/index.js";

let failures = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const bible = bibleSchema.parse({
  characters: [
    {
      id: "sterling",
      name: "Sterling",
      species: "lion",
      wardrobe: "cream trousers and a silk ascot",
      signatureFeature: "magnificent golden mane",
      anchors: { face: "small notch in the left ear", body: "", macro: "" },
      refs: { keyframeRef: "assets/image/characters/sterling/gpt-s1.png" },
    },
  ],
  locations: [
    { id: "loft", name: "the loft", description: "", stylePrompt: "sun-washed brick loft, tall windows" },
  ],
  style: { artDirection: "stylized 3D animated, cinematic render" },
  cinematography: CINEMATOGRAPHY_BANK,
});

// bank ids resolve to full clauses
const spec = resolveCameraSpec(
  { shotSize: "ws", angle: "low", move: "push-in", lens: "deep", lighting: "sitcom.warm-home", notes: "symmetry" },
  bible.cinematography,
);
check("shotSize id → clause", spec.shotSize.includes("full body visible head to toe"), spec.shotSize);
check("angle id → clause", spec.angle.includes("towering"), spec.angle);
check("move id → clause", spec.move.includes("push-in toward"), spec.move);
check("lens id → clause", spec.lens.includes("everything sharp"), spec.lens);
check("lighting bank.entry → clause", spec.lighting.includes("warm practical lamps"), spec.lighting);
check("notes composition id → clause", spec.notes.includes("symmetrical composition"), spec.notes);

// abbreviation + bare lighting entry + free text
const spec2 = resolveCameraSpec(
  { shotSize: "MCU", angle: "", move: "", lens: "", lighting: "follow-spot", notes: "steam rising from a teacup" },
  bible.cinematography,
);
check("name abbreviation (MCU) resolves", spec2.shotSize.includes("head and shoulders"), spec2.shotSize);
check("bare lighting entry id resolves", spec2.lighting.includes("single hard spotlight"), spec2.lighting);
check("free text passes through", spec2.notes === "steam rising from a teacup", spec2.notes);

// no bank installed → everything passes through untouched
const emptyBible = bibleSchema.parse({});
const spec3 = resolveCameraSpec(
  { shotSize: "ws", angle: "", move: "", lens: "", lighting: "sitcom.warm-home", notes: "" },
  emptyBible.cinematography,
);
check("no bank: ids pass through", spec3.shotSize === "ws" && spec3.lighting === "sitcom.warm-home");

// full composed prompt carries the expanded clauses
const shot = shotSchema.parse({
  id: "s1",
  title: "Sterling surveys the loft",
  scriptLines: [{ id: "l1", character: null, text: "Sterling straightens his ascot and surveys the room." }],
  characters: ["sterling"],
  location: "loft",
  camera: { shotSize: "ws", angle: "low", move: "static", lens: "deep", lighting: "sitcom.warm-home", notes: "symmetry" },
});
const scene: Scene = { id: "sc1", slugline: "INT. THE LOFT — DAY", summary: "", location: "loft", shots: [] };
const prompt = composeKeyframePrompt(shot, scene, bible);
console.log(`\n${prompt}\n`);
check("prompt: subject present", prompt.includes("this exact lion character Sterling"));
check("prompt: shot-size clause expanded", prompt.includes("full body visible head to toe"));
check("prompt: lighting clause expanded", prompt.includes("warm practical lamps"));
check("prompt: composition clause expanded", prompt.includes("perfectly centered symmetrical"));
check("prompt: move stays OUT of the still", !prompt.includes("no camera movement"));
check("prompt: art direction tail", prompt.includes("stylized 3D animated"));

// old bible.json files (no cinematography key) still parse
check("bible schema back-compat", bibleSchema.safeParse({ version: 1, characters: [], locations: [] }).success);

// bank ids are unique within each list
for (const [name, list] of Object.entries({
  shotSizes: CINEMATOGRAPHY_BANK.shotSizes,
  angles: CINEMATOGRAPHY_BANK.angles,
  moves: CINEMATOGRAPHY_BANK.moves,
  lenses: CINEMATOGRAPHY_BANK.lenses,
  compositions: CINEMATOGRAPHY_BANK.compositions,
  formations: CINEMATOGRAPHY_BANK.formations,
})) {
  const ids = list.map((c) => c.id);
  check(`unique ids: ${name}`, new Set(ids).size === ids.length);
}
for (const bank of CINEMATOGRAPHY_BANK.lighting) {
  const ids = bank.entries.map((e) => e.id);
  check(`unique ids: lighting.${bank.id}`, new Set(ids).size === ids.length);
}

console.log(failures ? `\n${failures} FAILURES` : "\nALL PASS");
process.exit(failures ? 1 : 0);
