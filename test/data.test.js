// 저장소에 들어 있는 데이터 파일 형식 확인 + 개발 서버
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { STORE_KINDS } from '../public/js/content/index.js';
import { isKoreanCoord } from '../public/js/lib/geo.js';
import { createApp } from '../server/index.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url)));

test('data/stores.json: 매장 형식', () => {
  const data = read('stores.json');
  assert.equal(data.version, 1);
  assert.equal(data.count, data.stores.length);
  assert.ok(data.stores.length > 500);
  const ids = new Set();
  for (const s of data.stores) {
    assert.ok(STORE_KINDS[s.k], `${s.id} kind ${s.k}`);
    assert.ok(s.n && s.b, s.id);
    assert.ok(isKoreanCoord(s.la, s.lo), s.id);
    assert.ok(!ids.has(s.id), `중복 ${s.id}`);
    ids.add(s.id);
    if (s.w) assert.match(s.w, /^https?:\/\//);
  }
  for (const k of Object.keys(STORE_KINDS)) assert.ok(data.stores.some((s) => s.k === k), `${k} 매장이 하나도 없어요`);
});

test('data/prices.json: 참가격 형식', () => {
  const data = read('prices.json');
  assert.equal(data.version, 1);
  assert.match(data.inspectDay, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(data.products.length >= 3);
  for (const p of data.products) {
    assert.ok(['soju', 'beer', 'makgeolli', 'wine', 'whisky'].includes(p.kind), p.name);
    for (const [index, price, flags] of data.prices[p.id]) {
      assert.ok(data.stores[index], `${p.name} index ${index}`);
      assert.ok(price > 0 && Number.isInteger(price));
      assert.ok(flags >= 0 && flags <= 3);
    }
  }
  for (const s of data.stores) assert.ok(isKoreanCoord(s.la, s.lo), s.n);
});

test('개발 서버: 화면·데이터·지도 라이브러리', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /<title>술술/);
  assert.equal((await fetch(`${base}/data/prices.json`)).status, 200);
  assert.equal((await fetch(`${base}/vendor/leaflet/leaflet.js`)).status, 200);
  assert.equal((await fetch(`${base}/js/content/index.js`)).status, 200);
});

test('화면 파일은 모두 상대 경로 (GitHub Pages 하위 주소에서 동작)', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /(src|href)="\/(?!\/)/, 'index.html 에 / 로 시작하는 주소가 있어요');
  const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.doesNotMatch(sw, /'\/[a-z]/, 'sw.js 에 / 로 시작하는 주소가 있어요');
  // 서비스워커가 미리 받는 파일이 실제로 있는지
  const shell = [...sw.matchAll(/'((?:js|icons|vendor|data)\/[^']+|styles\.css|manifest\.webmanifest)'/g)].map((m) => m[1]);
  for (const f of shell) {
    if (f.startsWith('vendor/') || f.startsWith('data/')) continue;
    assert.ok(fs.existsSync(new URL(`../public/${f}`, import.meta.url)), `sw.js 의 ${f} 파일이 없어요`);
  }
  const jsFiles = fs.readdirSync(new URL('../public/js/', import.meta.url), { recursive: true }).filter((f) => f.endsWith('.js'));
  for (const f of jsFiles) assert.ok(shell.includes(`js/${f}`), `sw.js 에 js/${f} 가 빠졌어요`);
});
