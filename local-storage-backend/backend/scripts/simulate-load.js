// Capacity profiling simulation against the MOCK provider (no real API calls, no API key needed).
//
// Uses the production configuration (loadModelManagerConfig(process.env)): same models, RPM/RPD,
// queue size/timeout, deadline, attempt timeout and retry settings. The mock model replies in
// 5-10 seconds like the real one. All durations are multiplied by SIM_TIME_SCALE so a run takes
// seconds instead of hours; every result is reported back in REAL seconds. SIM_TIME_SCALE=1 runs
// in true real time.
//
// Two scenarios, each stepped over increasing user counts (fresh quotas per step):
//   burst     - N users press "scan" at the same moment (worst case spike)
//   sustained - N users keep scanning for SIM_SUSTAINED_MINUTES, waiting SIM_THINK_MIN_S..MAX_S
//               between scans (normal app usage)
//
//   npm run simulate
//   SIM_TIME_SCALE=1 SIM_BURST_USERS=10,50 SIM_SUSTAINED_USERS=  npm run simulate
//   SIM_THINK_MIN_S=60 SIM_THINK_MAX_S=180 SIM_FAULT_RATE=0.05  npm run simulate

import { ModelManager } from '../services/modelManager/ModelManager.js';
import { MemoryQuotaStore } from '../services/modelManager/quotaStores.js';
import { ProviderError } from '../services/modelManager/errors.js';
import { loadModelManagerConfig } from '../services/modelManager/config.js';
import { createMockProvider, createFixedDailyWindow } from '../test/support/mockProvider.js';
import { maxCallsPerWindow } from '../test/support/harness.js';

const env = process.env;
const list = (v, d) => (v === undefined ? d : v.split(',').filter(Boolean).map(Number));
const SCALE = Number(env.SIM_TIME_SCALE ?? 0.05);
const LATENCY_MIN_S = Number(env.SIM_LATENCY_MIN_S ?? 5);
const LATENCY_MAX_S = Number(env.SIM_LATENCY_MAX_S ?? 10);
const FAULT_RATE = Number(env.SIM_FAULT_RATE ?? 0.02);
const BURST_USERS = list(env.SIM_BURST_USERS, [10, 25, 50, 75, 100, 150]);
const SUSTAINED_USERS = list(env.SIM_SUSTAINED_USERS, [25, 50, 100, 150, 200, 300]);
const SUSTAINED_MINUTES = Number(env.SIM_SUSTAINED_MINUTES ?? 5);
const THINK_MIN_S = Number(env.SIM_THINK_MIN_S ?? 30);
const THINK_MAX_S = Number(env.SIM_THINK_MAX_S ?? 90);
// A step "passes" when at least this share of scans succeed and p95 stays under the target.
const TARGET_SUCCESS = Number(env.SIM_TARGET_SUCCESS ?? 0.99);
const TARGET_P95_S = Number(env.SIM_TARGET_P95_S ?? 30);

const cfg = loadModelManagerConfig(env);
const scaled = (ms) => Math.max(1, Math.round(ms * SCALE));
const realS = (ms) => ms / SCALE / 1000;
const providerWindowMs = scaled(60_000);

// Outage scenario: first listed model hangs (no response at all), second returns 503 on every call.
const DOWN_MODELS = (env.SIM_DOWN_MODELS ?? 'gemini-3.8-flash,gemini-3.6-flash').split(',').filter(Boolean);
const OUTAGE_USERS = list(env.SIM_OUTAGE_USERS, [50, 100, 150]);

function faults({ model }, outage) {
  if (outage && model === DOWN_MODELS[0]) return { hang: true };
  if (outage && DOWN_MODELS.slice(1).includes(model)) return { error: new ProviderError('server', 'mock outage 503', { status: 503 }) };
  const r = Math.random();
  if (r < FAULT_RATE * 0.4) return { error: new ProviderError('server', 'mock 503', { status: 503 }) };
  if (r < FAULT_RATE * 0.6) return { error: new ProviderError('network', 'mock ECONNRESET') };
  if (r < FAULT_RATE * 0.8) return { error: new ProviderError('rate_limit', 'mock 429', { status: 429, retryAfterMs: scaled(15_000) }) };
  if (r < FAULT_RATE) return { hang: true };
  return undefined;
}

function buildSystem(outage) {
  const dailyWindow = createFixedDailyWindow(scaled(86_400_000));
  const provider = createMockProvider({
    latencyMs: scaled(LATENCY_MIN_S * 1000),
    jitterMs: scaled((LATENCY_MAX_S - LATENCY_MIN_S) * 1000),
    limits: { rpm: cfg.models[0].rpm, rpd: cfg.models[0].rpd, windowMs: providerWindowMs, dailyWindow },
    behavior: (ctx) => faults(ctx, outage),
  });
  const manager = new ModelManager({
    ...cfg,
    store: new MemoryQuotaStore(),
    provider,
    dailyWindow,
    minuteWindowMs: scaled(cfg.minuteWindowMs),
    queueTimeoutMs: scaled(cfg.queueTimeoutMs),
    requestDeadlineMs: scaled(cfg.requestDeadlineMs),
    attemptTimeoutMs: scaled(cfg.attemptTimeoutMs),
    backoffBaseMs: scaled(cfg.backoffBaseMs),
    backoffMaxMs: scaled(cfg.backoffMaxMs),
    rateLimitCooldownMs: scaled(cfg.rateLimitCooldownMs),
    modelDisableMs: scaled(cfg.modelDisableMs),
    circuitCooldownMs: scaled(cfg.circuitCooldownMs),
  });
  return { manager, provider };
}

async function scanOnce(manager, sample) {
  const t0 = Date.now();
  try {
    await manager.execute({ image: 'mock' });
    sample.latencies.push(Date.now() - t0);
    sample.outcomes.success = (sample.outcomes.success ?? 0) + 1;
  } catch (err) {
    sample.outcomes[err.code] = (sample.outcomes[err.code] ?? 0) + 1;
  }
}

async function runStep(mode, users) {
  const outage = mode === 'outage';
  const { manager, provider } = buildSystem(outage);
  const sample = { latencies: [], outcomes: {} };
  let peakQueue = 0;
  const probe = setInterval(() => { peakQueue = Math.max(peakQueue, manager.queue.length); }, 5);
  const started = Date.now();

  if (mode === 'burst') {
    await Promise.all(Array.from({ length: users }, () => scanOnce(manager, sample)));
  } else {
    const stopAt = started + scaled(SUSTAINED_MINUTES * 60_000);
    const think = () => scaled((THINK_MIN_S + Math.random() * (THINK_MAX_S - THINK_MIN_S)) * 1000);
    await Promise.all(Array.from({ length: users }, async () => {
      // Stagger first scans across one think period so users don't all start in the same instant.
      await new Promise((r) => setTimeout(r, Math.random() * think()));
      while (Date.now() < stopAt) {
        await scanOnce(manager, sample);
        await new Promise((r) => setTimeout(r, think()));
      }
    }));
  }

  clearInterval(probe);
  const elapsed = Date.now() - started;
  await manager.shutdown({ timeoutMs: 50 });

  const total = Object.values(sample.outcomes).reduce((a, b) => a + b, 0);
  const ok = sample.outcomes.success ?? 0;
  const lat = sample.latencies.sort((a, b) => a - b);
  const pct = (p) => (lat.length ? realS(lat[Math.min(lat.length - 1, Math.floor(lat.length * p))]) : 0);
  const rejected = Object.entries(sample.outcomes).filter(([k]) => k !== 'success').map(([k, v]) => `${k}:${v}`).join(' ');
  const successRate = total ? ok / total : 1;
  const downCalls = provider.calls.filter((c) => DOWN_MODELS.includes(c.model)).length;
  return {
    users,
    scans: total,
    'success %': +(successRate * 100).toFixed(1),
    'p50 s': +pct(0.5).toFixed(1),
    'p95 s': +pct(0.95).toFixed(1),
    'max s': +pct(1).toFixed(1),
    'scans/min': +(ok / (realS(elapsed) / 60)).toFixed(1),
    'peak queue': peakQueue,
    'max/model/min': maxCallsPerWindow(provider.calls, providerWindowMs),
    violations: provider.violations.length,
    ...(outage && { 'calls to down models': `${downCalls}/${provider.calls.length}` }),
    rejected: rejected || '-',
    pass: successRate >= TARGET_SUCCESS && pct(0.95) <= TARGET_P95_S,
  };
}

const rpm = cfg.models.reduce((s, m) => s + m.rpm, 0);
const rpd = cfg.models.reduce((s, m) => s + m.rpd, 0);
const avgCycleS = (LATENCY_MIN_S + LATENCY_MAX_S) / 2 + (THINK_MIN_S + THINK_MAX_S) / 2;

console.log('=== Scan capacity profile (mock provider, no real API calls) ===');
console.log(`Models: ${cfg.models.length} (${cfg.models.map((m) => m.name).join(', ')})`);
console.log(`Per model: ${cfg.models[0].rpm} rpm / ${cfg.models[0].rpd} rpd  ->  total ${rpm} scans/min, ${rpd} scans/day`);
console.log(`Model latency ${LATENCY_MIN_S}-${LATENCY_MAX_S}s | queue ${cfg.queueMaxSize} slots / ${cfg.queueTimeoutMs / 1000}s | deadline ${cfg.requestDeadlineMs / 1000}s | attempts ${cfg.maxAttempts} | fault rate ${(FAULT_RATE * 100).toFixed(0)}%`);
console.log(`Time scale ${SCALE} (1 real minute = ${scaled(60_000)}ms). Pass target: >=${TARGET_SUCCESS * 100}% success and p95 <= ${TARGET_P95_S}s\n`);

const results = {};
const TITLES = {
  burst: 'BURST: N users press scan at the same moment (one scan each)',
  sustained: `SUSTAINED: N users scanning for ${SUSTAINED_MINUTES} min, ${THINK_MIN_S}-${THINK_MAX_S}s between scans`,
  outage: `OUTAGE: sustained load while ${DOWN_MODELS[0]} hangs and ${DOWN_MODELS.slice(1).join(', ')} returns 503 on every call`,
};
for (const [mode, steps] of [['burst', BURST_USERS], ['sustained', SUSTAINED_USERS], ['outage', OUTAGE_USERS]]) {
  if (!steps.length) continue;
  console.log(TITLES[mode]);
  results[mode] = [];
  for (const users of steps) results[mode].push(await runStep(mode, users));
  console.table(results[mode]);
}

console.log('=== Summary ===');
for (const [mode, rows] of Object.entries(results)) {
  const best = rows.filter((r) => r.pass).at(-1);
  console.log(`${mode.padEnd(9)} max users meeting target: ${best ? best.users : `< ${rows[0].users}`}${rows.every((r) => r.pass) ? ' (all steps passed; try higher counts)' : ''}`);
}
console.log(`Theory: ${rpm} scans/min sustained. With ~${avgCycleS.toFixed(0)}s per user cycle (scan + think) that is ~${Math.floor(rpm * avgCycleS / 60)} continuously active users.`);
console.log(`Daily cap: ${rpd} scans/day total (e.g. ~${Math.floor(rpd / 5)} users at 5 scans/day each).`);

const violations = Object.values(results).flat().reduce((s, r) => s + r.violations, 0);
console.log(violations === 0 ? '\nQuota enforcement: PASS (0 provider-side overruns)' : `\nQuota enforcement: FAIL (${violations} overruns)`);
process.exit(violations === 0 ? 0 : 1);
