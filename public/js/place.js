// 기준 위치의 동네 이름 (지도 앱에서 "서교동 와인샵"처럼 검색하기 위해)
// OpenStreetMap Nominatim 역지오코딩을 위치가 바뀔 때만 한 번 부르고, 결과는 이 기기에 저장합니다.
import { state } from './state.js';
import { storage } from './util.js';

const memo = storage.get('placeNames', {});
let inflight = null;

function key(lat, lng) {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

function pickName(address = {}) {
  const dong = address.quarter || address.suburb || address.neighbourhood || address.village || address.town || '';
  const gu = address.borough || address.city_district || address.county || '';
  const city = address.city || address.province || address.state || '';
  return { dong: dong.trim(), gu: gu.trim(), city: city.trim() };
}

/** 동네 이름 { dong, gu, city } 또는 null (실패하면 null) */
export async function placeName(lat = state.location?.lat, lng = state.location?.lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const k = key(lat, lng);
  if (memo[k]) return memo[k];
  if (inflight?.k === k) return inflight.p;
  const p = (async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&accept-language=ko&lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
      if (!res.ok) return null;
      const body = await res.json();
      const name = pickName(body.address);
      if (!name.dong && !name.gu) return null;
      memo[k] = name;
      const keys = Object.keys(memo);
      if (keys.length > 30) delete memo[keys[0]];
      storage.set('placeNames', memo);
      return name;
    } catch {
      return null;
    }
  })();
  inflight = { k, p };
  return p;
}

/** 지도 앱 검색어에 붙일 동네 이름 ("마포구 서교동"). 도시를 골랐으면 그 이름 */
export function areaPrefix(name) {
  const loc = state.location;
  if (loc?.source === 'city') return loc.label.replace(/시청$/, '');
  if (!name) return '';
  return [name.gu, name.dong].filter(Boolean).join(' ');
}

/** 카카오맵·네이버지도 검색 링크 (카카오 API 가 아니라 일반 웹 링크라 키가 필요 없어요) */
export function mapSearchLinks(query) {
  const q = encodeURIComponent(query.trim());
  return {
    kakao: `https://map.kakao.com/link/search/${q}`,
    naver: `https://map.naver.com/p/search/${q}`,
  };
}

/** 장소 하나를 지도 앱에서 보기·길찾기 */
export function placeLinks(name, lat, lng) {
  const n = encodeURIComponent(String(name).replace(/,/g, ' '));
  return {
    kakaoMap: `https://map.kakao.com/link/map/${n},${lat},${lng}`,
    kakaoRoute: `https://map.kakao.com/link/to/${n},${lat},${lng}`,
    naver: `https://map.naver.com/p/search/${n}`,
  };
}
