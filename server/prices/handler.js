// 사용자 가격 제보: 와인·위스키·양주는 공공 가격 자료가 없어서, 매장에서 본 실제 가격을 서로 알려 주기
// (Node 개발 서버와 Cloudflare Worker 공통. 저장소는 { get(key), put(key, value, ttlSeconds) })
//
//   GET  /api/prices        제품마다 요약 { 제품 id: { n, min, minStore, minT, last } }
//   GET  /api/prices/<id>   한 제품의 최근 제보 (최근 것 먼저)
//   POST /api/prices        제보 { id, price, store, storeId?, la?, lo?, ml? }
//
// 제보할 수 있는 제품은 앱 제품 목록(용량이 정해진 대표 제품)만 — 브랜드로 받으면 12년·18년 가격이 섞여서
import { PRODUCTS } from '../../public/js/content/index.js';
import { priceBounds } from '../../public/js/lib/prices.js';
import { kstDay } from '../identify/handler.js';

export { priceBounds };

export const REPORT_DAYS = 120; // 이보다 오래된 제보는 보여 주지 않음
const MAX_PER_PRODUCT = 60;
export const DAILY_REPORTS_PER_IP = 20;
const KEY_SUMMARY = 'pr:summary';
const keyProduct = (id) => `pr:p:${id}`;
const KEEP_SECONDS = REPORT_DAYS * 24 * 3600;
const DAY_MS = 24 * 3600 * 1000;

const PRODUCT_BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));

const fail = (status, error, code) => ({ status, body: { ok: false, error, code } });
const clean = (s, max) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** 제보 본문 검사 → { report, product } 또는 { error } */
export function parseReport(body) {
  const product = PRODUCT_BY_ID.get(String(body?.id || ''));
  if (!product) return { error: fail(400, '제보할 수 없는 제품이에요.', 'bad_product') };
  const price = Math.round(Number(body.price));
  if (!Number.isFinite(price) || price <= 0) return { error: fail(400, '가격을 숫자로 적어 주세요.', 'bad_price') };
  const [min, max] = priceBounds(product);
  if (price < min || price > max) return { error: fail(400, `참고 가격(${product.price[0].toLocaleString('ko-KR')}~${product.price[1].toLocaleString('ko-KR')}원)과 너무 달라요. 제품·용량을 확인해 주세요.`, 'price_out_of_range') };
  const store = clean(body.store, 40);
  if (store.length < 2) return { error: fail(400, '어느 매장인지 적어 주세요.', 'bad_store') };
  const report = { p: price, s: store, t: Date.now() };
  const sid = String(body.storeId || '');
  if (/^[a-z]{1,4}[\w-]{1,40}$/i.test(sid)) report.sid = sid;
  const la = Number(body.la);
  const lo = Number(body.lo);
  if (la > 32.8 && la < 38.9 && lo > 124 && lo < 132) {
    // 매장 위치는 100m 단위로만 (사람 위치가 아니라 매장 위치)
    report.la = Math.round(la * 1000) / 1000;
    report.lo = Math.round(lo * 1000) / 1000;
  }
  const ml = Math.round(Number(body.ml));
  if (ml >= 50 && ml <= 3000) report.ml = ml;
  return { report, product };
}

/** 제보 목록 → 요약 (최근 REPORT_DAYS 일) */
export function summarize(list, now = Date.now()) {
  const recent = (list || []).filter((r) => now - r.t <= REPORT_DAYS * DAY_MS);
  if (!recent.length) return null;
  const best = recent.reduce((a, b) => (b.p < a.p || (b.p === a.p && b.t > a.t) ? b : a));
  return { n: recent.length, min: best.p, minStore: best.s, minT: best.t, last: Math.max(...recent.map((r) => r.t)) };
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** POST /api/prices */
export async function handlePriceReport({ body, ip = 'unknown' }, { store, now = Date.now, dailyPerIp = DAILY_REPORTS_PER_IP }) {
  if (!store) return fail(503, '가격 제보가 아직 설정되지 않았어요.', 'not_configured');
  const parsed = parseReport(body);
  if (parsed.error) return parsed.error;
  const { report, product } = parsed;
  report.t = now();

  // IP 마다 하루 제보 수 (IP 는 해시만, 이틀 뒤 지워짐)
  const rlKey = `pr:rl:${kstDay(report.t)}:${(await sha256(`sulsul:${ip}`)).slice(0, 24)}`;
  const used = Number(await store.get(rlKey).catch(() => 0)) || 0;
  if (used >= dailyPerIp) return fail(429, '오늘은 제보를 충분히 해 주셨어요. 내일 다시 부탁드려요.', 'too_many_reports');

  const old = (await store.get(keyProduct(product.id)).catch(() => null)) || [];
  // 같은 매장·같은 가격을 하루 안에 또 보내면 하나로
  const dup = old.find((r) => r.p === report.p && r.s === report.s && report.t - r.t < DAY_MS);
  const list = dup ? old : [report, ...old].filter((r) => report.t - r.t <= REPORT_DAYS * DAY_MS).slice(0, MAX_PER_PRODUCT);
  await store.put(keyProduct(product.id), list, KEEP_SECONDS);
  const summary = (await store.get(KEY_SUMMARY).catch(() => null)) || {};
  const s = summarize(list, report.t);
  if (s) summary[product.id] = s;
  await store.put(KEY_SUMMARY, summary, KEEP_SECONDS * 3);
  await store.put(rlKey, used + 1, 2 * 24 * 3600);
  return { status: 200, body: { ok: true, duplicate: Boolean(dup), summary: s } };
}

/** GET /api/prices 또는 /api/prices/<id> */
export async function handlePriceGet({ id = '' }, { store, now = Date.now }) {
  if (!store) return fail(503, '가격 제보가 아직 설정되지 않았어요.', 'not_configured');
  const t = now();
  if (id) {
    if (!PRODUCT_BY_ID.has(id)) return fail(404, '없는 제품이에요.', 'bad_product');
    const list = ((await store.get(keyProduct(id)).catch(() => null)) || []).filter((r) => t - r.t <= REPORT_DAYS * DAY_MS);
    return { status: 200, body: { ok: true, id, days: REPORT_DAYS, reports: list } };
  }
  const summary = (await store.get(KEY_SUMMARY).catch(() => null)) || {};
  // 오래된 요약은 빼고
  const fresh = Object.fromEntries(Object.entries(summary).filter(([, s]) => s && t - s.last <= REPORT_DAYS * DAY_MS));
  return { status: 200, body: { ok: true, days: REPORT_DAYS, summary: fresh } };
}
