// 세계 술 데이터: 브랜드 사전(앱이 직접 쓴 설명)에 없는 술을 이름·라벨 글자로 찾기
//   - 와인 10만 개 · 와이너리 3만 곳: X-Wines (CC0) — de Azambuja, Morais, Filipe (2023) Big Data Cogn. Comput. 7(1):20
//   - 와이너리·양조장·증류소: 위키데이터 (CC0)
// 데이터 파일 (모두 작은 조각이라 필요한 것만 받음 — Worker 의 짧은 계산 시간 안에도 들어감)
//   data/world/meta.json      나라·산지·품종·음식 목록, 출처
//   data/world/k/<앞 세 글자>.json  이름 열쇠 → 생산자 [번호, 이름, 종류, 나라, 산지, 와인 수]
//   data/world/w/<n>.json     와인 조각 (생산자 번호 / 150)
// 이 파일은 브라우저·Node·Cloudflare Worker 에서 같이 씁니다 (파일 받기는 쓰는 쪽에서: createWorld).
import { normalizeResult } from './identify.js';
import { GRAPES, REGIONS, SERVE, categoryPrice, findCard, prepText, strip } from './label.js';

export const WORLD_VERSION = 1;
export const SHARD_SIZE = 150;

/** 영어 나라 이름 → 한국어 */
export const COUNTRY_KO = {
  albania: '알바니아', argentina: '아르헨티나', armenia: '아르메니아', australia: '호주', austria: '오스트리아', azerbaijan: '아제르바이잔',
  belarus: '벨라루스', belgium: '벨기에', bolivia: '볼리비아', brazil: '브라질', bulgaria: '불가리아', canada: '캐나다', chile: '칠레',
  china: '중국', colombia: '콜롬비아', croatia: '크로아티아', cyprus: '키프로스', 'czech republic': '체코', czechia: '체코', denmark: '덴마크',
  france: '프랑스', georgia: '조지아', germany: '독일', greece: '그리스', hungary: '헝가리', india: '인도', israel: '이스라엘', italy: '이탈리아',
  japan: '일본', jordan: '요르단', lebanon: '레바논', liechtenstein: '리히텐슈타인', luxembourg: '룩셈부르크', malta: '몰타', mexico: '멕시코',
  moldova: '몰도바', montenegro: '몬테네그로', morocco: '모로코', myanmar: '미얀마', netherlands: '네덜란드', 'new zealand': '뉴질랜드',
  'north macedonia': '북마케도니아', peru: '페루', poland: '폴란드', portugal: '포르투갈', romania: '루마니아', russia: '러시아',
  'san marino': '산마리노', serbia: '세르비아', slovakia: '슬로바키아', slovenia: '슬로베니아', 'south africa': '남아프리카공화국', spain: '스페인',
  sweden: '스웨덴', switzerland: '스위스', syria: '시리아', thailand: '태국', tunisia: '튀니지', turkey: '튀르키예', türkiye: '튀르키예',
  ukraine: '우크라이나', 'united kingdom': '영국', uk: '영국', england: '영국', scotland: '스코틀랜드', wales: '영국 · 웨일스', ireland: '아일랜드',
  'united states': '미국', 'united states of america': '미국', usa: '미국', us: '미국', america: '미국', uruguay: '우루과이',
  korea: '한국', 'south korea': '한국', taiwan: '대만', vietnam: '베트남', philippines: '필리핀', singapore: '싱가포르', kazakhstan: '카자흐스탄',
  finland: '핀란드', norway: '노르웨이', iceland: '아이슬란드', estonia: '에스토니아', latvia: '라트비아', lithuania: '리투아니아',
  jamaica: '자메이카', cuba: '쿠바', 'dominican republic': '도미니카 공화국', guyana: '가이아나', barbados: '바베이도스', 'trinidad and tobago': '트리니다드 토바고',
};
export function countryKo(v) {
  const s = String(v ?? '').trim();
  return COUNTRY_KO[s.toLowerCase()] || s;
}

// 와인 종류 코드 → [한국어, 마시는 법 종류]
export const WINE_TYPES = {
  r: ['레드', 'red'],
  w: ['화이트', 'white'],
  s: ['스파클링', 'sparkling'],
  o: ['로제', 'rose'],
  d: ['디저트(스위트)', 'sweet'],
  p: ['포트(주정강화)', 'fortified'],
};
export const BODY_KO = ['', '아주 가벼운', '가벼운', '중간 정도의', '묵직한', '아주 묵직한'];
export const ACID_KO = ['', '낮은', '중간인', '높은'];
const ACID_SHORT = ['', '낮음', '중간', '높음'];

/** X-Wines 음식 궁합 66가지 → 한국어 */
export const HARMONIZE_KO = {
  Poultry: '닭·오리 요리', Beef: '소고기', Lamb: '양고기', 'Game Meat': '사슴·멧돼지 같은 야생 고기', Pork: '돼지고기', Shellfish: '조개·새우·게',
  Veal: '송아지 고기', Pasta: '파스타', 'Rich Fish': '연어 같은 기름진 생선', Vegetarian: '채소 요리', 'Cured Meat': '햄·살라미', 'Spicy Food': '매운 음식',
  'Soft Cheese': '브리 같은 부드러운 치즈', 'Maturated Cheese': '숙성 치즈', 'Hard Cheese': '단단한 치즈', 'Lean Fish': '흰살생선', Appetizer: '가벼운 안주',
  Snack: '간단한 안주', 'Sweet Dessert': '달콤한 디저트', 'Goat Cheese': '염소 치즈', Mushrooms: '버섯 요리', 'Blue Cheese': '블루 치즈',
  'Fruit Dessert': '과일 디저트', Dessert: '디저트', Fruit: '과일', Fish: '생선 요리', Barbecue: '바비큐', Seafood: '해산물', Cheese: '치즈', Salad: '샐러드',
  Pizza: '피자', 'Mild Cheese': '순한 치즈', Aperitif: '식전주로', Chicken: '닭고기', Codfish: '대구 요리', Risotto: '리소토', Lasagna: '라자냐',
  Soufflé: '수플레', Tagliatelle: '탈리아텔레', Cake: '케이크', 'Medium-cured Cheese': '중간 숙성 치즈', Cookies: '쿠키', Sushi: '초밥',
  'Citric Dessert': '레몬 디저트', Meat: '고기 요리', Chocolate: '초콜릿', Sashimi: '회', Grilled: '구이', 'Tomato Dishes': '토마토 요리',
  'Light Stews': '가벼운 스튜', Duck: '오리 요리', Ham: '햄', 'Baked Potato': '구운 감자', Chestnut: '밤', 'French Fries': '감자튀김',
  'Asian Food': '아시아 음식', Cream: '크림 요리', 'Cold Cuts': '콜드컷(햄·소시지)', Yakissoba: '볶음면', 'Curry Chicken': '치킨 카레', Beans: '콩 요리',
  'Eggplant Parmigiana': '가지 파르미자나', 'Dried Fruits': '말린 과일', 'Spiced Fruit Cake': '과일 케이크', Roast: '로스트 요리', Paella: '파에야',
};
// 종류별로 같이 권하는 한식
const KOREAN_FOOD = {
  red: ['불고기', '갈비찜'],
  white: ['생선구이', '해물파전'],
  sparkling: ['튀김', '전'],
  rose: ['떡볶이', '잡채'],
  sweet: ['약과', '과일'],
  fortified: ['견과류', '곶감'],
};

/** 포도 품종 이름 → 한국어 (앱 표에 있으면) */
export function grapeKo(name) {
  const s = String(name || '');
  const g = GRAPES.find((x) => x.re.test(s.toLowerCase()));
  return g ? g.ko.replace(/\(.*\)/, '') : s.split('/')[0];
}

/** 이름 비교용 글자: 악센트·기호를 정리한 소문자 */
export function nameKey(s) {
  return prepText(s).replace(/[%.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

// 생산자 이름에 흔히 붙는 말 (이것만으로는 이름이 아님)
const GENERIC = new Set(
  ('chateau domaine domaines bodega bodegas cantina cantine tenuta tenute weingut weinhaus weinkellerei winzer vina vinos vinedos casa quinta maison the ' +
    'winery wineries wines wine estate estates vineyard vineyards cellars cellar vignobles azienda agricola fattoria castello celler adega adegas herdade ' +
    'distillery distillerie distilleria destileria brewery brewing brauerei brasserie birrificio cerveceria company co inc ltd sa srl spa gmbh ag ' +
    'family famille et fils freres and de du des la le les di del della dei da do dos das von van y e cave caves cooperative cooperativa vinicola ' +
    'vigneti vignerons cantinas sake shuzo').split(' '),
);
// 혼자서는 이름으로 쓰지 않는 흔한 말 (라벨 곳곳에 나옴)
const COMMON = new Set(
  ('reserva reserve riserva crianza gran grand cuvee brut rouge blanc rose rosso bianco tinto branco blanco classic classico premium selection select ' +
    'vintage old vines valley hills hill river mountain mountains garden gardens creek ridge oak lake park sun moon star stone rock red white black gold ' +
    'silver green blue royal cru village villages superior superiore collection private limited edition special original nature natural organic dry sweet ' +
    'sec demi extra single malt whisky whiskey scotch bourbon beer lager ale pilsner stout porter vodka gin rum brandy cognac tequila liqueur aged years ' +
    'year old new first second third best fine finest great noble pure true wild young little big north south east west central alta alto altos bajo ' +
    // 라벨 곳곳에 찍히는 문구 (병입·원산지 표시 등)
    'bouteille bouteilles appellation controlee protegee origine origin denominacion denominazione denominacao origen calificada controllata garantita ' +
    'produce product produced imported importer importado bottled bottle mis propriete recoltant negociant vin vino vinho wein qualitatswein ' +
    'pradikatswein trocken halbtrocken feinherb contains sulfites sulphites alcohol volume cuvee millesime vendange vieilles vignes tradition prestige ' +
    'terroir harvest late ice').split(' '),
);

/** 흔한 말(chateau, bodega, winery…)을 뺀 이름 — 같은 생산자인지 비교할 때 */
export function coreKey(name) {
  const full = nameKey(name);
  return (
    full
      .split(' ')
      .filter((t) => !GENERIC.has(t))
      .join(' ') || full
  );
}

/**
 * 생산자 이름 → 찾을 때 쓸 열쇠들 (전체 이름, 흔한 말을 뺀 이름)
 * blocked: 산지·품종·나라 이름 (열쇠로 안 씀), common: 라벨에 흔한 말 (한 단어 열쇠로 안 씀)
 */
export function keysFor(name, blocked = new Set(), common = new Set()) {
  const full = nameKey(name);
  const out = [];
  const ok = (k) => {
    if (!k || blocked.has(k)) return false;
    const toks = k.split(' ');
    if (toks.every((t) => GENERIC.has(t) || COMMON.has(t) || /^\d+$/.test(t))) return false;
    if (toks.length === 1) return k.length >= 5 && !/^\d+$/.test(k) && !COMMON.has(k) && !common.has(k);
    return k.length >= 4;
  };
  if (ok(full)) out.push(full);
  const stripped = full
    .split(' ')
    .filter((t) => !GENERIC.has(t))
    .join(' ');
  if (stripped && stripped !== full && ok(stripped)) out.push(stripped);
  return out;
}

/** 산지·품종·나라 이름 (이것만으로 생산자를 정하지 않음: "Margaux"는 샤토 마고가 아니라 마고 산지일 수 있음) */
export function blockedKeys({ regions = [], grapes = [] } = {}) {
  const blocked = new Set();
  for (const r of regions) blocked.add(nameKey(r));
  for (const g of grapes) for (const part of String(g).split('/')) blocked.add(nameKey(part));
  for (const c of Object.keys(COUNTRY_KO)) blocked.add(c);
  for (const r of REGIONS) blocked.add(nameKey(r.ko));
  return blocked;
}

/** 열쇠가 들어 있는 조각 파일 이름 (앞 세 글자, 짧으면 두 글자, 영문·숫자가 아니면 첫 글자 코드) */
export function prefixOf(key) {
  const k = String(key || '');
  if (/^[a-z0-9]{3}/.test(k)) return k.slice(0, 3);
  if (/^[a-z0-9]{2}/.test(k)) return k.slice(0, 2);
  return `u${(k.codePointAt(0) || 0).toString(36)}`;
}

/** 열쇠가 들어 있는 조각: 흔한 첫 단어(chateau, domaine…)는 건너뛰고 다음 단어의 앞 세 글자 */
export function keyShard(key) {
  const toks = String(key || '').split(' ');
  return prefixOf(toks.find((t) => !GENERIC.has(t)) || toks[0]);
}

/** 글자에서 받아야 할 이름 조각들 (단어마다 앞 세 글자) */
export function prefixesFor(text, limit = 40) {
  const out = new Set();
  for (const t of nameKey(text).split(' ')) if (t.length >= 2) out.add(prefixOf(t));
  return [...out].slice(0, limit);
}

/**
 * 받은 이름 조각들에서 글자(라벨·이름) 속 생산자 찾기 → { p, key, score } 또는 null
 * p = [번호, 이름, 종류, 나라, 산지, 와인 수]. hint.category 가 있으면 다른 종류는 점수를 깎음
 */
export function findProducer(shards, text, hint = {}) {
  const tokens = nameKey(text).split(' ').filter(Boolean);
  if (!tokens.length) return null;
  const padded = ` ${tokens.join(' ')} `;
  let best = null;
  for (let n = Math.min(7, tokens.length); n >= 1; n--) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const key = tokens.slice(i, i + n).join(' ');
      const hits = shards.get(keyShard(key))?.[key];
      if (!hits) continue;
      for (const p of hits) {
        const regionHit = p[4] && padded.includes(` ${nameKey(p[4])} `);
        // 한 단어로만 맞으면 7글자 이상이거나, 와인이 3개 이상이거나, 산지가 같이 보여야 ("Daniel", "Morgan" 같은 이름 막기)
        if (n === 1 && key.length < 7 && (p[5] || 0) < 3 && !regionHit) continue;
        // 흔한 말(bodega, chateau…)은 빼고 센 단어 수 — "Bodega Catena Zapata"와 "Catena Zapata"는 같은 점수, 와인 정보가 많은 쪽이 이김
        const core = key.split(' ').filter((t) => !GENERIC.has(t));
        let score = Math.max(core.length, 1) * 10 + core.join(' ').length + (regionHit ? 15 : 0) + Math.min(p[5] || 0, 60) / 10;
        if (hint.category && hint.category !== p[2]) score -= 30;
        if (!best || score > best.score) best = { p, key, score };
      }
    }
  }
  return best && best.score >= 16 ? best : null;
}

/**
 * 파일 받기 함수를 받아 세계 데이터 찾기 도구 만들기
 * fetchJson(path) → JSON (path 예: "meta.json", "k/os.json", "w/3.json")
 */
export function createWorld(fetchJson, ctx = {}) {
  let meta = null;
  const kCache = new Map();
  const getMeta = () => (meta ||= fetchJson('meta.json').catch((err) => {
    meta = null;
    throw err;
  }));
  const getK = (prefix) => {
    if (!kCache.has(prefix)) kCache.set(prefix, fetchJson(`k/${prefix}.json`).catch(() => ({})));
    return kCache.get(prefix);
  };
  return {
    /** 글자 → 결과 (못 찾으면 null) */
    async lookup(text, hint = {}) {
      const m = await getMeta();
      const exists = m.keyFiles ? new Set(m.keyFiles) : null;
      const prefixes = prefixesFor(text, 200)
        .filter((pf) => !exists || exists.has(pf))
        .slice(0, hint.maxFiles || 40);
      const shards = new Map(await Promise.all(prefixes.map(async (pf) => [pf, await getK(pf)])));
      const hit = findProducer(shards, text, hint);
      if (!hit) return null;
      const idx = hit.p[0];
      const wines = hit.p[5] ? ((await fetchJson(`w/${shardOf(idx)}.json`).catch(() => ({})))[idx] || []) : [];
      const wine = pickWine(wines, text, hit.p[1]);
      return worldResult({ meta: m, p: hit.p, wines, wine, text }, ctx);
    },
  };
}

/**
 * 생산자의 와인 중 글자와 가장 잘 맞는 것 (없으면 null)
 * 생산자 이름의 단어("Zind Humbrecht"의 zind)는 세지 않음 — 그 와인이 아니어도 라벨에 늘 있으니까
 */
export function pickWine(wines, text, producer = '') {
  const own = new Set(nameKey(producer).split(' '));
  const tset = new Set(nameKey(text).split(' '));
  let best = null;
  for (const w of wines || []) {
    const toks = [...new Set(nameKey(w[0]).split(' '))].filter((t) => t.length >= 3 && !GENERIC.has(t) && !own.has(t));
    if (!toks.length) continue;
    const hit = toks.filter((t) => tset.has(t)).length;
    if (!hit) continue;
    const score = hit / toks.length + hit * 0.25;
    if (!best || score > best.score) best = { w, score };
  }
  if (best && best.score >= 0.75) return best.w;
  // 못 골랐는데 생산자 이름을 그대로 쓴 와인이 하나뿐이면 대표 와인으로 ("Château Margaux" → 그랑 뱅)
  const core = coreKey(producer);
  const flagship = core ? (wines || []).filter((w) => coreKey(w[0]).startsWith(core)) : [];
  return flagship.length === 1 ? flagship[0] : null;
}

const top = (counts, n) =>
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);

/** 와인을 못 고르면 생산자의 와인 전체로 요약 (주로 만드는 종류·품종·음식) */
export function summarizeWines(wines) {
  const types = new Map();
  const grapes = new Map();
  const foods = new Map();
  const abvs = [];
  let body = 0;
  for (const w of wines) {
    types.set(w[1], (types.get(w[1]) || 0) + 1);
    for (const g of w[2] || []) grapes.set(g, (grapes.get(g) || 0) + 1);
    for (const f of w[3] || []) foods.set(f, (foods.get(f) || 0) + 1);
    if (w[4]) abvs.push(w[4]);
    body += w[5] || 0;
  }
  abvs.sort((a, b) => a - b);
  return {
    type: top(types, 1)[0] || 'r',
    types: top(types, 3),
    grapes: top(grapes, 3),
    foods: top(foods, 4),
    abv: abvs.length ? abvs[Math.floor(abvs.length / 2)] : 0,
    body: wines.length ? Math.round(body / wines.length) : 0,
  };
}


/**
 * 찾은 생산자(와 와인)로 결과 만들기 — AI 결과와 같은 모양
 * ctx: { categories: CATEGORY_BY_ID }
 */
export function worldResult({ meta, p, wines = [], wine = null, text = '' }, ctx = {}) {
  const data = meta;
  const [, name, cat, country = '', region = ''] = p;
  const place = [country, region].filter(Boolean).join(' ');
  const category = ctx.categories?.[cat];
  const vintage = (String(text).match(/\b(19[5-9]\d|20[0-2]\d)\b/) || [])[1];
  const labelText = String(text).replace(/\s+/g, ' ').trim().slice(0, 300);

  if (cat === 'wine' && wines.length) {
    const sum = wine ? null : summarizeWines(wines);
    const type = wine ? wine[1] : sum.type;
    const [typeKo, kind] = WINE_TYPES[type] || WINE_TYPES.r;
    const grapes = (wine ? wine[2] : sum.grapes).map((i) => grapeKo(data.grapes[i])).filter(Boolean);
    const foods = (wine ? wine[3] : sum.foods).map((i) => HARMONIZE_KO[data.harmonize[i]] || data.harmonize[i]).filter(Boolean);
    const abv = wine ? wine[4] : sum.abv;
    const body = wine ? wine[5] : sum.body;
    const acid = wine ? wine[6] : 0;
    const wineRegion = wine && data.regions[wine[7]] ? data.regions[wine[7]] : region;
    const serve = SERVE[kind] || SERVE.red;
    const wineName = wine ? (nameKey(wine[0]).includes(nameKey(name)) ? wine[0] : `${name} ${wine[0]}`) : name;
    const regionKo = REGIONS.find((r) => r.re.test(nameKey(wineRegion)));
    const regionCard = findCard(category, regionKo?.ko);
    const grapeCard = grapes[0] ? findCard(category, grapes[0]) : null;
    const types = wine ? '' : sum.types.map((t) => WINE_TYPES[t]?.[0]).filter(Boolean).join('·');
    const desc = [
      `${[country, wineRegion].filter(Boolean).join(' ')}${wineRegion || country ? '의 ' : ''}${name}에서 만드는 ${wine ? `${typeKo} 와인이에요.` : `와인이에요. 주로 ${types} 와인을 만들어요.`}`,
      grapes.length ? `주 품종: ${grapes.join(', ')}.` : '',
      body ? `${BODY_KO[body]} 바디${acid ? `에 산도가 ${ACID_KO[acid]} 편이에요.` : '예요.'}` : '',
      regionCard ? `${regionCard.name}: ${strip(regionCard.desc)}` : '',
      grapeCard ? `${grapeCard.name}: ${strip(grapeCard.desc)}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const others = wines
      .filter((w) => w !== wine)
      .slice(0, 3)
      .map((w) => ({ name: nameKey(w[0]).includes(nameKey(name)) ? w[0] : `${name} ${w[0]}`, why: `같은 생산자의 ${WINE_TYPES[w[1]]?.[0] || ''} 와인` }));
    return normalizeResult({
      is_alcohol: true,
      confidence: wine ? 'medium' : 'low',
      confidence_note: `세계 와인 데이터(X-Wines)에서 찾은 "${wineName}" 정보로 정리했어요.${wine ? '' : ' 정확한 와인은 못 골라서 이 생산자의 와인 전체를 요약했어요.'} 빈티지·가격은 라벨과 판매처에서 확인하세요.`,
      label_text: labelText,
      name_ko: wineName,
      name_original: wineName,
      producer: name,
      category: 'wine',
      style: [`${typeKo} 와인`, grapes.slice(0, 2).join(' · ')].filter(Boolean).join(' · '),
      country,
      region: wineRegion,
      ingredients: grapes.join(', '),
      age_or_vintage: vintage ? `${vintage} 빈티지` : '',
      abv: abv ? `${abv}%` : '',
      volume: '',
      summary: desc.split('. ')[0].replace(/\.?$/, '.'),
      description: desc,
      tasting: { nose: '', palate: body ? `${BODY_KO[body]} 바디${acid ? `, 산도 ${ACID_SHORT[acid]}` : ''}` : '', finish: '' },
      sweetness: kind === 'sweet' ? 5 : kind === 'fortified' ? 4 : kind === 'sparkling' || kind === 'rose' ? 2 : 1,
      body: body || 3,
      how_to_drink: { temperature: serve.temperature, glass: serve.glass, methods: [...serve.methods], tips: '' },
      food_pairing: [...new Set([...foods.slice(0, 4), ...(KOREAN_FOOD[kind] || [])])],
      price: categoryPrice('wine', '와인'),
      where_to_buy: '',
      similar: others,
      storage: '',
      fun_fact: '',
      search_query: wineName,
    });
  }

  // 와인 정보가 없는 생산자 (위키데이터의 와이너리·양조장·증류소): 종류의 일반 설명
  const catName = category?.name || '술';
  const word = { wine: '와이너리예요.', beer: '맥주 양조장이에요.', sake: '사케 양조장이에요.' }[cat] || `${catName} 증류소예요.`;
  const kind = cat === 'wine' ? 'red' : cat;
  const serve = SERVE[kind] || SERVE.liqueur;
  return normalizeResult({
    is_alcohol: true,
    confidence: 'low',
    confidence_note: `세계 술 데이터(위키데이터)에서 "${name}"을(를) 찾았어요. 이곳 제품의 자세한 정보는 없어서 ${catName}의 일반적인 마시는 법과 가격대를 보여 드려요.`,
    label_text: labelText,
    name_ko: name,
    name_original: name,
    producer: name,
    category: cat,
    style: `${catName} 생산자`,
    country,
    region,
    summary: `${place ? `${place}에 있는 ` : ''}${word}`,
    description: `${place ? `${place}에 있는 ` : ''}${word} 이곳 제품의 자세한 정보는 없어서 ${catName}의 일반적인 설명을 함께 보여 드려요.${category?.oneLine ? ` ${strip(category.oneLine)}` : ''}`,
    tasting: { nose: '', palate: '', finish: '' },
    sweetness: 2,
    body: 3,
    how_to_drink: { temperature: serve.temperature, glass: serve.glass, methods: [...serve.methods], tips: '' },
    food_pairing: [],
    price: categoryPrice(cat, catName),
    similar: [],
    search_query: name,
  });
}

/** 와인 조각 파일 번호 */
export const shardOf = (idx) => Math.floor(idx / SHARD_SIZE);
