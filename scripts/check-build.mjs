import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const html = await readFile('dist/index.html', 'utf8');
const base = (process.env.BASE_PATH || '/').replace(/\/$/, '');
const canonical = new URL(
  `${base}/`,
  process.env.SITE_URL || 'https://www.autumnlane.cz',
).href;
assert.ok(
  html.includes(`href="${canonical}"`),
  'Canonical URL must use the deployment origin and base',
);
assert.ok(
  !html.includes('wp-content'),
  'Published page must not depend on WordPress assets',
);
assert.ok(
  !html.includes('INSTAGRAM_ACCESS_TOKEN'),
  'No credential references in HTML',
);
const paths = new Set();
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (match[1].startsWith('/')) paths.add(match[1]);
}
for (const match of html.matchAll(/srcset="([^"]+)"/g)) {
  for (const source of match[1].split(','))
    paths.add(source.trim().split(/\s+/)[0]);
}
for (const match of html.matchAll(/url\(['"]?(\/[^'"\)]+)['"]?\)/g))
  paths.add(match[1]);
for (const path of paths) {
  assert.ok(
    path.startsWith(`${base}/`),
    `Asset must include deployment base: ${path}`,
  );
  await access(resolve('dist', path.slice(base.length + 1)));
}
console.log(
  `Verified ${paths.size} local asset references and canonical URL for ${canonical}`,
);
