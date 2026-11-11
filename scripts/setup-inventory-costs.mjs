// Fill missing demo ingredient costs through the audited admin API. Never resets stock.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { ingredientUpdateSchema } from '@may-cafe/contracts';

const plan = JSON.parse(
  await readFile(new URL('../docs/data/inventory-demo.json', import.meta.url), 'utf8'),
);
const apply = process.argv.includes('--apply');
const base = (process.env.INVENTORY_API_URL ?? 'http://localhost:8082/api/v1').replace(/\/$/, '');
const password = process.env.INVENTORY_ADMIN_PASSWORD;
if (!password) throw new Error('Set INVENTORY_ADMIN_PASSWORD in the process environment.');
let token = '',
  cookies = '';

async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const json = await response.json();
  if (!response.ok)
    throw new Error(`${method} ${path}: ${response.status} ${json.error?.message ?? ''}`);
  return json.data;
}

try {
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.INVENTORY_ADMIN_EMAIL ?? 'admin@maycafe.vn',
      password,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!login.ok) throw new Error(`Admin login failed: HTTP ${login.status}`);
  cookies = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const auth = (await login.json()).data;
  assert.equal(auth.user.role, 'ADMIN');
  token = auth.accessToken;
  const initial = await api('/admin/inventory');
  const rows = [];
  const codes = new Set();
  for (const row of plan.ingredients) {
    assert.ok(!codes.has(row.code), `Duplicate ingredient: ${row.code}`);
    codes.add(row.code);
    assert.ok(
      Number.isFinite(row.unitCost) && row.unitCost > 0,
      `Invalid sample cost: ${row.code}`,
    );
    const ingredient = initial.ingredients.find((i) => i.code === row.code);
    assert.ok(ingredient, `Missing ingredient: ${row.code}. Load the ingredient dataset first.`);
    assert.equal(ingredient.unit, row.unit, `Unit differs: ${row.code}`);
    if (ingredient.unitCost !== null && ingredient.unitCost !== undefined) continue;
    ingredientUpdateSchema.parse({
      name: ingredient.name,
      isActive: ingredient.isActive,
      lowStockThreshold: ingredient.lowStockThreshold,
      expectedVersion: ingredient.version,
      unitCost: row.unitCost,
    });
    rows.push({ code: row.code, name: ingredient.name, unit: row.unit, unitCost: row.unitCost });
  }
  console.log(
    JSON.stringify({ mode: apply ? 'apply' : 'preview', missingCosts: rows.length, rows }),
  );
  const updated = [];
  if (apply) {
    for (const row of rows) {
      // Re-read before each write and use optimistic locking; preserve existing cost, including zero.
      const current = (await api('/admin/inventory')).ingredients.find((i) => i.code === row.code);
      assert.ok(current, `Ingredient disappeared: ${row.code}`);
      assert.equal(current.unit, row.unit);
      if (current.unitCost !== null && current.unitCost !== undefined) continue;
      const payload = ingredientUpdateSchema.parse({
        name: current.name,
        isActive: current.isActive,
        lowStockThreshold: current.lowStockThreshold,
        expectedVersion: current.version,
        unitCost: row.unitCost,
      });
      await api(`/admin/inventory/ingredients/${current.id}`, 'PATCH', payload);
      updated.push(row);
    }
    const final = await api('/admin/inventory');
    for (const row of updated)
      assert.equal(final.ingredients.find((i) => i.code === row.code)?.unitCost, row.unitCost);
    // Exact checks for recipe/catalog/stock consistency. Concurrent business activity may require review.
    const withoutCost = (i) => {
      const { unitCost, version, ...rest } = i;
      return rest;
    };
    assert.deepEqual(final.ingredients.map(withoutCost), initial.ingredients.map(withoutCost));
    for (const key of ['recipes', 'products', 'toppings'])
      assert.deepEqual(final[key], initial[key]);
    const cache = new URL('../.cache/', import.meta.url);
    await mkdir(cache, { recursive: true });
    await writeFile(
      new URL('inventory-costs-report.json', cache),
      JSON.stringify(
        {
          dataset: plan.dataset,
          updated,
          verifiedAt: new Date().toISOString(),
          stockAndRecipesPreserved: true,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({ completed: true, updated: updated.length, stockAndRecipesPreserved: true }),
    );
  }
} finally {
  if (cookies) {
    const logout = await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookies },
      signal: AbortSignal.timeout(15000),
    });
    if (!logout.ok) throw new Error(`Admin logout failed: HTTP ${logout.status}`);
  }
}
