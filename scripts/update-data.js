// 앱이 읽는 데이터 파일을 새로 받습니다.
//   data/stores.json   술을 살 수 있는 곳 (OpenStreetMap, 전국 + data/shops.json 의 동네 술 가게)
//   data/prices.json   소주·맥주·막걸리 실제 판매 가격 (한국소비자원 참가격, 매주 금요일 조사)
//
// 사용법
//   npm run data:update                 둘 다
//   npm run data:update -- --only=prices
//   npm run data:update -- --only=stores
//
// 받다가 실패하면 기존 파일을 그대로 둡니다 (저장소에 넣어 둔 파일이 있어 앱은 계속 동작).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { distanceKm } from '../public/js/lib/geo.js';
import { fetchJson, fetchWithTimeout, mapLimit } from './lib/http.js';
import { OVERPASS_ENDPOINTS, OVERPASS_QUERY, martBrand, osmToStores } from './lib/osm.js';
import { DEFAULT_KCA_BASE, SNAPSHOT_VERSION, buildPrices } from './lib/kca.js';
import { SEMAS_SOURCE, mergeShops } from './lib/semas.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const USER_AGENT = 'sulsul-data-update/0.1 (+https://github.com/kts4u1/drink)';

const log = (...args) => console.log('[data]', ...args);

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value)}\n`);
  await fs.rename(tmp, file);
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

// ---------- 참가격 ----------

export async function fetchPrices({ base = DEFAULT_KCA_BASE, concurrency = 8 } = {}) {
  const manifest = await fetchJson(`${base}/manifest.json`, { timeoutMs: 30000 });
  if (manifest?.version !== SNAPSHOT_VERSION) throw new Error(`스냅샷 형식이 바뀌었습니다 (version ${manifest?.version})`);
  const v = (file) => (manifest.versions?.[file] ? `?v=${manifest.versions[file]}` : '');
  const [products, brands] = await Promise.all([
    fetchJson(`${base}/products.json${v('products.json')}`, { timeoutMs: 30000 }),
    fetchJson(`${base}/brands.json${v('brands.json')}`, { timeoutMs: 30000 }).catch(() => ({ stores: [] })),
  ]);
  const keys = Object.keys(manifest.tiles || {});
  let failed = 0;
  const tiles = await mapLimit(keys, concurrency, async (key) => {
    const file = `t/${key}.json`;
    try {
      return await fetchJson(`${base}/${file}${v(file)}`, { timeoutMs: 30000 });
    } catch {
      failed++;
      return null;
    }
  });
  if (failed > keys.length * 0.1) throw new Error(`격자 파일 ${keys.length}개 중 ${failed}개를 받지 못했습니다`);
  return buildPrices({ manifest, products, tiles: tiles.filter(Boolean), brands, base });
}

// ---------- OpenStreetMap ----------

export async function fetchStores({ endpoints = OVERPASS_ENDPOINTS, rounds = 2 } = {}) {
  let lastErr;
  for (let round = 0; round < rounds; round++) {
    for (const endpoint of endpoints) {
      try {
        log(`OpenStreetMap 받는 중: ${new URL(endpoint).host}`);
        const res = await fetchWithTimeout(endpoint, {
          method: 'POST',
          timeoutMs: 300000,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
          body: new URLSearchParams({ data: OVERPASS_QUERY }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (body.remark && /error|timed out|runtime/i.test(body.remark)) throw new Error(body.remark);
        const stores = osmToStores(body.elements || []);
        if (stores.length < 300) throw new Error(`매장이 너무 적습니다 (${stores.length}곳)`);
        return { stores, osmBase: body.osm3s?.timestamp_osm_base || null };
      } catch (err) {
        lastErr = err;
        log(`  실패: ${err.message}`);
      }
    }
    if (round < rounds - 1) await new Promise((r) => setTimeout(r, 15000));
  }
  throw lastErr;
}

// 참가격 조사 매장 종류 → 매장 종류
function kindOfKcaStore(store) {
  const mart = martBrand(store.n) || martBrand(store.b || '');
  if (mart) return mart.kind ? { kind: mart.kind, label: mart.label } : null;
  if (/백화점/.test(store.t)) return { kind: 'department', label: /현대/.test(store.n) ? '현대백화점' : /신세계/.test(store.n) ? '신세계백화점' : /롯데/.test(store.n) ? '롯데백화점' : /갤러리아/.test(store.n) ? '갤러리아' : '백화점' };
  if (/대형마트/.test(store.t)) return { kind: 'mart', label: store.b || '대형마트' };
  if (/SSM|슈퍼/.test(store.t)) return { kind: 'super', label: store.b || '슈퍼마켓' };
  return null; // 전통시장·편의점은 내 주변 매장 목록에는 넣지 않음 (최저가 화면에서는 보임)
}

/** OSM 매장과 참가격 조사 매장을 잇고, OSM 에 없는 조사 매장은 목록에 더함 */
export function linkKcaStores(stores, prices) {
  if (!prices?.stores?.length) return stores;
  const out = stores.map((s) => ({ ...s }));
  for (const ks of prices.stores) {
    const cls = kindOfKcaStore(ks);
    if (!cls) continue;
    let best = null;
    for (const s of out) {
      if (s.k !== cls.kind) continue;
      if (Math.abs(s.la - ks.la) > 0.004 || Math.abs(s.lo - ks.lo) > 0.005) continue;
      const d = distanceKm(s.la, s.lo, ks.la, ks.lo);
      if (d < 0.25 && (!best || d < best.d)) best = { s, d };
    }
    if (best) {
      best.s.c = ks.id;
      if (!best.s.a && ks.a) best.s.a = ks.a;
      if (!best.s.p && ks.p) best.s.p = ks.p;
    } else {
      const added = { id: `kca${ks.id}`, k: cls.kind, b: cls.label, n: ks.n, la: ks.la, lo: ks.lo, c: ks.id };
      if (ks.a) added.a = ks.a;
      if (ks.p) added.p = ks.p;
      out.push(added);
    }
  }
  return out;
}

async function main() {
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
  const pricesFile = path.join(DATA_DIR, 'prices.json');
  const storesFile = path.join(DATA_DIR, 'stores.json');
  let ok = true;

  let prices = await readJson(pricesFile);
  if (only !== 'stores') {
    try {
      log('참가격 술 가격 받는 중…');
      const fresh = await fetchPrices({ base: process.env.KCA_SNAPSHOT_BASE || DEFAULT_KCA_BASE });
      if (!fresh.products.length || !fresh.stores.length) throw new Error('술 가격이 하나도 없습니다');
      prices = fresh;
      await writeJsonAtomic(pricesFile, prices);
      const count = Object.values(prices.prices).reduce((a, l) => a + l.length, 0);
      log(`  완료: 조사일 ${prices.inspectDay}, 상품 ${prices.products.length}개, 판매점 ${prices.stores.length}곳, 가격 ${count}건`);
    } catch (err) {
      ok = false;
      log(`  참가격을 받지 못해 기존 파일을 씁니다: ${err.message}`);
    }
  }

  if (only !== 'prices') {
    const old = await readJson(storesFile);
    // 동네 술 가게 (소상공인 상가정보, npm run data:shops 로 분기마다 받음)
    const shops = await readJson(path.join(DATA_DIR, 'shops.json'));
    const withShops = (list) => (shops?.shops ? mergeShops(list, shops.shops).stores : list);
    try {
      const { stores, osmBase } = await fetchStores();
      const linked = withShops(linkKcaStores(stores, prices));
      await writeJsonAtomic(storesFile, {
        version: 1,
        source: shops?.shops ? `OpenStreetMap + ${SEMAS_SOURCE}` : 'OpenStreetMap',
        osmBase,
        updatedAt: new Date().toISOString(),
        pricesInspectDay: prices?.inspectDay || null,
        shopsBaseDate: shops?.baseDate || null,
        count: linked.length,
        stores: linked,
      });
      const by = {};
      for (const s of linked) by[s.k] = (by[s.k] || 0) + 1;
      log(`  완료: ${linked.length}곳`, by);
    } catch (err) {
      ok = false;
      log(`  OpenStreetMap 을 받지 못해 기존 파일을 씁니다: ${err.message}`);
      // 참가격만 새로 받았으면 연결만 다시
      if (old?.stores && prices && old.pricesInspectDay !== prices.inspectDay) {
        const base = old.stores.filter((s) => !s.id.startsWith('kca')).map(({ c, ...rest }) => rest);
        const linked = withShops(linkKcaStores(base, prices));
        await writeJsonAtomic(storesFile, { ...old, pricesInspectDay: prices.inspectDay, count: linked.length, stores: linked });
      }
    }
  }

  if (!ok && process.argv.includes('--strict')) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
