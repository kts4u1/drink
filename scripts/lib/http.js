// 데이터 받기용 fetch 도우미 (시간 제한 + 다시 시도)

export async function fetchWithTimeout(url, { timeoutMs = 60000, ...init } = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  return res;
}

export async function fetchJson(url, { retries = 2, retryDelayMs = 1500, ...opts } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status} (${url})`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, retryDelayMs * 2 ** attempt));
    }
  }
  throw lastErr;
}

/** items 를 limit 개씩 동시에 처리 */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
