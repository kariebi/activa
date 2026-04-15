import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { createActiva } from '../src/activa';
import { createActivaHonoApp } from '../src/hono';
import { createActivaNodeServer } from '../src/node';
import { createMemoryStorageAdapter } from '../src/memory';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition.');
    }
    await sleep(25);
  }
}

describe('Activa core', () => {
  it('tracks presence, active users and heatmaps end-to-end', async () => {
    const activa = createActiva({
      redis: createMemoryStorageAdapter(),
      namespace: 'test-suite',
      heatmapBucketMs: 60_000,
      heatmapCellSize: 20
    });

    await activa.presence.join({ userId: 'user_1', roomId: 'pricing' });
    await activa.presence.join({ userId: 'user_2', roomId: 'pricing', metadata: { role: 'admin' } });

    expect(await activa.presence.getCount('pricing')).toBe(2);
    expect((await activa.presence.isOnline('pricing', 'user_2')).metadata).toEqual({ role: 'admin' });

    const start = Date.UTC(2026, 3, 15, 10, 0, 0);
    await activa.session.start({ userId: 'user_1', roomId: 'pricing', sessionId: 'session_1', startedAt: start });
    await activa.session.event({
      userId: 'user_1',
      roomId: 'pricing',
      sessionId: 'session_1',
      type: 'click',
      x: 42,
      y: 65,
      occurredAt: start + 5_000
    });
    await activa.session.event({
      userId: 'user_2',
      roomId: 'pricing',
      sessionId: 'session_2',
      type: 'click',
      x: 44,
      y: 61,
      occurredAt: start + 35_000
    });

    const heatmap = await activa.analytics.getHeatmap({
      roomId: 'pricing',
      from: start,
      to: start + 60_000,
      bucketMs: 60_000,
      cellSize: 20
    });
    expect(heatmap.cells[0]).toMatchObject({ cellX: 2, cellY: 3, count: 2 });

    const activeSeries = await activa.analytics.getActiveUsersSeries({
      roomId: 'pricing',
      from: start,
      to: start + 60_000,
      bucketMs: 60_000
    });
    expect(activeSeries.points[0]?.count).toBe(2);

    const recentEvents = await activa.analytics.getRecentEvents('pricing', 5);
    expect(recentEvents).toHaveLength(2);
  });
});

describe('Activa Hono routes', () => {
  it('serves typed REST endpoints', async () => {
    const activa = createActiva({ redis: createMemoryStorageAdapter(), namespace: 'test-suite' });
    const app = createActivaHonoApp({ activa, enableCors: false });

    const joinResponse = await app.request(
      new Request('http://activa.local/presence/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'user_1', roomId: 'lobby' })
      })
    );
    expect(joinResponse.status).toBe(200);

    const countResponse = await app.request('http://activa.local/presence/count?roomId=lobby');
    const countPayload = await countResponse.json();
    expect(countPayload.data.count).toBe(1);

    await app.request(
      new Request('http://activa.local/session/event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'user_1', roomId: 'lobby', sessionId: 'session_1', type: 'click', x: 12, y: 18 })
      })
    );

    const heatmapResponse = await app.request('http://activa.local/analytics/heatmap?roomId=lobby');
    const heatmapPayload = await heatmapResponse.json();
    expect(heatmapPayload.data.cells[0].count).toBe(1);
  });

  it('streams live updates over SSE', async () => {
    const activa = createActiva({ redis: createMemoryStorageAdapter(), namespace: 'stream-suite' });
    const app = createActivaHonoApp({ activa, enableCors: false, defaultStreamPollIntervalMs: 50 });

    const response = await app.request('http://activa.local/stream/sse?roomId=room-1&pollIntervalMs=50');
    expect(response.status).toBe(200);

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const chunks: string[] = [];
    setTimeout(() => {
      void activa.presence.join({ userId: 'user_sse', roomId: 'room-1' });
    }, 60);

    while (true) {
      const result = await reader!.read();
      if (result.done) {
        break;
      }
      chunks.push(new TextDecoder().decode(result.value));
      if (chunks.join('').includes('presence.join')) {
        break;
      }
    }

    await reader!.cancel();
    expect(chunks.join('')).toContain('"kind":"event"');
    expect(chunks.join('')).toContain('presence.join');
  });
});

describe('Activa Node server', () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    while (servers.length > 0) {
      await servers.pop()?.close();
    }
  });

  it('streams live updates over WebSocket', async () => {
    const activa = createActiva({ redis: createMemoryStorageAdapter(), namespace: 'ws-suite' });
    let serverHandle: ReturnType<typeof createActivaNodeServer> | null = null;

    try {
      serverHandle = createActivaNodeServer({
        activa,
        basePath: '/activa',
        port: 0,
        hostname: '127.0.0.1',
        enableCors: false,
        defaultStreamPollIntervalMs: 50
      });
      servers.push(serverHandle);
      await serverHandle.ready;
    } catch (error) {
      if (error instanceof Error && /(EPERM|EACCES)/.test(error.message)) {
        return;
      }
      throw error;
    }

    if (!serverHandle) {
      return;
    }

    const address = serverHandle.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP server address.');
    }

    const messages: string[] = [];
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/activa/stream/ws?roomId=room-2`);
    socket.on('message', (data: { toString(): string }) => {
      messages.push(data.toString());
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', (error: Error) => reject(error));
    });

    await waitFor(() => messages.some((message) => message.includes('"kind":"ready"')));
    await activa.presence.join({ userId: 'user_ws', roomId: 'room-2' });
    await waitFor(() => messages.some((message) => message.includes('presence.join')));

    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
      socket.close();
    });
    expect(messages.some((message) => message.includes('"kind":"event"'))).toBe(true);
  });
});
