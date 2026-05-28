// Runs the Playwright E2E suite against a Next dev server that THIS script
// owns. We do not let Playwright manage the dev server because its
// webServer teardown is unreliable on Windows — tests pass, then the
// process hangs without printing the final summary.
//
// Lifecycle:
//   1. If port 3000 already responds, reuse it and skip the spawn.
//   2. Otherwise spawn `node <repo>/node_modules/next/dist/bin/next dev`
//      directly (no npm.cmd wrapper, no shell). Wait until the URL
//      responds with any HTTP status.
//   3. Run Playwright with E2E_SERVER_EXTERNAL=1 so its config disables
//      its own webServer block.
//   4. Always tear the spawned process tree down with `taskkill /T /F`
//      (Windows) or SIGTERM to the process group (POSIX). Exit with
//      Playwright's exit code.

import { spawn, spawnSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPS_WEB = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(APPS_WEB, "..", "..");
const NEXT_BIN = path.join(
  REPO_ROOT,
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);
const PLAYWRIGHT_CLI = path.join(
  REPO_ROOT,
  "node_modules",
  "@playwright",
  "test",
  "cli.js",
);

const HOST = "127.0.0.1";
const PORT = 3000;
const URL_ROOT = `http://${HOST}:${PORT}`;
const READY_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 500;
const PING_TIMEOUT_MS = 2_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pingOnce() {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      URL_ROOT,
      { method: "GET", timeout: PING_TIMEOUT_MS },
      (res) => {
        res.resume();
        resolve();
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("ping timeout")));
    req.end();
  });
}

async function isUp() {
  try {
    await pingOnce();
    return true;
  } catch {
    return false;
  }
}

async function waitForReady(deadlineMs) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (await isUp()) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Next dev server did not respond at ${URL_ROOT} within ${deadlineMs}ms`,
  );
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    try {
      // The child was spawned with detached:true on POSIX, so its pid is
      // also its process-group id. Sending SIGTERM to -pid signals the
      // entire group, taking down the Next dev server together with any
      // workers / swc helper it spawned. Without detached:true this would
      // fail (no such group) or target the runner's own group.
      process.kill(-pid, "SIGTERM");
    } catch {
      // Best-effort cleanup; ignore if the group already exited.
    }
  }
}

async function main() {
  const reuseExisting = await isUp();
  let server = null;
  if (!reuseExisting) {
    server = spawn(
      process.execPath,
      [NEXT_BIN, "dev", "-H", HOST, "-p", String(PORT)],
      {
        cwd: APPS_WEB,
        stdio: ["ignore", "ignore", "ignore"],
        windowsHide: true,
        // POSIX: make the child its own process-group leader so killTree()
        // can take down the whole tree via process.kill(-pid). On Windows
        // this flag would open a new console, so leave it off there;
        // taskkill /T /F handles tree cleanup instead.
        detached: process.platform !== "win32",
      },
    );
    server.on("error", (err) => {
      console.error("[run-e2e] failed to spawn next dev:", err);
    });
    // Don't let the spawned (and now possibly detached) child keep the
    // runner alive; we manage its lifetime explicitly via killTree().
    server.unref();
    // If the runner itself is interrupted (Ctrl+C, SIGTERM), still tear
    // down the dev server. Detached children would otherwise leak.
    for (const sig of ["SIGINT", "SIGTERM"]) {
      process.once(sig, () => {
        killTree(server?.pid);
        process.exit(130);
      });
    }
  }

  let exitCode = 1;
  try {
    await waitForReady(READY_TIMEOUT_MS);
    const result = spawnSync(
      process.execPath,
      [PLAYWRIGHT_CLI, "test"],
      {
        cwd: APPS_WEB,
        stdio: "inherit",
        env: { ...process.env, E2E_SERVER_EXTERNAL: "1" },
      },
    );
    exitCode = typeof result.status === "number" ? result.status : 1;
  } finally {
    killTree(server?.pid);
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
