// Vercel-safe "run work after the HTTP response" helper.
//
// The council orchestration is kicked off in the background after the create/
// start routes return the session id (the client then polls for status). A
// bare `void promise` is fine in a long-lived Node process (local dev,
// `next start`, tests) but is UNSAFE on Vercel serverless: once the response
// is flushed the function can be frozen/terminated, killing the in-flight
// orchestration.
//
// Vercel exposes a per-request `waitUntil` through its request-context global
// (the same mechanism `@vercel/functions` reads). We access it directly so we
// don't take on a new dependency. When that context is absent — local dev,
// `next start`, unit tests, any non-Vercel host — we fall back to `void`,
// which works because the process stays alive.
//
// Next 14.2.18 here does NOT export `unstable_after` from `next/server`
// (added in a later release), so this is the supported background mechanism
// for this version.

// Vercel's request context is stored on globalThis under this well-known
// symbol; `.get()` returns an object exposing `waitUntil`.
const VERCEL_REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

type VercelRequestContext = {
  get?: () => { waitUntil?: (promise: Promise<unknown>) => void } | undefined;
};

/**
 * Schedule `task` to run after the response. On Vercel the function lifetime
 * is extended (bounded by the route's `maxDuration`) until the task settles;
 * elsewhere it runs in-process. Background rejections are swallowed + logged
 * so they never surface as unhandled rejections — callers (the orchestrator)
 * already persist their own failures onto the session record.
 */
export function runAfterResponse(task: Promise<unknown>): void {
  const guarded = Promise.resolve(task).catch((err) => {
    console.error("[runAfterResponse] background task failed", err);
  });

  try {
    const ctx = (globalThis as Record<symbol, unknown>)[
      VERCEL_REQUEST_CONTEXT
    ] as VercelRequestContext | undefined;
    const waitUntil = ctx?.get?.()?.waitUntil;
    if (typeof waitUntil === "function") {
      waitUntil(guarded);
      return;
    }
  } catch {
    // Fall through to the in-process path.
  }

  void guarded;
}
