import { useMemo } from "react";
import { trpc } from "@/trpc";
import type {
  PromptDeck,
  PromptDeckSave,
  PromptPreset,
  PromptPresetSave,
  StylePack,
} from "@aurea/shared";

/* Thin typed wrappers over the prompts.* tRPC surface (Track B). They live
 * here rather than in hooks.ts because that file is another workstream's
 * territory — the seam is identical: query + invalidate-on-write. */

/** The project new work lands in — same rule as hooks.ts useActiveProjectId
 * (the switcher's active project is the first in the list), re-derived here
 * because that helper isn't exported and hooks.ts is off-limits. */
export function useActivePromptProject(): string | undefined {
  const list = trpc.projects.list.useQuery().data;
  return list?.[0]?.id;
}

/** Presets + packs visible to the active project, and the write verbs.
 * Everything invalidates the whole prompts namespace — the library is tiny
 * (dozens of files), so precision caching buys nothing but staleness bugs. */
export function usePromptLibrary() {
  const project = useActivePromptProject();
  const utils = trpc.useUtils();
  const invalidate = { onSuccess: () => void utils.prompts.invalidate() };

  const presetsQuery = trpc.prompts.list.useQuery({ project });
  const packsQuery = trpc.prompts.packs.useQuery({ project });
  const saveMutation = trpc.prompts.save.useMutation(invalidate);
  const removeMutation = trpc.prompts.remove.useMutation(invalidate);

  const presets: PromptPreset[] = useMemo(() => presetsQuery.data ?? [], [presetsQuery.data]);
  const packs: StylePack[] = useMemo(() => packsQuery.data ?? [], [packsQuery.data]);

  return {
    project,
    presets,
    packs,
    loading: presetsQuery.isLoading || packsQuery.isLoading,
    save: (input: PromptPresetSave) => saveMutation.mutate(input),
    saving: saveMutation.isPending,
    saveError: saveMutation.error?.message ?? null,
    remove: (id: string) => removeMutation.mutate({ id }),
    removing: removeMutation.isPending,
  };
}

/** Persisted decks — the Image lab's bulk prompt lists. save is async so the
 * caller can capture the server-assigned id after the first autosave. */
export function usePromptDecks() {
  const utils = trpc.useUtils();
  const invalidate = { onSuccess: () => void utils.prompts.deckList.invalidate() };

  const listQuery = trpc.prompts.deckList.useQuery();
  const saveMutation = trpc.prompts.deckSave.useMutation(invalidate);
  const removeMutation = trpc.prompts.deckRemove.useMutation(invalidate);

  const decks: PromptDeck[] = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  return {
    decks,
    /** the list has actually arrived — load-newest must wait for this, or an
     * empty placeholder would shadow a deck that exists on disk */
    ready: !listQuery.isLoading,
    save: (input: PromptDeckSave): Promise<PromptDeck> => saveMutation.mutateAsync(input),
    saving: saveMutation.isPending,
    saveError: saveMutation.error?.message ?? null,
    remove: (id: string) => removeMutation.mutate({ id }),
  };
}

/** One-shot agent expansion of a prompt. Kept as a bare mutation wrapper —
 * the button owns the accept/undo lifecycle; this only owns the wire. */
export function usePromptEnhance() {
  const mutation = trpc.prompts.enhance.useMutation();
  return {
    enhance: (prompt: string, projectId: string | undefined, intent: "image" | "video") =>
      mutation.mutateAsync({ prompt, projectId, intent }),
    running: mutation.isPending,
    error: mutation.error?.message ?? null,
    reset: () => mutation.reset(),
  };
}
