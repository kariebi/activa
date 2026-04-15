import type { Server } from 'node:http';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { mountActivaRoutes, type ActivaHonoOptions } from './hono';

export interface ActivaNodeServerOptions extends ActivaHonoOptions {
  port?: number;
  hostname?: string;
  basePath?: string;
}

export function createActivaNodeServer(options: ActivaNodeServerOptions) {
  const port = options.port ?? 3000;
  const hostname = options.hostname ?? '127.0.0.1';
  const basePath = (options.basePath ?? '/activa').replace(/\/+$/, '');
  const app = new Hono().basePath(basePath);
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  mountActivaRoutes(app, options);

  app.get(
    '/stream/ws',
    upgradeWebSocket((c) => {
      const roomId = c.req.query('roomId') ?? '';
      let cursor = c.req.query('cursor') ?? '$';
      let active = false;

      return {
        async onOpen(_event, ws) {
          if (!roomId) {
            ws.send(JSON.stringify({ kind: 'error', message: 'roomId is required' }));
            ws.close();
            return;
          }

          active = true;
          cursor = await options.activa.live.resolveCursor(roomId, cursor);
          ws.send(JSON.stringify({ kind: 'ready', roomId, cursor, timestamp: Date.now() }));

          while (active) {
            const events = await options.activa.live.read(roomId, cursor, { count: 25 });
            if (events.length === 0) {
              ws.send(JSON.stringify({ kind: 'keepalive', roomId, timestamp: Date.now() }));
              await new Promise((resolve) => setTimeout(resolve, options.defaultStreamPollIntervalMs ?? 1_500));
              continue;
            }

            for (const event of events) {
              cursor = event.streamId;
              ws.send(JSON.stringify({ kind: 'event', roomId, event }));
            }
          }
        },
        onClose() {
          active = false;
        },
        onError() {
          active = false;
        }
      };
    })
  );

  const server = serve({
    fetch: app.fetch,
    port,
    hostname
  }) as Server;

  injectWebSocket(server);
  const ready = new Promise<void>((resolve, reject) => {
    if (server.listening) {
      resolve();
      return;
    }

    server.once('listening', () => resolve());
    server.once('error', (error) => reject(error));
  });

  return {
    app,
    server,
    url: `http://${hostname}:${port}${basePath}`,
    ready,
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }

        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
}
