import { useState } from "react";
import { useNavigate } from "react-router";
import { BLEND_KEY, useFormatRuns, useFormats, type FormatRunResult } from "@/hooks";
import { Gallery } from "./formats/gallery";
import { CreatePanel } from "./formats/create";
import { BlendPanel } from "./formats/blend";
import { RunPreview } from "./formats/shared";

/* Formats — the videofast recipes, live. Built to
 * design-refs/2026-08-06-ui-mockups/formats-v2.jpg with v1's grafts (larger
 * serif poster titles, the checkmark on the selected tile); the intuitiveness
 * plan it implements is route-merge doc §3.
 *
 * Pick a format, give it the one thing that format asks for, and either
 * enqueue the pipeline (the primary) or hand the brief to the Director chat
 * (the escape hatch). Runs report back on the tile they came from. */

export function Formats() {
  const navigate = useNavigate();
  const { formats } = useFormats();
  const runs = useFormatRuns();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<FormatRunResult | null>(null);

  const selected = formats.find((f) => f.id === selectedId) ?? null;

  const createWithAi = () => {
    navigate("/", {
      state: {
        seed: {
          text:
            "I want to make a social-media short but haven't picked a format yet. " +
            "Walk me through the videofast formats, help me match one to my idea, " +
            "then launch create_video once we've agreed on a topic and style pack.",
          sentAt: Date.now(),
        },
      },
    });
  };

  return (
    <div className="flex h-full">
      <Gallery
        formats={formats}
        selectedId={selectedId}
        runs={runs}
        onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))}
        onBlend={() => setSelectedId((prev) => (prev === BLEND_KEY ? null : BLEND_KEY))}
        onCreateWithAi={createWithAi}
        onPlay={setPreview}
      />

      {selectedId === BLEND_KEY ? (
        <BlendPanel runs={runs.get(BLEND_KEY)} onClose={() => setSelectedId(null)} />
      ) : (
        selected && (
          <CreatePanel
            key={selected.id}
            format={selected}
            runs={runs.get(selected.id)}
            onClose={() => setSelectedId(null)}
          />
        )
      )}

      <RunPreview run={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
