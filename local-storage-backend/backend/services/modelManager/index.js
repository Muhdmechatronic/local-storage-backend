// Process-wide model manager instance, built from environment configuration.

import { logger } from '../../utils/logger.js';
import { ModelManager } from './ModelManager.js';
import { loadModelManagerConfig, createDailyWindow } from './config.js';
import { MemoryQuotaStore, RedisQuotaStore } from './quotaStores.js';
import { createGeminiProvider } from './geminiProvider.js';

export { ModelManager } from './ModelManager.js';
export { ModelManagerError, ProviderError } from './errors.js';

let instancePromise = null;

// Structured log line: "[models] <event> {json fields}". Fields never contain credentials.
export function structuredLog(level, event, fields) {
  const write = logger[level] ?? logger.info;
  write(`[models] ${event} ${JSON.stringify(fields)}`);
}

async function build() {
  const config = loadModelManagerConfig();
  const store = config.store.type === 'redis'
    ? await RedisQuotaStore.connect(config.store.redisUrl, config.store.keyPrefix)
    : new MemoryQuotaStore();
  const provider = createGeminiProvider({ apiKey: process.env.GEMINI_API_KEY });

  const manager = new ModelManager({
    ...config,
    store,
    provider,
    dailyWindow: createDailyWindow(config.dailyResetTimeZone),
    log: structuredLog,
  });

  structuredLog('info', 'manager.started', {
    provider: provider.name,
    store: store.type,
    models: config.models,
    minuteWindowMs: config.minuteWindowMs,
    dailyResetTimeZone: config.dailyResetTimeZone,
    queueMaxSize: config.queueMaxSize,
    queueTimeoutMs: config.queueTimeoutMs,
    maxAttempts: config.maxAttempts,
  });
  return manager;
}

export function getModelManager() {
  instancePromise ??= build().catch((err) => {
    instancePromise = null; // allow a later retry, e.g. if Redis was briefly unreachable
    throw err;
  });
  return instancePromise;
}

export async function shutdownModelManager() {
  if (!instancePromise) return;
  const manager = await instancePromise.catch(() => null);
  instancePromise = null;
  await manager?.shutdown();
}
