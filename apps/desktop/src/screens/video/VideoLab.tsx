import { useState } from "react";
import { useLocation } from "react-router";
import { useVideoLab } from "@/hooks";
import { ScreenHeader } from "@/components/ui";
import { PreviewPanel } from "./PreviewPanel";
import { Composer } from "./Composer";
import { AdvancedDrawer } from "./AdvancedDrawer";
import { AbModal } from "./AbModal";
import { FramePicker } from "./FramePicker";
import { useVideoParams, VIDEO_DRAFT } from "./useVideoParams";
import { clearDrafts, peekDraft, useDraft, writeDraft } from "@/useDraft";
import type { RetakeDraft, ShotPrefill } from "./shared";

/* Video gen — simple by default (UI simplify plan, Stage 2). The preview and
 * its takes strip fill the screen, with renders in flight shown as cards on
 * that strip; the composer underneath holds what every shot needs (start
 * frame, prompt, engine, length, size, Generate); everything else is in the
 * Advanced drawer on the right, whose open state persists. All of it reads one
 * state, useVideoParams, so the layout cannot change what a render sends.
 * Which controls exist is still decided by engineSurface.ts. */

const ADVANCED_KEY = "aurea.lab.video.advanced";

/** The part of the screen that holds a render's state. Keyed on a storyboard
 * send so every control re-seeds from the composed shot. */
function Workbench({
  prefill,
  onDetachShot,
  retake,
  setRetake,
  engineId,
  setEngineId,
  takeId,
  setTakeId,
}: {
  prefill: ShotPrefill | null;
  /** stop rendering for the board shot; the settings stay */
  onDetachShot: () => void;
  retake: RetakeDraft | null;
  setRetake: (r: RetakeDraft | null) => void;
  engineId: string;
  setEngineId: (id: string) => void;
  takeId: string;
  setTakeId: (id: string) => void;
}) {
  const p = useVideoParams({ prefill, retake, setRetake, engineId, setEngineId });
  const [advanced, setAdvanced] = useState(() => localStorage.getItem(ADVANCED_KEY) === "1");
  const toggleAdvanced = () =>
    setAdvanced((o) => {
      localStorage.setItem(ADVANCED_KEY, o ? "0" : "1");
      return !o;
    });
  const { picking, setPicking } = p;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PreviewPanel takeId={takeId} onSelect={setTakeId} retake={retake} setRetake={setRetake} />
        <Composer
          p={p}
          advancedOpen={advanced}
          onToggleAdvanced={toggleAdvanced}
          onDetachShot={onDetachShot}
        />
      </div>
      {advanced && <AdvancedDrawer p={p} onClose={toggleAdvanced} />}

      <AbModal
        open={p.abOpen}
        onClose={() => p.setAbOpen(false)}
        engineId={engineId}
        engines={p.lab.engines}
        resolutionsByEngine={p.lab.resolutionsByEngine}
        durations={p.surface.durations}
        disabled={!p.canGenerate || !p.prompt.trim()}
        queueing={p.ab.queueing}
        error={p.ab.error}
        onQueue={(input) => p.ab.queue({ ...input, base: p.payload })}
      />

      {picking !== null && (
        <FramePicker
          frames={p.lab.frames}
          mode={picking === "start" ? "start" : picking === "end" ? "end" : "keyframe"}
          selectedRel={
            picking === "start"
              ? p.effectiveRel
              : picking === "end"
                ? (p.endFrameRel ?? undefined)
                : picking.lane === "director"
                  ? p.keyframes[picking.i]?.image
                  : p.simpleKeyframes[picking.i]?.image
          }
          onPick={(rel) => {
            if (picking === "start") {
              p.setFrameRel(rel);
              // picking a still is asking to start from it
              p.setNoStartFrame(false);
            } else if (picking === "end") p.setEndFrameRel(rel);
            else if (picking.lane === "director") {
              p.setKeyframes((ks) => ks.map((k, j) => (j === picking.i ? { ...k, image: rel } : k)));
            } else {
              p.setSimpleKeyframes((ks) =>
                ks.map((k, j) => (j === picking.i ? { ...k, image: rel } : k)),
              );
            }
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
          importing={p.lab.importingStill}
          onImport={(files) => {
            void p.importStillInto(files, picking).then(() => setPicking(null));
          }}
        />
      )}
    </div>
  );
}

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
  /* "Send to Director" navigates here with the composed shot. The shot stays
   * attached after you leave and come back through the nav (which carries no
   * location state), so a take rendered later still lands on its board shot.
   * A NEW send wipes the workbench draft and seeds it from the shot, before
   * anything below mounts: an effect would run after the panel's initializers
   * had already read the stale draft. Keying the inner screen on the send is
   * what makes a send arriving while this screen is open re-seed too. */
  const sent = (useLocation().state as { shot?: ShotPrefill } | null)?.shot ?? null;
  const sentKey = sent ? `${sent.shotId}:${sent.sentAt}` : null;
  if (sent && sentKey && sentKey !== peekDraft<string>("video:shotKey")) {
    clearDrafts(VIDEO_DRAFT);
    clearDrafts("video:retake");
    writeDraft("video:shotKey", sentKey);
    writeDraft("video:shot", { key: sentKey, shot: sent });
    // a composed shot is an LTX Director spec; a send while MiniMax was on
    // deck would otherwise seed a timeline the chosen engine can't render
    writeDraft("video:engineId", "ltx2");
  }
  return <VideoLabScreen key={peekDraft<string>("video:shotKey") ?? "free"} />;
}

function VideoLabScreen() {
  const lab = useVideoLab();
  const [takeId, setTakeId] = useDraft(
    "video:takeId",
    () => (lab.takes.find((t) => t.selected) ?? lab.takes[0]).id,
  );
  /** a retake is marked on the preview player and rendered from the params
   * panel, so the draft lives here, above both */
  const [retake, setRetake] = useDraft<RetakeDraft | null>("video:retake", null);
  /** lifted out of the params panel so the header can name the engine — and so
   * the choice survives the panel re-keying on a storyboard send */
  const [engineId, setEngineId] = useDraft("video:engineId", lab.engines[0].id);
  const [kept, setKept] = useDraft<{ key: string; shot: ShotPrefill } | null>("video:shot", null);
  const prefill = kept?.shot ?? null;
  const prefillKey = kept?.key ?? null;

  const engine = lab.engines.find((e) => e.id === engineId);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title="Video"
        sub={`${engine?.label ?? engineId} · ${capabilityLine(engineId, lab)}`}
      />
      <Workbench
        key={prefillKey ?? "free"}
        prefill={prefill}
        onDetachShot={() => setKept(null)}
        retake={retake}
        setRetake={setRetake}
        engineId={engineId}
        setEngineId={setEngineId}
        takeId={takeId}
        setTakeId={setTakeId}
      />
    </div>
  );
}
