import { buildKeys } from './keys';
import { fromJson, toJson } from './serde';
import { normalizeStorageAdapter } from './storage';
import type {
  ActivaInstance,
  ActivaLiveEvent,
  ActivaOptions,
  ActiveUsersQuery,
  HeatmapQuery,
  JsonRecord,
  PresencePayload,
  PresenceState,
  ResolvedActivaOptions,
  SessionEndPayload,
  SessionEventPayload,
  SessionRecord,
  SessionStartPayload
} from './types';

const DEFAULTS: ResolvedActivaOptions = {
  namespace: 'activa',
  presenceTtlMs: 30_000,
  heartbeatIntervalMs: 10_000,
  heatmapBucketMs: 300_000,
  heatmapCellSize: 24,
  analyticsRetentionSeconds: 60 * 60 * 24 * 14,
  sessionTtlSeconds: 60 * 60 * 24,
  recentEventLimit: 250,
  liveStreamMaxLen: 1_000
};

function assertRequired<T>(value: T | null | undefined | '', label: string): T {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required field: ${label}`);
  }
  return value as T;
}

function createId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `activa_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function clampNumber(value: number | string | undefined, fallback: number) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function currentTime(value?: number) {
  return typeof value === 'number' ? value : Date.now();
}

function bucketStart(timestamp: number, bucketMs: number) {
  return Math.floor(timestamp / bucketMs) * bucketMs;
}

function sequence(start: number, end: number, step: number) {
  const values: number[] = [];
  for (let cursor = start; cursor <= end; cursor += step) {
    values.push(cursor);
  }
  return values;
}

function normalizeListRange(limit: number) {
  return Math.max(0, limit - 1);
}

function toStreamFields(event: Omit<ActivaLiveEvent, 'streamId'>) {
  return {
    type: event.type,
    payload: toJson(event)
  };
}

function ensureJsonRecord(value: JsonRecord | null | undefined) {
  return value ?? null;
}

export function createActiva(options: ActivaOptions): ActivaInstance {
  const config: ResolvedActivaOptions = {
    ...DEFAULTS,
    ...options
  };
  const storage = normalizeStorageAdapter(options.redis);

  async function cleanupRoom(roomId: string, now = Date.now()) {
    const cutoff = now - config.presenceTtlMs;
    const keys = buildKeys(config.namespace, roomId);
    await storage.zremrangeByScore(assertRequired(keys.presenceRoom, 'presenceRoom'), '-inf', cutoff);
  }

  async function readPresence(roomId: string, userId: string) {
    const keys = buildKeys(config.namespace, roomId, userId);
    const raw = await storage.get(assertRequired(keys.presence, 'presenceKey'));
    return fromJson<Omit<PresenceState, 'online'>>(raw, {
      userId,
      roomId,
      sessionId: null,
      metadata: null,
      joinedAt: 0,
      lastSeenAt: null
    });
  }

  async function writePresence(payload: PresencePayload, now: number) {
    const userId = assertRequired(payload.userId, 'userId');
    const roomId = assertRequired(payload.roomId, 'roomId');
    const keys = buildKeys(config.namespace, roomId, userId);
    const ttlSeconds = Math.max(1, Math.ceil(config.presenceTtlMs / 1000));
    const existing = (await storage.get(assertRequired(keys.presence, 'presenceKey'))) ?? null;
    const parsedExisting = fromJson<Omit<PresenceState, 'online'>>(existing, {
      userId,
      roomId,
      sessionId: null,
      metadata: null,
      joinedAt: now,
      lastSeenAt: now
    });

    const next = {
      userId,
      roomId,
      sessionId: payload.sessionId ?? parsedExisting.sessionId ?? null,
      metadata: ensureJsonRecord(payload.metadata ?? parsedExisting.metadata),
      joinedAt: parsedExisting.joinedAt || now,
      lastSeenAt: now
    };

    await storage.set(assertRequired(keys.presence, 'presenceKey'), toJson(next), { ex: ttlSeconds });
    await storage.zadd(assertRequired(keys.presenceRoom, 'presenceRoom'), now, userId);
    await storage.expire(assertRequired(keys.presenceRoom, 'presenceRoom'), ttlSeconds * 4);
    await cleanupRoom(roomId, now);
    return next;
  }

  async function readSession(sessionId: string) {
    const keys = buildKeys(config.namespace, null, null, sessionId);
    const raw = await storage.get(assertRequired(keys.session, 'sessionKey'));
    return raw ? fromJson<SessionRecord | null>(raw, null) : null;
  }

  async function writeSession(session: SessionRecord) {
    const keys = buildKeys(config.namespace, session.roomId, null, session.sessionId);
    await storage.set(assertRequired(keys.session, 'sessionKey'), toJson(session), { ex: config.sessionTtlSeconds });
    await storage.zadd(assertRequired(keys.sessionRoom, 'sessionRoom'), session.startedAt, session.sessionId);
    await storage.expire(assertRequired(keys.sessionRoom, 'sessionRoom'), config.sessionTtlSeconds);
    return session;
  }

  async function recordActiveBucket(roomId: string, userId: string, now: number) {
    const bucket = bucketStart(now, config.heatmapBucketMs);
    const keys = buildKeys(config.namespace, roomId, null, null, bucket);
    await storage.sadd(assertRequired(keys.activeBucket, 'activeBucket'), userId);
    await storage.expire(assertRequired(keys.activeBucket, 'activeBucket'), config.analyticsRetentionSeconds);
  }

  async function recordHeatmapPoint(roomId: string, now: number, point: { x?: number | null; y?: number | null }) {
    if (typeof point.x !== 'number' || typeof point.y !== 'number') {
      return;
    }

    const bucket = bucketStart(now, config.heatmapBucketMs);
    const keys = buildKeys(config.namespace, roomId, null, null, bucket);
    const cellX = Math.floor(point.x / config.heatmapCellSize);
    const cellY = Math.floor(point.y / config.heatmapCellSize);
    const field = `${cellX}:${cellY}`;

    await storage.hincrby(assertRequired(keys.heatmap, 'heatmapKey'), field, 1);
    await storage.expire(assertRequired(keys.heatmap, 'heatmapKey'), config.analyticsRetentionSeconds);
  }

  async function pushRecentEvent(roomId: string, event: Record<string, unknown>) {
    const keys = buildKeys(config.namespace, roomId);
    await storage.lpush(assertRequired(keys.events, 'eventsKey'), toJson(event));
    await storage.ltrim(assertRequired(keys.events, 'eventsKey'), 0, normalizeListRange(config.recentEventLimit));
    await storage.expire(assertRequired(keys.events, 'eventsKey'), config.analyticsRetentionSeconds);
  }

  async function publishLive(roomId: string, event: Omit<ActivaLiveEvent, 'streamId'>) {
    const keys = buildKeys(config.namespace, roomId);
    const streamId = await storage.xadd(assertRequired(keys.liveStream, 'liveStreamKey'), toStreamFields(event), {
      maxLen: config.liveStreamMaxLen
    });
    await storage.expire(assertRequired(keys.liveStream, 'liveStreamKey'), config.analyticsRetentionSeconds);
    return {
      ...event,
      streamId
    } satisfies ActivaLiveEvent;
  }

  const presence = {
    async join(payload: PresencePayload) {
      const now = currentTime(payload.now);
      const next = await writePresence(payload, now);
      const count = await presence.getCount(payload.roomId);
      await publishLive(payload.roomId, {
        roomId: payload.roomId,
        type: 'presence.join',
        userId: payload.userId,
        sessionId: payload.sessionId ?? null,
        occurredAt: now,
        count,
        metadata: ensureJsonRecord(payload.metadata)
      });
      return { online: true, ...next };
    },
    async heartbeat(payload: PresencePayload) {
      const now = currentTime(payload.now);
      const next = await writePresence(payload, now);
      return { online: true, ...next };
    },
    async leave(payload: PresencePayload) {
      const now = currentTime(payload.now);
      const userId = assertRequired(payload.userId, 'userId');
      const roomId = assertRequired(payload.roomId, 'roomId');
      const keys = buildKeys(config.namespace, roomId, userId);
      await storage.del(assertRequired(keys.presence, 'presenceKey'));
      await storage.zrem(assertRequired(keys.presenceRoom, 'presenceRoom'), userId);
      await cleanupRoom(roomId, now);
      const count = await presence.getCount(roomId);
      await publishLive(roomId, {
        roomId,
        type: 'presence.leave',
        userId,
        sessionId: payload.sessionId ?? null,
        occurredAt: now,
        count,
        metadata: ensureJsonRecord(payload.metadata)
      });
      return {
        online: false,
        roomId,
        userId,
        sessionId: payload.sessionId ?? null,
        metadata: ensureJsonRecord(payload.metadata),
        joinedAt: now,
        lastSeenAt: now
      } satisfies PresenceState;
    },
    async isOnline(roomId: string, userId: string) {
      await cleanupRoom(roomId);
      const state = await readPresence(roomId, userId);
      if (!state || !state.lastSeenAt) {
        return {
          online: false,
          roomId,
          userId,
          sessionId: null,
          metadata: null,
          joinedAt: 0,
          lastSeenAt: null
        } satisfies PresenceState;
      }
      return { online: true, ...state };
    },
    async getCount(roomId: string) {
      const now = Date.now();
      await cleanupRoom(roomId, now);
      const keys = buildKeys(config.namespace, roomId);
      const cutoff = now - config.presenceTtlMs;
      return storage.zcount(assertRequired(keys.presenceRoom, 'presenceRoom'), cutoff, '+inf');
    },
    async list(roomId: string) {
      const now = Date.now();
      await cleanupRoom(roomId, now);
      const keys = buildKeys(config.namespace, roomId);
      const cutoff = now - config.presenceTtlMs;
      const userIds = await storage.zrangeByScore(assertRequired(keys.presenceRoom, 'presenceRoom'), cutoff, '+inf');
      const users: PresenceState[] = [];
      for (const userId of userIds) {
        const state = await readPresence(roomId, userId);
        if (state && state.lastSeenAt) {
          users.push({ online: true, ...state });
        }
      }
      return users;
    },
    async snapshot(roomId: string) {
      const users = await presence.list(roomId);
      return {
        roomId,
        count: users.length,
        users
      };
    }
  };

  const session = {
    async start(payload: SessionStartPayload) {
      const now = currentTime(payload.startedAt ?? payload.now);
      const sessionId = payload.sessionId ?? createId();
      const record: SessionRecord = {
        sessionId,
        userId: assertRequired(payload.userId, 'userId'),
        roomId: assertRequired(payload.roomId, 'roomId'),
        path: payload.path ?? null,
        href: payload.href ?? null,
        startedAt: now,
        lastSeenAt: now,
        endedAt: null,
        metadata: ensureJsonRecord(payload.metadata)
      };

      await writeSession(record);
      await recordActiveBucket(record.roomId, record.userId, now);
      await publishLive(record.roomId, {
        roomId: record.roomId,
        type: 'session.start',
        userId: record.userId,
        sessionId: record.sessionId,
        occurredAt: now,
        path: record.path,
        href: record.href,
        metadata: record.metadata
      });
      return record;
    },
    async event(payload: SessionEventPayload) {
      const now = currentTime(payload.occurredAt ?? payload.now);
      const roomId = assertRequired(payload.roomId, 'roomId');
      const userId = assertRequired(payload.userId, 'userId');
      const sessionId = payload.sessionId ?? createId();
      const name = payload.name ?? payload.event ?? payload.type ?? 'event';
      const type = payload.type ?? name;
      const existing = (await readSession(sessionId)) ?? {
        sessionId,
        userId,
        roomId,
        path: payload.path ?? null,
        href: payload.href ?? null,
        startedAt: now,
        lastSeenAt: now,
        endedAt: null,
        metadata: null
      };

      const sessionRecord: SessionRecord = {
        ...existing,
        userId,
        roomId,
        path: payload.path ?? existing.path,
        href: payload.href ?? existing.href,
        lastSeenAt: now,
        metadata: ensureJsonRecord(payload.metadata ?? existing.metadata)
      };

      const event = {
        sessionId,
        userId,
        roomId,
        name,
        type,
        path: payload.path ?? sessionRecord.path,
        href: payload.href ?? sessionRecord.href,
        x: typeof payload.x === 'number' ? payload.x : null,
        y: typeof payload.y === 'number' ? payload.y : null,
        metadata: ensureJsonRecord(payload.metadata),
        occurredAt: now
      };

      await writeSession(sessionRecord);
      await recordActiveBucket(roomId, userId, now);
      await recordHeatmapPoint(roomId, now, event);
      await pushRecentEvent(roomId, event);
      await publishLive(roomId, {
        roomId,
        type: 'session.event',
        userId,
        sessionId,
        occurredAt: now,
        eventName: name,
        path: event.path,
        href: event.href,
        x: event.x,
        y: event.y,
        metadata: event.metadata
      });
      return event;
    },
    async end(payload: SessionEndPayload) {
      const now = currentTime(payload.endedAt ?? payload.now);
      const existing = (await readSession(payload.sessionId)) ?? {
        sessionId: payload.sessionId,
        userId: payload.userId,
        roomId: payload.roomId,
        path: null,
        href: null,
        startedAt: now,
        lastSeenAt: now,
        endedAt: null,
        metadata: null
      };

      const next: SessionRecord = {
        ...existing,
        userId: payload.userId,
        roomId: payload.roomId,
        endedAt: now,
        lastSeenAt: now
      };

      await writeSession(next);
      await publishLive(payload.roomId, {
        roomId: payload.roomId,
        type: 'session.end',
        userId: payload.userId,
        sessionId: payload.sessionId,
        occurredAt: now,
        path: next.path,
        href: next.href,
        metadata: next.metadata
      });
      return next;
    },
    get(sessionId: string) {
      return readSession(sessionId);
    }
  };

  const analytics = {
    track(payload: SessionEventPayload) {
      return session.event(payload);
    },
    getCurrentActiveUsers(roomId: string) {
      return presence.getCount(roomId);
    },
    async getActiveUsersSeries(payload: ActiveUsersQuery) {
      const roomId = assertRequired(payload.roomId, 'roomId');
      const bucketMs = clampNumber(payload.bucketMs, config.heatmapBucketMs);
      const from = clampNumber(payload.from, Date.now() - bucketMs * 12);
      const to = clampNumber(payload.to, Date.now());
      const points = [];

      for (const bucket of sequence(bucketStart(from, bucketMs), bucketStart(to, bucketMs), bucketMs)) {
        const keys = buildKeys(config.namespace, roomId, null, null, bucket);
        points.push({
          timestamp: bucket,
          count: await storage.scard(assertRequired(keys.activeBucket, 'activeBucket'))
        });
      }

      return {
        roomId,
        from,
        to,
        bucketMs,
        points
      };
    },
    async getHeatmap(payload: HeatmapQuery) {
      const roomId = assertRequired(payload.roomId, 'roomId');
      const bucketMs = clampNumber(payload.bucketMs, config.heatmapBucketMs);
      const cellSize = clampNumber(payload.cellSize, config.heatmapCellSize);
      const from = clampNumber(payload.from, Date.now() - bucketMs * 12);
      const to = clampNumber(payload.to, Date.now());
      const aggregate = new Map<string, number>();

      for (const bucket of sequence(bucketStart(from, bucketMs), bucketStart(to, bucketMs), bucketMs)) {
        const keys = buildKeys(config.namespace, roomId, null, null, bucket);
        const cells = await storage.hgetall(assertRequired(keys.heatmap, 'heatmapKey'));
        for (const [field, count] of Object.entries(cells)) {
          aggregate.set(field, (aggregate.get(field) ?? 0) + Number(count));
        }
      }

      return {
        roomId,
        from,
        to,
        bucketMs,
        cellSize,
        cells: [...aggregate.entries()]
          .map(([field, count]) => {
            const [cellXRaw, cellYRaw] = field.split(':');
            const cellX = Number(cellXRaw);
            const cellY = Number(cellYRaw);
            return {
              cellX,
              cellY,
              x: cellX * cellSize,
              y: cellY * cellSize,
              width: cellSize,
              height: cellSize,
              count
            };
          })
          .sort((left, right) => right.count - left.count)
      };
    },
    async getRecentEvents(roomId: string, limit = 50) {
      const keys = buildKeys(config.namespace, roomId);
      return (await storage.lrange(assertRequired(keys.events, 'eventsKey'), 0, normalizeListRange(limit))).map((item) =>
        fromJson<Record<string, unknown>>(item, {})
      );
    }
  };

  const live = {
    async resolveCursor(roomId: string, cursor = '$') {
      if (cursor !== '$') {
        return cursor;
      }

      const keys = buildKeys(config.namespace, roomId);
      const latest = await storage.xrevrange(assertRequired(keys.liveStream, 'liveStreamKey'), { count: 1 });
      return latest[0]?.id ?? '0-0';
    },
    async read(roomId: string, cursor: string, options?: { count?: number }) {
      const keys = buildKeys(config.namespace, roomId);
      const entries = await storage.xread(assertRequired(keys.liveStream, 'liveStreamKey'), cursor, {
        count: options?.count ?? 50
      });
      return entries
        .map((entry) => {
          const event = fromJson<Omit<ActivaLiveEvent, 'streamId'> | null>(entry.fields.payload ?? null, null);
          if (!event) {
            return null;
          }
          return {
            ...event,
            streamId: entry.id
          } satisfies ActivaLiveEvent;
        })
        .filter((event): event is ActivaLiveEvent => Boolean(event));
    }
  };

  return {
    config,
    storage,
    presence,
    session,
    analytics,
    live
  };
}
