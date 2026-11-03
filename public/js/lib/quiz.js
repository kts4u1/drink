// 취향 찾기: 네 가지 질문으로 제품 추천

export const QUESTIONS = [
  {
    id: 'taste',
    q: '어떤 맛이 끌려요?',
    options: [
      { id: 'sweet', label: '달콤한 맛', emoji: '🍑' },
      { id: 'fresh', label: '상큼하고 가벼운 맛', emoji: '🍋' },
      { id: 'rich', label: '묵직하고 진한 맛', emoji: '🍫' },
      { id: 'smoky', label: '스모키·독특한 맛', emoji: '🔥' },
    ],
  },
  {
    id: 'strength',
    q: '도수는 어느 정도가 좋아요?',
    options: [
      { id: 'low', label: '가볍게 (15도 이하)', emoji: '🫧' },
      { id: 'mid', label: '중간 (15~30도)', emoji: '🍶' },
      { id: 'high', label: '독해도 좋아요 (30도 이상)', emoji: '🥃' },
      { id: 'any', label: '상관없어요', emoji: '🤷' },
    ],
  },
  {
    id: 'use',
    q: '어떻게 마실 거예요?',
    options: [
      { id: 'food', label: '식사와 함께', emoji: '🍽️' },
      { id: 'sip', label: '혼자 천천히', emoji: '🌙' },
      { id: 'mix', label: '섞어서 (하이볼·칵테일)', emoji: '🍹' },
      { id: 'gift', label: '선물할 거예요', emoji: '🎁' },
    ],
  },
  {
    id: 'budget',
    q: '한 병에 얼마까지?',
    options: [
      { id: 'b1', label: '2만원 이하', emoji: '💵', range: [0, 20000] },
      { id: 'b2', label: '2~5만원', emoji: '💳', range: [20000, 50000] },
      { id: 'b3', label: '5~10만원', emoji: '💰', range: [50000, 100000] },
      { id: 'b4', label: '10만원 이상', emoji: '💎', range: [100000, Infinity] },
    ],
  },
];

const ABV_DEFAULT = { wine: 13, beer: 5, sake: 15, traditional: 8, soju: 16, liqueur: 25, whisky: 40, brandy: 40, vodka: 40, gin: 40, rum: 40, tequila: 38, baijiu: 40 };

function abvOf(p) {
  return p.abv ?? ABV_DEFAULT[p.cat] ?? 20;
}

/** 답 → 점수와 이유 */
export function scoreProduct(p, answers) {
  let score = 0;
  const why = [];
  const tags = new Set(p.tags || []);

  switch (answers.taste) {
    case 'sweet':
      score += (p.sweet - 3) * 2;
      if (p.sweet >= 4) why.push('달콤해요');
      break;
    case 'fresh':
      score += (3 - p.body) * 2 + (tags.has('sparkling') ? 1 : 0) + (p.sweet <= 3 ? 1 : 0);
      if (p.body <= 2) why.push('가볍고 산뜻해요');
      break;
    case 'rich':
      score += (p.body - 3) * 2;
      if (p.body >= 4) why.push('진하고 묵직해요');
      break;
    case 'smoky':
      score += tags.has('smoky') ? 6 : p.body >= 4 ? 1 : -2;
      if (tags.has('smoky')) why.push('스모키해요');
      break;
    default:
  }

  const abv = abvOf(p);
  const fits = { low: abv <= 15, mid: abv > 15 && abv <= 30, high: abv > 30, any: true }[answers.strength] ?? true;
  if (answers.strength && answers.strength !== 'any') {
    score += fits ? 3 : -4;
    if (fits && p.abv) why.push(`${p.abv}도`);
  }

  const useTags = { food: ['food'], sip: ['sip'], mix: ['highball', 'cocktail'], gift: ['gift'] }[answers.use] || [];
  if (useTags.some((t) => tags.has(t))) {
    score += 4;
    why.push({ food: '식사와 잘 맞아요', sip: '천천히 즐기기 좋아요', mix: '섞어 마시기 좋아요', gift: '선물로 좋아요' }[answers.use]);
  }
  if (tags.has('beginner')) score += 1;

  const range = QUESTIONS[3].options.find((o) => o.id === answers.budget)?.range;
  if (range && p.price) {
    const [lo, hi] = p.price;
    const overlap = lo <= range[1] && hi >= range[0];
    score += overlap ? 4 : lo > range[1] ? -6 : -2;
  }
  return { score, why };
}

/** 추천 결과 상위 n 개 (같은 종류가 한쪽에 몰리지 않게 종류당 최대 3개) */
export function recommend(products, answers, n = 6) {
  const ranked = products
    .map((p) => ({ product: p, ...scoreProduct(p, answers) }))
    .sort((a, b) => b.score - a.score || a.product.price[0] - b.product.price[0]);
  const out = [];
  const perCat = {};
  for (const r of ranked) {
    if ((perCat[r.product.cat] || 0) >= 3) continue;
    perCat[r.product.cat] = (perCat[r.product.cat] || 0) + 1;
    out.push(r);
    if (out.length >= n) break;
  }
  return out;
}

/** 결과에서 가장 많이 나온 술 종류 (그 백과 글로 안내) */
export function topCategories(results, n = 2) {
  const count = {};
  for (const r of results) count[r.product.cat] = (count[r.product.cat] || 0) + r.score;
  return Object.entries(count)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([cat]) => cat);
}
