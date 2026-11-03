// 앱 시작점: 나이 확인 → 탭·화면 준비 → 기준 위치
import { initLocation, resolveInitialLocation } from './location.js';
import { initSheets } from './sheets.js';
import { onLocationChange, state } from './state.js';
import { storage } from './util.js';
import { initFind, showFind } from './view-find.js';
import { initGuide, refreshGuideNear, showGuide } from './view-guide.js';
import { initNearby, showNearby } from './view-nearby.js';
import { initPrices, showPrices } from './view-prices.js';

const TABS = { guide: showGuide, find: showFind, nearby: showNearby, prices: showPrices };
let currentTab = null;

function route() {
  const [tab, ...rest] = location.hash.slice(1).split('/');
  const name = TABS[tab] ? tab : 'guide';
  for (const btn of document.querySelectorAll('.tabs [data-tab]')) btn.setAttribute('aria-selected', String(btn.dataset.tab === name));
  for (const id of Object.keys(TABS)) document.getElementById(`view-${id}`).hidden = id !== name;
  const changedTab = currentTab !== name;
  currentTab = name;
  // 뒤로 가기 등으로 주소가 바뀌면 열려 있던 상세 창은 닫음 (#find/<제품> 이면 다시 열림)
  const sheet = document.getElementById('sheet');
  if (sheet.open) sheet.close();
  TABS[name](decodeURIComponent(rest.join('/')));
  // 백과 안에서 글을 옮겨 다닐 때와 탭을 바꿀 때는 맨 위로
  if (name === 'guide' || changedTab) window.scrollTo({ top: 0 });
}

function initTabs() {
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    if (location.hash.slice(1) === btn.dataset.tab) route();
    else location.hash = btn.dataset.tab;
  });
  window.addEventListener('hashchange', route);
}

function initDialogs() {
  // 창이 열려 있으면 뒤 화면 스크롤 잠금 (:has() 를 모르는 오래된 브라우저용)
  const syncScrollLock = () => document.documentElement.classList.toggle('dialog-open', !!document.querySelector('dialog[open]'));
  const observer = new MutationObserver(syncScrollLock);
  for (const dialog of document.querySelectorAll('dialog')) {
    observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    if (dialog.dataset.locked !== undefined) continue;
    dialog.addEventListener('click', (e) => {
      // 바깥(배경) 누르면 닫기
      if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
    });
  }
}

// 그룹 제목·목차가 헤더 아래에 붙도록 헤더 높이를 CSS 변수로
function trackHeaderHeight() {
  const header = document.querySelector('.app-header');
  const apply = () => document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
  apply();
  new ResizeObserver(apply).observe(header);
}

/** 만 19세 이상 확인 (한 번만) */
function confirmAge() {
  if (storage.get('adult')) return Promise.resolve(true);
  const dialog = document.getElementById('ageDialog');
  dialog.addEventListener('cancel', (e) => e.preventDefault()); // Esc 로 닫지 못하게
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.querySelector('[data-adult="yes"]').addEventListener('click', () => {
      storage.set('adult', true);
      dialog.close();
      resolve(true);
    });
    dialog.querySelector('[data-adult="no"]').addEventListener('click', () => {
      dialog.close();
      resolve(false);
    });
  });
}

async function main() {
  trackHeaderHeight();
  initDialogs();
  initSheets();
  initLocation();
  initGuide();
  initFind();
  initNearby();
  initPrices();
  initTabs();
  onLocationChange(refreshGuideNear);

  if (!(await confirmAge())) {
    document.querySelector('main').innerHTML = '<div class="age-block"><div style="font-size:48px">🙅</div><h2>19세 미만은 이용할 수 없어요</h2><p class="muted">술은 만 19세 이상만 살 수 있어요.</p></div>';
    document.querySelector('.tabs').hidden = true;
    document.getElementById('locButton').hidden = true;
    return;
  }

  // 저장된 위치가 있으면 바로 그걸로 화면을 그리고, 위치 확인은 뒤에서
  if (state.location) document.getElementById('locLabel').textContent = state.location.label;
  route();
  // 위치가 정해지거나 바뀌면 각 화면이 onLocationChange 로 다시 그려요
  await resolveInitialLocation();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

main();
