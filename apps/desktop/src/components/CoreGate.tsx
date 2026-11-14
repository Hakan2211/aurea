/* What a project screen shows before it has a project to show (UI-SIMPLIFY
 * Stage 4) — the replacement for the bare "Waiting for the studio core…".
 *
 * Three different nothings, and they must never look alike:
 *  - the core isn't answering: say so, say nothing is lost, offer a retry;
 *  - the core answers but there's no project: offer to make one;
 *  - the project is still loading: a quiet line, no buttons to mis-click.
 * Every state names what the screen is FOR, so the empty pane still teaches. */

import { useNavigate } from "react-router";
import { FolderPlus, Loader2, PlugZap, RotateCw, Settings, type LucideIcon } from "lucide-react";
import { useJobs, useProjects } from "@/hooks";
import { trpc } from "@/trpc";
import { EmptyState, GhostButton, GoldButton } from "@/components/ui";

export function CoreGate(props: Parameters<typeof Gate>[0]) {
  // a full-height flex box of its own: callers mount it in flex rows, flex
  // columns and plain blocks, and it must centre in all three
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <Gate {...props} />
    </div>
  );
}

function Gate({
  screen,
  purpose,
  icon,
}: {
  /** the screen's name, as the tab strip shows it */
  screen: string;
  /** one sentence: what you do here once it's open */
  purpose: string;
  icon?: LucideIcon;
}) {
  const { live } = useJobs();
  const { projects } = useProjects();
  const utils = trpc.useUtils();
  const navigate = useNavigate();

  if (!live) {
    return (
      <EmptyState
        icon={PlugZap}
        title="The studio core isn't answering"
        action={
          <GoldButton onClick={() => void utils.invalidate()}>
            <RotateCw size={13} /> Try again
          </GoldButton>
        }
        secondary={
          <GhostButton onClick={() => navigate("/settings")}>
            <Settings size={13} /> Settings
          </GhostButton>
        }
      >
        <p>{purpose}</p>
        <p className="mt-2">
          {screen} opens as soon as the core is back. Nothing is lost: your project lives on disk,
          and Aurea reconnects on its own when the core restarts.
        </p>
      </EmptyState>
    );
  }

  if (projects.length === 0) {
    return (
      <EmptyState
        icon={icon ?? FolderPlus}
        title="No project yet"
        action={
          <GoldButton onClick={() => navigate("/")}>
            <FolderPlus size={13} /> Create a project
          </GoldButton>
        }
      >
        {purpose} Start a project on Home and it opens here.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center gap-2 text-sm text-fog">
      <Loader2 size={14} className="animate-spin text-gold/70" /> Opening {screen.toLowerCase()}…
    </div>
  );
}
