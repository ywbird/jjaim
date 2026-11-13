import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { GRID_RULE, expandAt } from '../assets/guide.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const css = readFileSync(resolve(root, 'docs/assets/guide.css'), 'utf8');
const js = readFileSync(resolve(root, 'docs/assets/guide.mjs'), 'utf8');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
const publicUrl = 'https://ywbird.github.io/jjaim/';
const sourceUrl = 'https://github.com/ywbird/jjaim/blob/main/';

test('at uses a half-open source range and consecutive target indices', () => {
  assert.deepEqual(expandAt({ from: [0, 3], to: 5 }), [
    { source: 0, target: 5, axes: [] },
    { source: 1, target: 6, axes: [] },
    { source: 2, target: 7, axes: [] },
  ]);
});

test('the two-axis Grid example expands outer axis, inner axis, then j', () => {
  const placements = expandAt(GRID_RULE);
  assert.deepEqual(placements.map(p => [p.source, p.target]), [
    [0, 0], [1, 1], [2, 2], [0, 3], [1, 4], [2, 5],
    [3, 6], [4, 7], [5, 8], [3, 9], [4, 10], [5, 11],
  ]);
  assert.deepEqual(placements.filter((_, i) => i % 3 === 0).map(p => p.axes), [
    [0, 0], [0, 1], [1, 0], [1, 1],
  ]);
  assert.ok(placements.every(p => p.source >= 0 && p.source < 6 && p.target >= 0 && p.target < 12));
});

test('axis defaults reuse sources and advance targets by the range span', () => {
  const placements = expandAt({ from: [2, 4], to: 1, repeat: [{ count: 3 }] });
  assert.deepEqual(placements.map(p => [p.source, p.target]), [[2, 1], [3, 2], [2, 3], [3, 4], [2, 5], [3, 6]]);
});

test('explicit zero target stride overlaps rather than overwrites', () => {
  const placements = expandAt({ from: [0, 1], to: 0, repeat: [{ count: 2, from_stride: 1, to_stride: 0 }] });
  assert.deepEqual(placements.map(p => [p.source, p.target]), [[0, 0], [1, 0]]);
});

test('negative strides are preserved for in-range placements', () => {
  const placements = expandAt({ from: [3, 6], to: 3, repeat: [{ count: 2, from_stride: -3, to_stride: -3 }] });
  assert.deepEqual(placements.map(p => [p.source, p.target]), [[3, 3], [4, 4], [5, 5], [0, 0], [1, 1], [2, 2]]);
});

test('the visible JSON teaching rule matches the interactive rule', () => {
  const match = html.match(/<code id="repeat-code">([\s\S]*?)<\/code>/);
  assert.ok(match);
  assert.deepEqual(JSON.parse(match[1]), GRID_RULE);
});

test('every local asset, page link and anchor exists, with subpath-relative URLs', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size, 'IDs must be unique');
  for (const [, value] of html.matchAll(/\b(?:href|src)="([^"]*)"/g)) {
    assert.ok(value, 'No empty links');
    assert.ok(!value.startsWith('/'), `Root-absolute link breaks Pages subpaths: ${value}`);
    if (/^https?:/.test(value)) continue;
    if (value.startsWith('#')) {
      assert.ok(ids.includes(value.slice(1)), `Missing anchor ${value}`);
    } else {
      assert.ok(existsSync(resolve(root, value.split('#')[0])), `Missing file ${value}`);
    }
  }
});

test('basic document semantics and the full explanatory content are static HTML', () => {
  assert.match(html, /<html lang="ko"/);
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
  assert.equal([...html.matchAll(/<h2\b/g)].length, 10);
  assert.match(html, /href="#content">본문으로 건너뛰기/);
  for (const id of ['structure', 'textures', 'placement', 'repeat', 'layers', 'unicode', 'hangul', 'validation', 'boundaries', 'tools']) {
    assert.match(html, new RegExp(`<section id="${id}"`));
  }
  assert.match(html, /TTF 생성기가 없습니다/);
  assert.match(html, /U\+D800–U\+DFFF/);
  assert.match(html, /11,267자/);
});

test('the public guide metadata and static deployment target the Pages subpath', () => {
  assert.ok(html.includes(`<link rel="canonical" href="${publicUrl}">`));
  assert.ok(html.includes(`<meta property="og:url" content="${publicUrl}">`));
  assert.ok(html.includes(`<meta property="og:image" content="${publicUrl}docs/assets/jjaim-banner.svg">`));
  assert.ok(existsSync(resolve(root, '.nojekyll')), 'Pages must preserve the static files');
  assert.equal(readFileSync(resolve(root, '.nojekyll'), 'utf8').trim(), '');
  assert.doesNotMatch(html, /<base\b/i, 'Local preview must not require the public origin');
  for (const path of ['tools/editor/', 'tools/declaration-editor/']) {
    assert.ok(html.includes(`href="${path}"`), `Keep browser tool link relative: ${path}`);
  }
});

test('source documentation links use rendered Markdown with chapter anchors', () => {
  const specUrl = `${sourceUrl}SPEC.md`;
  assert.ok(html.includes(`href="${specUrl}"`));
  for (const anchor of [
    '1-scope-and-data-hierarchy', '2-coordinates-and-groups',
    '3-imports-and-indexed-placement', '4-unicode-mappings',
    '5-interpretation-and-renderer-responsibilities', '6-validity-and-validation',
    '71-full-scale-example-8--4--4-form-hangul',
  ]) {
    assert.ok(html.includes(`href="${specUrl}#${anchor}"`), `Missing source chapter ${anchor}`);
  }
  for (const path of ['README.md', 'tools/inspector/README.md']) {
    assert.ok(html.includes(`href="${sourceUrl}${path}"`));
  }
  assert.doesNotMatch(html, /\bhref="(?!https?:)[^"#]*\.md(?:#|")/, 'Do not depend on Pages Markdown rendering');
});

test('the README offers public tools before optional localhost instructions', () => {
  for (const path of ['', 'tools/editor/', 'tools/declaration-editor/']) {
    assert.ok(readme.includes(publicUrl + path), `Missing public link: ${path || 'guide'}`);
  }
  assert.ok(readme.indexOf(`${publicUrl}tools/editor/`) < readme.indexOf('python3 -m http.server'));
  assert.ok(readme.indexOf(`${publicUrl}tools/declaration-editor/`) < readme.indexOf('python3 -m http.server'));
  assert.ok(readme.includes('[`index.html`](index.html)'));
  assert.match(readme, /`\.nojekyll`/);
  for (const path of ['', 'tools/editor/', 'tools/declaration-editor/']) {
    assert.ok(readme.includes(`http://localhost:8000/${path}`));
  }
});

test('the guide adds no automatic motion, animated transitions or external runtime dependencies', () => {
  assert.doesNotMatch(css, /@keyframes|\banimation\s*:|\btransition\s*:|scroll-behavior\s*:\s*smooth/);
  assert.doesNotMatch(js, /requestAnimationFrame|setInterval|setTimeout|\.animate\(/);
  for (const [tag] of html.matchAll(/<(?:script|link|img)\b[^>]*>/g)) {
    const match = tag.match(/\b(?:src|href)="([^"]+)"/);
    assert.ok(match, `Resource tag must declare a URL: ${tag}`);
    if (/^<link\b/.test(tag) && /\brel="canonical"/.test(tag)) continue;
    assert.doesNotMatch(match[1], /^https?:/);
  }
});
