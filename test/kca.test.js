import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { test } from 'node:test';
import { buildPrices, liquorKind, pickLiquorProducts, splitName } from '../scripts/lib/kca.js';
import { fetchPrices, linkKcaStores } from '../scripts/update-data.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/kca-snapshot.json', import.meta.url)));

test('술 상품 알아보기: 이름 앞부분 + 액체 용량', () => {
  assert.deepEqual(liquorKind('참이슬 후레쉬(360ml)', '360ml'), { kind: 'soju', label: '소주' });
  assert.equal(liquorKind('카스 프레쉬(6캔)', '2130ml').kind, 'beer');
  assert.equal(liquorKind('테라(500ml)', '500ml').kind, 'beer');
  assert.equal(liquorKind('서울장수생막걸리(750ml)', '750ml').kind, 'makgeolli');
  assert.equal(liquorKind('국순당 우국생(750ml)', '750ml').kind, 'makgeolli');
  // 술이 아닌데 글자가 겹치는 상품
  assert.equal(liquorKind('박카스맛 젤리(50g)', '50g'), null);
  assert.equal(liquorKind('폰테라 앵커버터(227g)', '227g'), null);
  assert.equal(liquorKind('맥스 부탄가스(4개)', '4개'), null);
  assert.equal(liquorKind('홈스타 맥스프레쉬 욕실용(900ml)', '900ml'), null);
  assert.equal(liquorKind('바세린 립테라피 스틱 오리지널(4.8g)', '5g'), null);
});

test('상품 이름 나누기', () => {
  assert.deepEqual(splitName('참이슬 후레쉬(360ml)'), { name: '참이슬 후레쉬', pack: '' });
  assert.deepEqual(splitName('카스 프레쉬(6캔)'), { name: '카스 프레쉬', pack: '6캔' });
  assert.deepEqual(splitName('테라'), { name: '테라', pack: '' });
});

test('pickLiquorProducts: 소주 → 맥주 → 막걸리 순서', () => {
  const list = pickLiquorProducts(fixture.products);
  assert.ok(list.length >= 6);
  assert.equal(list[0].kind, 'soju');
  assert.ok(list.every((p) => ['soju', 'beer', 'makgeolli'].includes(p.kind)));
  assert.ok(!list.some((p) => /젤리|버터|가스|욕실/.test(p.name)));
});

test('buildPrices: 실제 스냅샷 조각에서 매장·가격·편의점 가격', () => {
  const tiles = Object.values(fixture.tiles);
  const out = buildPrices({ manifest: fixture.manifest, products: fixture.products, tiles, brands: fixture.brands, fetchedAt: 'X' });
  assert.equal(out.inspectDay, '2026-10-23');
  assert.ok(out.stores.length >= 3);
  assert.ok(out.stores.every((s) => s.la > 33 && s.lo > 124 && s.n));
  const fresh = out.products.find((p) => p.name === '참이슬 후레쉬');
  assert.ok(fresh);
  const rows = out.prices[fresh.id];
  assert.ok(rows.length >= 3);
  for (const [index, price, flags] of rows) {
    assert.ok(out.stores[index]);
    assert.ok(price > 500 && price < 5000);
    assert.ok([0, 1, 2, 3].includes(flags));
  }
  assert.ok(out.brands.length >= 1);
  assert.ok(out.brands.every((b) => Object.keys(b.prices).every((id) => out.products.some((p) => p.id === id))));
  // 주소 끝의 괄호(동 이름)는 뗌
  assert.ok(out.stores.every((s) => !s.a || !/\)$/.test(s.a)));
});

test('fetchPrices: 가짜 스냅샷 서버에서 끝까지', async (t) => {
  const files = {
    '/kca/manifest.json': fixture.manifest,
    '/kca/products.json': fixture.products,
    '/kca/brands.json': fixture.brands,
    ...Object.fromEntries(Object.entries(fixture.tiles).map(([k, v]) => [`/kca/t/${k}.json`, v])),
  };
  const server = http.createServer((req, res) => {
    const body = files[req.url.split('?')[0]];
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(body ? JSON.stringify(body) : '{}');
  });
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const out = await fetchPrices({ base: `http://127.0.0.1:${server.address().port}/kca` });
  assert.equal(out.inspectDay, '2026-10-23');
  assert.ok(out.products.length > 0 && out.stores.length > 0);
});

test('fetchPrices: 형식이 바뀌면 멈춤 (기존 파일을 지키기 위해)', async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: 2 }));
  });
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  await assert.rejects(fetchPrices({ base: `http://127.0.0.1:${server.address().port}` }), /형식/);
});

test('linkKcaStores: 가까운 같은 종류 매장에 연결, 없으면 추가, 전통시장은 넣지 않음', () => {
  const osm = [
    { id: 'n1', k: 'mart', b: '이마트', n: '이마트 신촌점', la: 37.5566, lo: 126.9416 },
    { id: 'n2', k: 'shop', b: '와인샵', n: '와인샵', la: 37.5567, lo: 126.9417 },
  ];
  const prices = {
    stores: [
      { id: '10', n: '이마트신촌점', t: '대형마트', b: '이마트', la: 37.5568, lo: 126.9418, a: '서울 서대문구 신촌로 1' },
      { id: '11', n: '롯데슈퍼창천점', t: '슈퍼마켓(SSM)', b: '롯데슈퍼', la: 37.556, lo: 126.93 },
      { id: '12', n: '망원시장', t: '전통시장', la: 37.556, lo: 126.9 },
    ],
  };
  const out = linkKcaStores(osm, prices);
  const emart = out.find((s) => s.id === 'n1');
  assert.equal(emart.c, '10');
  assert.equal(emart.a, '서울 서대문구 신촌로 1');
  assert.equal(out.find((s) => s.id === 'n2').c, undefined);
  const added = out.find((s) => s.id === 'kca11');
  assert.equal(added.k, 'super');
  assert.equal(added.c, '11');
  assert.ok(!out.some((s) => s.id === 'kca12'));
  assert.equal(osm[0].c, undefined); // 원본은 그대로
});
