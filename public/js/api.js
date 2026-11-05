// 서버(API) 연결: config.json 의 apiBase (비어 있으면 같은 주소의 ./api), 상태 확인
let cfg = null;
let healthReq = null;

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
      const res = await fetch(apiUrl('health'), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      return res.ok ? await res.json() : null;
    } catch {
      healthReq = null;
      return null;
    }
  })();
  return healthReq;
}
