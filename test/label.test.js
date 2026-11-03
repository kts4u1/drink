// 무료 라벨 분석기: 글자(OCR)·바코드 → 브랜드 사전·백과 설명
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BRANDS } from '../public/js/content/brands.js';
import { BUY_BY_CATEGORY, CATEGORY_BY_ID, PRODUCTS } from '../public/js/content/index.js';
import { analyzeLabel, categoryFromOff, editDistance, extractAttributes, matchBrands, nearHangul, prepText, priceTier, searchBrands } from '../public/js/lib/label.js';
import { analyzeName, dictionaryLookup, validBarcode } from '../public/js/local-vision.js';

const ctx = { brands: BRANDS, products: PRODUCTS, categories: CATEGORY_BY_ID, buy: BUY_BY_CATEGORY };
const photo = (text, extra = {}) => analyzeLabel({ text, source: 'photo', ...extra }, ctx);

test('브랜드 사전: 형식과 중복', () => {
  assert.ok(BRANDS.length >= 600, `브랜드 ${BRANDS.length}개`);
  // 종류마다 고르게 (적은 종류가 없게)
  const per = {};
  for (const b of BRANDS) per[b.cat] = (per[b.cat] || 0) + 1;
  for (const cat of ['whisky', 'wine', 'beer', 'brandy', 'vodka', 'gin', 'rum', 'tequila', 'liqueur', 'sake', 'traditional']) assert.ok(per[cat] >= 15, `${cat} ${per[cat]}개`);
  const seen = new Map();
  for (const b of BRANDS) {
    assert.ok(b.ko && b.names.length && b.desc && b.origin, `${b.ko} 필수 항목`);
    assert.ok(CATEGORY_BY_ID[b.cat], `${b.ko} 종류 ${b.cat}`);
    if (b.tier) assert.ok(b.tier >= 1 && b.tier <= 4, `${b.ko} tier`);
    for (const n of [b.ko, ...b.names]) {
      const key = prepText(n).replace(/\s/g, '');
      assert.ok(!seen.has(key) || seen.get(key) === b.ko, `이름 "${n}" 이 ${seen.get(key)} 와 ${b.ko} 에 같이 있어요`);
      seen.set(key, b.ko);
    }
  }
});

test('prepText: 악센트 없애도 한글은 그대로, 표기 통일', () => {
  assert.equal(prepText('Moët & Chandon Impérial'), 'moet chandon imperial');
  assert.equal(prepText('샤또 마고'), '샤토 마고');
  assert.equal(prepText('꼬냑'), '코냑');
  assert.equal(prepText('獺祭'), '獺祭');
});

test('editDistance: 최대 거리를 넘으면 일찍 멈춤', () => {
  assert.equal(editDistance('glenfiddich', 'glenfidich', 2), 1);
  assert.equal(editDistance('macallan', 'macallan', 1), 0);
  assert.ok(editDistance('laphroaig', 'ardbeg', 2) > 2);
});

test('extractAttributes: 도수·용량·숙성·빈티지·품종·지역', () => {
  const a = extractAttributes('SINGLE MALT SCOTCH WHISKY 12 YEARS OLD 40% vol 700ml');
  assert.equal(a.abv, 40);
  assert.equal(a.volumeMl, 700);
  assert.equal(a.age, 12);
  assert.ok(a.votes.whisky > 0);

  const w = extractAttributes('2019 Cabernet Sauvignon Valle de Colchagua Chile 14.5% 750 mL');
  assert.equal(w.vintage, 2019);
  assert.equal(w.abv, 14.5);
  assert.ok(w.grapes.some((g) => /카베르네 소비뇽/.test(g.ko)));
  assert.ok(w.votes.wine > 0);

  const k = extractAttributes('알코올 17.5도 360ml 희석식 소주');
  assert.equal(k.abv, 17.5);
  assert.equal(k.volumeMl, 360);
  assert.ok(k.votes.soju > 0);
});

test('matchBrands: OCR 오타·띄어쓰기에도 찾음', () => {
  const typo = matchBrands('GLENFIDICH 12 SINGLE MALT', BRANDS, {});
  assert.equal(typo[0].brand.ko, '글렌피딕');
  // 수입사 스티커: OCR 이 글자 사이를 띄움
  const spaced = matchBrands('제 품 명 : 라 프 로 익 10 년 수입원 :', BRANDS, {});
  assert.equal(spaced[0].brand.ko, '라프로익');
  // 기울어진 스티커: OCR 이 한 글자를 비슷한 글자로 (라 → 략)
  assert.equal(matchBrands('제품명. 략 프 로 익 10 ho Fy: 위스키', BRANDS, {})[0]?.brand.ko, '라프로익');
  const kanji = matchBrands('獺祭 純米大吟醸 45', BRANDS, {});
  assert.equal(kanji[0].brand.ko, '닷사이');
});

test('nearHangul: 한 글자 차이, 모양이 비슷한 글자만', () => {
  assert.equal(nearHangul('제품명략프로익10년', '라프로익'), true); // 략·라 초성 같음
  assert.equal(nearHangul('제품명보프로익10년', '라프로익'), false); // 보·라 초성·중성 다름
  assert.equal(nearHangul('략프로약', '라프로익'), false); // 두 글자 다름
  assert.equal(nearHangul('라프로익', '라프로익'), false); // 똑같으면 정확히 맞춘 쪽에서 처리
  // 정확히 맞는 브랜드가 비슷한 브랜드보다 먼저
  assert.equal(matchBrands('페이머스 그라우스', BRANDS, {})[0].brand.ko, '페이머스 그라우스');
});

test('matchBrands: 짧은 이름은 정확한 낱말만, 종류가 어긋나면 점수 깎기', () => {
  // "cass" 는 맞지만 "cassis"(리큐르 재료) 안의 cass 는 아님
  assert.equal(matchBrands('cass fresh lager', BRANDS, {})[0]?.brand.ko, '카스');
  assert.ok(!matchBrands('creme de cassis', BRANDS, {}).some((h) => h.brand.ko === '카스'));
  // 와인 라벨에 "Terra" 가 있어도 맥주 테라로 단정하지 않음
  const votes = extractAttributes('Terra Alta DO Garnacha red wine 2020').votes;
  const hits = matchBrands('Terra Alta DO Garnacha red wine 2020', BRANDS, votes);
  assert.ok(!hits.length || hits[0].brand.cat === 'wine' || hits[0].score < 12, '테라 맥주로 단정');
});

test('analyzeLabel: 위스키 라벨 → 브랜드·숙성·마시는 법·가격대', () => {
  const r = photo('THE GLENLIVET\nSINGLE MALT SCOTCH WHISKY\n12 YEARS OF AGE\n40% vol 700ml');
  assert.equal(r.is_alcohol, true);
  assert.equal(r.category, 'whisky');
  assert.match(r.name_ko, /글렌리벳/);
  assert.match(r.name_ko, /12/);
  assert.equal(r.abv, '40%');
  assert.ok(r.how_to_drink.methods.length >= 1);
  assert.ok(r.price.krw_low > 0 && r.price.krw_high >= r.price.krw_low);
  assert.ok(r.food_pairing.length >= 3);
  assert.ok(['high', 'medium', 'low'].includes(r.confidence));
  assert.match(r.confidence_note, /AI 없이/);
});

test('analyzeLabel: 모르는 와인은 지역·품종으로 이름 붙이기', () => {
  const r = photo('CHATEAU DU PETIT BOIS\nBORDEAUX SUPERIEUR\nAppellation Bordeaux Superieur Controlee\n2018 13.5% vol');
  assert.equal(r.category, 'wine');
  assert.match(r.name_ko, /보르도/);
  assert.match(r.name_ko, /생산자 확인 필요/);
  assert.equal(r.confidence, 'low');
  assert.match(r.age_or_vintage, /2018/);
});

test('analyzeLabel: 바코드 제품(Open Food Facts)만 있어도 알아봄', () => {
  const off = { product_name: 'Johnnie Walker Black Label 12 Year Old', brands: 'Johnnie Walker', quantity: '700 ml', categories_tags: ['en:alcoholic-beverages', 'en:whiskies'] };
  assert.equal(categoryFromOff(off.categories_tags), 'whisky');
  const r = photo('', { off, barcode: '5000267024004' });
  assert.equal(r.category, 'whisky');
  assert.match(r.name_ko, /조니워커/);
  assert.equal(r.volume, '700ml');
  assert.match(r.confidence_note, /5000267024004/);
});

test('analyzeLabel: 술이 아니면 안내', () => {
  const r = photo('Lorem ipsum dolor sit amet 2024');
  assert.equal(r.is_alcohol, false);
  assert.ok(r.not_alcohol_reason);
});

test('analyzeName·searchBrands: 이름으로 찾기', () => {
  for (const [q, want] of [
    ['맥캘란', '맥캘란'],
    ['montes alpha', '몬테스'],
    ['moet', '모엣'],
    ['참이슬', '참이슬'],
  ]) {
    const r = analyzeName(q);
    assert.equal(r.is_alcohol, true, q);
    assert.match(r.name_ko, new RegExp(want), q);
  }
  assert.equal(analyzeName('없는술이름쀍').is_alcohol, false);
  const hits = searchBrands(BRANDS, '글렌');
  assert.ok(hits.length >= 3 && hits.every((b) => b.cat === 'whisky'), hits.map((b) => b.ko).join(','));
  assert.deepEqual(searchBrands(BRANDS, 'a'), []);
});

test('validBarcode: 체크 숫자', () => {
  assert.equal(validBarcode('5000267024004'), true); // EAN-13
  assert.equal(validBarcode('5000267024005'), false);
  assert.equal(validBarcode('96385074'), true); // EAN-8
  assert.equal(validBarcode('036000291452'), true); // UPC-A
  assert.equal(validBarcode('12345'), false);
});

test('두 글자 한글 브랜드는 같은 종류 단서가 있으면 사진에서도 알아봄, 회사 이름은 무시', () => {
  assert.match(photo('청하 청주 롯데칠성음료').name_ko, /청하/);
  assert.match(photo('필굿 발포주 오비맥주').name_ko, /필굿/);
  // "하이트진로"는 회사 이름이라 하이트(맥주)·진로(소주)로 보지 않음
  assert.match(photo('제품명 참이슬 후레쉬 희석식소주 하이트진로(주)').name_ko, /참이슬/);
  assert.match(photo('진로 소주 하이트진로').name_ko, /^진로/);
  assert.match(photo('산사춘 약주 배상면주가').name_ko, /산사춘/);
  // 새로 넣은 브랜드
  assert.match(photo('CHATEAU LYNCH BAGES PAUILLAC GRAND CRU CLASSE 2016').name_ko, /린치 바주/);
  assert.match(photo('WESTMALLE TRAPPIST TRIPEL').name_ko, /베스트말레/);
  assert.match(photo('ST-REMY XO FRENCH BRANDY').name_ko, /생 레미/);
  assert.match(photo('REMY MARTIN VSOP FINE CHAMPAGNE COGNAC').name_ko, /레미 마르탱/);
  // 키안티 클라시코의 검은 수탉(Gallo Nero)을 미국 갤로 와인으로 보지 않음
  assert.ok(!matchBrands('CHIANTI CLASSICO GALLO NERO VINO ROSSO', BRANDS, {}).some((h) => h.brand.ko === '갤로' && h.score >= 6));
});

test('searchBrands: 이름에 없으면 스타일·원산지로', () => {
  const cognac = searchBrands(BRANDS, '코냑');
  assert.ok(cognac.length >= 4 && cognac.every((b) => b.cat === 'brandy'), cognac.map((b) => b.ko).join(','));
  assert.ok(searchBrands(BRANDS, 'ipa').every((b) => b.cat === 'beer'));
  assert.ok(searchBrands(BRANDS, '칠레').every((b) => b.cat === 'wine'));
  // 이름이 맞으면 이름이 먼저
  assert.equal(searchBrands(BRANDS, '발베니')[0].ko, '발베니');
});

test('dictionaryLookup: 사전에 있는 이름만 (없으면 AI 에게)', () => {
  assert.match(dictionaryLookup('Westmalle Tripel').name_ko, /베스트말레/);
  assert.match(dictionaryLookup('샤또 마고 2015').name_ko, /샤토 마고/);
  assert.match(dictionaryLookup('청하').name_ko, /청하/);
  assert.equal(dictionaryLookup('보르도 와인 추천'), null);
  assert.equal(dictionaryLookup('처음 보는 수제 맥주'), null);
  assert.equal(dictionaryLookup('없는술이름쀍'), null);
});

test('가격대: 오래 숙성한 위스키·코냑 XO 는 올려 잡음', () => {
  const brand = { ko: 'X', tier: 1 };
  assert.equal(priceTier(brand, 'whisky', { age: 12 }), 1);
  assert.equal(priceTier(brand, 'whisky', { age: 15 }), 3);
  assert.equal(priceTier(brand, 'whisky', { age: 18 }), 3);
  assert.equal(priceTier({ ko: 'Y', tier: 3 }, 'whisky', { age: 18 }), 4);
  assert.equal(priceTier(brand, 'whisky', { age: 30 }), 4);
  assert.equal(priceTier({ ko: 'H', tier: 3 }, 'brandy', {}, 'HENNESSY X.O COGNAC'), 4);
  assert.equal(priceTier({ ko: 'H', tier: 3 }, 'brandy', {}, 'HENNESSY VSOP'), 3);
  // 실제 결과
  const old = analyzeName('발렌타인 30년');
  assert.match(old.name_ko, /발렌타인/);
  assert.ok(old.price.krw_low >= 200000, `${old.price.krw_low}`);
  assert.match(old.price.basis, /30년급/);
  assert.ok(analyzeName('발렌타인 파이니스트').price.krw_high <= 90000);
});
