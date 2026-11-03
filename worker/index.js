// Cloudflare Worker: 사진으로 술 알아보기 API
//   POST /api/identify   사진(최대 3장) 또는 이름 → Claude 가 알아본 결과
//   GET  /api/health     설정 상태
//
// 화면은 GitHub Pages(https://kts4u1.github.io/drink/)에 있고 이 Worker 는 API 만 맡습니다.
// API 키(ANTHROPIC_API_KEY)는 Worker 시크릿에만 있고 브라우저로 나가지 않습니다.
//
// 설정 (wrangler.jsonc)
//   vars.ALLOWED_ORIGINS  이 주소들의 화면만 API 를 부를 수 있음 (쉼표로 구분)
//   vars.DAILY_LIMIT      하루 최대 AI 호출 수 (비용 보호)
//   vars.CLAUDE_MODEL     쓸 모델 (기본 claude-opus-5-5)
//   IDENTIFY_LIMITER      IP 별 1분 제한 (Rate Limiting 바인딩)
//   CACHE                 결과 캐시·하루 사용량 (Workers KV)
import { DEFAULT_MODEL, createIdentifier } from '../server/identify/claude.js';
import { createMemoryStore, handleIdentify, healthBody } from '../server/identify/handler.js';

const memoryStore = createMemoryStore(200);

function kvStore(kv) {
  return {
    async get(key) {
      return kv.get(key, 'json');
    },
    async put(key, value, ttlSeconds) {
      await kv.put(key, JSON.stringify(value), ttlSeconds ? { expirationTtl: Math.max(60, ttlSeconds) } : undefined);
    },
  };
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  const list = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.includes(origin)) return origin;
  // 내 PC 에서 시험할 때
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

function json(body, status, origin) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function identifierForEnv(env) {
  if (!env.ANTHROPIC_API_KEY) return null;
  return createIdentifier({
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.CLAUDE_MODEL || DEFAULT_MODEL,
    baseURL: env.ANTHROPIC_BASE_URL || undefined, // 테스트용
  });
}

const MAX_BODY_BYTES = 12 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);

    if (request.method === 'OPTIONS') {
      if (!origin) return new Response(null, { status: 403 });
      const headers = new Headers(json({}, 200, origin).headers);
      headers.delete('Content-Type');
      return new Response(null, { status: 204, headers });
    }

    const dailyLimit = Number(env.DAILY_LIMIT ?? 100) || 0;
    const identifier = identifierForEnv(env);

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json(healthBody({ identifier, dailyLimit }), 200, origin);
    }

    if (url.pathname === '/api/identify') {
      if (request.method !== 'POST') return json({ error: 'POST 로 보내 주세요.' }, 405, origin);
      // 다른 사이트에서 이 API 를 가져다 쓰지 못하게 (브라우저 요청은 Origin 이 붙음)
      if (!origin) return json({ error: '허용되지 않은 주소에서 온 요청이에요.', code: 'forbidden_origin' }, 403, null);
      const length = Number(request.headers.get('Content-Length') || 0);
      if (length > MAX_BODY_BYTES) return json({ error: '사진이 너무 커요.', code: 'image_too_large' }, 413, origin);
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: '요청 형식이 올바르지 않아요.', code: 'bad_input' }, 400, origin);
      }
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const limiter = env.IDENTIFY_LIMITER
        ? async (key) => {
            try {
              const { success } = await env.IDENTIFY_LIMITER.limit({ key });
              return success;
            } catch {
              return true;
            }
          }
        : null;
      const { status, body: out } = await handleIdentify(
        { body, ip },
        { identifier, store: env.CACHE ? kvStore(env.CACHE) : memoryStore, limiter, dailyLimit, log: (m) => console.log(m) },
      );
      return json(out, status, origin);
    }

    return json({ error: '없는 API 입니다.' }, 404, origin);
  },
};
