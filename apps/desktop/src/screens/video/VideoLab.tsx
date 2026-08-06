import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { useVideoLab } from "@/hooks";
import { ScreenHeader } from "@/components/ui";
import { ParamsPanel } from "./ParamsPanel";
import { PreviewPanel } from "./PreviewPanel";
import { JobRail } from "./JobRail";
import type { RetakeDraft, ShotPrefill } from "./shared";

/* Video gen — UI-Design/videogen lab.jpg. Keyframe-driven i2v: prompt + start
 * frame + engine choice on the left, preview + takes in the center, staged job
 * progress on the right. Data flows through useVideoLab (tRPC seam); which
 * controls the left panel shows is decided by engineSurface.ts, not by the
 * components themselves. */

/** the header's one-line answer to "what can this engine do right now" */
function capabilityLine(
  engineId: string,
  lab: ReturnType<typeof useVideoLab>,
): string {
  const caps = lab.capabilities;
  if (engineId === "seedance") return lab.engineNotes.seedance ?? "cloud render via fal.ai";
  if (engineId === "minimax-h3") {
    const mm = caps?.minimax;
    if (!mm) return "probing the MiniMax ComfyUI…";
    if (!mm.reachable) return mm.note ?? "MiniMax ComfyUI not reachable";
    return mm.sage ? "reachable · SageAttention available" : (mm.note ?? "reachable");
  }
  if (!caps) return "probing ComfyUI…";
  if (!caps.reachable) return caps.note ?? "ComfyUI not reachable";
  return caps.note ?? "full Director surface available";
}

export function VideoLab() {
  const lab = useVideoLab();
  const [takeId, setTakeId] = useState((lab.takes.find((t) => t.selected) ?? lab.takes[0]).id);
  /** a retake is marked on the preview player and rendered from the params
   * panel, so the draft lives here, above both */
  const [retake, setRetake] = useState<RetakeDraft | null>(null);
  /** lifted out of the params panel so the header can name the engine — and so
   * the choice survives the panel re-keying on a storyboard send */
  const [engineId, setEngineId] = useState(lab.engines[0].id);
  /* "Send to Director" navigates here with the composed shot. Keying the panel
   * on it re-seeds every control from the spec — including a second send of the
   * same shot, once its voice takes exist and the timing is no longer a guess. */
  const prefill = (useLocation().state as { shot?: ShotPrefill } | null)?.shot ?? null;
  const prefillKey = prefill ? `${prefill.shotId}:${prefill.sentAt}` : null;

  /* A composed shot is an LTX Director spec. Before the engine choice was
   * lifted, the panel re-keying implicitly reset it to the first engine on
   * every send — keep that, or a send while MiniMax is on deck would seed a
   * timeline the chosen engine can't render. */
  useEffect(() => {
    if (prefillKey) setEngineId("ltx2");
  }, [prefillKey]);

  const engine = lab.engines.find((e) => e.id === engineId);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title="Video gen"
        sub={`${engine?.label ?? engineId} · ${capabilityLine(engineId, lab)}`}
      />
      <div className="flex min-h-0 flex-1">
        <ParamsPanel
          key={prefill ? `${prefill.shotId}:${prefill.sentAt}` : "free"}
          prefill={prefill}
          retake={retake}
          setRetake={setRetake}
          engineId={engineId}
          setEngineId={setEngineId}
        />
        <PreviewPanel
          takeId={takeId}
          onSelect={setTakeId}
          retake={retake}
          setRetake={setRetake}
        />
        <JobRail />
      </div>
    </div>
  );
}
