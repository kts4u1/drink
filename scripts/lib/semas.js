// 소상공인시장진흥공단 상가(상권)정보 → 술 파는 가게 (와인샵·보틀샵·주류 할인점·전통주)
//
// OpenStreetMap 에는 동네 주류 전문점이 전국 100여 곳뿐이라, 정부 공공데이터의 전국 상가 목록에서
// 업종이 "주류 소매업"인 가게와, 소매 업종 중 이름에 와인·주류·위스키 등이 들어간 가게를 골라 더합니다.
// 출처: 공공데이터포털 15083033 (분기마다 갱신, 이용허락범위 제한 없음)
import { isKoreanCoord } from '../../public/js/lib/geo.js';
import { liquorShopLabel } from './osm.js';

export const SEMAS_DATASET = '15083033';
export const SEMAS_PAGE = 'https://www.data.go.kr/data/15083033/fileData.do';
export const SEMAS_SOURCE = '소상공인시장진흥공단 상가(상권)정보';

// 이름만 봐도 술 가게 ("양주"는 지명 양주시·남양주와 겹쳐서 뺌)
const STRONG = /와인|wine|주류|리쿼|liquor|위스키|whisk|전통주|막걸리|사케(?![이어])|酒/i; // "박사케이크"·"헥사케어"는 술이 아님
// "보틀"은 장신구점(골든보틀)·카페에도 쓰여서 먹거리·음료를 파는 업종일 때만
const BOTTLE = /보틀|바틀|bottle/i;
const FOODISH = new Set([
  '슈퍼마켓',
  '생수/음료 소매업',
  '우유 소매업',
  '반찬/식료품 소매업',
  '그 외 기타 상품 전문 소매업',
  '그 외 기타 종합 소매업',
  '편의점',
  '얼음 소매업',
  '기념품점',
  '건어물/젓갈 소매업',
]);
// 술 가게가 아닌데 이름에 걸리는 것
const NOT_SHOP = /정수|생수|텀블러|젖병|유아|베이비|baby|물병|약국|와인잔|와인딩/i;
// 개인이 사기 어려운 곳 (식당 납품 도매상)
const WHOLESALE = /도매|물류|총판/;

/** CSV 한 줄 → 칸 배열 (따옴표 안의 쉼표 처리) */
export function parseCsvLine(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(field);
      field = '';
    } else field += c;
  }
  out.push(field);
  return out;
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * 상가 한 곳(열 이름 → 값) → 앱 매장 기록, 술 가게가 아니면 null
 * { id: 'sm<상가업소번호>', k: 'shop', b: 와인샵|보틀샵|주류 할인점|전통주|사케|주류 판매점, n, la, lo, a: 주소 }
 */
export function semasShop(r) {
  const name = String(r['상호명'] || '').trim();
  if (!name) return null;
  const small = r['상권업종소분류명'];
  const retail = r['상권업종대분류명'] === '소매';
  const liquor =
    small === '주류 소매업' || (retail && !NOT_SHOP.test(name) && (STRONG.test(name) || (BOTTLE.test(name) && FOODISH.has(small))));
  if (!liquor || WHOLESALE.test(name)) return null;
  const la = Number(r['위도']);
  const lo = Number(r['경도']);
  if (!isKoreanCoord(la, lo)) return null;
  let label = liquorShopLabel({}, name);
  if (label === '주류 도매') label = '주류 판매점';
  const branch = String(r['지점명'] || '').trim();
  const out = { id: `sm${r['상가업소번호']}`, k: 'shop', b: label, n: branch && !name.includes(branch) ? `${name} ${branch}` : name, la: round6(la), lo: round6(lo) };
  const addr = String(r['도로명주소'] || r['지번주소'] || '').trim();
  if (addr) out.a = addr;
  return out;
}

/** 이름 비교용: 띄어쓰기·기호·"점"·회사 이름 정리 */
export function shopNameKey(n) {
  return String(n || '')
    .toLowerCase()
    .replace(/\(주\)|주식회사|㈜/g, '')
    .replace(/[^0-9a-z가-힣]/g, '')
    .replace(/(본점|직영점|점)$/, '');
}

const near = (a, b, km) => {
  const dLat = (a.la - b.la) * 111;
  const dLo = (a.lo - b.lo) * 111 * Math.cos((a.la * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLo * dLo) <= km;
};

/**
 * OpenStreetMap 매장 목록에 상가정보 가게 더하기 (예전 상가정보 기록은 빼고 다시)
 * 200m 안에 이름이 겹치는 주류 전문점이 이미 있으면 같은 곳으로 보고 OSM 쪽을 남김 (영업시간이 있어서). 주소만 채움
 */
export function mergeShops(stores, shops) {
  const base = stores.filter((s) => !String(s.id).startsWith('sm')).map((s) => ({ ...s }));
  const grid = new Map();
  const cell = (la, lo) => `${Math.round(la * 50)},${Math.round(lo * 50)}`; // 약 2km 칸
  for (const s of base) {
    if (s.k !== 'shop') continue;
    const k = cell(s.la, s.lo);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(s);
  }
  const out = [...base];
  let merged = 0;
  for (const shop of shops || []) {
    const key = shopNameKey(shop.n);
    const [ci, cj] = cell(shop.la, shop.lo).split(',').map(Number);
    let dup = null;
    for (let di = -1; di <= 1 && !dup; di++) {
      for (let dj = -1; dj <= 1 && !dup; dj++) {
        for (const s of grid.get(`${ci + di},${cj + dj}`) || []) {
          const sk = shopNameKey(s.n);
          if (near(s, shop, 0.2) && key.length >= 2 && sk.length >= 2 && (sk.includes(key) || key.includes(sk))) {
            dup = s;
            break;
          }
        }
      }
    }
    if (dup) {
      if (!dup.a && shop.a) dup.a = shop.a;
      merged++;
      continue;
    }
    out.push(shop);
  }
  return { stores: out, merged };
}
