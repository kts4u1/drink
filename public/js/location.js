// 기준 위치: 현재 위치(GPS) 또는 도시 선택 ("어디갈까" 앱 kts4u1/Tour 의 location.js 를 가져와 문구만 바꿈)
//
// 브라우저가 띄우는 위치 권한 창은 모양을 바꿀 수 없습니다. 그래서 처음에는 앱의 안내 화면을 먼저 보여 주고,
// 사용자가 "현재 위치로 시작하기"를 눌렀을 때만 권한을 요청합니다. 다시 열 때도 권한이 이미 허용된
// 경우에만 조용히 위치를 새로 확인하고, 아니면 지난 위치를 쓰면서 아래쪽에 "지금 위치로" 버튼만 띄웁니다.
import { CITIES } from './cities.js';
import { distanceKm } from './lib/geo.js';
import { setLocation, state } from './state.js';
import { escapeHtml, storage, toast } from './util.js';

const $ = (id) => document.getElementById(id);
const dialog = $('locationDialog');
const nudge = $('locNudge');

const FRESH_MS = 15 * 60 * 1000; // 이보다 최근에 확인한 위치는 그대로 '현재 위치'로 씀
const INTRO_KEY = 'locIntro';

const GEO_ERRORS = {
  1: '위치 권한이 꺼져 있어요.',
  2: '지금은 위치를 확인할 수 없어요. 잠시 후 다시 시도하거나 도시를 골라 주세요.',
  3: '위치 확인이 오래 걸리고 있어요. 다시 시도하거나 도시를 골라 주세요.',
};

const MODES = {
  welcome: {
    title: '내 주변 술 파는 곳을 찾아드릴게요',
    lead: () => '지금 있는 곳을 기준으로 가까운 와인샵·마트·양조장과 소주·맥주·막걸리 최저가를 보여드려요.',
    gps: '현재 위치로 시작하기',
  },
  change: { title: '기준 위치', lead: currentLead, gps: '현재 위치로 찾기' },
};

const HELP = {
  ios: [
    ['Safari에서', '주소창 왼쪽 버튼(<b>가가</b> 또는 메뉴) › <b>웹 사이트 설정</b> › 위치 › <b>허용</b>'],
    ['그래도 안 되면', '설정 › 개인정보 보호 및 보안 › 위치 서비스 › <b>Safari 웹 사이트</b> › <b>앱을 사용하는 동안</b>'],
  ],
  android: [
    ['Chrome에서', '주소창 왼쪽 아이콘 › <b>권한</b> › 위치 › <b>허용</b>'],
    ['그래도 안 되면', '휴대폰 설정 › 위치 › <b>위치 사용</b> 켜기'],
  ],
  desktop: [['브라우저에서', '주소창 왼쪽 사이트 정보(자물쇠) 아이콘 › 위치 › <b>허용</b>']],
};

class GeoError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.code = code;
  }
}

export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) {
      reject(new GeoError('현재 위치는 https 주소(또는 localhost)에서만 사용할 수 있어요.'));
      return;
    }
    if (!('geolocation' in navigator)) {
      reject(new GeoError('이 브라우저는 위치 정보를 지원하지 않아요.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new GeoError(GEO_ERRORS[err.code] || GEO_ERRORS[2], err.code)),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

/** 권한 창을 띄우지 않고 상태만 확인: 'granted' | 'prompt' | 'denied' | 'unknown' */
export async function permissionState() {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' });
    return status?.state || 'unknown';
  } catch {
    return 'unknown';
  }
}

function platform() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

function ago(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.round(hours / 24)}일 전`;
}

function currentLead() {
  const loc = state.location;
  if (!loc) return '';
  if (loc.source === 'gps') {
    return loc.at ? `지금은 ${ago(Date.now() - loc.at)} 확인한 내 위치 기준이에요.` : '지금은 지난번 내 위치 기준이에요.';
  }
  return `지금은 '${loc.label}' 기준이에요.`;
}

// ===== 안내 화면 =====

function showCities(open) {
  dialog.dataset.cities = open ? 'open' : '';
  $('toggleCities').setAttribute('aria-expanded', String(open));
}

function render(status, message = '') {
  const mode = MODES[dialog.dataset.mode] || MODES.change;
  const denied = status === 'denied';
  const failed = denied || status === 'error';
  dialog.dataset.status = status;
  $('locationDialogTitle').textContent = denied ? '위치 권한이 꺼져 있어요' : mode.title;
  $('locLead').textContent = denied ? '권한을 켜면 바로 내 주변을 찾아드려요. 지금은 아래에서 도시를 골라도 돼요.' : mode.lead();
  $('gpsLabel').textContent = status === 'locating' ? '위치 확인 중…' : failed ? '다시 시도' : mode.gps;
  $('useGpsButton').disabled = status === 'locating';
  $('useGpsButton').setAttribute('aria-busy', String(status === 'locating'));
  $('gpsHelp').hidden = !denied;
  $('gpsHint').textContent = status === 'error' ? message : '';
  if (failed) showCities(true);
}

function markCurrentCity() {
  const loc = state.location;
  for (const btn of document.querySelectorAll('#cityGrid button')) {
    const city = CITIES[btn.dataset.index];
    btn.setAttribute('aria-pressed', String(loc?.source === 'city' && loc.label === city.name));
  }
}

/** mode: 'welcome' (처음 안내) | 'change' (위치 버튼으로 열었을 때) */
export function openDialog(mode = 'change') {
  dialog.dataset.mode = mode;
  dialog.returnValue = '';
  showCities(mode === 'change');
  render('idle');
  markCurrentCity();
  if (!dialog.open) dialog.showModal();
  permissionState().then((perm) => {
    dialog.dataset.perm = perm;
    // 이미 거부된 상태면 버튼을 눌러도 창이 뜨지 않으니 켜는 방법부터 보여 줌
    if (perm === 'denied' && dialog.dataset.status === 'idle') render('denied');
  });
}

// ===== 아래쪽 "지금 위치로" 알림 =====

let nudgeTimer;
function showNudge(age) {
  $('nudgeText').innerHTML = `<b>${escapeHtml(Number.isFinite(age) ? ago(age) : '지난번')}</b> 위치 기준이에요`;
  nudge.hidden = false;
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(hideNudge, 12000);
}

function hideNudge() {
  clearTimeout(nudgeTimer);
  nudge.hidden = true;
  delete nudge.dataset.busy;
}

// ===== 현재 위치 =====

let pending = null;

/** 현재 위치로 바꾸기. quiet 이면 실패해도 아무것도 띄우지 않음 */
export function useGps({ quiet = false } = {}) {
  pending ||= locate(quiet).finally(() => {
    pending = null;
  });
  return pending;
}

async function locate(quiet) {
  if (dialog.open) render('locating');
  try {
    const pos = await getCurrentPosition();
    const prev = state.location;
    const same = prev?.source === 'gps' && distanceKm(prev.lat, prev.lng, pos.lat, pos.lng) < 0.3;
    const fromUser = dialog.open || !nudge.hidden;
    hideNudge();
    if (dialog.open) dialog.close('gps');
    // 조금 움직인 정도면 목록은 다시 불러오지 않고 이름·시각만 갱신
    setLocation({ ...pos, label: '현재 위치', source: 'gps', at: Date.now() }, { notify: !same });
    if (fromUser && !quiet) toast('현재 위치 기준으로 찾았어요');
    return true;
  } catch (err) {
    if (quiet) return false;
    hideNudge();
    if (!dialog.open) openDialog('change');
    render(err.code === 1 ? 'denied' : 'error', err.message);
    return false;
  }
}

export function initLocation() {
  const grid = $('cityGrid');
  grid.innerHTML = CITIES
    .map((c, i) => `<button type="button" data-index="${i}" aria-pressed="false">${escapeHtml(c.name)}</button>`)
    .join('');
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-index]');
    if (!btn) return;
    const city = CITIES[btn.dataset.index];
    hideNudge();
    setLocation({ lat: city.lat, lng: city.lng, label: city.name, source: 'city' });
    dialog.close('city');
  });

  $('gpsHelpSteps').innerHTML = HELP[platform()]
    .map(([where, how]) => `<li><span><small>${where}</small>${how}</span></li>`)
    .join('');

  $('locButton').addEventListener('click', () => openDialog('change'));
  $('useGpsButton').addEventListener('click', () => useGps());
  $('toggleCities').addEventListener('click', () => showCities(dialog.dataset.cities !== 'open'));
  $('locLater').addEventListener('click', () => dialog.close('later'));

  dialog.addEventListener('close', () => {
    if (dialog.dataset.mode !== 'welcome') return;
    storage.set(INTRO_KEY, true);
    if (dialog.returnValue === 'gps' || dialog.returnValue === 'city') return;
    toast(`${state.location.label} 기준으로 보여드려요. 위쪽 위치 버튼에서 언제든 바꿀 수 있어요.`, 4000);
  });

  $('nudgeGps').addEventListener('click', () => {
    nudge.dataset.busy = '';
    useGps();
  });
  $('nudgeClose').addEventListener('click', hideNudge);
}

export function pickLocationOnMap(lat, lng) {
  hideNudge();
  setLocation({ lat, lng, label: '지도에서 고른 위치', source: 'map' });
}

/** 처음 열었을 때 기준 위치 정하기 (화면은 이미 저장된 위치로 불러오는 중) */
export async function resolveInitialLocation() {
  const saved = state.location;
  const valid = saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng);
  const perm = await permissionState();

  if (valid && saved.source === 'gps') {
    storage.set(INTRO_KEY, true);
    const age = saved.at ? Date.now() - saved.at : Infinity;
    const fresh = age < FRESH_MS;
    setLocation({ ...saved, label: fresh ? '현재 위치' : '최근 위치' }, { notify: false });
    if (perm === 'granted') {
      // 이미 허용된 경우에만 창 없이 조용히 새 위치 확인
      const ok = await useGps({ quiet: true });
      if (!ok && !fresh) showNudge(age);
    } else if (!fresh) {
      showNudge(age);
    }
    return;
  }

  if (valid) {
    setLocation(saved, { notify: false });
  } else {
    const fallback = CITIES[0];
    setLocation({ lat: fallback.lat, lng: fallback.lng, label: fallback.name, source: 'city' });
  }
  if (perm === 'granted' && !valid) {
    storage.set(INTRO_KEY, true);
    await useGps({ quiet: true });
    return;
  }
  if (!storage.get(INTRO_KEY) && perm !== 'granted') openDialog('welcome');
}
