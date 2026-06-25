import { useCallback, useEffect, useRef, useState } from "react";

interface AsyncState<T> {
  data: T | null;
  error: { status: number; detail: string } | null;
  loading: boolean;
  refresh: () => void;
}

export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [state, setState] = useState<Omit<AsyncState<T>, "refresh">>({
    data: null,
    error: null,
    loading: true,
  });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let active = true;
    setState({ data: null, error: null, loading: true });
    loader()
      .then((data) => active && setState({ data, error: null, loading: false }))
      .catch((err) => active && setState({ data: null, error: err, loading: false }));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { ...state, refresh };
}

export function useAsyncFn<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>
): { run: (...args: Args) => Promise<R | null>; loading: boolean; error: string | null } {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (...args: Args): Promise<R | null> => {
    setLoading(true);
    setError(null);
    try {
      const result = await fnRef.current(...args);
      setLoading(false);
      return result;
    } catch (e: any) {
      setError(e?.detail ?? "An error occurred");
      setLoading(false);
      return null;
    }
  }, []);

  return { run, loading, error };
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const h = diff / 3600000;
  if (h < 1) return `${Math.floor(diff / 60000)}m ago`;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function formatHours(h: number | null | undefined): string {
  if (h == null) return "--";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${Math.round(h / 24)}d`;
}

export function urgencyColor(score: number): string {
  if (score >= 90) return "#ef4444";
  if (score >= 70) return "#f97316";
  if (score >= 50) return "#f59e0b";
  if (score >= 25) return "#84cc16";
  return "#4b5563";
}
