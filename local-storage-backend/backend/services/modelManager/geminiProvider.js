// Gemini generateContent adapter. Performs exactly one HTTP call per invocation and
// converts every failure into a classified ProviderError. Retries live in ModelManager.

import { ProviderError, redactSecrets } from './errors.js';

export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === '') return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

// google.rpc.RetryInfo.retryDelay is a protobuf Duration string such as "34s" or "1.5s".
function parseDuration(value) {
  const m = /^(\d+(?:\.\d+)?)s$/.exec(String(value ?? '').trim());
  return m ? Math.ceil(Number(m[1]) * 1000) : undefined;
}

export function classifyGeminiError(status, payload, retryAfterHeader) {
  const error = payload?.error ?? {};
  const details = Array.isArray(error.details) ? error.details : [];
  const typeOf = (d) => String(d?.['@type'] ?? '');
  const retryInfo = details.find((d) => typeOf(d).endsWith('google.rpc.RetryInfo'));
  const quotaIds = details
    .filter((d) => typeOf(d).endsWith('google.rpc.QuotaFailure'))
    .flatMap((d) => d.violations ?? [])
    .map((v) => String(v.quotaId ?? v.quotaMetric ?? ''));
  const reasons = details.filter((d) => typeOf(d).endsWith('google.rpc.ErrorInfo')).map((d) => String(d.reason ?? ''));

  const message = redactSecrets(error.message || `HTTP ${status}`);
  const opts = {
    status,
    retryAfterMs: parseRetryAfter(retryAfterHeader) ?? parseDuration(retryInfo?.retryDelay),
    quotaScope: quotaIds.some((q) => /PerDay/i.test(q)) ? 'day'
      : quotaIds.some((q) => /PerMinute/i.test(q)) ? 'minute'
        : undefined,
  };

  if (status === 429) return new ProviderError('rate_limit', message, opts);
  // Gemini reports an invalid key as 400 INVALID_ARGUMENT with reason API_KEY_INVALID.
  if (status === 401 || status === 403 || reasons.some((r) => r.startsWith('API_KEY')) || (status === 400 && /api key/i.test(message))) {
    return new ProviderError('auth', message, opts);
  }
  if (status === 404) return new ProviderError('model_not_found', message, opts);
  if (status === 408) return new ProviderError('timeout', message, opts);
  if (status >= 500) return new ProviderError('server', message, opts);
  return new ProviderError('bad_request', message, opts);
}

export function createGeminiProvider({
  apiKey,
  baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
  fetchImpl = globalThis.fetch,
} = {}) {
  return {
    name: 'gemini',
    async generate({ model, body, signal }) {
      if (!apiKey) throw new ProviderError('auth', 'Gemini API key not configured');
      try {
        // Key goes in a header, never the URL, so it cannot leak through error messages or proxies' access logs.
        const response = await fetchImpl(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(body),
          signal,
        });
        if (response.ok) {
          try {
            return await response.json();
          } catch (err) {
            if (signal?.aborted) throw err;
            throw new ProviderError('server', 'Provider returned invalid JSON', { status: response.status });
          }
        }
        let payload = null;
        try {
          payload = await response.json();
        } catch {
          // Non-JSON error body; classify by status alone.
        }
        throw classifyGeminiError(response.status, payload, response.headers?.get?.('retry-after'));
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        if (signal?.aborted) {
          throw signal.reason instanceof ProviderError ? signal.reason : new ProviderError('aborted', 'Request aborted');
        }
        throw new ProviderError('network', redactSecrets(err?.cause?.code ?? err?.message ?? 'Network error'));
      }
    },
  };
}
