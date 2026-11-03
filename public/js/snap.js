// 사진으로 술 알아보기 (AI)
// 사진(최대 3장)을 1600px 로 줄여 사진 인식 API(Cloudflare Worker 또는 개발 서버)에 보내고,
// Claude 가 알아본 결과를 상세 화면으로 보여 줍니다. 이름만 적어 물어볼 수도 있어요.
// AI 가 만든 글은 그대로 믿지 않고 모두 글자로만(escapeHtml) 화면에 넣습니다.
import { BUY_BY_CATEGORY, CATEGORY_BY_ID, PRODUCTS } from './content/index.js';
import { CONFIDENCE_LABELS, cleanQueryText, displayName, normalizeResult, priceQuery } from './lib/identify.js';
import { norm, searchProducts } from './lib/search.js';
import { mapSearchLinks } from './place.js';
import { channelCard } from './render.js';
import { SHOP_WORDS, fillProductKca, fillProductNearby, openProduct, openSheet, sheetIsCurrent } from './sheets.js';
import { CATEGORY_COLORS, ICON, escapeHtml, fmtPriceRange, storage, toast } from './util.js';

const MAX_PHOTOS = 3;
const HISTORY_KEY = 'snapHistory';
const HISTORY_MAX = 20;

let apiBase = null; // null = 아직 모름
let ready = null; // null = 확인 중, true/false
let model = null;
let tray = []; // [{ dataUrl, thumb }]
let busy = false;
const els = {};

// ---------- 설정·상태 ----------

async function loadConfig() {
  if (apiBase !== null) return apiBase;
  try {
    const res = await fetch('config.json', { cache: 'no-store' });
    apiBase = res.ok ? String((await res.json()).apiBase || '').replace(/\/+$/, '') : '';
  } catch {
    apiBase = '';
  }
  return apiBase;
}

const apiUrl = (path) => `${apiBase || ''}${apiBase ? '' : '.'}/api/${path}`;

async function checkHealth() {
  await loadConfig();
  try {
    const res = await fetch(apiUrl('health'), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    const body = res.ok ? await res.json() : null;
    ready = Boolean(body?.identify);
    model = body?.model || null;
  } catch {
    ready = false;
  }
  renderStatus();
}

function renderStatus() {
  if (!els.status) return;
  els.hero.dataset.ready = String(ready);
  if (ready === null) els.status.textContent = '사진 인식 연결 확인 중…';
  else if (ready) els.status.innerHTML = '사진은 분석에만 쓰고 저장하지 않아요. <span class="muted">AI가 틀릴 수 있으니 중요한 정보는 라벨에서 확인하세요.</span>';
  else els.status.innerHTML = '⚠️ 사진 인식이 아직 켜지지 않았어요. <span class="muted">관리자가 API 키를 설정하면 쓸 수 있어요 (README 참고).</span>';
}

function notReady() {
  if (ready) return false;
  toast(ready === null ? '사진 인식 연결을 확인하고 있어요. 잠시 후 다시 눌러 주세요.' : '사진 인식이 아직 켜지지 않았어요.', 3200);
  return true;
}

// ---------- 사진 줄이기 ----------

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // createImageBitmap 을 못 쓰는 브라우저
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function toJpeg(source, maxEdge, quality) {
  const w = source.width;
  const h = source.height;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

async function prepare(file) {
  const source = await decode(file);
  // dataUrl: AI 에 보낼 사진, preview: 화면용, thumb: 최근 기록용 (이 기기에만 저장)
  return { dataUrl: toJpeg(source, 1600, 0.85), preview: toJpeg(source, 480, 0.8), thumb: toJpeg(source, 200, 0.72) };
}

// ---------- 사진 고르기 ----------

async function addFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
  if (!files.length) return;
  const room = MAX_PHOTOS - tray.length;
  if (room <= 0) {
    toast(`사진은 ${MAX_PHOTOS}장까지예요.`);
    return;
  }
  if (files.length > room) toast(`사진은 ${MAX_PHOTOS}장까지라 앞의 ${room}장만 넣었어요.`);
  for (const file of files.slice(0, room)) {
    try {
      tray.push(await prepare(file));
    } catch {
      toast('이 사진은 열 수 없어요. 다른 사진으로 해 주세요.');
    }
  }
  renderTray();
}

function renderTray() {
  els.tray.hidden = !tray.length;
  if (!tray.length) return;
  els.tray.innerHTML = `
    <div class="tray-photos">
      ${tray.map((p, i) => `<div class="tray-photo"><img src="${p.thumb}" alt="고른 사진 ${i + 1}"><button type="button" data-remove="${i}" aria-label="사진 ${i + 1} 빼기">✕</button></div>`).join('')}
      ${tray.length < MAX_PHOTOS ? `<label class="tray-add"><input type="file" accept="image/*" capture="environment" data-add hidden><span>＋</span><small>뒷면 한글<br>스티커도</small></label>` : ''}
    </div>
    <button type="button" class="primary-button snap-go" data-go>🔎 이 술 알아보기 <small>(${tray.length}장)</small></button>`;
}

// ---------- 분석 ----------

const STEPS = ['라벨 글자 읽는 중', '어떤 술인지 찾는 중', '맛·마시는 법·가격 정리하는 중'];

function loadingHtml({ thumb, text }) {
  return `
    <div class="snap-loading" aria-live="polite">
      <div class="snap-scan">${thumb ? `<img src="${thumb}" alt="">` : '<span class="em" aria-hidden="true">🔎</span>'}<i class="scan-line" aria-hidden="true"></i></div>
      <h2 id="sheetTitle">${text ? `"${escapeHtml(text)}" 알아보는 중…` : '술을 알아보는 중…'}</h2>
      <ol class="snap-steps">${STEPS.map((s, i) => `<li data-step="${i}" class="${i === 0 ? 'on' : ''}">${s}</li>`).join('')}</ol>
      <p class="note">보통 10~30초 걸려요. 창을 닫지 말고 기다려 주세요.</p>
    </div>`;
}

function errorHtml(message, retry) {
  return `
    <div class="snap-loading">
      <div class="snap-scan"><span class="em" aria-hidden="true">😵</span></div>
      <h2 id="sheetTitle">알아보지 못했어요</h2>
      <p class="snap-error">${escapeHtml(message)}</p>
      <div class="link-grid" style="margin-top:14px">
        ${retry ? '<button type="button" class="primary" data-retry-snap>다시 시도</button>' : ''}
        <button type="button" data-close>닫기</button>
      </div>
    </div>`;
}

async function identify({ images = [], text = '', thumb = null, preview = null }) {
  if (busy) return;
  if (notReady()) return;
  busy = true;
  const t = openSheet(loadingHtml({ thumb: preview || thumb, text }));
  let step = 0;
  const timer = setInterval(() => {
    step = Math.min(STEPS.length - 1, step + 1);
    for (const li of document.querySelectorAll('.snap-steps li')) li.classList.toggle('on', Number(li.dataset.step) <= step);
  }, 6000);
  try {
    const res = await fetch(apiUrl('identify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ images, text }),
      signal: AbortSignal.timeout(120_000),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* 본문 없음 */
    }
    if (!res.ok || !body?.ok) throw Object.assign(new Error(body?.error || `요청에 실패했어요 (${res.status})`), { retry: res.status >= 500 || res.status === 429 });
    const result = normalizeResult(body.result);
    if (result.is_alcohol) saveHistory({ result, thumb, text, model: body.model });
    if (sheetIsCurrent(t)) renderResult(result, { thumb: preview || thumb, text, model: body.model, cached: body.cached });
    if (images.length) {
      tray = [];
      renderTray();
    }
  } catch (err) {
    const message = err.name === 'TimeoutError' ? '시간이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.' : err.name === 'TypeError' ? '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.' : err.message;
    if (sheetIsCurrent(t)) {
      openSheet(errorHtml(message, err.retry !== false));
      lastRequest = { images, text, thumb, preview };
    }
  } finally {
    clearInterval(timer);
    busy = false;
  }
}

let lastRequest = null;

/** 이름으로 AI 에게 물어보기 */
export function askText(text) {
  const q = cleanQueryText(text);
  if (q.length < 2) {
    toast('술 이름을 두 글자 이상 적어 주세요.');
    return;
  }
  identify({ text: q });
}

// ---------- 결과 ----------

/** 앱 목록에 같은 제품이 있으면 (이름이 서로 포함될 때만) */
function catalogMatch(result) {
  const name = norm(result.name_ko);
  if (!name) return null;
  const hit = searchProducts(PRODUCTS, result.name_ko)[0];
  if (!hit) return null;
  const n = norm(hit.name);
  return name.includes(n) || n.includes(name) ? hit : null;
}

function bar(label, value) {
  return `<div>${label} <span class="bar"><i style="width:${value * 20}%"></i></span></div>`;
}

function renderResult(result, { thumb, text, model: usedModel, cached }) {
  if (!result.is_alcohol) {
    openSheet(`
      <div class="snap-loading">
        <div class="snap-scan">${thumb ? `<img src="${thumb}" alt="">` : '<span class="em" aria-hidden="true">🤔</span>'}</div>
        <h2 id="sheetTitle">술을 찾지 못했어요</h2>
        <p class="snap-error">${escapeHtml(result.not_alcohol_reason || '사진에서 술병을 알아보지 못했어요.')}</p>
        <ul class="bullets" style="text-align:left;margin-top:12px">
          <li>라벨이 화면 가운데에 크게, 정면으로 오게 찍어 주세요.</li>
          <li>밝은 곳에서, 반사광이 라벨을 가리지 않게 해 주세요.</li>
          <li>뒷면의 <b>한글 수입사 스티커</b>도 같이 찍으면 훨씬 정확해요.</li>
        </ul>
        <div class="link-grid" style="margin-top:14px"><button type="button" class="primary" data-snap-camera>📷 다시 찍기</button><button type="button" data-close>닫기</button></div>
      </div>`);
    return;
  }
  const cat = CATEGORY_BY_ID[result.category];
  const color = CATEGORY_COLORS[result.category];
  const conf = CONFIDENCE_LABELS[result.confidence];
  const name = displayName(result);
  const match = catalogMatch(result);
  const channels = (BUY_BY_CATEGORY[result.category] || [
    { ch: 'shop', score: 5 },
    { ch: 'department', score: 4 },
    { ch: 'mart', score: 3 },
  ]).slice(0, 4);
  const shopWord = SHOP_WORDS[result.category] || '보틀샵';
  const p = result.price;
  const h = result.how_to_drink;
  const facts = (rows) => rows.filter(([, v]) => v).map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');

  const html = `
    <div class="sheet-hero snap-hero-result">
      <div class="snap-head">
        ${thumb ? `<img class="snap-thumb" src="${thumb}" alt="찍은 사진">` : `<div class="em" aria-hidden="true">${cat?.emoji || '🍾'}</div>`}
        <div>
          <h2 id="sheetTitle">${escapeHtml(name)}</h2>
          ${result.name_original && result.name_original !== name ? `<div class="en">${escapeHtml(result.name_original)}</div>` : ''}
          ${result.producer ? `<div class="en">${escapeHtml(result.producer)}</div>` : ''}
        </div>
      </div>
      <div class="card-badges">
        ${cat ? `<a class="badge brand" href="#guide/${cat.id}">${cat.emoji} ${escapeHtml(cat.name)}</a>` : '<span class="badge plain">그 밖의 술</span>'}
        ${result.style ? `<span class="badge plain">${escapeHtml(result.style)}</span>` : ''}
        ${[result.country, result.region].filter(Boolean).length ? `<span class="badge plain">${escapeHtml([result.country, result.region].filter(Boolean).join(' · '))}</span>` : ''}
        ${result.age_or_vintage ? `<span class="badge plain">${escapeHtml(result.age_or_vintage)}</span>` : ''}
      </div>
      <details class="confidence ${conf.cls}">
        <summary><span class="badge ${conf.cls}">AI 판단 · ${conf.label}</span></summary>
        ${result.confidence_note ? `<p>${escapeHtml(result.confidence_note)}</p>` : ''}
        ${result.label_text ? `<p class="note">라벨에서 읽은 글자: ${escapeHtml(result.label_text)}</p>` : ''}
      </details>
      <div class="stat-row">
        <div><small>도수</small><b>${escapeHtml(result.abv || '라벨 확인')}</b></div>
        <div><small>용량</small><b>${escapeHtml(result.volume || '-')}</b></div>
        <div><small>AI 추정가</small><b>${p.krw_low ? escapeHtml(fmtPriceRange([p.krw_low, p.krw_high]).replace('약 ', '')) : '알 수 없음'}</b></div>
      </div>
    </div>
    <div class="detail-content">
      ${result.summary ? `<p class="snap-summary">${escapeHtml(result.summary)}</p>` : ''}
      <div class="taste" aria-label="맛">${bar('단맛', result.sweetness)}${bar('진하기', result.body)}</div>
      ${match ? `<button type="button" class="catalog-hit" data-product-open="${escapeHtml(match.id)}">📘 앱에 있는 제품 정보: <b>${escapeHtml(match.name)}</b> →</button>` : ''}
      ${result.description ? `<div class="sheet-section"><h3>어떤 술이에요?</h3><p>${escapeHtml(result.description)}</p>${result.ingredients ? `<p class="note">원료·품종: ${escapeHtml(result.ingredients)}</p>` : ''}</div>` : ''}
      ${
        result.tasting.nose || result.tasting.palate || result.tasting.finish
          ? `<div class="sheet-section"><h3>향과 맛</h3><dl class="facts">${facts([
              ['👃 향', result.tasting.nose],
              ['👅 맛', result.tasting.palate],
              ['✨ 여운', result.tasting.finish],
            ])}</dl></div>`
          : ''
      }
      <div class="sheet-section">
        <h3>이렇게 마셔요</h3>
        <dl class="facts">${facts([
          ['온도', h.temperature],
          ['잔', h.glass],
        ])}</dl>
        ${h.methods.length ? `<ul class="bullets">${h.methods.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ul>` : ''}
        ${h.tips ? `<p class="note">💡 ${escapeHtml(h.tips)}</p>` : ''}
      </div>
      ${result.food_pairing.length ? `<div class="sheet-section"><h3>어울리는 음식</h3><div class="pill-row">${result.food_pairing.map((f) => `<span class="tag food">${escapeHtml(f)}</span>`).join('')}</div></div>` : ''}
      <div class="sheet-section">
        <h3>가격 <small>AI 추정 · 실제와 다를 수 있어요</small></h3>
        ${p.krw_low ? `<p class="snap-price">${escapeHtml(fmtPriceRange([p.krw_low, p.krw_high]))}</p>` : '<p>가격을 추정하지 못했어요.</p>'}
        ${p.basis ? `<p class="note">기준: ${escapeHtml(p.basis)}</p>` : ''}
        ${p.note ? `<p class="note">${escapeHtml(p.note)}</p>` : ''}
        <div id="sheetKca"></div>
        <div class="link-grid" style="margin-top:8px">
          <a class="primary" href="https://search.naver.com/search.naver?query=${encodeURIComponent(priceQuery(result))}" target="_blank" rel="noopener">${ICON.search}네이버에서 실제 가격 보기</a>
          <a href="https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(`${displayName(result)} 후기`)}" target="_blank" rel="noopener">${ICON.web}마셔 본 사람 후기</a>
        </div>
      </div>
      <div class="sheet-section">
        <h3>어디서 살까 <small>가까운 곳도 함께</small></h3>
        ${result.where_to_buy ? `<p>${escapeHtml(result.where_to_buy)}</p>` : ''}
        <div class="channel-list">${channels.map((c) => channelCard(c.ch, { why: c.why, score: c.score, nearHtml: `<div class="near" data-near="${c.ch}"></div>` })).join('')}</div>
        <div class="link-grid" style="margin-top:8px">
          <a id="sheetKakaoSearch" href="${mapSearchLinks(shopWord).kakao}" target="_blank" rel="noopener">${ICON.map}근처 ${escapeHtml(shopWord)} (카카오맵)</a>
          <a id="sheetNaverSearch" href="${mapSearchLinks(shopWord).naver}" target="_blank" rel="noopener">${ICON.map}근처 ${escapeHtml(shopWord)} (네이버지도)</a>
        </div>
      </div>
      ${
        result.similar.length
          ? `<div class="sheet-section"><h3>비슷한 술 <small>눌러서 알아보기</small></h3><div class="similar-list">${result.similar
              .map((s) => `<button type="button" class="similar" data-ask="${escapeHtml(s.name)}"><b>${escapeHtml(s.name)}</b><span>${escapeHtml(s.why)}</span></button>`)
              .join('')}</div></div>`
          : ''
      }
      ${result.storage ? `<div class="sheet-section"><h3>보관</h3><p>${escapeHtml(result.storage)}</p></div>` : ''}
      ${result.fun_fact ? `<div class="sheet-section"><h3>알고 마시면 더 맛있는 이야기</h3><p>${escapeHtml(result.fun_fact)}</p></div>` : ''}
      <div class="link-grid" style="margin-top:18px">
        <button type="button" data-snap-camera>📷 다른 술 찍기</button>
        ${cat ? `<a href="#guide/${cat.id}">${cat.emoji} ${escapeHtml(cat.name)} 알아보기</a>` : `<button type="button" data-share data-title="${escapeHtml(name)}" data-text="${escapeHtml(`${name} - ${result.summary}`)}" data-hash="#find">${ICON.share}공유</button>`}
      </div>
      <p class="note">AI(${escapeHtml(usedModel || model || 'Claude')})가 ${text ? '이름' : '사진'}을 보고 정리한 내용이에요${cached ? ' (같은 질문의 저장된 결과)' : ''}. 도수·빈티지·가격 같은 중요한 정보는 라벨과 판매처에서 꼭 확인하세요.</p>
    </div>`;
  const t = openSheet(html, color);
  fillProductNearby({ cat: result.category }, channels, t);
  if (match?.kca) fillProductKca(match, t);
}

// ---------- 최근 알아본 술 ----------

function loadHistory() {
  const list = storage.get(HISTORY_KEY, []);
  return Array.isArray(list) ? list : [];
}

function saveHistory({ result, thumb, text, model: usedModel }) {
  const all = loadHistory();
  const same = (h) => result.name_ko && h.result?.name_ko === result.name_ko;
  // 같은 술을 이름으로 다시 물어봤으면 전에 찍은 사진은 남김
  const keepThumb = thumb || all.find((h) => same(h) && h.thumb)?.thumb || null;
  const list = all.filter((h) => !same(h));
  list.unshift({ id: Date.now().toString(36), at: Date.now(), result, thumb: keepThumb, text, model: usedModel });
  storage.set(HISTORY_KEY, list.slice(0, HISTORY_MAX));
  renderHistory();
}

function renderHistory() {
  if (!els.history) return;
  const list = loadHistory();
  els.history.hidden = !list.length;
  if (!list.length) return;
  els.history.innerHTML = `
    <div class="history-head"><h2 class="section-title" style="margin:0">최근 알아본 술</h2><button type="button" class="text-link" data-history-clear>지우기</button></div>
    <div class="history-row">${list
      .map((h) => {
        const r = normalizeResult(h.result);
        const cat = CATEGORY_BY_ID[r.category];
        return `<button type="button" class="history-item" data-history="${escapeHtml(h.id)}">
          ${h.thumb ? `<img src="${h.thumb}" alt="">` : `<span class="em" style="--c:${CATEGORY_COLORS[r.category] || 'var(--brand)'}">${cat?.emoji || '🍾'}</span>`}
          <b>${escapeHtml(displayName(r))}</b>
          <small>${escapeHtml(cat?.name || r.style || '')}</small>
        </button>`;
      })
      .join('')}</div>`;
}

// ---------- 시작 ----------

export function openCamera() {
  if (notReady()) return;
  els.camera?.click();
}

export function initSnap() {
  for (const id of ['snapHero', 'snapCamera', 'snapAlbum', 'snapTray', 'snapStatus', 'snapHistory']) {
    els[id.replace('snap', '').toLowerCase()] = document.getElementById(id);
  }
  renderStatus();
  renderHistory();
  checkHealth();

  const onPick = (e) => {
    if (notReady()) {
      e.target.value = '';
      return;
    }
    addFiles(e.target.files).finally(() => {
      e.target.value = '';
    });
  };
  els.camera.addEventListener('change', onPick);
  els.album.addEventListener('change', onPick);
  // 아직 준비 안 됐으면 파일 선택 창을 열지 않음
  for (const input of [els.camera, els.album]) {
    input.closest('label').addEventListener('click', (e) => {
      if (ready !== true) {
        e.preventDefault();
        notReady();
      }
    });
  }

  els.tray.addEventListener('change', (e) => {
    if (e.target.matches('[data-add]')) addFiles(e.target.files);
  });
  els.tray.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      tray.splice(Number(rm.dataset.remove), 1);
      renderTray();
      return;
    }
    if (e.target.closest('[data-go]') && tray.length) {
      identify({ images: tray.map((p) => p.dataUrl), thumb: tray[0].thumb, preview: tray[0].preview });
    }
  });

  document.getElementById('snapQuick')?.addEventListener('click', () => {
    if (!location.hash.startsWith('#find')) location.hash = 'find';
    openCamera();
  });

  els.history.addEventListener('click', (e) => {
    if (e.target.closest('[data-history-clear]')) {
      storage.set(HISTORY_KEY, []);
      renderHistory();
      return;
    }
    const item = e.target.closest('[data-history]');
    if (!item) return;
    const h = loadHistory().find((x) => x.id === item.dataset.history);
    if (h) renderResult(normalizeResult(h.result), { thumb: h.thumb, text: h.text, model: h.model, cached: true });
  });

  // 앱 어디서나: data-ask="이름" 은 AI 에게 묻기, 결과 화면의 버튼들
  document.addEventListener('click', (e) => {
    const ask = e.target.closest('[data-ask]');
    if (ask) {
      askText(ask.dataset.ask);
      return;
    }
    if (e.target.closest('[data-snap-camera]')) {
      document.getElementById('sheet').close();
      if (!location.hash.startsWith('#find')) location.hash = 'find';
      openCamera();
      return;
    }
    if (e.target.closest('[data-retry-snap]') && lastRequest) {
      identify(lastRequest);
      return;
    }
    const prod = e.target.closest('[data-product-open]');
    if (prod) {
      const p = PRODUCTS.find((x) => x.id === prod.dataset.productOpen);
      if (p) openProduct(p);
    }
  });
}

export const aiStatus = () => ({ ready, model });
