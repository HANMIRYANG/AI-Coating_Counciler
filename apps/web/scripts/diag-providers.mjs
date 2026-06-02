// Provider connectivity diagnostic. Bypasses the orchestrator/limiter and hits
// each provider's HTTP API ONCE with a tiny payload + a short timeout, then
// prints the raw HTTP status + a snippet of the body. This pinpoints whether a
// stuck call is a model-id error (404/400), an auth error (401), or a network
// hang (timeout) — independent of all app logic.
//
//   node scripts/diag-providers.mjs
//
// Reads keys + models from apps/web/.env (no secrets are printed).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, "..", ".env");

function loadEnv(path) {
  const out = {};
  let txt = "";
  try {
    txt = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const env = { ...loadEnv(envPath), ...process.env };
const TIMEOUT_MS = 15000;

const OPENAI_MODEL = env.OPENAI_HIGH_ACCURACY_MODEL || "gpt-5.5";
const ANTHROPIC_MODEL = env.ANTHROPIC_HIGH_ACCURACY_MODEL || "claude-opus-4-8";
const GEMINI_MODEL = env.GEMINI_HIGH_ACCURACY_MODEL || "gemini-2.5-pro";

function mask(k) {
  if (!k) return "(missing)";
  return `${k.slice(0, 6)}…(${k.length} chars)`;
}

async function timed(label, fn) {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const { status, body } = await fn(controller.signal);
    console.log(
      `\n=== ${label} ===\nHTTP ${status}  (${Date.now() - t0}ms)\n${String(
        body,
      ).slice(0, 600)}`,
    );
  } catch (e) {
    const reason =
      e?.name === "AbortError"
        ? `TIMEOUT after ${TIMEOUT_MS}ms (no response — likely network/firewall)`
        : `${e?.name ?? "Error"}: ${e?.message ?? e}`;
    console.log(`\n=== ${label} ===\nFAILED (${Date.now() - t0}ms)\n${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

console.log("Provider diagnostic — keys:");
console.log(`  OPENAI_API_KEY    = ${mask(env.OPENAI_API_KEY)}  model=${OPENAI_MODEL}`);
console.log(`  ANTHROPIC_API_KEY = ${mask(env.ANTHROPIC_API_KEY)}  model=${ANTHROPIC_MODEL}`);
console.log(`  GEMINI_API_KEY    = ${mask(env.GEMINI_API_KEY)}  model=${GEMINI_MODEL}`);

await timed("OpenAI", async (signal) => {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENAI_API_KEY ?? ""}`,
    },
    body: JSON.stringify({
      // EXACTLY what the app's adapter sends (no max_tokens).
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: "Reply with a JSON object {\"ok\":true}." },
        { role: "user", content: "ping" },
      ],
      response_format: { type: "json_object" },
    }),
  });
  return { status: res.status, body: await res.text() };
});

await timed("Anthropic", async (signal) => {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 5,
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  return { status: res.status, body: await res.text() };
});

await timed("Gemini", async (signal) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY ?? ""}`;
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: "ping" }] }],
      generationConfig: { maxOutputTokens: 5 },
    }),
  });
  return { status: res.status, body: await res.text() };
});

// Probe an alternative Gemini model that often has free-tier quota.
await timed("Gemini (gemini-2.5-flash fallback)", async (signal) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY ?? ""}`;
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: "ping" }] }],
      generationConfig: { maxOutputTokens: 5 },
    }),
  });
  return { status: res.status, body: await res.text() };
});

console.log("\nDone.");
