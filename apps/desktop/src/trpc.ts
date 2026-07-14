import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@aurea/core";

/** Typed client for the studiod surface — end-to-end types, no codegen. */
export const trpc = createTRPCReact<AppRouter>();
