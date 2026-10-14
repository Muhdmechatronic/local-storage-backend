import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModelManagerConfig, createDailyWindow, DEFAULT_MODELS } from '../services/modelManager/config.js';
import { MemoryQuotaStore } from '../services/modelManager/quotaStores.js';

test('defaults: all 8 models at 15 rpm / 150 rpd, memory store', () => {
  const cfg = loadModelManagerConfig({});
  assert.deepEqual(cfg.models.map((m) => m.name), DEFAULT_MODELS);
  assert.ok(cfg.models.every((m) => m.rpm === 15 && m.rpd === 150));
  assert.equal(cfg.minuteWindowMs, 61_000);
  assert.equal(cfg.store.type, 'memory');
});

test('env overrides: model list, limits, per-model overrides', () => {
  const cfg = loadModelManagerConfig({
    GEMINI_MODELS: 'a, b ,a,c',
    MODEL_RPM_LIMIT: '10',
    MODEL_RPD_LIMIT: '100',
    MODEL_LIMIT_OVERRIDES: '{"c":{"rpm":30,"rpd":1000}}',
  });
  assert.deepEqual(cfg.models, [
    { name: 'a', rpm: 10, rpd: 100 },
    { name: 'b', rpm: 10, rpd: 100 },
    { name: 'c', rpm: 30, rpd: 1000 },
  ]);
});

test('invalid config is rejected', () => {
  assert.throws(() => loadModelManagerConfig({ MODEL_RPM_LIMIT: 'abc' }), /MODEL_RPM_LIMIT/);
  assert.throws(() => loadModelManagerConfig({ QUOTA_STORE: 'mongo' }), /QUOTA_STORE/);
  assert.throws(() => loadModelManagerConfig({ MODEL_LIMIT_OVERRIDES: '{bad' }), /MODEL_LIMIT_OVERRIDES/);
});

test('daily window resets at midnight Pacific time', () => {
  const win = createDailyWindow('America/Los_Angeles');
  // 2026-10-12 06:59:59Z = 23:59:59 PDT on Oct 11; one second later is Oct 12 PDT.
  const before = win(Date.parse('2026-10-12T06:59:59Z'));
  const after = win(Date.parse('2026-10-12T07:00:00Z'));
  assert.equal(before.key, '2026-10-11');
  assert.equal(after.key, '2026-10-12');
  assert.equal(before.resetAt, Date.parse('2026-10-12T07:00:00Z'));
});

test('memory store: atomic reserve respects minute + day limits and blocks', async () => {
  const store = new MemoryQuotaStore();
  const opts = { rpm: 2, rpd: 3, windowMs: 100, dayKey: 'd1' };
  assert.equal((await store.tryReserve('m', { ...opts, now: 0 })).ok, true);
  assert.equal((await store.tryReserve('m', { ...opts, now: 10 })).ok, true);
  assert.deepEqual(await store.tryReserve('m', { ...opts, now: 20 }), { ok: false, reason: 'minute', retryAt: 100 });
  assert.equal((await store.tryReserve('m', { ...opts, now: 100 })).ok, true);
  assert.equal((await store.tryReserve('m', { ...opts, now: 500 })).reason, 'daily');
  assert.equal((await store.tryReserve('m', { ...opts, now: 500, dayKey: 'd2' })).ok, true);

  await store.block('m', 1_000, 'rate_limited', 600);
  assert.equal((await store.tryReserve('m', { ...opts, now: 700, dayKey: 'd2' })).reason, 'blocked');
  await store.block('m', 800, 'rate_limited', 600); // shorter block does not shorten
  assert.equal((await store.tryReserve('m', { ...opts, now: 900, dayKey: 'd2' })).reason, 'blocked');
  assert.equal((await store.tryReserve('m', { ...opts, now: 1_000, dayKey: 'd2' })).ok, true);
});

test('memory store: blocking a model does not reset its minute window (regression)', async () => {
  const store = new MemoryQuotaStore();
  const opts = { rpm: 2, rpd: 100, windowMs: 1_000, dayKey: 'd1' };
  await store.tryReserve('m', { ...opts, now: 0 });
  await store.tryReserve('m', { ...opts, now: 10 });
  await store.block('m', 50, 'rate_limited', 20);
  // Block expired, but both reservations are still inside the 1s window.
  assert.equal((await store.tryReserve('m', { ...opts, now: 60 })).reason, 'minute');
});
