// TEST-ONLY helpers to build a ModelManager wired to the mock provider with short windows.

import { ModelManager } from '../../services/modelManager/ModelManager.js';
import { MemoryQuotaStore } from '../../services/modelManager/quotaStores.js';
import { createMockProvider, createFixedDailyWindow } from './mockProvider.js';

export const USER_MODELS = [
  'gemini-2.5-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite',
  'gemma-4-26b-a4b-it',
];

export function createHarness({
  models = ['model-a', 'model-b', 'model-c'],
  rpm = 15,
  rpd = 150,
  windowMs = 300,
  marginMs = 20,
  dayMs = 60_000,
  provider: providerOpts = {},
  manager: managerOpts = {},
} = {}) {
  const dailyWindow = createFixedDailyWindow(dayMs);
  const events = [];
  const provider = createMockProvider({
    latencyMs: 5,
    // The provider enforces the real window; the manager uses window + margin, like production.
    limits: { rpm, rpd, windowMs, dailyWindow },
    ...providerOpts,
  });
  const manager = new ModelManager({
    models: models.map((name) => ({ name, rpm, rpd })),
    store: new MemoryQuotaStore(),
    provider,
    dailyWindow,
    minuteWindowMs: windowMs + marginMs,
    queueMaxSize: 1000,
    queueTimeoutMs: 10_000,
    requestDeadlineMs: 15_000,
    attemptTimeoutMs: 1_000,
    maxAttempts: 4,
    backoffBaseMs: 5,
    backoffMaxMs: 40,
    rateLimitCooldownMs: 200,
    modelDisableMs: 60_000,
    log: (level, event, fields) => events.push({ level, event, ...fields }),
    ...managerOpts,
  });
  return { manager, provider, events, dailyWindow };
}

// Max number of calls any model received inside any sliding window of `windowMs`.
export function maxCallsPerWindow(calls, windowMs) {
  const byModel = {};
  for (const c of calls) (byModel[c.model] ??= []).push(c.at);
  let max = 0;
  for (const times of Object.values(byModel)) {
    times.sort((a, b) => a - b);
    let lo = 0;
    for (let hi = 0; hi < times.length; hi++) {
      while (times[hi] - times[lo] >= windowMs) lo++;
      max = Math.max(max, hi - lo + 1);
    }
  }
  return max;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function settleAll(promises) {
  const results = await Promise.allSettled(promises);
  return {
    ok: results.filter((r) => r.status === 'fulfilled').map((r) => r.value),
    errors: results.filter((r) => r.status === 'rejected').map((r) => r.reason),
  };
}
