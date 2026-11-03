// 상세 화면 (제품, 매장) - 하나의 바텀시트를 같이 씁니다
import { BUY_BY_CATEGORY, CATEGORY_BY_ID, CHANNELS, STORE_KINDS, TAG_LABELS } from './content/index.js';
import { loadPrices, loadStores } from './data.js';
import { distanceKm, fmtDistance, walkMinutes } from './lib/geo.js';
import { comparePrices, matchKcaProducts, nearestStores, pricesAtStore } from './lib/nearby.js';
import { areaPrefix, mapSearchLinks, placeLinks, placeName } from './place.js';
import { channelCard } from './render.js';
import { state } from './state.js';
import { CATEGORY_COLORS, ICON, escapeHtml, fmtDay, fmtPriceRange, fmtWon, safeUrl, toast } from './util.js';

const dialog = () => document.getElementById('sheet');
const body = () => document.getElementById('sheetBody');
let token = 0;

/** 지도 앱에서 이 술을 파는 가게를 찾을 때 쓰는 검색어 */
export const SHOP_WORDS = {
  wine: '와인샵',
  whisky: '보틀샵',
  brandy: '보틀샵',
  vodka: '주류 할인점',
  gin: '보틀샵',
  rum: '보틀샵',
  tequila: '보틀샵',
  liqueur: '주류 할인점',
  cocktail: '주류 할인점',
  beer: '수제맥주 보틀샵',
  sake: '사케 판매',
  traditional: '전통주',
  soju: '마트',
  baijiu: '중국 식품',
};

function open(html, color) {
  const d = dialog();
  body().innerHTML = html;
  d.style.setProperty('--c', color || 'var(--brand)');
  d.scrollTop = 0;
  if (!d.open) d.showModal();
  return ++token;
}

const current = (t) => t === token && dialog().open;

export function initSheets() {
  // 시트 안의 앱 내부 링크(#guide/wine 등)를 누르면 시트를 닫고 이동
  body().addEventListener('click', async (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (a) {
      dialog().close();
      return;
    }
    const share = e.target.closest('[data-share]');
    if (share) {
      const data = { title: share.dataset.title, text: share.dataset.text, url: location.href.split('#')[0] + (share.dataset.hash || '') };
      try {
        if (navigator.share) await navigator.share(data);
        else {
          await navigator.clipboard.writeText(`${data.title} ${data.url}`);
          toast('링크를 복사했어요');
        }
      } catch {
        /* 취소 */
      }
    }
    const store = e.target.closest('[data-store-id]');
    if (store) {
      const { stores } = await loadStores();
      const s = stores.find((x) => x.id === store.dataset.storeId);
      if (s) openStore(s);
    }
  });
}

function kindEmoji(k) {
  return STORE_KINDS[k]?.emoji || '🏪';
}

function miniStoreHtml(s) {
  const kind = STORE_KINDS[s.k];
  return `<button type="button" class="mini-store k-${s.k}" data-store-id="${escapeHtml(s.id)}">
    <span class="em" aria-hidden="true">${kindEmoji(s.k)}</span>
    <span class="n">${escapeHtml(s.n)}${s.b && !s.n.includes(s.b) ? `<small>${escapeHtml(s.b)}</small>` : ''}</span>
    <span class="d">${fmtDistance(s.d)}</span>
  </button>`;
}

// ---------- 제품 ----------

export function productBuyChannels(product) {
  const base = BUY_BY_CATEGORY[product.cat] || [];
  if (!product.where) return base.slice(0, 4);
  return product.where.map((ch) => base.find((b) => b.ch === ch) || { ch, score: 4 });
}

export async function openProduct(product) {
  const cat = CATEGORY_BY_ID[product.cat];
  const color = CATEGORY_COLORS[product.cat];
  const channels = productBuyChannels(product);
  const tags = (product.tags || []).map((t) => `<span class="tag">${escapeHtml(TAG_LABELS[t] || t)}</span>`).join('');
  const searchQuery = `${product.name} 가격`;
  const shopWord = SHOP_WORDS[product.cat] || '주류 판매점';
  const html = `
    <div class="sheet-hero">
      <div class="em" aria-hidden="true">${cat?.emoji || '🍾'}</div>
      <h2 id="sheetTitle">${escapeHtml(product.name)}</h2>
      ${product.en ? `<div class="en">${escapeHtml(product.en)}</div>` : ''}
      <div class="card-badges">
        <a class="badge brand" href="#guide/${escapeHtml(product.cat)}">${escapeHtml(cat?.name || '')}</a>
        <span class="badge plain">${escapeHtml(product.sub)}</span>
        <span class="badge plain">${escapeHtml(product.country)}</span>
      </div>
      <div class="stat-row">
        <div><small>도수</small><b>${product.abv != null ? `${product.abv}도` : '라벨 확인'}</b></div>
        <div><small>용량</small><b>${product.ml ? `${product.ml}ml` : '-'}</b></div>
        <div><small>참고 가격</small><b>${escapeHtml(fmtPriceRange(product.price).replace('약 ', ''))}</b></div>
      </div>
    </div>
    <div class="detail-content">
      <div class="taste" aria-label="맛">
        <div>단맛 <span class="bar"><i style="width:${product.sweet * 20}%"></i></span></div>
        <div>진하기 <span class="bar"><i style="width:${product.body * 20}%"></i></span></div>
      </div>
      ${tags ? `<div class="tag-row" style="margin-top:10px">${tags}</div>` : ''}
      <div class="sheet-section"><h3>어떤 맛이에요?</h3><p>${escapeHtml(product.notes)}</p></div>
      ${product.serve ? `<div class="sheet-section"><h3>이렇게 마셔요</h3><p>${escapeHtml(product.serve)}</p></div>` : ''}
      ${product.pair ? `<div class="sheet-section"><h3>어울리는 음식</h3><p>${escapeHtml(product.pair)}</p></div>` : ''}
      <div id="sheetKca"></div>
      <div class="sheet-section">
        <h3>어디서 사면 좋을까 <small>가까운 곳도 함께 보여드려요</small></h3>
        ${product.buyNote ? `<p class="note warn">${escapeHtml(product.buyNote)}</p>` : ''}
        <div class="channel-list">${channels.map((c) => channelCard(c.ch, { why: c.why, score: c.score, nearHtml: `<div class="near" data-near="${c.ch}"></div>` })).join('')}</div>
      </div>
      <div class="sheet-section">
        <h3>가격·파는 곳 더 찾아보기</h3>
        <div class="link-grid">
          <a class="primary" href="https://search.naver.com/search.naver?query=${encodeURIComponent(searchQuery)}" target="_blank" rel="noopener">${ICON.search}네이버에서 가격 검색</a>
          <a href="#guide/${escapeHtml(product.cat)}">${cat?.emoji || ''} ${escapeHtml(cat?.name || '')} 알아보기</a>
          <a id="sheetKakaoSearch" href="${mapSearchLinks(shopWord).kakao}" target="_blank" rel="noopener">${ICON.map}근처 ${escapeHtml(shopWord)} (카카오맵)</a>
          <a id="sheetNaverSearch" href="${mapSearchLinks(shopWord).naver}" target="_blank" rel="noopener">${ICON.map}근처 ${escapeHtml(shopWord)} (네이버지도)</a>
        </div>
        <p class="note">참고 가격은 국내 마트·전문점 기준의 대략적인 범위예요. 매장·행사·시기마다 크게 달라요. 재고는 매장에 전화로 확인하세요.</p>
      </div>
    </div>`;
  const t = open(html, color);
  fillProductNearby(product, channels, t);
  if (product.kca) fillProductKca(product, t);
}

async function fillProductNearby(product, channels, t) {
  const loc = state.location;
  if (!loc) return;
  try {
    const { stores } = await loadStores();
    if (!current(t)) return;
    for (const c of channels) {
      const box = body().querySelector(`[data-near="${c.ch}"]`);
      if (!box || !STORE_KINDS[c.ch]) continue;
      const near = nearestStores(stores, loc, { kinds: [c.ch], limit: 2, maxKm: 30 });
      box.innerHTML = near.length ? near.map(miniStoreHtml).join('') : '';
    }
  } catch {
    /* 매장 데이터를 못 받으면 근처 목록만 생략 */
  }
  // 지도 앱 검색어에 동네 이름 붙이기 ("마포구 서교동 와인샵")
  const name = loc.source === 'city' ? null : await placeName(loc.lat, loc.lng);
  if (!current(t) || state.location !== loc) return;
  const prefix = areaPrefix(name);
  if (!prefix) return;
  const links = mapSearchLinks(`${prefix} ${SHOP_WORDS[product.cat] || '주류 판매점'}`);
  const k = document.getElementById('sheetKakaoSearch');
  const n = document.getElementById('sheetNaverSearch');
  if (k) k.href = links.kakao;
  if (n) n.href = links.naver;
}

async function fillProductKca(product, t) {
  const loc = state.location;
  const box = () => document.getElementById('sheetKca');
  try {
    const prices = await loadPrices();
    if (!current(t)) return;
    const matched = matchKcaProducts(prices, product.kca);
    if (!matched.length || !loc) return;
    const rows = matched
      .map((kp) => {
        const r = comparePrices(prices, kp.id, loc, 10, { minRows: 3 });
        if (!r.rows.length && !r.brands.length) return '';
        const best = r.rows[0];
        const cvs = r.brands.length ? `${fmtWon(r.brands[0].price)}${r.brands.at(-1).price !== r.brands[0].price ? `~${fmtWon(r.brands.at(-1).price)}` : ''}` : '';
        return `<div class="info-card">
          <div class="h"><b>${escapeHtml(kp.name)} ${escapeHtml(kp.pack || kp.size)}</b></div>
          ${best ? `<p>가장 싼 곳: <b>${fmtWon(best.price)}</b> · ${escapeHtml(best.store.n)} (${fmtDistance(best.d)})</p>` : ''}
          <p>${r.stats.median ? `주변 보통 ${fmtWon(r.stats.median)}` : ''}${cvs ? ` · 편의점 ${cvs}` : ''}</p>
          <a class="text-link" href="#prices/${escapeHtml(kp.id)}">최저가에서 매장별로 보기 →</a>
        </div>`;
      })
      .filter(Boolean);
    if (!rows.length || !current(t)) return;
    box().innerHTML = `<div class="sheet-section"><h3>실제 판매 가격 <small>한국소비자원 참가격 ${escapeHtml(fmtDay(prices.inspectDay))} 조사</small></h3><div class="info-cards">${rows.join('')}</div></div>`;
  } catch {
    /* 가격 데이터를 못 받으면 생략 */
  }
}

// ---------- 매장 ----------

export async function openStore(store) {
  const kind = STORE_KINDS[store.k];
  const loc = state.location;
  const d = loc ? distanceKm(loc.lat, loc.lng, store.la, store.lo) : null;
  const walk = walkMinutes(d);
  const links = placeLinks(store.n, store.la, store.lo);
  const web = store.w && safeUrl(store.w);
  const html = `
    <div class="sheet-hero k-${store.k}" style="--c: var(--kc)">
      <div class="em" aria-hidden="true">${kindEmoji(store.k)}</div>
      <h2 id="sheetTitle">${escapeHtml(store.n)}</h2>
      <div class="card-badges">
        <span class="badge kind">${escapeHtml(kind?.name || '')}</span>
        ${store.b && store.b !== kind?.name ? `<span class="badge plain">${escapeHtml(store.b)}</span>` : ''}
        ${store.c ? '<span class="badge good">참가격 조사 매장</span>' : ''}
        ${d != null ? `<span class="badge brand">${fmtDistance(d)}${walk ? ` · 걸어서 ${walk}분` : ''}</span>` : ''}
      </div>
    </div>
    <div class="detail-content">
      <div class="link-grid">
        <a class="primary" href="${links.kakaoRoute}" target="_blank" rel="noopener">${ICON.route}길찾기 (카카오맵)</a>
        <a href="${links.kakaoMap}" target="_blank" rel="noopener">${ICON.map}카카오맵에서 보기</a>
        <a href="${links.naver}" target="_blank" rel="noopener">${ICON.map}네이버지도에서 보기</a>
        ${store.p ? `<a href="tel:${escapeHtml(store.p.replace(/[^\d+]/g, ''))}">${ICON.phone}전화하기</a>` : `<button type="button" data-share data-title="${escapeHtml(store.n)}" data-text="${escapeHtml(store.n)}" data-hash="#nearby">${ICON.share}공유</button>`}
      </div>
      <dl class="facts" style="margin-top:14px">
        ${store.a ? `<div><dt>주소</dt><dd>${escapeHtml(store.a)}</dd></div>` : ''}
        ${store.h ? `<div><dt>영업시간</dt><dd>${escapeHtml(store.h)}</dd></div>` : ''}
        ${store.p ? `<div><dt>전화</dt><dd>${escapeHtml(store.p)}</dd></div>` : ''}
        ${web ? `<div><dt>홈페이지</dt><dd><a class="text-link" href="${escapeHtml(web)}" target="_blank" rel="noopener">${escapeHtml(web.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></dd></div>` : ''}
      </dl>
      <div class="sheet-section">
        <h3>${escapeHtml(kind?.name || '이런 곳')}에서는</h3>
        <p>${escapeHtml(kind?.good || '')}</p>
        ${kind?.caution && (store.k !== 'shop' || /주류|상사|유통|도매/.test(store.n)) ? `<p class="note warn">${escapeHtml(kind.caution)}</p>` : ''}
      </div>
      <div id="sheetStorePrices"></div>
      <p class="note">매장 정보: © OpenStreetMap 기여자${store.c ? ' · 가격: 한국소비자원 참가격' : ''}. 영업시간·휴무는 바뀔 수 있으니 지도 앱에서 한 번 더 확인하세요.</p>
    </div>`;
  const t = open(html);
  if (store.c) {
    try {
      const prices = await loadPrices();
      const list = pricesAtStore(prices, store.c);
      if (!list.length || !current(t)) return;
      document.getElementById('sheetStorePrices').innerHTML = `
        <div class="sheet-section">
          <h3>이 매장 가격 <small>참가격 ${escapeHtml(fmtDay(prices.inspectDay))} 조사</small></h3>
          <div class="price-list">${list
            .map(
              (x) => `<a class="price-row" href="#prices/${escapeHtml(x.product.id)}" style="text-decoration:none">
                <span class="rank" aria-hidden="true">${x.product.kind === 'soju' ? '🟢' : x.product.kind === 'beer' ? '🍺' : '🍶'}</span>
                <span class="n"><b>${escapeHtml(x.product.name)}</b><small>${escapeHtml(x.product.pack || x.product.size)}</small></span>
                <span class="p"><b>${fmtWon(x.price)}</b>${x.discount ? '<small class="cheaper">할인</small>' : ''}${x.onePlusOne ? '<small class="cheaper">1+1</small>' : ''}</span>
              </a>`,
            )
            .join('')}</div>
        </div>`;
    } catch {
      /* 생략 */
    }
  }
}

/** 참가격 조사 매장 (최저가 화면에서 누른 매장) — 지도용 매장 목록에 있으면 그걸로, 없으면 조사 정보로 */
export async function openKcaStore(kcaStore) {
  try {
    const { stores } = await loadStores();
    const linked = stores.find((s) => s.c === kcaStore.id);
    if (linked) return openStore(linked);
  } catch {
    /* 아래로 */
  }
  return openStore({ id: `kca${kcaStore.id}`, k: /백화점/.test(kcaStore.t) ? 'department' : /대형/.test(kcaStore.t) ? 'mart' : 'super', b: kcaStore.t, n: kcaStore.n, la: kcaStore.la, lo: kcaStore.lo, a: kcaStore.a, p: kcaStore.p, c: kcaStore.id });
}

