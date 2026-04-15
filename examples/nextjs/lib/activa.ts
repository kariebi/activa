import { createActiva, createUpstashRedisStorage } from 'activa';
import { createMemoryStorageAdapter } from 'activa/testing';

declare global {
  var __activa_demo_instance: ReturnType<typeof createActiva> | undefined;
}

function resolveStorage() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    return createUpstashRedisStorage({ url, token });
  }

  return createMemoryStorageAdapter();
}

function resolveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const activa =
  globalThis.__activa_demo_instance ??
  (globalThis.__activa_demo_instance = createActiva({
    namespace: process.env.ACTIVA_NAMESPACE ?? 'activa-demo',
    redis: resolveStorage(),
    presenceTtlMs: resolveNumber(process.env.ACTIVA_PRESENCE_TTL_MS, 30_000),
    heatmapBucketMs: resolveNumber(process.env.ACTIVA_HEATMAP_BUCKET_MS, 5 * 60 * 1000),
    heatmapCellSize: resolveNumber(process.env.ACTIVA_HEATMAP_CELL_SIZE, 24),
    liveStreamMaxLen: resolveNumber(process.env.ACTIVA_LIVE_STREAM_MAX_LEN, 2_000)
  }));
