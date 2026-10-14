import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCategory, normalizeType, toFoodAnalysis, toAppGeminiShape } from '../services/foodAnalysis.js';
import { getPublicFoodOptions } from '../services/foodOptions.js';

const FOOD_CATEGORIES = getPublicFoodOptions().categories;
import { ProviderError } from '../services/modelManager/errors.js';
import { createHarness } from './support/harness.js';

const gemini = (text, finishReason = 'STOP') => ({
  candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason }],
  modelVersion: 'test',
});

test('exact categories are kept', () => {
  for (const c of FOOD_CATEGORIES) assert.equal(normalizeCategory(c), c);
});

test('AI wording variants map to the app category list', () => {
  const cases = {
    Snack: 'Snacks', snacks: 'Snacks', SNACKS: 'Snacks',
    Dessert: 'Desserts', 'Sweet dessert': 'Desserts',
    'fast food': 'Fast Food', 'Fast-Food': 'Fast Food', FastFood: 'Fast Food', 'Fast food fried chicken': 'Fast Food',
    'Rice and Grain': 'Rice & Grain', 'Rice & Grains': 'Rice & Grain',
    'Noodles and Soup': 'Noodles & Soup', Soup: 'Noodles & Soup',
    Beverages: 'Drinks', Drink: 'Drinks',
    Fruit: 'Fruits', Vegetable: 'Vegetables', Seafood: 'Meat & Seafood',
    'Bread and Pastries': 'Bread & Pastry', DAIRY: 'Dairy',
    '': 'Other', 'Something else': 'Other', null: 'Other',
  };
  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(normalizeCategory(input === 'null' ? null : input), expected, `input "${input}"`);
  }
});

test('type variants map to Healthy / Moderate / Junk Food', () => {
  assert.equal(normalizeType('Junk Food'), 'Junk Food');
  assert.equal(normalizeType('junk food'), 'Junk Food');
  assert.equal(normalizeType('Unhealthy'), 'Junk Food');
  assert.equal(normalizeType('healthy'), 'Healthy');
  assert.equal(normalizeType('Moderate'), 'Moderate');
  assert.equal(normalizeType(undefined), 'Moderate');
});

test('parses fenced / wrapped JSON and cleans every field', () => {
  const reply = 'Here is the result:\n```json\n{"foodName":" Chocolate Cake ","category":"dessert","type":"junk food",'
    + '"calories":"412.6","protein":5.04,"carbs":-3,"fat":20,"confidence":1.7}\n```';
  const { analysis, aiCategory } = toFoodAnalysis(gemini(reply));
  assert.equal(aiCategory, 'dessert');
  assert.deepEqual(analysis, {
    foodName: 'Chocolate Cake', foodNameMalay: '', calories: 413, protein: 5, carbs: 0, fat: 20, fiber: 0,
    servingSize: '1 serving', confidence: 1, category: 'Desserts', type: 'Junk Food', description: '',
  });
});

test('truncated or empty replies are rejected with the finish reason', () => {
  assert.throws(() => toFoodAnalysis(gemini('{"foodName":"Nasi Lem', 'MAX_TOKENS')), /not valid JSON \(finishReason=MAX_TOKENS\)/);
  assert.throws(() => toFoodAnalysis({ candidates: [{ finishReason: 'SAFETY' }] }), /empty \(finishReason=SAFETY\)/);
});

test('app response keeps the Gemini shape with the cleaned JSON as text', () => {
  const food = toFoodAnalysis(gemini('{"foodName":"Teh Tarik","category":"Beverage","type":"moderate"}'));
  const shaped = toAppGeminiShape(food);
  const sent = JSON.parse(shaped.candidates[0].content.parts[0].text);
  assert.equal(sent.category, 'Drinks');
  assert.equal(sent.type, 'Moderate');
  assert.equal(shaped.candidates[0].finishReason, 'STOP');
});

test('an unusable reply is retried on another model; all unusable -> INVALID_AI_RESPONSE', async () => {
  let first = true;
  const { manager, provider } = createHarness({
    provider: { behavior: () => (first && !(first = false) ? { latencyMs: 1 } : undefined) },
  });
  // Validator rejects the first reply only.
  let calls = 0;
  const out = await manager.execute({}, {
    validate: (r) => {
      if (calls++ === 0) throw new Error('not valid JSON');
      return r;
    },
  });
  assert.equal(out.attempts, 2);
  assert.notEqual(provider.calls[0].model, provider.calls[1].model);

  await assert.rejects(
    manager.execute({}, { validate: () => { throw new Error('not valid JSON'); } }),
    { code: 'INVALID_AI_RESPONSE', httpStatus: 502 }
  );
});

test('invalid replies do not open the circuit breaker', async () => {
  const { manager } = createHarness({ manager: { circuitFailureThreshold: 1, maxAttempts: 3 } });
  await assert.rejects(manager.execute({}, { validate: () => { throw new ProviderError('x', 'bad'); } }));
  const stats = await manager.getStats();
  assert.ok(stats.models.every((m) => m.status === 'available'));
});
