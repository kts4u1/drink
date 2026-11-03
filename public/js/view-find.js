// 술 찾기 탭: 제품 검색 → 상세(맛·참고 가격·어디서 사면 좋을지·내 주변 살 곳)
import { CATEGORIES, CATEGORY_BY_ID, GLOSSARY, PRODUCTS } from './content/index.js';
import { searchCategories, searchProducts, searchTerms } from './lib/search.js';
import { mapSearchLinks } from './place.js';
import { openProduct } from './sheets.js';
import { debounce, escapeHtml, setPressed, storage } from './util.js';
import { productCard } from './view-guide.js';

const POPULAR = ['하이볼', '발베니', '조니워커', '모스카토', '샴페인', '버번', '스모키', '막걸리', '사케', '선물'];
const PAGE = 24;

const prefs = { cat: 'all', sort: 'recommend', ...storage.get('findPrefs', {}) };
let query = '';
let shown = PAGE;

const els = {};

function filtered() {
  let list;
  if (query) {
    list = searchProducts(PRODUCTS, query);
    // "선물", "하이볼"처럼 태그 이름으로 찾은 경우
    const tagHit = { 선물: 'gift', 하이볼: 'highball', 칵테일: 'cocktail', 입문: 'beginner', 가성비: 'value', 스모키: 'smoky', 디저트: 'dessert', 탄산: 'sparkling' }[query.replace(/\s/g, '')];
    if (tagHit) {
      const extra = PRODUCTS.filter((p) => p.tags?.includes(tagHit) && !list.includes(p));
      list = [...list, ...extra];
    }
  } else {
    list = [...PRODUCTS];
  }
  const counts = {};
  for (const p of list) counts[p.cat] = (counts[p.cat] || 0) + 1;
  if (prefs.cat !== 'all') list = list.filter((p) => p.cat === prefs.cat);
  if (prefs.sort === 'low') list = [...list].sort((a, b) => a.price[0] - b.price[0]);
  else if (prefs.sort === 'high') list = [...list].sort((a, b) => b.price[1] - a.price[1]);
  else if (prefs.sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  else if (!query) {
    // 추천순: 입문용 먼저, 그다음 백과 순서
    const order = Object.fromEntries(CATEGORIES.map((c, i) => [c.id, i]));
    list = [...list].sort((a, b) => order[a.cat] - order[b.cat] || Number(b.tags?.includes('beginner')) - Number(a.tags?.includes('beginner')));
  }
  return { list, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

function renderCats(counts, total) {
  const cats = CATEGORIES.filter((c) => counts[c.id]);
  if (prefs.cat !== 'all' && !counts[prefs.cat]) prefs.cat = 'all';
  els.cats.innerHTML = [`<button type="button" class="chip" data-cat="all">전체 <span class="count">${total}</span></button>`, ...cats.map((c) => `<button type="button" class="chip" data-cat="${c.id}">${c.emoji} ${escapeHtml(c.name)} <span class="count">${counts[c.id]}</span></button>`)].join('');
  setPressed(els.cats, 'data-cat', prefs.cat);
}

function render() {
  const { list, counts, total } = filtered();
  renderCats(counts, total);
  els.sort.value = prefs.sort;

  // 목록에 없는 술도 많으니 검색어가 있으면 늘 AI 에게 물어볼 수 있게
  els.ask.innerHTML = query.length >= 2
    ? `<button type="button" class="ask-ai" data-ask="${escapeHtml(query)}"><span aria-hidden="true">🤖</span><span><b>AI에게 "${escapeHtml(query)}" 물어보기</b><small>목록에 없는 와인·위스키·코냑도 이름·맛·가격·마시는 법을 알려줘요</small></span></button>`
    : '';

  // 검색어에 맞는 백과 글·용어
  const related = query ? searchCategories(CATEGORIES, query).slice(0, 3) : [];
  const terms = query ? searchTerms(GLOSSARY, query).slice(0, 2) : [];
  els.related.innerHTML =
    related.length || terms.length
      ? `<div class="notice" style="background:var(--brand-weak)">📖 ${[
          ...related.map((c) => `<a class="text-link" href="#guide/${c.id}">${escapeHtml(c.name)} 알아보기</a>`),
          ...terms.map((t) => `<b>${escapeHtml(t.term)}</b>: ${escapeHtml(t.desc.replace(/<[^>]+>/g, ''))}`),
        ].join(' · ')}</div>`
      : '';

  if (!list.length) {
    const links = mapSearchLinks('보틀샵');
    els.summary.innerHTML = query ? `<strong>"${escapeHtml(query)}"</strong> 검색 결과` : '';
    els.list.innerHTML = `<div class="empty"><strong>대표 제품 목록에는 없어요</strong>위의 <b>AI에게 물어보기</b>를 누르거나, 아래에서 가격과 파는 곳을 직접 찾아보세요.
      <div class="link-grid" style="margin-top:14px">
        <a class="primary" href="https://search.naver.com/search.naver?query=${encodeURIComponent(`${query} 가격`)}" target="_blank" rel="noopener">네이버에서 가격 검색</a>
        <a href="${links.kakao}" target="_blank" rel="noopener">근처 보틀샵 (카카오맵)</a>
      </div></div>`;
    els.more.hidden = true;
    return;
  }
  const catName = prefs.cat === 'all' ? '' : `${CATEGORY_BY_ID[prefs.cat].name} `;
  els.summary.innerHTML = `${query ? `<strong>"${escapeHtml(query)}"</strong> ` : ''}${escapeHtml(catName)}<strong>${list.length}개</strong> <span class="muted">· 가격은 대략적인 참고 가격대예요</span>`;
  els.list.innerHTML = list.slice(0, shown).map((p) => productCard(p)).join('');
  els.more.hidden = list.length <= shown;
  els.more.textContent = `더 보기 (${Math.min(shown, list.length)} / ${list.length})`;
}

export function initFind() {
  for (const id of ['findSearch', 'findPopular', 'findCats', 'findSort', 'findAsk', 'findRelated', 'findSummary', 'findList', 'findMore']) {
    els[id.replace('find', '').toLowerCase()] = document.getElementById(id);
  }
  els.popular.innerHTML = POPULAR.map((q) => `<button type="button" class="chip" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('');
  const save = () => storage.set('findPrefs', prefs);

  els.search.addEventListener(
    'input',
    debounce(() => {
      query = els.search.value.trim();
      shown = PAGE;
      prefs.cat = 'all';
      render();
    }, 150),
  );
  els.popular.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-q]');
    if (!btn) return;
    els.search.value = btn.dataset.q;
    query = btn.dataset.q;
    prefs.cat = 'all';
    shown = PAGE;
    render();
  });
  els.cats.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    prefs.cat = btn.dataset.cat;
    shown = PAGE;
    save();
    render();
  });
  els.sort.addEventListener('change', () => {
    prefs.sort = els.sort.value;
    save();
    render();
  });
  els.more.addEventListener('click', () => {
    shown += PAGE;
    render();
  });
  const view = document.getElementById('view-find');
  view.addEventListener('click', (e) => {
    const card = e.target.closest('[data-product]');
    if (!card) return;
    const p = PRODUCTS.find((x) => x.id === card.dataset.product);
    if (p) openProduct(p);
  });
  view.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('[data-product]');
    if (!card) return;
    e.preventDefault();
    const p = PRODUCTS.find((x) => x.id === card.dataset.product);
    if (p) openProduct(p);
  });
  render();
}

/** #find/<제품 id> 로 들어오면 그 제품 상세를 바로 열기 */
export function showFind(sub = '') {
  const p = sub && PRODUCTS.find((x) => x.id === sub);
  if (p) openProduct(p);
}
