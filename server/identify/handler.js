// POST /api/identify 처리 (Node 개발 서버와 Cloudflare Worker 공통)
//
// 요청 본문(JSON): { images?: ['data:image/jpeg;base64,...' 최대 3장], text?: '술 이름' }
// 응답: { ok: true, result, cached, model } 또는 { error, code }
//
// 비용을 지키기 위해
//   - 사진·이름이 같으면 저장해 둔 결과를 다시 씀 (7일)
//   - 하루 전체 사용 횟수 제한 (dailyLimit, 한국 시간 기준)
//   - IP 마다 짧은 시간 제한 (limiter)
import { cleanQueryText, normalizeResult } from '../../public/js/lib/identify.js';
import { IdentifyError } from './claude.js';

export const MAX_IMAGES = 3;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 한 장 (화면에서 1600px 로 줄여 보내서 보통 0.3~0.8MB)
export const MAX_TOTAL_BYTES = 9 * 1024 * 1024;
export const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const CACHE_VERSION = 'v3'; // v1: 한국어가 깨진 사진 결과, v2: 맥주 사진에 위스키 설명이 붙은 결과가 저장돼 있어 버림

const DATA_URL = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;

function fail(status, error, code) {
  return { status, body: { error, code } };
}

/** 한국 시간 날짜 (하루 사용량 집계용) */
export function kstDay(now = Date.now()) {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 요청 본문 검사 → { images, text } 또는 오류 응답 */
export function parseInput(body) {
  if (!body || typeof body !== 'object') return { error: fail(400, '요청 형식이 올바르지 않아요.', 'bad_input') };
  const rawImages = body.images ?? [];
  if (!Array.isArray(rawImages)) return { error: fail(400, '사진 형식이 올바르지 않아요.', 'bad_input') };
  if (rawImages.length > MAX_IMAGES) return { error: fail(400, `사진은 ${MAX_IMAGES}장까지 보낼 수 있어요.`, 'too_many_images') };
  const images = [];
  let total = 0;
  for (const item of rawImages) {
    const m = typeof item === 'string' ? item.match(DATA_URL) : null;
    if (!m) return { error: fail(400, 'JPG·PNG·WEBP 사진만 보낼 수 있어요.', 'bad_image') };
    const bytes = Math.floor((m[2].length * 3) / 4);
    if (bytes > MAX_IMAGE_BYTES) return { error: fail(413, '사진이 너무 커요. 다시 찍어 주세요.', 'image_too_large') };
    total += bytes;
    images.push({ mediaType: m[1], data: m[2] });
  }
  if (total > MAX_TOTAL_BYTES) return { error: fail(413, '사진이 너무 커요. 장 수를 줄여 주세요.', 'image_too_large') };
  const text = cleanQueryText(body.text);
  if (!images.length && text.length < 2) return { error: fail(400, '사진을 올리거나 술 이름을 두 글자 이상 적어 주세요.', 'empty') };
  return { images, text };
}

/**
 * deps:
 *   identifier: createIdentifier(...) 결과 (없으면 설정 안 됨)
 *   store: { get(key), put(key, value, ttlSeconds) } — 결과 캐시와 하루 사용량
 *   limiter: async (ip) => boolean — IP 별 짧은 시간 제한 (없으면 통과)
 *   dailyLimit: 하루 최대 AI 호출 수 (0 이면 제한 없음)
 */
export async function handleIdentify({ body, ip = 'unknown' }, { identifier, store, limiter, dailyLimit = 100, now = Date.now, log = () => {} }) {
  if (!identifier) return fail(503, '사진 인식이 아직 설정되지 않았어요 (서버에 ANTHROPIC_API_KEY 필요).', 'not_configured');
  const input = parseInput(body);
  if (input.error) return input.error;
  const { images, text } = input;

  const key = `${CACHE_VERSION}:${images.length ? `i:${await sha256(images.map((i) => i.data).join('|') + '|' + text)}` : `t:${text.toLowerCase()}`}`;
  try {
    const cached = await store?.get(key);
    if (cached) return { status: 200, body: { ok: true, result: cached.result, model: cached.model, cached: true } };
  } catch {
    /* 캐시를 못 읽어도 계속 */
  }

  if (limiter && !(await limiter(ip))) return fail(429, '너무 자주 요청했어요. 1분쯤 뒤에 다시 시도해 주세요.', 'rate_limited');

  const dayKey = `count:${kstDay(now())}`;
  let used = 0;
  if (dailyLimit > 0 && store) {
    try {
      used = Number(await store.get(dayKey)) || 0;
    } catch {
      used = 0;
    }
    if (used >= dailyLimit) return fail(429, '오늘 사진 인식 사용량을 모두 썼어요. 내일 다시 이용해 주세요.', 'daily_limit');
  }

  // 실패해도 AI 사용량은 쓰니까 부르기 전에 셈
  try {
    if (dailyLimit > 0 && store) await store.put(dayKey, used + 1, 2 * 24 * 3600);
  } catch {
    /* 저장 실패는 무시 */
  }

  let out;
  try {
    out = await identifier.identify({ images, text });
  } catch (err) {
    if (err instanceof IdentifyError) {
      if (err.detail) log(`[identify] ${err.code} ${JSON.stringify(err.detail)}`);
      const res = fail(err.status, err.message, err.code);
      // 원인을 찾을 수 있게 짧은 진단 정보 (AI 가 만든 글 일부와 오류 문구만, 비밀 정보 없음)
      if (err.detail) res.body.detail = err.detail;
      return res;
    }
    log(err);
    return fail(500, '서버 오류가 발생했어요.', 'server');
  }
  const result = normalizeResult(out.result);
  try {
    // 술이 아니라고 나온 결과는 다시 찍을 수 있게 저장하지 않음
    if (result.is_alcohol && store) await store.put(key, { result, model: out.model }, CACHE_TTL_SECONDS);
  } catch {
    /* 저장 실패는 무시 */
  }
  log(`[identify] ${images.length ? `사진 ${images.length}장` : `"${text}"`} → ${result.name_ko || '(알아보지 못함)'} (${out.usage?.input_tokens ?? '?'}+${out.usage?.output_tokens ?? '?'} 토큰)`);
  return { status: 200, body: { ok: true, result, model: out.model, cached: false } };
}

/** GET /api/health */
export function healthBody({ identifier, dailyLimit }) {
  return {
    ok: true,
    identify: Boolean(identifier),
    provider: identifier ? identifier.provider || 'anthropic' : null,
    free: Boolean(identifier?.free),
    model: identifier?.model ?? null,
    dailyLimit: dailyLimit || null,
  };
}

/** 메모리 저장소 (Node 개발 서버, 또는 Worker 에 KV 가 없을 때) */
export function createMemoryStore(maxEntries = 500) {
  const map = new Map();
  return {
    async get(key) {
      const v = map.get(key);
      if (!v) return null;
      if (v.expires < Date.now()) {
        map.delete(key);
        return null;
      }
      return structuredClone(v.value);
    },
    async put(key, value, ttlSeconds = 3600) {
      map.delete(key);
      map.set(key, { value: structuredClone(value), expires: Date.now() + ttlSeconds * 1000 });
      while (map.size > maxEntries) map.delete(map.keys().next().value);
    },
  };
}

/** IP 마다 windowMs 안에 limit 번까지 (Node 개발 서버용) */
export function createMemoryLimiter({ limit = 6, windowMs = 60_000 } = {}) {
  const hits = new Map();
  return async (ip) => {
    const t = Date.now();
    const recent = (hits.get(ip) || []).filter((x) => t - x < windowMs);
    if (recent.length >= limit) {
      hits.set(ip, recent);
      return false;
    }
    recent.push(t);
    hits.set(ip, recent);
    if (hits.size > 5000) hits.delete(hits.keys().next().value);
    return true;
  };
}
