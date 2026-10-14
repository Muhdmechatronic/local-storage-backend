// Error types used by the model manager.
//
// ProviderError    -> raised by a provider adapter for a single model call (classified by `kind`).
// ModelManagerError -> raised to callers (routes); carries an HTTP status and a user-safe message.

// Messages are shown to end users: plain language, no technical terms. Details go to logs only.
const CODES = {
  DAILY_QUOTA_EXHAUSTED: [429, 'Daily Limit Reached', "Today's AI Food Analyzer limit has been reached. Please try again later."],
  QUEUE_FULL: [503, 'AI Food Analyzer Busy', 'The AI Food Analyzer is very busy right now. Please try again in a moment.'],
  QUEUE_TIMEOUT: [503, 'AI Food Analyzer Busy', 'The AI Food Analyzer is very busy right now. Please try again in a moment.'],
  CAPACITY_UNAVAILABLE: [503, 'AI Food Analyzer Busy', 'The AI Food Analyzer is very busy right now. Please try again in a moment.'],
  DEADLINE_EXCEEDED: [504, 'Timeout', 'The AI Food Analyzer is taking longer than usual. Please try again.'],
  RETRIES_EXHAUSTED: [502, 'AI Food Analyzer Unavailable', "The AI Food Analyzer couldn't analyze your photo right now. Please try again in a moment."],
  PROVIDER_AUTH: [500, 'AI Food Analyzer Unavailable', 'The AI Food Analyzer is temporarily unavailable. Please try again later.'],
  INVALID_AI_RESPONSE: [502, 'Food Not Recognized', "The AI couldn't recognize the food in this photo. Please try again with a clearer photo."],
  BAD_REQUEST: [400, 'Unreadable Photo', "The AI couldn't read this photo. Please try again with a clear photo of your food."],
  ABORTED: [499, 'Cancelled', 'The analysis was cancelled.'],
  SHUTTING_DOWN: [503, 'AI Food Analyzer Unavailable', 'The AI Food Analyzer is temporarily unavailable. Please try again in a moment.'],
  INTERNAL: [500, 'AI Food Analyzer Unavailable', "The AI Food Analyzer couldn't analyze your photo right now. Please try again in a moment."],
};

export class ModelManagerError extends Error {
  constructor(code, message, { retryAfterMs, resetAt, cause } = {}) {
    const [httpStatus, title, defaultMessage] = CODES[code] ?? CODES.INTERNAL;
    super(message ?? defaultMessage, cause ? { cause } : undefined);
    this.name = 'ModelManagerError';
    this.code = CODES[code] ? code : 'INTERNAL';
    this.httpStatus = httpStatus;
    this.title = title;
    this.retryAfterMs = retryAfterMs != null ? Math.max(0, Math.ceil(retryAfterMs)) : undefined;
    this.resetAt = resetAt;
  }
}

/**
 * kind: 'rate_limit' | 'auth' | 'model_not_found' | 'bad_request' | 'server' | 'timeout' | 'network' | 'aborted'
 *       | 'invalid_response' (reply received but unusable) | 'unknown'
 * quotaScope: 'minute' | 'day' | undefined (only for rate_limit, when the provider says which quota was hit)
 */
export class ProviderError extends Error {
  constructor(kind, message, { status, retryAfterMs, quotaScope } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.quotaScope = quotaScope;
  }
}

// Strip anything that looks like a Google API key from text before it is logged or returned.
export function redactSecrets(text) {
  return String(text ?? '')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted-key]')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[redacted]');
}
