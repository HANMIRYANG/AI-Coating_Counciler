// PrismaClient singleton.
//
// Next.js dev mode hot-reloads modules; without globalThis caching, every
// HMR cycle would leak a new PrismaClient and quickly exhaust DB
// connections. The pattern below is the official Prisma recommendation
// for Next.js — one client per Node process, shared across hot reloads.
//
// Production: regular module-level instantiation is fine, but we still
// route through getPrismaClient() so callers don't depend on the choice.

import { PrismaClient } from "@prisma/client";

const KEY = "__ai_coating_council_prisma_client__";

function createClient(): PrismaClient {
  return new PrismaClient({
    // `error` + `warn` only — `query` is too noisy for normal dev. Flip via
    // PRISMA_LOG=query if a session needs SQL inspection.
    log:
      process.env.PRISMA_LOG === "query"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });
}

export function getPrismaClient(): PrismaClient {
  const g = globalThis as Record<string, unknown>;
  if (!g[KEY]) g[KEY] = createClient();
  return g[KEY] as PrismaClient;
}
