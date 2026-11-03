// 앱 전체 상태 (간단한 구독 방식)
import { storage } from './util.js';

const listeners = new Set();

export const state = {
  location: storage.get('location'), // { lat, lng, label, source: 'gps' | 'city' | 'map', at }
};

export function onLocationChange(fn) {
  listeners.add(fn);
}

export function setLocation(location, { notify = true } = {}) {
  state.location = location;
  storage.set('location', location);
  document.getElementById('locLabel').textContent = location.label;
  if (notify) for (const fn of listeners) fn(location);
}
