import { fromJson } from './serde';
import type {
  ActivaHttpClientOptions,
  ActivaLiveEvent,
  ActivaStreamEnvelope,
  ActiveUsersQuery,
  HeatmapQuery,
  HeatmapCell,
  PresencePayload,
  PresenceState,
  SessionRecord,
  SessionEndPayload,
  SessionEventPayload,
  SessionStartPayload,
  SubscribeToActivaStreamOptions
} from './types';

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

function withQuery(path: string, query: Record<string, string | number | undefined>) {
  const url = new URL(`https://activaq.local${path.startsWith('/') ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return `${url.pathname}${url.search}`;
}

async function parseResponse<T>(response: Response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Activaq request failed with status ${response.status}: ${text}`);
  }

  const payload = fromJson<{ ok?: boolean; data?: T; error?: string }>(text, {});
  if (payload.ok === false) {
    throw new Error(payload.error || 'Activaq request failed');
  }

  return (payload.data ?? payload) as T;
}

function toWebSocketUrl(url: string) {
  if (url.startsWith('https://')) {
    return `wss://${url.slice('https://'.length)}`;
  }
  if (url.startsWith('http://')) {
    return `ws://${url.slice('http://'.length)}`;
  }
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${url.startsWith('/') ? url : `/${url}`}`;
  }
  return url;
}

export function createActivaHttpClient(options: ActivaHttpClientOptions = {}) {
  const endpoint = options.endpoint ?? '/activaq';
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new Error('Activaq HTTP client requires fetch.');
  }

  async function get<T>(path: string) {
    const response = await fetchImpl(joinUrl(endpoint, path), {
      method: 'GET',
      headers: {
        ...options.headers
      }
    });
    return parseResponse<T>(response as Response);
  }

  async function post<T>(path: string, body: unknown, init?: { keepalive?: boolean }) {
    const response = await fetchImpl(joinUrl(endpoint, path), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...options.headers
      },
      body: JSON.stringify(body),
      ...(init?.keepalive !== undefined ? { keepalive: init.keepalive } : {})
    });
    return parseResponse<T>(response as Response);
  }

  return {
    presence: {
      join(payload: PresencePayload) {
        return post<PresenceState>('/presence/join', payload);
      },
      heartbeat(payload: PresencePayload) {
        return post<PresenceState>('/presence/heartbeat', payload);
      },
      leave(payload: PresencePayload, init?: { keepalive?: boolean }) {
        return post<PresenceState>('/presence/leave', payload, init);
      },
      status(roomId: string, userId: string) {
        return get<PresenceState>(withQuery('/presence/status', { roomId, userId }));
      },
      count(roomId: string) {
        return get<{ roomId: string; count: number }>(withQuery('/presence/count', { roomId }));
      },
      snapshot(roomId: string) {
        return get<{ roomId: string; count: number; users: PresenceState[] }>(withQuery('/presence/list', { roomId }));
      }
    },
    session: {
      start(payload: SessionStartPayload) {
        return post<SessionRecord>('/session/start', payload);
      },
      event(payload: SessionEventPayload) {
        return post<SessionEventPayload & { occurredAt: number; sessionId: string; name: string; type: string }>('/session/event', payload);
      },
      end(payload: SessionEndPayload, init?: { keepalive?: boolean }) {
        return post<SessionRecord>('/session/end', payload, init);
      }
    },
    analytics: {
      activeUsersSeries(payload: ActiveUsersQuery) {
        return get<{ roomId: string; from: number; to: number; bucketMs: number; points: Array<{ timestamp: number; count: number }> }>(withQuery('/analytics/active', {
          roomId: payload.roomId,
          from: payload.from as string | number | undefined,
          to: payload.to as string | number | undefined,
          bucketMs: payload.bucketMs as string | number | undefined
        }));
      },
      heatmap(payload: HeatmapQuery) {
        return get<{ roomId: string; from: number; to: number; bucketMs: number; cellSize: number; cells: HeatmapCell[] }>(withQuery('/analytics/heatmap', {
          roomId: payload.roomId,
          from: payload.from as string | number | undefined,
          to: payload.to as string | number | undefined,
          bucketMs: payload.bucketMs as string | number | undefined,
          cellSize: payload.cellSize as string | number | undefined
        }));
      },
      events(roomId: string, limit = 50) {
        return get<Array<Record<string, unknown>>>(withQuery('/analytics/events', { roomId, limit }));
      }
    }
  };
}

export function subscribeToActivaStream(options: SubscribeToActivaStreamOptions) {
  const endpoint = options.endpoint.replace(/\/+$/, '');
  const cursor = options.cursor ?? '$';

  if (options.transport === 'websocket') {
    const url = new URL(toWebSocketUrl(joinUrl(endpoint, '/stream/ws')));
    url.searchParams.set('roomId', options.roomId);
    url.searchParams.set('cursor', cursor);
    const socket = new WebSocket(url.toString());

    socket.addEventListener('message', (event) => {
      const envelope = fromJson<ActivaStreamEnvelope | null>(String(event.data), null);
      if (envelope) {
        options.onEnvelope(envelope);
      }
    });
    socket.addEventListener('error', (error) => {
      options.onError?.(error);
    });

    return () => socket.close();
  }

  const url = new URL(joinUrl(endpoint, '/stream/sse'), typeof window !== 'undefined' ? window.location.href : 'http://localhost');
  url.searchParams.set('roomId', options.roomId);
  url.searchParams.set('cursor', cursor);
  const source = new EventSource(url.toString());

  source.onmessage = (event) => {
    const envelope = fromJson<ActivaStreamEnvelope | null>(event.data, null);
    if (envelope) {
      options.onEnvelope(envelope);
    }
  };
  source.onerror = (error) => {
    options.onError?.(error);
  };

  return () => source.close();
}

export type { ActivaLiveEvent };
export const createActivaqHttpClient = createActivaHttpClient;
export const subscribeToActivaqStream = subscribeToActivaStream;
