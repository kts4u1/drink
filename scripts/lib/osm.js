// OpenStreetMap 에서 술을 살 수 있는 곳을 받아 분류합니다.
//
// 카카오 로컬 API 는 쓰지 않습니다. 카카오 디벨로퍼스 운영정책(제4조)이 "주류 관련 서비스"를
// 본인확인 성인인증 + 카카오 심사 없이는 금지하고 있고, 위반하면 같은 계정의 다른 앱까지 막힐 수 있어서입니다.
// OpenStreetMap 은 누구나 쓸 수 있는 공개 지도 데이터(ODbL)입니다.
import { isKoreanCoord } from '../../public/js/lib/geo.js';

// 전국 한 번에 받는 질의. 편의점은 너무 많고 어디에나 있어서 뺍니다.
export const OVERPASS_QUERY = `[out:json][timeout:240];
area["ISO3166-1"="KR"][admin_level=2]->.kr;
(
  nwr["shop"~"^(alcohol|wine|beverages)$"](area.kr);
  nwr["craft"~"^(brewery|winery|distillery)$"](area.kr);
  nwr["industrial"~"^(brewery|distillery)$"](area.kr);
  nwr["shop"="department_store"](area.kr);
  nwr["shop"~"^(supermarket|wholesale|hypermarket)$"]["name"~"이마트|롯데마트|롯데슈퍼|홈플러스|코스트코|트레이더스|하나로|맥스|메가마트|더프레시|Costco|E-?mart|Homeplus|Lotte",i](area.kr);
  nwr["shop"~"^(supermarket|wholesale|hypermarket)$"]["brand"~"이마트|롯데마트|롯데슈퍼|홈플러스|코스트코|트레이더스|하나로|더프레시|Costco|E-?mart|Homeplus|Lotte",i](area.kr);
);
out center tags;`;

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// 마트 브랜드 (순서 중요: 더 구체적인 이름을 먼저). kind: null 이면 버림 (편의점 등)
const MART_BRANDS = [
  { re: /이마트\s*24|e-?mart\s*24/i, kind: null },
  { re: /트레이더스|traders/i, kind: 'warehouse', label: '트레이더스' },
  { re: /코스트코|costco/i, kind: 'warehouse', label: '코스트코' },
  { re: /롯데\s*마트\s*(맥스|maxx)|^맥스(\s|$)|lotte\s*mart\s*maxx|빅\s*마켓/i, kind: 'warehouse', label: '롯데마트 맥스' },
  { re: /이마트\s*에브리\s*데이|e-?mart\s*every\s*day/i, kind: 'super', label: '이마트에브리데이' },
  { re: /홈플러스\s*익스프레스|homeplus\s*express/i, kind: 'super', label: '홈플러스 익스프레스' },
  { re: /롯데\s*슈퍼|lotte\s*super/i, kind: 'super', label: '롯데슈퍼' },
  { re: /gs\s*(더)?\s*프레시|gs\s*the\s*fresh|gs\s*수퍼/i, kind: 'super', label: 'GS더프레시' },
  { re: /노브랜드|no\s*brand/i, kind: null },
  { re: /^(신세계\s*)?이마트|^e-?mart/i, kind: 'mart', label: '이마트' },
  { re: /^롯데\s*마트|^lotte\s*mart/i, kind: 'mart', label: '롯데마트' },
  { re: /^홈플러스|^homeplus/i, kind: 'mart', label: '홈플러스' },
  { re: /하나로\s*클럽/, kind: 'mart', label: '하나로마트' },
  { re: /^(농협\s*)?하나로|농협\s*하나로|하나로\s*마트/, kind: 'mart', label: '하나로마트' },
  { re: /^메가\s*마트/, kind: 'mart', label: '메가마트' },
  { re: /킴스\s*클럽|kim'?s\s*club/i, kind: 'mart', label: '킴스클럽' },
];

const DEPARTMENT_BRANDS = [
  { re: /롯데\s*백화점|lotte\s*department|^롯데(\s|$)|^lotte(\s|$)/i, label: '롯데백화점' },
  { re: /현대\s*백화점|더\s*현대|hyundai\s*department|the\s*hyundai|^현대(\s|$)/i, label: '현대백화점' },
  { re: /신세계|shinsegae/i, label: '신세계백화점' },
  { re: /갤러리아|galleria/i, label: '갤러리아' },
  { re: /ak\s*플라자|ak\s*plaza|ak\s*백화점/i, label: 'AK플라자' },
  { re: /nc\s*백화점|뉴코아|nc\s*department|newcore/i, label: 'NC·뉴코아' },
  { re: /백화점|department\s*store/i, label: '백화점' },
];
// 술을 팔지 않는 곳 (department_store 로 잘못 들어간 곳 포함)
const NOT_LIQUOR = /다이소|daiso|아울렛|outlet|면세점|duty\s*free|영\s*플라자|문구|전자|하이마트|가구|의류|패션|기념품|농기계|자재|공구|그릇|주방|침구|한복|안경|잡화|양품|시장(?!.*백화점)/i;

const HANGUL = /[가-힣]/;
const LIQUOR_WORDS = /주류|술|맥주|비어|beer|와인|wine|리쿼|liquor|보틀|bottle|양주|위스키|whisk|막걸리|전통주|사케|sake|양조/i;
const BAR_WORDS = /주점|술집|포차|치킨|호프|이자카야|스카이\s*라운지|pub$|카페$|cafe$/i;

/** 화면에 쓸 이름: 한글 이름이 있으면 그것 */
export function displayName(tags = {}) {
  const candidates = [tags['name:ko'], tags.name, tags['brand:ko'], tags.brand].filter(Boolean).map((s) => String(s).trim());
  return candidates.find((s) => HANGUL.test(s)) || candidates[0] || '';
}

export function martBrand(text) {
  for (const b of MART_BRANDS) if (b.re.test(text)) return b;
  return undefined;
}

function liquorShopLabel(tags, name) {
  if (/주류\s*(백화점|할인|마트|창고|아울렛)|리쿼\s*(마트|스토어)|와인\s*(창고|아울렛)/.test(name)) return '주류 할인점';
  if (/주류\s*(상사|도매|유통|총판)|상사$|도매|유통$/.test(name)) return '주류 도매';
  if (/전통주|막걸리|양조|약주|酒/.test(name)) return '전통주';
  if (/사케|sake|니혼슈/i.test(name)) return '사케';
  if (/위스키|whisk|보틀|bottle|리쿼|liquor|바틀/i.test(name)) return '보틀샵';
  if (/와인|wine|vin|비노|vino|까브|cave/i.test(name) || tags.shop === 'wine') return '와인샵';
  if (tags.shop === 'beverages') return '주류·음료';
  return '주류 판매점';
}

/**
 * OSM 요소 하나를 { kind, label } 로 분류. 술을 사기 어려운 곳이면 null
 * kind: shop(주류 전문점) | warehouse(창고형) | mart(대형마트) | super(SSM) | department(백화점) | brewery(양조장)
 */
export function classifyOsm(tags = {}) {
  const name = displayName(tags);
  if (!name) return null;
  const all = [tags.name, tags['name:ko'], tags.brand, tags['brand:ko'], tags.operator].filter(Boolean).join(' ');

  if (tags.craft || tags.industrial) {
    const what = tags.craft || tags.industrial;
    if (what === 'winery') return { kind: 'brewery', label: '와이너리' };
    if (what === 'distillery') return { kind: 'brewery', label: '증류소' };
    if (what === 'brewery') return { kind: 'brewery', label: /맥주|브루|brew|beer/i.test(name) ? '브루어리' : '양조장' };
  }

  if (['alcohol', 'wine', 'beverages'].includes(tags.shop)) {
    // beverages 는 대부분 카페·주스·생수 가게라서 이름에 술 이야기가 있을 때만
    if (tags.shop === 'beverages' && !LIQUOR_WORDS.test(all)) return null;
    // 가게가 아니라 술집인 곳 (OSM 에 잘못 들어간 경우)
    if (BAR_WORDS.test(name)) return null;
    return { kind: 'shop', label: liquorShopLabel(tags, name) };
  }

  if (tags.shop === 'department_store') {
    if (NOT_LIQUOR.test(all)) {
      // NC·뉴코아는 아울렛이라도 안에 마트(킴스클럽)가 있어 남김
      if (!/nc\s*백화점|뉴코아|newcore/i.test(all)) return null;
    }
    const mart = martBrand(name);
    if (mart) return mart.kind ? { kind: mart.kind, label: mart.label } : null;
    const dept = DEPARTMENT_BRANDS.find((d) => d.re.test(all));
    return dept ? { kind: 'department', label: dept.label } : null;
  }

  if (['supermarket', 'wholesale', 'hypermarket'].includes(tags.shop)) {
    const mart = martBrand(name) || martBrand(tags.brand || '') || martBrand(tags['brand:ko'] || '');
    return mart?.kind ? { kind: mart.kind, label: mart.label } : null;
  }
  return null;
}

function compact(value) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s || undefined;
}

export function addressOf(tags = {}) {
  if (tags['addr:full']) return compact(tags['addr:full']);
  const parts = [
    tags['addr:province'],
    tags['addr:city'],
    tags['addr:district'],
    tags['addr:suburb'],
    tags['addr:street'],
    tags['addr:housenumber'],
  ].filter(Boolean);
  if (tags['addr:street'] || tags['addr:housenumber']) return compact(parts.join(' '));
  return undefined;
}

/** Overpass 결과 → 앱에서 쓰는 매장 목록 (같은 곳이 node·way 로 두 번 들어간 경우 하나만) */
export function osmToStores(elements = []) {
  const out = [];
  const seen = new Map();
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!isKoreanCoord(lat, lng)) continue;
    const tags = el.tags || {};
    const cls = classifyOsm(tags);
    if (!cls) continue;
    const store = {
      id: `${el.type[0]}${el.id}`,
      k: cls.kind,
      b: cls.label,
      n: displayName(tags),
      la: Math.round(lat * 1e6) / 1e6,
      lo: Math.round(lng * 1e6) / 1e6,
    };
    const a = addressOf(tags);
    const h = compact(tags.opening_hours);
    const p = compact(tags.phone || tags['contact:phone']);
    const w = compact(tags.website || tags['contact:website']);
    if (a) store.a = a;
    if (h) store.h = h;
    if (p) store.p = p;
    if (w && /^https?:\/\//i.test(w)) store.w = w;

    // 같은 이름이 60m 안에 또 있으면 같은 곳으로 봄 (건물 윤곽과 점이 둘 다 있는 경우)
    const key = `${store.k}|${store.n}`;
    const dup = (seen.get(key) || []).find((s) => Math.abs(s.la - store.la) < 0.0006 && Math.abs(s.lo - store.lo) < 0.0007);
    if (dup) {
      for (const f of ['a', 'h', 'p', 'w']) if (!dup[f] && store[f]) dup[f] = store[f];
      continue;
    }
    seen.set(key, [...(seen.get(key) || []), store]);
    out.push(store);
  }
  out.sort((x, y) => x.la - y.la || x.lo - y.lo);
  return out;
}
