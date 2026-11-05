// 내 주변 매장·가격 계산 (브라우저에서 data/*.json 으로 계산, 테스트도 이 파일로)
import { distanceKm } from './geo.js';

/** 반경 안의 매장 (가까운 순). kinds 가 비어 있으면 전부 */
export function storesWithin(stores, center, radiusKm, kinds = null) {
  const allow = kinds && kinds.length ? new Set(kinds) : null;
  // 위도 1도 ≈ 111km. 먼저 사각형으로 거른 다음 정확한 거리 계산
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((center.lat * Math.PI) / 180));
  const out = [];
  for (const s of stores) {
    if (allow && !allow.has(s.k)) continue;
    if (Math.abs(s.la - center.lat) > dLat || Math.abs(s.lo - center.lng) > dLng) continue;
    const d = distanceKm(center.lat, center.lng, s.la, s.lo);
    if (d <= radiusKm) out.push({ ...s, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

/** 가장 가까운 n 곳 (반경 제한 없이, 너무 멀면 maxKm 에서 끊음) */
export function nearestStores(stores, center, { kinds = null, limit = 5, maxKm = 60 } = {}) {
  return storesWithin(stores, center, maxKm, kinds).slice(0, limit);
}

/** 반경별 개수 */
export function countByRadius(stores, center, radii, kinds = null) {
  const max = Math.max(...radii);
  const within = storesWithin(stores, center, max, kinds);
  return Object.fromEntries(radii.map((r) => [r, within.filter((s) => s.d <= r).length]));
}

/** 종류별 개수 */
export function countByKind(list) {
  const counts = {};
  for (const s of list) counts[s.k] = (counts[s.k] || 0) + 1;
  return counts;
}

/** 주류 전문점의 가게 종류 (SHOP_TYPES 의 id). 전문점이 아니면 null */
export function shopTypeOf(store, types) {
  if (store.k !== 'shop') return null;
  return (types.find((t) => t.labels.includes(store.b)) || types.find((t) => !t.labels.length))?.id || null;
}

/**
 * 고르기 열쇠 → 매장 거르기 함수
 * 'all' | 매장 종류(shop, mart …) | 'shop:<가게 종류>' (shop:wine, shop:bottle …)
 */
export function storeFilter(key, types = []) {
  if (!key || key === 'all') return () => true;
  if (key.startsWith('shop:')) {
    const id = key.slice(5);
    return (s) => s.k === 'shop' && shopTypeOf(s, types) === id;
  }
  return (s) => s.k === key;
}

/** 정렬: distance(가까운 순) | cheap(싸게 사기 좋은 곳 먼저) | variety(종류 많은 곳 먼저). types 를 주면 가게 종류별 점수 */
export function sortStores(list, sort, kindInfo, types = null) {
  const arr = [...list];
  if (sort === 'cheap' || sort === 'variety') {
    const key = sort === 'cheap' ? 'cheap' : 'variety';
    const score = (s) => {
      const t = types && s.k === 'shop' ? types.find((x) => x.id === shopTypeOf(s, types)) : null;
      return t?.[key] ?? kindInfo[s.k]?.[key] ?? 0;
    };
    // 점수가 같으면 가까운 곳, 점수 1 차이는 3km 정도의 거리와 맞바꿈
    arr.sort((a, b) => score(b) * 3 - b.d - (score(a) * 3 - a.d));
  } else {
    arr.sort((a, b) => a.d - b.d);
  }
  return arr;
}

// ---------- 참가격 가격 비교 ----------

/** prices.json 안에서 이름이 맞는 상품들 (제품 카탈로그의 kca 정규식) */
export function matchKcaProducts(prices, pattern) {
  if (!prices?.products || !pattern) return [];
  const re = new RegExp(pattern);
  return prices.products.filter((p) => re.test(p.name));
}

function median(sorted) {
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * 상품 하나의 내 주변 판매 가격
 * 반환: { rows: [{ store, price, discount, onePlusOne, dcEnd, prev, d }], stats, brands, expanded }
 * 반경 안에 조사 매장이 하나도 없으면 가장 가까운 곳 minRows 곳을 보여 주고 expanded 에 그 거리를 넣음
 */
export function comparePrices(prices, productId, center, radiusKm, { minRows = 5 } = {}) {
  const list = prices?.prices?.[productId] || [];
  const all = [];
  for (const [index, price, flags, dcStart, dcEnd, prev] of list) {
    const store = prices.stores[index];
    if (!store) continue;
    all.push({
      store,
      price,
      discount: (flags & 1) !== 0,
      onePlusOne: (flags & 2) !== 0,
      dcStart: dcStart || null,
      dcEnd: dcEnd || null,
      prev: prev || null,
      d: distanceKm(center.lat, center.lng, store.la, store.lo),
    });
  }
  let rows = all.filter((r) => r.d <= radiusKm);
  let expanded = null;
  if (rows.length < Math.min(minRows, all.length) && all.length) {
    const nearest = [...all].sort((a, b) => a.d - b.d).slice(0, minRows);
    expanded = Math.ceil(nearest.at(-1).d);
    rows = nearest;
  }
  rows.sort((a, b) => a.price - b.price || a.d - b.d);

  const values = rows.map((r) => r.price).sort((a, b) => a - b);
  const nationwide = all.map((r) => r.price).sort((a, b) => a - b);
  const brands = (prices?.brands || [])
    .filter((b) => b.prices[productId])
    .map((b) => {
      const [price, flags] = b.prices[productId];
      return { brand: b.brand, price, discount: (flags & 1) !== 0, onePlusOne: (flags & 2) !== 0 };
    })
    .sort((a, b) => a.price - b.price || a.brand.localeCompare(b.brand, 'ko'));

  return {
    rows,
    expanded,
    stats: {
      count: rows.length,
      min: values[0] ?? null,
      max: values.at(-1) ?? null,
      median: median(values),
      avg: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null,
      nationMin: nationwide[0] ?? null,
      nationMedian: median(nationwide),
      nationCount: nationwide.length,
    },
    brands,
  };
}

/** 매장 하나에서 파는 참가격 상품 가격 */
export function pricesAtStore(prices, kcaStoreId) {
  if (!prices || !kcaStoreId) return [];
  const index = prices.stores.findIndex((s) => s.id === String(kcaStoreId));
  if (index < 0) return [];
  const out = [];
  for (const product of prices.products) {
    const row = (prices.prices[product.id] || []).find((r) => r[0] === index);
    if (row) out.push({ product, price: row[1], discount: (row[2] & 1) !== 0, onePlusOne: (row[2] & 2) !== 0 });
  }
  return out;
}
