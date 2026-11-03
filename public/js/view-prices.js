// 최저가 탭: 소주·맥주·막걸리 내 주변 실제 판매 가격 (한국소비자원 참가격)
import { loadPrices } from './data.js';
import { fmtDistance } from './lib/geo.js';
import { comparePrices } from './lib/nearby.js';
import { openKcaStore } from './sheets.js';
import { onLocationChange, state } from './state.js';
import { escapeHtml, fmtDay, fmtWon, setPressed, storage } from './util.js';

const RADII = [3, 5, 10, 20, 50];
const KINDS = [
  { id: 'soju', label: '소주', emoji: '🟢' },
  { id: 'beer', label: '맥주', emoji: '🍺' },
  { id: 'makgeolli', label: '막걸리', emoji: '🍶' },
  { id: 'wine', label: '와인', emoji: '🍷' },
  { id: 'whisky', label: '위스키', emoji: '🥃' },
];
const PAGE = 20;
const prefs = { kind: 'soju', product: null, radius: 10, sort: 'price', ...storage.get('pricePrefs', {}) };
if (!RADII.includes(prefs.radius)) prefs.radius = 10;

let data = null;
let shown = PAGE;
let lastRows = [];
const els = {};
const save = () => storage.set('pricePrefs', prefs);

function productsOfKind(kind) {
  return data.products.filter((p) => p.kind === kind);
}

// 처음 고를 때 많이 찾는 상품부터
const PREFERRED = [/^참이슬\s*후레쉬/, /^카스/, /장수/];

function ensureProduct() {
  const kinds = KINDS.filter((k) => productsOfKind(k.id).length);
  if (!kinds.some((k) => k.id === prefs.kind)) prefs.kind = kinds[0]?.id;
  const list = productsOfKind(prefs.kind);
  if (!list.some((p) => p.id === prefs.product)) {
    const preferred = list.filter((p) => !p.pack).find((p) => PREFERRED.some((re) => re.test(p.name)));
    prefs.product = (preferred || list[0])?.id;
  }
  return kinds;
}

function render() {
  const loc = state.location;
  if (!data || !loc) return;
  const kinds = ensureProduct();
  els.kinds.innerHTML = kinds.map((k) => `<button type="button" class="chip" data-kind="${k.id}">${k.emoji} ${k.label}</button>`).join('');
  setPressed(els.kinds, 'data-kind', prefs.kind);
  els.products.innerHTML = productsOfKind(prefs.kind)
    .map((p) => `<button type="button" class="chip" data-product="${escapeHtml(p.id)}">${escapeHtml(p.name)} <small>${escapeHtml(p.pack || p.size)}</small></button>`)
    .join('');
  setPressed(els.products, 'data-product', prefs.product);
  els.radius.innerHTML = RADII.map((r) => `<button type="button" data-radius="${r}" aria-pressed="${r === prefs.radius}"><b>${r}km</b></button>`).join('');
  setPressed(els.sortToggle, 'data-sort', prefs.sort);

  const product = data.products.find((p) => p.id === prefs.product);
  if (!product) {
    els.hero.innerHTML = '';
    els.list.innerHTML = '<div class="empty"><strong>가격 자료가 없어요</strong></div>';
    return;
  }
  const result = comparePrices(data, product.id, loc, prefs.radius);
  const { stats, brands, expanded } = result;
  const rows = prefs.sort === 'distance' ? [...result.rows].sort((a, b) => a.d - b.d) : result.rows;
  lastRows = rows;
  const best = result.rows[0];
  const fullName = `${product.name} ${product.pack || product.size}`;
  // 편의점은 브랜드마다 조금씩 달라서 가운데 값을 "보통"으로
  const cvsTypical = brands.length ? [...brands].sort((a, b) => a.price - b.price)[Math.floor(brands.length / 2)].price : null;

  els.hero.innerHTML = best
    ? `<div class="price-hero">
        <div class="p-name">${escapeHtml(fullName)} · ${expanded ? `가까운 조사 매장 ${rows.length}곳 (${expanded}km 안)` : `${prefs.radius}km 안 ${stats.count}곳`}</div>
        <div class="p-min">${fmtWon(best.price)}<small>가장 싸요</small></div>
        <div class="p-where">${escapeHtml(best.store.n)} · ${fmtDistance(best.d)}${best.discount ? ' · 할인 중' : ''}${best.onePlusOne ? ' · 1+1' : ''}</div>
        <div class="p-stats">
          <div><small>주변 보통</small><b>${fmtWon(stats.median)}</b></div>
          <div><small>편의점 보통</small><b>${cvsTypical ? fmtWon(cvsTypical) : '-'}</b></div>
          <div><small>편의점보다</small><b>${cvsTypical && cvsTypical > best.price ? `${fmtWon(cvsTypical - best.price)} ↓` : '-'}</b></div>
        </div>
      </div>`
    : '';
  els.notice.hidden = !expanded;
  els.notice.textContent = expanded ? `${prefs.radius}km 안에 조사 매장이 없어서 가장 가까운 ${rows.length}곳을 보여드려요. 참가격은 전국 약 ${data.stores.length}곳의 대형마트·SSM·백화점만 조사해요.` : '';

  els.cvs.innerHTML = brands.length
    ? `<h3>🏪 편의점 가격 <small class="muted">전국 공통 (본사 조사)</small></h3>
       <div class="cvs-grid">${brands.map((b) => `<div><small>${escapeHtml(b.brand)}</small><b>${fmtWon(b.price)}</b>${b.onePlusOne ? '<br><span class="badge good">1+1</span>' : b.discount ? '<br><span class="badge good">할인</span>' : ''}</div>`).join('')}</div>
       <p class="note">가까운 편의점 어디서나 이 가격이에요. 행사(1+1·2+1)는 매장 앱에서 확인하세요.</p>`
    : '';
  els.cvs.hidden = !brands.length;

  if (!rows.length) {
    els.list.innerHTML = '<div class="empty"><strong>주변에 조사 매장이 없어요</strong>반경을 넓혀 보세요.</div>';
    els.more.hidden = true;
  } else {
    const median = stats.median;
    els.list.innerHTML = rows
      .slice(0, shown)
      .map((r, i) => {
        const diff = median ? r.price - median : 0;
        const rank = prefs.sort === 'price' ? i + 1 : '·';
        return `<button type="button" class="price-row${r.price === stats.min ? ' best' : ''}" data-row="${i}">
          <span class="rank">${rank}</span>
          <span class="n"><b>${escapeHtml(r.store.n)}</b><small>${escapeHtml(r.store.t)} · ${fmtDistance(r.d)}${r.store.a ? ` · ${escapeHtml(r.store.a)}` : ''}</small></span>
          <span class="p"><b>${fmtWon(r.price)}</b>${
            r.onePlusOne ? '<small class="cheaper">1+1</small>' : r.discount ? `<small class="cheaper">할인${r.dcEnd ? ` ~${escapeHtml(r.dcEnd.slice(5).replace('-', '/'))}` : ''}</small>` : diff < 0 ? `<small class="cheaper">${fmtWon(-diff)} 싸요</small>` : diff > 0 ? `<small class="pricier">+${fmtWon(diff)}</small>` : '<small class="pricier">보통</small>'
          }</span>
        </button>`;
      })
      .join('');
    els.more.hidden = rows.length <= shown;
    els.more.textContent = `더 보기 (${Math.min(shown, rows.length)} / ${rows.length})`;
  }
  els.dataLine.innerHTML = `한국소비자원 참가격 <b>${escapeHtml(fmtDay(data.inspectDay))}</b> 조사 가격 · 전국 ${data.stores.length}곳 (대형마트·SSM·백화점) · 매주 금요일 조사<br>조사한 날 가격이라 지금 매장 가격과 다를 수 있어요. 전국 최저 ${fmtWon(stats.nationMin)}, 전국 보통 ${fmtWon(stats.nationMedian)}.`;
}

async function load() {
  els.list.innerHTML = '<div class="card skeleton" aria-hidden="true"><div class="thumb"></div><div><div class="line" style="width:40%"></div><div class="line" style="width:80%"></div></div></div>';
  try {
    data = await loadPrices();
    render();
  } catch (err) {
    els.list.innerHTML = `<div class="error-box"><strong>가격 정보를 불러오지 못했어요</strong>${escapeHtml(err.message)}<br><button type="button" class="text-button" data-retry>다시 시도</button></div>`;
  }
}

function update(changes) {
  Object.assign(prefs, changes);
  shown = PAGE;
  save();
  render();
}

export function initPrices() {
  for (const id of ['priceKinds', 'priceProducts', 'priceRadius', 'priceSortToggle', 'priceHero', 'priceNotice', 'priceCvs', 'priceList', 'priceMore', 'priceDataLine']) {
    const key = id.replace('price', '');
    els[key.charAt(0).toLowerCase() + key.slice(1)] = document.getElementById(id);
  }
  els.kinds.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-kind]');
    if (btn && btn.dataset.kind !== prefs.kind) update({ kind: btn.dataset.kind, product: null });
  });
  els.products.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-product]');
    if (btn) update({ product: btn.dataset.product });
  });
  els.radius.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-radius]');
    if (btn) update({ radius: Number(btn.dataset.radius) });
  });
  els.sortToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sort]');
    if (btn) update({ sort: btn.dataset.sort });
  });
  els.more.addEventListener('click', () => {
    shown += PAGE;
    render();
  });
  document.getElementById('view-prices').addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) return load();
    const row = e.target.closest('[data-row]');
    if (row) {
      const r = lastRows[Number(row.dataset.row)];
      if (r) openKcaStore(r.store);
    }
  });
  onLocationChange(() => {
    if (data) render();
  });
}

/** #prices 또는 #prices/<참가격 상품 id> */
export function showPrices(sub = '') {
  if (sub) {
    prefs.product = sub;
    if (data) {
      const p = data.products.find((x) => x.id === sub);
      if (p) prefs.kind = p.kind;
    }
  }
  if (!data) {
    load().then(() => {
      const p = sub && data?.products.find((x) => x.id === sub);
      if (p && prefs.kind !== p.kind) update({ kind: p.kind, product: p.id });
    });
  } else render();
}
