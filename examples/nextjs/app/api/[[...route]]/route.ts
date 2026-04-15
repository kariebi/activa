import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { createActivaHonoApp } from 'activa/hono';
import { activa } from '@/lib/activa';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const app = new Hono().basePath('/api');

app.route(
  '/activa',
  createActivaHonoApp({
    activa,
    defaultStreamPollIntervalMs: 750
  })
);

export const GET = handle(app);
export const POST = handle(app);
export const OPTIONS = handle(app);
