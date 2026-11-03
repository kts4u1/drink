// 지도 (Leaflet + OpenStreetMap). 지도 보기를 처음 열 때 불러옵니다.
import { fmtDistance } from './lib/geo.js';

let leafletPromise = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  leafletPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/leaflet/leaflet.js';
    script.onload = () => resolve(window.L);
    script.onerror = () => {
      leafletPromise = null;
      reject(new Error('지도를 불러오지 못했어요.'));
    };
    document.head.append(script);
  });
  return leafletPromise;
}

export const KIND_COLORS = {
  shop: '#9f1239',
  warehouse: '#c2410c',
  mart: '#0f766e',
  super: '#15803d',
  department: '#6d28d9',
  brewery: '#854d0e',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export class StoreMap {
  /** onSelect(item): 마커의 "자세히 보기", onPick(lat, lng): 지도에서 기준 위치 고르기 */
  constructor(container, { onSelect, onPick }) {
    this.container = container;
    this.onSelect = onSelect;
    this.onPick = onPick;
    this.map = null;
  }

  /** items: [{ la, lo, k, n, b, d, label? }] */
  async render({ center, radiusKm, items, kindLabel }) {
    const L = await loadLeaflet();
    if (!this.map) {
      this.map = L.map(this.container);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(this.map);
      this.layer = L.layerGroup().addTo(this.map);
      this.map.on('click', (e) => this.showPickPopup(L, e.latlng));
    }
    this.layer.clearLayers();

    const centerLatLng = L.latLng(center.lat, center.lng);
    L.circle(centerLatLng, { radius: radiusKm * 1000, color: '#9f1239', weight: 1.5, fillOpacity: 0.04, interactive: false }).addTo(this.layer);

    // 먼 것부터 그려서 가까운 마커가 위에 오도록
    for (const item of [...items].reverse()) {
      const marker = L.circleMarker([item.la, item.lo], {
        radius: item.k === 'warehouse' || item.k === 'department' ? 8 : 6.5,
        color: '#ffffff',
        weight: 2,
        fillColor: KIND_COLORS[item.k] || '#9f1239',
        fillOpacity: 0.95,
        bubblingMouseEvents: false,
      });
      marker.bindPopup(() => this.popupFor(item, kindLabel));
      marker.addTo(this.layer);
    }

    L.circleMarker(centerLatLng, { radius: 8, color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1, bubblingMouseEvents: false })
      .bindTooltip('기준 위치')
      .addTo(this.layer);

    this.map.invalidateSize();
    this.map.fitBounds(centerLatLng.toBounds(radiusKm * 2000), { padding: [8, 8] });
  }

  popupFor(item, kindLabel) {
    const box = el('div', 'map-popup');
    box.append(el('strong', null, item.n));
    box.append(el('p', null, `${item.label || kindLabel?.(item) || item.b} · ${fmtDistance(item.d)}`));
    const button = el('button', null, '자세히 보기');
    button.type = 'button';
    button.addEventListener('click', () => {
      this.map.closePopup();
      this.onSelect(item);
    });
    box.append(button);
    return box;
  }

  showPickPopup(L, latlng) {
    const box = el('div', 'map-popup');
    box.append(el('p', null, '이 위치를 기준으로 다시 찾을까요?'));
    const button = el('button', null, '여기를 기준 위치로');
    button.type = 'button';
    button.addEventListener('click', () => {
      this.map.closePopup();
      this.onPick(latlng.lat, latlng.lng);
    });
    box.append(button);
    L.popup().setLatLng(latlng).setContent(box).openOn(this.map);
  }

  refreshSize() {
    this.map?.invalidateSize();
  }
}
