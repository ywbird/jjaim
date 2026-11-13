import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
const prose = readme.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
const diagram = readFileSync(resolve(root, 'docs/assets/readme-composition.svg'), 'utf8');
const css = readFileSync(resolve(root, 'docs/assets/guide.css'), 'utf8');

function headingId(text) {
  return text.replace(/<[^>]+>/g, '').replace(/[`*]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/ /g, '-');
}

test('README uses a single title and preserves the main navigation anchors', () => {
  const headings = [...prose.matchAll(/^(#{1,6}) (.+)$/gm)];
  assert.equal(headings.filter(([, level]) => level.length === 1).length, 1);
  const ids = headings.map(([, , text]) => headingId(text));
  assert.equal(new Set(ids).size, ids.length, 'Heading links must be unambiguous');
  for (const id of ['바로-사용하기', '작은-조합-예시', '예제', '도구와-문서', '현재-범위']) {
    assert.ok(ids.includes(id), `Keep existing navigation anchor: ${id}`);
  }
  assert.ok(prose.indexOf('## 바로 사용하기') < prose.indexOf('## 작은 조합 예시'));
  assert.doesNotMatch(prose, /<style\b|<script\b|\bstyle\s*=|\bon\w+\s*=/i);
});

test('all README links, theme sources and images resolve locally or name an external URL', () => {
  const ids = [...prose.matchAll(/^#{1,6} (.+)$/gm)].map(([, text]) => headingId(text));
  const urls = [
    ...[...prose.matchAll(/!?\[[^\]\n]+\]\(([^)\s]+)\)/g)].map(([, url]) => url),
    ...[...prose.matchAll(/\b(?:href|src|srcset)="([^"]+)"/g)].map(([, url]) => url),
  ];
  assert.ok(urls.length > 20, 'Inspect the real document links, not an empty sample');
  for (const url of urls) {
    assert.ok(url && !url.startsWith('/'), `Keep a relative resource URL: ${url}`);
    if (/^https?:/.test(url)) {
      assert.equal(new URL(url).protocol, 'https:');
      continue;
    }
    if (url.startsWith('#')) {
      assert.ok(ids.includes(decodeURIComponent(url.slice(1))), `Missing README anchor ${url}`);
    } else {
      assert.ok(existsSync(resolve(root, decodeURIComponent(url.split('#')[0]))), `Missing local resource: ${url}`);
    }
  }
});

test('the official AI:X logo stays near the top with both themes and its original size', () => {
  const intro = readme.slice(0, readme.indexOf('\n## '));
  assert.match(intro, /href="https:\/\/0rwx\.com\/"/);
  assert.match(intro, /<picture>[\s\S]*<\/picture>/);
  for (const theme of ['dark', 'light']) {
    assert.ok(intro.includes(`<source media="(prefers-color-scheme: ${theme})" srcset="docs/assets/AI-X-${theme}.svg">`));
  }
  assert.match(intro, /<img\b[^>]*src="docs\/assets\/AI-X-light\.svg"[^>]*width="64" height="64"/);
});

test('README onboarding precedes setup and distinguishes image exchange from project history', () => {
  const onboarding = readme.slice(readme.indexOf('## 바로 사용하기'), readme.indexOf('## 작은 조합 예시'));
  for (const suffix of ['', 'tools/editor/', 'tools/declaration-editor/']) {
    assert.ok(onboarding.includes(`https://ywbird.github.io/jjaim/${suffix}`));
  }
  assert.match(onboarding, /프리셋/);
  assert.match(readme, /\*\*PNG \/ 일반 텍스처 ZIP\*\*[^\n]*선언·이력은 포함하지 않습니다/);
  assert.match(readme, /\*\*`\.jjaim` 프로젝트\*\*[^\n]*전체 이력과 분기/);
  assert.match(readme, /오리진/);
  assert.match(readme, /자동으로 이전되지는 않습니다/);
  assert.match(readme, /TTF 생성기는 없습니다/);
});

test('the README illustration is static, self-contained and matches the guide palette', () => {
  assert.match(readme, /src="docs\/assets\/readme-composition\.svg"/);
  assert.match(diagram, /<svg[^>]*viewBox="0 0 800 236"/);
  assert.match(diagram, /<title\b/);
  assert.match(diagram, /<desc\b/);
  assert.doesNotMatch(diagram, /<script\b|<style\b|<foreignObject\b|<animate\b|<animateTransform\b|<set\b|<image\b|@import|url\(/i);
  for (const [, url] of diagram.matchAll(/\bhref="([^"]+)"/g)) {
    assert.ok(url.startsWith('#'), `SVG must not load an external resource: ${url}`);
    assert.ok(diagram.includes(`id="${url.slice(1)}"`));
  }
  for (const color of ['#f7f5f0', '#242722', '#63675e', '#d8d9d0', '#a63823', '#fcfbf8']) {
    assert.ok(diagram.includes(color));
    assert.ok(css.includes(color), `Use the guide's existing color: ${color}`);
  }
});

test('the complete JSON teaching example remains a pair of references to the same part', () => {
  const match = readme.match(/^```json\n([\s\S]*?)^```/m);
  assert.ok(match);
  const declaration = JSON.parse(match[1]);
  assert.equal(declaration.texture_sets.main.sheet, 'parts.png');
  assert.deepEqual(declaration.groups.part.size, [8, 8]);
  assert.deepEqual(declaration.groups.pair.size, [16, 8]);
  assert.deepEqual(declaration.groups.pair.imports, [
    { group: 'part', offset: [0, 0], at: [{ from: [0, 1], to: 0 }] },
    { group: 'part', offset: [8, 0], at: [{ from: [0, 1], to: 0 }] },
  ]);
  assert.deepEqual(declaration.groups.pair.unicode, [{ from: [0, 1], to: 'U+E000' }]);
});
