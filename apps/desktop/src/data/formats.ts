/* The videofast format registry, mirrored for the UI. Source of truth:
 * videofast/webapp/scripts/batch/formats/index.ts (FORMATS) and
 * videofast/webapp/remotion/lib/style-packs.ts (STYLE_PACKS). When studiod
 * lands this file is replaced by a tRPC query against the live registry. */

export interface StylePackRef {
  id: string;
  label: string;
  /** real palette values from style-packs.ts */
  bg: string;
  accent: string;
  accentAlt: string;
  mode: "dark" | "light";
}

export const STYLE_PACKS: StylePackRef[] = [
  { id: "noirLuxury", label: "Noir Luxury", bg: "#0a0908", accent: "#d4af6a", accentAlt: "#8a6f3c", mode: "dark" },
  { id: "emberNoir", label: "Ember Noir", bg: "#0c0505", accent: "#e0563f", accentAlt: "#f2a03d", mode: "dark" },
  { id: "neuronGlow", label: "Neuron Glow", bg: "#070812", accent: "#4fd8ff", accentAlt: "#ff4fd8", mode: "dark" },
  { id: "therapyMinimal", label: "Therapy Minimal", bg: "#f7f2ea", accent: "#7d9b76", accentAlt: "#c47a5a", mode: "light" },
  { id: "kurzFlat", label: "Kurz Flat", bg: "#0d2340", accent: "#ffb52e", accentAlt: "#ff5964", mode: "dark" },
  { id: "paperCollage", label: "Paper Collage", bg: "#f2e9d8", accent: "#d94f30", accentAlt: "#2b6cb0", mode: "light" },
  { id: "blueprintSchematic", label: "Blueprint", bg: "#0d3b66", accent: "#9be3ff", accentAlt: "#ffd166", mode: "dark" },
  { id: "gradientMeshSoft", label: "Gradient Mesh", bg: "#1a1230", accent: "#b78cff", accentAlt: "#ff9ecb", mode: "dark" },
  { id: "chalkboardManim", label: "Chalkboard", bg: "#101418", accent: "#58c4dd", accentAlt: "#f7d94c", mode: "dark" },
  { id: "editorialMagazine", label: "Editorial", bg: "#faf6ef", accent: "#c8102e", accentAlt: "#1d3557", mode: "light" },
  { id: "terminalGreen", label: "Terminal", bg: "#060a06", accent: "#3dff7c", accentAlt: "#ffd23d", mode: "dark" },
  { id: "sketchbook", label: "Sketchbook", bg: "#fbf7ee", accent: "#d9713e", accentAlt: "#3566a8", mode: "light" },
];

export const packById = (id: string) => STYLE_PACKS.find((p) => p.id === id)!;

export type FormatCategory =
  | "motivational"
  | "dataStory"
  | "explainer"
  | "cinematic"
  | "strategist";

export const CATEGORIES: { id: FormatCategory | "all"; label: string }[] = [
  { id: "all", label: "All formats" },
  { id: "motivational", label: "Motivational" },
  { id: "dataStory", label: "Data story" },
  { id: "explainer", label: "Explainer" },
  { id: "cinematic", label: "Cinematic" },
  { id: "strategist", label: "Strategist" },
];

export interface FormatCard {
  id: string;
  name: string;
  category: FormatCategory;
  /** one-line pitch shown on the card */
  tagline: string;
  /** longer recipe summary for the detail panel */
  recipe: string;
  generate: "llm" | "builder";
  /** pipeline stages, in order, from the registry */
  stages: readonly string[];
  /** paradigm ids the format can express (absent = legacy pipeline) */
  paradigms?: readonly string[];
  /** style packs the format was built for — first one paints the poster */
  packs: readonly string[];
  /** poster headline (real exit-video titles where we have them) */
  poster: string;
  featured?: boolean;
}

const STANDARD = ["generate", "codegen", "tts", "retime", "render", "mux", "thumbnail", "deliver"] as const;
const WITH_ASSETS = ["generate", "codegen", "assets", "tts", "retime", "render", "mux", "thumbnail", "deliver"] as const;

export const FORMATS: FormatCard[] = [
  {
    id: "strategist",
    name: "Strategist",
    category: "strategist",
    tagline: "The meta-format — a brief pass picks the paradigm mix per topic.",
    recipe:
      "Plans the whole batch first: a strategist brief chooses each video's paradigm mix from the full menu, then the dominant paradigm selects the matching recipe at generate time. Guarantees variety — 4+ dominant paradigms per 10-video batch on one account.",
    generate: "llm",
    stages: WITH_ASSETS,
    paradigms: ["jsx2d", "svgChoreo", "d3Data", "p5Canvas", "r3f3d", "parallax25d", "manimClip"],
    packs: ["noirLuxury", "kurzFlat", "neuronGlow", "chalkboardManim", "therapyMinimal", "gradientMeshSoft"],
    poster: "One brief. Seven paradigms.",
    featured: true,
  },
  {
    id: "motivational",
    name: "Motivational",
    category: "motivational",
    tagline: "The original agentic short — full LLM scene generation.",
    recipe:
      "The house format: the LLM writes every scene — kinetic hooks, metaphors, quotes, end card — against the account's style pack. The format the whole studio grew out of.",
    generate: "llm",
    stages: STANDARD,
    packs: ["noirLuxury", "emberNoir"],
    poster: "DISCIPLINE TODAY. FREEDOM TOMORROW.",
  },
  {
    id: "quote",
    name: "Quote",
    category: "motivational",
    tagline: "Deterministic text-quote videos — no LLM, instant config.",
    recipe:
      "Built by a deterministic builder from a CSV of quotes and attributions — zero LLM calls, perfectly repeatable. The cheapest way to keep a channel fed.",
    generate: "builder",
    stages: STANDARD,
    packs: ["noirLuxury", "editorialMagazine"],
    poster: "“We suffer more in imagination than in reality.”",
  },
  {
    id: "imageMotion",
    name: "Image Motion",
    category: "cinematic",
    tagline: "AI stills with 2.5D parallax dollies and cinematic cuts.",
    recipe:
      "The LLM writes a rich cinematic imagePrompt per scene; stills generate locally (Krea 2 or z-image-turbo via ComfyUI) and every one becomes a 2.5D parallax dolly shot — lumaWipe workhorse cuts, matchCutZoom answers, one lightSweep on the peak.",
    generate: "llm",
    stages: WITH_ASSETS,
    packs: ["noirLuxury", "emberNoir", "gradientMeshSoft"],
    poster: "Beyond the Horizon",
  },
  {
    id: "metaphor",
    name: "Metaphor",
    category: "explainer",
    tagline: "Choreographed 2D metaphors + one SVG transformation beat.",
    recipe:
      "3–5 metaphor2d scenes — each a different pose story restating the spoken line — plus one svgChoreo transformation beat and optionally one chatScene when the idea is literally a dialogue. Soft motion, no 3D heroes.",
    generate: "llm",
    stages: STANDARD,
    paradigms: ["jsx2d", "svgChoreo"],
    packs: ["therapyMinimal", "kurzFlat"],
    poster: "The Boulder You Keep Pushing",
  },
  {
    id: "dataStory",
    name: "Data Story",
    category: "dataStory",
    tagline: "One quantitative claim per chart, chosen by the claim's shape.",
    recipe:
      "2–4 dataViz scenes, each a different chart kind matched to its claim — areaGrowth for change, barRace for ranking, donutShare for part-of-whole, pictogram for count-of-people — with the annotation on the exact datum the VO lands on.",
    generate: "llm",
    stages: STANDARD,
    paradigms: ["d3Data", "jsx2d"],
    packs: ["kurzFlat", "blueprintSchematic", "chalkboardManim"],
    poster: "The Numbers Don't Lie.",
  },
  {
    id: "mathExplainer",
    name: "Math Explainer",
    category: "dataStory",
    tagline: "Manim-rendered mathematical beats — real, checkable math.",
    recipe:
      "Exactly two manimClip scenes rendered offline by Manim — equationReveal, graphTransform, geometricProof, numberLineZoom or vectorField, picked by the claim's shape — breathing between dataViz and metaphor scenes.",
    generate: "llm",
    stages: WITH_ASSETS,
    paradigms: ["manimClip", "d3Data", "jsx2d"],
    packs: ["chalkboardManim", "blueprintSchematic"],
    poster: "E = mc²",
  },
  {
    id: "generative",
    name: "Generative",
    category: "cinematic",
    tagline: "p5 sketches whose physics mirror the spoken line.",
    recipe:
      "Two p5Sketch mood beats, never adjacent — flowField for momentum, orbitalDots for focus, growthRings for patience, particleBurst timed to the breakthrough — carried by 2D metaphors between them.",
    generate: "llm",
    stages: STANDARD,
    paradigms: ["p5Canvas", "jsx2d"],
    packs: ["neuronGlow", "gradientMeshSoft"],
    poster: "Neurons in Action",
  },
  {
    id: "cinematic",
    name: "Cinematic",
    category: "cinematic",
    tagline: "3D subject beats + a parallax world the camera travels through.",
    recipe:
      "1–2 scene3d beats with the camera matched to the emotional verb — dollyIn to realize, slowOrbit to accept, craneUp to achieve — one of which may be a generated photoreal 3D model (Hunyuan3D), plus exactly one 2.5D parallax world. The expensive-looking emotional format.",
    generate: "llm",
    stages: WITH_ASSETS,
    paradigms: ["r3f3d", "parallax25d", "jsx2d"],
    packs: ["neuronGlow", "noirLuxury", "gradientMeshSoft"],
    poster: "The Door You Never Tried",
  },
  {
    id: "whiteboard",
    name: "Whiteboard",
    category: "explainer",
    tagline: "Hand-drawn strokes draw on with a pen cursor.",
    recipe:
      "3–5 svgDraw scenes, each one simple iconic line drawing — mountains, arrows, stairs, clocks, stick figures — with validated, auto-repaired path data that draws on stroke by stroke.",
    generate: "llm",
    stages: STANDARD,
    packs: ["sketchbook", "therapyMinimal", "paperCollage"],
    poster: "The Vicious Cycle",
  },
];

export const STAGE_LABELS: Record<string, string> = {
  generate: "Generate",
  codegen: "Codegen",
  assets: "Assets",
  tts: "TTS",
  retime: "Retime",
  render: "Render",
  mux: "Mux",
  thumbnail: "Thumbnail",
  deliver: "Deliver",
};
