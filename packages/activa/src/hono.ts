import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Context } from 'hono';
import type { ActivaInstance, HeatmapQuery, PresencePayload, SessionEndPayload, SessionEventPayload, SessionStartPayload } from './types';

const jsonRecordSchema = z.record(z.string(), z.unknown()).nullable().optional();

const presenceSchema = z.object({
  userId: z.string().min(1),
  roomId: z.string().min(1),
  sessionId: z.string().nullable().optional(),
  metadata: jsonRecordSchema,
  now: z.number().optional()
});

const sessionStartSchema = z.object({
  userId: z.string().min(1),
  roomId: z.string().min(1),
  sessionId: z.string().optional(),
  path: z.string().nullable().optional(),
  href: z.string().nullable().optional(),
  metadata: jsonRecordSchema,
  startedAt: z.number().optional(),
  now: z.number().optional()
});

const sessionEventSchema = z.object({
  userId: z.string().min(1),
  roomId: z.string().min(1),
  sessionId: z.string().optional(),
  type: z.string().optional(),
  event: z.string().optional(),
  name: z.string().optional(),
  path: z.string().nullable().optional(),
  href: z.string().nullable().optional(),
  x: z.number().nullable().optional(),
  y: z.number().nullable().optional(),
  metadata: jsonRecordSchema,
  occurredAt: z.number().optional(),
  now: z.number().optional()
});

const sessionEndSchema = z.object({
  userId: z.string().min(1),
  roomId: z.string().min(1),
  sessionId: z.string().min(1),
  endedAt: z.number().optional(),
  now: z.number().optional()
});

const roomQuerySchema = z.object({
  roomId: z.string().min(1)
});

const statusQuerySchema = z.object({
  roomId: z.string().min(1),
  userId: z.string().min(1)
});

const activeQuerySchema = z.object({
  roomId: z.string().min(1),
  from: z.coerce.number().optional(),
  to: z.coerce.number().optional(),
  bucketMs: z.coerce.number().optional()
});

const heatmapQuerySchema = activeQuerySchema.extend({
  cellSize: z.coerce.number().optional()
});

const eventsQuerySchema = z.object({
  roomId: z.string().min(1),
  limit: z.coerce.number().optional()
});

const streamQuerySchema = z.object({
  roomId: z.string().min(1),
  cursor: z.string().optional(),
  pollIntervalMs: z.coerce.number().min(25).max(10_000).optional()
});

export interface ActivaHonoOptions {
  activa: ActivaInstance;
  enableCors?: boolean;
  authorize?: (context: Context) => Promise<void> | void;
  defaultStreamPollIntervalMs?: number;
}

function badRequest(message: string) {
  throw new HTTPException(400, { message });
}

export function mountActivaRoutes(app: Hono, options: ActivaHonoOptions) {
  if (options.enableCors !== false) {
    app.use('*', cors());
  }

  if (options.authorize) {
    app.use('*', async (c, next) => {
      await options.authorize?.(c);
      await next();
    });
  }

  app.onError((error, c) => {
    const status = error instanceof HTTPException ? error.status : 500;
    return c.json(
      {
        ok: false,
        error: error.message || 'Internal server error'
      },
      status
    );
  });

  app.get('/health', (c) => c.json({ ok: true, data: { status: 'ok' } }));

  app.post('/presence/join', zValidator('json', presenceSchema), async (c) => {
    const payload = c.req.valid('json') as PresencePayload;
    return c.json({ ok: true, data: await options.activa.presence.join(payload) });
  });

  app.post('/presence/heartbeat', zValidator('json', presenceSchema), async (c) => {
    const payload = c.req.valid('json') as PresencePayload;
    return c.json({ ok: true, data: await options.activa.presence.heartbeat(payload) });
  });

  app.post('/presence/leave', zValidator('json', presenceSchema), async (c) => {
    const payload = c.req.valid('json') as PresencePayload;
    return c.json({ ok: true, data: await options.activa.presence.leave(payload) });
  });

  app.get('/presence/count', zValidator('query', roomQuerySchema), async (c) => {
    const { roomId } = c.req.valid('query');
    return c.json({ ok: true, data: { roomId, count: await options.activa.presence.getCount(roomId) } });
  });

  app.get('/presence/status', zValidator('query', statusQuerySchema), async (c) => {
    const { roomId, userId } = c.req.valid('query');
    return c.json({ ok: true, data: await options.activa.presence.isOnline(roomId, userId) });
  });

  app.get('/presence/list', zValidator('query', roomQuerySchema), async (c) => {
    const { roomId } = c.req.valid('query');
    return c.json({ ok: true, data: await options.activa.presence.snapshot(roomId) });
  });

  app.post('/session/start', zValidator('json', sessionStartSchema), async (c) => {
    const payload = c.req.valid('json') as SessionStartPayload;
    return c.json({ ok: true, data: await options.activa.session.start(payload) });
  });

  app.post('/session/event', zValidator('json', sessionEventSchema), async (c) => {
    const payload = c.req.valid('json') as SessionEventPayload;
    return c.json({ ok: true, data: await options.activa.session.event(payload) });
  });

  app.post('/session/end', zValidator('json', sessionEndSchema), async (c) => {
    const payload = c.req.valid('json') as SessionEndPayload;
    return c.json({ ok: true, data: await options.activa.session.end(payload) });
  });

  app.get('/analytics/active', zValidator('query', activeQuerySchema), async (c) => {
    const payload = c.req.valid('query');
    return c.json({
      ok: true,
      data: await options.activa.analytics.getActiveUsersSeries({
        roomId: payload.roomId,
        ...(payload.from !== undefined ? { from: payload.from } : {}),
        ...(payload.to !== undefined ? { to: payload.to } : {}),
        ...(payload.bucketMs !== undefined ? { bucketMs: payload.bucketMs } : {})
      })
    });
  });

  app.get('/analytics/heatmap', zValidator('query', heatmapQuerySchema), async (c) => {
    const payload = c.req.valid('query');
    return c.json({
      ok: true,
      data: await options.activa.analytics.getHeatmap({
        roomId: payload.roomId,
        ...(payload.from !== undefined ? { from: payload.from } : {}),
        ...(payload.to !== undefined ? { to: payload.to } : {}),
        ...(payload.bucketMs !== undefined ? { bucketMs: payload.bucketMs } : {}),
        ...(payload.cellSize !== undefined ? { cellSize: payload.cellSize } : {})
      } satisfies HeatmapQuery)
    });
  });

  app.get('/analytics/events', zValidator('query', eventsQuerySchema), async (c) => {
    const payload = c.req.valid('query');
    return c.json({ ok: true, data: await options.activa.analytics.getRecentEvents(payload.roomId, payload.limit ?? 50) });
  });

  app.get('/stream/sse', zValidator('query', streamQuerySchema), async (c) => {
    const query = c.req.valid('query');
    const roomId = query.roomId;
    const pollIntervalMs = query.pollIntervalMs ?? options.defaultStreamPollIntervalMs ?? 1_500;

    if (!roomId) {
      badRequest('roomId is required');
    }

    c.header('Cache-Control', 'no-cache, no-transform');
    c.header('X-Accel-Buffering', 'no');

    return streamSSE(c, async (stream) => {
      let active = true;
      stream.onAbort(() => {
        active = false;
      });

      let cursor = await options.activa.live.resolveCursor(roomId, query.cursor ?? '$');
      await stream.writeSSE({
        data: JSON.stringify({ kind: 'ready', roomId, cursor, timestamp: Date.now() })
      });

      while (active) {
        const events = await options.activa.live.read(roomId, cursor, { count: 25 });
        if (events.length === 0) {
          await stream.writeSSE({
            data: JSON.stringify({ kind: 'keepalive', roomId, timestamp: Date.now() })
          });
          await stream.sleep(pollIntervalMs);
          continue;
        }

        for (const event of events) {
          cursor = event.streamId;
          await stream.writeSSE({
            id: event.streamId,
            data: JSON.stringify({ kind: 'event', roomId, event })
          });
        }
      }
    });
  });

  return app;
}

export function createActivaHonoApp(options: ActivaHonoOptions) {
  return mountActivaRoutes(new Hono(), options);
}
