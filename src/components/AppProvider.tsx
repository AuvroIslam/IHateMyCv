'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { api } from '@/lib/client-api';
import type { AppStateResponse, CareerLibrary, DesignSpec } from '@/types/cv';

interface AppContextValue extends AppStateResponse {
  /** True only while an explicit refresh is in flight. */
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  saveLibrary: (next: { library?: CareerLibrary; design?: DesignSpec }) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

/**
 * State is handed down from the server layout, so there is no fetch-on-mount
 * and no loading flash. After that the client owns it, refreshing only when it
 * has changed something.
 */
export function AppProvider({
  initial,
  children,
}: {
  initial: AppStateResponse;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<AppStateResponse>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setState(await api.getLibrary());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your information.');
    } finally {
      setLoading(false);
    }
  }, []);

  const saveLibrary = useCallback(
    async (next: { library?: CareerLibrary; design?: DesignSpec }) => {
      // Applied locally first: the editor is the source of truth while the user
      // is working, and waiting on a round-trip would make the forms feel laggy.
      setState((s) => ({
        ...s,
        library: next.library ?? s.library,
        design: next.design ?? s.design,
      }));
      await api.saveLibrary(next);
      await refresh();
    },
    [refresh],
  );

  const value = useMemo<AppContextValue>(
    () => ({ ...state, loading, error, refresh, saveLibrary }),
    [state, loading, error, refresh, saveLibrary],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>.');
  return ctx;
}
