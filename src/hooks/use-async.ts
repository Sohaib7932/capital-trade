"use client";

import { useEffect, useState } from "react";

interface AsyncResult<T> {
  /** Latest data for the current `deps` (or the previous ones, see `keepPreviousData`). */
  data: T | undefined;
  error: Error | undefined;
  /** True while a request for the current `deps` is in flight. */
  loading: boolean;
  /** Re-run the request with the same deps. */
  reload: () => void;
}

interface Settled<T> {
  key: string;
  data?: T;
  error?: Error;
}

/**
 * Run an async API call and track its result. Re-runs when any value in
 * `deps` changes. With `keepPreviousData`, old data stays visible while the
 * next request loads (use it on pages that reload after a mutation).
 */
export function useAsync<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[],
  options: { keepPreviousData?: boolean; enabled?: boolean } = {},
): AsyncResult<T> {
  const { keepPreviousData = false, enabled = true } = options;
  const [version, setVersion] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const key = JSON.stringify([...deps, version]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetcher().then(
      (data) => {
        if (active) setSettled({ key, data });
      },
      (error: unknown) => {
        if (active) {
          setSettled({ key, error: error instanceof Error ? error : new Error(String(error)) });
        }
      },
    );
    return () => {
      active = false;
    };
    // `fetcher` is recreated every render; `key` captures what it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  const current = settled?.key === key;
  return {
    data: current || keepPreviousData ? settled?.data : undefined,
    error: current ? settled?.error : undefined,
    loading: enabled && !current,
    reload: () => setVersion((v) => v + 1),
  };
}
