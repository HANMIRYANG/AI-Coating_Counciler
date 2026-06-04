// Prisma schema contract — text-only readiness checks.
//
// Purpose:
//   Verify that `apps/web/prisma/schema.prisma` can represent the current
//   in-memory `SessionRecord` / `ProviderCallRecord` / `ProviderAttemptRecord`
//   shape. No database connection is required — we read the schema file
//   as text and assert structural invariants.
//
// Cross-cutting checks performed here:
//   1. ProviderAttemptLog model is present.
//   2. ProviderCallLog includes the new fallback / rate-limit / debug fields.
//   3. CouncilSession exposes evidenceMode, deadlineAt, and the two
//      provider-log relations.
//   4. Required indexes exist for recent-session listing and per-session lookups.
//   5. No preview / experimental model name is hard-coded as a default.
//   6. Dual-mode runtime: store.ts defaults to MemorySessionStore but
//      branches to PrismaSessionStore (sibling file) when SESSION_STORE=prisma.
//      store.ts itself does NOT statically import @prisma/client — the
//      Prisma path lives in `prismaSessionStore.ts` and is lazy-required.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SCHEMA_PATH = path.join(__dirname, "../../../../prisma/schema.prisma");
const STORE_PATH = path.join(__dirname, "../store.ts");
const PRISMA_STORE_PATH = path.join(__dirname, "../prismaSessionStore.ts");

const schema = readFileSync(SCHEMA_PATH, "utf8");
const storeSrc = readFileSync(STORE_PATH, "utf8");
const prismaStoreSrc = readFileSync(PRISMA_STORE_PATH, "utf8");

/**
 * Extract the body of a single Prisma model block. Returns the text
 * between the opening `{` and the matching `}` (exclusive). Throws if
 * the block can't be located so a missing model fails loudly.
 */
function modelBody(name: string): string {
  const re = new RegExp(`model\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`, "m");
  const m = schema.match(re);
  if (!m) throw new Error(`model ${name} not found in schema`);
  return m[1];
}

describe("Prisma schema — text contract", () => {
  it("declares the ProviderAttemptLog model", () => {
    expect(schema).toMatch(/model\s+ProviderAttemptLog\s*\{/);
  });

  it("ProviderCallLog carries fallback / rate-limit / debug fields", () => {
    const body = modelBody("ProviderCallLog");
    // Field names are matched as whole identifiers at the start of a
    // schema line (allowing leading whitespace).
    expect(body).toMatch(/^\s*modelRequested\s+String\??/m);
    expect(body).toMatch(/^\s*modelUsed\s+String\??/m);
    expect(body).toMatch(/^\s*rateLimited\s+Boolean/m);
    expect(body).toMatch(/^\s*rawResponse\s+String\?/m);
    expect(body).toMatch(/^\s*parsedResponse\s+Json\?/m);
  });

  it("ProviderAttemptLog covers every ProviderAttemptRecord field", () => {
    const body = modelBody("ProviderAttemptLog");
    for (const field of [
      "sessionId",
      "providerId",
      "round",
      "model",
      "attemptIndex",
      "chainIndex",
      "status",
      "startedAt",
      "endedAt",
      "latencyMs",
      "timeoutMs",
      "errorType",
      "errorMessage",
      "retryAfterMs",
      "rateLimited",
    ]) {
      expect(body).toMatch(new RegExp(`^\\s*${field}\\s+`, "m"));
    }
  });

  it("CouncilSession exposes evidenceMode, deadlineAt, and both provider-log relations", () => {
    const body = modelBody("CouncilSession");
    expect(body).toMatch(/^\s*evidenceMode\s+String/m);
    expect(body).toMatch(/^\s*deadlineAt\s+DateTime/m);
    expect(body).toMatch(/^\s*providerCallLogs\s+ProviderCallLog\[\]/m);
    expect(body).toMatch(
      /^\s*providerAttemptLogs\s+ProviderAttemptLog\[\]/m,
    );
  });

  it("required indexes are declared", () => {
    const sessionBody = modelBody("CouncilSession");
    // Recent-session listing (newest first) — primary access pattern.
    expect(sessionBody).toMatch(/@@index\(\[createdAt\]\)/);
    expect(sessionBody).toMatch(/@@index\(\[status\]\)/);

    const callBody = modelBody("ProviderCallLog");
    // Per-session lookup of provider summaries.
    expect(callBody).toMatch(/@@index\(\[sessionId\]\)/);
    // Provider / round slice.
    expect(callBody).toMatch(/@@index\(\[providerId,\s*round\]\)/);
    // (sessionId, providerId, round) is the upsert key — must be unique.
    expect(callBody).toMatch(
      /@@unique\(\[sessionId,\s*providerId,\s*round\]\)/,
    );

    const attemptBody = modelBody("ProviderAttemptLog");
    expect(attemptBody).toMatch(/@@index\(\[sessionId\]\)/);
    // Operator filters by (provider, round, status).
    expect(attemptBody).toMatch(
      /@@index\(\[providerId,\s*round,\s*status\]\)/,
    );
  });

  it("the schema does not hard-code preview/experimental model defaults", () => {
    // Strip line comments so policy-doc references in comments don't
    // false-positive (none today, but be defensive).
    const codeOnly = schema
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");

    // Any `@default("...preview...")` or `@default("...experimental...")`
    // or `@default("...latest...")` would be a violation. The grep is
    // case-insensitive and scoped to default() string literals.
    const matches = codeOnly.match(/@default\("([^"]*)"\)/g) ?? [];
    for (const lit of matches) {
      expect(lit.toLowerCase()).not.toMatch(/preview/);
      expect(lit.toLowerCase()).not.toMatch(/experimental/);
      expect(lit.toLowerCase()).not.toMatch(/latest/);
    }
  });
});

describe("Runtime persistence wiring — dual mode (memory default, prisma opt-in)", () => {
  it("store.ts does not STATICALLY import @prisma/client", () => {
    // The Prisma backend lives in prismaSessionStore.ts and is loaded via
    // a lazy require() inside getOrCreateGlobalStore — so memory-only code
    // paths never pull @prisma/client into the bundle.
    // Comment references to Prisma are allowed.
    const codeOnly = storeSrc
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(codeOnly).not.toMatch(/^\s*import[^;]*from\s+["']@prisma\/client["']/m);
    expect(codeOnly).not.toMatch(/new\s+PrismaClient/);
    // The Prisma store CLASS lives in a sibling file — store.ts itself
    // must not redefine it.
    expect(codeOnly).not.toMatch(/class\s+PrismaSessionStore/);
  });

  it("getSessionStore() defaults to MemorySessionStore", () => {
    // Default backend (no SESSION_STORE env, or SESSION_STORE=memory) must
    // still resolve to the in-memory implementation. The dual-mode switch
    // lives in selectedBackend() inside store.ts.
    expect(storeSrc).toMatch(/new MemorySessionStore\(\)/);
    expect(storeSrc).toMatch(
      /function\s+selectedBackend\s*\([^)]*\)/,
    );
    expect(storeSrc).toMatch(
      /export function getSessionStore\(\)[\s\S]*?getOrCreateGlobalStore/m,
    );
  });

  it("SESSION_STORE=prisma branch lazy-requires prismaSessionStore", () => {
    // The Prisma path MUST be loaded via require() so it never gets
    // bundled into the memory-only code path. Importing it statically at
    // the top of store.ts would defeat that.
    expect(storeSrc).toMatch(
      /require\(["']\.\/prismaSessionStore["']\)/,
    );
  });

  it("PrismaSessionStore exists and implements the SessionStore interface shape", () => {
    expect(prismaStoreSrc).toMatch(/export class PrismaSessionStore/);
    // Every SessionStore method must be present on the Prisma backend.
    for (const method of [
      "create",
      "get",
      "update",
      "upsertProviderCall",
      "appendOpinion",
      "appendCritique",
      "appendAttempt",
      "listRecent",
    ]) {
      // `async name(` or `name(` at method position — be lenient on async.
      expect(prismaStoreSrc).toMatch(
        new RegExp(`(?:async\\s+)?${method}\\s*\\(`),
      );
    }
  });

  it("persists the canonical full final-answer payload for ALL answer kinds", () => {
    // `payload` must be written unconditionally (the full answer), so fields
    // without a dedicated column — e.g. retrievalGuard — survive a round-trip.
    expect(prismaStoreSrc).toMatch(
      /payload:\s*fa as unknown as Prisma\.InputJsonValue/,
    );
    // Standard reconstruction prefers the canonical payload.
    expect(prismaStoreSrc).toMatch(/FinalAnswerSchema\.parse\(r\.payload\)/);
    // Regression guard: payload must NOT be set to DbNull conditionally on the
    // "standard" answerKind (the original bug that dropped retrievalGuard).
    expect(prismaStoreSrc).not.toMatch(
      /payload:[\s\S]{0,120}answerKind === "standard"[\s\S]{0,40}Prisma\.DbNull/,
    );
  });

  it("schema documents `payload` as the canonical full final-answer payload", () => {
    const body = modelBody("FinalAnswer");
    expect(body.toLowerCase()).toMatch(/canonical full final-answer payload/);
  });

  it("PrismaSessionStore.appendAttempt is fire-and-forget", () => {
    // The forensic attempt log must not block the orchestrator. The
    // implementation must use `void this.client...create(...)` rather
    // than awaiting the create call.
    expect(prismaStoreSrc).toMatch(
      /void\s+this\.client\.providerAttemptLog\s*\n?\s*\.create/m,
    );
  });
});
