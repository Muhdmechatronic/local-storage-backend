// Turns a raw Gemini reply into a clean, validated food analysis for the app.
// (No hardcoded lists here.)
// The app only displays these values, so every field is normalized here:
// category/type always match the app's exact lists, numbers are sane, strings exist.

// The allowed values and their aliases come from config/foodOptions.json (see foodOptions.js).

import { getFoodOptions } from './foodOptions.js';

const simplify = (value) => String(value).toLowerCase().replace(/\band\b/g, '&').replace(/\s+/g, ' ').trim();

/**
 * Maps an AI value to one of `items` (by name): exact or singular/plural match first,
 * then the longest alias contained in the value (most specific wins). Otherwise `fallback`.
 */
function matchOption(raw, items, fallback) {
  if (raw == null || String(raw).trim() === '') return fallback;
  const value = simplify(raw);
  for (const { name } of items) {
    const n = simplify(name);
    if (value === n || value === `${n}s` || `${value}s` === n) return name;
  }
  let best = null;
  for (const { name, aliases = [] } of items) {
    for (const alias of aliases) {
      const a = simplify(alias);
      if (a && value.includes(a) && (!best || a.length > best.length)) best = { name, length: a.length };
    }
  }
  return best?.name ?? fallback;
}

/** Maps the AI's category ("Snack", "dessert", "Rice and Grains", "Beverages") to a configured category. */
export function normalizeCategory(raw, options = getFoodOptions()) {
  return matchOption(raw, options.categories, options.defaults.category);
}

/** Maps the AI's type ("healthy", "Junk food", "unhealthy") to a configured health type. */
export function normalizeType(raw, options = getFoodOptions()) {
  // "unhealthy" contains "healthy": the longer alias ("unhealthy") wins.
  return matchOption(raw, options.healthTypes, options.defaults.healthType);
}

function extractText(result) {
  const parts = result?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => typeof p?.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('')
    .trim();
}

function parseJsonObject(text) {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  for (const candidate of [stripped, stripped.slice(stripped.indexOf('{'), stripped.lastIndexOf('}') + 1)]) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const amount = (v, digits = 1) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/**
 * Validates and normalizes a Gemini reply. Throws if the reply has no usable JSON,
 * so the model manager can retry on another model instead of returning junk.
 * Returns { analysis, aiCategory, aiType, text, finishReason, result }.
 */
export function toFoodAnalysis(result) {
  const finishReason = result?.candidates?.[0]?.finishReason ?? 'none';
  const text = extractText(result);
  if (!text) throw new Error(`AI reply was empty (finishReason=${finishReason})`);

  const raw = parseJsonObject(text);
  if (!raw) {
    throw new Error(`AI reply was not valid JSON (finishReason=${finishReason}): ${text.slice(0, 200)}`);
  }

  const confidence = Number(raw.confidence);
  const analysis = {
    foodName: str(raw.foodName) || 'Unknown Food',
    foodNameMalay: str(raw.foodNameMalay),
    calories: amount(raw.calories, 0),
    protein: amount(raw.protein),
    carbs: amount(raw.carbs),
    fat: amount(raw.fat),
    fiber: amount(raw.fiber),
    servingSize: str(raw.servingSize) || '1 serving',
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5,
    category: normalizeCategory(raw.category),
    type: normalizeType(raw.type),
    description: str(raw.description),
  };

  return { analysis, aiCategory: raw.category, aiType: raw.type, text, finishReason, result };
}

/**
 * Keeps the response shape the app already parses (Gemini `candidates[0].content.parts[0].text`),
 * but with the cleaned analysis as the text, so the app needs no changes.
 */
export function toAppGeminiShape({ analysis, result }) {
  const candidate = result?.candidates?.[0] ?? {};
  return {
    ...result,
    candidates: [{
      ...candidate,
      content: { role: 'model', parts: [{ text: JSON.stringify(analysis) }] },
    }],
  };
}
