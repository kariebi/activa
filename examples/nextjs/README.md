# Activa Next.js Demo

This demo shows the Activa SDK running inside a real Next.js App Router app with Hono-powered API routes, live SSE room updates, presence counters, event feeds, and click heatmaps.

## Environment

Copy `.env.example` to `.env.local` and fill in the values you want to use:

```bash
cp .env.example .env.local
```

Important variables:

- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: enable shared Redis-backed presence across instances
- `ACTIVA_NAMESPACE`: isolates this deployment inside Redis
- `NEXT_PUBLIC_ACTIVA_DEMO_ROOM`: controls the room shown by the demo UI
- `NEXT_PUBLIC_ACTIVA_ENDPOINT`: lets you mount the Hono routes on a custom path

If the Upstash variables are omitted, the demo falls back to the in-memory adapter. That is great for local exploration, but it is not suitable for multi-instance deployments.

## Deployment Presets

### Vercel

- Deploy the app as a Next.js project from the monorepo
- If your Vercel project uses a monorepo root setting, point it at `examples/nextjs`
- Add the variables from `.env.example`
- The API route is already pinned to the Node.js runtime and marked as dynamic in `/app/api/[[...route]]/route.ts`
- `maxDuration` is set to `300` so the SSE endpoint has room to stay open for live presence updates

### Docker

Build from the repository root so the workspace package and the demo app are available together:

```bash
docker build -f examples/nextjs/Dockerfile -t activa-demo .
docker run --rm -p 3000:3000 --env-file examples/nextjs/.env.local activa-demo
```

The Docker image uses Next.js standalone output, so the runtime image stays small and only ships the files needed to serve the demo.

## Useful Commands

```bash
npm run dev --workspace @activa/example-nextjs
npm run build --workspace @activa/example-nextjs
npm run start:standalone --workspace @activa/example-nextjs
```
