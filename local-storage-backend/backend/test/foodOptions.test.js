import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getFoodOptions, getPublicFoodOptions, validateFoodOptions,
  buildCategoryPromptSection, buildAllowedValuesPromptSection,
} from '../services/foodOptions.js';
import { normalizeCategory } from '../services/foodAnalysis.js';

const shipped = () => JSON.parse(fs.readFileSync(new URL('../config/foodOptions.json', import.meta.url), 'utf8'));

test('shipped config is valid and exposes the lists the app uses', () => {
  const pub = getPublicFoodOptions(validateFoodOptions(shipped()));
  assert.equal(pub.categories.length, 12);
  assert.ok(pub.categories.includes('Snacks') && pub.categories.includes('Fast Food') && pub.categories.includes('Desserts'));
  assert.deepEqual(pub.healthTypes, ['Healthy', 'Moderate', 'Junk Food']);
  assert.deepEqual(pub.mealTypes, ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Drink', 'Unknown']);
  assert.deepEqual(pub.defaults, { category: 'Other', healthType: 'Moderate', mealType: 'Lunch' });
  // Prompt-only fields (descriptions, aliases) are not sent to the app.
  assert.ok(!JSON.stringify(pub).includes('aliases'));
});

test('invalid configs are rejected with a clear reason', () => {
  const bad = (mutate, pattern) => {
    const o = shipped();
    mutate(o);
    assert.throws(() => validateFoodOptions(o), pattern);
  };
  bad((o) => { o.categories = []; }, /"categories" must be a non-empty array/);
  bad((o) => { o.categories.push({ name: 'Snacks' }); }, /duplicate name "Snacks"/);
  bad((o) => { o.defaults.category = 'Nope'; }, /defaults.category "Nope"/);
  bad((o) => { o.mealTypes = 'Lunch'; }, /"mealTypes"/);
});

test('editing the file changes prompt, normalizer and app lists without restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foodopts-'));
  const file = path.join(dir, 'foodOptions.json');
  const o = shipped();
  fs.writeFileSync(file, JSON.stringify(o));
  const v1 = getFoodOptions({ filePath: file, force: true });
  assert.equal(normalizeCategory('Beverage', v1), 'Drinks');

  // Rename "Drinks" -> "Beverages" and add a new category with its own alias.
  o.categories.find((c) => c.name === 'Drinks').name = 'Beverages';
  o.categories.splice(-1, 0, { name: 'Malaysian Kuih', description: 'Traditional kuih.', examples: ['Kuih lapis'], aliases: ['kuih'] });
  o.categories.find((c) => c.name === 'Snacks').aliases = ['snack'];
  fs.writeFileSync(file, JSON.stringify(o));
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5_000)); // ensure a new mtime
  const v2 = getFoodOptions({ filePath: file, force: true });

  assert.equal(normalizeCategory('Beverage', v2), 'Beverages');
  assert.equal(normalizeCategory('kuih lapis', v2), 'Malaysian Kuih');
  assert.ok(getPublicFoodOptions(v2).categories.includes('Malaysian Kuih'));
  assert.match(buildCategoryPromptSection(v2), /"Malaysian Kuih"\nTraditional kuih\.\n- Kuih lapis/);
  assert.match(buildAllowedValuesPromptSection(v2), /"Beverages"/);
  assert.doesNotMatch(buildAllowedValuesPromptSection(v2), /"Drinks"/);

  // A broken edit keeps the last good version instead of failing scans.
  fs.writeFileSync(file, '{ not json');
  fs.utimesSync(file, new Date(), new Date(Date.now() + 10_000));
  const v3 = getFoodOptions({ filePath: file, force: true });
  assert.ok(getPublicFoodOptions(v3).categories.includes('Malaysian Kuih'));

  fs.rmSync(dir, { recursive: true, force: true });
  getFoodOptions({ force: true }); // restore the shipped config for other tests
});
