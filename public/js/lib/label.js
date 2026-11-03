// 라벨 글자(OCR)·바코드 정보로 술 알아보기 — 유료 AI 없이 (브라우저·Node 공통, 테스트도 이 파일로)
//
// 1) extractAttributes: 도수·용량·숙성 연수·빈티지·종류·포도 품종·지역을 글자에서 뽑음
// 2) matchBrands: 브랜드 사전(content/brands.js)과 맞춤 (OCR 오타를 조금 봐줌)
// 3) analyzeLabel: 위 결과와 백과 콘텐츠로 AI 결과와 같은 모양의 설명을 만듦
import { normalizeResult } from './identify.js';

// ---------- 글자 다듬기 ----------

/** 소문자, 악센트 제거(é→e), 기호를 공백으로. 한글·한자·가나는 남김 */
export function prepText(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC') // 한글 음절은 다시 합침 (NFKD 가 자모로 쪼개기 때문)
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    // 한국어 표기 흔들림 맞추기
    .replace(/샤또/g, '샤토')
    .replace(/꼬냑/g, '코냑')
    .replace(/칼루아/g, '깔루아')
    // 여러 제품에 같이 찍히는 회사 이름은 브랜드로 보지 않음 ("하이트진로"의 하이트·진로)
    .replace(/하이트\s*진로|hite\s*jinro/g, ' ')
    .replace(/[^a-z0-9가-힣぀-ヿ一-鿿%.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const hasCjk = (s) => /[가-힣぀-ヿ一-鿿]/.test(s);

/** 레벤슈타인 거리 (OCR 오타 허용용, max 넘으면 일찍 끝냄) */
export function editDistance(a, b, max = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// ---------- 속성 뽑기 ----------

/** 종류·스타일 단서. cat: 술 종류, style: 화면에 보일 말, kind: 와인 세부(마시는 법 고르기용) */
export const STYLE_HINTS = [
  { re: /single\s*malt|싱글\s*몰트/, cat: 'whisky', style: '싱글 몰트' },
  { re: /blended\s*malt/, cat: 'whisky', style: '블렌디드 몰트' },
  { re: /blended\s*(scotch\s*)?whisk/, cat: 'whisky', style: '블렌디드' },
  { re: /scotch|스카치/, cat: 'whisky', style: '스카치' },
  { re: /bourbon|버번/, cat: 'whisky', style: '버번' },
  { re: /tennessee/, cat: 'whisky', style: '테네시 위스키' },
  { re: /\brye\s*whisk/, cat: 'whisky', style: '라이 위스키' },
  { re: /irish\s*whisk/, cat: 'whisky', style: '아이리시' },
  { re: /japanese\s*whisk|ウイスキー|ウヰスキー/, cat: 'whisky', style: '재패니즈' },
  { re: /whisk(e)?y|위스키/, cat: 'whisky', style: '' },
  { re: /cask\s*strength/, cat: 'whisky', style: '캐스크 스트렝스' },
  { re: /sherry\s*(cask|oak|wood)/, cat: 'whisky', style: '셰리 캐스크' },
  { re: /\bpeat(ed|y)?\b|피트/, cat: 'whisky', style: '피트(스모키)', smoky: true },
  { re: /cognac|코냑|꼬냑/, cat: 'brandy', style: '코냑' },
  { re: /armagnac/, cat: 'brandy', style: '아르마냑' },
  { re: /calvados/, cat: 'brandy', style: '칼바도스' },
  { re: /brandy|브랜디/, cat: 'brandy', style: '' },
  { re: /\bv\.?\s?s\.?\s?o\.?\s?p\b/, cat: 'brandy', style: 'VSOP' },
  { re: /\bx\.?\s?o\b/, cat: 'brandy', style: 'XO' },
  { re: /vodka|보드카|водка/, cat: 'vodka', style: '' },
  { re: /london\s*dry/, cat: 'gin', style: '런던 드라이 진' },
  { re: /\bgin\b|드라이\s*진/, cat: 'gin', style: '' },
  { re: /\brum\b|\brhum\b|\bron\b(?!\s*de)|(^|\s)럼(\s|$)/, cat: 'rum', style: '' },
  { re: /tequila|데킬라|테킬라/, cat: 'tequila', style: '' },
  { re: /mezcal|메스칼/, cat: 'tequila', style: '메스칼' },
  { re: /reposado/, cat: 'tequila', style: '레포사도' },
  { re: /a[nñ]ejo/, cat: 'tequila', style: '아녜호' },
  { re: /100\s*%?\s*(de\s*)?agave|agave/, cat: 'tequila', style: '100% 아가베' },
  { re: /liqueur|liquore|리큐르/, cat: 'liqueur', style: '' },
  { re: /cream\s*liqueur|irish\s*cream/, cat: 'liqueur', style: '크림 리큐르' },
  { re: /champagne|샴페인/, cat: 'wine', style: '샴페인', kind: 'sparkling' },
  { re: /cremant/, cat: 'wine', style: '크레망', kind: 'sparkling' },
  { re: /prosecco|프로세코/, cat: 'wine', style: '프로세코', kind: 'sparkling' },
  { re: /\bcava\b|카바/, cat: 'wine', style: '카바', kind: 'sparkling' },
  { re: /spumante|sparkling|mousseux|espumoso|frizzante|스파클링/, cat: 'wine', style: '스파클링', kind: 'sparkling' },
  { re: /\bbrut\b|브뤼/, cat: 'wine', style: '브뤼', kind: 'sparkling' },
  { re: /moscato d.?asti|asti\b/, cat: 'wine', style: '모스카토 다스티', kind: 'sweet' },
  { re: /\bport(o)?\b|포트\s*와인/, cat: 'wine', style: '포트(주정강화)', kind: 'fortified' },
  { re: /sherry|jerez|셰리/, cat: 'wine', style: '셰리', kind: 'fortified' },
  { re: /rose\b|rosado|rosato|로제/, cat: 'wine', style: '로제', kind: 'rose' },
  { re: /grand\s*cru|그랑\s*크뤼/, cat: 'wine', style: '그랑 크뤼' },
  { re: /premier\s*cru|1er\s*cru/, cat: 'wine', style: '프르미에 크뤼' },
  { re: /appellation|controlee|\baoc\b|\baop\b|\bdocg\b|\bdoc\b|\bdoca\b|\bigt\b/, cat: 'wine', style: '' },
  { re: /chateau|domaine|bodega|tenuta|weingut|cantina|vina\b|vineyards?|winery|샤또|도멘/, cat: 'wine', style: '' },
  { re: /gran\s*reserva/, cat: 'wine', style: '그란 레세르바' },
  { re: /\breserva\b|\briserva\b/, cat: 'wine', style: '레세르바' },
  { re: /\bwine\b|\bvin\b|\bvino\b|\bwein\b|와인|ワイン/, cat: 'wine', style: '' },
  { re: /junmai\s*daiginjo|純米大吟醸/, cat: 'sake', style: '준마이 다이긴조' },
  { re: /junmai\s*ginjo|純米吟醸/, cat: 'sake', style: '준마이 긴조' },
  { re: /daiginjo|大吟醸/, cat: 'sake', style: '다이긴조' },
  { re: /ginjo|吟醸/, cat: 'sake', style: '긴조' },
  { re: /junmai|純米/, cat: 'sake', style: '준마이' },
  { re: /honjozo|本醸造/, cat: 'sake', style: '혼조조' },
  { re: /nigori|にごり/, cat: 'sake', style: '니고리' },
  { re: /nihonshu|日本酒|清酒|\bsake\b|사케/, cat: 'sake', style: '' },
  { re: /shochu|焼酎/, cat: 'sake', style: '쇼추' },
  { re: /umeshu|梅酒|매실주/, cat: 'sake', style: '우메슈(매실주)' },
  { re: /\bbeer\b|biere|\bbier\b|cerveza|맥주|ビール/, cat: 'beer', style: '' },
  { re: /발포주|happoshu|発泡酒/, cat: 'beer', style: '발포주' },
  { re: /\blager\b|라거/, cat: 'beer', style: '라거' },
  { re: /pilsner|\bpils\b|필스너/, cat: 'beer', style: '필스너' },
  { re: /\bipa\b|india\s*pale/, cat: 'beer', style: 'IPA' },
  { re: /\bstout\b|스타우트/, cat: 'beer', style: '스타우트' },
  { re: /weiss|weizen|witbier|wheat\s*beer|blanche|밀맥주/, cat: 'beer', style: '밀맥주' },
  { re: /\bpale\s*ale\b|\bale\b|에일/, cat: 'beer', style: '에일' },
  { re: /막걸리|탁주|makgeolli/, cat: 'traditional', style: '막걸리' },
  { re: /약주|청주/, cat: 'traditional', style: '약주·청주' },
  { re: /증류식\s*소주/, cat: 'traditional', style: '증류식 소주' },
  { re: /과실주|복분자|오미자/, cat: 'traditional', style: '과실주' },
  { re: /전통주|민속주|지역특산주/, cat: 'traditional', style: '' },
  { re: /희석식\s*소주|(^|\s)소주(\s|$)|\bsoju\b/, cat: 'soju', style: '' },
  { re: /白酒|高粱|고량주|백주|baijiu|白干/, cat: 'baijiu', style: '' },
];

/** 포도 품종 (와인) — 이름은 백과 와인 글의 품종 카드와 같게 */
export const GRAPES = [
  { re: /cabernet\s*sauvignon|카베르네\s*소비뇽/, ko: '카베르네 소비뇽', sweet: 2, body: 4, kind: 'red' },
  { re: /\bmerlot\b|메를로/, ko: '메를로', sweet: 2, body: 3, kind: 'red' },
  { re: /pinot\s*noir|피노\s*누아/, ko: '피노 누아', sweet: 2, body: 2, kind: 'red' },
  { re: /\bshiraz\b|\bsyrah\b|쉬라즈|시라/, ko: '쉬라즈(시라)', sweet: 2, body: 4, kind: 'red' },
  { re: /\bmalbec\b|말벡/, ko: '말벡', sweet: 2, body: 4, kind: 'red' },
  { re: /sangiovese|chianti|brunello|산지오베제|키안티/, ko: '산지오베제', sweet: 2, body: 3, kind: 'red' },
  { re: /nebbiolo|barolo|barbaresco|네비올로|바롤로/, ko: '네비올로', sweet: 1, body: 4, kind: 'red' },
  { re: /tempranillo|템프라니요/, ko: '템프라니요', sweet: 2, body: 3, kind: 'red' },
  { re: /zinfandel|primitivo|진판델/, ko: '진판델', sweet: 3, body: 4, kind: 'red' },
  { re: /carmenere|카르메네르/, ko: '카르메네르', sweet: 2, body: 3, kind: 'red' },
  { re: /grenache|garnacha|그르나슈/, ko: '그르나슈', sweet: 2, body: 3, kind: 'red' },
  { re: /chardonnay|chablis|샤르도네|샤블리/, ko: '샤르도네', sweet: 2, body: 3, kind: 'white' },
  { re: /sauvignon\s*blanc|sancerre|소비뇽\s*블랑/, ko: '소비뇽 블랑', sweet: 1, body: 2, kind: 'white' },
  { re: /riesling|리슬링/, ko: '리슬링', sweet: 3, body: 2, kind: 'white' },
  { re: /moscato|muscat|moscatel|모스카토/, ko: '모스카토(뮈스카)', sweet: 5, body: 1, kind: 'sweet' },
  { re: /pinot\s*grigio|pinot\s*gris|피노\s*그리/, ko: '피노 그리지오', sweet: 2, body: 2, kind: 'white' },
  { re: /gewurztraminer|게뷔르츠/, ko: '게뷔르츠트라미너', sweet: 3, body: 3, kind: 'white' },
];

/** 지역 — ko 는 백과의 지역 카드 이름과 맞춰 설명을 가져옴 */
export const REGIONS = [
  { re: /speyside|스페이사이드/, ko: '스페이사이드', cat: 'whisky', country: '스코틀랜드' },
  { re: /\bislay\b|아일라/, ko: '아일라', cat: 'whisky', country: '스코틀랜드' },
  { re: /highland|하이랜드/, ko: '하이랜드', cat: 'whisky', country: '스코틀랜드' },
  { re: /lowland|로우랜드/, ko: '로우랜드', cat: 'whisky', country: '스코틀랜드' },
  { re: /campbeltown|캠벨타운/, ko: '캠벨타운', cat: 'whisky', country: '스코틀랜드' },
  { re: /kentucky|켄터키/, ko: '켄터키', cat: 'whisky', country: '미국' },
  { re: /bordeaux|medoc|pauillac|margaux|saint.?emilion|pomerol|보르도/, ko: '보르도', cat: 'wine', country: '프랑스' },
  { re: /bourgogne|burgundy|부르고뉴/, ko: '부르고뉴', cat: 'wine', country: '프랑스' },
  { re: /rhone|chateauneuf|론\b/, ko: '론', cat: 'wine', country: '프랑스' },
  { re: /\bloire\b/, ko: '루아르', cat: 'wine', country: '프랑스' },
  { re: /alsace/, ko: '알자스', cat: 'wine', country: '프랑스' },
  { re: /toscana|tuscany|토스카나/, ko: '토스카나', cat: 'wine', country: '이탈리아' },
  { re: /piemonte|piedmont|피에몬테/, ko: '피에몬테', cat: 'wine', country: '이탈리아' },
  { re: /veneto|valpolicella|amarone/, ko: '베네토', cat: 'wine', country: '이탈리아' },
  { re: /\brioja\b|리오하/, ko: '리오하', cat: 'wine', country: '스페인' },
  { re: /ribera\s*del\s*duero/, ko: '리베라 델 두에로', cat: 'wine', country: '스페인' },
  { re: /\bnapa\b|나파/, ko: '나파 밸리', cat: 'wine', country: '미국' },
  { re: /sonoma|california|캘리포니아/, ko: '캘리포니아', cat: 'wine', country: '미국' },
  { re: /barossa|바로사/, ko: '바로사', cat: 'wine', country: '호주' },
  { re: /south\s*eastern\s*australia|australia|호주/, ko: '호주', cat: 'wine', country: '호주' },
  { re: /marlborough|말보로/, ko: '말보로', cat: 'wine', country: '뉴질랜드' },
  { re: /mendoza|멘도사/, ko: '멘도사', cat: 'wine', country: '아르헨티나' },
  { re: /\bmosel\b|모젤/, ko: '모젤', cat: 'wine', country: '독일' },
  { re: /\bdouro\b/, ko: '도우루', cat: 'wine', country: '포르투갈' },
  { re: /maipo|colchagua|casablanca|valle\s*central|central\s*valley|chile|칠레/, ko: '칠레', cat: 'wine', country: '칠레' },
];

/** 라벨 글자에서 도수·용량·숙성·빈티지·종류 단서 */
export function extractAttributes(rawText) {
  const t = prepText(rawText);
  const out = { abv: null, volumeMl: null, age: null, vintage: null, styles: [], grapes: [], regions: [], votes: {}, smoky: false, kind: null };

  const abv = t.match(/(?:alc\.?\s*)?(\d{1,2}(?:[.,]\d{1,2})?)\s?%\s?(?:alc|vol|abv)?/) || t.match(/(\d{1,2}(?:[.,]\d)?)\s?(?:도|degrees)/);
  if (abv) {
    const n = Number(abv[1].replace(',', '.'));
    if (n >= 3 && n <= 70) out.abv = n;
  }
  const ml = t.match(/(\d{2,4})\s?ml\b/);
  const cl = t.match(/\b(\d{2,3})\s?cl\b/);
  const l = t.match(/\b(\d(?:[.,]\d{1,3})?)\s?(?:l|ltr|litre|liter)\b/);
  if (ml) out.volumeMl = Number(ml[1]);
  else if (cl) out.volumeMl = Number(cl[1]) * 10;
  else if (l) out.volumeMl = Math.round(Number(l[1].replace(',', '.')) * 1000);
  if (out.volumeMl && (out.volumeMl < 50 || out.volumeMl > 5000)) out.volumeMl = null;

  const age = t.match(/(?:aged\s*)?(\d{1,2})\s*(?:years?|yrs?|yo\b|y\.o|ans\b|anos\b|anni\b|jahre|년)/);
  if (age) {
    const n = Number(age[1]);
    if (n >= 3 && n <= 60) out.age = n;
  }
  // 빈티지: 설립 연도("since 1887", "est. 1824")는 빼고
  for (const m of t.matchAll(/(?<!since\s|est\s|est\.\s|established\s|founded\s|depuis\s|anno\s|desde\s)\b(19[5-9]\d|20[0-2]\d)\b(?!\s?ml)/g)) {
    const y = Number(m[1]);
    if (y <= new Date().getFullYear()) {
      out.vintage = y;
      break;
    }
  }

  for (const h of STYLE_HINTS) {
    if (!h.re.test(t)) continue;
    out.votes[h.cat] = (out.votes[h.cat] || 0) + (h.style ? 2 : 1);
    if (h.style && !out.styles.includes(h.style)) out.styles.push(h.style);
    if (h.smoky) out.smoky = true;
    if (h.kind && !out.kind) out.kind = h.kind;
  }
  for (const g of GRAPES) {
    if (g.re.test(t)) {
      out.grapes.push(g);
      out.votes.wine = (out.votes.wine || 0) + 2;
      if (!out.kind) out.kind = g.kind;
    }
  }
  for (const r of REGIONS) {
    if (r.re.test(t)) {
      out.regions.push(r);
      out.votes[r.cat] = (out.votes[r.cat] || 0) + 1;
    }
  }
  return out;
}

/** 가장 많이 나온 술 종류 */
export function topCategory(votes) {
  const best = Object.entries(votes || {}).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

// ---------- 브랜드 맞추기 ----------

function prepName(name) {
  return prepText(name).replace(/[%.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * 글자 속 브랜드 찾기 → [{ brand, score, matched }] (점수 높은 순)
 * 짧은 이름은 정확히 같은 단어여야 하고, 긴 이름은 OCR 오타 1~2글자를 봐줌
 */
/** 한글 음절의 [초성, 중성] */
function jamo(ch) {
  const code = ch.charCodeAt(0) - 0xac00;
  return code >= 0 && code < 11172 ? [Math.floor(code / 588), Math.floor((code % 588) / 28)] : null;
}

/**
 * text 안에 name 과 한 글자만 다른 부분이 있는지 (4글자 이상 한글 이름).
 * 틀린 글자는 초성이나 중성이 같아야 함 (OCR 은 모양이 비슷한 글자로 잘못 읽음)
 */
export function nearHangul(text, name) {
  const n = name.length;
  for (let i = 0; i + n <= text.length; i++) {
    let diff = -1;
    let bad = false;
    for (let k = 0; k < n; k++) {
      if (text[i + k] === name[k]) continue;
      if (diff >= 0) {
        bad = true;
        break;
      }
      diff = k;
    }
    if (bad || diff < 0) continue;
    const a = jamo(text[i + diff]);
    const b = jamo(name[diff]);
    if (a && b && (a[0] === b[0] || a[1] === b[1])) return true;
  }
  return false;
}

export function matchBrands(rawText, brands, votes = null) {
  const text = prepName(rawText);
  if (!text) return [];
  const tokens = text.split(' ');
  const compact = text.replace(/\s/g, '');
  const hits = [];
  for (const brand of brands) {
    let best = 0;
    let matched = '';
    for (const raw of [...brand.names, brand.ko]) {
      const name = prepName(raw);
      if (name.length < 2) continue;
      let score = 0;
      if (hasCjk(name)) {
        const n = name.replace(/\s/g, '');
        if (n.length >= 2 && compact.includes(n)) {
          // 한글 2글자(진로·장수 등)는 다른 글에도 나올 수 있어 약하게, 한자·가나·3글자 이상은 확실하게
          const kanji = /[぀-ヿ一-鿿]/.test(n);
          score = n.length >= 3 ? n.length * 5 : kanji ? 14 : 10;
        } else if (n.length >= 4 && /^[가-힣]+$/.test(n) && nearHangul(compact, n)) {
          // OCR 이 한 글자를 비슷한 글자로 잘못 읽은 경우 ("략프로익" → 라프로익)
          score = n.length * 3;
        }
      } else {
        const words = name.split(' ');
        const joined = words.join('');
        if (joined.length < 4) {
          // 아주 짧은 이름(카스 등)은 단어가 정확히 같을 때만
          if (words.length === 1 && tokens.includes(joined)) score = joined.length * 2;
        } else {
          const tolerance = joined.length >= 10 ? 2 : joined.length >= 6 ? 1 : 0;
          for (let i = 0; i + words.length <= tokens.length; i++) {
            const window = tokens.slice(i, i + words.length).join('');
            const d = window === joined ? 0 : editDistance(window, joined, tolerance);
            if (d <= tolerance) {
              score = Math.max(score, joined.length * (d === 0 ? 3 : 2));
              if (d === 0) break;
            }
          }
          // 띄어쓰기를 OCR 이 놓친 경우 ("johnniewalker")
          if (!score && words.length > 1 && compact.includes(joined)) score = joined.length * 2.5;
        }
      }
      if (score > best) {
        best = score;
        matched = raw;
      }
    }
    if (best > 0) {
      // 글자 속 종류 단서와 브랜드 종류가 다르면 점수를 깎음 (와인 라벨의 "terra" 를 맥주로 오해하지 않게)
      const top = votes ? topCategory(votes) : null;
      if (top && top !== brand.cat && (votes[top] || 0) >= 2 && !(votes[brand.cat] > 0)) best *= 0.4;
      // 같은 종류 단서가 있으면 조금 올림 ("청하" + "청주", "한맥" + "맥주" 처럼 두 글자 브랜드도 사진에서 알아보게)
      else if (votes?.[brand.cat] > 0) best *= 1.25;
      hits.push({ brand, score: best, matched });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits;
}

// ---------- 설명 만들기 ----------

const TIER_RANGES = {
  whisky: { 1: [20000, 40000], 2: [40000, 90000], 3: [90000, 200000], 4: [200000, 600000] },
  brandy: { 1: [20000, 50000], 2: [50000, 90000], 3: [90000, 200000], 4: [250000, 700000] },
  wine: { 1: [8000, 25000], 2: [25000, 60000], 3: [60000, 150000], 4: [200000, 1500000] },
  sake: { 1: [10000, 30000], 2: [30000, 70000], 3: [70000, 150000], 4: [150000, 500000] },
  default: { 1: [10000, 35000], 2: [35000, 70000], 3: [70000, 150000], 4: [150000, 500000] },
  beer: { 1: [1800, 4500], 2: [4500, 12000] }, // 2 = 트라피스트 등 수입 고급 맥주 (330ml)
  cocktail: { 1: [2000, 5000], 2: [5000, 15000] }, // 캔 하이볼·과일 RTD
  soju: { 1: [1200, 2000], 2: [10000, 30000] },
  traditional: { 1: [1500, 20000], 2: [20000, 60000], 3: [60000, 150000] },
};

/** 술 종류별 마시는 법 (백과 내용을 짧게) */
const SERVE = {
  red: { temperature: '16~18℃ (냉장고에 15~20분)', glass: '볼이 넓은 레드 와인잔', methods: ['따고 20~30분 두면 부드러워져요', '잔은 1/3 정도만 채우기'] },
  white: { temperature: '8~12℃ (차갑게)', glass: '화이트 와인잔', methods: ['차갑게 해서 바로', '남으면 마개 막아 냉장 2~3일'] },
  sparkling: { temperature: '6~8℃ (아주 차갑게)', glass: '플루트 잔 또는 화이트 와인잔', methods: ['병을 45도로 기울여 천천히 따기', '마시기 직전까지 냉장'] },
  sweet: { temperature: '6~8℃ (아주 차갑게)', glass: '화이트 와인잔', methods: ['디저트·과일과 함께', '도수가 낮아 가볍게'] },
  rose: { temperature: '8~10℃', glass: '화이트 와인잔', methods: ['차갑게, 식사와 함께'] },
  fortified: { temperature: '14~16℃', glass: '작은 와인잔', methods: ['식후에 조금씩', '치즈·초콜릿과 함께'] },
  whisky: { temperature: '상온', glass: '튤립 모양 잔(글렌캐런) 또는 록 글라스', methods: ['스트레이트로 조금씩', '물 2~3방울 넣어 향 열기', '하이볼 (위스키 1 : 탄산수 3~4)'] },
  brandy: { temperature: '상온', glass: '튤립·스니프터 잔', methods: ['손으로 잔을 감싸 데우며 천천히', 'VS 는 진저에일·토닉 하이볼로'] },
  vodka: { temperature: '냉동실에서 차갑게', glass: '작은 샷 잔 / 하이볼 잔', methods: ['차갑게 한 잔', '오렌지 주스·토닉과 섞기'] },
  gin: { temperature: '차갑게', glass: '하이볼 잔', methods: ['진토닉 (진 1 : 토닉 3, 라임)', '네그로니·마티니'] },
  rum: { temperature: '상온 또는 얼음', glass: '하이볼 잔', methods: ['럼콕 (콜라 + 라임)', '모히토'] },
  tequila: { temperature: '상온', glass: '작은 잔', methods: ['100% 아가베는 천천히', '마가리타·팔로마'] },
  liqueur: { temperature: '얼음 또는 차갑게', glass: '록 글라스', methods: ['얼음에 그대로', '우유·탄산수·주스와 섞기'] },
  beer: { temperature: '4~7℃ (아주 차갑게)', glass: '맥주잔', methods: ['잔을 기울여 따르다 마지막에 세워 거품 2~3cm'] },
  sake: { temperature: '차갑게(긴조) 또는 데워서(준마이·혼조조)', glass: '작은 잔 또는 와인잔', methods: ['향긋한 사케는 차갑게', '진한 사케는 40℃ 정도로 데워서'] },
  traditional: { temperature: '차갑게 (막걸리 4~8℃)', glass: '사발·작은 잔', methods: ['막걸리는 윗술 먼저 맛보고 흔들어 섞기', '증류식 소주는 스트레이트·온더록'] },
  soju: { temperature: '아주 차갑게', glass: '소주잔', methods: ['물과 함께 천천히', '소맥·토닉 소주'] },
  baijiu: { temperature: '상온', glass: '작은 잔', methods: ['조금씩 향을 맡으며', '기름진 중식과 함께'] },
};

const strip = (html) => String(html || '').replace(/<[^>]+>/g, '');

function findCard(category, koName) {
  if (!category || !koName) return null;
  for (const sec of category.sections || []) {
    for (const card of sec.cards || []) {
      if (card.name === koName || card.name.startsWith(koName) || koName.startsWith(card.name)) return card;
    }
  }
  return null;
}

function pairFoods(category, hints) {
  const sec = (category?.sections || []).find((s) => s.pairs);
  if (!sec) return [];
  const hit = sec.pairs.filter((p) => hints.some((h) => h && p.match.includes(h)));
  const rest = sec.pairs.filter((p) => !hit.includes(p));
  return [...hit, ...rest].slice(0, Math.max(3, hit.length)).map((p) => p.food);
}

function keepTip(category) {
  const sec = (category?.sections || []).find((s) => s.id === 'keep');
  return sec?.list?.[0] ? strip(sec.list[0]) : '';
}

function originParts(origin = '') {
  const [country, ...rest] = origin.split('·').map((s) => s.trim());
  return { country: country || '', region: rest.join(' · ') };
}

function latinName(brand) {
  const n = brand?.names?.find((x) => /^[a-z0-9 &'.-]+$/i.test(x)) || '';
  return n.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Open Food Facts 분류 → 술 종류 */
export function categoryFromOff(tags = []) {
  const t = tags.join(' ');
  if (/wines?\b|champagne|sparkling-wine|vins/.test(t)) return 'wine';
  if (/whisk/.test(t)) return 'whisky';
  if (/cognac|brand(y|ies)|armagnac/.test(t)) return 'brandy';
  if (/vodka/.test(t)) return 'vodka';
  if (/\bgins?\b|en:gin/.test(t)) return 'gin';
  if (/rums?\b|en:rum/.test(t)) return 'rum';
  if (/tequila|mezcal/.test(t)) return 'tequila';
  if (/liqueur/.test(t)) return 'liqueur';
  if (/beers?\b|lager|ales?\b/.test(t)) return 'beer';
  if (/sake/.test(t)) return 'sake';
  if (/soju/.test(t)) return 'soju';
  if (/makgeolli|rice-wines/.test(t)) return 'traditional';
  return null;
}

/** 앱의 대표 제품 목록에서 같은 제품 찾기 (브랜드 + 숙성 연수) */
function catalogProduct(products, brand, attrs, text, cat) {
  if (!products?.length) return null;
  const t = prepName(text).replace(/\s/g, '');
  const brandKo = brand ? prepName(brand.ko).replace(/\s/g, '') : '';
  const candidates = products.filter((p) => {
    if (cat && p.cat !== cat) return false;
    const names = [p.name, p.en || '', ...(p.aliases || [])].map((n) => prepName(n).replace(/\s/g, ''));
    if (brand) {
      return (
        (brandKo.length >= 2 && names.some((n) => n.includes(brandKo))) ||
        brand.names.some((b) => {
          const bn = prepName(b).replace(/\s/g, '');
          return bn.length >= 4 && names.some((n) => n.includes(bn));
        })
      );
    }
    return names.some((n) => n.length >= 4 && t.includes(n));
  });
  if (!candidates.length) return null;
  if (attrs.age) {
    const withAge = candidates.filter((p) => new RegExp(`(^|\\D)${attrs.age}\\s*(년|years?)`, 'i').test(`${p.name} ${p.en}`));
    if (withAge.length === 1) return withAge[0];
    if (withAge.length) candidates.splice(0, candidates.length, ...withAge);
  }
  if (candidates.length === 1) return candidates[0];
  // 여러 개면 라벨 글자와 겹치는 단어(블랙·레드·12 등)가 가장 많은 것, 비기면 고르지 않음
  const words = new Set(prepName(text).split(' ').filter((w) => w.length >= 3));
  const brandWords = new Set((brand ? [brand.ko, ...brand.names] : []).flatMap((n) => prepName(n).split(' ')));
  const scored = candidates
    .map((p) => ({ p, s: [...new Set(prepName(`${p.name} ${p.en || ''}`).split(' '))].filter((w) => w.length >= 3 && !brandWords.has(w) && words.has(w)).length }))
    .sort((x, y) => y.s - x.s);
  return scored[0].s > 0 && scored[0].s > (scored[1]?.s ?? -1) ? scored[0].p : null;
}

/**
 * 라벨 글자·바코드 정보 → AI 결과와 같은 모양의 설명
 * input: { text: OCR 글자 또는 검색어, off: Open Food Facts 제품, barcode, source: 'photo' | 'text' }
 * ctx: { brands, products, categories: id→글, buy: BUY_BY_CATEGORY }
 */
export function analyzeLabel({ text = '', off = null, barcode = null, source = 'photo' }, { brands = [], products = [], categories = {}, buy = {} }) {
  const offText = off ? [off.product_name, off.product_name_ko, off.product_name_en, off.brands, off.quantity].filter(Boolean).join(' ') : '';
  const all = `${text} ${offText}`;
  const attrs = extractAttributes(all);
  if (off?.quantity && !attrs.volumeMl) {
    const v = extractAttributes(off.quantity).volumeMl;
    if (v) attrs.volumeMl = v;
  }
  const hits = matchBrands(all, brands, attrs.votes);
  const minScore = source === 'text' ? 6 : 12; // 사진 OCR 은 잡음이 많아 더 확실할 때만
  const brand = hits[0]?.score >= minScore ? hits[0].brand : null;
  const offCat = off ? categoryFromOff(off.categories_tags) : null;
  const cat = brand?.cat || offCat || topCategory(attrs.votes);
  const category = categories[cat];
  const labelText = String(text).replace(/\s+/g, ' ').trim().slice(0, 400);

  if (!brand && !cat && !off) {
    return normalizeResult({
      is_alcohol: false,
      not_alcohol_reason:
        source === 'text'
          ? '브랜드 사전과 백과에서 이 이름을 찾지 못했어요. 영어 이름이나 다른 표기로 찾아보세요.'
          : '라벨 글자에서 술 이름이나 종류를 찾지 못했어요. 라벨이 정면으로 크게 보이게 다시 찍거나, 뒷면 한글 스티커를 찍어 보세요.',
      label_text: labelText,
    });
  }

  const product = catalogProduct(products, brand, attrs, all, cat);
  const grape = attrs.grapes[0];
  const region = attrs.regions[0];
  const kind = cat === 'wine' ? attrs.kind || (product && /스파클링|샴페인|카바/.test(product.sub) ? 'sparkling' : null) || grape?.kind || 'red' : cat;
  const serve = SERVE[kind] || SERVE[cat] || SERVE.liqueur;

  const age = attrs.age ? `${attrs.age}년` : '';
  const vintage = attrs.vintage && cat === 'wine' ? `${attrs.vintage} 빈티지` : '';
  const brandName = brand ? `${brand.ko}${age && cat !== 'wine' ? ` ${age}` : ''}` : '';
  // 브랜드를 모르면 지역·품종·스타일로 이름 붙이기 ("보르도 레드 와인")
  const kindWord = { red: '레드 와인', white: '화이트 와인', sparkling: '스파클링 와인', sweet: '스위트 와인', rose: '로제 와인', fortified: '주정강화 와인' };
  const guessName = cat === 'wine'
    ? [region?.ko, grape ? grape.ko.replace(/\(.*\)/, '') : '', kindWord[kind] || '와인'].filter(Boolean).join(' ')
    : [region?.ko, attrs.styles[0], category?.name].filter(Boolean).join(' ');
  const nameKo = product?.name || brandName || off?.product_name_ko || off?.product_name || `${guessName || category?.name || '술'} (생산자 확인 필요)`;
  const nameOriginal = off?.product_name || (brand ? `${latinName(brand)}${attrs.age && cat !== 'wine' ? ` ${attrs.age}` : ''}${attrs.vintage && cat === 'wine' ? ` ${attrs.vintage}` : ''}` : '');

  const origin = originParts(brand?.origin);
  const country = origin.country || region?.country || '';
  const regionName = origin.region || region?.ko || '';
  const styleParts = [brand?.style || product?.sub || '', ...attrs.styles.filter((s) => !(brand?.style || '').includes(s))].filter(Boolean);
  const style = [...new Set(styleParts)].slice(0, 3).join(' · ');

  // 설명: 브랜드 소개 + 지역·품종 카드 + 숙성/빈티지 뜻
  const regionCard = findCard(category, region?.ko || origin.region?.split('(')[0]);
  const grapeCard = grape ? findCard(category, grape.ko.replace(/\(.*\)/, '')) : null;
  const desc = [
    brand?.desc,
    !brand && off?.product_name ? `바코드로 찾은 제품: ${off.product_name}${off.brands ? ` (${off.brands})` : ''}.` : '',
    regionCard ? `${regionCard.name}: ${strip(regionCard.desc)}` : '',
    grapeCard ? `${grapeCard.name}: ${strip(grapeCard.desc)}` : '',
    attrs.age && cat !== 'wine' ? `${attrs.age}년은 병에 든 원액 중 가장 어린 것이 ${attrs.age}년 이상 숙성됐다는 뜻이에요.` : '',
    vintage ? `${attrs.vintage}년은 포도를 수확한 해(빈티지)예요.` : '',
  ].filter(Boolean);

  // 가격: 앱 제품 → 브랜드 가격대 → 모름
  let price = { krw_low: 0, krw_high: 0, basis: '', note: '' };
  if (product?.price) {
    price = { krw_low: product.price[0], krw_high: product.price[1], basis: `앱 제품 목록의 참고 가격대 (${product.name}, 대형마트·전문점 기준)`, note: '행사·창고형 마트·면세점에서 더 쌀 수 있어요.' };
  } else if (brand?.tier) {
    const ranges = TIER_RANGES[cat] || TIER_RANGES.default;
    const r = ranges[brand.tier] || ranges[1];
    if (r) price = { krw_low: r[0], krw_high: r[1], basis: `${brand.ko} 대표 제품 기준의 대략적인 가격대`, note: '숙성 연수·라인·용량에 따라 크게 달라요. 정확한 가격은 검색으로 확인하세요.' };
  }

  const similar = brand
    ? brands
        .filter((b) => b !== brand && b.cat === brand.cat)
        .map((b) => ({ b, s: (b.style === brand.style ? 2 : 0) + (b.origin === brand.origin ? 2 : originParts(b.origin).country === origin.country ? 1 : 0) + (b.tier && brand.tier && b.tier < brand.tier ? 0.5 : 0) }))
        .sort((x, y) => y.s - x.s)
        .slice(0, 3)
        .map(({ b }) => ({ name: b.ko, why: b.style === brand.style ? `같은 ${b.style}${b.tier < brand.tier ? ', 더 저렴한 편' : ''}` : `같은 ${originParts(b.origin).country} ${b.style}` }))
    : [];

  const evidence = [];
  if (barcode && off) evidence.push(`바코드 ${barcode}를 Open Food Facts(공개 제품 DB)에서 찾았어요`);
  else if (barcode) evidence.push(`바코드 ${barcode}를 읽었지만 공개 제품 DB 에는 없었어요`);
  if (brand && source === 'photo') evidence.push(`라벨에서 "${hits[0].matched}" 글자를 읽었어요`);
  if (brand && source === 'text') evidence.push(`브랜드 사전의 "${brand.ko}"와 맞췄어요`);
  if (!brand && cat) evidence.push(`정확한 제품은 못 찾았지만 라벨 글자(${attrs.styles.slice(0, 3).join(', ') || category?.name})로 종류를 알아냈어요`);
  if (product) evidence.push(`앱의 대표 제품 "${product.name}"과 연결했어요`);

  const confidence = off && brand ? 'high' : brand && (product || attrs.age || attrs.vintage) ? 'medium' : brand || off ? 'medium' : 'low';

  return normalizeResult({
    is_alcohol: true,
    not_alcohol_reason: '',
    confidence,
    confidence_note: `${evidence.join('. ')}. AI 없이 글자로 찾은 결과라 세부 제품(숙성 연수·라인)은 라벨에서 한 번 더 확인하세요.`,
    label_text: source === 'photo' ? labelText : '',
    name_ko: nameKo,
    name_original: nameOriginal,
    producer: brand?.ko || off?.brands || '',
    category: cat || 'other',
    style,
    country,
    region: regionName,
    ingredients: grape ? grape.ko : '',
    age_or_vintage: [age && cat !== 'wine' ? age : '', vintage].filter(Boolean).join(' ') || (cat === 'whisky' || cat === 'wine' ? '라벨에서 확인 안 됨' : ''),
    abv: attrs.abv ? `${attrs.abv}%` : product?.abv ? `${product.abv}%` : '',
    volume: attrs.volumeMl ? `${attrs.volumeMl}ml` : product?.ml ? `${product.ml}ml` : '',
    summary: brand?.desc?.split('. ')[0]?.replace(/\.?$/, '.') || product?.notes || category?.oneLine || '',
    description: desc.join(' '),
    tasting: { nose: '', palate: product?.notes || brand?.notes || (grapeCard ? strip(grapeCard.desc).split('.')[0] : ''), finish: '' },
    sweetness: product?.sweet ?? brand?.sweet ?? grape?.sweet ?? 3,
    body: product?.body ?? brand?.body ?? grape?.body ?? 3,
    how_to_drink: { temperature: serve.temperature, glass: serve.glass, methods: product?.serve ? [product.serve, ...serve.methods].slice(0, 3) : serve.methods, tips: '' },
    food_pairing: pairFoods(category, [grape?.ko?.replace(/\(.*\)/, ''), ...attrs.styles, brand?.style]),
    price,
    where_to_buy: buy[cat]?.[0] ? `${buy[cat][0].why}` : '',
    similar,
    storage: keepTip(category),
    fun_fact: '',
    search_query: [nameKo.replace(/ \(생산자 확인 필요\)$/, ''), attrs.volumeMl ? `${attrs.volumeMl}ml` : ''].filter(Boolean).join(' '),
  });
}

/** 검색어로 브랜드 찾기 (술 찾기 탭) */
export function searchBrands(brands, query, limit = 6) {
  const q = prepName(query);
  if (q.length < 2) return [];
  const qc = q.replace(/\s/g, '');
  const scored = [];
  for (const b of brands) {
    let s = 0;
    for (const n of [b.ko, ...b.names]) {
      const nn = prepName(n).replace(/\s/g, '');
      if (!nn) continue;
      if (nn === qc) s = Math.max(s, 100);
      else if (nn.startsWith(qc) || (nn.length >= 3 && qc.startsWith(nn))) s = Math.max(s, 60 + Math.min(nn.length, qc.length));
      else if (nn.includes(qc) && qc.length >= 2) s = Math.max(s, 40);
      else if (qc.length >= 5 && editDistance(nn, qc, 2) <= 1) s = Math.max(s, 30);
    }
    // 이름에 없으면 스타일·원산지로 ("코냑", "IPA", "칠레" → 그 종류의 브랜드들)
    if (!s && prepName(b.style).replace(/\s/g, '').includes(qc)) s = 20;
    else if (!s && prepName(b.origin).replace(/\s/g, '').includes(qc)) s = 15;
    if (s) scored.push({ b, s });
  }
  return scored.sort((x, y) => y.s - x.s).slice(0, limit).map((x) => x.b);
}
