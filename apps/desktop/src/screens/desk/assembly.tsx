/* "Assemble scene" (N1.1): the confirm half of plan → execute. The dialog
 * shows the plan the server would run — per shot, what will be voiced,
 * boarded, rendered (in which lane) or laid on the cut, what is already done
 * or in the queue, and what is blocked and why — plus a rough GPU estimate.
 * One deliberate click starts the batch; the same dialog then follows it.
 * Calls the same procedures as the scene_assemble_plan / scene_assemble
 * tools. The gates stay human: "through" picks where the run stops. */

import { SelectBox } from "@/components/ui/SelectBox";
import { useState } from "react";
import { crewVerb, type AssemblyStep, type AssemblyThrough, type Scene } from "@aurea/shared";
import { GhostButton, GoldButton, Modal, ModalHeader, cx } from "@/components/ui";
import { useSceneAssembly, useVideoPresets } from "@/hooks";
import { sectionLabel, selectInput } from "../studio/shared";

const THROUGH: Array<{ id: AssemblyThrough; label: string; hint: string }> = [
  { id: "board", label: "Voice + boards", hint: "Stops at gate 1 — review the boards before any render" },
  { id: "render", label: "…and render", hint: "Renders shots whose boards and voices are in; stops at gate 2" },
  { id: "cut", label: "…and lay the cut", hint: "Also lays APPROVED takes in script order — never approves" },
];

const STATUS_TONE: Record<AssemblyStep["status"], string> = {
  todo: "text-gold",
  queued: "text-gold",
  inflight: "text-violet-300",
  done: "text-fog",
  completed: "text-sage",
  later: "text-fog",
  blocked: "text-[#f0a89d]",
  failed: "text-[#f0a89d]",
  skipped: "text-[#f0a89d]",
};

const KIND_LABEL: Record<AssemblyStep["kind"], string> = { voice: "Voice", board: "Board", render: "Render", cut: "Cut" };

const mins = (sec: number) => (sec < 60 ? `${sec}s` : `~${Math.round(sec / 60)} min`);

export function AssembleDialog({ scene, onClose }: { scene: Scene | null; onClose: () => void }) {
  const [through, setThrough] = useState<AssemblyThrough>("board");
  const [lane, setLane] = useState("");
  const lanes = useVideoPresets();
  const asm = useSceneAssembly(scene?.id ?? null, { through, lane });

  const running = asm.batch?.status === "running" ? asm.batch : null;
  // while a batch runs, show its live steps; otherwise the plan
  const steps = running?.steps ?? asm.plan?.steps ?? [];
  const todo = asm.plan?.steps.filter((s) => s.status === "todo").length ?? 0;
  const byShot = new Map<string, AssemblyStep[]>();
  for (const s of steps) byShot.set(s.shotId, [...(byShot.get(s.shotId) ?? []), s]);

  return (
    <Modal open={!!scene} onClose={onClose} size="lg">
      <ModalHeader
        title={`${crewVerb("scene_assemble").title} — ${scene?.slugline || "scene"}`}
        sub="Only the work each shot is missing. Re-running is the resume."
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className={sectionLabel}>Run through</p>
            <SelectBox
              value={through}
              disabled={!!running}
              onChange={(e) => setThrough(e.target.value as AssemblyThrough)}
              className={cx(selectInput, "mt-1.5 w-full")}
            >
              {THROUGH.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </SelectBox>
            <p className="mt-1 text-2xs text-fog">{THROUGH.find((t) => t.id === through)?.hint}</p>
          </div>
          <div>
            <p className={sectionLabel}>Lane</p>
            <SelectBox
              value={lane}
              disabled={!!running}
              onChange={(e) => setLane(e.target.value)}
              className={cx(selectInput, "mt-1.5 w-full")}
            >
              <option value="">Per shot, by who speaks</option>
              {lanes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </SelectBox>
            <p className="mt-1 text-2xs text-fog">Nobody → B-roll · one voice → interview · a conversation → coverage</p>
          </div>
        </div>

        {asm.planError && <p className="text-xs text-[#f0a89d]">{asm.planError}</p>}
        {!asm.plan && !asm.planError && <p className="text-xs text-fog">Planning…</p>}

        {[...byShot.entries()].map(([shotId, shotSteps]) => (
          <div key={shotId} className="rounded-xl border hairline bg-surface/50 p-3">
            <p className="truncate text-sm text-cream">{shotSteps[0].shotTitle}</p>
            <ul className="mt-1 space-y-0.5">
              {shotSteps.map((s) => (
                <li key={s.id} className="flex items-baseline gap-2 text-xs">
                  <span className="w-12 shrink-0 text-fog">{KIND_LABEL[s.kind]}</span>
                  <span className={cx("w-16 shrink-0 font-mono text-2xs", STATUS_TONE[s.status])}>{s.status}</span>
                  <span className="min-w-0 truncate text-fog">
                    {s.kind === "voice" && s.lineIds?.length ? `${s.lineIds.length} line${s.lineIds.length === 1 ? "" : "s"}` : ""}
                    {s.kind === "render" && s.lane ? s.lane : ""}
                    {s.kind === "board" && s.aspect ? s.aspect : ""}
                    {s.reason ? ` · ${s.reason}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {!running && asm.plan?.notes.map((n, i) => (
          <p key={i} className="text-2xs leading-snug text-fog">
            · {n}
          </p>
        ))}
        {asm.batch && asm.batch.status !== "running" && asm.batch.summary && (
          <p className="text-xs text-sage">Last run ({asm.batch.status}): {asm.batch.summary}</p>
        )}
        {asm.startError && <p className="text-xs text-[#f0a89d]">{asm.startError}</p>}
      </div>
      <footer className="flex shrink-0 items-center gap-2 border-t hairline px-5 py-3">
        <span className="text-2xs text-fog">
          {running
            ? `Running — ${running.phase}. Jobs carry batch ${running.id}.`
            : asm.plan
              ? todo
                ? `${todo} step${todo === 1 ? "" : "s"} to queue · ${mins(asm.plan.estSec)} of GPU (rough)`
                : "Nothing to queue for this run."
              : ""}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {running && <GhostButton onClick={() => void asm.cancel(running.id)}>Cancel batch</GhostButton>}
          <GhostButton onClick={onClose}>Close</GhostButton>
          <GoldButton onClick={() => void asm.start().catch(() => undefined)} disabled={!!running || asm.starting || !todo}>
            {asm.starting ? "Starting…" : crewVerb("scene_assemble").title}
          </GoldButton>
        </span>
      </footer>
    </Modal>
  );
}
