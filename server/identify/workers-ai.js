// Cloudflare Workers AI 로 술 알아보기 (무료 하루 할당량 안에서, Worker 의 AI 바인딩 사용)
//
// Workers 무료 플랜은 하루 10,000 뉴런까지 무료이고, 넘으면 요금 대신 오류가 납니다(그때 화면은 기기 안 분석으로 바꿔요).
// 기본 모델은 사진을 읽을 수 있는 Llama 4 Scout. wrangler.jsonc 의 WORKERS_AI_MODEL 로 바꿀 수 있어요.
// 사진 입력 형식은 OpenAI 와 같은 messages + image_url(data URL) 형식으로 보냅니다.
//
// 사진은 두 단계로 알아봐요. 실제로 시험해 보니 이 모델은 사진을 붙이면 라벨은 정확히 읽지만
// 한국어 글자가 깨져서("위스키" → "위하벗") 나왔고, 사진 없이 이름만 물으면 한국어가 멀쩡했어요.
//   1) 사진 → 영어로 제품 이름·라벨 글자·도수만 짧게 (buildVisionInput)
//   2) 그 이름이 앱의 브랜드 사전에 있으면 사전으로 한국어 설명 (정확하고 빠르고 AI 사용량도 안 씀)
//      없으면 그 이름 → 한국어 설명 (이름 질문과 같은 방식)
//   3) 라벨에서 읽은 값(이름·도수·숙성·용량)으로 덮어쓰기 (mergeVision)
import { BRANDS } from '../../public/js/content/brands.js';
import { BUY_BY_CATEGORY, CATEGORY_BY_ID, PRODUCTS } from '../../public/js/content/index.js';
import { analyzeLabel, extractAttributes, matchBrands } from '../../public/js/lib/label.js';
import { IdentifyError } from './claude.js';
import { SYSTEM_PROMPT, userText } from './prompt.js';
import { RESULT_SCHEMA } from './schema.js';

export const DEFAULT_WORKERS_AI_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';

/** 스키마로 빈 JSON 견본 만들기 (작은 모델이 형식을 잘 지키도록 지시문에 넣음) */
export function skeleton(schema) {
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, skeleton(v)]));
  if (schema.type === 'array') return [skeleton(schema.items)];
  if (schema.enum) return schema.enum.join('|');
  if (schema.type === 'integer') return 3;
  if (schema.type === 'boolean') return true;
  return '';
}

const JSON_GUIDE = `\n\n출력 형식: 아래 키를 모두 가진 JSON 객체 하나만 출력하세요. 설명 문장이나 코드 블록 표시(\`\`\`) 없이 JSON 만 씁니다. 모르는 값은 빈 문자열("")이나 0 으로 둡니다.
글은 짧게 씁니다: 각 값은 한두 문장(80자 이내), label_text 는 100자 이내, 목록은 3개까지. 같은 말을 되풀이하지 마세요.
${JSON.stringify(skeleton(RESULT_SCHEMA))}`;

const CATEGORIES = ['wine', 'whisky', 'beer', 'soju', 'traditional', 'sake', 'brandy', 'vodka', 'gin', 'rum', 'tequila', 'liqueur', 'baijiu', 'cocktail', 'other'];

const VISION_PROMPT = `You identify alcohol bottles from photos for a Korean drinks app. Look at the front label, back label, Korean importer sticker, bottle shape and capsule. Several photos are different sides of the same bottle.
Answer with ONE JSON object only, written in English (romanize any Korean names), with no code fences and no other text:
{"is_alcohol":true,"name":"full product name, e.g. Johnnie Walker Black Label 12 Year Old","producer":"","category":"${CATEGORIES.join('|')}","style":"short, e.g. Blended Scotch whisky, Bordeaux red wine","country":"","region":"","age_or_vintage":"","abv":"","volume":"","label_text":"main words and numbers you can read, max 150 characters","confidence":"high|medium|low","why":"what you saw, max 80 characters"}
Rules: never invent an age, vintage or ABV that is not visible (use ""). Use confidence high only if you can read the product name. If this is not an alcohol bottle or it is too blurry, set is_alcohol to false and say why in "why".`;

/** 1단계: 사진 → 영어로 짧게 */
export function buildVisionInput({ images = [], text = '' }) {
  return {
    messages: [
      { role: 'system', content: VISION_PROMPT },
      {
        role: 'user',
        content: [
          ...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.data}` } })),
          { type: 'text', text: `Identify this bottle (${images.length} photo${images.length > 1 ? 's' : ''}).${text ? ` The user added: ${text}` : ''}` },
        ],
      },
    ],
    max_tokens: 500,
    temperature: 0.1,
  };
}

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const RANK = { high: 3, medium: 2, low: 1 };

// 한국어가 아닌 글자(키릴 문자 등)나 깨진 글자가 섞여 나오는 경우가 있어 지움
const JUNK = /[\uD800-\uDFFF\u0400-\u04FF\u0E00-\u0E7F\uFFFD]/g;

/** 결과 글에서 깨진 글자 지우기. 이름이 깨졌으면 라벨의 원어 이름을 씀 */
export function cleanKorean(result, fallbackName = '') {
  const walk = (v) => (typeof v === 'string' ? v.replace(JUNK, '') : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v);
  const broken = typeof result?.name_ko === 'string' && JUNK.test(result.name_ko);
  JUNK.lastIndex = 0;
  const out = walk(result);
  if (broken && fallbackName) out.name_ko = fallbackName;
  return out;
}

/**
 * 사진에서 읽은 이름이 브랜드 사전에 있으면 사전으로 만든 설명 (없거나 종류가 다르면 null)
 */
export function dictionaryResult(vision) {
  const text = [vision.name, vision.producer, vision.style, vision.label_text].map((v) => str(v, 200)).join(' ');
  const hit = matchBrands(text, BRANDS, extractAttributes(text).votes)[0];
  if (!hit || hit.score < 10) return null;
  if (CATEGORIES.includes(vision.category) && vision.category !== 'other' && hit.brand.cat !== vision.category) return null;
  const local = analyzeLabel({ text, source: 'text' }, { brands: BRANDS, products: PRODUCTS, categories: CATEGORY_BY_ID, buy: BUY_BY_CATEGORY });
  if (!local.is_alcohol) return null;
  return { ...local, confidence_note: `앱의 브랜드 사전(${hit.brand.ko})으로 설명했어요. 세부 제품(숙성 연수·라인)은 라벨에서 한 번 더 확인하세요.` };
}

/** 2단계 한국어 설명에 사진에서 읽은 값(이름·도수·숙성·용량·라벨 글자)을 덮어쓰기 */
export function mergeVision(korean, vision) {
  const conf = [vision.confidence, korean.confidence].filter((c) => RANK[c]).sort((a, b) => RANK[a] - RANK[b])[0] || 'low';
  const name = str(vision.name);
  return {
    ...korean,
    is_alcohol: true,
    label_text: str(vision.label_text, 400) || korean.label_text || '',
    name_original: name || korean.name_original,
    producer: str(vision.producer) || korean.producer,
    category: CATEGORIES.includes(vision.category) ? vision.category : korean.category,
    age_or_vintage: str(vision.age_or_vintage, 40) || korean.age_or_vintage,
    abv: str(vision.abv, 40) || korean.abv,
    volume: str(vision.volume, 40) || korean.volume,
    confidence: conf,
    confidence_note: [name ? `사진의 라벨에서 "${name}"(으)로 읽었어요.` : '', korean.confidence_note].filter(Boolean).join(' '),
  };
}

export function buildWorkersAiInput({ images = [], text = '', withFormat = true }) {
  const prompt = userText({ text, imageCount: images.length });
  const content = images.length
    ? [...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.data}` } })), { type: 'text', text: prompt }]
    : prompt;
  const input = {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT + JSON_GUIDE },
      { role: 'user', content },
    ],
    max_tokens: 2500,
    temperature: 0.2,
  };
  if (withFormat) input.response_format = { type: 'json_schema', json_schema: RESULT_SCHEMA };
  return input;
}

/**
 * 글자 수 제한(max_tokens)에 걸려 중간에 끊긴 JSON 을 닫아서 살리기.
 * 끊긴 마지막 값은 버리고, 열린 따옴표·괄호를 닫음
 */
export function repairJson(text) {
  const stack = [];
  let inStr = false;
  let esc = false;
  let lastSafe = -1; // 마지막으로 값 하나가 끝난 위치
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') {
      stack.pop();
      if (!stack.length) return text.slice(0, i + 1);
    } else if (c === ',') lastSafe = i;
  }
  if (lastSafe < 0) return null;
  // 끊긴 마지막 항목을 버리고 다시 닫기
  const head = text.slice(0, lastSafe);
  const closers = [];
  inStr = false;
  esc = false;
  for (const c of head) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') closers.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') closers.pop();
  }
  return head + closers.reverse().join('');
}

function badJson(text, out) {
  const s = String(text ?? '');
  return Object.assign(new IdentifyError('AI 응답을 읽지 못했어요. 다시 시도해 주세요.', 502, 'bad_json'), {
    detail: { length: s.length, head: s.slice(0, 160), tail: s.slice(-160), usage: out?.usage ?? null },
  });
}

/** 모델 답에서 JSON 꺼내기 (이미 객체거나, 앞뒤에 글이나 ```json 이 붙었거나, 끊긴 경우) */
export function parseWorkersAiResponse(out) {
  const r = out?.response ?? out?.result?.response ?? out;
  if (r && typeof r === 'object' && !Array.isArray(r)) return r;
  const text = String(r ?? '');
  const start = text.indexOf('{');
  if (start === -1) throw badJson(text, out);
  const end = text.lastIndexOf('}');
  if (end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      /* 아래에서 고쳐 보기 */
    }
  }
  const fixed = repairJson(text.slice(start));
  try {
    const obj = fixed && JSON.parse(fixed);
    if (obj && typeof obj === 'object' && (obj.name_ko || obj.is_alcohol === false)) return obj;
  } catch {
    /* 못 고침 */
  }
  throw badJson(text, out);
}

const QUOTA = /4006|neuron|allocation|quota|exceeded|daily limit|upgrade to/i;
const FORMAT = /json mode|response_format|json_schema|couldn.t be met|schema/i;

export function createWorkersAiIdentifier({ ai, model = DEFAULT_WORKERS_AI_MODEL }) {
  async function run(input) {
    try {
      return await ai.run(model, input);
    } catch (err) {
      const msg = String(err?.message || err);
      if (QUOTA.test(msg)) throw new IdentifyError('오늘 무료 AI 사용량을 다 썼어요. 기기 안에서 분석할게요.', 429, 'free_quota');
      throw Object.assign(new Error(msg), { format: FORMAT.test(msg) });
    }
  }

  const identifier = {
    model,
    provider: 'workers-ai',
    free: true,
    async identify({ images = [], text = '' }) {
      if (images.length) return identifyPhoto({ images, text });
      return identifyText(text);
    },
  };

  async function identifyPhoto({ images, text }) {
    let vOut;
    try {
      vOut = await run(buildVisionInput({ images, text }));
    } catch (err) {
      if (err instanceof IdentifyError) throw err;
      throw Object.assign(new IdentifyError('무료 AI 가 지금 응답하지 않아요. 기기 안에서 분석할게요.', 502, 'upstream'), { detail: { vision: err.message.slice(0, 200) } });
    }
    const vision = parseVision(vOut);
    const base = str(vision.name) || str(vision.name_original);
    if (vision.is_alcohol === false || !base) {
      return {
        result: {
          is_alcohol: false,
          not_alcohol_reason: '사진에서 술병 라벨을 알아보지 못했어요. 라벨이 정면으로 크게 보이게, 밝은 곳에서 다시 찍어 주세요. 뒷면 한글 수입사 스티커를 같이 찍으면 더 정확해요.',
          label_text: str(vision.label_text, 400),
        },
        model,
        usage: vOut?.usage ?? null,
      };
    }
    const v = { ...vision, name: base };
    // 브랜드 사전에 있으면 사전으로 (AI 를 한 번 덜 부름)
    const dict = dictionaryResult(v);
    if (dict) return { result: mergeVision(dict, v), model, usage: vOut?.usage ?? null, source: 'dictionary' };
    // 없으면 이름으로 한국어 설명 받기 (이름에 숙성 연수·빈티지가 없으면 붙여서)
    const age = str(vision.age_or_vintage, 40);
    const korean = await identifyText(age && !base.includes(age) ? `${base} ${age}` : base);
    return { result: mergeVision(cleanKorean(korean.result, base), v), model, usage: { vision: vOut?.usage ?? null, text: korean.usage } };
  }

  function parseVision(out) {
    try {
      return parseWorkersAiResponse(out);
    } catch (err) {
      // 이름만이라도 건지기 ("name":"..." 부분)
      const raw = String(out?.response ?? '');
      const m = raw.match(/"name"\s*:\s*"([^"]{3,120})"/);
      if (m) return { is_alcohol: true, name: m[1], confidence: 'low' };
      throw err;
    }
  }

  /** 이름 → 한국어 설명 (사진 2단계에서도 씀) */
  async function identifyText(text) {
    let out;
    try {
      out = await run(buildWorkersAiInput({ text, withFormat: true }));
    } catch (err) {
      if (err instanceof IdentifyError) throw err;
      // JSON 형식 강제를 못 지키면 형식 없이 한 번 더 (지시문의 견본으로 JSON 을 받음)
      try {
        out = await run(buildWorkersAiInput({ text, withFormat: false }));
      } catch (err2) {
        if (err2 instanceof IdentifyError) throw err2;
        throw Object.assign(new IdentifyError('무료 AI 가 지금 응답하지 않아요. 기기 안에서 분석할게요.', 502, 'upstream'), {
          detail: { first: err.message.slice(0, 200), second: err2.message.slice(0, 200) },
        });
      }
    }
    return { result: cleanKorean(parseWorkersAiResponse(out), text), model, usage: out?.usage ?? null };
  }

  return identifier;
}
