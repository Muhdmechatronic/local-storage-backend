import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiProvider, classifyGeminiError, parseRetryAfter } from '../services/modelManager/geminiProvider.js';

// Stubbed fetch: no real network calls are made in these tests.
function stubFetch(status, payload, headers = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
      json: async () => payload,
    };
  };
  return { fetchImpl, calls };
}

const FAKE_KEY = 'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE00';

test('sends the API key as a header, never in the URL', async () => {
  const { fetchImpl, calls } = stubFetch(200, { candidates: [] });
  const provider = createGeminiProvider({ apiKey: FAKE_KEY, fetchImpl });
  await provider.generate({ model: 'gemini-2.5-flash', body: {} });
  assert.ok(!calls[0].url.includes(FAKE_KEY));
  assert.ok(!calls[0].url.includes('key='));
  assert.equal(calls[0].init.headers['x-goog-api-key'], FAKE_KEY);
  assert.match(calls[0].url, /models\/gemini-2\.5-flash:generateContent$/);
});

test('429 with RetryInfo and per-day QuotaFailure -> rate_limit, day scope', () => {
  const err = classifyGeminiError(429, {
    error: {
      code: 429,
      message: 'You exceeded your current quota',
      status: 'RESOURCE_EXHAUSTED',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '34s' },
      ],
    },
  });
  assert.equal(err.kind, 'rate_limit');
  assert.equal(err.quotaScope, 'day');
  assert.equal(err.retryAfterMs, 34_000);
});

test('Retry-After header takes priority', () => {
  const err = classifyGeminiError(429, null, '7');
  assert.equal(err.kind, 'rate_limit');
  assert.equal(err.retryAfterMs, 7_000);
  assert.equal(parseRetryAfter(new Date(Date.now() + 5_000).toUTCString()) > 3_000, true);
});

test('invalid API key (400 API_KEY_INVALID) is classified as auth', () => {
  const err = classifyGeminiError(400, {
    error: {
      message: 'API key not valid. Please pass a valid API key.',
      details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }],
    },
  });
  assert.equal(err.kind, 'auth');
  assert.equal(classifyGeminiError(403, {}).kind, 'auth');
});

test('status classification: 404, 400, 500, 503, 408', () => {
  assert.equal(classifyGeminiError(404, {}).kind, 'model_not_found');
  assert.equal(classifyGeminiError(400, { error: { message: 'Invalid image' } }).kind, 'bad_request');
  assert.equal(classifyGeminiError(500, {}).kind, 'server');
  assert.equal(classifyGeminiError(503, {}).kind, 'server');
  assert.equal(classifyGeminiError(408, {}).kind, 'timeout');
});

test('network errors are classified and redacted', async () => {
  const provider = createGeminiProvider({
    apiKey: FAKE_KEY,
    fetchImpl: async () => { throw new TypeError(`fetch failed for ?key=${FAKE_KEY}`); },
  });
  await assert.rejects(provider.generate({ model: 'm', body: {} }), (err) => {
    assert.equal(err.kind, 'network');
    assert.ok(!err.message.includes(FAKE_KEY));
    return true;
  });
});

test('aborted fetch reports the abort reason (timeout)', async () => {
  const ac = new AbortController();
  const provider = createGeminiProvider({
    apiKey: FAKE_KEY,
    fetchImpl: (url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }),
  });
  const pending = provider.generate({ model: 'm', body: {}, signal: ac.signal });
  const { ProviderError } = await import('../services/modelManager/errors.js');
  ac.abort(new ProviderError('timeout', 'too slow'));
  await assert.rejects(pending, { kind: 'timeout' });
});

test('missing API key fails as auth without calling fetch', async () => {
  const { fetchImpl, calls } = stubFetch(200, {});
  await assert.rejects(createGeminiProvider({ fetchImpl }).generate({ model: 'm', body: {} }), { kind: 'auth' });
  assert.equal(calls.length, 0);
});
