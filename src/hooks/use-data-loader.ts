"use client";

import { useEffect, useRef } from "react";

/**
 * Deferred data loader for mount/dep-change fetching.
 * Runs `load` asynchronously (setTimeout 0) so effects never trigger
 * synchronous setState cascades, and optionally re-runs on an interval
 * (e.g. live dashboards). Pass `key` values via the deps array.
 */
export function useDataLoader(load: () => Promise<void>, deps: unknown[] = [], intervalMs?: number) {
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const depsKey = JSON.stringify(deps);
  useEffect(() => {
    const t = setTimeout(() => void loadRef.current(), 0);
    let interval: ReturnType<typeof setInterval> | undefined;
    if (intervalMs && intervalMs > 0) {
      interval = setInterval(() => void loadRef.current(), intervalMs);
    }
    return () => {
      clearTimeout(t);
      if (interval) clearInterval(interval);
    };
  }, [depsKey, intervalMs]);
}
