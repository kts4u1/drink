// 와인·위스키·양주 가격 안내 (공공 가격 자료가 없어서 참고 가격대로)
// - "이 값 이하면 싼 편" 기준
// - 판매처별로 보통 얼마쯤인지 (창고형 마트 < 대형마트 < 전문점 < 편의점 < 백화점)
// - 싸게 살 수 있는 때 (명절 선물 세트 행사, 연말 행사)
// 화면·테스트 공통

/** 최저가 탭의 술 묶음. 소주·맥주(와 참가격이 있는 막걸리)는 '생활 술'(참가격)에서 따로 */
export const PRICE_GROUPS = [
  { id: 'whisky', label: '위스키', emoji: '🥃', cats: ['whisky'] },
  { id: 'wine', label: '와인', emoji: '🍷', cats: ['wine'] },
  { id: 'spirits', label: '양주', emoji: '🍸', cats: ['brandy', 'vodka', 'gin', 'rum', 'tequila', 'liqueur'] },
  { id: 'asian', label: '사케·전통주', emoji: '🍶', cats: ['sake', 'traditional', 'baijiu'] },
];
export const DAILY_GROUP = { id: 'daily', label: '소주·맥주·막걸리', emoji: '🍺' };
export const groupOf = (product) => PRICE_GROUPS.find((g) => g.cats.includes(product.cat)) || null;

/** 가격대 고르기 (참고 가격의 낮은 쪽 기준) */
export const BUDGETS = [
  { id: 'all', label: '전체' },
  { id: 'u5', label: '5만 원 아래', max: 50000 },
  { id: '5-10', label: '5~10만', min: 50000, max: 100000 },
  { id: '10-20', label: '10~20만', min: 100000, max: 200000 },
  { id: 'o20', label: '20만 원 이상', min: 200000 },
];

/** 가격을 비교하는 제품: 묶음 안의 술이고 참가격(소주·맥주 실제 가격)이 없는 것 */
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

// 가격대에 맞게 반올림 (10만 원 이상은 5천 원, 3만 원 이상은 천 원, 1만 원 이상은 500원)
export function roundPrice(n) {
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

/** 참고 가격을 언제 무엇으로 확인했는지 ("2026년 11월 공개 판매가로 확인") */
export function checkedText(product) {
  const m = /^(\d{4})-(\d{2})$/.exec(product.checked || '');
  if (!m) return '확인할 판매가를 못 찾아 짐작한 값';
  const when = `${m[1]}년 ${Number(m[2])}월`;
  return product.kca ? `한국소비자원 참가격 ${when} 조사 기준` : `${when}에 공개된 판매가로 확인`;
}

/** 목록 정렬: pop(추천순 = 목록 순서) | low(낮은 가격순) | high(높은 가격순) */
export function sortPriceProducts(list, order) {
  if (order === 'low') return [...list].sort((a, b) => a.price[0] - b.price[0] || a.price[1] - b.price[1]);
  if (order === 'high') return [...list].sort((a, b) => b.price[1] - a.price[1] || b.price[0] - a.price[0]);
  return list;
}

// ---------- 판매처별 가격 ----------

/**
 * 판매처마다 참고 가격대의 어디쯤에서 파는지 (lo 최저 · good 싼 편 기준 · mid 가운데 · hi 최고)
 * 2025~2026년 국내 판매가를 보면 같은 술이 창고형 마트 < 대형마트 < 전문점 < 편의점·백화점 순서로 비싸요
 * (예: 발베니 12년 코스트코·트레이더스 9만 원대 중반, 대형마트 11만 원 안팎). 정확한 값이 아니라 대략적인 위치예요.
 * near: 내 주변에서 가장 가까운 곳을 찾을 때 쓰는 매장 종류 (lib/nearby.js 의 storeFilter 열쇠)
 */
export const PRICE_CHANNELS = {
  warehouse: { name: '창고형 마트', sub: '코스트코·트레이더스·맥스', emoji: '📦', near: 'warehouse', at: ({ lo, good }) => [lo, good] },
  martSale: { name: '대형마트 행사 때', sub: '명절·연말 선물전, 와인 장터', emoji: '🏷️', near: 'mart', at: ({ lo, good }) => [lo, good] },
  mart: { name: '대형마트 평소', sub: '이마트·롯데마트·홈플러스·하나로마트', emoji: '🛒', near: 'mart', at: ({ good, mid }) => [good, mid] },
  discount: { name: '주류 할인점', sub: '동네 주류 할인 매장', emoji: '💸', near: 'shop:discount', at: ({ good, mid }) => [good, mid] },
  shop: { name: '와인샵·보틀샵', sub: '종류가 가장 많고 추천을 받을 수 있어요', emoji: '🍾', near: 'shop', at: ({ mid, hi }) => [mid, hi] },
  tradShop: { name: '전통주 가게', sub: '지역 술·양조장 술이 많아요', emoji: '🍶', near: 'shop:trad', at: ({ good, hi }) => [good, hi] },
  online: { name: '온라인 주문', sub: '전통주는 인터넷으로 살 수 있어요 (택배)', emoji: '🚚', at: ({ lo, mid }) => [lo, mid] },
  convenience: { name: '편의점', sub: '매장 가격 · 앱 픽업 행사가는 마트만큼 쌀 때도', emoji: '🏪', at: ({ mid, hi }) => [mid, hi * 1.1] },
  department: { name: '백화점', sub: '선물 포장·한정판', emoji: '🏬', near: 'department', at: ({ hi }) => [hi * 0.95, hi * 1.15] },
};

const CHANNELS_FOR = {
  whisky: ['warehouse', 'martSale', 'mart', 'discount', 'shop', 'convenience', 'department'],
  spirits: ['warehouse', 'martSale', 'mart', 'discount', 'shop', 'convenience', 'department'],
  wine: ['warehouse', 'martSale', 'mart', 'discount', 'shop', 'convenience', 'department'],
  traditional: ['online', 'mart', 'tradShop', 'department'],
  asian: ['mart', 'shop', 'department'],
};

/** 제품 → 판매처별 대략적인 가격 [{ id, name, sub, emoji, near, lo, hi, verdict }] (싼 곳부터) */
export function channelPrices(product) {
  const [lo, hi] = product.price;
  const pts = { lo, hi, good: goodPrice(product), mid: (lo + hi) / 2 };
  const group = groupOf(product)?.id;
  const ids = product.cat === 'traditional' ? CHANNELS_FOR.traditional : CHANNELS_FOR[group] || CHANNELS_FOR.asian;
  return ids.map((id) => {
    const c = PRICE_CHANNELS[id];
    const [a, b] = c.at(pts).map(roundPrice);
    const mid = (a + b) / 2;
    return { id, ...c, lo: a, hi: Math.max(a, b), verdict: mid <= pts.good ? 'cheap' : mid <= hi ? 'normal' : 'pricey' };
  });
}

/** 면세점 안내가 필요한 술 (증류주) */
export const DUTY_FREE_CATS = new Set(['whisky', 'brandy', 'vodka', 'gin', 'rum', 'tequila', 'liqueur', 'baijiu']);

// ---------- 싸게 살 수 있는 때 ----------

/**
 * 설날·추석 (한국천문연구원 음력 자료). 해마다 아래에 이어 적어 주세요.
 * 날짜가 다 지나면 명절 행사는 안내하지 않고 연말 행사만 보여 줘요.
 */
export const HOLIDAYS = [
  { name: '설', date: '2026-02-17' },
  { name: '추석', date: '2026-09-25' },
  { name: '설', date: '2027-02-07' },
  { name: '추석', date: '2027-09-15' },
  { name: '설', date: '2028-01-27' },
  { name: '추석', date: '2028-10-03' },
];

const DAY = 24 * 3600 * 1000;
// 한국 시간 날짜 (자정 기준 일수)
const kstDayNumber = (t) => Math.floor((t + 9 * 3600 * 1000) / DAY);
const dayNumber = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
const isoOf = (n) => new Date(n * DAY).toISOString().slice(0, 10);

/**
 * 앞으로 다가오는(또는 지금 열리는) 할인 행사 [{ name, start, end, active, daysLeft }] (가까운 순)
 * - 명절 선물 세트 행사: 명절 4주 전부터 전날까지 (사전 예약은 보통 한 달쯤 전부터)
 * - 연말 행사: 12월 한 달
 */
export function saleSeasons(now = Date.now(), limit = 2) {
  const today = kstDayNumber(now);
  const year = new Date(today * DAY).getUTCFullYear();
  const list = HOLIDAYS.map((h) => {
    const d = dayNumber(h.date);
    return { name: `${h.name} 선물 세트 행사`, start: d - 28, end: d - 1 };
  });
  for (const y of [year, year + 1]) list.push({ name: '연말 주류 행사', start: dayNumber(`${y}-12-01`), end: dayNumber(`${y}-12-31`) });
  return list
    .filter((s) => s.end >= today)
    .sort((a, b) => a.start - b.start)
    .slice(0, limit)
    .map((s) => ({ name: s.name, start: isoOf(s.start), end: isoOf(s.end), active: s.start <= today, daysLeft: Math.max(0, s.start - today) }));
}

/** 2026-12-01 → "12월 1일" */
export const monthDay = (iso) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;

/** 행사 한 줄: "지금 연말 주류 행사 중 (12월 31일까지)" / "연말 주류 행사 12월 1일부터 · 26일 남음" */
export function seasonText(s) {
  return s.active ? `지금 ${s.name} 기간이에요 (${monthDay(s.end)}까지)` : `${s.name} ${monthDay(s.start)}~${monthDay(s.end)} · ${s.daysLeft}일 남음`;
}

/** 이 묶음의 술을 싸게 사기 좋은 가게 종류 ('shop:<가게 종류>' 는 주류 전문점 안의 종류) */
export const CHEAP_PLACES = {
  whisky: ['warehouse', 'shop:discount', 'shop:bottle'],
  wine: ['warehouse', 'shop:wine', 'mart'],
  spirits: ['warehouse', 'shop:discount', 'shop:bottle'],
  asian: ['shop:trad', 'department', 'mart'],
};

/** 오늘 가격을 볼 수 있는 곳 (링크만 — 가격을 가져오지 않음) */
export function livePriceLinks(product) {
  const name = String(product.name).replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const q = encodeURIComponent(name);
  const links = [];
  if (product.cat === 'whisky') links.push({ id: 'whiskywatch', label: '위스키와치', desc: '면세점·코스트코·트레이더스 가격', url: `https://whiskywatch.co.kr/whisky?q=${q}` });
  if (product.cat !== 'traditional') links.push({ id: 'dailyshot', label: '데일리샷', desc: '주변 매장 픽업 가격', url: `https://dailyshot.co/m/search/result?q=${q}` });
  links.push({ id: 'naver', label: '네이버', desc: '가격 검색', url: `https://search.naver.com/search.naver?query=${encodeURIComponent(`${name} 가격`)}` });
  return links;
}
