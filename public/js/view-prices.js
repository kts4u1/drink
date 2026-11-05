// 최저가 탭
// - 와인·위스키·양주·사케·전통주: 공공 가격 자료가 없어서, 참고 가격대로 "얼마면 싼 편"인지, 판매처별 대략적인 가격,
//   싸게 사기 좋은 때, 가까운 싼 곳 (제품 화면에는 오늘 가격을 볼 수 있는 사이트 링크)
// - 소주·맥주·막걸리: 한국소비자원 참가격이 조사한 내 주변 실제 판매 가격
import { BRANDS } from './content/brands.js';
import { CATEGORY_BY_ID, PRODUCTS, SHOP_TYPES, STORE_KINDS } from './content/index.js';
import { loadPrices, loadStores } from './data.js';
import { fmtDistance } from './lib/geo.js';
import { comparePrices, storeFilter, storesWithin } from './lib/nearby.js';
import { TIER_RANGES, searchBrands } from './lib/label.js';
import { BUDGETS, CHEAP_PLACES, DAILY_GROUP, PRICE_GROUPS, channelPrices, goodPrice, groupOf, inBudget, priceProducts, saleSeasons, seasonText, sortPriceProducts } from './lib/prices.js';
import { searchProducts } from './lib/search.js';
import { canComparePrice, openKcaStore, openProduct, openStore } from './sheets.js';
import { askText } from './snap.js';
import { onLocationChange, state } from './state.js';
import { debounce, escapeHtml, fmtDay, fmtWon, fmtWonShort, setPressed, storage } from './util.js';

const RADII = [3, 5, 10, 20, 50];
const KINDS = [
  { id: 'soju', label: '소주', emoji: '🟢' },
  { id: 'beer', label: '맥주', emoji: '🍺' },
  { id: 'makgeolli', label: '막걸리', emoji: '🍶' },
];
const GROUP_IDS = [...PRICE_GROUPS.map((g) => g.id), DAILY_GROUP.id];
const PAGE = 20;
const prefs = { group: 'whisky', budget: 'all', order: 'pop', kind: 'soju', product: null, radius: 10, sort: 'price', ...storage.get('pricePrefs', {}) };
if (!RADII.includes(prefs.radius)) prefs.radius = 10;
if (!GROUP_IDS.includes(prefs.group)) prefs.group = 'whisky';
if (!BUDGETS.some((b) => b.id === prefs.budget)) prefs.budget = 'all';
if (!['pop', 'low', 'high'].includes(prefs.order)) prefs.order = 'pop';

let data = null; // 참가격
let query = '';
let shown = PAGE;
let lastRows = [];
const els = {};
const save = () => storage.set('pricePrefs', prefs);
const isDaily = () => prefs.group === DAILY_GROUP.id;

// ---------- 묶음 고르기 ----------

function renderGroups() {
  const groups = [...PRICE_GROUPS.map((g) => ({ ...g, count: priceProducts(PRODUCTS, g.id).length })), DAILY_GROUP];
  els.groups.innerHTML = groups
    .map((g) => `<button type="button" class="chip" data-group="${g.id}">${g.emoji} ${g.label}${g.count ? ` <span class="count">${g.count}</span>` : ''}</button>`)
    .join('');
  setPressed(els.groups, 'data-group', prefs.group);
  els.premium.hidden = isDaily();
  els.daily.hidden = !isDaily();
  els.lead.textContent = isDaily()
    ? '한국소비자원 참가격이 매주 조사한 실제 판매 가격이에요. 소주·맥주·막걸리는 어디서 사면 싼지 매장별로 비교해 보세요.'
    : '와인·위스키·양주는 같은 술도 어디서 사느냐에 따라 값이 크게 달라요. 얼마면 싼 편인지, 어디서 사면 싼지, 언제 사면 싼지 알려드려요.';
}

function render() {
  renderGroups();
  if (isDaily()) {
    if (!data) loadDaily();
    else renderDaily();
  } else renderPremium();
}

// ---------- 와인·위스키·양주 ----------

function premiumList() {
  let list = priceProducts(PRODUCTS, prefs.group).filter((p) => inBudget(p, prefs.budget));
  if (query.trim()) {
    // 검색어가 있으면 묶음과 관계없이 전체에서 (위스키 칸에서 "몬테스"를 찾아도 나오게)
    list = searchProducts(priceProducts(PRODUCTS), query).filter((p) => inBudget(p, prefs.budget));
    return list;
  }
  return sortPriceProducts(list, prefs.order);
}

// 브랜드 사전에서 이 묶음의 술 종류 (검색할 때 목록에 없는 브랜드도 가격대를 보여 줌)
const PREMIUM_CATS = new Set(PRICE_GROUPS.flatMap((g) => g.cats));

/** 검색어에 맞는 브랜드 (앱 제품 목록에 이미 나온 브랜드는 빼고) → [{ brand, range }] */
function brandMatches(products) {
  if (query.trim().length < 2) return [];
  const shown = products.map((p) => `${p.name} ${p.en || ''} ${(p.aliases || []).join(' ')}`.toLowerCase());
  return searchBrands(BRANDS, query, 8)
    .filter((b) => PREMIUM_CATS.has(b.cat))
    .filter((b) => !shown.some((t) => t.includes(b.ko.toLowerCase()) || b.names.some((n) => n.length >= 4 && t.includes(n.toLowerCase()))))
    .map((b) => ({ brand: b, range: (TIER_RANGES[b.cat] || TIER_RANGES.default)[Math.min(b.tier || 1, 4)] }))
    .filter((x) => x.range)
    .slice(0, 5);
}

function brandHtml({ brand, range }) {
  const cat = CATEGORY_BY_ID[brand.cat];
  return `<button type="button" class="price-item brand-item" data-brand="${escapeHtml(brand.ko)}">
    <span class="em" aria-hidden="true">${cat?.emoji || '🍾'}</span>
    <span class="n"><b>${escapeHtml(brand.ko)}</b><small>${escapeHtml(brand.style || cat?.name || '')}${brand.flagship ? ` · 대표 ${escapeHtml(brand.flagship)}` : ''}</small></span>
    <span class="p"><b>${fmtWonShort(range[0])}~${fmtWonShort(range[1])}원</b><small class="muted">브랜드 가격대</small></span>
  </button>`;
}

function itemHtml(p) {
  const cat = CATEGORY_BY_ID[p.cat];
  const cheapest = channelPrices(p)[0];
  const meta = [p.sub, p.ml ? `${p.ml}ml` : ''].filter(Boolean).join(' · ');
  return `<button type="button" class="price-item" data-product="${escapeHtml(p.id)}">
    <span class="em" aria-hidden="true">${cat?.emoji || '🍾'}</span>
    <span class="n"><b>${escapeHtml(p.name)}</b><small>${escapeHtml(meta)}</small></span>
    <span class="p"><b>${fmtWonShort(p.price[0])}~${fmtWonShort(p.price[1])}원</b><small class="v-cheap">${fmtWonShort(goodPrice(p))} 이하면 싼 편</small></span>
    <span class="rep">${cheapest.emoji} ${escapeHtml(cheapest.name)}에서 <b>${fmtWonShort(cheapest.lo)}~${fmtWonShort(cheapest.hi)}원</b>쯤${p.buyNote ? ` · ${escapeHtml(p.buyNote)}` : ''}</span>
  </button>`;
}

function renderPremium() {
  els.budget.innerHTML = BUDGETS.map((b) => `<button type="button" class="chip" data-budget="${b.id}">${b.label}</button>`).join('');
  setPressed(els.budget, 'data-budget', prefs.budget);
  setPressed(els.order, 'data-order', prefs.order);
  const list = premiumList();
  const brands = brandMatches(list);
  if (!list.length && !brands.length) {
    els.items.innerHTML = `<div class="empty"><strong>찾는 제품이 없어요</strong>다른 술은 📷 사진·이름으로 알아보면 참고 가격대를 알려드려요.</div>`;
  } else {
    els.items.innerHTML =
      list.map(itemHtml).join('') +
      (brands.length ? `<h3 class="list-sub">브랜드 사전 <small>대표 제품 기준 가격대 · 누르면 자세히</small></h3>${brands.map(brandHtml).join('')}` : '');
  }
  els.itemsLine.innerHTML =
    '참고 가격: 2025~2026년 국내 대형마트·창고형 마트·주류 전문점의 대략적인 판매가 범위예요(인기 제품은 2026년 하반기 공개 판매가로 다시 맞춤). "싼 편"은 그 범위의 아래쪽 4분의 1이에요.<br>제품을 누르면 판매처별 대략적인 가격, 가까운 매장, 오늘 가격을 볼 수 있는 사이트(위스키와치·데일리샷·네이버)가 나와요.';
  renderSeasons();
  renderCheapPlaces();
}

/** 이 술을 싸게 사기 좋은 가장 가까운 가게 (창고형 마트, 주류 할인점, 와인샵 …) */
async function renderCheapPlaces() {
  const loc = state.location;
  const keys = CHEAP_PLACES[prefs.group];
  if (!loc || !keys) {
    els.cheap.hidden = true;
    return;
  }
  const group = prefs.group;
  let stores;
  try {
    ({ stores } = await loadStores());
  } catch {
    els.cheap.hidden = true;
    return;
  }
  if (group !== prefs.group || state.location !== loc) return;
  const near = storesWithin(stores, loc, 30);
  const rows = keys
    .map((key) => {
      const s = near.find(storeFilter(key, SHOP_TYPES));
      if (!s) return '';
      const type = key.startsWith('shop:') ? SHOP_TYPES.find((t) => t.id === key.slice(5)) : STORE_KINDS[key];
      return `<button type="button" class="cheap-place k-${s.k}" data-store-id="${escapeHtml(s.id)}">
        <span class="em" aria-hidden="true">${type?.emoji || '🍾'}</span>
        <span class="n"><small>${escapeHtml(type?.name || '')}</small><b>${escapeHtml(s.n)}</b></span>
        <span class="d">${fmtDistance(s.d)}</span>
      </button>`;
    })
    .filter(Boolean);
  els.cheap.hidden = !rows.length;
  els.cheap.innerHTML = rows.length
    ? `<h3>📍 가까운 싸게 사기 좋은 곳</h3><div class="cheap-grid">${rows.join('')}</div><a class="text-link" href="#nearby">내 주변에서 가게 더 보기 →</a>`
    : '';
}

/** 다음 할인 행사 (명절 선물 세트 행사, 연말 행사) */
function renderSeasons() {
  const seasons = saleSeasons();
  const wine = prefs.group === 'wine' ? '<span>🍷 대형마트 와인 장터는 보통 봄·가을에 열려요</span>' : '';
  els.season.innerHTML = seasons.length || wine ? `<b>📅 싸게 사기 좋은 때</b>${seasons.map((x) => `<span class="${x.active ? 'on' : ''}">${escapeHtml(seasonText(x))}</span>`).join('')}${wine}` : '';
  els.season.hidden = !els.season.innerHTML;
}

// ---------- 소주·맥주·막걸리 (참가격) ----------

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

function renderDaily() {
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

async function loadDaily() {
  els.list.innerHTML = '<div class="card skeleton" aria-hidden="true"><div class="thumb"></div><div><div class="line" style="width:40%"></div><div class="line" style="width:80%"></div></div></div>';
  try {
    data = await loadPrices();
    if (isDaily()) renderDaily();
  } catch (err) {
    els.list.innerHTML = `<div class="error-box"><strong>가격 정보를 불러오지 못했어요</strong>${escapeHtml(err.message)}<br><button type="button" class="text-button" data-retry>다시 시도</button></div>`;
  }
}

// ---------- 공통 ----------

function update(changes) {
  Object.assign(prefs, changes);
  shown = PAGE;
  save();
  render();
}

export function initPrices() {
  for (const id of ['priceLead', 'priceGroups', 'pricePremium', 'priceDaily', 'priceSearch', 'priceBudget', 'priceOrder', 'priceSeason', 'priceCheap', 'priceItems', 'priceItemsLine', 'priceKinds', 'priceProducts', 'priceRadius', 'priceSortToggle', 'priceHero', 'priceNotice', 'priceCvs', 'priceList', 'priceMore', 'priceDataLine']) {
    const key = id.replace('price', '');
    els[key.charAt(0).toLowerCase() + key.slice(1)] = document.getElementById(id);
  }
  els.groups.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-group]');
    if (btn && btn.dataset.group !== prefs.group) update({ group: btn.dataset.group });
  });
  els.budget.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-budget]');
    if (btn) update({ budget: btn.dataset.budget });
  });
  els.order.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-order]');
    if (btn) update({ order: btn.dataset.order });
  });
  els.search.addEventListener(
    'input',
    debounce(() => {
      query = els.search.value;
      renderPremium();
    }, 150),
  );
  els.items.addEventListener('click', (e) => {
    const brand = e.target.closest('[data-brand]');
    if (brand) return askText(brand.dataset.brand);
    const btn = e.target.closest('[data-product]');
    const p = btn && PRODUCTS.find((x) => x.id === btn.dataset.product);
    if (p) openProduct(p, { focus: 'price' });
  });
  els.cheap.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-store-id]');
    if (!btn) return;
    const { stores } = await loadStores();
    const s = stores.find((x) => x.id === btn.dataset.storeId);
    if (s) openStore(s);
  });
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
    renderDaily();
  });
  els.daily.addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) return loadDaily();
    const row = e.target.closest('[data-row]');
    if (row) {
      const r = lastRows[Number(row.dataset.row)];
      if (r) openKcaStore(r.store);
    }
  });
  onLocationChange(() => {
    if (!document.getElementById('view-prices').hidden) render();
  });
}

/** #prices · #prices/<제품 id>(와인·위스키 가격 비교 열기) · #prices/<참가격 상품 id>(소주·맥주·막걸리) */
export function showPrices(sub = '') {
  const product = sub && PRODUCTS.find((x) => x.id === sub);
  if (product && canComparePrice(product)) {
    const group = groupOf(product);
    if (group) Object.assign(prefs, { group: group.id });
  } else if (sub) {
    Object.assign(prefs, { group: DAILY_GROUP.id, product: sub });
    if (data) {
      const p = data.products.find((x) => x.id === sub);
      if (p) prefs.kind = p.kind;
    } else {
      loadPrices()
        .then((d) => {
          const p = d.products.find((x) => x.id === sub);
          if (p && prefs.kind !== p.kind) update({ kind: p.kind, product: p.id });
        })
        .catch(() => {});
    }
  }
  render();
  if (product && canComparePrice(product)) openProduct(product, { focus: 'price' });
}
