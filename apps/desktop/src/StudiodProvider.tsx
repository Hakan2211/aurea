/* Connects the renderer to studiod: asks the Electron bridge for {port, token},
 * builds the tRPC client (HTTP batch for queries/mutations, WS for
 * subscriptions), and mounts the single LiveSync subscriber that keeps the
 * query cache streaming. In a plain browser tab (no bridge) the client points
 * at a dead port and every hook serves its sample-data placeholder instead. */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createWSClient, httpBatchLink, splitLink, wsLink } from "@trpc/client";
import { useEffect, useState, type ReactNode } from "react";
import { trpc } from "@/trpc";

interface Coords {
  port: number;
  token: string;
}

/** unreachable on purpose — queries fail fast and placeholder data stays up */
const DEAD: Coords = { port: 1, token: "" };

interface Clients {
  queryClient: QueryClient;
  trpcClient: ReturnType<typeof trpc.createClient>;
}

function buildClients(coords: Coords): Clients {
  const wsClient = createWSClient({
    url: `ws://127.0.0.1:${coords.port}`,
    connectionParams: { token: coords.token },
    retryDelayMs: (attempt) => Math.min(30_000, 1_000 * 2 ** attempt),
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

  return { queryClient, trpcClient };
}

/** One subscriber per stream for the whole app — screens read the cache. */
function LiveSync() {
  const utils = trpc.useUtils();

  trpc.jobs.onSnapshot.useSubscription(undefined, {
    onData: (jobs) => utils.jobs.list.setData(undefined, jobs),
  });

  trpc.system.onVram.useSubscription(undefined, {
    onData: (vram) => utils.system.vram.setData(undefined, vram),
  });

  return null;
}

export function StudiodProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<Clients | null>(null);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const coords = (await window.aurea?.studiod().catch(() => null)) ?? DEAD;
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
    <trpc.Provider client={clients.trpcClient} queryClient={clients.queryClient}>
      <QueryClientProvider client={clients.queryClient}>
        <LiveSync />
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
