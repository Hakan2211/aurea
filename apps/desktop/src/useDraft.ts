import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

/* Composer drafts that outlive their screen.
 *
 * Renders run in the engine, not in the screen that queued them, but the
 * composers kept their settings in plain component state, so leaving a lab
 * mid-render reset the prompt, model, aspect and refs. You had to sit on the
 * screen until the run finished. A draft is useState backed by a module-level
 * map: it survives route changes for the life of the window and is gone on
 * reload. Use it for what you are composing, not for transient UI like open
 * menus or confirm states. */

const drafts = new Map<string, unknown>();

export function useDraft<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (drafts.has(key)) return drafts.get(key) as T;
    const first = typeof initial === "function" ? (initial as () => T)() : initial;
    drafts.set(key, first);
    return first;
  });
  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) =>
      setValue((prev) => {
        const resolved =
          typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
        drafts.set(key, resolved);
        return resolved;
      }),
    [key],
  );
  return [value, set];
}

/** Drop every draft under `prefix`, so the next mount seeds from its
 * initializers again. For a screen that is handed a new thing to work on,
 * like a shot sent from the storyboard, which must not inherit the last draft. */
export function clearDrafts(prefix: string) {
  for (const key of [...drafts.keys()]) if (key.startsWith(prefix)) drafts.delete(key);
}

/** Read a draft without subscribing to it */
export function peekDraft<T>(key: string): T | undefined {
  return drafts.get(key) as T | undefined;
}

/** Set a draft from outside a component. Mounted readers do not see it; call
 * it before the screen that reads it mounts, or re-key that screen. */
export function writeDraft<T>(key: string, value: T) {
  drafts.set(key, value);
}
