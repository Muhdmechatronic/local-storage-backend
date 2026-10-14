// Multi-model load balancer.
//
// - Round-robin across all models (no primary). Each request starts at the next model in the
//   rotation; models that are limited are skipped and the rotation continues after the model used.
// - Every provider call is preceded by an atomic quota reservation (store.tryReserve), so per-model
//   minute (sliding window) and daily limits can never be exceeded, even under concurrency.
// - When every model is minute-limited, requests wait in a bounded FIFO queue and are resumed
//   when the earliest model regains capacity. When every model's daily quota is gone, requests
//   fail fast with DAILY_QUOTA_EXHAUSTED.
// - Provider failures are classified: 429 blocks the model (Retry-After / daily reset) and fails
//   over; 5xx / timeouts / network errors retry with exponential backoff + full jitter; auth and
//   bad-request errors stop immediately. Attempts are bounded by maxAttempts and the request deadline.

import { randomUUID } from 'node:crypto';
import { ModelManagerError, ProviderError } from './errors.js';

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ModelManagerError('ABORTED'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ModelManagerError('ABORTED'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

export class ModelManager {
  constructor(opts) {
    const { models, store, provider, dailyWindow } = opts;
    if (!models?.length) throw new Error('ModelManager requires at least one model');
    if (!store || !provider || !dailyWindow) throw new Error('ModelManager requires store, provider and dailyWindow');

    this.models = models.map(({ name, rpm, rpd }) => ({ name, rpm, rpd }));
    this.store = store;
    this.provider = provider;
    this.dailyWindow = dailyWindow;
    this.log = opts.log ?? (() => {});
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;

    this.minuteWindowMs = opts.minuteWindowMs ?? 61_000;
    this.queueMaxSize = opts.queueMaxSize ?? 50;
    this.queueTimeoutMs = opts.queueTimeoutMs ?? 30_000;
    this.requestDeadlineMs = opts.requestDeadlineMs ?? 60_000;
    this.attemptTimeoutMs = opts.attemptTimeoutMs ?? 25_000;
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 4);
    this.backoffBaseMs = opts.backoffBaseMs ?? 500;
    this.backoffMaxMs = opts.backoffMaxMs ?? 8_000;
    this.rateLimitCooldownMs = opts.rateLimitCooldownMs ?? 60_000;
    this.modelDisableMs = opts.modelDisableMs ?? 10 * 60_000;
    // Circuit breaker for models that are down (repeated 5xx / timeouts / network errors).
    this.circuitFailureThreshold = Math.max(1, opts.circuitFailureThreshold ?? 3);
    this.circuitCooldownMs = opts.circuitCooldownMs ?? 60_000;
    this.consecutiveFailures = new Map(); // model -> consecutive transient failures (in-process)
    this.halfOpenTrials = new Set(); // models with their single half-open trial request in flight

    this.cursor = 0;
    this.queue = [];
    this.pumping = false;
    this.pumpAgain = false;
    this.pumpTimer = null;
    this.closed = false;
    this.inFlight = new Set();
    this.limited = new Map(); // model -> reason, for limited/reintroduced transition logs

    this.counters = {
      requests: 0, succeeded: 0, failed: 0, attempts: 0, retries: 0, failovers: 0,
      queued: 0, dequeued: 0, queueRejected: 0, leasesReleased: 0,
    };
    this.errorsByCode = {};
    this.modelCounters = Object.fromEntries(
      this.models.map((m) => [m.name, { selected: 0, succeeded: 0, failed: 0, lastError: null }])
    );
  }

  /**
   * Runs one provider request with load balancing, quotas, queueing and retries.
   * Resolves { result, model, attempts } or rejects with ModelManagerError.
   */
  async execute(body, { requestId = randomUUID().slice(0, 8), signal, deadlineMs, validate } = {}) {
    if (this.closed) throw new ModelManagerError('SHUTTING_DOWN');
    const deadline = this.now() + (deadlineMs ?? this.requestDeadlineMs);
    this.counters.requests++;

    const run = this.#run(body, requestId, deadline, signal, validate);
    this.inFlight.add(run);
    try {
      const out = await run;
      this.counters.succeeded++;
      return out;
    } catch (raw) {
      const err = raw instanceof ModelManagerError ? raw : new ModelManagerError('INTERNAL', undefined, { cause: raw });
      this.counters.failed++;
      this.errorsByCode[err.code] = (this.errorsByCode[err.code] ?? 0) + 1;
      this.log(err.code === 'ABORTED' ? 'info' : 'error', 'request.failed', {
        requestId, code: err.code, retryAfterMs: err.retryAfterMs, cause: err.cause?.message,
      });
      throw err;
    } finally {
      this.inFlight.delete(run);
    }
  }

  // validate(result) may transform the provider result; if it throws, the reply is treated
  // as unusable and the request moves to another model.
  async #run(body, requestId, deadline, signal, validate) {
    let lastError = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (signal?.aborted) throw new ModelManagerError('ABORTED');
      if (this.now() >= deadline) throw new ModelManagerError('DEADLINE_EXCEEDED', undefined, { cause: lastError });

      const lease = await this.#acquire(requestId, deadline, signal);
      const { model } = lease;
      const stats = this.modelCounters[model];
      this.counters.attempts++;
      if (attempt > 1) this.counters.retries++;
      stats.selected++;
      this.log('info', 'model.selected', {
        requestId, model, attempt,
        minuteRemaining: lease.rpm - lease.minuteUsed,
        dayRemaining: lease.rpd - lease.dayUsed,
      });

      const startedAt = this.now();
      try {
        const raw = await this.#callProvider(model, body, deadline, signal).finally(() => {
          if (lease.halfOpenTrial) this.halfOpenTrials.delete(model);
        });
        let result = raw;
        if (validate) {
          try {
            result = validate(raw);
          } catch (err) {
            throw new ProviderError('invalid_response', err?.message ?? 'Invalid AI response');
          }
        }
        stats.succeeded++;
        if (this.consecutiveFailures.get(model) >= this.circuitFailureThreshold) {
          this.log('info', 'circuit.closed', { requestId, model });
        }
        this.consecutiveFailures.delete(model);
        this.log('success', 'model.succeeded', { requestId, model, attempt, latencyMs: this.now() - startedAt });
        return { result, model, attempts: attempt };
      } catch (raw) {
        const err = raw instanceof ProviderError ? raw : new ProviderError('unknown', raw?.message ?? String(raw));
        lastError = err;
        stats.failed++;
        stats.lastError = { kind: err.kind, status: err.status ?? null, at: iso(this.now()) };
        this.log('warn', 'model.failed', {
          requestId, model, attempt, kind: err.kind, status: err.status, message: err.message,
          latencyMs: this.now() - startedAt,
        });

        switch (err.kind) {
          case 'aborted':
            throw new ModelManagerError('ABORTED', undefined, { cause: err });
          case 'auth':
            throw new ModelManagerError('PROVIDER_AUTH', undefined, { cause: err });
          case 'bad_request':
            // Provider's technical message stays in the logs (model.failed / request.failed).
            throw new ModelManagerError('BAD_REQUEST', undefined, { cause: err });
          case 'rate_limit': {
            const now = this.now();
            if (err.quotaScope === 'day') {
              await this.#blockModel(model, this.dailyWindow(now).resetAt, 'daily', requestId);
            } else {
              await this.#blockModel(model, now + (err.retryAfterMs ?? this.rateLimitCooldownMs), 'rate_limited', requestId);
            }
            this.counters.failovers++;
            break; // fail over to the next model without backoff
          }
          case 'model_not_found':
            await this.#blockModel(model, this.now() + this.modelDisableMs, 'disabled', requestId);
            this.counters.failovers++;
            break;
          case 'invalid_response':
            // The model answered but the content was unusable: try another model right away.
            this.counters.failovers++;
            break;
          case 'server':
          case 'timeout':
          case 'network': {
            // After the threshold the model is excluded for a cooldown. The counter is only reset
            // by a success, so after the cooldown a single failed trial request re-opens it.
            const failures = (this.consecutiveFailures.get(model) ?? 0) + 1;
            this.consecutiveFailures.set(model, failures);
            if (failures >= this.circuitFailureThreshold) {
              this.log('warn', 'circuit.opened', { requestId, model, consecutiveFailures: failures, cooldownMs: this.circuitCooldownMs });
              await this.#blockModel(model, this.now() + this.circuitCooldownMs, 'unhealthy', requestId);
              this.counters.failovers++;
            }
            if (attempt < this.maxAttempts) {
              const delayMs = this.#backoff(attempt, deadline);
              this.log('info', 'retry.scheduled', { requestId, attempt, nextAttempt: attempt + 1, delayMs, reason: err.kind });
              await sleep(delayMs, signal);
            }
            break;
          }
          default:
            throw new ModelManagerError('INTERNAL', undefined, { cause: err });
        }
      }
    }
    const code = lastError?.kind === 'invalid_response' ? 'INVALID_AI_RESPONSE' : 'RETRIES_EXHAUSTED';
    throw new ModelManagerError(code, undefined, { cause: lastError });
  }

  // Full-jitter exponential backoff, clipped so it never sleeps past the deadline.
  #backoff(attempt, deadline) {
    const cap = Math.min(this.backoffMaxMs, this.backoffBaseMs * 2 ** (attempt - 1));
    const delay = Math.round(this.random() * cap);
    return Math.max(0, Math.min(delay, deadline - this.now() - 1));
  }

  async #callProvider(model, body, deadline, signal) {
    const remaining = deadline - this.now();
    if (remaining <= 0) throw new ProviderError('timeout', 'Request deadline reached before provider call');
    const timeoutMs = Math.min(this.attemptTimeoutMs, remaining);

    const ac = new AbortController();
    let onAttemptAbort;
    // Racing against the abort guarantees the attempt ends even if a provider ignores its signal.
    const aborted = new Promise((_, reject) => {
      onAttemptAbort = () => reject(ac.signal.reason);
      ac.signal.addEventListener('abort', onAttemptAbort, { once: true });
    });
    const timer = setTimeout(
      () => ac.abort(new ProviderError('timeout', `Model call exceeded ${timeoutMs}ms`)),
      timeoutMs
    );
    const onParentAbort = () => ac.abort(new ProviderError('aborted', 'Client disconnected'));
    if (signal?.aborted) onParentAbort();
    else signal?.addEventListener('abort', onParentAbort, { once: true });

    try {
      return await Promise.race([this.provider.generate({ model, body, signal: ac.signal }), aborted]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onParentAbort);
      ac.signal.removeEventListener('abort', onAttemptAbort);
    }
  }

  async #blockModel(model, until, reason, requestId) {
    await this.store.block(model, until, reason, this.now());
    this.limited.set(model, reason);
    this.log('warn', 'model.excluded', { requestId, model, reason, until: iso(until) });
  }

  // ---- reservation & queue -------------------------------------------------

  async #tryReserve() {
    const n = this.models.length;
    const start = this.cursor;
    // Advance before awaiting so concurrent callers start at different models.
    this.cursor = (start + 1) % n;
    const now = this.now();
    const day = this.dailyWindow(now);
    let waitUntil = Infinity;
    let resetAt = Infinity;

    for (let i = 0; i < n; i++) {
      const idx = (start + i) % n;
      const m = this.models[idx];
      // Half-open circuit: a model that failed repeatedly gets one trial request at a time.
      const halfOpen = (this.consecutiveFailures.get(m.name) ?? 0) >= this.circuitFailureThreshold;
      if (halfOpen && this.halfOpenTrials.has(m.name)) {
        waitUntil = Math.min(waitUntil, now + this.attemptTimeoutMs);
        continue;
      }
      // Claim the trial slot before awaiting, so concurrent callers cannot also take it.
      if (halfOpen) this.halfOpenTrials.add(m.name);
      let r;
      try {
        r = await this.store.tryReserve(m.name, {
          rpm: m.rpm, rpd: m.rpd, windowMs: this.minuteWindowMs, now,
          dayKey: day.key, dayTtlMs: Math.max(0, day.resetAt - now) + 3_600_000,
        });
      } finally {
        if (halfOpen && !r?.ok) this.halfOpenTrials.delete(m.name);
      }
      if (r.ok) {
        this.cursor = (idx + 1) % n;
        if (halfOpen) this.log('info', 'circuit.half_open_trial', { model: m.name });
        if (this.limited.has(m.name)) {
          this.log('info', 'model.reintroduced', { model: m.name, previousReason: this.limited.get(m.name) });
          this.limited.delete(m.name);
        }
        return {
          lease: {
            model: m.name, reservationId: r.reservationId, dayKey: day.key, halfOpenTrial: halfOpen,
            rpm: m.rpm, rpd: m.rpd, minuteUsed: r.minuteUsed, dayUsed: r.dayUsed,
          },
        };
      }
      const isDaily = r.reason === 'daily' || r.blockReason === 'daily';
      const reason = isDaily ? 'daily' : (r.blockReason ?? r.reason);
      if (this.limited.get(m.name) !== reason) {
        this.limited.set(m.name, reason);
        this.log('info', 'model.limited', { model: m.name, reason, until: iso(isDaily && r.reason === 'daily' ? day.resetAt : r.retryAt) });
      }
      if (isDaily) resetAt = Math.min(resetAt, r.reason === 'daily' ? day.resetAt : r.retryAt);
      else waitUntil = Math.min(waitUntil, r.retryAt);
    }
    return waitUntil < Infinity ? { waitUntil } : { exhausted: true, resetAt };
  }

  #unservableError(r, expiresAt) {
    const now = this.now();
    if (r.exhausted) {
      return new ModelManagerError('DAILY_QUOTA_EXHAUSTED', undefined, {
        retryAfterMs: Number.isFinite(r.resetAt) ? r.resetAt - now : undefined,
        resetAt: Number.isFinite(r.resetAt) ? iso(r.resetAt) : undefined,
      });
    }
    if (r.waitUntil > expiresAt) {
      return new ModelManagerError('CAPACITY_UNAVAILABLE', undefined, { retryAfterMs: r.waitUntil - now });
    }
    return null;
  }

  async #acquire(requestId, deadline, signal) {
    if (this.closed) throw new ModelManagerError('SHUTTING_DOWN');

    // Fast path only when nobody is waiting, so queued requests keep FIFO priority.
    if (this.queue.length === 0) {
      const r = await this.#tryReserve();
      if (r.lease) return r.lease;
      const err = this.#unservableError(r, Math.min(this.now() + this.queueTimeoutMs, deadline));
      if (err) throw err;
    }

    if (this.queue.length >= this.queueMaxSize) {
      this.counters.queueRejected++;
      this.log('warn', 'queue.full', { requestId, queueLength: this.queue.length, maxSize: this.queueMaxSize });
      throw new ModelManagerError('QUEUE_FULL', undefined, { retryAfterMs: 5_000 });
    }

    return new Promise((resolve, reject) => {
      const now = this.now();
      const waiter = {
        requestId, resolve, reject, signal, done: false,
        enqueuedAt: now,
        expiresAt: Math.min(now + this.queueTimeoutMs, deadline),
      };
      waiter.timer = setTimeout(
        () => this.#settle(waiter, null, new ModelManagerError('QUEUE_TIMEOUT', undefined, { retryAfterMs: 5_000 })),
        Math.max(0, waiter.expiresAt - now)
      );
      if (signal) {
        waiter.onAbort = () => this.#settle(waiter, null, new ModelManagerError('ABORTED'));
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.queue.push(waiter);
      this.counters.queued++;
      this.log('info', 'queue.enqueued', { requestId, position: this.queue.length, waitBudgetMs: waiter.expiresAt - now });
      this.#requestPump();
    });
  }

  #settle(waiter, lease, err) {
    if (waiter.done) return;
    waiter.done = true;
    clearTimeout(waiter.timer);
    waiter.signal?.removeEventListener('abort', waiter.onAbort);
    const idx = this.queue.indexOf(waiter);
    if (idx >= 0) this.queue.splice(idx, 1);
    const waitedMs = this.now() - waiter.enqueuedAt;
    if (lease) {
      this.counters.dequeued++;
      this.log('info', 'queue.resumed', { requestId: waiter.requestId, model: lease.model, waitedMs, queueLength: this.queue.length });
      waiter.resolve(lease);
    } else {
      this.log('warn', 'queue.rejected', { requestId: waiter.requestId, code: err.code, waitedMs, queueLength: this.queue.length });
      waiter.reject(err);
    }
  }

  // Serialised: only one pump loop runs at a time; extra requests set a rerun flag.
  #requestPump() {
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }
    this.pumping = true;
    this.#pump()
      .catch((err) => this.log('error', 'queue.pump_failed', { message: err.message }))
      .finally(() => {
        this.pumping = false;
        if (this.pumpAgain) {
          this.pumpAgain = false;
          this.#requestPump();
        }
      });
  }

  async #pump() {
    clearTimeout(this.pumpTimer);
    this.pumpTimer = null;
    while (this.queue.length && !this.closed) {
      let r;
      try {
        r = await this.#tryReserve();
      } catch (err) {
        // Store failure (e.g. Redis down): fail waiters instead of leaving them hanging.
        for (const w of [...this.queue]) this.#settle(w, null, new ModelManagerError('INTERNAL', undefined, { cause: err }));
        throw err;
      }
      if (r.lease) {
        const head = this.queue[0];
        if (head) this.#settle(head, r.lease);
        else await this.#releaseLease(r.lease); // every waiter left while we were reserving
        continue;
      }
      for (const w of [...this.queue]) {
        const err = this.#unservableError(r, w.expiresAt);
        if (err) this.#settle(w, null, err);
      }
      if (this.queue.length) {
        const delay = Math.max(0, r.waitUntil - this.now()) + 1;
        this.pumpTimer = setTimeout(() => this.#requestPump(), delay);
        this.pumpTimer.unref?.();
        this.log('debug', 'queue.waiting', { queueLength: this.queue.length, resumeInMs: delay });
      }
      break;
    }
  }

  async #releaseLease(lease) {
    if (lease.halfOpenTrial) this.halfOpenTrials.delete(lease.model);
    await this.store.release(lease.model, lease.reservationId, { dayKey: lease.dayKey });
    this.counters.leasesReleased++;
  }

  // ---- observability & lifecycle -------------------------------------------

  async getStats() {
    const now = this.now();
    const day = this.dailyWindow(now);
    const models = await Promise.all(this.models.map(async (m) => {
      const s = await this.store.snapshot(m.name, { windowMs: this.minuteWindowMs, now, dayKey: day.key });
      let status = 'available';
      if (s.blockReason) status = s.blockReason === 'daily' ? 'daily_exhausted' : s.blockReason;
      else if (s.dayUsed >= m.rpd) status = 'daily_exhausted';
      else if (s.minuteUsed >= m.rpm) status = 'minute_limited';
      return {
        model: m.name,
        status,
        limits: { rpm: m.rpm, rpd: m.rpd },
        minute: { used: s.minuteUsed, remaining: Math.max(0, m.rpm - s.minuteUsed) },
        day: { used: s.dayUsed, remaining: Math.max(0, m.rpd - s.dayUsed), resetAt: iso(day.resetAt) },
        blockedUntil: iso(s.blockedUntil),
        totals: { ...this.modelCounters[m.name] },
      };
    }));
    return {
      provider: this.provider.name,
      store: this.store.type ?? 'custom',
      availableModels: models.filter((m) => m.status === 'available').length,
      totalModels: models.length,
      queue: { length: this.queue.length, maxSize: this.queueMaxSize, timeoutMs: this.queueTimeoutMs },
      inFlight: this.inFlight.size,
      counters: { ...this.counters },
      errorsByCode: { ...this.errorsByCode },
      models,
    };
  }

  async health() {
    const stats = await this.getStats();
    const dayLeft = stats.models.reduce((sum, m) => sum + m.day.remaining, 0);
    let status = 'ok';
    if (dayLeft === 0) status = 'exhausted';
    else if (stats.availableModels < stats.totalModels || stats.queue.length > 0) status = 'degraded';
    return {
      status,
      availableModels: stats.availableModels,
      totalModels: stats.totalModels,
      queueLength: stats.queue.length,
      dailyRequestsRemaining: dayLeft,
    };
  }

  async shutdown({ timeoutMs = 10_000 } = {}) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.pumpTimer);
    for (const w of [...this.queue]) this.#settle(w, null, new ModelManagerError('SHUTTING_DOWN'));
    this.log('info', 'shutdown.draining', { inFlight: this.inFlight.size });
    let timer;
    await Promise.race([
      Promise.allSettled([...this.inFlight]),
      new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
    clearTimeout(timer);
    await this.store.close?.();
    this.log('info', 'shutdown.complete', {});
  }
}
