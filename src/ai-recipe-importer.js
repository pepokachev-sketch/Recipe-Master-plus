/**
 * Recipe Master Plus — AI recipe package validator.
 * Package format: { schema: "rmp.recipe.v1", recipe: { ... }, imageDataUrl?: "data:image/..." }
 */
const IMAGE_DATA_URL = /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i;
const text = (value, max, field) => {
  if (value == null) return "";
  if (typeof value !== "string") throw new TypeError("recipe-import-invalid-" + field);
  const result = value.trim();
  if (result.length > max) throw new RangeError("recipe-import-too-long-" + field);
  return result;
};
export function validateRecipePackage(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("recipe-import-invalid-package");
  if (input.schema !== "rmp.recipe.v1") throw new Error("recipe-import-unsupported-schema");
  const source = input.recipe;
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new TypeError("recipe-import-missing-recipe");
  const name = text(source.name, 180, "name");
  if (!name) throw new Error("recipe-import-name-required");
  const ingredients = source.ingredients;
  if (!Array.isArray(ingredients) || ingredients.length > 250) throw new TypeError("recipe-import-invalid-ingredients");
  const rows = ingredients.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new TypeError("recipe-import-invalid-ingredient-" + index);
    const amount = text(row.amount, 60, "ingredient-amount");
    const unit = text(row.unit, 40, "ingredient-unit");
    const ingredientName = text(row.name, 180, "ingredient-name");
    if (!amount && !unit && !ingredientName) throw new Error("recipe-import-empty-ingredient-" + index);
    return { id: "ing_import_" + index, amount, unit, name: ingredientName, scale: row.scale !== false, base: row.base === true, scaleBase: row.scaleBase !== false };
  });
  if (rows.filter(row => row.base).length > 1) throw new Error("recipe-import-multiple-base-ingredients");
  const rawSteps = source.steps;
  const steps = Array.isArray(rawSteps) ? rawSteps.map(x => text(x, 2000, "step")).filter(Boolean).join("\n") : text(rawSteps, 30000, "steps");
  const tags = Array.isArray(source.tags) ? [...new Set(source.tags.map(x => text(x, 50, "tag")).filter(Boolean))].slice(0, 30) : [];
  const imageDataUrl = input.imageDataUrl == null ? "" : input.imageDataUrl;
  if (imageDataUrl && (typeof imageDataUrl !== "string" || !IMAGE_DATA_URL.test(imageDataUrl))) throw new Error("recipe-import-invalid-image");
  const numeric = (value, max, field) => {
    if (value == null || value === "") return "";
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > max) throw new RangeError("recipe-import-invalid-" + field);
    return String(n);
  };
  return {
    name, category: text(source.category, 100, "category"), servings: numeric(source.servings, 1000, "servings") || "4",
    ingredients: rows, steps, tags, notes: text(source.notes, 10000, "notes"),
    time: numeric(source.time, 10000, "time"), temperature: numeric(source.temperature, 1000, "temperature"),
    sourceUrl: text(source.sourceUrl, 2000, "source-url"), imageDataUrl
  };
}
