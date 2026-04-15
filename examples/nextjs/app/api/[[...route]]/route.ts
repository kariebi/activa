import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { createActivaqHonoApp } from '@activaq/sdk/hono';
import { activaq } from '@/lib/activa';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const app = new Hono().basePath('/api');

app.route(
  '/activaq',
  createActivaqHonoApp({
    activa: activaq,
    defaultStreamPollIntervalMs: 750
  })
);

export const GET = handle(app);
export const POST = handle(app);
export const OPTIONS = handle(app);
