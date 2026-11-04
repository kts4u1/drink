// 세계 술 데이터 받기: 브랜드 사전에 없는 술을 찾을 때 쓰는 큰 목록
//   data/world/meta.json        산지·품종·음식 목록, 출처, 개수
//   data/world/k/<앞 세 글자>.json  이름 열쇠 → 생산자 [번호, 이름, 종류, 나라, 산지, 와인 수]
//   data/world/w/<n>.json       와인 조각 (생산자 150곳씩): 와인 이름·종류·품종·음식·도수·바디·산도·산지
// 작은 조각으로 나눈 까닭: 화면과 Worker 가 라벨 글자에 나온 단어의 조각만 받게 (Worker 무료 플랜은 계산 시간이 아주 짧음)
//
// 출처 (둘 다 CC0 — 누구나 자유롭게 사용)
//   X-Wines: 와인 10만 개 · 와이너리 3만 곳 (2023, 구글 드라이브의 공식 배포 파일)
//     de Azambuja, R.X.; Morais, A.J.; Filipe, V. X-Wines: A Wine Dataset for Recommender Systems and Machine Learning.
//     Big Data Cogn. Comput. 2023, 7, 20. https://doi.org/10.3390/bdcc7010020
//   위키데이터: 와이너리·맥주 양조장·사케 양조장·위스키 증류소·(생산품이 확인된) 증류소
//
// 사용법: npm run data:world          (2~3분, 인터넷 필요. 실패하면 기존 파일을 그대로 둠)
//         npm run data:world -- --xwines=./XWines_Full_100K_wines.csv   (내려받은 파일 쓰기)
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { COUNTRY_KO, SHARD_SIZE, WORLD_VERSION, blockedKeys, coreKey, keyShard, keysFor, nameKey } from '../public/js/lib/world.js';
import { fetchWithTimeout } from './lib/http.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = process.env.WORLD_DIR ? path.resolve(process.env.WORLD_DIR) : path.join(ROOT, 'data', 'world');
const USER_AGENT = 'sulsul-data-update/0.1 (+https://github.com/kts4u1/drink)';
const XWINES_ZIP = 'https://drive.usercontent.google.com/download?id=1my7LdDN2eNT7l7hJERH42EQ_TZikfrWu&export=download&confirm=t';
const WIKIDATA = 'https://query.wikidata.org/sparql';

const log = (...a) => console.log('[world]', ...a);

// ---------- zip·csv (외부 패키지 없이) ----------

/** zip 파일에서 이름이 맞는 첫 파일 꺼내기 (중앙 디렉터리 기준) */
export function unzipFirst(buf, test = () => true) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip 형식이 아니에요');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 목록이 깨졌어요');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!test(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method === 0) return data;
    if (method === 8) return zlib.inflateRawSync(data);
    throw new Error(`지원하지 않는 압축 방식 ${method}`);
  }
  throw new Error('zip 안에 원하는 파일이 없어요');
}

/** CSV → 행 배열 (따옴표·줄바꿈 처리) */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0]);
}

/** 파이썬 목록 글자 "['Merlot', \"Nero d'Avola\"]" → 배열 */
export function pyList(s) {
  return [...String(s || '').matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => (m[1] ?? m[2]).trim()).filter(Boolean);
}

// ---------- X-Wines ----------

const TYPE_CODE = { red: 'r', white: 'w', sparkling: 's', 'rosé': 'o', rose: 'o', dessert: 'd', 'dessert/port': 'p' };
const BODY_CODE = { 'very light-bodied': 1, 'light-bodied': 2, 'medium-bodied': 3, 'full-bodied': 4, 'very full-bodied': 5 };
const ACID_CODE = { low: 1, medium: 2, high: 3 };

/** X-Wines CSV 글자 → 와이너리별 와인 */
export function readXWines(csvText) {
  const rows = parseCsv(csvText);
  const head = rows.shift();
  const col = (name) => head.indexOf(name);
  const c = {
    name: col('WineName'),
    type: col('Type'),
    grapes: col('Grapes'),
    harm: col('Harmonize'),
    abv: col('ABV'),
    body: col('Body'),
    acid: col('Acidity'),
    country: col('Country'),
    region: col('RegionName'),
    winery: col('WineryName'),
  };
  if (Object.values(c).some((i) => i < 0)) throw new Error('X-Wines 파일의 열 이름이 바뀌었어요');
  const wineries = new Map();
  for (const r of rows) {
    const winery = r[c.winery]?.trim();
    const name = r[c.name]?.trim();
    if (!winery || !name) continue;
    let w = wineries.get(winery);
    if (!w) wineries.set(winery, (w = { name: winery, country: r[c.country], regions: new Map(), wines: [] }));
    const region = r[c.region]?.trim() || '';
    w.regions.set(region, (w.regions.get(region) || 0) + 1);
    const abv = Number(r[c.abv]);
    w.wines.push({
      name,
      type: TYPE_CODE[String(r[c.type]).toLowerCase()] || 'r',
      grapes: pyList(r[c.grapes]),
      harm: pyList(r[c.harm]),
      abv: abv > 0 && abv < 30 ? Math.round(abv * 10) / 10 : 0,
      body: BODY_CODE[String(r[c.body]).toLowerCase()] || 0,
      acid: ACID_CODE[String(r[c.acid]).toLowerCase()] || 0,
      region,
    });
  }
  return [...wineries.values()];
}

async function loadXWines(file) {
  if (file) {
    log(`X-Wines 파일 읽는 중: ${file}`);
    const buf = await fs.readFile(file);
    return file.endsWith('.zip') ? unzipFirst(buf, (n) => n.endsWith('.csv')).toString('utf8') : buf.toString('utf8');
  }
  log('X-Wines 받는 중 (구글 드라이브, 약 5MB)');
  const res = await fetchWithTimeout(XWINES_ZIP, { timeoutMs: 120000, headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`X-Wines HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return unzipFirst(buf, (n) => /wines\.csv$/i.test(n)).toString('utf8');
}

// ---------- 위키데이터 ----------

const PRODUCER_QUERY = `SELECT ?i ?type ?en ?ja ?mul ?countryKo ?countryEn ?adminEn WHERE {
  VALUES (?cls ?type) { (wd:Q156362 "wine") (wd:Q131734 "beer") (wd:Q5487333 "beer") (wd:Q29850536 "sake") (wd:Q10373548 "whisky") }
  ?i wdt:P31 ?cls .
  OPTIONAL { ?i rdfs:label ?en FILTER(LANG(?en)="en") }
  OPTIONAL { ?i rdfs:label ?ja FILTER(LANG(?ja)="ja") }
  OPTIONAL { ?i rdfs:label ?mul FILTER(LANG(?mul)="mul") }
  OPTIONAL { ?i wdt:P17 ?c . OPTIONAL { ?c rdfs:label ?countryKo FILTER(LANG(?countryKo)="ko") } OPTIONAL { ?c rdfs:label ?countryEn FILTER(LANG(?countryEn)="en") } }
  OPTIONAL { ?i wdt:P131 ?a . ?a rdfs:label ?adminEn FILTER(LANG(?adminEn)="en") }
}`;

// 무엇을 만드는지 확인된 증류소만 (모르는 곳은 엉뚱한 설명을 막으려고 뺌)
const DISTILLERY_QUERY = `SELECT ?i ?prodEn ?en ?mul ?countryKo ?countryEn ?adminEn WHERE {
  ?i wdt:P31 wd:Q1251750 ; wdt:P1056 ?p .
  ?p rdfs:label ?prodEn FILTER(LANG(?prodEn)="en")
  OPTIONAL { ?i rdfs:label ?en FILTER(LANG(?en)="en") }
  OPTIONAL { ?i rdfs:label ?mul FILTER(LANG(?mul)="mul") }
  OPTIONAL { ?i wdt:P17 ?c . OPTIONAL { ?c rdfs:label ?countryKo FILTER(LANG(?countryKo)="ko") } OPTIONAL { ?c rdfs:label ?countryEn FILTER(LANG(?countryEn)="en") } }
  OPTIONAL { ?i wdt:P131 ?a . ?a rdfs:label ?adminEn FILTER(LANG(?adminEn)="en") }
}`;

export function productCategory(prodEn) {
  const p = String(prodEn || '').toLowerCase();
  if (/whisk/.test(p)) return 'whisky';
  if (/gin|jenever|genever/.test(p)) return 'gin';
  if (/\brum\b|cacha/.test(p)) return 'rum';
  if (/vodka/.test(p)) return 'vodka';
  if (/cognac|brandy|armagnac|calvados|grappa|pisco|eau.de.vie/.test(p)) return 'brandy';
  if (/tequila|mezcal/.test(p)) return 'tequila';
  if (/liqueur|absinth|bitter|amaro|schnapps/.test(p)) return 'liqueur';
  if (/baijiu/.test(p)) return 'baijiu';
  if (/shochu|sake/.test(p)) return 'sake';
  if (/soju/.test(p)) return 'soju';
  if (/beer|ale\b|lager/.test(p)) return 'beer';
  if (/wine/.test(p)) return 'wine';
  return null;
}

async function sparql(query) {
  const url = `${WIKIDATA}?query=${encodeURIComponent(query)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { timeoutMs: 180000, headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`위키데이터 HTTP ${res.status}`);
      // 위키데이터 이름에 가끔 제어 문자가 섞여 JSON 이 깨짐 → 공백으로 바꾸고 읽기
      const body = JSON.parse((await res.text()).replace(/[\u0000-\u001f]/g, ' '));
      return body.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
    } catch (err) {
      if (attempt === 2) throw err;
      log(`  다시 시도: ${err.message}`);
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
    }
  }
  return [];
}

/** 위키데이터 결과 → 생산자 (같은 항목이 여러 줄이면 하나로) */
export function readWikidata(rows, catOf) {
  const byId = new Map();
  for (const r of rows) {
    const name = r.en || r.mul || r.ja;
    const cat = catOf(r);
    if (!name || !cat || /^Q\d+$/.test(name)) continue;
    const key = `${r.i}|${cat}`;
    if (byId.has(key)) continue;
    byId.set(key, { name, cat, country: r.countryKo || COUNTRY_KO[String(r.countryEn || '').toLowerCase()] || r.countryEn || '', region: r.adminEn || '' });
  }
  return [...byId.values()];
}

// ---------- 합치기 ----------

/** X-Wines 와이너리 + 위키데이터 생산자 → meta·이름 조각·와인 조각 */
export function buildWorld(xwineries, wdProducers, extraCounts = {}) {
  const regions = [];
  const grapes = [];
  const harmonize = [];
  const ids = (list) => {
    const map = new Map();
    return (v) => {
      const s = String(v ?? '').trim();
      if (!s) return -1;
      if (!map.has(s)) {
        map.set(s, list.length);
        list.push(s);
      }
      return map.get(s);
    };
  };
  const regionId = ids(regions);
  const grapeId = ids(grapes);
  const harmId = ids(harmonize);

  const p = [];
  const shards = [];
  const seen = new Set();
  // 와인이 있는 생산자를 앞에 (조각 번호 = 순서 / SHARD_SIZE). 이름순이라 와인 많은 곳이 한 조각에 몰리지 않음
  const sorted = [...xwineries].sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const w of sorted) {
    const mainRegion = [...w.regions.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const idx = p.length;
    p.push([w.name, 'wine', COUNTRY_KO[String(w.country).toLowerCase()] || w.country, mainRegion, w.wines.length]);
    regionId(mainRegion);
    seen.add(`${coreKey(w.name)}|wine`);
    const shard = Math.floor(idx / SHARD_SIZE);
    (shards[shard] ||= {})[idx] = w.wines.map((x) => [x.name, x.type, x.grapes.map(grapeId), x.harm.map(harmId), x.abv, x.body, x.acid, regionId(x.region)]);
  }
  let wdAdded = 0;
  for (const x of wdProducers) {
    // 같은 생산자가 X-Wines 에 있으면 (흔한 말을 뺀 이름이 같으면) 와인 정보가 있는 쪽만
    const key = `${coreKey(x.name)}|${x.cat}`;
    if (!nameKey(x.name) || seen.has(key)) continue;
    seen.add(key);
    p.push([x.name, x.cat, x.country, x.region, 0]);
    wdAdded++;
  }
  // 여러 생산자의 와인 이름에 두루 나오는 말 ("reserve", "bouteille", 품종 이름 등): 혼자서는 생산자 이름으로 보지 않음
  const df = new Map();
  for (const w of sorted) {
    const seenTok = new Set();
    for (const x of w.wines) for (const t of nameKey(x.name).split(' ')) if (t.length >= 4 && !seenTok.has(t)) seenTok.add(t);
    for (const t of seenTok) df.set(t, (df.get(t) || 0) + 1);
  }
  const common = new Set([...df.entries()].filter(([, n]) => n >= 8).map(([t]) => t));

  // 이름 열쇠 → 조각 (앞 두 글자)
  const blocked = blockedKeys({ regions, grapes });
  const kShards = {};
  let keyCount = 0;
  p.forEach(([name, cat, country, region, wines], i) => {
    for (const key of keysFor(name, blocked, common)) {
      const shard = (kShards[keyShard(key)] ||= {});
      (shard[key] ||= []).push([i, name, cat, country, region, wines]);
      keyCount++;
    }
  });
  const meta = {
    version: WORLD_VERSION,
    updatedAt: new Date().toISOString(),
    sources: [
      { name: 'X-Wines', license: 'CC0-1.0', url: 'https://github.com/rogerioxavier/X-Wines', cite: 'de Azambuja, R.X.; Morais, A.J.; Filipe, V. X-Wines. Big Data Cogn. Comput. 2023, 7, 20. https://doi.org/10.3390/bdcc7010020' },
      { name: 'Wikidata', license: 'CC0-1.0', url: 'https://www.wikidata.org' },
    ],
    shardSize: SHARD_SIZE,
    shards: shards.length,
    counts: { producers: p.length, wineries: sorted.length, wines: sorted.reduce((n, w) => n + w.wines.length, 0), wikidata: wdAdded, keys: keyCount, keyFiles: Object.keys(kShards).length, ...extraCounts },
    regions,
    grapes,
    harmonize,
    // 있는 이름 조각 목록 (없는 파일을 받으러 가지 않게)
    keyFiles: Object.keys(kShards).sort(),
  };
  return { meta, kShards, shards };
}

async function writeAtomic(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, text);
  await fs.rename(tmp, file);
}

async function main() {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const csv = await loadXWines(arg('xwines'));
  const xwineries = readXWines(csv);
  log(`X-Wines: 와이너리 ${xwineries.length}곳, 와인 ${xwineries.reduce((n, w) => n + w.wines.length, 0)}개`);

  let wd = [];
  try {
    log('위키데이터 받는 중 (생산자)');
    const producers = readWikidata(await sparql(PRODUCER_QUERY), (r) => r.type);
    log(`  와이너리·양조장·위스키 증류소 ${producers.length}곳`);
    const distilleries = readWikidata(await sparql(DISTILLERY_QUERY), (r) => productCategory(r.prodEn));
    log(`  생산품이 확인된 증류소 ${distilleries.length}곳`);
    wd = [...producers, ...distilleries];
  } catch (err) {
    // 위키데이터를 못 받으면 기존 파일의 위키데이터 생산자를 그대로 씀
    log(`위키데이터 실패(${err.message}) — 기존 파일의 생산자를 다시 씀`);
    try {
      const seenOld = new Set();
      for (const f of await fs.readdir(path.join(OUT_DIR, 'k'))) {
        for (const list of Object.values(JSON.parse(await fs.readFile(path.join(OUT_DIR, 'k', f), 'utf8')))) {
          for (const [i, name, cat, country, region, wines] of list) {
            if (wines || seenOld.has(i)) continue;
            seenOld.add(i);
            wd.push({ name, cat, country, region });
          }
        }
      }
    } catch {
      wd = [];
    }
  }

  const { meta, kShards, shards } = buildWorld(xwineries, wd);
  if (meta.counts.wines < 50000) throw new Error(`와인이 너무 적어요 (${meta.counts.wines}개) — 파일을 바꾸지 않아요`);
  // 새 파일을 옆 폴더에 다 쓴 뒤 바꿔치기 (중간에 실패해도 기존 데이터가 남게)
  const tmpDir = `${OUT_DIR}.tmp`;
  await fs.rm(tmpDir, { recursive: true, force: true });
  for (let i = 0; i < shards.length; i++) await writeAtomic(path.join(tmpDir, 'w', `${i}.json`), `${JSON.stringify(shards[i] || {})}\n`);
  for (const [prefix, shard] of Object.entries(kShards)) await writeAtomic(path.join(tmpDir, 'k', `${prefix}.json`), `${JSON.stringify(shard)}\n`);
  await writeAtomic(path.join(tmpDir, 'meta.json'), `${JSON.stringify(meta)}\n`);
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.rename(tmpDir, OUT_DIR);
  log(`완료: 생산자 ${meta.counts.producers}곳 (와인 ${meta.counts.wines}개, 위키데이터 ${meta.counts.wikidata}곳), 이름 열쇠 ${meta.counts.keys}개 → 조각 ${meta.counts.keyFiles}개, 와인 조각 ${shards.length}개`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[world] 실패:', err.message);
    process.exit(1);
  });
}
