// 사용자 가격 제보: 검사·저장·요약, Worker·개발 서버 경로
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryStore } from '../server/identify/handler.js';
import { REPORT_DAYS, handlePriceGet, handlePriceReport, parseReport, priceBounds, summarize } from '../server/prices/handler.js';
import { createApp } from '../server/index.js';
import worker from '../worker/index.js';
import { PRODUCTS } from '../public/js/content/index.js';

const balvenie = PRODUCTS.find((p) => p.id === 'balvenie-12');
const DAY = 24 * 3600 * 1000;

test('제보 검사: 제품·가격 범위·매장·위치', () => {
  assert.ok(balvenie, '발베니 12년 제품이 있어야 해요');
  const [min, max] = priceBounds(balvenie);
  assert.ok(min < balvenie.price[0] && max > balvenie.price[1]);
  const ok = parseReport({ id: 'balvenie-12', price: '129,000'.replace(',', ''), store: ' 트레이더스  월계점 ', storeId: 'w12345', la: 37.62345, lo: 127.06789, ml: 700 });
  assert.equal(ok.report.p, 129000);
  assert.equal(ok.report.s, '트레이더스 월계점');
  assert.equal(ok.report.sid, 'w12345');
  assert.equal(ok.report.la, 37.623); // 매장 위치는 100m 단위
  assert.equal(ok.report.ml, 700);
  assert.equal(parseReport({ id: 'nope', price: 1000, store: '어디' }).error.body.code, 'bad_product');
  assert.equal(parseReport({ id: 'balvenie-12', price: 9000, store: '어디' }).error.body.code, 'price_out_of_range'); // 너무 쌈 (용량 착각)
  assert.equal(parseReport({ id: 'balvenie-12', price: 990000, store: '어디' }).error.body.code, 'price_out_of_range');
  assert.equal(parseReport({ id: 'balvenie-12', price: 'abc', store: '어디' }).error.body.code, 'bad_price');
  assert.equal(parseReport({ id: 'balvenie-12', price: 120000, store: ' ' }).error.body.code, 'bad_store');
  assert.equal(parseReport({ id: 'balvenie-12', price: 120000, store: '<script>x</script>' }).report.s.includes('<'), false);
  assert.equal(parseReport({ id: 'balvenie-12', price: 120000, store: '가게', la: 0, lo: 0 }).report.la, undefined);
});

test('제보 저장·요약·중복·하루 한도·오래된 제보', async () => {
  const store = createMemoryStore();
  let now = Date.UTC(2026, 10, 5, 3);
  const deps = { store, now: () => now, dailyPerIp: 3 };
  const r1 = await handlePriceReport({ body: { id: 'balvenie-12', price: 135000, store: '이마트 신촌점' }, ip: '1.1.1.1' }, deps);
  assert.equal(r1.status, 200);
  now += 1000;
  const r2 = await handlePriceReport({ body: { id: 'balvenie-12', price: 119000, store: '트레이더스 월계점' }, ip: '1.1.1.1' }, deps);
  assert.equal(r2.body.summary.min, 119000);
  assert.equal(r2.body.summary.n, 2);
  // 같은 매장·같은 가격을 하루 안에 또 → 하나로
  const r3 = await handlePriceReport({ body: { id: 'balvenie-12', price: 119000, store: '트레이더스 월계점' }, ip: '1.1.1.1' }, deps);
  assert.equal(r3.body.duplicate, true);
  assert.equal(r3.body.summary.n, 2);
  // 하루 3번까지
  const r4 = await handlePriceReport({ body: { id: 'balvenie-12', price: 125000, store: '보틀샵' }, ip: '1.1.1.1' }, deps);
  assert.equal(r4.status, 429);
  assert.equal((await handlePriceReport({ body: { id: 'balvenie-12', price: 125000, store: '보틀샵' }, ip: '2.2.2.2' }, deps)).status, 200);

  const one = await handlePriceGet({ id: 'balvenie-12' }, deps);
  assert.deepEqual(one.body.reports.map((r) => r.p), [125000, 119000, 135000]); // 최근 것 먼저
  const all = await handlePriceGet({}, deps);
  assert.equal(all.body.summary['balvenie-12'].min, 119000);
  assert.equal((await handlePriceGet({ id: 'nope' }, deps)).status, 404);

  // REPORT_DAYS 가 지나면 안 보임
  now += (REPORT_DAYS + 1) * DAY;
  assert.equal((await handlePriceGet({ id: 'balvenie-12' }, deps)).body.reports.length, 0);
  assert.deepEqual((await handlePriceGet({}, deps)).body.summary, {});
  assert.equal(summarize([], now), null);
  // 저장소 없으면
  assert.equal((await handlePriceGet({}, { store: null })).status, 503);
});

function fakeKv() {
  const map = new Map();
  return {
    map,
    async get(key, type) {
      const v = map.get(key);
      return v == null ? null : type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      map.set(key, value);
    },
  };
}

test('Worker: /api/prices 보기·제보, health 의 prices', async () => {
  const env = { ALLOWED_ORIGINS: 'https://kts4u1.github.io', CACHE: fakeKv() };
  const call = (path, init = {}) => worker.fetch(new Request(`https://w.example${path}`, init), env);
  const health = await (await call('/api/health', { headers: { Origin: 'https://kts4u1.github.io' } })).json();
  assert.equal(health.prices, true);
  const post = (origin, body) =>
    call('/api/prices', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), 'CF-Connecting-IP': '9.9.9.9' }, body: JSON.stringify(body) });
  const ok = await post('https://kts4u1.github.io', { id: 'balvenie-12', price: 121000, store: '코스트코 양평점' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://kts4u1.github.io');
  assert.equal((await post(null, { id: 'balvenie-12', price: 121000, store: '코스트코' })).status, 403);
  const sum = await (await call('/api/prices', { headers: { Origin: 'https://kts4u1.github.io' } })).json();
  assert.equal(sum.summary['balvenie-12'].min, 121000);
  const one = await (await call('/api/prices/balvenie-12')).json();
  assert.equal(one.reports[0].s, '코스트코 양평점');
  // KV 가 없으면 꺼짐
  const off = await worker.fetch(new Request('https://w.example/api/prices'), { ALLOWED_ORIGINS: '' });
  assert.equal(off.status, 503);
});

test('개발 서버: /api/prices', async () => {
  const server = createApp().listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = await fetch(`${base}/api/prices`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'balvenie-12', price: 128000, store: '와인앤모어' }) });
    assert.equal(post.status, 200);
    const one = await (await fetch(`${base}/api/prices/balvenie-12`)).json();
    assert.equal(one.reports[0].p, 128000);
    assert.equal((await (await fetch(`${base}/api/health`)).json()).prices, true);
  } finally {
    server.close();
  }
});

test('가격 도우미: 싼 편 기준, 판정, 가격 글자 읽기, 묶음·예산·정렬', async () => {
  const { BUDGETS, PRICE_GROUPS, goodPrice, inBudget, parseWon, priceProducts, priceVerdict, reportRows, shortWon, sortPriceProducts, timeAgo } = await import('../public/js/lib/prices.js');
  // 발베니 12년 11만~17만 → 아래쪽 4분의 1 = 12.5만
  assert.equal(goodPrice(balvenie), 125000);
  assert.equal(priceVerdict(balvenie, 119000), 'cheap');
  assert.equal(priceVerdict(balvenie, 150000), 'normal');
  assert.equal(priceVerdict(balvenie, 190000), 'pricey');
  for (const [text, won] of [['129,000', 129000], ['129000원', 129000], ['12만 9천', 129000], ['12.9만', 129000], ['9만8000', 98000], ['4900', 4900]]) assert.equal(parseWon(text), won, text);
  assert.ok(Number.isNaN(parseWon('abc')) && Number.isNaN(parseWon('')) && Number.isNaN(parseWon('천')));
  assert.equal(shortWon(125000), '12.5만');
  assert.equal(shortWon(6000), '6,000');

  // 묶음: 위스키·와인·양주…, 소주·맥주·참가격 상품은 빠짐
  const all = priceProducts(PRODUCTS);
  assert.ok(all.every((p) => !p.kca && p.cat !== 'soju' && p.cat !== 'beer'));
  assert.ok(priceProducts(PRODUCTS, 'whisky').length >= 40);
  assert.ok(priceProducts(PRODUCTS, 'wine').length >= 30);
  assert.ok(priceProducts(PRODUCTS, 'spirits').some((p) => p.cat === 'brandy'));
  assert.equal(new Set(PRICE_GROUPS.flatMap((g) => g.cats)).size, PRICE_GROUPS.flatMap((g) => g.cats).length);
  // 모든 비교 제품이 싼 편 기준을 가짐 (참고 가격 안)
  for (const p of all) assert.ok(goodPrice(p) >= p.price[0] && goodPrice(p) <= p.price[1], p.id);
  assert.ok(inBudget(balvenie, '10-20') && !inBudget(balvenie, 'u5') && inBudget(balvenie, 'all'));
  assert.equal(BUDGETS[0].id, 'all');
  const low = sortPriceProducts(priceProducts(PRODUCTS, 'whisky'), 'low');
  assert.ok(low[0].price[0] <= low.at(-1).price[0]);
  const byReport = sortPriceProducts(priceProducts(PRODUCTS, 'whisky'), 'report', { 'balvenie-12': { last: 5 }, 'jw-blue': { last: 9 } });
  assert.deepEqual(byReport.slice(0, 2).map((p) => p.id), ['jw-blue', 'balvenie-12']);

  // 제보 정리: 싼 순, 매장 거리
  const rows = reportRows(balvenie, [{ p: 135000, s: 'A', t: 2, la: 37.56, lo: 126.97 }, { p: 119000, s: 'B', t: 1 }], { lat: 37.5665, lng: 126.978 });
  assert.deepEqual(rows.map((r) => r.s), ['B', 'A']);
  assert.equal(rows[0].d, null);
  assert.ok(rows[1].d > 0 && rows[1].d < 2);
  const now = Date.UTC(2026, 10, 5, 3); // 한국 시간 낮 12시
  assert.equal(timeAgo(now - 3600e3, now), '오늘');
  assert.equal(timeAgo(now - 24 * 3600e3, now), '어제');
  assert.equal(timeAgo(now - 3 * 24 * 3600e3, now), '3일 전');
  assert.equal(timeAgo(now - 21 * 24 * 3600e3, now), '3주 전');
  assert.equal(timeAgo(now - 95 * 24 * 3600e3, now), '3달 전');
});
