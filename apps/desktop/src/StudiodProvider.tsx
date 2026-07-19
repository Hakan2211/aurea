/* Connects the renderer to studiod: asks the Electron bridge for {port, token},
 * builds the tRPC client (HTTP batch for queries/mutations, WS for
 * subscriptions), and mounts the single LiveSync subscriber that keeps the
 * query cache streaming. In a plain browser tab (no bridge) the client points
 * at a dead port and every hook serves its sample-data placeholder instead. */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createWSClient, httpBatchLink, splitLink, wsLink } from "@trpc/client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { trpc } from "@/trpc";

interface Coords {
  port: number;
  token: string;
}

/** unreachable on purpose — queries fail fast and placeholder data stays up */
const DEAD: Coords = { port: 1, token: "" };

const CoordsContext = createContext<Coords | null>(null);

/** Absolute-URL builder for studiod's /media routes (img/video tags can't set
 * auth headers, so the token rides in the query string). Null without a live
 * core — callers fall back to swatch placeholders. */
export function useMediaBase(): ((route: string) => string) | null {
  const coords = useContext(CoordsContext);
  if (!coords || coords === DEAD) return null;
  return (route) => `http://127.0.0.1:${coords.port}${route}?token=${encodeURIComponent(coords.token)}`;
}

interface Clients {
  queryClient: QueryClient;
  trpcClient: ReturnType<typeof trpc.createClient>;
  coords: Coords;
}

function buildClients(coords: Coords): Clients {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
        // subscriptions push updates via setData; no polling needed
        staleTime: Infinity,
      },
    },
  });

  const wsClient = createWSClient({
    url: `ws://127.0.0.1:${coords.port}`,
    connectionParams: { token: coords.token },
    retryDelayMs: (attempt) => Math.min(30_000, 1_000 * 2 ** attempt),
    // every (re)connection refetches everything — a studiod restart under a
    // live renderer must not leave stale caches (library, projects, settings)
    onOpen: () => void queryClient.invalidateQueries(),
  });

  const trpcClient = trpc.createClient({
    links: [
      splitLink({
        condition: (op) => op.type === "subscription",
        true: wsLink({ client: wsClient }),
        false: httpBatchLink({
          url: `http://127.0.0.1:${coords.port}`,
          headers: { authorization: `Bearer ${coords.token}` },
        }),
      }),
    ],
  });

  return { queryClient, trpcClient, coords };
}

/** One subscriber per stream for the whole app — screens read the cache. */
function LiveSync() {
  const utils = trpc.useUtils();
  const finishedCount = useRef(-1);

  trpc.jobs.onSnapshot.useSubscription(undefined, {
    onData: (jobs) => {
      utils.jobs.list.setData(undefined, jobs);
      // a job finishing may have imported an asset — rescan library + project metas
      const finished = jobs.filter((j) => j.status === "completed" || j.status === "failed").length;
      if (finishedCount.current !== -1 && finished !== finishedCount.current) {
        void utils.library.invalidate();
        void utils.projects.invalidate();
      }
      finishedCount.current = finished;
    },
  });

  trpc.system.onVram.useSubscription(undefined, {
    onData: (vram) => utils.system.vram.setData(undefined, vram),
  });

  trpc.models.onUpdate.useSubscription(undefined, {
    onData: (models) => utils.models.list.setData(undefined, models),
  });

  // production.json/bible.json saves from ANY writer (Director tools, external
  // MCP session, another window) — refetch so open studio screens converge
  trpc.studio.onUpdate.useSubscription(undefined, {
    onData: (event) => {
      if (event.doc === "production") {
        void utils.studio.production.get.invalidate({ project: event.project });
      } else {
        void utils.studio.bible.get.invalidate({ project: event.project });
      }
    },
  });

  trpc.runtime.onUpdate.useSubscription(undefined, {
    onData: (status) => utils.runtime.status.setData(undefined, status),
  });

  return null;
}

/** dev only: a plain browser tab can pin live studiod coords with
 * #/screen?studiod=<port>:<token> (values from ~/.aurea/studiod.json) — the
 * full live renderer without Electron, for headless dev and UI verification */
function devCoords(): Coords | null {
  if (!import.meta.env.DEV) return null;
  const m = /[?&]studiod=(\d+):([\w-]+)/.exec(window.location.hash);
  return m ? { port: Number(m[1]), token: m[2] } : null;
}

export function StudiodProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<Clients | null>(null);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const coords =
        devCoords() ?? (await window.aurea?.studiod().catch(() => null)) ?? DEAD;
      if (disposed) return;
      setClients(buildClients(coords));
    })();
    return () => {
      disposed = true;
    };
  }, []);

  // a frame or two while the bridge answers; the window isn't shown yet anyway
  if (!clients) return null;

  return (
    <CoordsContext.Provider value={clients.coords === DEAD ? null : clients.coords}>
      <trpc.Provider client={clients.trpcClient} queryClient={clients.queryClient}>
        <QueryClientProvider client={clients.queryClient}>
          <LiveSync />
          {children}
        </QueryClientProvider>
      </trpc.Provider>
    </CoordsContext.Provider>
  );
}
