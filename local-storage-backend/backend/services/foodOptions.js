// Food option lists (categories, health types, meal types) shared by the AI prompt,
// the reply normalizer and the app (GET /api/scan/options).
//
// Source of truth: config/foodOptions.json (override path with FOOD_OPTIONS_PATH).
// The file is re-read when it changes, so edits apply without a rebuild or restart.
// An invalid edit is rejected and the last good version keeps being used.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';

const DEFAULT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'config', 'foodOptions.json');
const CHECK_INTERVAL_MS = 5_000;

let cache = null; // { options, mtimeMs, filePath }
let lastCheck = 0;

const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

/** Throws a descriptive error if the options file is not usable. */
export function validateFoodOptions(o) {
  const fail = (msg) => { throw new Error(`Invalid food options: ${msg}`); };
  if (!o || typeof o !== 'object') fail('root must be an object');

  for (const key of ['categories', 'healthTypes']) {
    if (!Array.isArray(o[key]) || o[key].length === 0) fail(`"${key}" must be a non-empty array`);
    const names = new Set();
    for (const item of o[key]) {
      if (!isNonEmptyString(item?.name)) fail(`every entry in "${key}" needs a "name"`);
      if (names.has(item.name)) fail(`duplicate name "${item.name}" in "${key}"`);
      names.add(item.name);
      for (const list of ['examples', 'aliases']) {
        if (item[list] !== undefined && !Array.isArray(item[list])) fail(`"${key}.${item.name}.${list}" must be an array`);
      }
    }
  }
  if (!Array.isArray(o.mealTypes) || !o.mealTypes.every(isNonEmptyString)) fail('"mealTypes" must be an array of names');

  const d = o.defaults ?? {};
  if (!o.categories.some((c) => c.name === d.category)) fail(`defaults.category "${d.category}" is not in categories`);
  if (!o.healthTypes.some((t) => t.name === d.healthType)) fail(`defaults.healthType "${d.healthType}" is not in healthTypes`);
  if (!o.mealTypes.includes(d.mealType)) fail(`defaults.mealType "${d.mealType}" is not in mealTypes`);
  return o;
}

function load(filePath) {
  const stat = fs.statSync(filePath);
  if (cache && cache.filePath === filePath && cache.mtimeMs === stat.mtimeMs) return cache.options;
  const options = validateFoodOptions(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  if (cache) logger.info(`[food-options] reloaded ${path.basename(filePath)} (version ${options.version ?? '-'})`);
  cache = { options, mtimeMs: stat.mtimeMs, filePath };
  return options;
}

/** Current options; re-checks the file at most every few seconds. */
export function getFoodOptions({ filePath = process.env.FOOD_OPTIONS_PATH || DEFAULT_PATH, force = false } = {}) {
  const now = Date.now();
  if (!force && cache && cache.filePath === filePath && now - lastCheck < CHECK_INTERVAL_MS) return cache.options;
  lastCheck = now;
  try {
    return load(filePath);
  } catch (err) {
    if (!cache) throw err; // nothing good to fall back to (startup)
    logger.error(`[food-options] ${err.message}; keeping previous version`);
    return cache.options;
  }
}

/** What the app needs: just names and defaults. */
export function getPublicFoodOptions(options = getFoodOptions()) {
  return {
    version: options.version ?? 1,
    categories: options.categories.map((c) => c.name),
    healthTypes: options.healthTypes.map((t) => t.name),
    mealTypes: [...options.mealTypes],
    defaults: { ...options.defaults },
  };
}

const bullets = (items = []) => items.map((x) => `- ${x}`).join('\n');
const quoted = (items) => items.map((x) => `"${x.name}"`).join('\n');

function describe(item, { colon = false } = {}) {
  const title = `"${item.name}"${colon ? ':' : ''}`;
  const lines = [title];
  if (item.description) lines.push(item.description);
  // Optional heading above the examples, e.g. "Examples:" (rendered after a blank line).
  if (item.examplesLabel && item.examples?.length) lines.push('', item.examplesLabel);
  if (item.examples?.length) lines.push(bullets(item.examples));
  return lines.join('\n');
}

/** Prompt section 4 (food category), generated from the options file. */
export function buildCategoryPromptSection(options = getFoodOptions()) {
  return `=== 4. FOOD CATEGORY ===

Choose EXACTLY ONE of these categories:

${options.categories.map((c, i) => `${i + 1}. "${c.name}"`).join('\n')}

CATEGORY RULES:

${options.categories.map((c) => describe(c)).join('\n\n')}

IMPORTANT CATEGORY RULES:

${bullets(options.categoryGuidelines)}

Examples:

${(options.categoryExamples ?? []).join('\n')}`;
}

/** Prompt section 5 (food type), generated from the options file. */
export function buildHealthTypePromptSection(options = getFoodOptions()) {
  return `=== 5. FOOD TYPE ===

Choose EXACTLY ONE:

${quoted(options.healthTypes)}

This classification is separate from the food category.

${options.healthTypes.map((t) => describe(t, { colon: true })).join('\n\n')}

IMPORTANT:
${bullets(options.healthTypeGuidelines)}`;
}

/** Final "must be exactly one of" lists for the output section. */
export function buildAllowedValuesPromptSection(options = getFoodOptions()) {
  return `The "category" MUST be exactly one of:
${quoted(options.categories)}

The "type" MUST be exactly one of:
${quoted(options.healthTypes)}`;
}
