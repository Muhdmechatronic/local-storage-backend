// TEST-ONLY fake provider used by automated tests and the load simulation.
// Never imported by production code. It never touches the network; it records every
// call and enforces its own provider-side limits so tests can independently detect
// any quota overrun.

import { ProviderError } from '../../services/modelManager/errors.js';

// Fixed-length "days" so daily-quota resets can be tested in milliseconds.
export function createFixedDailyWindow(dayMs) {
  return (now) => {
    const index = Math.floor(now / dayMs);
    return { key: `d${index}`, resetAt: (index + 1) * dayMs };
  };
}

const FAKE_SCAN = {
  foodName: 'Mock Nasi Lemak with Fried Chicken and Egg',
  foodNameMalay: 'Nasi Lemak dengan Ayam Goreng dan Telur (Mock)',
  calories: 750, protein: 32, carbs: 80, fat: 33, fiber: 4,
  servingSize: '1 plate (450g)', confidence: 0.5,
  category: 'Rice & Grain', type: 'Moderate',
  description: 'Mock response generated without calling a real AI provider.',
};

export function fakeGeminiResponse(model) {
  return {
    candidates: [{ content: { parts: [{ text: JSON.stringify(FAKE_SCAN) }], role: 'model' }, finishReason: 'STOP' }],
    modelVersion: model,
  };
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * @param {object} opts
 * @param {number} [opts.latencyMs]   base latency per call
 * @param {number} [opts.jitterMs]    random extra latency
 * @param {{rpm:number, rpd:number, windowMs:number, dailyWindow:(now:number)=>{key:string}}} [opts.limits]
 *        provider-side enforcement; overruns are recorded in `violations` and answered with 429
 * @param {(ctx:{model:string, call:number, modelCall:number}) => (void | {error?: ProviderError, hang?: boolean, latencyMs?: number})} [opts.behavior]
 *        scripted failures per call
 */
export function createMockProvider({ latencyMs = 10, jitterMs = 0, limits, behavior, now = Date.now, random = Math.random } = {}) {
  const calls = [];
  const violations = [];
  const perModel = new Map();
  const dayCounts = new Map();

  return {
    name: 'mock',
    calls,
    violations,
    countsByModel() {
      const out = {};
      for (const c of calls) out[c.model] = (out[c.model] ?? 0) + 1;
      return out;
    },
    async generate({ model, body, signal }) {
      const t = now();
      const history = perModel.get(model) ?? [];
      perModel.set(model, history);
      history.push(t);
      const call = { model, at: t, index: calls.length };
      calls.push(call);

      if (limits) {
        const inWindow = history.filter((ts) => t - ts < limits.windowMs).length;
        const dayKey = `${model}:${limits.dailyWindow(t).key}`;
        const dayCount = (dayCounts.get(dayKey) ?? 0) + 1;
        dayCounts.set(dayKey, dayCount);
        if (inWindow > limits.rpm || dayCount > limits.rpd) {
          const scope = dayCount > limits.rpd ? 'day' : 'minute';
          violations.push({ model, at: t, scope, inWindow, dayCount });
          throw new ProviderError('rate_limit', `Mock ${scope} quota exceeded`, { status: 429, quotaScope: scope });
        }
      }

      const action = behavior?.({ model, call: call.index, modelCall: history.length - 1, body }) ?? {};
      if (action.hang) {
        // Ignores the abort signal on purpose: the manager must still time out.
        await new Promise(() => {});
      }
      await wait((action.latencyMs ?? latencyMs) + Math.round(random() * jitterMs), signal);
      if (action.error) throw action.error;
      return fakeGeminiResponse(model);
    },
  };
}
