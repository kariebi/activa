import { useCallback, useEffect, useMemo, useState } from 'react';
import { createActivaHttpClient, subscribeToActivaStream } from './http-client';
import type {
  ActivaLiveEvent,
  ActivaStreamEnvelope,
  ActiveUsersQuery,
  HeatmapCell,
  HeatmapQuery,
  PresenceState,
  SubscribeToActivaStreamOptions
} from './types';

interface PollingState<T> {
  data: T;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<T>;
}

function usePolling<T>(loader: () => Promise<T>, initialValue: T, options: { enabled?: boolean; intervalMs?: number }): PollingState<T> {
  const enabled = options.enabled ?? true;
  const intervalMs = options.intervalMs ?? 5_000;
  const [data, setData] = useState<T>(initialValue);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      return initialValue;
    }

    setLoading(true);
    try {
      const next = await loader();
      setData(next);
      setError(null);
      return next;
    } catch (loaderError) {
      setError(loaderError as Error);
      throw loaderError;
    } finally {
      setLoading(false);
    }
  }, [enabled, initialValue, loader]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }

    void refresh().catch(() => {});
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, intervalMs);

    return () => clearInterval(timer);
  }, [enabled, intervalMs, refresh]);

  return useMemo(
    () => ({
      data,
      loading,
      error,
      refresh
    }),
    [data, error, loading, refresh]
  );
}

export function usePresence(options: { endpoint?: string; roomId: string; userId: string; pollIntervalMs?: number; enabled?: boolean }) {
  const client = useMemo(() => createActivaHttpClient({ endpoint: options.endpoint ?? '/activaq' }), [options.endpoint]);
  const loader = useCallback(() => client.presence.status(options.roomId, options.userId) as Promise<PresenceState>, [client, options.roomId, options.userId]);
  const state = usePolling(loader, {
    online: false,
    roomId: options.roomId,
    userId: options.userId,
    sessionId: null,
    metadata: null,
    joinedAt: 0,
    lastSeenAt: null
  } satisfies PresenceState, {
    enabled: options.enabled ?? Boolean(options.roomId && options.userId),
    intervalMs: options.pollIntervalMs ?? 10_000
  });

  return {
    ...state,
    online: Boolean(state.data.online),
    lastSeenAt: state.data.lastSeenAt
  };
}

export function useActiveUsers(options: { endpoint?: string; roomId: string; pollIntervalMs?: number; enabled?: boolean }) {
  const client = useMemo(() => createActivaHttpClient({ endpoint: options.endpoint ?? '/activaq' }), [options.endpoint]);
  const loader = useCallback(() => client.presence.count(options.roomId), [client, options.roomId]);
  const state = usePolling(loader, { roomId: options.roomId, count: 0 }, {
    enabled: options.enabled ?? Boolean(options.roomId),
    intervalMs: options.pollIntervalMs ?? 5_000
  });

  return {
    ...state,
    count: state.data.count
  };
}

export function usePresenceSnapshot(options: { endpoint?: string; roomId: string; pollIntervalMs?: number; enabled?: boolean }) {
  const client = useMemo(() => createActivaHttpClient({ endpoint: options.endpoint ?? '/activaq' }), [options.endpoint]);
  const loader = useCallback(() => client.presence.snapshot(options.roomId), [client, options.roomId]);
  return usePolling(loader, { roomId: options.roomId, count: 0, users: [] as PresenceState[] }, {
    enabled: options.enabled ?? Boolean(options.roomId),
    intervalMs: options.pollIntervalMs ?? 7_500
  });
}

export function useActiveUsersSeries(options: { endpoint?: string; query: ActiveUsersQuery; pollIntervalMs?: number; enabled?: boolean }) {
  const client = useMemo(() => createActivaHttpClient({ endpoint: options.endpoint ?? '/activaq' }), [options.endpoint]);
  const loader = useCallback(() => client.analytics.activeUsersSeries(options.query), [client, options.query]);
  return usePolling(loader, {
    roomId: options.query.roomId,
    from: Number(options.query.from ?? 0),
    to: Number(options.query.to ?? 0),
    bucketMs: Number(options.query.bucketMs ?? 0),
    points: [] as Array<{ timestamp: number; count: number }>
  }, {
    enabled: options.enabled ?? Boolean(options.query.roomId),
    intervalMs: options.pollIntervalMs ?? 15_000
  });
}

export function useHeatmap(options: { endpoint?: string; query: HeatmapQuery; pollIntervalMs?: number; enabled?: boolean }) {
  const client = useMemo(() => createActivaHttpClient({ endpoint: options.endpoint ?? '/activaq' }), [options.endpoint]);
  const loader = useCallback(() => client.analytics.heatmap(options.query), [client, options.query]);
  const state = usePolling(loader, {
    roomId: options.query.roomId,
    from: Number(options.query.from ?? 0),
    to: Number(options.query.to ?? 0),
    bucketMs: Number(options.query.bucketMs ?? 0),
    cellSize: Number(options.query.cellSize ?? 0),
    cells: [] as HeatmapCell[]
  }, {
    enabled: options.enabled ?? Boolean(options.query.roomId),
    intervalMs: options.pollIntervalMs ?? 15_000
  });

  return {
    ...state,
    cells: state.data.cells
  };
}

export function useRecentEvents(options: { endpoint?: string; roomId: string; limit?: number; pollIntervalMs?: number; enabled?: boolean }) {
  const client = useMemo(() => createActivaHttpClient({ endpoint: options.endpoint ?? '/activaq' }), [options.endpoint]);
  const loader = useCallback(() => client.analytics.events(options.roomId, options.limit ?? 20), [client, options.limit, options.roomId]);
  return usePolling(loader, [] as Array<Record<string, unknown>>, {
    enabled: options.enabled ?? Boolean(options.roomId),
    intervalMs: options.pollIntervalMs ?? 12_000
  });
}

export function useActivaStream(options: Omit<SubscribeToActivaStreamOptions, 'onEnvelope'> & { enabled?: boolean }) {
  const [envelopes, setEnvelopes] = useState<ActivaStreamEnvelope[]>([]);
  const [lastEvent, setLastEvent] = useState<ActivaLiveEvent | null>(null);
  const [error, setError] = useState<Error | Event | null>(null);
  const { enabled = true, endpoint, roomId, transport, cursor, onError } = options;

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    return subscribeToActivaStream({
      endpoint,
      roomId,
      ...(transport ? { transport } : {}),
      ...(cursor ? { cursor } : {}),
      onEnvelope(envelope) {
        setEnvelopes((current) => [...current.slice(-49), envelope]);
        if (envelope.kind === 'event') {
          setLastEvent(envelope.event);
        }
      },
      onError(nextError) {
        setError(nextError);
        onError?.(nextError);
      }
    });
  }, [cursor, enabled, endpoint, onError, roomId, transport]);

  return {
    envelopes,
    lastEvent,
    error
  };
}
