// 와인·위스키·양주 가격 안내: 싼 편 기준, 판매처별 가격, 할인 행사 때, 오늘 가격 링크, 묶음·예산·정렬
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRODUCTS } from '../public/js/content/index.js';
import { fmtWonShort } from '../public/js/util.js';
import {
  BUDGETS,
  DUTY_FREE_CATS,
  HOLIDAYS,
  PRICE_GROUPS,
  channelPrices,
  goodPrice,
  groupOf,
  inBudget,
  livePriceLinks,
  priceProducts,
  priceVerdict,
  saleSeasons,
  seasonText,
  sortPriceProducts,
} from '../public/js/lib/prices.js';

const byId = (id) => PRODUCTS.find((p) => p.id === id);
const balvenie = byId('balvenie-12');
const KST = (iso) => Date.parse(`${iso}T12:00:00+09:00`);

test('싼 편 기준과 판정', () => {
  // 발베니 12년 9.5만~13.5만 → 아래쪽 4분의 1 = 10.5만
  assert.deepEqual(balvenie.price, [95000, 135000]);
  assert.equal(goodPrice(balvenie), 105000);
  assert.equal(priceVerdict(balvenie, 99000), 'cheap');
  assert.equal(priceVerdict(balvenie, 120000), 'normal');
  assert.equal(priceVerdict(balvenie, 150000), 'pricey');
  assert.equal(fmtWonShort(125000), '12.5만');
  assert.equal(fmtWonShort(135000), '13.5만'); // 14만으로 반올림하지 않음
  assert.equal(fmtWonShort(6000), '6,000');
  for (const p of priceProducts(PRODUCTS)) assert.ok(goodPrice(p) >= p.price[0] && goodPrice(p) <= p.price[1], p.id);
});

test('판매처별 가격: 창고형 마트가 가장 싸고 백화점이 가장 비쌈, 술마다 맞는 판매처', () => {
  const rows = channelPrices(balvenie);
  assert.equal(rows[0].id, 'warehouse');
  assert.deepEqual([rows[0].lo, rows[0].hi], [95000, 105000]); // 코스트코·트레이더스 9만 원대 중반과 맞음
  assert.equal(rows[0].verdict, 'cheap');
  const mart = rows.find((r) => r.id === 'mart');
  assert.ok(mart.lo >= 105000 && mart.hi <= 120000); // 대형마트 11만 원 안팎
  assert.equal(rows.at(-1).id, 'department');
  assert.equal(rows.at(-1).verdict, 'pricey');
  for (const p of priceProducts(PRODUCTS)) {
    const list = channelPrices(p);
    assert.ok(list.length >= 3, p.id);
    for (const r of list) assert.ok(r.lo > 0 && r.lo <= r.hi && r.name && r.emoji, `${p.id} ${r.id}`);
    // 싼 곳부터
    assert.ok(list[0].lo <= list.at(-1).lo, p.id);
  }
  // 전통주는 온라인 주문(택배)이 되고, 와인·위스키는 안 됨
  assert.ok(channelPrices(byId('hwayo-25')).some((r) => r.id === 'online'));
  assert.ok(!channelPrices(balvenie).some((r) => r.id === 'online'));
  assert.ok(DUTY_FREE_CATS.has('whisky') && !DUTY_FREE_CATS.has('wine'));
});

test('할인 행사 때: 명절 4주 전부터, 연말 12월', () => {
  // 11월 5일 → 연말 행사(12월 1일부터, 26일 남음), 그다음 설 선물 세트 행사(2027년 설 2월 7일)
  const s = saleSeasons(KST('2026-11-05'));
  assert.deepEqual(
    s.map((x) => [x.name, x.start, x.end, x.active, x.daysLeft]),
    [
      ['연말 주류 행사', '2026-12-01', '2026-12-31', false, 26],
      ['설 선물 세트 행사', '2027-01-10', '2027-02-06', false, 66],
    ],
  );
  assert.equal(seasonText(s[0]), '연말 주류 행사 12월 1일~12월 31일 · 26일 남음');
  // 추석 3주 전이면 지금 행사 중
  const now = saleSeasons(KST('2027-08-28'));
  assert.equal(now[0].name, '추석 선물 세트 행사');
  assert.equal(now[0].active, true);
  assert.equal(seasonText(now[0]), '지금 추석 선물 세트 행사 기간이에요 (9월 14일까지)');
  // 명절 표가 다 지나도 연말 행사는 안내
  const far = saleSeasons(KST('2031-03-01'));
  assert.deepEqual(far.map((x) => x.start), ['2031-12-01', '2032-12-01']);
  // 명절 날짜는 순서대로
  const days = HOLIDAYS.map((h) => h.date);
  assert.deepEqual([...days].sort(), days);
});

test('오늘 가격 링크: 위스키는 위스키와치, 전통주는 데일리샷 없음', () => {
  const w = livePriceLinks(balvenie);
  assert.deepEqual(w.map((l) => l.id), ['whiskywatch', 'dailyshot', 'naver']);
  assert.equal(w[0].url, `https://whiskywatch.co.kr/whisky?q=${encodeURIComponent('발베니 12년 더블우드')}`);
  // 괄호 속 말은 빼고 검색
  assert.ok(livePriceLinks(byId('macallan-12'))[0].url.endsWith(encodeURIComponent('맥캘란 12년')));
  assert.deepEqual(livePriceLinks(byId('opus-one')).map((l) => l.id), ['dailyshot', 'naver']);
  assert.deepEqual(livePriceLinks(byId('hwayo-25')).map((l) => l.id), ['naver']);
});

test('묶음·예산·정렬', () => {
  const all = priceProducts(PRODUCTS);
  assert.ok(all.every((p) => !p.kca && p.cat !== 'soju' && p.cat !== 'beer'));
  assert.ok(priceProducts(PRODUCTS, 'whisky').length >= 40);
  assert.ok(priceProducts(PRODUCTS, 'wine').length >= 30);
  assert.ok(priceProducts(PRODUCTS, 'spirits').some((p) => p.cat === 'brandy'));
  assert.equal(new Set(PRICE_GROUPS.flatMap((g) => g.cats)).size, PRICE_GROUPS.flatMap((g) => g.cats).length);
  assert.equal(groupOf(balvenie).id, 'whisky');
  assert.equal(groupOf(byId('cass')), null);
  assert.ok(inBudget(balvenie, '5-10') && !inBudget(balvenie, 'u5') && inBudget(balvenie, 'all'));
  assert.equal(BUDGETS[0].id, 'all');
  const whisky = priceProducts(PRODUCTS, 'whisky');
  const low = sortPriceProducts(whisky, 'low');
  const high = sortPriceProducts(whisky, 'high');
  assert.ok(low[0].price[0] <= low.at(-1).price[0]);
  assert.ok(high[0].price[1] >= high.at(-1).price[1]);
  assert.equal(sortPriceProducts(whisky, 'pop'), whisky);
});
