import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRecipePackage } from '../src/ai-recipe-importer.js';

const valid = {
  schema: 'rmp.recipe.v1',
  recipe: {
    name: 'Домашна супа', category: 'Супи и чорби', servings: 4,
    ingredients: [{ amount: '500', unit: 'г', name: 'пилешко месо' }, { amount: '', unit: '', name: 'сол на вкус' }],
    steps: ['Подготви продуктите.', 'Свари супата.'], tags: ['домашно'], time: 60
  }
};

test('validates and normalizes a recipe package', () => {
  const result = validateRecipePackage(valid);
  assert.equal(result.name, 'Домашна супа');
  assert.equal(result.ingredients.length, 2);
  assert.equal(result.steps, 'Подготви продуктите.\nСвари супата.');
  assert.equal(result.servings, '4');
  assert.equal(result.ingredients[0].scale, true);
});

test('rejects unsupported schema and missing recipe name', () => {
  assert.throws(() => validateRecipePackage({ ...valid, schema: 'other' }), /unsupported-schema/);
  assert.throws(() => validateRecipePackage({ ...valid, recipe: { ...valid.recipe, name: ' ' } }), /name-required/);
});

test('rejects malformed ingredients and more than one base ingredient', () => {
  assert.throws(() => validateRecipePackage({ ...valid, recipe: { ...valid.recipe, ingredients: 'flour' } }), /invalid-ingredients/);
  assert.throws(() => validateRecipePackage({ ...valid, recipe: { ...valid.recipe, ingredients: [{name:'A',base:true},{name:'B',base:true}] } }), /multiple-base/);
});

test('validates image data URLs and bounded numeric values', () => {
  assert.throws(() => validateRecipePackage({ ...valid, imageDataUrl: 'https://example.com/image.jpg' }), /invalid-image/);
  assert.throws(() => validateRecipePackage({ ...valid, recipe: { ...valid.recipe, servings: -1 } }), /invalid-servings/);
  const result = validateRecipePackage({ ...valid, imageDataUrl: 'data:image/png;base64,AAAA' });
  assert.equal(result.imageDataUrl, 'data:image/png;base64,AAAA');
});

test('does not mutate the incoming package', () => {
  const input = structuredClone(valid);
  validateRecipePackage(input);
  assert.deepEqual(input, valid);
});


test('preserves imported quantities and disables automatic portion scaling', () => {
  const input = {
    ...valid,
    recipe: {
      ...valid.recipe,
      servings: 10,
      ingredients: [
        { amount: '1250', unit: 'г', name: 'свинско месо', scale: true, base: true, scaleBase: true },
        { amount: '37,5', unit: 'г', name: 'сол', scale: true, scaleBase: true },
        { amount: 'на вкус', unit: '', name: 'черен пипер' }
      ]
    }
  };
  const result = validateRecipePackage(input);
  assert.equal(result.servings, '10');
  assert.deepEqual(result.ingredients.map(row => row.amount), ['1250', '37,5', 'на вкус']);
  for (const row of result.ingredients) {
    assert.equal(row.scale, false);
    assert.equal(row.base, false);
    assert.equal(row.excludeBaseScaling, true);
    assert.equal(row.scaleBase, false);
  }
});
