/* What does the chosen engine actually offer on THIS machine?
 *
 * The old panel answered that question inline, one `engineId === "…"`
 * conditional at a time, which is how a new capability meant touching six
 * scattered branches. This is the same knowledge computed once, declaratively:
 * a section is shown, locked (visible but greyed, with the reason — the house
 * style is visible gating, never silent absence), or hidden (not part of this
 * engine's vocabulary at all, like a Director timeline on Seedance).
 *
 * Pure over (catalog, capabilities, engineId) so it can be reasoned about and
 * tested without a renderer. Capabilities arrive null while the probe is in
 * flight; like the old Director toggle, null reads as "unknown" rather than
 * "unsupported" so sections don't flicker off on every screen load. */

export type SectionState = "shown" | "locked" | "hidden";

export type SurfaceSection =
  | "frames"
  | "endFrame"
  | "keyframes"
  | "dialogue"
  | "director"
  | "camera"
  | "adapters"
  | "quality"
  | "fps"
  | "references";

export interface EngineSurface {
  sections: Record<SurfaceSection, { state: SectionState; reason?: string }>;
  /** the presets this engine's canvas actually supports */
  resolutions: string[];
  /** the duration ladder, already cut to the engine's trained range */
  durations: string[];
}

/** payload.cameraLora.move's vocabulary — mirrored from the shared schema so
 * the picker can be typed without importing zod into a pure module */
export const CAMERA_MOVES = [
  "dolly-in",
  "dolly-out",
  "dolly-left",
  "dolly-right",
  "jib-up",
  "jib-down",
  "static",
] as const;
export type CameraMove = (typeof CAMERA_MOVES)[number];

/** the slice of labs.video.catalog the surface reads (via useVideoLab) */
export interface SurfaceCatalog {
  durations: string[];
  resolutions: string[];
  resolutionsByEngine: Record<string, string[]>;
  /** null on a core old enough not to state the LTX surface */
  ltx: {
    fpsOptions: number[];
    draft: boolean;
    keyframesMax: number;
    lorasMax: number;
    cameraMoves: string[];
  } | null;
  /** MiniMax's ref2va checkpoint is downloaded (catalog, not a live probe) */
  minimaxRefsAvailable: boolean;
  /** the H3 Turbo distill LoRAs are downloaded — Draft and Standard quality */
  minimaxTurboAvailable: boolean;
  /** the chunked long-form sampler is installed, and the lengths it unlocks —
   * H3-only, because the shared ladder stops where LTX stops fitting */
  minimaxLongForm: { available: boolean; durations: string[] };
  /** H3's camera-motion LoRA and the moves it has words for */
  minimaxCamera: { available: boolean; moves: string[] };
  /** which checkpoint each H3 head will load */
  minimaxWeights: { fl2va: "gguf" | "w4a8"; ref2va: "gguf" | "w4a8" };
}

/** the slice of labs.video.capabilities the surface reads; null mid-probe */
export interface SurfaceCapabilities {
  reachable: boolean;
  director: boolean;
  endFrame: boolean;
  availableLoras: string[];
  cameraLoras: Partial<Record<string, string>>;
  note?: string;
}

const shown = { state: "shown" } as const;
const hidden = { state: "hidden" } as const;
const locked = (reason?: string) => ({ state: "locked" as const, reason });

/** every section a lab engine could have, defaulted to hidden — the Seedance
 * baseline, and what an unknown engine id degrades to */
const NONE: EngineSurface["sections"] = {
  frames: shown,
  endFrame: hidden,
  keyframes: hidden,
  dialogue: hidden,
  director: hidden,
  camera: hidden,
  adapters: hidden,
  quality: hidden,
  fps: hidden,
  references: hidden,
};

const secondsOf = (d: string) => parseInt(d) || 0;

export function computeEngineSurface(
  catalog: SurfaceCatalog,
  capabilities: SurfaceCapabilities | null,
  engineId: string,
): EngineSurface {
  const resolutions = catalog.resolutionsByEngine[engineId] ?? catalog.resolutions;

  if (engineId === "seedance") {
    return {
      sections: {
        ...NONE,
        // 2.0 takes an end frame the clip lands on (the image endpoint's
        // end_image_url); 1.0 took a start frame and nothing else
        endFrame: shown,
      },
      resolutions,
      // 2.0 bills any whole second in 4–15, so the ladder is offered as-is
      // rather than snapped to the two lengths 1.0 accepted
      durations: catalog.durations.filter((d) => secondsOf(d) >= 4 && secondsOf(d) <= 15),
    };
  }

  if (engineId === "minimax-h3") {
    return {
      sections: {
        ...NONE,
        // fl2va: a first frame, and optionally a last one the take must land on
        endFrame: shown,
        references: catalog.minimaxRefsAvailable
          ? shown
          : locked(
              "References need H3's second head (ref2va) — Settings → Models → " +
                "MiniMax-H3 Reference (GGUF). It is what carries a face, a voice or a " +
                "camera move into a new shot, and how a finished clip gets edited.",
            ),
        // H3's ladder has three rungs — the 4-step distill, the 8-step
        // distill, and the model's own 25-step schedule. The two distilled
        // ones are gated on their download the way references are.
        quality: catalog.minimaxTurboAvailable
          ? shown
          : locked(
              "Draft and Standard render with LightX2V's distilled LoRAs — 4 or 8 steps " +
                "instead of 25. Settings → Models → MiniMax-H3 Turbo LoRAs.",
            ),
        /* H3 used to have NO camera control at all — the prompt was the whole
         * surface and the adapter refused a camera LoRA outright. Jojocodex's
         * weight gives it one; hidden (not locked) until it is downloaded,
         * same rule as the LTX set. */
        camera: catalog.minimaxCamera.available ? shown : hidden,
      },
      resolutions,
      /* 4–15s is what H3 was trained on, and the panel keeps its own warning
       * for a duration carried over from another engine. Past that the shot
       * has to be chunked, so those lengths only appear once the long-form
       * sampler is installed — and they come from H3's own ladder rather than
       * the shared one, which stops at 20s because that is where LTX stops
       * fitting on this card. */
      durations: [
        ...catalog.durations.filter((d) => secondsOf(d) >= 4 && secondsOf(d) <= 15),
        ...(catalog.minimaxLongForm.available ? catalog.minimaxLongForm.durations : []),
      ],
    };
  }

  if (engineId === "ltx25") {
    /* 2.5 shares ltx2's ComfyUI and its guide-node probe, but not its
     * dialogue arm, Director timeline or camera LoRAs — those are 2.3-only
     * for now, so they are hidden (not part of this engine's vocabulary),
     * never locked. */
    const probing25 = capabilities === null;
    const guides25 = probing25 || capabilities.endFrame;
    const guideReason25 =
      capabilities?.note ?? "This ComfyUI is missing the core LTX guide nodes.";
    return {
      sections: {
        ...NONE,
        endFrame: guides25 ? shown : locked(guideReason25),
        keyframes: guides25 ? shown : locked(guideReason25),
        adapters: capabilities?.availableLoras.length
          ? shown
          : locked(
              capabilities && !capabilities.reachable
                ? (capabilities.note ?? "ComfyUI is not reachable.")
                : "No adapter LoRAs in this install's lora folder.",
            ),
        quality: shown,
        fps: catalog.ltx ? shown : hidden,
      },
      resolutions,
      durations: catalog.durations,
    };
  }

  /* ltx2 — the full local surface, gated feature by feature on the probe */
  const probing = capabilities === null;
  // the core guide nodes ship with any LTX install, but a stripped ComfyUI
  // degrades politely rather than dying inside a queued render
  const guides = probing || capabilities.endFrame;
  const guideReason = capabilities?.note ?? "This ComfyUI is missing the core LTX guide nodes.";
  return {
    sections: {
      ...NONE,
      endFrame: guides ? shown : locked(guideReason),
      keyframes: guides ? shown : locked(guideReason),
      dialogue: shown,
      director:
        probing || capabilities.director
          ? shown
          : locked(
              capabilities.note ??
                "Needs a ComfyUI with the Director node pack — check Settings → Engines.",
            ),
      // hidden, not locked, until the weights are in the lora folder — a
      // control nobody can unlock is noise rather than gating. (The Lightricks
      // set loads on 2.3 despite its 19b name; see resolveCameraLoras.)
      camera:
        capabilities && Object.keys(capabilities.cameraLoras).length > 0 ? shown : hidden,
      adapters: capabilities?.availableLoras.length
        ? shown
        : locked(
            capabilities && !capabilities.reachable
              ? (capabilities.note ?? "ComfyUI is not reachable.")
              : "No adapter LoRAs in this install's lora folder.",
          ),
      quality: catalog.ltx?.draft ? shown : hidden,
      fps: catalog.ltx ? shown : hidden,
    },
    resolutions,
    durations: catalog.durations,
  };
}
