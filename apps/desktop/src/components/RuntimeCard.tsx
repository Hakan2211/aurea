import { Check, Download, Pause } from "lucide-react";
import { useRuntime } from "@/hooks";
import { Chip, GhostButton, GoldButton, Progress } from "@/components/ui";

/* The managed engine runtime (portable Python + headless ComfyUI) as one
 * card — status chips per component, live install progress streamed from
 * studiod, and the install/cancel controls. Shared by the first-run wizard
 * and Settings → Engines. */

export function RuntimeCard() {
  const { status, live, install, cancel } = useRuntime();

  if (!live || !status) {
    return (
      <div className="rounded-2xl border hairline bg-raised/50 p-4 text-[12px] text-fog">
        Waiting for the studio core…
      </div>
    );
  }

  const installing = status.installing;
  const failed = status.components.find((c) => c.state === "error");

  return (
    <div className="rounded-2xl border hairline bg-raised/50">
      <div className="flex items-center gap-3 px-4 pt-3.5">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-cream">Managed engine runtime</div>
          <div className="mt-0.5 text-[10px] text-fog">
            A private Python, headless ComfyUI and voice engine inside your data root — no system
            installs.
          </div>
        </div>
        {status.ready ? (
          <Chip tone="sage" className="shrink-0 text-[10px]">
            <Check size={10} /> Ready
          </Chip>
        ) : installing ? (
          <GhostButton onClick={cancel}>
            <Pause size={12} /> Cancel
          </GhostButton>
        ) : (
          <GoldButton onClick={install}>
            <Download size={12} /> {failed ? "Retry install" : "Install"}
          </GoldButton>
        )}
      </div>
      <div className="mt-2 divide-y divide-cream/6">
        {status.components.map((c) => (
          <div key={c.id} className="px-4 py-2.5">
            <div className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-[12px] text-cream/90">{c.name}</span>
              <span className="min-w-0 flex-1 truncate text-[10px] tabular-nums text-fog">
                {c.state === "installing"
                  ? (c.stage ?? "Installing…")
                  : c.state === "ready"
                    ? c.version
                    : c.state === "error"
                      ? "install failed"
                      : `${c.pinned} · not installed`}
              </span>
              {c.state === "ready" && (
                <Check size={12} className="shrink-0 text-[#9db89d]" strokeWidth={2.5} />
              )}
              {c.state === "installing" && (
                <span className="shrink-0 text-[10px] tabular-nums text-fog">
                  {Math.round(c.progress)}%
                </span>
              )}
            </div>
            {c.state === "installing" && (
              <div className="mt-1.5">
                <Progress value={c.progress} />
                {c.detail && (
                  <div className="mt-1 truncate text-[9px] tabular-nums text-fog/70">
                    {c.detail}
                  </div>
                )}
              </div>
            )}
            {c.state === "error" && c.error && (
              <div className="mt-1 text-[10px] text-[#e07a6b]">{c.error}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
