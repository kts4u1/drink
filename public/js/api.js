// 서버(API) 연결: config.json 의 apiBase (비어 있으면 같은 주소의 ./api), 상태 확인, 가격 제보
let cfg = null;
let healthReq = null;
let summaryReq = null;
let summaryAt = 0;
const SUMMARY_TTL = 5 * 60 * 1000;
const JSON_HEADERS = { Accept: 'application/json' };

/** { base, enabled } — 배포본에 Worker 주소가 없으면 enabled: false */
export async function apiConfig() {
  if (cfg) return cfg;
  try {
    const res = await fetch('config.json', { cache: 'no-store' });
    const c = res.ok ? await res.json() : {};
    cfg = { base: String(c.apiBase || '').replace(/\/+$/, ''), enabled: c.api !== false };
  } catch {
    cfg = { base: '', enabled: true };
  }
  return cfg;
}

/** apiConfig() 를 먼저 기다린 뒤에 쓰기 */
export const apiUrl = (path) => `${cfg?.base || '.'}/api/${path}`;

/** /api/health 결과 (한 번만 물어봄, 연결이 안 되면 다음에 다시) → body 또는 null */
export function apiHealth() {
  healthReq ||= (async () => {
    const c = await apiConfig();
    if (!c.enabled) return null;
    try {
      const res = await fetch(apiUrl('health'), { headers: JSON_HEADERS, signal: AbortSignal.timeout(8000) });
      return res.ok ? await res.json() : null;
    } catch {
      healthReq = null;
      return null;
    }
  })();
  return healthReq;
}

/** 가격 제보를 쓸 수 있는지 */
export async function pricesEnabled() {
  return Boolean((await apiHealth())?.prices);
}

/** 제품마다 제보 요약 { id: { n, min, minStore, minT, last } } — 제보를 못 쓰면 null */
export async function priceSummary({ fresh = false } = {}) {
  if (!(await pricesEnabled())) return null;
  if (!summaryReq || fresh || Date.now() - summaryAt > SUMMARY_TTL) {
    summaryAt = Date.now();
    summaryReq = fetch(apiUrl('prices'), { headers: JSON_HEADERS, signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b) => b.summary || {})
      .catch(() => {
        summaryReq = null;
        return null;
      });
  }
  return summaryReq;
}

/** 한 제품의 최근 제보 (최근 것 먼저) — 못 받으면 null */
export async function productReports(id) {
  if (!(await pricesEnabled())) return null;
  try {
    const res = await fetch(apiUrl(`prices/${encodeURIComponent(id)}`), { headers: JSON_HEADERS, signal: AbortSignal.timeout(8000) });
    return res.ok ? (await res.json()).reports || [] : null;
  } catch {
    return null;
  }
}

/** 제보 보내기 → { ok, error?, summary? } */
export async function sendPriceReport(report) {
  await apiConfig();
  try {
    const res = await fetch(apiUrl('prices'), {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(10000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) return { ok: false, error: body.error || `제보를 보내지 못했어요 (${res.status})` };
    summaryReq = null; // 다음에 요약을 새로 받기
    return { ok: true, summary: body.summary, duplicate: body.duplicate };
  } catch {
    return { ok: false, error: '인터넷 연결을 확인하고 다시 보내 주세요.' };
  }
}
