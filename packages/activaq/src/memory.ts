import type { ActivaStorageAdapter, ActivaStreamRecord } from './types';

function now() {
  return Date.now();
}

function numericBound(value: number | string) {
  if (value === '-inf') {
    return -Infinity;
  }
  if (value === '+inf') {
    return Infinity;
  }
  return Number(value);
}

function parseExclusive(value: string) {
  if (value.startsWith('(')) {
    return { exclusive: true, value: value.slice(1) };
  }
  return { exclusive: false, value };
}

export function createMemoryStorageAdapter(): ActivaStorageAdapter {
  const strings = new Map<string, string>();
  const zsets = new Map<string, Map<string, number>>();
  const hashes = new Map<string, Map<string, string>>();
  const lists = new Map<string, string[]>();
  const sets = new Map<string, Set<string>>();
  const streams = new Map<string, ActivaStreamRecord[]>();
  const expirations = new Map<string, number>();
  let streamSequence = 0;

  const purgeIfExpired = (key: string) => {
    const expiry = expirations.get(key);
    if (expiry && expiry <= now()) {
      expirations.delete(key);
      strings.delete(key);
      zsets.delete(key);
      hashes.delete(key);
      lists.delete(key);
      sets.delete(key);
      streams.delete(key);
    }
  };

  const ensureZset = (key: string) => {
    purgeIfExpired(key);
    if (!zsets.has(key)) {
      zsets.set(key, new Map());
    }
    return zsets.get(key)!;
  };

  const ensureHash = (key: string) => {
    purgeIfExpired(key);
    if (!hashes.has(key)) {
      hashes.set(key, new Map());
    }
    return hashes.get(key)!;
  };

  const ensureList = (key: string) => {
    purgeIfExpired(key);
    if (!lists.has(key)) {
      lists.set(key, []);
    }
    return lists.get(key)!;
  };

  const ensureSet = (key: string) => {
    purgeIfExpired(key);
    if (!sets.has(key)) {
      sets.set(key, new Set());
    }
    return sets.get(key)!;
  };

  const ensureStream = (key: string) => {
    purgeIfExpired(key);
    if (!streams.has(key)) {
      streams.set(key, []);
    }
    return streams.get(key)!;
  };

  const hasKey = (key: string) =>
    strings.has(key) || zsets.has(key) || hashes.has(key) || lists.has(key) || sets.has(key) || streams.has(key);

  return {
    async get(key) {
      purgeIfExpired(key);
      return strings.get(key) ?? null;
    },
    async set(key, value, options) {
      strings.set(key, value);
      if (options?.ex) {
        expirations.set(key, now() + options.ex * 1000);
      }
    },
    async del(key) {
      const existed = hasKey(key);
      strings.delete(key);
      zsets.delete(key);
      hashes.delete(key);
      lists.delete(key);
      sets.delete(key);
      streams.delete(key);
      expirations.delete(key);
      return existed ? 1 : 0;
    },
    async expire(key, seconds) {
      if (!hasKey(key)) {
        return 0;
      }
      expirations.set(key, now() + seconds * 1000);
      return 1;
    },
    async zadd(key, score, member) {
      ensureZset(key).set(member, score);
      return 1;
    },
    async zrem(key, member) {
      return ensureZset(key).delete(member) ? 1 : 0;
    },
    async zcount(key, min, max) {
      const lower = numericBound(min);
      const upper = numericBound(max);
      let count = 0;
      for (const score of ensureZset(key).values()) {
        if (score >= lower && score <= upper) {
          count += 1;
        }
      }
      return count;
    },
    async zrangeByScore(key, min, max) {
      const lower = numericBound(min);
      const upper = numericBound(max);
      return [...ensureZset(key).entries()]
        .filter(([, score]) => score >= lower && score <= upper)
        .sort((left, right) => left[1] - right[1])
        .map(([member]) => member);
    },
    async zremrangeByScore(key, min, max) {
      const lower = numericBound(min);
      const upper = numericBound(max);
      let removed = 0;
      for (const [member, score] of [...ensureZset(key).entries()]) {
        if (score >= lower && score <= upper) {
          ensureZset(key).delete(member);
          removed += 1;
        }
      }
      return removed;
    },
    async sadd(key, member) {
      const target = ensureSet(key);
      const before = target.size;
      target.add(member);
      return target.size > before ? 1 : 0;
    },
    async scard(key) {
      return ensureSet(key).size;
    },
    async hincrby(key, field, increment) {
      const hash = ensureHash(key);
      const next = Number(hash.get(field) ?? '0') + increment;
      hash.set(field, String(next));
      return next;
    },
    async hgetall(key) {
      return Object.fromEntries(ensureHash(key).entries());
    },
    async lpush(key, value) {
      const list = ensureList(key);
      list.unshift(value);
      return list.length;
    },
    async ltrim(key, start, end) {
      lists.set(key, ensureList(key).slice(start, end + 1));
    },
    async lrange(key, start, end) {
      return ensureList(key).slice(start, end + 1);
    },
    async xadd(key, fields, options) {
      const time = now();
      streamSequence += 1;
      const id = `${time}-${streamSequence}`;
      const stream = ensureStream(key);
      stream.push({ id, fields: { ...fields } });
      if (options?.maxLen && stream.length > options.maxLen) {
        streams.set(key, stream.slice(-options.maxLen));
      }
      return id;
    },
    async xread(key, cursor, options) {
      const stream = ensureStream(key);
      const parsed = parseExclusive(cursor.startsWith('(') ? cursor : `(${cursor}`);
      const targetValue = parsed.value === '$' ? `${now()}-${streamSequence}` : parsed.value;
      const count = options?.count ?? Number.POSITIVE_INFINITY;
      return stream
        .filter((entry) => {
          if (parsed.exclusive) {
            return entry.id > targetValue;
          }
          return entry.id >= targetValue;
        })
        .slice(0, count);
    },
    async xrevrange(key, options) {
      const stream = [...ensureStream(key)].reverse();
      return stream.slice(0, options?.count ?? stream.length);
    }
  };
}
