// Timeout / cancellation helpers.
//
// withTimeout wraps a promise so that:
//   - if it resolves before `timeoutMs`, the result passes through;
//   - if `timeoutMs` elapses first, it rejects with TimeoutError and signals
//     the provided AbortController so the underlying work can be cancelled.
//
// This is the cornerstone of avoiding "the whole session freezes because one
// provider hung". Every provider call is wrapped with this utility, and each
// round runs its providers via Promise.allSettled — so a hang in one branch
// never blocks the others.

export class TimeoutError extends Error {
  constructor(public timeoutMs: number, public label?: string) {
    super(
      label
        ? `${label} timed out after ${timeoutMs}ms`
        : `Operation timed out after ${timeoutMs}ms`,
    );
    this.name = "TimeoutError";
  }
}

export type WithTimeoutOptions = {
  timeoutMs: number;
  label?: string;
  /**
   * If supplied, abort() is called when the timer fires. Providers should
   * forward this AbortSignal to their underlying fetch / SDK call so the
   * connection is actually closed (not just abandoned in JS).
   */
  abortController?: AbortController;
};

export function withTimeout<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  opts: WithTimeoutOptions,
): Promise<T> {
  const controller = opts.abortController ?? new AbortController();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(opts.timeoutMs, opts.label));
    }, opts.timeoutMs);
  });

  const work = (async () => {
    try {
      return await factory(controller.signal);
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();

  return Promise.race([work, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const handle = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(handle);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}
