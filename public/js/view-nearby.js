// 내 주변 탭: 술 살 수 있는 곳 (OpenStreetMap + 참가격 조사 매장)
import { STORE_KINDS, STORE_KIND_ORDER } from './content/index.js';
import { loadStores } from './data.js';
import { fmtDistance } from './lib/geo.js';
import { countByKind, countByRadius, sortStores, storesWithin } from './lib/nearby.js';
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

let data = null;
let shown = PAGE;
let map = null;
let lastItems = [];
const els = {};
const save = () => storage.set('nearPrefs', prefs);

function kindChips(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  els.kinds.innerHTML = [
    `<button type="button" class="chip" data-kind="all">전체 <span class="count">${total}</span></button>`,
    ...STORE_KIND_ORDER.map((k) => `<button type="button" class="chip" data-kind="${k}">${STORE_KINDS[k].emoji} ${escapeHtml(STORE_KINDS[k].short)} <span class="count">${counts[k] || 0}</span></button>`),
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
      <div class="thumb kind" aria-hidden="true">${kind.emoji}</div>
      <div class="card-body">
        <div class="card-badges">
          <span class="badge kind">${escapeHtml(kind.short)}</span>
          ${s.b && s.b !== kind.name ? `<span class="badge plain">${escapeHtml(s.b)}</span>` : ''}
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
  const words = prefs.kind === 'all' ? ['와인샵', '보틀샵', '주류 할인점', '전통주'] : STORE_KINDS[prefs.kind].search;
  els.moreSearch.innerHTML = `
    <h3>지도 앱에서 더 찾기</h3>
    <p>이 목록은 OpenStreetMap에 등록된 곳이라 동네 와인샵·보틀샵은 빠져 있을 수 있어요. ${prefix ? `<b>${escapeHtml(prefix)}</b> 근처를` : '근처를'} 카카오맵·네이버지도에서 바로 찾아보세요.</p>
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
  const within = storesWithin(data.stores, loc, radius);
  const counts = countByKind(within);
  kindChips(counts);
  radiusButtons(countByRadius(data.stores, loc, RADII, prefs.kind === 'all' ? null : [prefs.kind]));
  els.sort.value = prefs.sort;
  setPressed(els.viewToggle, 'data-view', prefs.view);

  const list = sortStores(prefs.kind === 'all' ? within : within.filter((s) => s.k === prefs.kind), prefs.sort, STORE_KINDS);
  lastItems = list;
  const what = prefs.kind === 'all' ? '술 살 수 있는 곳' : STORE_KINDS[prefs.kind].name;
  els.summary.innerHTML = `<strong>${escapeHtml(loc.label)}</strong> 기준 ${radius}km 안에 ${escapeHtml(what)} <strong>${list.length}곳</strong>${
    prefs.sort === 'cheap' ? ' <span class="muted">(싸게 사기 좋은 곳 먼저)</span>' : prefs.sort === 'variety' ? ' <span class="muted">(종류 많은 곳 먼저)</span>' : ''
  }`;
  els.notice.hidden = prefs.kind === 'all' || !STORE_KINDS[prefs.kind].caution;
  els.notice.textContent = prefs.kind !== 'all' ? STORE_KINDS[prefs.kind].caution || '' : '';

  const showMap = prefs.view === 'map';
  els.list.hidden = showMap;
  els.mapWrap.hidden = !showMap;
  if (showMap) {
    els.more.hidden = true;
    map ||= new StoreMap(els.map, { onSelect: openStore, onPick: pickLocationOnMap });
    map.render({ center: loc, radiusKm: radius, items: list.slice(0, 400), kindLabel: (s) => STORE_KINDS[s.k].short }).catch((err) => {
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
    els.dataLine.textContent = `매장 위치: © OpenStreetMap 기여자 (${data.updatedAt ? data.updatedAt.slice(0, 10) : ''} 기준) · 참가격 조사 매장 포함`;
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
  if (sub && (sub === 'all' || STORE_KINDS[sub]) && sub !== prefs.kind) {
    prefs.kind = sub;
    save();
  }
  if (!data) load();
  else render();
  map?.refreshSize();
}
