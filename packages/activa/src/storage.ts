import type { ActivaStorageAdapter, ActivaStreamRecord, UpstashRedisConfig } from './types';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function asHash(value: unknown): Record<string, string> {
  if (!value) {
    return {};
  }

  if (Array.isArray(value)) {
    const record: Record<string, string> = {};
    for (let index = 0; index < value.length; index += 2) {
      const key = value[index];
      const entry = value[index + 1];
      if (key !== undefined && entry !== undefined) {
        record[String(key)] = String(entry);
      }
    }
    return record;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, String(entry)])
  );
}

function asStreamRecord(value: unknown): ActivaStreamRecord | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  const [id, fields] = value;
  return {
    id: String(id),
    fields: asHash(fields)
  };
}

function asXReadResponse(value: unknown): ActivaStreamRecord[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }

  const [, records] = value[0] as [unknown, unknown];
  if (!Array.isArray(records)) {
    return [];
  }

  return records.map(asStreamRecord).filter((record): record is ActivaStreamRecord => Boolean(record));
}

class UpstashRestAdapter implements ActivaStorageAdapter {
  private readonly url: string;
  private readonly token: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly attempts: number;
  private readonly backoffMs: number;

  constructor(config: UpstashRedisConfig) {
    if (!config.url) {
      throw new Error('Activaq requires redis.url when using Upstash REST.');
    }

    if (!config.token) {
      throw new Error('Activaq requires redis.token when using Upstash REST.');
    }

    if (typeof (config.fetch ?? globalThis.fetch) !== 'function') {
      throw new Error('Activaq could not find a fetch implementation for the Upstash REST adapter.');
    }

    this.url = config.url.replace(/\/+$/, '');
    this.token = config.token;
    this.headers = config.headers ?? {};
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.attempts = Math.max(1, config.retry?.attempts ?? 3);
    this.backoffMs = Math.max(50, config.retry?.backoffMs ?? 150);
  }

  private async command<T>(args: Array<string | number>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.attempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(this.url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.token}`,
            'content-type': 'application/json',
            ...this.headers
          },
          body: JSON.stringify(args)
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Upstash REST command failed (${response.status}): ${text}`);
        }

        const payload = (await response.json()) as { result?: T; error?: string };
        if (payload.error) {
          throw new Error(payload.error);
        }

        return payload.result as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown Upstash REST error');
        if (attempt < this.attempts - 1) {
          await sleep(this.backoffMs * (attempt + 1));
          continue;
        }
      }
    }

    throw lastError ?? new Error('Upstash REST command failed');
  }

  async get(key: string) {
    return this.command<string | null>(['GET', key]);
  }

  async set(key: string, value: string, options?: { ex?: number }) {
    const args: Array<string | number> = ['SET', key, value];
    if (options?.ex) {
      args.push('EX', options.ex);
    }
    await this.command(args);
  }

  async del(key: string) {
    return toNumber(await this.command<number>(['DEL', key]));
  }

  async expire(key: string, seconds: number) {
    return toNumber(await this.command<number>(['EXPIRE', key, seconds]));
  }

  async zadd(key: string, score: number, member: string) {
    return toNumber(await this.command<number>(['ZADD', key, score, member]));
  }

  async zrem(key: string, member: string) {
    return toNumber(await this.command<number>(['ZREM', key, member]));
  }

  async zcount(key: string, min: number | string, max: number | string) {
    return toNumber(await this.command<number>(['ZCOUNT', key, min, max]));
  }

  async zrangeByScore(key: string, min: number | string, max: number | string) {
    return (await this.command<Array<string | number>>(['ZRANGEBYSCORE', key, min, max])).map(String);
  }

  async zremrangeByScore(key: string, min: number | string, max: number | string) {
    return toNumber(await this.command<number>(['ZREMRANGEBYSCORE', key, min, max]));
  }

  async sadd(key: string, member: string) {
    return toNumber(await this.command<number>(['SADD', key, member]));
  }

  async scard(key: string) {
    return toNumber(await this.command<number>(['SCARD', key]));
  }

  async hincrby(key: string, field: string, increment: number) {
    return toNumber(await this.command<number>(['HINCRBY', key, field, increment]));
  }

  async hgetall(key: string) {
    return asHash(await this.command<Record<string, string> | string[]>(['HGETALL', key]));
  }

  async lpush(key: string, value: string) {
    return toNumber(await this.command<number>(['LPUSH', key, value]));
  }

  async ltrim(key: string, start: number, end: number) {
    await this.command(['LTRIM', key, start, end]);
  }

  async lrange(key: string, start: number, end: number) {
    return (await this.command<Array<string | number>>(['LRANGE', key, start, end])).map(String);
  }

  async xadd(key: string, fields: Record<string, string>, options?: { maxLen?: number }) {
    const args: Array<string | number> = ['XADD', key];
    if (options?.maxLen) {
      args.push('MAXLEN', '~', options.maxLen);
    }
    args.push('*');
    for (const [field, value] of Object.entries(fields)) {
      args.push(field, value);
    }
    return String(await this.command<string>(args));
  }

  async xread(key: string, cursor: string, options?: { count?: number }) {
    const args: Array<string | number> = ['XREAD'];
    if (options?.count) {
      args.push('COUNT', options.count);
    }
    args.push('STREAMS', key, cursor);
    return asXReadResponse(await this.command<unknown>(args));
  }

  async xrevrange(key: string, options?: { count?: number }) {
    const args: Array<string | number> = ['XREVRANGE', key, '+', '-'];
    if (options?.count) {
      args.push('COUNT', options.count);
    }
    const records = await this.command<unknown[]>(args);
    return records.map(asStreamRecord).filter((record): record is ActivaStreamRecord => Boolean(record));
  }
}

function isStorageAdapter(value: unknown): value is ActivaStorageAdapter {
  return Boolean(value) && typeof value === 'object' && typeof (value as ActivaStorageAdapter).get === 'function';
}

export function createUpstashRedisStorage(config: UpstashRedisConfig): ActivaStorageAdapter {
  return new UpstashRestAdapter(config);
}

export function normalizeStorageAdapter(redis: ActivaStorageAdapter | UpstashRedisConfig): ActivaStorageAdapter {
  if (isStorageAdapter(redis)) {
    return redis;
  }

  return createUpstashRedisStorage(redis);
}
