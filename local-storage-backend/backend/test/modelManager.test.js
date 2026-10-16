import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderError, ModelManagerError } from '../services/modelManager/errors.js';
import { createHarness, maxCallsPerWindow, settleAll, sleep, USER_MODELS } from './support/harness.js';

const codes = (errors) => errors.map((e) => e.code);

test('distributes concurrent requests evenly across all 8 configured models', async () => {
  const { manager, provider } = createHarness({ models: USER_MODELS });
  const { ok, errors } = await settleAll(Array.from({ length: 96 }, () => manager.execute({})));

  assert.equal(errors.length, 0);
  assert.equal(ok.length, 96);
  const counts = provider.countsByModel();
  assert.deepEqual(Object.keys(counts).sort(), [...USER_MODELS].sort());
  for (const model of USER_MODELS) assert.equal(counts[model], 12, `${model} got ${counts[model]}`);
});

test('sequential requests rotate round-robin (no primary model)', async () => {
  const { manager } = createHarness();
  const used = [];
  for (let i = 0; i < 6; i++) used.push((await manager.execute({})).model);
  assert.deepEqual(used, ['model-a', 'model-b', 'model-c', 'model-a', 'model-b', 'model-c']);
});

test('minute limits are never exceeded under concurrent load; excess is queued and resumed', async () => {
  const windowMs = 300;
  const { manager, provider, events } = createHarness({ rpm: 3, windowMs });
  // 3 models x 3 rpm = 9 per window; 30 concurrent users need ~4 windows.
  const { ok, errors } = await settleAll(Array.from({ length: 30 }, () => manager.execute({})));

  assert.equal(errors.length, 0, `unexpected errors: ${codes(errors)}`);
  assert.equal(ok.length, 30);
  assert.equal(provider.violations.length, 0, 'provider saw a quota overrun');
  assert.ok(maxCallsPerWindow(provider.calls, windowMs) <= 3);
  assert.ok(events.some((e) => e.event === 'queue.enqueued'));
  assert.ok(events.some((e) => e.event === 'queue.resumed'));
  const counts = Object.values(provider.countsByModel());
  assert.equal(Math.max(...counts) - Math.min(...counts), 0, `uneven: ${counts}`);
});

test('daily quota: never exceeded, fails fast with a clear message once all models are exhausted', async () => {
  const { manager, provider } = createHarness({ rpm: 100, rpd: 4 });
  const { ok, errors } = await settleAll(Array.from({ length: 20 }, () => manager.execute({})));

  assert.equal(ok.length, 12);
  assert.equal(errors.length, 8);
  for (const err of errors) {
    assert.ok(err instanceof ModelManagerError);
    assert.equal(err.code, 'DAILY_QUOTA_EXHAUSTED');
    assert.equal(err.httpStatus, 429);
    assert.match(err.message, /AI Food Analyzer limit has been reached/);
    assert.ok(err.retryAfterMs > 0 && err.resetAt);
  }
  assert.deepEqual(provider.countsByModel(), { 'model-a': 4, 'model-b': 4, 'model-c': 4 });
  assert.equal(provider.violations.length, 0);
});

test('daily quota recovers automatically after the reset', async () => {
  const dayMs = 400;
  const { manager } = createHarness({ rpm: 100, rpd: 1, dayMs });
  // Align to the start of a fresh "day" so the test is deterministic.
  await sleep(dayMs - (Date.now() % dayMs) + 5);
  await settleAll([manager.execute({}), manager.execute({}), manager.execute({})]);
  await assert.rejects(manager.execute({}), { code: 'DAILY_QUOTA_EXHAUSTED' });

  await sleep(dayMs - (Date.now() % dayMs) + 5);
  const { ok } = await settleAll([manager.execute({}), manager.execute({}), manager.execute({})]);
  assert.equal(ok.length, 3);
});

test('a model returning 429 is skipped, then reintroduced after Retry-After', async () => {
  let throttled = false;
  const { manager, provider, events } = createHarness({
    provider: {
      behavior: ({ model }) => {
        if (model === 'model-a' && !throttled) {
          throttled = true;
          return { error: new ProviderError('rate_limit', 'busy', { status: 429, retryAfterMs: 150 }) };
        }
      },
    },
  });

  const first = await manager.execute({});
  assert.notEqual(first.model, 'model-a', 'should fail over away from the throttled model');
  assert.equal(first.attempts, 2);

  const callsBefore = provider.calls.length;
  for (let i = 0; i < 4; i++) await manager.execute({});
  const during = provider.calls.slice(callsBefore).map((c) => c.model);
  assert.ok(!during.includes('model-a'), `model-a used while blocked: ${during}`);

  await sleep(170);
  const after = [];
  for (let i = 0; i < 3; i++) after.push((await manager.execute({})).model);
  assert.ok(after.includes('model-a'), 'model-a should be reintroduced');
  assert.ok(events.some((e) => e.event === 'model.excluded' && e.model === 'model-a'));
  assert.ok(events.some((e) => e.event === 'model.reintroduced' && e.model === 'model-a'));
});

test('provider-reported daily quota blocks that model until the daily reset', async () => {
  const { manager, provider } = createHarness({
    provider: {
      behavior: ({ model }) => model === 'model-b'
        ? { error: new ProviderError('rate_limit', 'per day', { status: 429, quotaScope: 'day' }) }
        : undefined,
    },
  });
  for (let i = 0; i < 9; i++) await manager.execute({});
  const bCalls = provider.calls.filter((c) => c.model === 'model-b').length;
  assert.equal(bCalls, 1, 'model-b should be called once, then excluded for the day');
  const stats = await manager.getStats();
  assert.equal(stats.models.find((m) => m.model === 'model-b').status, 'daily_exhausted');
});

test('queue full rejects excess requests with QUEUE_FULL', async () => {
  const { manager } = createHarness({ rpm: 1, windowMs: 1_000, manager: { queueMaxSize: 2 } });
  const { ok, errors } = await settleAll(Array.from({ length: 8 }, () => manager.execute({})));
  // 3 served immediately, 2 queued (served after the window), 3 rejected.
  assert.equal(ok.length, 5);
  assert.deepEqual(codes(errors), ['QUEUE_FULL', 'QUEUE_FULL', 'QUEUE_FULL']);
  assert.ok(errors.every((e) => e.httpStatus === 503 && e.retryAfterMs > 0));
});

test('requests that cannot get capacity within the queue timeout are rejected, not left waiting', async () => {
  const { manager } = createHarness({ rpm: 1, windowMs: 2_000, manager: { queueTimeoutMs: 100 } });
  const { ok, errors } = await settleAll(Array.from({ length: 5 }, () => manager.execute({})));
  assert.equal(ok.length, 3);
  assert.deepEqual(codes(errors), ['CAPACITY_UNAVAILABLE', 'CAPACITY_UNAVAILABLE']);
  assert.ok(errors.every((e) => e.retryAfterMs > 0));
});

test('queue timeout fires when capacity is taken by others', async () => {
  // Expected capacity in 150ms, but the queue only waits 100ms -> QUEUE_TIMEOUT or early rejection.
  const { manager } = createHarness({ rpm: 1, windowMs: 150, marginMs: 0, manager: { queueTimeoutMs: 100 } });
  const { errors } = await settleAll(Array.from({ length: 5 }, () => manager.execute({})));
  assert.ok(errors.length === 2 && errors.every((e) => ['QUEUE_TIMEOUT', 'CAPACITY_UNAVAILABLE'].includes(e.code)));
});

test('transient server errors are retried with backoff and recover', async () => {
  let failures = 0;
  const { manager, events } = createHarness({
    provider: {
      behavior: () => (failures++ < 2 ? { error: new ProviderError('server', 'boom', { status: 503 }) } : undefined),
    },
  });
  const out = await manager.execute({});
  assert.equal(out.attempts, 3);
  assert.equal(events.filter((e) => e.event === 'retry.scheduled').length, 2);
});

test('retries are bounded: persistent failures stop after maxAttempts', async () => {
  const { manager, provider } = createHarness({
    provider: { behavior: () => ({ error: new ProviderError('network', 'ECONNRESET') }) },
  });
  await assert.rejects(manager.execute({}), { code: 'RETRIES_EXHAUSTED', httpStatus: 502 });
  assert.equal(provider.calls.length, 4);
});

test('a hanging provider call times out and the request fails over', async () => {
  let hung = false;
  const { manager } = createHarness({
    manager: { attemptTimeoutMs: 80 },
    provider: { behavior: () => (!hung && (hung = true) ? { hang: true } : undefined) },
  });
  const started = Date.now();
  const out = await manager.execute({});
  assert.equal(out.attempts, 2);
  assert.ok(Date.now() - started < 500);
});

test('request deadline bounds total time', async () => {
  const { manager } = createHarness({
    manager: { attemptTimeoutMs: 1_000, requestDeadlineMs: 120 },
    provider: { behavior: () => ({ hang: true }) },
  });
  const started = Date.now();
  await assert.rejects(manager.execute({}), (err) => ['DEADLINE_EXCEEDED', 'RETRIES_EXHAUSTED'].includes(err.code));
  assert.ok(Date.now() - started < 400);
});

test('auth errors are permanent: no retry, configuration error', async () => {
  const { manager, provider } = createHarness({
    provider: { behavior: () => ({ error: new ProviderError('auth', 'API key not valid', { status: 400 }) }) },
  });
  await assert.rejects(manager.execute({}), { code: 'PROVIDER_AUTH', httpStatus: 500 });
  assert.equal(provider.calls.length, 1);
});

test('bad requests are not retried and return 400', async () => {
  const { manager, provider } = createHarness({
    provider: { behavior: () => ({ error: new ProviderError('bad_request', 'Invalid image', { status: 400 }) }) },
  });
  await assert.rejects(manager.execute({}), (err) => {
    assert.equal(err.code, 'BAD_REQUEST');
    assert.equal(err.httpStatus, 400);
    assert.ok(!err.message.includes('Invalid image'), 'provider wording must not reach users');
    assert.equal(err.cause.message, 'Invalid image', 'details kept for logs');
    return true;
  });
  assert.equal(provider.calls.length, 1);
});

test('unknown / retired model (404) is disabled and traffic fails over', async () => {
  const { manager, provider } = createHarness({
    provider: {
      behavior: ({ model }) => model === 'model-a'
        ? { error: new ProviderError('model_not_found', 'models/model-a is not found', { status: 404 }) }
        : undefined,
    },
  });
  for (let i = 0; i < 9; i++) await manager.execute({});
  assert.equal(provider.calls.filter((c) => c.model === 'model-a').length, 1);
  const stats = await manager.getStats();
  assert.equal(stats.models.find((m) => m.model === 'model-a').status, 'disabled');
});

test('a model that is down (always 503) is circuit-broken, kept behind healthy models, and restored', async () => {
  let down = true;
  let othersBusy = false;
  const { manager, provider, events } = createHarness({
    manager: { circuitFailureThreshold: 2, circuitCooldownMs: 150 },
    provider: {
      behavior: ({ model }) => {
        if (model === 'model-a' && down) return { error: new ProviderError('server', 'unavailable', { status: 503 }) };
        if (model !== 'model-a' && othersBusy) return { error: new ProviderError('rate_limit', 'busy', { status: 429, retryAfterMs: 1_000 }) };
        return undefined;
      },
    },
  });

  for (let i = 0; i < 12; i++) await manager.execute({});
  assert.equal(provider.calls.filter((c) => c.model === 'model-a').length, 2, 'only threshold failures before the circuit opens');
  assert.ok(events.some((e) => e.event === 'circuit.opened' && e.model === 'model-a'));

  // Cooldown over, but healthy models exist: user requests are not sent to the recovering model.
  await sleep(170);
  for (let i = 0; i < 6; i++) await manager.execute({});
  assert.equal(provider.calls.filter((c) => c.model === 'model-a').length, 2);

  // Healthy models become unavailable -> the recovering model gets its trial, succeeds, circuit closes.
  down = false;
  othersBusy = true;
  const out = await manager.execute({});
  assert.equal(out.model, 'model-a');
  assert.ok(events.some((e) => e.event === 'circuit.closed' && e.model === 'model-a'));
});

test('circuit cooldown doubles after each failed trial, up to the max', async () => {
  const { manager, events } = createHarness({
    models: ['model-a'],
    manager: { circuitFailureThreshold: 1, circuitCooldownMs: 40, circuitMaxCooldownMs: 100, maxAttempts: 1 },
    provider: { behavior: () => ({ error: new ProviderError('server', 'unavailable', { status: 503 }) }) },
  });
  for (let i = 0; i < 4; i++) {
    await manager.execute({}).catch(() => {});
    await sleep(110);
  }
  const cooldowns = events.filter((e) => e.event === 'circuit.opened').map((e) => e.cooldownMs);
  assert.deepEqual(cooldowns, [40, 80, 100, 100]);
});

test('a model that hangs (down without responding) is circuit-broken after timeouts', async () => {
  const { manager, provider } = createHarness({
    manager: { attemptTimeoutMs: 50, circuitFailureThreshold: 2, circuitCooldownMs: 60_000 },
    provider: { behavior: ({ model }) => (model === 'model-b' ? { hang: true } : undefined) },
  });
  // Concurrent wave: calls already in flight to model-b before the circuit opens all time out
  // and fail over, so every user still gets a result.
  const results = await settleAll(Array.from({ length: 15 }, () => manager.execute({})));
  assert.equal(results.errors.length, 0);
  const afterWave = provider.calls.filter((c) => c.model === 'model-b').length;

  // Once open, no new traffic is sent to the hung model.
  await settleAll(Array.from({ length: 15 }, () => manager.execute({})));
  assert.equal(provider.calls.filter((c) => c.model === 'model-b').length, afterWave);
  const stats = await manager.getStats();
  assert.equal(stats.models.find((m) => m.model === 'model-b').status, 'unhealthy');
});

test('half-open circuit allows only one concurrent trial request to a recovering model', async () => {
  let othersBusy = false;
  const { manager, provider } = createHarness({
    manager: { attemptTimeoutMs: 60, circuitFailureThreshold: 1, circuitCooldownMs: 100 },
    provider: {
      behavior: ({ model }) => {
        if (model === 'model-a') return { hang: true };
        if (othersBusy) return { error: new ProviderError('rate_limit', 'busy', { status: 429, retryAfterMs: 150 }) };
        return undefined;
      },
    },
  });
  await manager.execute({}); // opens the circuit on model-a
  await sleep(120); // cooldown over -> half-open
  const waveStart = Date.now();
  othersBusy = true; // healthy models refuse, so the wave reaches the recovering model
  setTimeout(() => { othersBusy = false; }, 30);
  const { errors } = await settleAll(Array.from({ length: 20 }, () => manager.execute({})));
  assert.equal(errors.length, 0);
  // The trial times out at 60ms and re-opens the circuit for 200ms, so a second call to
  // model-a inside this span could only be a concurrent trial. (A later sequential trial is fine.)
  const trials = provider.calls.filter((c) => c.model === 'model-a' && c.at >= waveStart && c.at < waveStart + 200);
  assert.equal(trials.length, 1);
});

test('client abort while queued removes the request without calling the provider', async () => {
  const { manager, provider } = createHarness({ rpm: 1, windowMs: 1_000 });
  await settleAll([manager.execute({}), manager.execute({}), manager.execute({})]);
  const callsBefore = provider.calls.length;

  const ac = new AbortController();
  const pending = manager.execute({}, { signal: ac.signal });
  await sleep(20);
  assert.equal(manager.queue.length, 1);
  ac.abort();
  await assert.rejects(pending, { code: 'ABORTED' });
  assert.equal(manager.queue.length, 0);
  assert.equal(provider.calls.length, callsBefore);
});

test('shutdown rejects queued requests and refuses new ones', async () => {
  const { manager } = createHarness({ rpm: 1, windowMs: 2_000 });
  await settleAll([manager.execute({}), manager.execute({}), manager.execute({})]);
  const queued = manager.execute({});
  await sleep(10);
  await manager.shutdown({ timeoutMs: 100 });
  await assert.rejects(queued, { code: 'SHUTTING_DOWN' });
  await assert.rejects(manager.execute({}), { code: 'SHUTTING_DOWN' });
});

test('stats and health report quotas and remaining capacity', async () => {
  const { manager } = createHarness({ rpm: 5, rpd: 10 });
  for (let i = 0; i < 3; i++) await manager.execute({});
  const stats = await manager.getStats();
  assert.equal(stats.counters.succeeded, 3);
  for (const m of stats.models) {
    assert.equal(m.minute.used, 1);
    assert.equal(m.day.remaining, 9);
  }
  const health = await manager.health();
  assert.equal(health.status, 'ok');
  assert.equal(health.dailyRequestsRemaining, 27);
});

test('logs never contain the API key', async () => {
  const { manager, events } = createHarness({
    provider: {
      behavior: () => ({ error: new ProviderError('server', 'upstream error', { status: 500 }) }),
    },
  });
  await assert.rejects(manager.execute({}));
  const serialized = JSON.stringify(events);
  assert.ok(!/AIza|x-goog-api-key|key=/.test(serialized));
});
