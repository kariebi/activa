import { createActivaq, createUpstashRedisStorage } from '@activaq/sdk';
import { createMemoryStorageAdapter } from '@activaq/sdk/testing';

declare global {
  var __activaq_demo_instance: ReturnType<typeof createActivaq> | undefined;
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

export const activaq =
  globalThis.__activaq_demo_instance ??
  (globalThis.__activaq_demo_instance = createActivaq({
    namespace: process.env.ACTIVAQ_NAMESPACE ?? 'activaq-demo',
    redis: resolveStorage(),
    presenceTtlMs: resolveNumber(process.env.ACTIVAQ_PRESENCE_TTL_MS, 30_000),
    heatmapBucketMs: resolveNumber(process.env.ACTIVAQ_HEATMAP_BUCKET_MS, 5 * 60 * 1000),
    heatmapCellSize: resolveNumber(process.env.ACTIVAQ_HEATMAP_CELL_SIZE, 24),
    liveStreamMaxLen: resolveNumber(process.env.ACTIVAQ_LIVE_STREAM_MAX_LEN, 2_000)
  }));
