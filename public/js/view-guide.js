// 술 백과 탭: 첫 화면 · 종류별 글 · 용어 사전 · 취향 찾기 · 일반 글(기초, 싸게 사는 법)
import { BUY_BY_CATEGORY, CATEGORIES, CATEGORY_BY_ID, GLOSSARY, GROUPS, GUIDES, PRODUCTS, STORE_KINDS } from './content/index.js';
import { loadStores } from './data.js';
import { fmtDistance } from './lib/geo.js';
import { nearestStores } from './lib/nearby.js';
import { QUESTIONS, recommend, topCategories } from './lib/quiz.js';
import { searchCategories, searchProducts, searchTerms } from './lib/search.js';
import { channelCard, renderSection, rich } from './render.js';
import { openProduct, openStore } from './sheets.js';
import { state } from './state.js';
import { CATEGORY_COLORS, ICON, debounce, escapeHtml, fmtPriceRange } from './util.js';

const root = () => document.getElementById('view-guide');
let quizAnswers = {};
let quizStep = 0;
let lastQuery = '';

const color = (catId) => CATEGORY_COLORS[catId] || 'var(--brand)';

export function productCard(p, extra = '') {
  const cat = CATEGORY_BY_ID[p.cat];
  return `
    <article class="card product-card" role="button" tabindex="0" data-product="${escapeHtml(p.id)}" aria-label="${escapeHtml(p.name)} 자세히 보기">
      <div class="thumb emoji" style="--c:${color(p.cat)}" aria-hidden="true">${cat?.emoji || '🍾'}</div>
      <div class="card-body no-pad">
        <div class="card-badges"><span class="badge brand">${escapeHtml(cat?.name || '')}</span><span class="badge plain">${escapeHtml(p.sub)}</span></div>
        <h3 class="card-title">${escapeHtml(p.name)}</h3>
        <p class="card-meta"><span class="price">${escapeHtml(fmtPriceRange(p.price))}<small>참고</small></span></p>
        <p class="card-meta"><span>${[p.abv != null ? `${p.abv}도` : '', p.ml ? `${p.ml}ml` : '', p.country].filter(Boolean).map(escapeHtml).join(' · ')}</span></p>
        ${extra}
      </div>
    </article>`;
}

function catCard(c) {
  return `<a class="cat-card" href="#guide/${c.id}" style="--c:${color(c.id)}">
    <span class="em" aria-hidden="true">${c.emoji}</span>
    <b>${escapeHtml(c.name)}</b>
    <span class="abv">${escapeHtml(c.abv.split(/\s[(·]/)[0])}</span>
    <p>${escapeHtml(c.oneLine)}</p>
  </a>`;
}

function backRow(href = '#guide', label = '술 백과') {
  return `<div class="back-row"><a class="back-button" href="${href}">${ICON.back}${escapeHtml(label)}</a></div>`;
}

// ---------- 첫 화면 ----------

function renderHome() {
  const groups = Object.entries(GROUPS)
    .map(([id, g]) => {
      const cats = CATEGORIES.filter((c) => c.group === id);
      return `<div class="group-label">${escapeHtml(g.name)}<span>${escapeHtml(g.desc)}</span></div><div class="cat-grid">${cats.map(catCard).join('')}</div>`;
    })
    .join('');
  root().innerHTML = `
    <div class="hero">
      <span class="hero-glasses" aria-hidden="true">🍷🥃🍶</span>
      <h1>술, 쉽게 알려드릴게요</h1>
      <p>종류·맛·마시는 법부터 어디서 싸게 사는지까지</p>
      <a class="hero-snap" href="#find"><span aria-hidden="true">📷</span><span><b>모르는 술은 사진으로 알아보세요</b><small>라벨을 찍으면 이름·맛·가격대·마시는 법을 무료로 알려줘요</small></span></a>
      <label class="searchbar">
        ${ICON.search}
        <span class="sr-only">술 이름·용어 검색</span>
        <input type="search" id="guideSearch" placeholder="예) 발베니, 모스카토, 피트, 막걸리" autocomplete="off" value="${escapeHtml(lastQuery)}">
      </label>
    </div>
    <div id="guideResults"></div>
    <div id="guideHome">
      <div class="quick-grid">
        <a class="quick" href="#guide/quiz"><span class="ic" aria-hidden="true">🧭</span><span><b>취향 찾기</b><small>질문 4개로 나에게 맞는 술</small></span></a>
        <a class="quick" href="#guide/basics"><span class="ic" aria-hidden="true">📖</span><span><b>술의 기초</b><small>양조주·증류주, 도수, 건강</small></span></a>
        <a class="quick" href="#guide/terms"><span class="ic" aria-hidden="true">📚</span><span><b>용어 사전</b><small>탄닌, 피트, 정미율…</small></span></a>
        <a class="quick" href="#guide/buy"><span class="ic" aria-hidden="true">💸</span><span><b>싸게 사는 법</b><small>구매처·시기·면세 한도</small></span></a>
      </div>
      ${groups}
    </div>`;
  const input = document.getElementById('guideSearch');
  input.addEventListener('input', debounce(() => renderSearch(input.value), 150));
  if (lastQuery) renderSearch(lastQuery);
}

function renderSearch(query) {
  lastQuery = query.trim();
  const box = document.getElementById('guideResults');
  const home = document.getElementById('guideHome');
  if (!lastQuery) {
    box.innerHTML = '';
    home.hidden = false;
    return;
  }
  home.hidden = true;
  const cats = searchCategories(CATEGORIES, lastQuery).slice(0, 4);
  const prods = searchProducts(PRODUCTS, lastQuery).slice(0, 8);
  const terms = searchTerms(GLOSSARY, lastQuery).slice(0, 6);
  if (!cats.length && !prods.length && !terms.length) {
    box.innerHTML = `<div class="empty"><strong>"${escapeHtml(lastQuery)}"에 대한 내용이 백과에는 없어요</strong>브랜드 사전에서 알아보거나 직접 검색해 보세요.<br>
      <button type="button" class="ask-ai" style="margin-top:12px" data-ask="${escapeHtml(lastQuery)}"><span aria-hidden="true">🔎</span><span><b>"${escapeHtml(lastQuery)}" 자세히 알아보기</b></span></button>
      <a class="text-button" style="display:inline-block;margin-top:12px;text-decoration:none" href="https://search.naver.com/search.naver?query=${encodeURIComponent(lastQuery)}" target="_blank" rel="noopener">네이버에서 "${escapeHtml(lastQuery)}" 검색</a></div>`;
    return;
  }
  box.innerHTML = `
    ${cats.length ? `<h2 class="section-title">술 종류</h2><div class="cat-grid">${cats.map(catCard).join('')}</div>` : ''}
    ${prods.length ? `<h2 class="section-title">제품 <small>참고 가격</small></h2><div class="card-list">${prods.map((p) => productCard(p)).join('')}</div>` : ''}
    ${terms.length ? `<h2 class="section-title">용어</h2><div class="terms">${terms.map((t) => `<div><b>${escapeHtml(t.term)}</b><p>${rich(t.desc)}</p></div>`).join('')}</div>` : ''}`;
}

// ---------- 종류별 글 ----------

function renderCategory(cat) {
  const products = PRODUCTS.filter((p) => p.cat === cat.id);
  const buy = BUY_BY_CATEGORY[cat.id] || [];
  const toc = [
    ...cat.sections.map((s) => [s.id, s.title]),
    products.length ? ['products', '대표 제품'] : null,
    buy.length ? ['buy-where', '어디서 살까'] : null,
  ].filter(Boolean);
  const siblings = CATEGORIES.filter((c) => c.group === cat.group && c.id !== cat.id);
  root().innerHTML = `
    ${backRow()}
    <div class="article-hero" style="--c:${color(cat.id)}">
      <div class="em" aria-hidden="true">${cat.emoji}</div>
      <h1>${escapeHtml(cat.name)}</h1>
      <div class="en">${escapeHtml(cat.en)}</div>
      <p class="one">${escapeHtml(cat.oneLine)}</p>
      <div class="abv"><span class="badge plain">도수 ${escapeHtml(cat.abv)}</span> <span class="badge plain">${escapeHtml(GROUPS[cat.group].name)}</span></div>
    </div>
    <nav class="toc" aria-label="목차">${toc.map(([id, title]) => `<a href="#guide/${cat.id}" data-scroll="sec-${id}">${escapeHtml(title)}</a>`).join('')}</nav>
    <section class="block"><div class="prose">${cat.intro.split(/\n\n+/).map((p) => `<p>${rich(p)}</p>`).join('')}</div></section>
    ${cat.sections.map(renderSection).join('')}
    ${
      products.length
        ? `<section class="block" id="sec-products"><h2>대표 제품</h2><p class="lead">눌러서 맛·참고 가격·살 수 있는 곳을 보세요.</p><div class="card-list">${products.map((p) => productCard(p)).join('')}</div></section>`
        : ''
    }
    ${
      buy.length
        ? `<section class="block" id="sec-buy-where"><h2>${escapeHtml(cat.name)}, 어디서 살까</h2>
            <div class="channel-list">${buy.map((b) => channelCard(b.ch, { why: b.why, score: b.score, nearHtml: `<div class="near" data-near="${b.ch}"></div>` })).join('')}</div>
            <div class="link-grid" style="margin-top:12px">
              <a class="primary" href="#nearby/${buy.find((b) => STORE_KINDS[b.ch])?.ch || 'shop'}">${ICON.pin}내 주변 살 곳 보기</a>
              <a href="#guide/buy">💸 싸게 사는 법</a>
            </div>
          </section>`
        : ''
    }
    ${siblings.length ? `<h2 class="section-title">같이 보면 좋은 술</h2><div class="cat-grid">${siblings.slice(0, 6).map(catCard).join('')}</div>` : ''}`;
  fillNear(buy.map((b) => b.ch));
}

async function fillNear(channelIds) {
  const loc = state.location;
  if (!loc) return;
  try {
    const { stores } = await loadStores();
    for (const ch of channelIds) {
      if (!STORE_KINDS[ch]) continue;
      const box = root().querySelector(`[data-near="${ch}"]`);
      if (!box) continue;
      const near = nearestStores(stores, loc, { kinds: [ch], limit: 2, maxKm: 30 });
      box.innerHTML = near
        .map(
          (s) => `<button type="button" class="mini-store k-${s.k}" data-store="${escapeHtml(s.id)}">
            <span class="em" aria-hidden="true">${STORE_KINDS[s.k].emoji}</span>
            <span class="n">${escapeHtml(s.n)}${s.b && !s.n.includes(s.b) ? `<small>${escapeHtml(s.b)}</small>` : ''}</span>
            <span class="d">${fmtDistance(s.d)}</span>
          </button>`,
        )
        .join('');
    }
  } catch {
    /* 매장 데이터 없이도 글은 보임 */
  }
}

// ---------- 일반 글 ----------

function renderGuide(guide) {
  root().innerHTML = `
    ${backRow()}
    <div class="article-hero">
      <div class="em" aria-hidden="true">${guide.emoji}</div>
      <h1>${escapeHtml(guide.name)}</h1>
      <p class="one">${escapeHtml(guide.oneLine)}</p>
    </div>
    <nav class="toc" aria-label="목차">${guide.sections.map((s) => `<a href="#guide/${guide.id}" data-scroll="sec-${s.id}">${escapeHtml(s.title)}</a>`).join('')}</nav>
    ${guide.sections.map(renderSection).join('')}
    ${guide.id === 'buy' ? `<div class="link-grid" style="margin-top:12px"><a class="primary" href="#prices">💸 소주·맥주·막걸리 최저가 보기</a><a href="#nearby">${ICON.pin}내 주변 살 곳</a></div>` : ''}`;
}

// ---------- 용어 사전 ----------

let termFilter = 'all';
function renderTerms() {
  const cats = ['all', 'common', ...CATEGORIES.map((c) => c.id).filter((id) => GLOSSARY.some((t) => t.cat === id))];
  const label = (id) => (id === 'all' ? '전체' : id === 'common' ? '공통' : CATEGORY_BY_ID[id].name);
  root().innerHTML = `
    ${backRow()}
    <h1 class="view-title">📚 용어 사전</h1>
    <p class="view-lead">라벨이나 설명에서 자주 보는 말을 쉽게 풀었어요. ${GLOSSARY.length}개</p>
    <div class="panel filters">
      <label class="searchbar">${ICON.search}<span class="sr-only">용어 검색</span><input type="search" id="termSearch" placeholder="용어 검색 (예: 탄닌)" autocomplete="off"></label>
      <div class="chip-row" id="termCats">${cats.map((id) => `<button type="button" class="chip" data-cat="${id}" aria-pressed="${id === termFilter}">${escapeHtml(label(id))}</button>`).join('')}</div>
    </div>
    <div class="terms" id="termList" style="margin-top:12px"></div>`;
  const input = document.getElementById('termSearch');
  const draw = () => {
    const q = input.value.trim();
    let list = q ? searchTerms(GLOSSARY, q) : GLOSSARY;
    if (termFilter === 'common') list = list.filter((t) => !t.cat);
    else if (termFilter !== 'all') list = list.filter((t) => t.cat === termFilter);
    document.getElementById('termList').innerHTML = list.length
      ? list
          .map(
            (t) => `<div><b>${escapeHtml(t.term)}</b>${t.cat ? ` <a class="badge plain" href="#guide/${t.cat}">${escapeHtml(CATEGORY_BY_ID[t.cat].name)}</a>` : ''}<p>${rich(t.desc)}</p></div>`,
          )
          .join('')
      : '<div class="empty"><strong>찾는 용어가 없어요</strong>다른 말로 검색해 보세요.</div>';
  };
  input.addEventListener('input', debounce(draw, 120));
  document.getElementById('termCats').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    termFilter = btn.dataset.cat;
    for (const b of document.querySelectorAll('#termCats [data-cat]')) b.setAttribute('aria-pressed', String(b.dataset.cat === termFilter));
    draw();
  });
  draw();
}

// ---------- 취향 찾기 ----------

function renderQuiz() {
  if (quizStep >= QUESTIONS.length) return renderQuizResult();
  const q = QUESTIONS[quizStep];
  root().innerHTML = `
    ${backRow()}
    <div class="quiz">
      <div class="quiz-progress" aria-hidden="true">${QUESTIONS.map((_, i) => `<i class="${i <= quizStep ? 'on' : ''}"></i>`).join('')}</div>
      <p class="hint" style="margin:0 0 4px">질문 ${quizStep + 1} / ${QUESTIONS.length}</p>
      <h2>${escapeHtml(q.q)}</h2>
      <div class="quiz-options">${q.options
        .map((o) => `<button type="button" data-answer="${o.id}" aria-pressed="${quizAnswers[q.id] === o.id}"><span aria-hidden="true">${o.emoji}</span>${escapeHtml(o.label)}</button>`)
        .join('')}</div>
      <div class="quiz-nav">${quizStep > 0 ? '<button type="button" class="text-button" data-quiz-prev>이전</button>' : '<span></span>'}</div>
    </div>`;
}

function renderQuizResult() {
  const results = recommend(PRODUCTS, quizAnswers, 6);
  const cats = topCategories(results);
  const picked = QUESTIONS.map((q) => q.options.find((o) => o.id === quizAnswers[q.id])?.label).filter(Boolean);
  root().innerHTML = `
    ${backRow()}
    <h1 class="view-title">🧭 이런 술은 어때요?</h1>
    <p class="view-lead">${picked.map(escapeHtml).join(' · ')}</p>
    <div class="card-list">${results
      .map((r) => productCard(r.product, r.why.length ? `<p class="why">✓ ${r.why.slice(0, 3).map(escapeHtml).join(' · ')}</p>` : ''))
      .join('')}</div>
    ${cats.length ? `<h2 class="section-title">더 알아보기</h2><div class="cat-grid">${cats.map((id) => catCard(CATEGORY_BY_ID[id])).join('')}</div>` : ''}
    <div class="link-grid" style="margin-top:14px"><button type="button" class="primary" data-quiz-restart>다시 해보기</button><a href="#find">🔎 술 찾기에서 더 보기</a></div>
    <p class="note">추천은 맛 설명과 참고 가격을 바탕으로 한 것이라 실제 맛은 사람마다 달라요. 처음엔 바(bar)나 시음회에서 한 잔씩 맛보는 것도 좋아요.</p>`;
}

// ---------- 라우팅 ----------

export function showGuide(sub = '') {
  const [page] = sub.split('/');
  if (!page) renderHome();
  else if (page === 'terms') renderTerms();
  else if (page === 'quiz') {
    if (!Object.keys(quizAnswers).length) quizStep = 0;
    renderQuiz();
  } else if (GUIDES[page]) renderGuide(GUIDES[page]);
  else if (CATEGORY_BY_ID[page]) renderCategory(CATEGORY_BY_ID[page]);
  else renderHome();
}

export function initGuide() {
  const el = root();
  el.addEventListener('click', async (e) => {
    const scroll = e.target.closest('[data-scroll]');
    if (scroll) {
      e.preventDefault();
      document.getElementById(scroll.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const answer = e.target.closest('[data-answer]');
    if (answer) {
      quizAnswers[QUESTIONS[quizStep].id] = answer.dataset.answer;
      quizStep++;
      renderQuiz();
      window.scrollTo({ top: 0 });
      return;
    }
    if (e.target.closest('[data-quiz-prev]')) {
      quizStep = Math.max(0, quizStep - 1);
      renderQuiz();
      return;
    }
    if (e.target.closest('[data-quiz-restart]')) {
      quizAnswers = {};
      quizStep = 0;
      renderQuiz();
      window.scrollTo({ top: 0 });
      return;
    }
    const prod = e.target.closest('[data-product]');
    if (prod) {
      const p = PRODUCTS.find((x) => x.id === prod.dataset.product);
      if (p) openProduct(p);
      return;
    }
    const store = e.target.closest('[data-store]');
    if (store) {
      const { stores } = await loadStores();
      const s = stores.find((x) => x.id === store.dataset.store);
      if (s) openStore(s);
    }
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const prod = e.target.closest('[data-product]');
    if (!prod) return;
    e.preventDefault();
    const p = PRODUCTS.find((x) => x.id === prod.dataset.product);
    if (p) openProduct(p);
  });
}

/** 위치가 바뀌면 근처 매장 줄만 다시 */
export function refreshGuideNear() {
  const page = location.hash.slice(1).split('/')[1];
  if (page && CATEGORY_BY_ID[page]) fillNear((BUY_BY_CATEGORY[page] || []).map((b) => b.ch));
}
