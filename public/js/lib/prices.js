// 와인·위스키·양주 가격 비교: 참고 가격으로 "싼 편" 기준 잡기, 사용자 제보 정리 (화면·서버·테스트 공통)
import { distanceKm } from './geo.js';

/** 최저가 탭의 술 묶음. 소주·맥주(와 참가격이 있는 막걸리)는 '생활 술'(참가격)에서 따로 */
export const PRICE_GROUPS = [
  { id: 'whisky', label: '위스키', emoji: '🥃', cats: ['whisky'] },
  { id: 'wine', label: '와인', emoji: '🍷', cats: ['wine'] },
  { id: 'spirits', label: '양주', emoji: '🍸', cats: ['brandy', 'vodka', 'gin', 'rum', 'tequila', 'liqueur'] },
  { id: 'asian', label: '사케·전통주', emoji: '🍶', cats: ['sake', 'traditional', 'baijiu'] },
];
export const DAILY_GROUP = { id: 'daily', label: '소주·맥주·막걸리', emoji: '🍺' };

/** 값을 정할 때 쓰는 예산 구간 (참고 가격의 낮은 쪽 기준) */
export const BUDGETS = [
  { id: 'all', label: '전체' },
  { id: 'u5', label: '5만 원 아래', max: 50000 },
  { id: '5-10', label: '5~10만', min: 50000, max: 100000 },
  { id: '10-20', label: '10~20만', min: 100000, max: 200000 },
  { id: 'o20', label: '20만 원 이상', min: 200000 },
];

/** 가격을 비교·제보할 수 있는 제품: 묶음 안의 술이고 참가격(소주·맥주 실제 가격)이 없는 것 */
export function priceProducts(products, groupId) {
  const group = PRICE_GROUPS.find((g) => g.id === groupId);
  const cats = new Set(group ? group.cats : PRICE_GROUPS.flatMap((g) => g.cats));
  return products.filter((p) => cats.has(p.cat) && !p.kca && p.price?.[0] > 0);
}

export const inBudget = (product, budgetId) => {
  const b = BUDGETS.find((x) => x.id === budgetId);
  if (!b || b.id === 'all') return true;
  const lo = product.price[0];
  return (b.min == null || lo >= b.min) && (b.max == null || lo < b.max);
};

/** 받을 수 있는 제보 가격 범위: 참고 가격의 0.4배 ~ 3배 (용량·제품을 잘못 고른 제보 막기) */
export function priceBounds(product) {
  const [lo, hi] = product.price;
  return [Math.max(500, Math.floor((lo * 0.4) / 100) * 100), Math.ceil((hi * 3) / 100) * 100];
}

// 가격대에 맞게 반올림 (10만 원대는 천 원, 1만 원 아래는 백 원)
function roundPrice(n) {
  const unit = n >= 100000 ? 5000 : n >= 30000 ? 1000 : n >= 10000 ? 500 : 100;
  return Math.round(n / unit) * unit;
}

/** "이 값 이하면 싼 편": 참고 가격대의 아래쪽 4분의 1 */
export function goodPrice(product) {
  const [lo, hi] = product.price;
  return roundPrice(lo + (hi - lo) * 0.25);
}

/** 가격 → 'cheap'(싼 편) | 'normal'(보통) | 'pricey'(비싼 편) */
export function priceVerdict(product, price) {
  if (price <= goodPrice(product)) return 'cheap';
  if (price <= product.price[1]) return 'normal';
  return 'pricey';
}
export const VERDICT_LABEL = { cheap: '싼 편', normal: '보통', pricey: '비싼 편' };

/**
 * 사람이 적은 가격 글자 → 원 (못 읽으면 NaN)
 * "129,000" "129000원" "12만 9천" "12.9만" "9만 8,000" "12만9천원"
 */
export function parseWon(text) {
  const s = String(text ?? '')
    .replace(/[,\s원₩]/g, '')
    .trim();
  if (!s) return NaN;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const m = s.match(/^(?:(\d+(?:\.\d+)?)만)?(?:(\d+(?:\.\d+)?)천)?(\d+)?$/);
  if (!m || (!m[1] && !m[2])) return NaN;
  return Math.round(Number(m[1] || 0) * 10000 + Number(m[2] || 0) * 1000 + Number(m[3] || 0));
}

/** 제보 목록 정리: 매장 거리, 판정, 싼 순 (같으면 최근 것) */
export function reportRows(product, reports, loc = null) {
  return (reports || [])
    .map((r) => ({
      ...r,
      d: loc && r.la != null && r.lo != null ? distanceKm(loc.lat, loc.lng, r.la, r.lo) : null,
      verdict: priceVerdict(product, r.p),
    }))
    .sort((a, b) => a.p - b.p || b.t - a.t);
}

/** 언제 본 가격인지 ("오늘", "3일 전", "2주 전", "3달 전") */
export function timeAgo(t, now = Date.now()) {
  const day = 24 * 3600 * 1000;
  const startOfToday = Math.floor((now + 9 * 3600 * 1000) / day); // 한국 시간 날짜
  const days = startOfToday - Math.floor((t + 9 * 3600 * 1000) / day);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  if (days < 14) return `${days}일 전`;
  if (days < 60) return `${Math.floor(days / 7)}주 전`;
  return `${Math.floor(days / 30)}달 전`;
}

/** 목록 정렬: pop(추천순 = 목록 순서) | low(낮은 가격순) | report(최근 제보순) */
export function sortPriceProducts(list, order, summary = {}) {
  if (order === 'low') return [...list].sort((a, b) => a.price[0] - b.price[0] || a.price[1] - b.price[1]);
  if (order === 'report') return [...list].sort((a, b) => (summary[b.id]?.last || 0) - (summary[a.id]?.last || 0));
  return list;
}

/** 이 묶음의 술을 싸게 사기 좋은 가게 종류 ('shop:<가게 종류>' 는 주류 전문점 안의 종류) */
export const CHEAP_PLACES = {
  whisky: ['warehouse', 'shop:discount', 'shop:bottle'],
  wine: ['warehouse', 'shop:wine', 'mart'],
  spirits: ['warehouse', 'shop:discount', 'shop:bottle'],
  asian: ['shop:trad', 'department', 'mart'],
};

/** 짧은 원 표시: 125000 → "12.5만", 6000 → "6,000" */
export function shortWon(n) {
  if (n == null) return '';
  if (n >= 10000) return `${Number((n / 10000).toFixed(1))}만`;
  return n.toLocaleString('ko-KR');
}
