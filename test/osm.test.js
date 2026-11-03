import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addressOf, classifyOsm, displayName, osmToStores } from '../scripts/lib/osm.js';

const kind = (tags) => classifyOsm(tags)?.kind ?? null;
const label = (tags) => classifyOsm(tags)?.label ?? null;

test('마트 브랜드: 창고형·대형마트·SSM 구분', () => {
  assert.equal(kind({ shop: 'supermarket', name: '이마트 트레이더스 월계점' }), 'warehouse');
  assert.equal(kind({ shop: 'wholesale', name: 'Costco' }), 'warehouse');
  assert.equal(label({ shop: 'supermarket', name: '롯데마트 맥스 송천점' }), '롯데마트 맥스');
  assert.equal(kind({ shop: 'supermarket', name: '이마트 신촌점' }), 'mart');
  assert.equal(kind({ shop: 'supermarket', name: 'E-Mart' }), 'mart');
  assert.equal(label({ shop: 'supermarket', name: '농협하나로마트 양재점' }), '하나로마트');
  assert.equal(kind({ shop: 'supermarket', name: '이마트에브리데이 망원점' }), 'super');
  assert.equal(kind({ shop: 'supermarket', name: '홈플러스 익스프레스 합정점' }), 'super');
  assert.equal(kind({ shop: 'supermarket', name: 'GS더프레시 서교점' }), 'super');
  assert.equal(label({ shop: 'department_store', name: '킴스클럽 강남점' }), '킴스클럽');
});

test('이름 중간에 "이마트"가 들어간 동네 가게와 편의점은 버림', () => {
  for (const name of ['케이마트', '오케이마트', '스카이마트', '이마트24 홍대점', 'emart24', '롯데하이마트', '노브랜드 연남점']) {
    assert.equal(classifyOsm({ shop: 'supermarket', name }), null, name);
  }
});

test('백화점: 브랜드 인식, 아울렛·다이소·영플라자·면세점 제외 (NC·뉴코아는 남김)', () => {
  assert.equal(label({ shop: 'department_store', name: '현대백화점 신촌점' }), '현대백화점');
  assert.equal(label({ shop: 'department_store', name: '더현대 대구' }), '현대백화점');
  assert.equal(label({ shop: 'department_store', name: '갤러리아 타임월드' }), '갤러리아');
  assert.equal(label({ shop: 'department_store', name: '동아백화점 구미점' }), '백화점');
  assert.equal(label({ shop: 'department_store', name: '뉴코아아울렛 동수원점' }), 'NC·뉴코아');
  for (const name of ['다이소', '롯데 영플라자', '현대프리미엄아울렛', '롯데면세점', '와촌 농협 농기계 자재백화점', '한국기념품 백화점']) {
    assert.equal(classifyOsm({ shop: 'department_store', name }), null, name);
  }
});

test('주류 전문점 종류와 술집·카페 걸러내기', () => {
  assert.equal(label({ shop: 'wine', name: '그랑끄뤼 와인샵' }), '와인샵');
  assert.equal(label({ shop: 'alcohol', name: '세종리쿼' }), '보틀샵');
  assert.equal(label({ shop: 'alcohol', name: '불로생막걸리' }), '전통주');
  assert.equal(label({ shop: 'alcohol', name: '가자주류백화점' }), '주류 할인점');
  assert.equal(label({ shop: 'alcohol', name: '오대양주류상사' }), '주류 도매');
  assert.equal(classifyOsm({ shop: 'alcohol', name: '꽃단지(민속주점)' }), null);
  assert.equal(classifyOsm({ shop: 'alcohol', name: '둘둘치킨' }), null);
  // beverages 는 술 관련 이름일 때만
  assert.equal(classifyOsm({ shop: 'beverages', name: '스무디킹 죽전점' }), null);
  assert.equal(classifyOsm({ shop: 'beverages', name: '서울우유' }), null);
  assert.equal(kind({ shop: 'beverages', name: '700비어 거제옥포점' }), 'shop');
});

test('양조장·와이너리·증류소', () => {
  assert.deepEqual(classifyOsm({ craft: 'winery', name: '샤토미소' }), { kind: 'brewery', label: '와이너리' });
  assert.deepEqual(classifyOsm({ craft: 'distillery', name: '어느 증류소' }), { kind: 'brewery', label: '증류소' });
  assert.equal(label({ craft: 'brewery', name: '어메이징 브루잉' }), '브루어리');
  assert.equal(label({ industrial: 'brewery', name: '정산양조장' }), '양조장');
});

test('이름: 한글 이름 우선, 없으면 null', () => {
  assert.equal(displayName({ name: 'E-Mart', 'name:ko': '이마트 연수점' }), '이마트 연수점');
  assert.equal(displayName({ name: 'Wine & More' }), 'Wine & More');
  assert.equal(classifyOsm({ shop: 'wine' }), null);
});

test('주소 조합', () => {
  assert.equal(addressOf({ 'addr:full': '서울특별시 마포구  양화로 19' }), '서울특별시 마포구 양화로 19');
  assert.equal(addressOf({ 'addr:city': '서울특별시', 'addr:district': '마포구', 'addr:street': '양화로', 'addr:housenumber': '19' }), '서울특별시 마포구 양화로 19');
  assert.equal(addressOf({ 'addr:city': '서울특별시' }), undefined);
});

test('osmToStores: 좌표 검사, node·way 중복 합치기, 정렬', () => {
  const elements = [
    { type: 'node', id: 1, lat: 37.55, lon: 126.92, tags: { shop: 'wine', name: '와인샵 A', phone: '02-1' } },
    { type: 'way', id: 2, center: { lat: 37.5501, lon: 126.9201 }, tags: { shop: 'wine', name: '와인샵 A', 'addr:full': '서울 마포구 1' } },
    { type: 'node', id: 3, lat: 0, lon: 0, tags: { shop: 'wine', name: '좌표 없음' } },
    { type: 'node', id: 4, lat: 35.1, lon: 129.0, tags: { shop: 'supermarket', name: '홈플러스 부산점', website: 'javascript:alert(1)' } },
    { type: 'node', id: 5, lat: 37.6, lon: 127.0, tags: { shop: 'supermarket', name: '오케이마트' } },
  ];
  const stores = osmToStores(elements);
  assert.equal(stores.length, 2);
  assert.equal(stores[0].n, '홈플러스 부산점'); // 위도 순
  assert.equal(stores[0].w, undefined); // http(s) 아닌 주소는 버림
  const wine = stores.find((s) => s.k === 'shop');
  assert.equal(wine.id, 'n1');
  assert.equal(wine.p, '02-1');
  assert.equal(wine.a, '서울 마포구 1'); // 중복된 쪽의 주소를 합침
});
