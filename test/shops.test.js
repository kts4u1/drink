// 동네 술 가게 (소상공인시장진흥공단 상가정보): 고르기·합치기·zip 읽기
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import zlib from 'node:zlib';
import { mergeShops, parseCsvLine, semasShop, shopNameKey } from '../scripts/lib/semas.js';
import { mergeIntoStores, readSemasZip } from '../scripts/update-shops.js';

const HEAD = ['상가업소번호', '상호명', '지점명', '상권업종대분류명', '상권업종소분류명', '도로명주소', '지번주소', '경도', '위도'];
const row = (o) => ({ 상가업소번호: 'MA01', 지점명: '', 상권업종대분류명: '소매', 상권업종소분류명: '주류 소매업', 도로명주소: '서울특별시 마포구 양화로 1', 경도: '126.92', 위도: '37.55', ...o });

test('상가 고르기: 주류 소매업, 술 이름 소매점만', () => {
  const wine = semasShop(row({ 상호명: '와인브라더스' }));
  assert.deepEqual(wine, { id: 'smMA01', k: 'shop', b: '와인샵', n: '와인브라더스', la: 37.55, lo: 126.92, a: '서울특별시 마포구 양화로 1' });
  assert.equal(semasShop(row({ 상호명: '가자주류', 지점명: '전주점' })).n, '가자주류 전주점');
  assert.equal(semasShop(row({ 상호명: '세계주류할인점' })).b, '주류 할인점');
  assert.equal(semasShop(row({ 상호명: '전통주갤러리샵' })).b, '전통주');
  assert.equal(semasShop(row({ 상호명: '스타보틀', 상권업종소분류명: '우유 소매업' })).b, '보틀샵'); // 다른 업종이지만 먹거리 소매 + 보틀
  assert.equal(semasShop(row({ 상호명: '더와인플러스', 상권업종소분류명: '편의점' })).b, '와인샵');
  // 술 가게가 아닌 것
  assert.equal(semasShop(row({ 상호명: '양주철물건재', 상권업종소분류명: '철물/공구 소매업' })), null); // 지명 양주
  assert.equal(semasShop(row({ 상호명: '골든보틀', 상권업종소분류명: '시계/귀금속 소매업' })), null); // 장신구점
  assert.equal(semasShop(row({ 상호명: '쩝쩝박사케이크', 상권업종소분류명: '빵류 소매업' })), null);
  assert.equal(semasShop(row({ 상호명: '와인바', 상권업종대분류명: '음식', 상권업종소분류명: '요리 주점' })), null); // 술집은 뺌
  assert.equal(semasShop(row({ 상호명: '한국주류도매' })), null); // 도매상
  assert.equal(semasShop(row({ 상호명: '와인하우스', 위도: '0', 경도: '0' })), null);
  assert.equal(semasShop(row({ 상호명: '' })), null);
});

test('CSV 한 줄 읽기', () => {
  assert.deepEqual(parseCsvLine('a,"b, c","say ""hi""",'), ['a', 'b, c', 'say "hi"', '']);
});

test('합치기: 지도(OSM)와 겹치는 가게는 하나로, 예전 상가정보는 새로', () => {
  const stores = [
    { id: 'n1', k: 'shop', b: '와인샵', n: '와인브라더스', la: 37.55, lo: 126.92, h: '11:00-22:00' },
    { id: 'w2', k: 'mart', b: '이마트', n: '이마트 신촌점', la: 37.556, lo: 126.94 },
    { id: 'smOLD', k: 'shop', b: '와인샵', n: '없어진 가게', la: 37.5, lo: 127 },
  ];
  const shops = [
    { id: 'smA', k: 'shop', b: '와인샵', n: '와인브라더스 마포점', la: 37.5505, lo: 126.9202, a: '서울 마포구 양화로 1' }, // 같은 곳 (60m)
    { id: 'smB', k: 'shop', b: '와인샵', n: '와인브라더스', la: 37.6, lo: 126.92 }, // 같은 이름, 5km 떨어짐 → 다른 곳
    { id: 'smC', k: 'shop', b: '보틀샵', n: '보틀컨비니언스', la: 37.534, lo: 126.99 },
  ];
  const { stores: out, merged } = mergeShops(stores, shops);
  assert.equal(merged, 1);
  assert.deepEqual(out.map((s) => s.id).sort(), ['n1', 'smB', 'smC', 'w2']);
  assert.equal(out.find((s) => s.id === 'n1').a, '서울 마포구 양화로 1'); // 주소만 채움
  assert.equal(out.find((s) => s.id === 'n1').h, '11:00-22:00');
  assert.equal(stores.find((s) => s.id === 'n1').a, undefined); // 원본은 그대로
  assert.equal(shopNameKey('(주)와인브라더스 마포점'), '와인브라더스마포');
});

/** 테스트용 zip: 상가 CSV 파일 두 개 */
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = zlib.deflateRawSync(Buffer.from(text));
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('zip 읽기 → 가게 목록, stores.json 에 합치기', async () => {
  const csv = (rows) => `﻿${HEAD.join(',')}\n${rows.map((r) => HEAD.map((h) => (String(r[h] ?? '').includes(',') ? `"${r[h]}"` : r[h] ?? '')).join(',')).join('\n')}\n`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shops-test-'));
  try {
    const zip = path.join(dir, 'semas.zip');
    await fs.writeFile(
      zip,
      makeZip([
        ['readme.txt', '파일 열람 방법'],
        ['seoul.csv', csv([row({ 상가업소번호: 'S1', 상호명: '와인브라더스', 도로명주소: '서울 마포구, 양화로 1' }), row({ 상가업소번호: 'S2', 상호명: '김밥천국', 상권업종대분류명: '음식', 상권업종소분류명: '김밥' })])],
        ['busan.csv', csv([row({ 상가업소번호: 'B1', 상호명: '베러댄보틀샵', 위도: '35.15', 경도: '129.11', 상권업종소분류명: '슈퍼마켓' })])],
      ]),
    );
    const { shops, rows } = await readSemasZip(zip);
    assert.equal(rows, 3);
    assert.deepEqual(shops.map((s) => s.id), ['smB1', 'smS1']);
    assert.equal(shops.find((s) => s.id === 'smS1').a, '서울 마포구, 양화로 1');

    // stores.json + shops.json → 합쳐서 다시 쓰기
    await fs.writeFile(path.join(dir, 'stores.json'), JSON.stringify({ version: 1, source: 'OpenStreetMap', count: 1, stores: [{ id: 'w1', k: 'mart', b: '이마트', n: '이마트', la: 37.5, lo: 127 }] }));
    await fs.writeFile(path.join(dir, 'shops.json'), JSON.stringify({ version: 1, baseDate: '2026-09-30', shops }));
    const r = await mergeIntoStores(dir);
    assert.deepEqual(r, { count: 3, added: 2, merged: 0 });
    const out = JSON.parse(await fs.readFile(path.join(dir, 'stores.json'), 'utf8'));
    assert.equal(out.shopsBaseDate, '2026-09-30');
    assert.match(out.source, /소상공인/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('실제 data/shops.json: 형식과 개수', async () => {
  const data = JSON.parse(await fs.readFile(new URL('../data/shops.json', import.meta.url), 'utf8'));
  assert.equal(data.version, 1);
  assert.ok(data.count >= 800, `${data.count}곳`);
  assert.equal(data.count, data.shops.length);
  assert.match(data.baseDate, /^\d{4}-\d{2}-\d{2}$/);
  for (const s of data.shops) {
    assert.ok(s.id.startsWith('sm') && s.k === 'shop' && s.n && s.b, JSON.stringify(s));
    assert.ok(s.la > 32.8 && s.la < 38.9 && s.lo > 124 && s.lo < 132, s.id);
  }
  // stores.json 에 합쳐져 있음
  const stores = JSON.parse(await fs.readFile(new URL('../data/stores.json', import.meta.url), 'utf8'));
  assert.ok(stores.stores.filter((s) => s.id.startsWith('sm')).length > data.count * 0.9);
});
