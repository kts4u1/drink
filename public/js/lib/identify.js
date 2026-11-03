// AI 술 알아보기 결과 다듬기 (서버와 화면 공통, 브라우저·Node 둘 다 동작)

const CATEGORIES = new Set(['wine', 'whisky', 'beer', 'soju', 'traditional', 'sake', 'brandy', 'vodka', 'gin', 'rum', 'tequila', 'liqueur', 'baijiu', 'cocktail', 'other']);

const s = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v, maxItems, maxLen = 300) => (Array.isArray(v) ? v.map((x) => s(x, maxLen)).filter(Boolean).slice(0, maxItems) : []);
const clamp = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const won = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 && n < 100_000_000 ? n : 0;
};

/** 모델이 준 JSON 을 화면에서 안전하게 쓸 수 있게 다듬음 (빠진 칸·범위 밖 값 정리) */
export function normalizeResult(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  let low = won(r.price?.krw_low);
  let high = won(r.price?.krw_high);
  if (low && high && low > high) [low, high] = [high, low];
  if (!low && high) low = high;
  if (low && !high) high = low;
  return {
    is_alcohol: r.is_alcohol !== false,
    not_alcohol_reason: s(r.not_alcohol_reason, 500),
    confidence: ['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : 'low',
    confidence_note: s(r.confidence_note, 600),
    label_text: s(r.label_text, 600),
    name_ko: s(r.name_ko, 120),
    name_original: s(r.name_original, 120),
    producer: s(r.producer, 120),
    category: CATEGORIES.has(r.category) ? r.category : 'other',
    style: s(r.style, 120),
    country: s(r.country, 60),
    region: s(r.region, 80),
    ingredients: s(r.ingredients, 200),
    age_or_vintage: s(r.age_or_vintage, 80),
    abv: s(r.abv, 30),
    volume: s(r.volume, 30),
    summary: s(r.summary, 400),
    description: s(r.description, 1500),
    tasting: { nose: s(r.tasting?.nose, 300), palate: s(r.tasting?.palate, 300), finish: s(r.tasting?.finish, 300) },
    sweetness: clamp(r.sweetness, 1, 5, 3),
    body: clamp(r.body, 1, 5, 3),
    how_to_drink: {
      temperature: s(r.how_to_drink?.temperature, 120),
      glass: s(r.how_to_drink?.glass, 120),
      methods: list(r.how_to_drink?.methods, 5, 200),
      tips: s(r.how_to_drink?.tips, 400),
    },
    food_pairing: list(r.food_pairing, 6, 80),
    price: { krw_low: low, krw_high: high, basis: s(r.price?.basis, 200), note: s(r.price?.note, 300) },
    where_to_buy: s(r.where_to_buy, 400),
    similar: (Array.isArray(r.similar) ? r.similar : [])
      .map((x) => ({ name: s(x?.name, 100), why: s(x?.why, 200) }))
      .filter((x) => x.name)
      .slice(0, 3),
    storage: s(r.storage, 300),
    fun_fact: s(r.fun_fact, 400),
    search_query: s(r.search_query, 80),
  };
}

export const CONFIDENCE_LABELS = {
  high: { label: '정확히 알아봤어요', cls: 'good' },
  medium: { label: '대체로 맞아요 (세부 확인 필요)', cls: 'info' },
  low: { label: '짐작이에요 (확인 필요)', cls: 'warn' },
};

/** 화면에 보일 대표 이름 */
export function displayName(result) {
  return result.name_ko || result.name_original || '이름을 알아보지 못한 술';
}

/** 네이버 가격 검색어 */
export function priceQuery(result) {
  const base = result.search_query || [displayName(result), result.volume].filter(Boolean).join(' ');
  return /가격/.test(base) ? base : `${base} 가격`;
}

/** 이름 입력 검사: 글자 수와 의미 없는 입력 */
export function cleanQueryText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
}
