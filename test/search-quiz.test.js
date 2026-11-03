import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATEGORIES, GLOSSARY, PRODUCTS } from '../public/js/content/index.js';
import { QUESTIONS, recommend, scoreProduct, topCategories } from '../public/js/lib/quiz.js';
import { norm, searchCategories, searchProducts, searchTerms } from '../public/js/lib/search.js';

const names = (list) => list.map((x) => x.name);

test('norm: 띄어쓰기·기호·대소문자 무시', () => {
  assert.equal(norm(' Johnnie Walker 블랙-라벨 '), 'johnniewalker블랙라벨');
  assert.equal(norm("Maker's Mark"), 'makersmark');
});

test('제품 검색: 이름·별명·영어·띄어쓰기', () => {
  assert.equal(searchProducts(PRODUCTS, '발베니')[0].id, 'balvenie-12');
  assert.equal(searchProducts(PRODUCTS, '맥켈란')[0].id, 'macallan-12'); // 자주 틀리는 표기
  assert.equal(searchProducts(PRODUCTS, 'glenfiddich')[0].id, 'glenfiddich-12');
  assert.deepEqual(names(searchProducts(PRODUCTS, '참 이슬')).slice(0, 2).sort(), ['참이슬 오리지널', '참이슬 후레쉬']);
  assert.ok(names(searchProducts(PRODUCTS, '조니워커 블랙'))[0].includes('블랙'));
  assert.equal(searchProducts(PRODUCTS, '없는술이름xyz').length, 0);
  assert.equal(searchProducts(PRODUCTS, '   ').length, 0);
});

test('백과·용어 검색', () => {
  assert.equal(searchCategories(CATEGORIES, '막걸리')[0].id, 'traditional');
  assert.ok(searchCategories(CATEGORIES, '하이볼').some((c) => c.id === 'cocktail'));
  assert.equal(searchTerms(GLOSSARY, '탄닌')[0].term, '탄닌');
  assert.ok(searchTerms(GLOSSARY, '정미율').length >= 1);
});

test('취향 찾기: 달콤·가볍게·2만원 이하 → 모스카토 같은 술', () => {
  const r = recommend(PRODUCTS, { taste: 'sweet', strength: 'low', use: 'food', budget: 'b1' });
  assert.equal(r.length, 6);
  assert.ok(r.slice(0, 3).some((x) => /모스카토|막걸리/.test(x.product.name + x.product.sub)));
  assert.ok(r.every((x) => x.product.price[0] <= 30000), '예산을 크게 넘는 추천');
});

test('취향 찾기: 스모키·독하게 → 아일라 위스키', () => {
  const r = recommend(PRODUCTS, { taste: 'smoky', strength: 'high', use: 'sip', budget: 'b3' });
  assert.ok(r[0].product.tags.includes('smoky'));
  assert.ok(r[0].why.includes('스모키해요'));
});

test('취향 찾기: 한 종류는 최대 3개, 상위 종류', () => {
  for (const taste of QUESTIONS[0].options) {
    const r = recommend(PRODUCTS, { taste: taste.id, strength: 'any', use: 'mix', budget: 'b2' });
    const per = {};
    for (const x of r) per[x.product.cat] = (per[x.product.cat] || 0) + 1;
    assert.ok(Object.values(per).every((n) => n <= 3), taste.id);
    assert.ok(topCategories(r).length >= 1);
  }
  const p = PRODUCTS.find((x) => x.id === 'hennessy-xo');
  assert.ok(scoreProduct(p, { budget: 'b1' }).score < 0, '예산을 넘으면 감점');
});
