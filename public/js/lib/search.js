// 술 이름·용어 검색 (띄어쓰기·대소문자·기호를 무시하고, 별명까지 찾음)

/** "Johnnie Walker 블랙-라벨" → "johnniewalker블랙라벨" */
export function norm(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[\s·.,'’"()\-_/&+!?:;[\]]/g, '');
}

function fieldScore(query, value, weight) {
  const v = norm(value);
  if (!v || !query) return 0;
  if (v === query) return weight * 3;
  if (v.startsWith(query)) return weight * 2;
  if (v.includes(query)) return weight;
  return 0;
}

/**
 * 검색어 하나로 여러 항목을 찾아 점수 순으로.
 * fields: [[값을 꺼내는 함수, 가중치], ...] — 값은 문자열이나 문자열 배열
 */
export function searchItems(items, query, fields) {
  const words = String(query ?? '').trim().split(/\s+/).map(norm).filter(Boolean);
  if (!words.length) return [];
  const scored = [];
  for (const item of items) {
    let total = 0;
    let allMatched = true;
    for (const word of words) {
      let best = 0;
      for (const [get, weight] of fields) {
        const value = get(item);
        const values = Array.isArray(value) ? value : [value];
        for (const v of values) best = Math.max(best, fieldScore(word, v, weight));
      }
      if (!best) allMatched = false;
      total += best;
    }
    // 띄어 쓴 단어가 모두 맞거나, 붙여 쓴 전체가 맞으면 결과에 넣음
    if (!allMatched) {
      const joined = words.join('');
      let best = 0;
      for (const [get, weight] of fields) {
        const value = get(item);
        for (const v of Array.isArray(value) ? value : [value]) best = Math.max(best, fieldScore(joined, v, weight));
      }
      if (!best) continue;
      total = best;
    }
    scored.push({ item, score: total });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}

export const PRODUCT_FIELDS = [
  [(p) => p.name, 10],
  [(p) => p.aliases || [], 9],
  [(p) => p.en, 6],
  [(p) => p.sub, 4],
  [(p) => p.country, 2],
  [(p) => p.notes, 1],
];

export const CATEGORY_FIELDS = [
  [(c) => c.name, 10],
  [(c) => c.en, 6],
  [(c) => c.keywords || [], 7],
  [(c) => c.oneLine, 1],
];

export const TERM_FIELDS = [
  [(t) => t.term, 10],
  [(t) => t.desc, 1],
];

export function searchProducts(products, query) {
  return searchItems(products, query, PRODUCT_FIELDS);
}

export function searchCategories(categories, query) {
  return searchItems(categories, query, CATEGORY_FIELDS);
}

export function searchTerms(terms, query) {
  return searchItems(terms, query, TERM_FIELDS);
}
