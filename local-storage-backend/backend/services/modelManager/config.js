// Environment-driven configuration for the model manager.

export const DEFAULT_MODELS = [
  'gemini-2.5-flash',
  'gemini-1.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite',
  'gemma-4-26b-a4b-it',
];

function num(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${name}="${raw}": expected a non-negative number`);
  }
  return Math.floor(value);
}

export function loadModelManagerConfig(env = process.env) {
  const names = [...new Set(
    (env.GEMINI_MODELS ? env.GEMINI_MODELS.split(',') : DEFAULT_MODELS)
      .map((s) => s.trim())
      .filter(Boolean)
  )];
  if (names.length === 0) throw new Error('GEMINI_MODELS must list at least one model');

  const rpm = num(env, 'MODEL_RPM_LIMIT', 15);
  const rpd = num(env, 'MODEL_RPD_LIMIT', 150);

  // Optional per-model overrides, e.g. {"gemma-4-26b-a4b-it":{"rpm":30,"rpd":14400}}
  let overrides = {};
  if (env.MODEL_LIMIT_OVERRIDES) {
    try {
      overrides = JSON.parse(env.MODEL_LIMIT_OVERRIDES);
    } catch {
      throw new Error('MODEL_LIMIT_OVERRIDES must be valid JSON');
    }
  }

  const storeType = (env.QUOTA_STORE || 'memory').toLowerCase();
  if (!['memory', 'redis'].includes(storeType)) throw new Error(`Invalid QUOTA_STORE="${storeType}"`);

  return {
    models: names.map((name) => ({
      name,
      rpm: overrides[name]?.rpm ?? rpm,
      rpd: overrides[name]?.rpd ?? rpd,
    })),
    // Provider RPM window is 60s; the margin absorbs clock skew and network delay between
    // our reservation time and the moment the provider counts the request.
    minuteWindowMs: 60_000 + num(env, 'MODEL_RPM_WINDOW_MARGIN_MS', 1_000),
    dailyResetTimeZone: env.MODEL_RPD_RESET_TZ || 'America/Los_Angeles',
    queueMaxSize: num(env, 'SCAN_QUEUE_MAX_SIZE', 50),
    queueTimeoutMs: num(env, 'SCAN_QUEUE_TIMEOUT_MS', 30_000),
    requestDeadlineMs: num(env, 'SCAN_REQUEST_DEADLINE_MS', 60_000),
    attemptTimeoutMs: num(env, 'SCAN_ATTEMPT_TIMEOUT_MS', 25_000),
    maxAttempts: Math.max(1, num(env, 'SCAN_MAX_ATTEMPTS', 4)),
    backoffBaseMs: num(env, 'SCAN_BACKOFF_BASE_MS', 500),
    backoffMaxMs: num(env, 'SCAN_BACKOFF_MAX_MS', 8_000),
    rateLimitCooldownMs: num(env, 'SCAN_RATE_LIMIT_COOLDOWN_MS', 60_000),
    modelDisableMs: num(env, 'SCAN_MODEL_DISABLE_MS', 10 * 60_000),
    circuitFailureThreshold: Math.max(1, num(env, 'SCAN_CIRCUIT_FAILURE_THRESHOLD', 3)),
    circuitCooldownMs: num(env, 'SCAN_CIRCUIT_COOLDOWN_MS', 60_000),
    store: {
      type: storeType,
      redisUrl: env.REDIS_URL,
      keyPrefix: env.QUOTA_KEY_PREFIX || 'scanquota',
    },
  };
}

/**
 * Returns a function mapping a timestamp to the provider's daily quota window:
 * { key: 'YYYY-MM-DD' in the reset time zone, resetAt: ms timestamp of the next reset }.
 * Gemini documents RPD resets at midnight Pacific time. resetAt can be off by up to
 * one hour on DST-change days; the key (which drives the actual reset) is always exact.
 */
export function createDailyWindow(timeZone = 'America/Los_Angeles') {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  return (now) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
    const msIntoDay = ((Number(p.hour) * 60 + Number(p.minute)) * 60 + Number(p.second)) * 1000 + (now % 1000);
    return { key: `${p.year}-${p.month}-${p.day}`, resetAt: now - msIntoDay + 86_400_000 };
  };
}
