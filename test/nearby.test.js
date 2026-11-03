import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STORE_KINDS } from '../public/js/content/index.js';
import { distanceKm, fmtDistance, isKoreanCoord, walkMinutes } from '../public/js/lib/geo.js';
import { comparePrices, countByKind, countByRadius, matchKcaProducts, nearestStores, pricesAtStore, sortStores, storesWithin } from '../public/js/lib/nearby.js';

const center = { lat: 37.5665, lng: 126.978 }; // 서울시청
// 위도 0.009도 ≈ 1km
const stores = [
  { id: 'a', k: 'shop', n: 'A', la: 37.5665 + 0.0045, lo: 126.978 }, // 0.5km
  { id: 'b', k: 'mart', n: 'B', la: 37.5665 + 0.018, lo: 126.978 }, // 2km
  { id: 'c', k: 'warehouse', n: 'C', la: 37.5665 + 0.036, lo: 126.978 }, // 4km
  { id: 'd', k: 'mart', n: 'D', la: 37.5665 + 0.09, lo: 126.978 }, // 10km
  { id: 'e', k: 'department', n: 'E', la: 35.1796, lo: 129.0756 }, // 부산
];

test('거리 계산과 표시', () => {
  const d = distanceKm(37.5665, 126.978, 35.1796, 129.0756);
  assert.ok(d > 320 && d < 330);
  assert.equal(fmtDistance(0.347), '350m');
  assert.equal(fmtDistance(1.24), '1.2km');
  assert.equal(fmtDistance(14.4), '14km');
  assert.equal(walkMinutes(0.75), 10);
  assert.equal(walkMinutes(3), null);
  assert.equal(isKoreanCoord(0, 0), false);
  assert.equal(isKoreanCoord(33.5, 126.5), true);
});

test('반경 안 매장 (가까운 순), 종류 거르기', () => {
  assert.deepEqual(storesWithin(stores, center, 3).map((s) => s.id), ['a', 'b']);
  assert.deepEqual(storesWithin(stores, center, 20, ['mart']).map((s) => s.id), ['b', 'd']);
  assert.ok(storesWithin(stores, center, 3)[0].d < 0.6);
});

test('반경별·종류별 개수, 가장 가까운 곳', () => {
  assert.deepEqual(countByRadius(stores, center, [1, 3, 5, 20]), { 1: 1, 3: 2, 5: 3, 20: 4 });
  assert.deepEqual(countByKind(storesWithin(stores, center, 20)), { shop: 1, mart: 2, warehouse: 1 });
  assert.deepEqual(nearestStores(stores, center, { kinds: ['mart'], limit: 1 }).map((s) => s.id), ['b']);
  assert.equal(nearestStores(stores, center, { kinds: ['department'], maxKm: 60 }).length, 0);
});

test('정렬: 싸게 사기 좋은 순은 창고형을 앞으로 (거리도 반영)', () => {
  const list = storesWithin(stores, center, 5);
  assert.equal(sortStores(list, 'cheap', STORE_KINDS)[0].id, 'c');
  assert.equal(sortStores(list, 'variety', STORE_KINDS)[0].id, 'a');
  assert.equal(sortStores(list, 'distance', STORE_KINDS)[0].id, 'a');
});

const prices = {
  inspectDay: '2026-10-23',
  products: [
    { id: '1', name: '참이슬 후레쉬', pack: '', size: '360ml', kind: 'soju' },
    { id: '2', name: '카스 프레쉬', pack: '6캔', size: '2130ml', kind: 'beer' },
    { id: '3', name: '카스 프레쉬', pack: '', size: '500ml', kind: 'beer' },
  ],
  stores: [
    { id: 's0', n: '가까운 슈퍼', t: '슈퍼마켓(SSM)', la: 37.5665 + 0.009, lo: 126.978 }, // 1km
    { id: 's1', n: '먼 마트', t: '대형마트', la: 37.5665 + 0.045, lo: 126.978 }, // 5km
    { id: 's2', n: '부산 마트', t: '대형마트', la: 35.1796, lo: 129.0756 },
  ],
  prices: {
    1: [
      [0, 1410, 0, null, null, null],
      [1, 1240, 1, '2026-10-20', '2026-10-31', 1400],
      [2, 1300, 2, null, null, null],
    ],
    2: [[1, 9850, 0]],
  },
  brands: [
    { brand: 'GS25', prices: { 1: [1900, 0] } },
    { brand: '이마트24', prices: { 1: [1500, 0] } },
  ],
};

test('가격 비교: 반경 안 싼 순, 통계, 편의점 가격', () => {
  const r = comparePrices(prices, '1', center, 10, { minRows: 1 });
  assert.equal(r.expanded, null);
  assert.deepEqual(r.rows.map((x) => x.store.id), ['s1', 's0']);
  assert.equal(r.rows[0].discount, true);
  assert.equal(r.rows[0].dcEnd, '2026-10-31');
  assert.equal(r.stats.min, 1240);
  assert.equal(r.stats.median, 1325);
  assert.equal(r.stats.nationCount, 3);
  assert.deepEqual(r.brands.map((b) => b.brand), ['이마트24', 'GS25']);
});

test('가격 비교: 반경 안에 매장이 모자라면 가장 가까운 곳으로 넓힘', () => {
  const r = comparePrices(prices, '1', center, 0.5, { minRows: 2 });
  assert.equal(r.rows.length, 2);
  assert.ok(r.expanded >= 5 && r.expanded <= 6, String(r.expanded));
  const none = comparePrices(prices, '9', center, 10);
  assert.equal(none.rows.length, 0);
  assert.equal(none.stats.min, null);
});

test('제품 카탈로그와 참가격 상품 연결, 매장별 가격', () => {
  assert.deepEqual(matchKcaProducts(prices, '^카스\\s*프레[시쉬]').map((p) => p.id), ['2', '3']);
  assert.deepEqual(matchKcaProducts(prices, null), []);
  const at = pricesAtStore(prices, 's1');
  assert.deepEqual(at.map((x) => [x.product.id, x.price, x.discount]), [['1', 1240, true], ['2', 9850, false]]);
  assert.deepEqual(pricesAtStore(prices, 'nope'), []);
});
