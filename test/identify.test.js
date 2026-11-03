// 사진으로 술 알아보기: 가짜 Claude API 서버로 서버·Worker 전체 흐름 확인
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { buildRequest, createIdentifier, parseResponse, supportsFallback } from '../server/identify/claude.js';
import { createMemoryLimiter, createMemoryStore, handleIdentify, kstDay, parseInput } from '../server/identify/handler.js';
import { RESULT_SCHEMA } from '../server/identify/schema.js';
import { createApp } from '../server/index.js';
import worker from '../worker/index.js';
import { findNamespace, parseNamespaceList, withoutKv } from '../scripts/ensure-kv.js';
import { normalizeResult, priceQuery } from '../public/js/lib/identify.js';

// 1x1 JPEG
const TINY_JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z';
const DATA_URL = `data:image/jpeg;base64,${TINY_JPEG}`;

const SAMPLE = {
  is_alcohol: true,
  not_alcohol_reason: '',
  confidence: 'high',
  confidence_note: '앞 라벨의 "The Balvenie DoubleWood 12" 글자로 확인',
  label_text: 'The Balvenie DoubleWood Aged 12 Years 40% vol 700ml',
  name_ko: '발베니 12년 더블우드',
  name_original: 'The Balvenie DoubleWood 12',
  producer: '발베니 증류소',
  category: 'whisky',
  style: '싱글 몰트 스카치 · 스페이사이드',
  country: '스코틀랜드',
  region: '스페이사이드',
  ingredients: '맥아 보리',
  age_or_vintage: '12년',
  abv: '40%',
  volume: '700ml',
  summary: '꿀과 바닐라의 부드러운 싱글 몰트',
  description: '버번 캐스크에서 숙성한 뒤 셰리 캐스크에서 마무리합니다.',
  tasting: { nose: '꿀, 바닐라', palate: '견과, 계피', finish: '길고 따뜻함' },
  sweetness: 9,
  body: 3,
  how_to_drink: { temperature: '상온', glass: '글렌캐런 잔', methods: ['스트레이트', '물 몇 방울'], tips: '천천히' },
  food_pairing: ['다크 초콜릿', '견과류', '육포'],
  price: { krw_low: 170000, krw_high: 110000, basis: '700ml 국내 마트 기준', note: '면세점이 더 쌀 수 있어요' },
  where_to_buy: '창고형 마트, 주류 전문점',
  similar: [{ name: '글렌피딕 12년', why: '더 싸고 가벼움' }],
  storage: '세워서 보관',
  fun_fact: '자체 몰팅을 하는 몇 안 되는 증류소예요.',
  search_query: '발베니 12년 더블우드 700ml',
};

/** 가짜 Anthropic Messages API */
async function fakeClaude(t, { reply = SAMPLE, stopReason = 'end_turn', status = 200 } = {}) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    calls.push({ url: req.url, headers: req.headers, body: JSON.parse(raw || '{}') });
    if (status !== 200) {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: status === 401 ? 'authentication_error' : 'api_error', message: 'x' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [
          { type: 'thinking', thinking: '', signature: 'x' },
          { type: 'text', text: typeof reply === 'string' ? reply : JSON.stringify(reply) },
        ],
        stop_reason: stopReason,
        stop_details: null,
        usage: { input_tokens: 1800, output_tokens: 900 },
      }),
    );
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return { baseURL: `http://127.0.0.1:${server.address().port}`, calls };
}

test('요청 모양: 사진·지시문·JSON 스키마·대체 모델(fallback)', () => {
  const req = buildRequest({ images: [{ mediaType: 'image/jpeg', data: 'AAA' }], text: '' });
  assert.equal(req.model, 'claude-opus-5-5');
  assert.equal(req.messages[0].content[0].type, 'image');
  assert.equal(req.messages[0].content[0].source.media_type, 'image/jpeg');
  assert.equal(req.messages[0].content.at(-1).type, 'text');
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.equal(req.output_config.effort, 'medium');
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(req.fallbacks, 'default');
  assert.equal(req.thinking, undefined); // Opus 5.5 는 thinking 을 끌 수 없어서 보내지 않음
  // Haiku 에는 fallback 을 보내지 않음
  assert.equal(supportsFallback('claude-haiku-5-5'), false);
  const haiku = buildRequest({ model: 'claude-haiku-5-5', text: '참이슬' });
  assert.equal(haiku.fallbacks, undefined);
  assert.equal(haiku.betas, undefined);
});

test('JSON 스키마: 모든 객체가 additionalProperties:false 이고 모든 칸이 필수', () => {
  const walk = (node, path) => {
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false, path);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), path);
      for (const [k, v] of Object.entries(node.properties)) walk(v, `${path}.${k}`);
    }
    if (node.type === 'array') walk(node.items, `${path}[]`);
    for (const bad of ['minimum', 'maximum', 'minLength', 'maxLength']) assert.ok(!(bad in node), `${path} 에 지원하지 않는 ${bad}`);
  };
  walk(RESULT_SCHEMA, 'result');
});

test('응답 읽기: thinking 건너뛰기, 거절·잘림·깨진 JSON', () => {
  const ok = parseResponse({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a":1}' }] });
  assert.deepEqual(ok, { a: 1 });
  assert.throws(() => parseResponse({ stop_reason: 'refusal', content: [] }), (e) => e.code === 'refusal' && e.status === 422);
  assert.throws(() => parseResponse({ stop_reason: 'max_tokens', content: [] }), (e) => e.code === 'max_tokens');
  assert.throws(() => parseResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{oops' }] }), (e) => e.code === 'bad_json');
});

test('결과 다듬기: 범위 맞추기, 거꾸로 된 가격, 빠진 칸', () => {
  const r = normalizeResult(SAMPLE);
  assert.equal(r.sweetness, 5);
  assert.deepEqual([r.price.krw_low, r.price.krw_high], [110000, 170000]);
  assert.equal(r.category, 'whisky');
  const empty = normalizeResult({ category: 'spaceship', sweetness: 'x', price: { krw_low: -5 } });
  assert.equal(empty.category, 'other');
  assert.equal(empty.sweetness, 3);
  assert.equal(empty.price.krw_low, 0);
  assert.deepEqual(empty.how_to_drink.methods, []);
  assert.equal(normalizeResult(null).is_alcohol, true);
  assert.equal(priceQuery(r), '발베니 12년 더블우드 700ml 가격');
});

test('입력 검사: 사진 형식·장 수·크기, 이름 길이', () => {
  assert.equal(parseInput({}).error.body.code, 'empty');
  assert.equal(parseInput({ text: '술' }).error.body.code, 'empty');
  assert.deepEqual(parseInput({ text: '  발베니   12 ' }), { images: [], text: '발베니 12' });
  assert.equal(parseInput({ images: [DATA_URL, DATA_URL, DATA_URL, DATA_URL] }).error.body.code, 'too_many_images');
  assert.equal(parseInput({ images: ['data:image/svg+xml;base64,AAAA'] }).error.body.code, 'bad_image');
  assert.equal(parseInput({ images: ['https://example.com/a.jpg'] }).error.body.code, 'bad_image');
  const huge = `data:image/jpeg;base64,${'A'.repeat(6 * 1024 * 1024)}`;
  assert.equal(parseInput({ images: [huge] }).error.status, 413);
  const ok = parseInput({ images: [DATA_URL] });
  assert.equal(ok.images[0].mediaType, 'image/jpeg');
});

test('handleIdentify: 성공 → 같은 사진은 저장된 결과, 하루 한도, 분당 제한', async (t) => {
  const { baseURL, calls } = await fakeClaude(t);
  const identifier = createIdentifier({ apiKey: 'test-key', baseURL, maxRetries: 0 });
  const store = createMemoryStore();
  const deps = { identifier, store, dailyLimit: 2, limiter: createMemoryLimiter({ limit: 10 }) };

  const first = await handleIdentify({ body: { images: [DATA_URL] }, ip: '1.1.1.1' }, deps);
  assert.equal(first.status, 200);
  assert.equal(first.body.cached, false);
  assert.equal(first.body.result.name_ko, '발베니 12년 더블우드');
  assert.equal(first.body.result.sweetness, 5);
  assert.equal(calls.length, 1);
  // SDK 가 보낸 요청: beta 헤더, fallbacks, 사진
  assert.match(calls[0].url, /^\/v1\/messages/);
  assert.match(calls[0].headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.ok([calls[0].headers['x-api-key'], calls[0].headers.authorization].some((h) => String(h).includes('test-key')), 'API 키 전달');
  assert.equal(calls[0].body.fallbacks, 'default');
  assert.equal(calls[0].body.messages[0].content[0].source.data, TINY_JPEG);

  const again = await handleIdentify({ body: { images: [DATA_URL] }, ip: '1.1.1.1' }, deps);
  assert.equal(again.body.cached, true);
  assert.equal(calls.length, 1, '같은 사진은 다시 부르지 않음');

  await handleIdentify({ body: { text: '발베니' } }, deps);
  assert.equal(await store.get(`count:${kstDay()}`), 2);
  const over = await handleIdentify({ body: { text: '맥캘란' } }, deps);
  assert.equal(over.status, 429);
  assert.equal(over.body.code, 'daily_limit');

  const limited = await handleIdentify({ body: { text: '글렌피딕' }, ip: '2.2.2.2' }, { ...deps, dailyLimit: 0, limiter: async () => false });
  assert.equal(limited.body.code, 'rate_limited');
});

test('handleIdentify: 키 없음·API 오류·거절·술이 아닌 사진', async (t) => {
  const none = await handleIdentify({ body: { text: '발베니' } }, { identifier: null });
  assert.equal(none.status, 503);
  assert.equal(none.body.code, 'not_configured');

  const bad = await fakeClaude(t, { status: 401 });
  const authFail = await handleIdentify({ body: { text: '발베니' } }, { identifier: createIdentifier({ apiKey: 'x', baseURL: bad.baseURL, maxRetries: 0 }), store: createMemoryStore() });
  assert.equal(authFail.body.code, 'auth');

  const refused = await fakeClaude(t, { stopReason: 'refusal', reply: '' });
  const r = await handleIdentify({ body: { text: '이상한 요청' } }, { identifier: createIdentifier({ apiKey: 'x', baseURL: refused.baseURL, maxRetries: 0 }), store: createMemoryStore() });
  assert.equal(r.status, 422);

  const notAlcohol = await fakeClaude(t, { reply: { ...SAMPLE, is_alcohol: false, not_alcohol_reason: '고양이 사진이에요', name_ko: '' } });
  const store = createMemoryStore();
  const n = await handleIdentify({ body: { images: [DATA_URL] } }, { identifier: createIdentifier({ apiKey: 'x', baseURL: notAlcohol.baseURL, maxRetries: 0 }), store, dailyLimit: 0 });
  assert.equal(n.body.result.is_alcohol, false);
  const n2 = await handleIdentify({ body: { images: [DATA_URL] } }, { identifier: createIdentifier({ apiKey: 'x', baseURL: notAlcohol.baseURL, maxRetries: 0 }), store, dailyLimit: 0 });
  assert.equal(n2.body.cached, false, '술이 아닌 결과는 저장하지 않음');
});

test('개발 서버: /api/health, /api/identify', async (t) => {
  const { baseURL } = await fakeClaude(t);
  const app = createApp({ identifier: createIdentifier({ apiKey: 'x', baseURL, maxRetries: 0 }) });
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.identify, true);
  const res = await fetch(`${base}/api/identify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '발베니 12년' }) });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).result.name_ko, '발베니 12년 더블우드');
  const broken = await fetch(`${base}/api/identify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(broken.status, 400);
  // 키가 없으면 health 가 알려 줌
  const off = createApp().listen(0);
  t.after(() => off.close());
  await new Promise((r) => off.once('listening', r));
  const offHealth = await (await fetch(`http://127.0.0.1:${off.address().port}/api/health`)).json();
  assert.equal(offHealth.identify, false);
});

function kvMock() {
  const map = new Map();
  return {
    map,
    async get(key, type) {
      const v = map.get(key);
      return v == null ? null : type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      map.set(key, value);
    },
  };
}

test('Worker: CORS·허용 주소·분당 제한 바인딩·KV', async (t) => {
  const { baseURL, calls } = await fakeClaude(t);
  const kv = kvMock();
  let limiterCalls = 0;
  const env = {
    AI_PROVIDER: 'anthropic',
    ANTHROPIC_API_KEY: 'x',
    ANTHROPIC_BASE_URL: baseURL,
    ALLOWED_ORIGINS: 'https://kts4u1.github.io',
    DAILY_LIMIT: '5',
    CACHE: kv,
    IDENTIFY_LIMITER: { limit: async () => ({ success: ++limiterCalls < 100 }) },
  };
  const post = (origin, body = { text: '발베니 12년' }) =>
    worker.fetch(
      new Request('https://sulsul-api.example.workers.dev/api/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), 'CF-Connecting-IP': '9.9.9.9' },
        body: JSON.stringify(body),
      }),
      env,
    );

  const pre = await worker.fetch(new Request('https://x/api/identify', { method: 'OPTIONS', headers: { Origin: 'https://kts4u1.github.io' } }), env);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), 'https://kts4u1.github.io');
  const preBad = await worker.fetch(new Request('https://x/api/identify', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), env);
  assert.equal(preBad.status, 403);

  const ok = await post('https://kts4u1.github.io');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://kts4u1.github.io');
  assert.equal((await ok.json()).result.category, 'whisky');
  assert.equal(limiterCalls, 1);
  assert.ok([...kv.map.keys()].some((k) => k.startsWith('v3:t:')), 'KV 에 결과 저장');

  assert.equal((await post('https://evil.example')).status, 403);
  assert.equal((await post(null)).status, 403);
  assert.equal((await post('http://localhost:3000')).status, 200, '내 PC 시험은 허용');
  assert.equal(calls.length, 1, '두 번째부터는 저장된 결과');

  const health = await (await worker.fetch(new Request('https://x/api/health', { headers: { Origin: 'https://kts4u1.github.io' } }), env)).json();
  assert.deepEqual([health.identify, health.model, health.dailyLimit, health.provider], [true, 'claude-opus-5-5', 5, 'anthropic']);
  const off = await (await worker.fetch(new Request('https://x/api/health'), {})).json();
  assert.equal(off.identify, false);
});

test('ensure-kv: wrangler 출력 해석, KV 설정 빼기', () => {
  const list = parseNamespaceList('안내 문구\n[{"id":"abc","title":"sulsul-cache"}]\n');
  assert.equal(findNamespace(list).id, 'abc');
  assert.deepEqual(parseNamespaceList('no json'), []);
  const cfg = '{\n  "a": 1,\n  // kv-start\n  "kv_namespaces": [],\n  // kv-end\n  "b": 2\n}';
  assert.doesNotMatch(withoutKv(cfg), /kv_namespaces/);
  assert.match(withoutKv(cfg), /"b": 2/);
});

// ---------- Cloudflare Workers AI (무료) ----------
import { buildVisionInput, buildWorkersAiInput, cleanKorean, createWorkersAiIdentifier, dictionaryResult, mergeVision, parseWorkersAiResponse, labelEvidence, repairJson, skeleton, styleKo, visionHint } from '../server/identify/workers-ai.js';

function fakeAi(handler) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      return handler(calls.length, model, input);
    },
  };
}

test('Workers AI 요청: 사진은 image_url data URL, JSON 견본·스키마', () => {
  const input = buildWorkersAiInput({ images: [{ mediaType: 'image/jpeg', data: 'AAA' }], text: '' });
  const user = input.messages[1];
  assert.equal(user.content[0].type, 'image_url');
  assert.equal(user.content[0].image_url.url, 'data:image/jpeg;base64,AAA');
  assert.equal(input.response_format.type, 'json_schema');
  assert.match(input.messages[0].content, /"name_ko":""/);
  assert.ok(input.max_tokens >= 2000);
  const text = buildWorkersAiInput({ text: '발베니', withFormat: false });
  assert.equal(typeof text.messages[1].content, 'string');
  assert.equal(text.response_format, undefined);
  assert.equal(skeleton(RESULT_SCHEMA).tasting.nose, '');
});

test('Workers AI 응답 읽기: 객체, 글 속 JSON, 코드 블록', () => {
  assert.deepEqual(parseWorkersAiResponse({ response: { a: 1 } }), { a: 1 });
  assert.deepEqual(parseWorkersAiResponse({ response: '네, 결과입니다:\n```json\n{"a":2}\n```' }), { a: 2 });
  assert.throws(() => parseWorkersAiResponse({ response: '모르겠어요' }), (e) => e.code === 'bad_json');
});

test('Workers AI: 성공, JSON 형식 실패 시 형식 없이 다시, 무료 할당량 소진', async () => {
  const ok = fakeAi(() => ({ response: SAMPLE, usage: { prompt_tokens: 1500, completion_tokens: 800 } }));
  const r = await createWorkersAiIdentifier({ ai: ok }).identify({ text: '발베니' });
  assert.equal(r.result.name_ko, '발베니 12년 더블우드');
  assert.equal(ok.calls[0].model, '@cf/meta/llama-4-scout-17b-16e-instruct');

  const retry = fakeAi((n) => {
    if (n === 1) throw new Error("JSON Mode couldn't be met");
    return { response: JSON.stringify(SAMPLE) };
  });
  const r2 = await createWorkersAiIdentifier({ ai: retry }).identify({ text: '발베니' });
  assert.equal(r2.result.category, 'whisky');
  assert.equal(retry.calls.length, 2);
  assert.equal(retry.calls[1].input.response_format, undefined);

  const quota = fakeAi(() => {
    throw new Error('AiError: 4006: you have used up your daily free allocation of 10,000 neurons');
  });
  await assert.rejects(createWorkersAiIdentifier({ ai: quota }).identify({ text: '발베니' }), (e) => e.code === 'free_quota' && e.status === 429);

  const down = fakeAi(() => {
    throw new Error('InferenceUpstreamError');
  });
  await assert.rejects(createWorkersAiIdentifier({ ai: down }).identify({ text: '발베니' }), (e) => e.code === 'upstream');
});

test('Worker: 기본은 무료 Workers AI, Claude 는 AI_PROVIDER=anthropic 일 때만', async () => {
  const ai = fakeAi(() => ({ response: SAMPLE }));
  const env = { AI: ai, ALLOWED_ORIGINS: 'https://kts4u1.github.io', ANTHROPIC_API_KEY: 'paid-key', CACHE: kvMock() };
  const health = await (await worker.fetch(new Request('https://x/api/health'), env)).json();
  assert.deepEqual([health.identify, health.provider, health.free, health.dailyLimit], [true, 'workers-ai', true, 50]);
  const res = await worker.fetch(
    new Request('https://x/api/identify', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://kts4u1.github.io' }, body: JSON.stringify({ text: '발베니 12년' }) }),
    env,
  );
  assert.equal(res.status, 200);
  assert.equal(ai.calls.length, 1, '키가 있어도 유료 Claude 를 부르지 않음');
  const paid = await (await worker.fetch(new Request('https://x/api/health'), { ...env, AI_PROVIDER: 'anthropic' })).json();
  assert.deepEqual([paid.provider, paid.free], ['anthropic', false]);
});

test('Workers AI: 글자 수 제한에 끊긴 JSON 살리기, 못 살리면 진단 정보', async () => {
  const full = JSON.stringify({ is_alcohol: true, name_ko: '조니워커 블랙', category: 'whisky', tasting: { nose: '바닐라, "스모키"' }, similar: [{ name: 'a', why: 'b' }] });
  for (const cut of [45, 75, 100, full.length - 3]) {
    const r = JSON.parse(repairJson(full.slice(0, cut)));
    assert.equal(r.name_ko, '조니워커 블랙', `cut ${cut}`);
  }
  assert.equal(parseWorkersAiResponse({ response: `결과: ${full.slice(0, 100)}` }).category, 'whisky');
  assert.throws(
    () => parseWorkersAiResponse({ response: '모르겠어요', usage: { completion_tokens: 3 } }),
    (e) => e.code === 'bad_json' && e.detail.head === '모르겠어요' && e.detail.usage.completion_tokens === 3,
  );
  // 화면에는 진단 정보가 오고, 실패해도 하루 사용량은 셈 (AI 사용량은 썼으니까)
  const store = createMemoryStore();
  const identifier = createWorkersAiIdentifier({ ai: { run: async () => ({ response: '잘 모르겠어요' }) } });
  const res = await handleIdentify({ body: { text: '발베니' } }, { identifier, store, dailyLimit: 5, now: () => Date.UTC(2026, 10, 3, 3) });
  assert.equal(res.status, 502);
  assert.equal(res.body.code, 'bad_json');
  assert.equal(res.body.detail.head, '잘 모르겠어요');
  assert.equal(await store.get(`count:${kstDay(Date.UTC(2026, 10, 3, 3))}`), 1);
});

test('Workers AI 사진: 브랜드 사전에 있으면 사전으로 (AI 한 번만)', async () => {
  const vision = { is_alcohol: true, name: 'The Balvenie DoubleWood 12 Year Old', producer: 'The Balvenie', category: 'whisky', age_or_vintage: '12', abv: '40%', volume: '700ml', label_text: 'THE BALVENIE DOUBLEWOOD AGED 12 YEARS 40% vol', confidence: 'high' };
  const ai = fakeAi(() => ({ response: JSON.stringify(vision) }));
  const r = await createWorkersAiIdentifier({ ai }).identify({ images: [{ mediaType: 'image/jpeg', data: TINY_JPEG }] });
  assert.equal(ai.calls.length, 1);
  assert.match(r.result.name_ko, /발베니/);
  assert.equal(r.result.name_original, vision.name);
  assert.equal(r.result.abv, '40%');
  assert.match(r.result.confidence_note, /브랜드 사전/);
  assert.ok(r.result.price.krw_low > 0);
  // 종류가 다르면 사전을 쓰지 않음 (와인 라벨의 "Terra" 를 맥주 테라로)
  assert.equal(dictionaryResult({ name: 'Terra Alta Garnacha', category: 'wine' }), null);
  assert.equal(dictionaryResult({ name: 'Some Unknown Craft Gin', category: 'gin' }), null);
  assert.match(dictionaryResult({ name: 'Chamisul Fresh', producer: 'HiteJinro', category: 'soju' }).name_ko, /참이슬/);
});

test('Workers AI: 깨진 글자 지우기', () => {
  const r = cleanKorean({ name_ko: '라프로아йг 10년', summary: '스\udc0c모키', similar: [{ name: 'a\u0439b' }], sweetness: 3 }, 'Laphroaig 10');
  assert.equal(r.name_ko, 'Laphroaig 10');
  assert.equal(r.summary, '스모키');
  assert.equal(r.similar[0].name, 'ab');
  assert.equal(r.sweetness, 3);
  assert.equal(cleanKorean({ name_ko: '발베니' }, 'X').name_ko, '발베니');
});

test('Workers AI 사진: 사전에 없으면 영어로 읽은 이름 → 한국어 설명, 라벨 값으로 덮어쓰기', async () => {
  const vision = { is_alcohol: true, name: 'Chateau Obscur Rouge Reserve', producer: 'Chateau Obscur', category: 'wine', age_or_vintage: '2019', abv: '13.5%', volume: '750ml', label_text: 'CHATEAU OBSCUR ROUGE RESERVE 2019 13.5% vol', confidence: 'high' };
  const ai = fakeAi((n, model, input) => (n === 1 ? { response: 'Sure! ' + JSON.stringify(vision) } : { response: { ...SAMPLE, category: 'wine', abv: '43%', confidence: 'medium' } }));
  const r = await createWorkersAiIdentifier({ ai }).identify({ images: [{ mediaType: 'image/jpeg', data: TINY_JPEG }] });
  assert.equal(ai.calls.length, 2);
  // 1단계: 사진 + 영어 지시, 짧게
  const first = ai.calls[0].input;
  assert.equal(first.messages[1].content[0].type, 'image_url');
  assert.match(first.messages[0].content, /English/);
  // 애매하다고 "술 아님"으로 답하지 않게
  assert.match(first.messages[0].content, /Do not answer is_alcohol false just because you are unsure/);
  assert.ok(first.max_tokens <= 600);
  assert.equal(first.response_format, undefined);
  // 2단계: 사진 없이 이름으로 (한국어가 깨지지 않게), 빈티지를 붙여서
  const second = ai.calls[1].input;
  assert.equal(typeof second.messages[1].content, 'string');
  assert.match(second.messages[1].content, /Chateau Obscur Rouge Reserve 2019/);
  // 라벨에서 읽은 값이 이기고, 판단 정도는 더 낮은 쪽
  assert.equal(r.result.name_ko, '발베니 12년 더블우드');
  assert.equal(r.result.abv, '13.5%');
  assert.equal(r.result.label_text, vision.label_text);
  assert.equal(r.result.confidence, 'medium');
  assert.match(r.result.confidence_note, /Chateau Obscur/);

  // 술이 아니면 2단계 없이 끝
  const no = fakeAi(() => ({ response: JSON.stringify({ is_alcohol: false, name: '', why: 'a cat' }) }));
  const r2 = await createWorkersAiIdentifier({ ai: no }).identify({ images: [{ mediaType: 'image/jpeg', data: TINY_JPEG }] });
  assert.equal(no.calls.length, 1);
  assert.equal(r2.result.is_alcohol, false);
  assert.match(r2.result.not_alcohol_reason, /다시 찍어/);

  // 이름 뒤에 숙성 연수가 없으면 붙여서 묻기
  const v2 = buildVisionInput({ images: [{ mediaType: 'image/png', data: 'B' }], text: '선물 받음' });
  assert.match(v2.messages[1].content[1].text, /선물 받음/);
  const ai3 = fakeAi((n) => (n === 1 ? { response: JSON.stringify({ is_alcohol: true, name: 'Obscure Valley Pinot 2015', age_or_vintage: '2015', category: 'wine' }) } : { response: SAMPLE }));
  await createWorkersAiIdentifier({ ai: ai3 }).identify({ images: [{ mediaType: 'image/jpeg', data: TINY_JPEG }] });
  assert.match(ai3.calls[1].input.messages[1].content, /Obscure Valley Pinot 2015/);
  assert.doesNotMatch(ai3.calls[1].input.messages[1].content, /2015 2015/);
  assert.equal(mergeVision({ category: 'wine', confidence: 'high' }, { name: 'X', category: 'nope', confidence: 'low' }).category, 'wine');
  const units = mergeVision({ abv: '', volume: '' }, { name: 'X', abv: '40', volume: '700' });
  assert.equal(units.abv, '40%');
  assert.equal(units.volume, '700ml');
  assert.equal(mergeVision({}, { name: 'X', abv: '43% vol' }).abv, '43% vol');
  assert.equal(mergeVision({}, { name: 'X', age_or_vintage: '10' }).age_or_vintage, '10년');
  assert.equal(mergeVision({}, { name: 'X', age_or_vintage: '2019' }).age_or_vintage, '2019 빈티지');
  assert.equal(mergeVision({}, { name: 'X', age_or_vintage: 'NV' }).age_or_vintage, 'NV');
});

test('Workers AI 사진: 사전에 없는 맥주를 AI 가 위스키로 지어내면 맥주 일반 설명·맥주 가격으로', async () => {
  // 실제로 있었던 일: Sengur Ultra(맥주 캔) → 이름만 물으니 "스페인산 블렌디드 위스키", 2만~3만 원
  const vision = { is_alcohol: true, name: 'Sengur Ultra', category: 'beer', style: 'Extra Smooth Lager', abv: '4.3%', volume: '0.5L', country: 'Kazakhstan', label_text: 'SENGUR ULTRA EXTRA SMOOTH LAGER', confidence: 'high' };
  const whisky = { ...SAMPLE, name_ko: '셍구르 울트라', category: 'whisky', style: '블렌디드 위스키', summary: '스페인산 블렌디드 위스키', country: '스페인', price: { krw_low: 20000, krw_high: 30000, basis: '대형마트', note: '' } };
  const ai = fakeAi((n) => (n === 1 ? { response: JSON.stringify(vision) } : { response: whisky }));
  const r = (await createWorkersAiIdentifier({ ai }).identify({ images: [{ mediaType: 'image/jpeg', data: TINY_JPEG }] })).result;
  // 설명 단계에 사진에서 읽은 종류·도수를 넘김
  const prompt = ai.calls[1].input.messages[1].content;
  assert.match(prompt, /종류\(category\): beer/);
  assert.match(prompt, /4\.3%/);
  assert.match(prompt, /종류를 바꾸지 마세요/);
  // 결과는 맥주
  assert.equal(r.category, 'beer');
  assert.equal(r.name_ko, 'Sengur Ultra');
  assert.doesNotMatch(r.summary + r.description + r.style, /위스키/);
  assert.ok(r.price.krw_high <= 20000, String(r.price.krw_high));
  assert.equal(r.country, '카자흐스탄');
  assert.equal(r.abv, '4.3%');
  assert.match(r.how_to_drink.glass, /맥주/);
  assert.match(r.confidence_note, /일반적인 설명/);

  // 종류는 맞췄지만 가격만 맥주 가격이 아니면 가격만 고침
  const pricey = fakeAi((n) => (n === 1 ? { response: JSON.stringify(vision) } : { response: { ...SAMPLE, category: 'beer', name_ko: '셍구르 울트라', price: { krw_low: 25000, krw_high: 30000 } } }));
  const r2 = (await createWorkersAiIdentifier({ ai: pricey }).identify({ images: [{ mediaType: 'image/jpeg', data: TINY_JPEG }] })).result;
  assert.equal(r2.name_ko, '셍구르 울트라');
  assert.ok(r2.price.krw_high <= 20000);
  assert.match(r2.price.note, /2\.5만~3만 원/);
  assert.equal(visionHint({}), '');
  assert.equal(styleKo('lager'), '라거');
  assert.equal(styleKo('Single Malt Scotch'), '싱글 몰트');
  assert.equal(styleKo('라거'), '라거');
  assert.equal(styleKo('Something Else'), 'Something Else');
  // AI 가 스타일을 영어로 줘도 화면에는 한국어
  const eng = fakeAi((n) => (n === 1 ? { response: JSON.stringify(vision) } : { response: { ...SAMPLE, category: 'beer', style: 'lager', price: { krw_low: 2000, krw_high: 3000 } } }));
  assert.equal((await createWorkersAiIdentifier({ ai: eng }).identify({ images: [{ mediaType: 'image/jpeg', data: TINY_JPEG }] })).result.style, '라거');
});

test('Workers AI 사진: 이름 칸이 비어도 라벨 글자로, 술 아니라고 해도 사전 브랜드면 술', async () => {
  // 흐린 사진: 이름은 비웠지만 라벨 글자·종류는 읽음
  const blurry = fakeAi((n) => (n === 1 ? { response: JSON.stringify({ is_alcohol: true, name: '', category: 'beer', label_text: 'Sengur ULTRA' }) } : { response: { ...SAMPLE, category: 'beer', name_ko: '셍구르 울트라', price: { krw_low: 2000, krw_high: 3000 } } }));
  const r1 = (await createWorkersAiIdentifier({ ai: blurry }).identify({ images: [{ mediaType: 'image/jpeg', data: TINY_JPEG }] })).result;
  assert.equal(r1.is_alcohol, true);
  assert.equal(blurry.calls.length, 2);
  assert.match(blurry.calls[1].input.messages[1].content, /Sengur ULTRA/);
  // 술이 아니라고 했지만 라벨 글자가 사전의 브랜드
  const unsure = fakeAi(() => ({ response: JSON.stringify({ is_alcohol: false, name: '', label_text: 'JOHNNIE WALKER BLACK LABEL' }) }));
  const r2 = (await createWorkersAiIdentifier({ ai: unsure }).identify({ images: [{ mediaType: 'image/jpeg', data: TINY_JPEG }] })).result;
  assert.match(r2.name_ko, /조니워커/);
  // 진짜 술이 아니면 그대로
  const cola = fakeAi(() => ({ response: JSON.stringify({ is_alcohol: false, name: '', label_text: 'Coca-Cola Zero' }) }));
  const r3 = (await createWorkersAiIdentifier({ ai: cola }).identify({ images: [{ mediaType: 'image/jpeg', data: TINY_JPEG }] })).result;
  assert.equal(r3.is_alcohol, false);
  assert.equal(cola.calls.length, 1);
});

test('이름 질문: 모르는 이름은 지어내지 말라고 함, 사진 경로에서 모른다고 하면 종류 일반 설명', async () => {
  const text = buildWorkersAiInput({ text: 'Sengur Ultra' }).messages[1].content;
  assert.match(text, /확실히 모르면/);
  assert.match(text, /is_alcohol 을 false/);
  // 사진 경로: 설명 단계가 "모른다"(is_alcohol false)고 해도 사진의 종류로 일반 설명
  const vision = { is_alcohol: true, name: 'Sengur Ultra', category: 'beer', style: 'lager', label_text: 'SENGUR ULTRA EXTRA SMOOTH LAGER' };
  const ai = fakeAi((n) => (n === 1 ? { response: JSON.stringify(vision) } : { response: { is_alcohol: false, not_alcohol_reason: '이 이름의 술 정보를 찾지 못했어요.' } }));
  const r = (await createWorkersAiIdentifier({ ai }).identify({ images: [{ mediaType: 'image/jpeg', data: TINY_JPEG }] })).result;
  assert.equal(r.is_alcohol, true);
  assert.equal(r.category, 'beer');
  assert.equal(r.name_ko, 'Sengur Ultra');
  assert.match(r.how_to_drink.glass, /맥주/);
  assert.match(ai.calls[1].input.messages[1].content, /위 지시보다 우선/);
});

test('Workers AI 사진: "술 아님"이라고 해도 라벨에 도수·술 단서가 있으면 술로', async () => {
  // 실제로 있었던 일: 흐린 맥주 캔에서 "Sengur Ultra 4.7%"까지 읽고도 is_alcohol false
  assert.deepEqual(
    (({ name, category, abv, confidence }) => ({ name, category, abv, confidence }))(labelEvidence({ is_alcohol: false, label_text: 'Sengur Ultra 4.7%' })),
    { name: 'Sengur Ultra', category: 'beer', abv: '4.7%', confidence: 'low' },
  );
  assert.equal(labelEvidence({ is_alcohol: false, label_text: 'EXTRA SMOOTH LAGER' }).category, 'beer');
  assert.equal(labelEvidence({ is_alcohol: false, label_text: 'Chateau Obscur Bordeaux 13.5% vol' }).category, 'wine');
  assert.equal(labelEvidence({ is_alcohol: false, label_text: 'Coca-Cola Zero 355ml' }), null);
  assert.equal(labelEvidence({ is_alcohol: false, label_text: 'Mystery Spirit 40%' }), null); // 도수만으로는 종류를 모름
  const ai = fakeAi((n) => (n === 1 ? { response: JSON.stringify({ is_alcohol: false, name: '', label_text: 'Sengur Ultra 4.7%', why: 'not sure' }) } : { response: { ...SAMPLE, category: 'beer', name_ko: '셍구르 울트라', style: 'lager', price: { krw_low: 2500, krw_high: 4000 } } }));
  const r = (await createWorkersAiIdentifier({ ai }).identify({ images: [{ mediaType: 'image/jpeg', data: TINY_JPEG }] })).result;
  assert.equal(r.is_alcohol, true);
  assert.equal(r.category, 'beer');
  assert.equal(r.abv, '4.7%');
  assert.equal(r.confidence, 'low');
  assert.match(ai.calls[1].input.messages[1].content, /Sengur Ultra/);
});
