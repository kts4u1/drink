// 화면 공통 도우미

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** http(s) 주소만 허용 */
export function safeUrl(url) {
  try {
    const u = new URL(url, location.href);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(`sulsul:${key}`);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`sulsul:${key}`, JSON.stringify(value));
    } catch {
      /* 저장 불가(사생활 보호 모드 등) - 무시 */
    }
  },
};

let toastTimer;
export function toast(message, duration = 2600) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, duration);
}

/** 1,240원 */
export function fmtWon(n) {
  return n == null ? '' : `${Math.round(n).toLocaleString('ko-KR')}원`;
}

/** 25000 → "2.5만", 4900 → "4,900" */
export function fmtWonShort(n) {
  if (n == null) return '';
  if (n >= 10000) {
    const man = n / 10000;
    // 13.5만처럼 소수 한 자리까지 (반올림해서 14만이 되면 다른 곳의 135,000원과 어긋나 보여서)
    return `${Number(man.toFixed(1))}만`;
  }
  return n.toLocaleString('ko-KR');
}

/** 참고 가격대 "약 2.5만~3.5만원" */
export function fmtPriceRange([lo, hi]) {
  if (lo == null) return '';
  if (lo === hi) return `약 ${fmtWonShort(lo)}원`;
  return `약 ${fmtWonShort(lo)}~${fmtWonShort(hi)}원`;
}

/** 2026-10-23 → 10월 23일(금) */
export function fmtDay(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const w = '일월화수목금토'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}월 ${d}일(${w})`;
}

/** 받침에 맞는 조사: josa('맛집', '을', '를') → '맛집을' */
export function josa(word, withBatchim, withoutBatchim) {
  const code = String(word).trim().slice(-1).charCodeAt(0) - 0xac00;
  const has = code >= 0 && code <= 11171 ? code % 28 !== 0 : false;
  return `${word}${has ? withBatchim : withoutBatchim}`;
}

export function setPressed(container, attr, value) {
  for (const btn of container.querySelectorAll(`[${attr}]`)) {
    btn.setAttribute('aria-pressed', String(btn.getAttribute(attr) === String(value)));
  }
}

// 술 종류별 색 (카드 위 줄·배경 틴트)
export const CATEGORY_COLORS = {
  wine: '#9f1239',
  whisky: '#b45309',
  beer: '#ca8a04',
  soju: '#15803d',
  traditional: '#78716c',
  sake: '#0369a1',
  brandy: '#9a3412',
  vodka: '#0e7490',
  gin: '#4d7c0f',
  rum: '#a16207',
  tequila: '#65a30d',
  liqueur: '#be185d',
  baijiu: '#b91c1c',
  cocktail: '#7c3aed',
};

export const ICON = {
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.6"/></svg>',
  route: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/></svg>',
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/></svg>',
  web: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
  tag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
};
