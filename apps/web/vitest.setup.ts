// Test-suite determinism guard.
//
// The unit suite must never make real provider / embedding API calls — they are
// slow, non-deterministic, and cost money. A developer's shell may set
// USE_MOCK_PROVIDERS=false + real keys for manual real-provider work; without
// this, `buildEmbedder()` / `buildProviderRegistry()` would pick the live
// OpenAI path and (e.g.) DocumentService.create would hit the network mid-test.
//
// Force mock here so the suite is byte-stable regardless of the ambient env.
// The opt-in real-provider smoke path (REAL_PROVIDER_SMOKE=true, see
// real_provider_smoke.test.ts) is left untouched so it can still exercise live
// adapters on demand.
if (process.env.REAL_PROVIDER_SMOKE !== "true") {
  process.env.USE_MOCK_PROVIDERS = "true";
}

// Vitest loads apps/web/.env into process.env. A developer's .env may set
// SESSION_STORE=prisma + a real DATABASE_URL (Neon) for local/prod parity —
// which would push getSessionStore() onto the Prisma backend and make unit
// tests hit a real database. Force the in-memory store unless a test explicitly
// opts into the Prisma integration suite (PRISMA_INTEGRATION=1).
if (process.env.PRISMA_INTEGRATION !== "1") {
  process.env.SESSION_STORE = "memory";
}
