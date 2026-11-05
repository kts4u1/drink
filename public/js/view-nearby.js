// 내 주변 탭: 술 살 수 있는 곳 (OpenStreetMap + 소상공인 상가정보의 동네 술 가게 + 참가격 조사 매장)
import { SHOP_TYPES, STORE_KINDS, STORE_KIND_ORDER } from './content/index.js';
import { loadStores } from './data.js';
import { fmtDistance } from './lib/geo.js';
import { shopTypeOf, sortStores, storeFilter, storesWithin } from './lib/nearby.js';
import { pickLocationOnMap } from './location.js';
import { KIND_COLORS, StoreMap } from './map.js';
import { areaPrefix, mapSearchLinks, placeName } from './place.js';
import { openStore } from './sheets.js';
import { onLocationChange, state } from './state.js';
import { ICON, escapeHtml, josa, setPressed, storage } from './util.js';

const RADII = [1, 3, 5, 10, 20];
const PAGE = 30;
const prefs = { kind: 'all', radius: 5, sort: 'distance', view: 'list', ...storage.get('nearPrefs', {}) };
if (!RADII.includes(prefs.radius)) prefs.radius = 5;
const validKind = (k) => k === 'all' || Boolean(STORE_KINDS[k]) || SHOP_TYPES.some((t) => `shop:${t.id}` === k);
if (!validKind(prefs.kind)) prefs.kind = 'all';
const typeById = Object.fromEntries(SHOP_TYPES.map((t) => [t.id, t]));
const shopType = (s) => typeById[shopTypeOf(s, SHOP_TYPES)];
/** 고른 것 이름·검색어·주의 */
function selection(key) {
  if (key.startsWith('shop:')) {
    const t = typeById[key.slice(5)];
    return { name: t.name, search: t.search, caution: t.id === 'etc' ? STORE_KINDS.shop.caution : '' };
  }
  if (key === 'all') return { name: '술 살 수 있는 곳', search: ['와인샵', '보틀샵', '주류 할인점', '전통주'], caution: '' };
  return { name: STORE_KINDS[key].name, search: STORE_KINDS[key].search, caution: STORE_KINDS[key].caution || '' };
}

let data = null;
let shown = PAGE;
let map = null;
let lastItems = [];
const els = {};
const save = () => storage.set('nearPrefs', prefs);

/** 종류 칩: 전체 · 주류 전문점(와인샵·보틀샵·할인점·전통주로도 나눠 고르기) · 창고형 · 대형마트 … */
function kindChips(within) {
  const counts = {};
  for (const s of within) {
    counts[s.k] = (counts[s.k] || 0) + 1;
    if (s.k === 'shop') {
      const key = `shop:${shopTypeOf(s, SHOP_TYPES)}`;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  const chip = (key, emoji, label) => `<button type="button" class="chip" data-kind="${key}">${emoji} ${escapeHtml(label)} <span class="count">${counts[key] || 0}</span></button>`;
  els.kinds.innerHTML = [
    `<button type="button" class="chip" data-kind="all">전체 <span class="count">${within.length}</span></button>`,
    chip('shop', STORE_KINDS.shop.emoji, '주류 전문점'),
    // 가게 종류는 반경 안에 있을 때만 (지금 고른 것은 늘 보임). "주류 판매점"은 주류 전문점에 들어 있어요
    ...SHOP_TYPES.filter((t) => t.id !== 'etc' && (counts[`shop:${t.id}`] || prefs.kind === `shop:${t.id}`)).map((t) => chip(`shop:${t.id}`, t.emoji, t.short)),
    ...STORE_KIND_ORDER.filter((k) => k !== 'shop').map((k) => chip(k, STORE_KINDS[k].emoji, STORE_KINDS[k].short)),
  ].join('');
  setPressed(els.kinds, 'data-kind', prefs.kind);
}

function radiusButtons(counts) {
  els.radius.innerHTML = RADII.map((r) => `<button type="button" data-radius="${r}" aria-pressed="${r === prefs.radius}"><b>${r}km</b><small>${counts ? `${counts[r]}곳` : ''}</small></button>`).join('');
}

/** "서울특별시 마포구 양화로 19" → "마포구 양화로 19" */
function shortAddr(a) {
  return a.replace(/^\S+(특별시|광역시|특별자치시|특별자치도|도)\s+/, '');
}

function card(s) {
  const kind = STORE_KINDS[s.k];
  const meta = s.a ? shortAddr(s.a) : kind.desc;
  return `
    <article class="card store-card k-${s.k}" role="button" tabindex="0" data-store="${escapeHtml(s.id)}" aria-label="${escapeHtml(s.n)} 자세히 보기">
      <div class="thumb kind" aria-hidden="true">${(s.k === 'shop' && shopType(s)?.emoji) || kind.emoji}</div>
      <div class="card-body">
        <div class="card-badges">
          <span class="badge kind">${escapeHtml(s.k === 'shop' ? shopType(s)?.short || kind.short : kind.short)}</span>
          ${s.b && s.b !== kind.name && !(s.k === 'shop' && shopType(s)?.labels.includes(s.b)) ? `<span class="badge plain">${escapeHtml(s.b)}</span>` : ''}
          ${s.c ? '<span class="badge good">참가격 조사</span>' : ''}
        </div>
        <h3 class="card-title">${escapeHtml(s.n)}</h3>
        <p class="card-meta">${ICON.pin}<span>${escapeHtml(meta)}</span></p>
        ${s.h ? `<p class="card-meta">${ICON.clock}<span>${escapeHtml(s.h)}</span></p>` : ''}
      </div>
      <span class="distance">${fmtDistance(s.d)}</span>
    </article>`;
}

let moreToken = 0;
function drawMoreSearch(prefix) {
  const words = selection(prefs.kind).search;
  els.moreSearch.innerHTML = `
    <h3>지도 앱에서 더 찾기</h3>
    <p>이 목록은 OpenStreetMap과 소상공인 상가정보에 등록된 곳이라, 새로 생긴 가게나 다른 업종으로 등록된 가게는 빠져 있을 수 있어요. ${prefix ? `<b>${escapeHtml(prefix)}</b> 근처를` : '근처를'} 카카오맵·네이버지도에서 바로 찾아보세요.</p>
    <div class="rows">${words
      .map((w) => {
        const links = mapSearchLinks(prefix ? `${prefix} ${w}` : w);
        return `<div class="row"><span>${escapeHtml(w)}</span><a class="kakao" href="${links.kakao}" target="_blank" rel="noopener">카카오맵</a><a class="naver" href="${links.naver}" target="_blank" rel="noopener">네이버</a></div>`;
      })
      .join('')}</div>`;
}

async function renderMoreSearch() {
  const t = ++moreToken;
  const loc = state.location;
  drawMoreSearch(areaPrefix(null));
  if (loc.source === 'city') return;
  // 동네 이름을 받는 사이 위치가 바뀌었으면 버림
  const name = await placeName(loc.lat, loc.lng);
  if (t !== moreToken || state.location !== loc || !name) return;
  drawMoreSearch(areaPrefix(name));
}

function render() {
  const loc = state.location;
  if (!data || !loc) return;
  const radius = prefs.radius;
  const match = storeFilter(prefs.kind, SHOP_TYPES);
  const widest = storesWithin(data.stores, loc, Math.max(...RADII));
  const within = widest.filter((s) => s.d <= radius);
  kindChips(within);
  const chosen = widest.filter(match);
  radiusButtons(Object.fromEntries(RADII.map((r) => [r, chosen.filter((s) => s.d <= r).length])));
  els.sort.value = prefs.sort;
  setPressed(els.viewToggle, 'data-view', prefs.view);

  const list = sortStores(within.filter(match), prefs.sort, STORE_KINDS, SHOP_TYPES);
  lastItems = list;
  const sel = selection(prefs.kind);
  const what = sel.name;
  els.summary.innerHTML = `<strong>${escapeHtml(loc.label)}</strong> 기준 ${radius}km 안에 ${escapeHtml(what)} <strong>${list.length}곳</strong>${
    prefs.sort === 'cheap' ? ' <span class="muted">(싸게 사기 좋은 곳 먼저)</span>' : prefs.sort === 'variety' ? ' <span class="muted">(종류 많은 곳 먼저)</span>' : ''
  }`;
  els.notice.hidden = !sel.caution;
  els.notice.textContent = sel.caution;

  const showMap = prefs.view === 'map';
  els.list.hidden = showMap;
  els.mapWrap.hidden = !showMap;
  if (showMap) {
    els.more.hidden = true;
    map ||= new StoreMap(els.map, { onSelect: openStore, onPick: pickLocationOnMap });
    map.render({ center: loc, radiusKm: radius, items: list.slice(0, 400), kindLabel: (s) => (s.k === 'shop' ? shopType(s)?.name : null) || STORE_KINDS[s.k].short }).catch((err) => {
      els.mapWrap.innerHTML = `<div class="error-box"><strong>지도를 불러오지 못했어요</strong>${escapeHtml(err.message)}</div>`;
    });
  } else if (!list.length) {
    const next = RADII.find((r) => r > radius);
    els.list.innerHTML = `<div class="empty"><strong>${radius}km 안에는 ${josa(what, '이', '가')} 없어요</strong>${next ? `<button type="button" class="text-button" data-widen="${next}">${next}km로 넓히기</button>` : '아래 지도 앱 검색을 이용해 보세요.'}</div>`;
    els.more.hidden = true;
  } else {
    els.list.innerHTML = list.slice(0, shown).map(card).join('');
    els.more.hidden = list.length <= shown;
    els.more.textContent = `더 보기 (${Math.min(shown, list.length)} / ${list.length})`;
  }
  renderMoreSearch();
}

async function load() {
  els.summary.textContent = '주변 매장을 불러오는 중…';
  try {
    data = await loadStores();
    els.dataLine.textContent = `매장 위치: © OpenStreetMap 기여자 (${data.updatedAt ? data.updatedAt.slice(0, 10) : ''} 기준)${data.shopsBaseDate ? ` · 동네 술 가게: 소상공인시장진흥공단 상가(상권)정보 (${data.shopsBaseDate} 기준)` : ''} · 참가격 조사 매장 포함`;
    render();
  } catch (err) {
    els.list.innerHTML = `<div class="error-box"><strong>매장 정보를 불러오지 못했어요</strong>${escapeHtml(err.message)}<br><button type="button" class="text-button" data-retry>다시 시도</button></div>`;
  }
}

function update(changes) {
  Object.assign(prefs, changes);
  shown = PAGE;
  save();
  render();
}

export function initNearby() {
  for (const id of ['nearKinds', 'nearRadius', 'nearSort', 'nearViewToggle', 'nearSummary', 'nearNotice', 'nearList', 'nearMapWrap', 'nearMap', 'nearMore', 'nearMoreSearch', 'nearDataLine']) {
    const key = id.replace('near', '');
    els[key.charAt(0).toLowerCase() + key.slice(1)] = document.getElementById(id);
  }
  els.kinds.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-kind]');
    if (btn) update({ kind: btn.dataset.kind });
  });
  els.mapWrap.insertAdjacentHTML(
    'beforeend',
    `<div class="map-legend">${STORE_KIND_ORDER.map((k) => `<span><i style="background:${KIND_COLORS[k]}"></i>${escapeHtml(STORE_KINDS[k].short)}</span>`).join('')}<span><i style="background:#2563eb"></i>기준 위치</span></div>`,
  );
  els.radius.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-radius]');
    if (btn) update({ radius: Number(btn.dataset.radius) });
  });
  els.sort.addEventListener('change', () => update({ sort: els.sort.value }));
  els.viewToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (btn) update({ view: btn.dataset.view });
  });
  els.more.addEventListener('click', () => {
    shown += PAGE;
    render();
  });
  const view = document.getElementById('view-nearby');
  const openCard = (cardEl) => {
    const s = lastItems.find((x) => x.id === cardEl.dataset.store);
    if (s) openStore(s);
  };
  view.addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) return load();
    const widen = e.target.closest('[data-widen]');
    if (widen) return update({ radius: Number(widen.dataset.widen) });
    const c = e.target.closest('.card[data-store]');
    if (c) openCard(c);
  });
  view.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const c = e.target.closest('.card[data-store]');
    if (!c) return;
    e.preventDefault();
    openCard(c);
  });
  onLocationChange(() => {
    if (data) render();
  });
}

/** #nearby 또는 #nearby/<종류> */
export function showNearby(sub = '') {
  if (sub && validKind(sub) && sub !== prefs.kind) {
    prefs.kind = sub;
    save();
  }
  if (!data) load();
  else render();
  map?.refreshSize();
}
