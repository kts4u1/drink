// 세계 술 데이터: 데이터 받기(zip·csv·위키데이터 정리)와 찾기·설명 만들기
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import zlib from 'node:zlib';
import { CATEGORY_BY_ID } from '../public/js/content/index.js';
import { blockedKeys, coreKey, createWorld, findProducer, keyShard, keysFor, nameKey, pickWine, prefixesFor, worldResult } from '../public/js/lib/world.js';
import { buildWorld, parseCsv, productCategory, pyList, readWikidata, readXWines, unzipFirst } from '../scripts/update-world.js';

const ctx = { categories: CATEGORY_BY_ID };

/** 테스트용 zip (deflate 파일 하나) */
function makeZip(name, text) {
  const data = zlib.deflateRawSync(Buffer.from(text));
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + nameBuf.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBuf.length, 12);
  end.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, end]);
}

const CSV = `WineID,WineName,Type,Elaborate,Grapes,Harmonize,ABV,Body,Acidity,Code,Country,RegionID,RegionName,WineryID,WineryName,Website,Vintages
1,Rioja Crianza,Red,Varietal/100%,"['Tempranillo', 'Graciano']","['Beef', 'Lamb']",14.0,Full-bodied,High,ES,Spain,1,Rioja Alavesa,10,Ostatu,,"[2019, 2018]"
2,Rioja Blanco,White,Varietal/100%,['Viura'],"['Shellfish', 'Lean Fish']",12.5,Light-bodied,High,ES,Spain,1,Rioja Alavesa,10,Ostatu,,[2021]
3,Selección,Red,Varietal/100%,['Tempranillo'],['Beef'],14.5,Very full-bodied,Medium,ES,Spain,1,Rioja Alavesa,10,Ostatu,,[2018]
4,Margaux (Premier Grand Cru Classé),Red,Assemblage/Bordeaux Red Blend,"['Cabernet Sauvignon', 'Merlot']","['Beef', 'Game Meat']",13.0,Full-bodied,High,FR,France,2,Margaux,11,Château Margaux,,[2015]
5,"Nero d'Avola ""Classico""",Red,Varietal/100%,"[""Nero d'Avola""]",['Pasta'],13.5,Medium-bodied,Medium,IT,Italy,3,Sicilia,12,Cantina Prova,,[2020]
`;

function smallWorld() {
  const wineries = readXWines(CSV);
  const wd = readWikidata(
    [
      { i: 'Q1', type: 'whisky', en: 'Glen Testa distillery', countryKo: '영국', adminEn: 'Speyside' },
      { i: 'Q1', type: 'whisky', en: 'Glen Testa distillery', countryKo: '영국', adminEn: 'Moray' }, // 같은 항목 두 줄
      { i: 'Q2', type: 'wine', en: 'Bodegas Ostatu' }, // X-Wines 의 Ostatu 와 같은 곳
      { i: 'Q3', type: 'beer', en: 'Q3' }, // 이름 없음 (Q번호만)
    ],
    (r) => r.type,
  );
  return { wineries, wd, ...buildWorld(wineries, wd) };
}

function memoryFetch(meta, kShards, shards) {
  const files = new Map([['meta.json', meta]]);
  for (const [k, v] of Object.entries(kShards)) files.set(`k/${k}.json`, v);
  shards.forEach((v, i) => files.set(`w/${i}.json`, v));
  return async (p) => {
    if (!files.has(p)) throw new Error(`404 ${p}`);
    return JSON.parse(JSON.stringify(files.get(p)));
  };
}

test('데이터 받기: zip·csv·파이썬 목록 읽기', () => {
  assert.equal(unzipFirst(makeZip('a/XWines_wines.csv', 'hello,세계'), (n) => n.endsWith('.csv')).toString(), 'hello,세계');
  assert.throws(() => unzipFirst(Buffer.from('not a zip')), /zip/);
  const rows = parseCsv('a,b\n"x, y","say ""hi"""\r\n1,"line\nbreak"\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'say "hi"'], ['1', 'line\nbreak']]);
  assert.deepEqual(pyList(`['Merlot', "Nero d'Avola"]`), ['Merlot', "Nero d'Avola"]);
  assert.deepEqual(pyList(''), []);
});

test('데이터 받기: X-Wines → 와이너리별 와인, 위키데이터 정리, 합치기', () => {
  const { wineries, wd, meta, kShards, shards } = smallWorld();
  const ostatu = wineries.find((w) => w.name === 'Ostatu');
  assert.equal(ostatu.wines.length, 3);
  assert.deepEqual(ostatu.wines[0], { name: 'Rioja Crianza', type: 'r', grapes: ['Tempranillo', 'Graciano'], harm: ['Beef', 'Lamb'], abv: 14, body: 4, acid: 3, region: 'Rioja Alavesa' });
  assert.equal(wineries.find((w) => w.name === 'Cantina Prova').wines[0].name, 'Nero d\'Avola "Classico"');
  // 위키데이터: 같은 항목은 하나로, 이름 없는 항목은 뺌
  assert.equal(wd.length, 2);
  assert.equal(productCategory('single malt whisky'), 'whisky');
  assert.equal(productCategory('jenever'), 'gin');
  assert.equal(productCategory('Calvados'), 'brandy');
  assert.equal(productCategory('mineral water'), null);
  // 합치기: X-Wines 에 있는 Ostatu 는 위키데이터 쪽을 버림
  assert.equal(meta.counts.wines, 5);
  assert.equal(meta.counts.wikidata, 1);
  assert.equal(meta.counts.producers, 4);
  assert.ok(meta.sources.every((s) => s.license === 'CC0-1.0'));
  // 열쇠: "chateau margaux" 는 있지만 "margaux"(산지 이름)만으로는 없음
  const all = Object.assign({}, ...Object.values(kShards));
  assert.ok(all['chateau margaux']);
  assert.equal(all.margaux, undefined);
  assert.ok(all.ostatu);
  assert.ok(all['glen testa']);
  // 열쇠는 흔한 첫 단어를 건너뛴 조각에
  assert.equal(keyShard('chateau margaux'), 'mar');
  assert.ok(kShards.mar['chateau margaux']);
  assert.equal(shards.length, 1);
  assert.deepEqual(meta.keyFiles, Object.keys(kShards).sort());
});

test('찾기: 열쇠 만들기·막기', () => {
  const blocked = blockedKeys({ regions: ['Margaux', 'Rioja Alavesa'], grapes: ['Syrah/Shiraz'] });
  assert.deepEqual(keysFor('Château Margaux', blocked), ['chateau margaux']);
  assert.deepEqual(keysFor('Bodegas Ostatu', blocked), ['bodegas ostatu', 'ostatu']);
  assert.deepEqual(keysFor('Shiraz', blocked), []);
  assert.deepEqual(keysFor('Gran Reserva', blocked), []); // 흔한 말뿐
  assert.deepEqual(keysFor('Aurora', blocked, new Set(['aurora'])), []); // 라벨에 흔한 말
  assert.deepEqual(keysFor('Nord', blocked), []); // 한 단어는 5글자 이상
  assert.equal(coreKey('Bodega Catena Zapata'), 'catena zapata');
  assert.equal(nameKey('Château  Léoville-Barton'), 'chateau leoville barton');
  assert.ok(prefixesFor('Bodegas Ostatu Rioja').includes('ost'));
});

test('찾기: 생산자·와인 고르기, 결과 만들기', async () => {
  const { meta, kShards, shards } = smallWorld();
  const world = createWorld(memoryFetch(meta, kShards, shards), ctx);
  // 있는 조각만 받음
  const asked = [];
  const fetcher = memoryFetch(meta, kShards, shards);
  const counting = createWorld(async (p) => (asked.push(p), fetcher(p)), ctx);
  await counting.lookup('BODEGAS OSTATU RIOJA CRIANZA 2019 ZZZZ QQQQ');
  assert.ok(asked.every((p) => p === 'meta.json' || p.startsWith('w/') || meta.keyFiles.includes(p.slice(2, -5))), asked.join(','));
  const r = await world.lookup('BODEGAS OSTATU RIOJA CRIANZA 2019 DENOMINACION DE ORIGEN');
  assert.equal(r.is_alcohol, true);
  assert.equal(r.category, 'wine');
  assert.equal(r.name_ko, 'Ostatu Rioja Crianza');
  assert.equal(r.producer, 'Ostatu');
  assert.equal(r.country, '스페인');
  assert.equal(r.region, 'Rioja Alavesa');
  assert.equal(r.abv, '14%');
  assert.equal(r.age_or_vintage, '2019 빈티지');
  assert.match(r.style, /레드 와인 · 템프라니요/);
  assert.match(r.description, /묵직한 바디에 산도가 높은 편/);
  assert.ok(r.food_pairing.includes('소고기') && r.food_pairing.includes('불고기'));
  assert.match(r.how_to_drink.glass, /레드 와인잔/);
  assert.equal(r.confidence, 'medium');
  assert.match(r.confidence_note, /X-Wines/);
  assert.equal(r.similar.length, 2);
  assert.ok(r.price.krw_low > 0);

  // 와인을 못 고르면 생산자 요약 (판단 정도 낮음)
  const r2 = await world.lookup('Ostatu');
  assert.equal(r2.confidence, 'low');
  assert.match(r2.description, /주로 레드·화이트 와인/);

  // 산지 이름만 있는 라벨은 샤토 마고가 아님
  assert.equal(await world.lookup('MARGAUX APPELLATION MARGAUX CONTROLEE'), null);
  assert.match((await world.lookup('Chateau Margaux 2015 Premier Grand Cru Classe')).name_ko, /Château Margaux/);

  // 와인 정보 없는 생산자 (위키데이터 증류소): 종류의 일반 설명
  const r3 = await world.lookup('GLEN TESTA 12 YEAR OLD SINGLE MALT', { category: 'whisky' });
  assert.equal(r3.category, 'whisky');
  assert.equal(r3.confidence, 'low');
  assert.match(r3.summary, /위스키 증류소예요/);
  assert.match(r3.how_to_drink.glass, /잔/);
  // 종류가 다르면 (럼 라벨인데 위스키 증류소) 고르지 않음
  assert.equal(await world.lookup('GLEN TESTA', { category: 'rum' }), null);
  assert.equal(await world.lookup(''), null);
});

test('찾기: pickWine 은 단어를 한 번씩만 셈', () => {
  const wines = [['Malbec-Malbec', 'r', [], [], 14, 4, 2, 0], ['Malbec Argentino', 'r', [], [], 14, 4, 2, 0]];
  assert.equal(pickWine(wines, 'Catena Zapata Malbec Argentino')[0], 'Malbec Argentino');
  assert.equal(pickWine(wines, 'Catena Zapata Cabernet'), null);
  assert.equal(findProducer(new Map(), 'anything'), null);
  // worldResult 은 index 없이 meta·생산자만으로
  const r = worldResult({ meta: { regions: [], grapes: [], harmonize: [] }, p: [0, 'Test Brewery', 'beer', '독일', 'Bavaria', 0] }, ctx);
  assert.match(r.summary, /독일 Bavaria에 있는 맥주 양조장이에요/);
});

test('실제 세계 데이터 (data/world): 파일 형식과 대표 찾기', async () => {
  const dir = new URL('../data/world/', import.meta.url);
  const meta = JSON.parse(await fs.readFile(new URL('meta.json', dir), 'utf8'));
  assert.equal(meta.version, 1);
  assert.ok(meta.counts.wines > 90000 && meta.counts.producers > 30000, JSON.stringify(meta.counts));
  const world = createWorld(async (p) => JSON.parse(await fs.readFile(new URL(p, dir), 'utf8')), ctx);
  assert.match((await world.lookup('Cloudy Bay Te Koko Sauvignon Blanc Marlborough')).name_ko, /Cloudy Bay Te Koko/);
  assert.match((await world.lookup('Penfolds Bin 28 Kalimna Shiraz')).name_ko, /Penfolds Bin 28/);
  assert.equal(await world.lookup('MARGAUX APPELLATION MARGAUX CONTROLEE 2018 MIS EN BOUTEILLE'), null);
  assert.equal(await world.lookup('Gran Reserva Old Vines Red Wine 2017'), null);
  assert.equal(await world.lookup('Captain Morgan Spiced Rum', { category: 'rum' }), null);
  assert.equal(await world.lookup('제품명 위스키 원산지 영국 수입원 주식회사 알코올도수 40% 용량 700ml'), null);
});

test('Worker 사진 경로: 사전에 없으면 세계 데이터로 (AI 는 사진 읽기 한 번만)', async () => {
  const { createWorkersAiIdentifier } = await import('../server/identify/workers-ai.js');
  const { worldFor } = await import('../worker/index.js');
  const { meta, kShards, shards } = smallWorld();
  const world = createWorld(memoryFetch(meta, kShards, shards), ctx);
  const calls = [];
  const ai = {
    async run(model, input) {
      calls.push(input);
      return { response: JSON.stringify({ is_alcohol: true, name: 'Ostatu Rioja Crianza', producer: 'Bodegas Ostatu', category: 'wine', age_or_vintage: '2019', abv: '14.5', label_text: 'OSTATU RIOJA CRIANZA 2019', confidence: 'high' }) };
    },
  };
  const r = (await createWorkersAiIdentifier({ ai, world }).identify({ images: [{ mediaType: 'image/jpeg', data: 'AAAA' }] })).result;
  assert.equal(calls.length, 1);
  assert.equal(r.name_ko, 'Ostatu Rioja Crianza');
  assert.equal(r.abv, '14.5%'); // 라벨에서 읽은 값
  assert.equal(r.age_or_vintage, '2019 빈티지');
  assert.match(r.confidence_note, /X-Wines/);
  assert.equal(r.confidence, 'medium');
  // 세계 데이터에도 없으면 AI 가 한국어 설명 (두 번째 호출)
  const ai2 = {
    n: 0,
    async run() {
      this.n++;
      return this.n === 1 ? { response: JSON.stringify({ is_alcohol: true, name: 'Unknown Garage Wine', category: 'wine', label_text: 'UNKNOWN GARAGE WINE' }) } : { response: { is_alcohol: true, name_ko: '모르는 와인', category: 'wine', price: { krw_low: 10000, krw_high: 20000 } } };
    },
  };
  await createWorkersAiIdentifier({ ai: ai2, world }).identify({ images: [{ mediaType: 'image/jpeg', data: 'AAAA' }] });
  assert.equal(ai2.n, 2);
  // worldFor: 주소별로 하나, 파일 주소 만들기
  const asked = [];
  const w = worldFor('https://example.test/data/world/', async (url) => {
    asked.push(url);
    return { ok: false, status: 404, json: async () => ({}) };
  });
  assert.equal(worldFor('https://example.test/data/world/'), w);
  assert.equal(worldFor(''), null);
  await assert.rejects(w.lookup('Ostatu'));
  assert.equal(asked[0], 'https://example.test/data/world/meta.json');
});
