// Quota stores track per-model usage. Both implementations share one async interface:
//
//   tryReserve(model, { rpm, rpd, windowMs, now, dayKey, dayTtlMs })
//     -> { ok: true, reservationId, minuteUsed, dayUsed }
//     -> { ok: false, reason: 'minute' | 'daily' | 'blocked', retryAt?, blockReason? }
//   release(model, reservationId, { dayKey })     undo an unused reservation
//   block(model, untilMs, reason, now)            exclude a model until a time (keeps the later block)
//   snapshot(model, { windowMs, now, dayKey })    -> { minuteUsed, dayUsed, blockedUntil, blockReason }
//   close()
//
// The check-and-increment in tryReserve is atomic in both stores, so concurrent requests
// can never push a model past its minute or daily limit.

export class MemoryQuotaStore {
  constructor() {
    this.type = 'memory';
    this.state = new Map();
    this.seq = 0;
  }

  #get(model, now, windowMs, dayKey) {
    let s = this.state.get(model);
    if (!s) {
      s = { minute: [], dayKey, dayCount: 0, block: null };
      this.state.set(model, s);
    }
    // Sliding minute window: keep entries where now - ts < windowMs.
    while (s.minute.length && s.minute[0].ts <= now - windowMs) s.minute.shift();
    if (dayKey !== undefined && s.dayKey !== dayKey) {
      s.dayKey = dayKey;
      s.dayCount = 0;
    }
    if (s.block && s.block.until <= now) s.block = null;
    return s;
  }

  // Synchronous body: in a single Node process nothing can interleave between check and increment.
  async tryReserve(model, { rpm, rpd, windowMs, now, dayKey }) {
    const s = this.#get(model, now, windowMs, dayKey);
    if (s.block) return { ok: false, reason: 'blocked', blockReason: s.block.reason, retryAt: s.block.until };
    if (s.dayCount >= rpd) return { ok: false, reason: 'daily' };
    if (s.minute.length >= rpm) return { ok: false, reason: 'minute', retryAt: s.minute[0].ts + windowMs };
    const reservationId = `${now}-${++this.seq}`;
    s.minute.push({ ts: now, id: reservationId });
    s.dayCount++;
    return { ok: true, reservationId, minuteUsed: s.minute.length, dayUsed: s.dayCount };
  }

  async release(model, reservationId, { dayKey }) {
    const s = this.state.get(model);
    if (!s) return;
    const idx = s.minute.findIndex((e) => e.id === reservationId);
    if (idx >= 0) s.minute.splice(idx, 1);
    if (s.dayKey === dayKey && s.dayCount > 0) s.dayCount--;
  }

  async block(model, until, reason, now) {
    // windowMs = Infinity: blocking must never prune minute-window history.
    const s = this.#get(model, now, Infinity, undefined);
    if (!s.block || until > s.block.until) s.block = { until, reason };
  }

  async snapshot(model, { windowMs, now, dayKey }) {
    const s = this.#get(model, now, windowMs, dayKey);
    return {
      minuteUsed: s.minute.length,
      dayUsed: s.dayCount,
      blockedUntil: s.block?.until ?? null,
      blockReason: s.block?.reason ?? null,
    };
  }

  async close() {}
}

// KEYS: 1 = minute zset, 2 = day counter, 3 = block key
// ARGV: 1 now, 2 windowMs, 3 rpm, 4 rpd, 5 member, 6 dayTtlMs
const RESERVE_LUA = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local blockTtl = redis.call('PTTL', KEYS[3])
if blockTtl > 0 then
  return {0, 'blocked', now + blockTtl, redis.call('GET', KEYS[3])}
end
local day = tonumber(redis.call('GET', KEYS[2]) or '0')
if day >= tonumber(ARGV[4]) then
  return {0, 'daily', 0, ''}
end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local used = redis.call('ZCARD', KEYS[1])
if used >= tonumber(ARGV[3]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, 'minute', tonumber(oldest[2]) + window, ''}
end
redis.call('ZADD', KEYS[1], now, ARGV[5])
redis.call('PEXPIRE', KEYS[1], window)
day = redis.call('INCR', KEYS[2])
redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[6]))
return {1, 'ok', used + 1, day}
`;

// KEYS: 1 = block key. ARGV: 1 ttlMs, 2 reason. Only extends, never shortens, a block.
const BLOCK_LUA = `
local ttl = redis.call('PTTL', KEYS[1])
if ttl < tonumber(ARGV[1]) then
  redis.call('SET', KEYS[1], ARGV[2], 'PX', tonumber(ARGV[1]))
end
return 1
`;

// KEYS: 1 = minute zset, 2 = day counter. ARGV: 1 member
const RELEASE_LUA = `
redis.call('ZREM', KEYS[1], ARGV[1])
local day = tonumber(redis.call('GET', KEYS[2]) or '0')
if day > 0 then redis.call('DECR', KEYS[2]) end
return 1
`;

/**
 * Shared store for multi-worker / multi-instance deployments. Requires the optional
 * `redis` package and QUOTA_STORE=redis + REDIS_URL. Time comes from the calling
 * instance's clock, so instances should be NTP-synced (the window margin covers small skew).
 */
export class RedisQuotaStore {
  constructor(client, keyPrefix = 'scanquota') {
    this.type = 'redis';
    this.client = client;
    this.prefix = keyPrefix;
    this.seq = 0;
  }

  static async connect(url, keyPrefix) {
    if (!url) throw new Error('QUOTA_STORE=redis requires REDIS_URL');
    let createClient;
    try {
      ({ createClient } = await import('redis'));
    } catch {
      throw new Error('QUOTA_STORE=redis requires the "redis" package (npm install redis)');
    }
    const client = createClient({ url });
    client.on('error', () => {}); // surfaced through failed commands; avoids crashing on reconnect noise
    await client.connect();
    return new RedisQuotaStore(client, keyPrefix);
  }

  // Hash tags keep all keys of one model in the same Redis Cluster slot.
  #keys(model, dayKey) {
    const base = `${this.prefix}:{${model}}`;
    return { minute: `${base}:min`, day: `${base}:day:${dayKey}`, block: `${base}:block` };
  }

  async tryReserve(model, { rpm, rpd, windowMs, now, dayKey, dayTtlMs }) {
    const k = this.#keys(model, dayKey);
    const member = `${now}-${process.pid}-${++this.seq}-${Math.random().toString(36).slice(2, 8)}`;
    const [ok, reason, a, b] = await this.client.eval(RESERVE_LUA, {
      keys: [k.minute, k.day, k.block],
      arguments: [now, windowMs, rpm, rpd, member, dayTtlMs].map(String),
    });
    if (Number(ok) === 1) return { ok: true, reservationId: member, minuteUsed: Number(a), dayUsed: Number(b) };
    if (reason === 'blocked') return { ok: false, reason, retryAt: Number(a), blockReason: b || 'blocked' };
    if (reason === 'minute') return { ok: false, reason, retryAt: Number(a) };
    return { ok: false, reason: 'daily' };
  }

  async release(model, reservationId, { dayKey }) {
    const k = this.#keys(model, dayKey);
    await this.client.eval(RELEASE_LUA, { keys: [k.minute, k.day], arguments: [reservationId] });
  }

  async block(model, until, reason, now) {
    const ttl = Math.max(1, Math.ceil(until - now));
    await this.client.eval(BLOCK_LUA, { keys: [this.#keys(model, '').block], arguments: [String(ttl), reason] });
  }

  async snapshot(model, { windowMs, now, dayKey }) {
    const k = this.#keys(model, dayKey);
    const [minuteUsed, day, ttl, reason] = await Promise.all([
      this.client.zCount(k.minute, now - windowMs + 1, '+inf'),
      this.client.get(k.day),
      this.client.pTTL(k.block),
      this.client.get(k.block),
    ]);
    return {
      minuteUsed: Number(minuteUsed),
      dayUsed: Number(day ?? 0),
      blockedUntil: ttl > 0 ? now + ttl : null,
      blockReason: ttl > 0 ? reason : null,
    };
  }

  async close() {
    await this.client.quit();
  }
}
