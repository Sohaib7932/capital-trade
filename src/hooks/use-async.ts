"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";

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

/** Fired by the "Retry" button of the load-error toast: every hook that failed loads again. */
const RETRY_EVENT = "capitaltrade:retry-load";
const LOAD_ERROR_TOAST = "load-error";

function announceLoadError(error: Error): void {
  // 401 already redirects to sign-in.
  if (error instanceof ApiError && error.status === 401) return;
  toast.error("Couldn't load some data", {
    id: LOAD_ERROR_TOAST, // one toast, however many requests failed
    description: error.message,
    duration: Infinity,
    action: { label: "Retry", onClick: () => window.dispatchEvent(new Event(RETRY_EVENT)) },
  });
}

/**
 * Run an async API call and track its result. Re-runs when any value in
 * `deps` changes. With `keepPreviousData`, old data stays visible while the
 * next request loads (use it on pages that reload after a mutation).
 *
 * Failures are never silent: they show a toast with a Retry button (reads are
 * already retried automatically by the API client before that).
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
        if (!active) return;
        const err = error instanceof Error ? error : new Error(String(error));
        setSettled({ key, error: err });
        announceLoadError(err);
      },
    );
    return () => {
      active = false;
    };
    // `fetcher` is recreated every render; `key` captures what it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  const current = settled?.key === key;
  const failed = current && settled?.error !== undefined;

  // While failed, reload when the user presses Retry on the toast.
  useEffect(() => {
    if (!failed) return;
    const retry = () => {
      toast.dismiss(LOAD_ERROR_TOAST);
      setVersion((v) => v + 1);
    };
    window.addEventListener(RETRY_EVENT, retry);
    return () => window.removeEventListener(RETRY_EVENT, retry);
  }, [failed]);

  return {
    data: current || keepPreviousData ? settled?.data : undefined,
    error: current ? settled?.error : undefined,
    loading: enabled && !current,
    reload: () => setVersion((v) => v + 1),
  };
}
