export type JsonRecord = Record<string, unknown>;

export interface ActivaStorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { ex?: number }): Promise<void>;
  del(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zrem(key: string, member: string): Promise<number>;
  zcount(key: string, min: number | string, max: number | string): Promise<number>;
  zrangeByScore(key: string, min: number | string, max: number | string): Promise<string[]>;
  zremrangeByScore(key: string, min: number | string, max: number | string): Promise<number>;
  sadd(key: string, member: string): Promise<number>;
  scard(key: string): Promise<number>;
  hincrby(key: string, field: string, increment: number): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  lpush(key: string, value: string): Promise<number>;
  ltrim(key: string, start: number, end: number): Promise<void>;
  lrange(key: string, start: number, end: number): Promise<string[]>;
  xadd(key: string, fields: Record<string, string>, options?: { maxLen?: number }): Promise<string>;
  xread(key: string, cursor: string, options?: { count?: number }): Promise<ActivaStreamRecord[]>;
  xrevrange(key: string, options?: { count?: number }): Promise<ActivaStreamRecord[]>;
}

export interface ActivaStreamRecord {
  id: string;
  fields: Record<string, string>;
}

export interface UpstashRedisConfig {
  url: string;
  token: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  retry?: {
    attempts?: number;
    backoffMs?: number;
  };
}

export interface PresencePayload {
  userId: string;
  roomId: string;
  sessionId?: string | null;
  metadata?: JsonRecord | null;
  now?: number;
}

export interface PresenceState {
  online: boolean;
  userId: string;
  roomId: string;
  sessionId: string | null;
  metadata: JsonRecord | null;
  joinedAt: number;
  lastSeenAt: number | null;
}

export interface SessionStartPayload {
  userId: string;
  roomId: string;
  sessionId?: string;
  path?: string | null;
  href?: string | null;
  metadata?: JsonRecord | null;
  startedAt?: number;
  now?: number;
}

export interface SessionEventPayload {
  userId: string;
  roomId: string;
  sessionId?: string;
  type?: string;
  event?: string;
  name?: string;
  path?: string | null;
  href?: string | null;
  x?: number | null;
  y?: number | null;
  metadata?: JsonRecord | null;
  occurredAt?: number;
  now?: number;
}

export interface SessionEndPayload {
  userId: string;
  roomId: string;
  sessionId: string;
  endedAt?: number;
  now?: number;
}

export interface SessionRecord {
  sessionId: string;
  userId: string;
  roomId: string;
  path: string | null;
  href: string | null;
  startedAt: number;
  lastSeenAt: number;
  endedAt: number | null;
  metadata: JsonRecord | null;
}

export interface ActiveUsersQuery {
  roomId: string;
  from?: number | string;
  to?: number | string;
  bucketMs?: number | string;
}

export interface AnalyticsPoint {
  timestamp: number;
  count: number;
}

export interface HeatmapQuery extends ActiveUsersQuery {
  cellSize?: number | string;
}

export interface HeatmapCell {
  cellX: number;
  cellY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  count: number;
}

export interface RecentEventsQuery {
  roomId: string;
  limit?: number | string;
}

export type ActivaLiveEventType =
  | 'presence.join'
  | 'presence.leave'
  | 'session.start'
  | 'session.event'
  | 'session.end';

export interface ActivaLiveEvent {
  streamId: string;
  roomId: string;
  type: ActivaLiveEventType;
  userId: string;
  sessionId: string | null;
  occurredAt: number;
  count?: number;
  eventName?: string | null;
  path?: string | null;
  href?: string | null;
  x?: number | null;
  y?: number | null;
  metadata?: JsonRecord | null;
}

export type ActivaStreamEnvelope =
  | { kind: 'ready'; roomId: string; cursor: string; timestamp: number }
  | { kind: 'keepalive'; roomId: string; timestamp: number }
  | { kind: 'event'; roomId: string; event: ActivaLiveEvent };

export interface SubscribeToActivaStreamOptions {
  endpoint: string;
  roomId: string;
  transport?: 'sse' | 'websocket';
  cursor?: string;
  onEnvelope: (envelope: ActivaStreamEnvelope) => void;
  onError?: (error: Event | Error) => void;
}

export interface ActivaBrowserClientOptions {
  endpoint?: string;
  userId: string | (() => string);
  roomId?: string | (() => string);
  sessionId?: string;
  heartbeatIntervalMs?: number;
  autoTrack?: boolean;
  autoTrackClicks?: boolean;
  headers?: Record<string, string>;
  metadata?: JsonRecord | null;
  fetch?: typeof fetch;
}

export interface ActivaHttpClientOptions {
  endpoint?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

export interface ActivaClientSnapshot {
  started: boolean;
  sessionId: string;
  userId: string | null;
  roomId: string | null;
}

export interface ActivaOptions {
  namespace?: string;
  redis: ActivaStorageAdapter | UpstashRedisConfig;
  presenceTtlMs?: number;
  heartbeatIntervalMs?: number;
  heatmapBucketMs?: number;
  heatmapCellSize?: number;
  analyticsRetentionSeconds?: number;
  sessionTtlSeconds?: number;
  recentEventLimit?: number;
  liveStreamMaxLen?: number;
}

export interface ResolvedActivaOptions {
  namespace: string;
  presenceTtlMs: number;
  heartbeatIntervalMs: number;
  heatmapBucketMs: number;
  heatmapCellSize: number;
  analyticsRetentionSeconds: number;
  sessionTtlSeconds: number;
  recentEventLimit: number;
  liveStreamMaxLen: number;
}

export interface ActivaInstance {
  config: ResolvedActivaOptions;
  storage: ActivaStorageAdapter;
  presence: {
    join(payload: PresencePayload): Promise<PresenceState>;
    heartbeat(payload: PresencePayload): Promise<PresenceState>;
    leave(payload: PresencePayload): Promise<PresenceState>;
    isOnline(roomId: string, userId: string): Promise<PresenceState>;
    getCount(roomId: string): Promise<number>;
    list(roomId: string): Promise<PresenceState[]>;
    snapshot(roomId: string): Promise<{ roomId: string; count: number; users: PresenceState[] }>;
  };
  session: {
    start(payload: SessionStartPayload): Promise<SessionRecord>;
    event(payload: SessionEventPayload): Promise<SessionEventPayload & { occurredAt: number; sessionId: string; name: string; type: string }>;
    end(payload: SessionEndPayload): Promise<SessionRecord>;
    get(sessionId: string): Promise<SessionRecord | null>;
  };
  analytics: {
    track(payload: SessionEventPayload): Promise<SessionEventPayload & { occurredAt: number; sessionId: string; name: string; type: string }>;
    getCurrentActiveUsers(roomId: string): Promise<number>;
    getActiveUsersSeries(payload: ActiveUsersQuery): Promise<{ roomId: string; from: number; to: number; bucketMs: number; points: AnalyticsPoint[] }>;
    getHeatmap(payload: HeatmapQuery): Promise<{ roomId: string; from: number; to: number; bucketMs: number; cellSize: number; cells: HeatmapCell[] }>;
    getRecentEvents(roomId: string, limit?: number): Promise<Array<Record<string, unknown>>>;
  };
  live: {
    resolveCursor(roomId: string, cursor?: string): Promise<string>;
    read(roomId: string, cursor: string, options?: { count?: number }): Promise<ActivaLiveEvent[]>;
  };
}
