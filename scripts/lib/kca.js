// 한국소비자원 참가격(생필품 가격 정보)에서 술 가격만 골라냅니다.
//
// 참가격 API 를 직접 부르지 않고, 같은 사람이 만든 세일레이더 앱(kts4u1/Sale-and-Discount)이
// 매일 받아서 GitHub Pages 에 올려 두는 스냅샷 파일을 읽습니다 (판매점 좌표까지 찾아 둔 자료).
//   {base}/manifest.json     조사일, 격자 목록
//   {base}/products.json     상품 id → [상품명, 용량]
//   {base}/brands.json       편의점 본사(전국 공통) 가격
//   {base}/t/{격자}.json      판매점과 그 매장의 가격 [상품id, 가격, 표시(1=할인,2=1+1), 할인시작, 할인끝, 지난주 정상가]
import { isKoreanCoord } from '../../public/js/lib/geo.js';

export const DEFAULT_KCA_BASE = 'https://kts4u1.github.io/Sale-and-Discount/data/kca';
export const SNAPSHOT_VERSION = 1;

// 이름 앞부분으로 술 종류 판단 (박카스맛 젤리, 폰테라 버터처럼 중간에 들어간 글자에 속지 않게 앞에서부터)
const RULES = [
  { kind: 'soju', label: '소주', re: /^(참이슬|처음처럼|진로|새로|좋은데이|대선|한라산|잎새주|C1|시원|맛있는\s*참|이제우린|일품진로|화요)|소주/ },
  {
    kind: 'beer',
    label: '맥주',
    re: /^(카스|테라|하이트|켈리|클라우드|필굿|필라이트|오비|버드와이저|하이네켄|칭따오|아사히|기네스|스텔라|호가든|크러시|한맥|칼스버그|산미구엘|코로나|블랑|크로넨버그)|맥주/,
  },
  { kind: 'makgeolli', label: '막걸리', re: /막걸리|탁주|우국생|^(장수|지평|느린마을|국순당\s*생)/ },
  { kind: 'wine', label: '와인', re: /와인/ },
  { kind: 'whisky', label: '위스키', re: /위스키/ },
];

/** 용량 문자열이 액체(ml, L)인지 */
function isLiquid(size) {
  return /\d\s*(ml|l)$/i.test(String(size || '').trim());
}

/** "참이슬 후레쉬(360ml)" → { name: '참이슬 후레쉬', pack: '' } , "카스 프레쉬(6캔)" → { name: '카스 프레쉬', pack: '6캔' } */
export function splitName(raw) {
  const m = String(raw).trim().match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (!m) return { name: String(raw).trim(), pack: '' };
  const inside = m[2].trim();
  const pack = /캔|병|입|개|팩|묶음|\d+\s*x/i.test(inside) && !/^\d+(\.\d+)?\s*(ml|l)$/i.test(inside) ? inside : '';
  return { name: m[1].trim(), pack };
}

/** 상품 하나가 술이면 { kind, label } */
export function liquorKind(name, size) {
  if (!isLiquid(size)) return null;
  const clean = String(name).trim();
  const rule = RULES.find((r) => r.re.test(clean));
  return rule ? { kind: rule.kind, label: rule.label } : null;
}

/** products.json → 술 상품 목록 */
export function pickLiquorProducts(products) {
  const out = [];
  for (const [id, [rawName, size]] of Object.entries(products || {})) {
    const kind = liquorKind(rawName, size);
    if (!kind) continue;
    const { name, pack } = splitName(rawName);
    out.push({ id: String(id), name, pack, size: String(size || ''), kind: kind.kind, label: kind.label });
  }
  const order = ['soju', 'beer', 'makgeolli', 'wine', 'whisky'];
  out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.name.localeCompare(b.name, 'ko') || a.size.localeCompare(b.size));
  return out;
}

const n = (v) => (v == null || v === '' ? null : v);

/**
 * 스냅샷 파일들 → 앱에서 쓰는 prices.json
 * tiles: 격자 파일 배열, brands: brands.json
 */
export function buildPrices({ manifest, products, tiles, brands, fetchedAt = new Date().toISOString(), base = DEFAULT_KCA_BASE }) {
  const liquor = pickLiquorProducts(products);
  const ids = new Set(liquor.map((p) => p.id));
  const stores = [];
  const prices = Object.fromEntries(liquor.map((p) => [p.id, []]));
  const seen = new Set();

  for (const tile of tiles) {
    for (const s of tile?.stores || []) {
      if (seen.has(s.id) || !isKoreanCoord(s.lat, s.lng)) continue;
      const mine = (s.prices || []).filter((t) => ids.has(String(t[0])) && Number(t[1]) > 0);
      if (!mine.length) continue;
      seen.add(s.id);
      const index = stores.length;
      const store = { id: String(s.id), n: s.name, t: s.typeLabel || '', la: s.lat, lo: s.lng };
      if (s.brand) store.b = s.brand;
      const addr = s.roadAddress || s.address;
      if (addr) store.a = addr.replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (s.phone) store.p = s.phone;
      stores.push(store);
      for (const [goodId, price, flags = 0, dcStart, dcEnd, prev] of mine) {
        prices[String(goodId)].push([index, Number(price), Number(flags) || 0, n(dcStart), n(dcEnd), n(prev)]);
      }
    }
  }

  // 편의점 본사 가격 (GS25·CU·세븐일레븐·이마트24 전국 공통)
  const brandPrices = [];
  for (const s of brands?.stores || []) {
    const mine = (s.prices || []).filter((t) => ids.has(String(t[0])) && Number(t[1]) > 0);
    if (!mine.length) continue;
    brandPrices.push({
      brand: s.brand,
      type: s.typeLabel || '편의점',
      prices: Object.fromEntries(mine.map(([goodId, price, flags = 0, dcStart, dcEnd, prev]) => [String(goodId), [Number(price), Number(flags) || 0, n(dcStart), n(dcEnd), n(prev)]])),
    });
  }
  brandPrices.sort((a, b) => a.brand.localeCompare(b.brand, 'ko'));

  // 가격이 하나도 없는 상품은 뺌
  const usable = liquor.filter((p) => prices[p.id].length || brandPrices.some((b) => b.prices[p.id]));
  for (const p of liquor) if (!usable.includes(p)) delete prices[p.id];

  return {
    version: 1,
    source: '한국소비자원 참가격',
    via: base,
    inspectDay: manifest.inspectDay,
    prevInspectDay: manifest.prevInspectDay || null,
    snapshotUpdatedAt: manifest.updatedAt || null,
    fetchedAt,
    demo: false,
    products: usable,
    stores,
    prices,
    brands: brandPrices,
  };
}
