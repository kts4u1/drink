// 거리 계산 (브라우저와 Node 스크립트 공통)

const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

/** 두 좌표 사이의 직선 거리(km) - 하버사인 공식 */
export function distanceKm(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 대한민국 영역 안의 좌표인지 (0 이거나 엉뚱한 좌표를 걸러내기 위함) */
export function isKoreanCoord(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat > 32.8 && lat < 38.9 && lng > 124 && lng < 132;
}

/** 350m / 1.2km / 14km */
export function fmtDistance(km) {
  if (km == null || !Number.isFinite(km)) return '';
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)}m`;
  if (km < 10) return `${km.toFixed(1)}km`;
  return `${Math.round(km)}km`;
}

/** 걸어서 몇 분 (시속 4.5km), 2km 넘으면 null */
export function walkMinutes(km) {
  if (km == null || km > 2) return null;
  return Math.max(1, Math.round((km / 4.5) * 60));
}
