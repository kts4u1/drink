// 백과 콘텐츠가 서로 잘 맞물리는지 (오타·빠진 연결 찾기)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { BUY_BY_CATEGORY, CATEGORIES, CATEGORY_BY_ID, CHANNELS, GLOSSARY, GROUPS, GUIDES, PRODUCTS, STORE_KINDS, STORE_KIND_ORDER, TAG_LABELS } from '../public/js/content/index.js';
import { renderSection, rich } from '../public/js/render.js';

const SECTION_KEYS = new Set(['id', 'title', 'lead', 'text', 'steps', 'cards', 'terms', 'facts', 'pairs', 'tiers', 'recipes', 'channels', 'list', 'faq']);

test('술 종류: 필수 항목과 섹션 형식', () => {
  assert.equal(new Set(CATEGORIES.map((c) => c.id)).size, CATEGORIES.length);
  for (const c of CATEGORIES) {
    for (const f of ['id', 'name', 'en', 'emoji', 'group', 'abv', 'oneLine', 'intro']) assert.ok(c[f], `${c.id}.${f}`);
    assert.ok(GROUPS[c.group], `${c.id} group`);
    assert.ok(c.sections.length >= 2, c.id);
    const ids = new Set();
    for (const s of c.sections) {
      assert.ok(s.id && s.title, `${c.id} section`);
      assert.ok(!ids.has(s.id), `${c.id} 섹션 id 중복 ${s.id}`);
      ids.add(s.id);
      for (const k of Object.keys(s)) assert.ok(SECTION_KEYS.has(k), `${c.id}.${s.id} 알 수 없는 키 ${k}`);
      if (s.channels) for (const ch of s.channels) assert.ok(CHANNELS[ch], ch);
    }
  }
});

test('모든 섹션이 HTML 로 그려지고, 허용한 태그 말고는 글자로 남음', () => {
  for (const c of [...CATEGORIES, ...Object.values(GUIDES)]) {
    for (const s of c.sections) {
      const html = renderSection(s);
      assert.match(html, /<section class="block"/);
      assert.doesNotMatch(html, /<script|onerror=|javascript:/i, `${c.id}.${s.id}`);
    }
  }
  assert.equal(rich('<b>굵게</b><img src=x onerror=alert(1)>'), '<b>굵게</b>&lt;img src=x onerror=alert(1)&gt;');
});

test('제품: 종류·가격·맛 값이 올바름', () => {
  const ids = new Set();
  for (const p of PRODUCTS) {
    assert.ok(!ids.has(p.id), `제품 id 중복 ${p.id}`);
    ids.add(p.id);
    assert.ok(CATEGORY_BY_ID[p.cat], `${p.id} cat`);
    for (const f of ['name', 'sub', 'country', 'notes']) assert.ok(p[f], `${p.id}.${f}`);
    assert.ok(Array.isArray(p.price) && p.price[0] > 0 && p.price[0] <= p.price[1], `${p.id} price`);
    assert.ok(p.price[1] / p.price[0] <= 3, `${p.id} 가격 범위가 너무 넓어요`);
    assert.ok(p.sweet >= 1 && p.sweet <= 5 && p.body >= 1 && p.body <= 5, `${p.id} 맛 값`);
    assert.ok(p.abv === null || (p.abv > 0 && p.abv < 70), `${p.id} abv`);
    for (const t of p.tags || []) assert.ok(TAG_LABELS[t], `${p.id} tag ${t}`);
    for (const ch of p.where || []) assert.ok(CHANNELS[ch], `${p.id} where ${ch}`);
    if (p.kca) assert.doesNotThrow(() => new RegExp(p.kca), p.id);
  }
  // 술 종류마다 대표 제품이 하나는 있음 (칵테일 제외)
  for (const c of CATEGORIES.filter((x) => x.id !== 'cocktail')) assert.ok(PRODUCTS.some((p) => p.cat === c.id), `${c.id} 제품 없음`);
});

test('제품의 참가격 연결(kca)이 실제 데이터의 상품과 맞음', () => {
  const prices = JSON.parse(fs.readFileSync(new URL('../data/prices.json', import.meta.url)));
  for (const p of PRODUCTS.filter((x) => x.kca)) {
    const re = new RegExp(p.kca);
    assert.ok(prices.products.some((kp) => re.test(kp.name)), `${p.id} 의 kca(${p.kca})에 맞는 참가격 상품이 없어요`);
  }
});

test('구매처: 술 종류마다 추천 구매처, 채널·매장 종류 연결', () => {
  for (const c of CATEGORIES) {
    const list = BUY_BY_CATEGORY[c.id];
    assert.ok(list?.length >= 3, c.id);
    for (const b of list) {
      assert.ok(CHANNELS[b.ch], `${c.id} → ${b.ch}`);
      assert.ok(b.why && b.score >= 1 && b.score <= 5, `${c.id} → ${b.ch}`);
    }
  }
  assert.deepEqual([...STORE_KIND_ORDER].sort(), Object.keys(STORE_KINDS).sort());
  for (const ch of Object.values(CHANNELS)) {
    assert.ok(ch.name && ch.emoji && ch.good, ch.name);
    assert.ok(ch.cheap >= 1 && ch.cheap <= 5 && ch.variety >= 1 && ch.variety <= 5, ch.name);
  }
});

test('용어 사전: 중복 없음, 종류 연결', () => {
  const seen = new Set();
  for (const t of GLOSSARY) {
    assert.ok(t.term && t.desc, JSON.stringify(t));
    assert.ok(!seen.has(t.term), `용어 중복 ${t.term}`);
    seen.add(t.term);
    if (t.cat) assert.ok(CATEGORY_BY_ID[t.cat], `${t.term} cat ${t.cat}`);
  }
});
