/* The crew console contract (production experience plan P6).
 *
 * The Production Desk and the headless shell (scripts/tool.mts, the MCP
 * server, the Director chat) had diverged once: two of the pilot's defects
 * (#9, #10) were visible from only one side, because each surface had grown
 * its own set of verbs with its own argument shapes. This table is the one
 * list both sides are held to.
 *
 * A verb is one crew action: the tool the shell exposes, the tRPC procedure
 * that tool's handler calls, and the argument keys a caller may pass. The
 * Desk builds its buttons from this table (a verb missing from the drawer is
 * a type error), the tool registry is checked against it (crew-parity.test),
 * and the playbook is written in these ids. No screen-local reimplementation:
 * every verb, on either side, ends in the same procedure with the same input
 * schema — the parity test runs a fixture project through both paths and
 * compares the project JSON they leave behind. */

export interface CrewVerb {
  /** the verb's name on both sides — the tool id */
  id: string;
  /** dotted path of the tRPC procedure the tool handler calls */
  procedure: string;
  /** the Desk button's label */
  title: string;
  /** argument keys the Desk may send (a subset of the tool's schema keys;
   * `project` is implied on both sides) */
  args: readonly string[];
  /** true = a human verdict: the crew (an agent) never calls it on its own */
  human?: boolean;
  /** true = costs a render (GPU); the Desk disables it while a job is on the shot */
  render?: boolean;
}

export const CREW_VERBS = [
  {
    id: "shot_from_storyboard",
    procedure: "studio.board.renderShot",
    title: "Render",
    args: ["shotId", "preset", "engine", "multiShot", "seed", "resolution", "durationSec", "takes", "prompt", "refs"],
    render: true,
  },
  {
    /* the same tool with dryRun: true — composes and returns the spec.
     * Named separately because the Desk shows it as its own button and
     * the playbook calls it as its own step. */
    id: "shot_from_storyboard:dryRun",
    procedure: "studio.board.shotSpec",
    title: "Check spec",
    args: ["shotId", "preset", "engine", "multiShot", "durationSec", "takes", "prompt", "refs"],
  },
  {
    id: "preview_shot",
    procedure: "studio.board.renderShot",
    title: "Preview",
    args: ["shotId", "preset", "engine", "multiShot", "seed"],
    render: true,
  },
  {
    id: "qc_shot",
    procedure: "qc.shot",
    title: "QC take",
    args: ["shotId", "takeId"],
  },
  {
    id: "verify_take",
    procedure: "studio.production.verifyTake",
    title: "Re-verify",
    args: ["shotId", "takeId"],
  },
  {
    id: "approve_shot",
    procedure: "studio.production.approveShot",
    title: "Approve take",
    args: ["shotId", "takeId", "force"],
    human: true,
  },
  {
    id: "retake_shot",
    procedure: "studio.production.retakeShot",
    title: "Retake with direction",
    args: ["shotId", "note", "fix", "allowDiagnosis", "preset", "engine", "multiShot", "seed"],
    human: true,
    render: true,
  },
  {
    /* Two finishing passes on a take that already exists (Video Lab quality
     * plan Q1 + Q2): "refine" runs the full ladder's second half over a
     * draft's kept latents (same blocking, measured identical to a fresh
     * full render at that seed, and not faster — see the payload doc); "upscale"
     * is the Pixel Spatial Upscaler IC-LoRA (×2, reinvented detail). Not a
     * human verdict — the crew finishes an approved shot on its own. */
    id: "finish_take",
    procedure: "labs.video.finish",
    title: "Finish take",
    args: ["source", "mode", "strength", "shotId"],
    render: true,
  },
  {
    id: "normalize_project",
    procedure: "studio.production.normalize",
    title: "Normalize to lane",
    args: ["lane", "dryRun", "export", "loudnessLufs"],
  },
  {
    /* Scene assembly (N1.1): the scene-level plan → execute pair. Like
     * normalize, these live on the scene row, not in the shot drawer. */
    id: "scene_assemble_plan",
    procedure: "studio.assembly.plan",
    title: "Plan assembly",
    args: ["sceneId", "through", "lane", "lanes"],
  },
  {
    id: "scene_assemble",
    procedure: "studio.assembly.start",
    title: "Assemble scene",
    args: ["sceneId", "through", "lane", "lanes"],
    render: true,
  },
] as const satisfies readonly CrewVerb[];

export type CrewVerbId = (typeof CREW_VERBS)[number]["id"];

export const crewVerb = (id: CrewVerbId): CrewVerb => CREW_VERBS.find((v) => v.id === id)!;

/** the tool a verb id names — "shot_from_storyboard:dryRun" is shot_from_storyboard with dryRun */
export const crewVerbTool = (id: CrewVerbId): string => id.split(":")[0];
