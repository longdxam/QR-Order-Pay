import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const origin = (process.argv[2] ?? 'http://localhost:8080').replace(/\/$/, '');
const cache = JSON.parse(
  await fs.readFile(
    new URL('../client/src/features/guest/menu-image-cache.json', import.meta.url),
    'utf8',
  ),
);
const response = await fetch(`${origin}/api/v1/categories`);
assert.ok(response.ok, `catalog HTTP ${response.status}`);
const { data } = await response.json();
const products = data.products.filter((product) => !product.isArchived);
assert.ok(products.length, 'public catalog is empty');
await Promise.all(
  products.map(async (product) => {
    const source = cache[product.image] ?? product.image;
    assert.ok(source.startsWith('/menu-images/'), `${product.name}: no bundled image`);
    const image = await fetch(`${origin}${source}`);
    assert.ok(image.ok, `${product.name}: image HTTP ${image.status}`);
    assert.match(image.headers.get('content-type') ?? '', /^image\//);
    const bytes = Buffer.from(await image.arrayBuffer());
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.ok(bytes.length > 1024, `${product.name}: empty image`);
  }),
);
console.log(
  `PASS ${products.length}/${products.length} public products: bundled WebP assets served as images, no external-image dependency. This checks asset delivery, not visual appearance.`,
);
