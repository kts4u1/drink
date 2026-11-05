// 동네 술 가게(와인샵·보틀샵·주류 할인점·전통주) 받기 — 소상공인시장진흥공단 상가(상권)정보
//   data/shops.json   고른 가게 목록 (분기마다 새 파일)
//   data/stores.json  OpenStreetMap 매장에 합쳐서 다시 씀 (같은 가게는 하나로)
//
// 공공데이터포털에서 전국 상가 파일(zip, 약 350MB)을 로그인 없이 받습니다. 분기마다 갱신되므로
// 파일 기준일이 지난번과 같으면 받지 않습니다 (--force 로 다시 받기).
//
// 사용법: npm run data:shops
//         npm run data:shops -- --file=./상가정보.zip   (직접 받은 zip 쓰기)
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { SEMAS_DATASET, SEMAS_PAGE, SEMAS_SOURCE, mergeShops, parseCsvLine, semasShop } from './lib/semas.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const SITE = 'https://www.data.go.kr';
const UA = 'Mozilla/5.0 (sulsul-data-update; +https://github.com/kts4u1/drink)';
const log = (...a) => console.log('[shops]', ...a);

// ---------- 공공데이터포털에서 받기 ----------

function cookieJar() {
  const jar = new Map();
  return {
    take(res) {
      for (const c of res.headers.getSetCookie?.() || []) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    },
    header: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
  };
}

/** 파일 정보 (기준일·첨부파일 번호). 받지는 않음 */
export async function semasFileInfo() {
  const jar = cookieJar();
  const page = await fetch(SEMAS_PAGE, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
  jar.take(page);
  const html = await page.text();
  const m = html.match(/fn_fileDataDown\('(\d+)',\s*'(uddi:[^']+)'/);
  if (!m) throw new Error('공공데이터포털 페이지 형식이 바뀌었어요 (다운로드 버튼을 못 찾음)');
  const form = new URLSearchParams({ publicDataDetailPk: m[2], publicDataPk: m[1], atchFileId: '', fileDetailSn: '1', publicDataTyCode: 'PR0051' });
  const res = await fetch(`${SITE}/tcs/dss/selectFileDataDownload.do`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', Referer: SEMAS_PAGE, Cookie: jar.header() },
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  jar.take(res);
  const body = await res.json();
  const dataNm = body?.dataSetFileDetailInfo?.dataNm || '';
  const baseDate = (dataNm.match(/(\d{8})$/) || [])[1];
  if (!body?.atchFileId || !baseDate) throw new Error('파일 정보를 읽지 못했어요');
  return { jar, atchFileId: body.atchFileId, fileDetailSn: String(body.fileDetailSn || 1), dataNm, baseDate: `${baseDate.slice(0, 4)}-${baseDate.slice(4, 6)}-${baseDate.slice(6)}` };
}

async function download(info, file) {
  const { jar } = info;
  const limit = await fetch(`${SITE}/cmm/cmm/check-limit.json`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', Referer: SEMAS_PAGE, Cookie: jar.header() },
    body: new URLSearchParams({ atchFileId: info.atchFileId, fileDetailSn: info.fileDetailSn }),
    signal: AbortSignal.timeout(60000),
  });
  jar.take(limit);
  if ((await limit.json().catch(() => ({}))).needCaptcha) throw new Error('공공데이터포털이 자동 다운로드를 막았어요 (보안 문자). 직접 받아 --file= 로 넣어 주세요');
  const url = `${SITE}/cmm/cmm/fileDownload.do?${new URLSearchParams({ atchFileId: info.atchFileId, fileDetailSn: info.fileDetailSn, dataNm: info.dataNm })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: SEMAS_PAGE, Cookie: jar.header() }, signal: AbortSignal.timeout(30 * 60000) });
  if (!res.ok || !res.body) throw new Error(`다운로드 HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
}

// ---------- zip 을 한 파일씩 풀며 읽기 (메모리에 다 올리지 않음) ----------

async function zipEntries(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 70000);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('zip 형식이 아니에요');
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const entries = [];
    let p = 0;
    for (let n = 0; n < count; n++) {
      const method = cd.readUInt16LE(p + 10);
      const csize = cd.readUInt32LE(p + 20);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const local = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      p += 46 + nameLen + extraLen + commentLen;
      if (csize === 0xffffffff || local === 0xffffffff) throw new Error('zip64 는 지원하지 않아요');
      const lh = Buffer.alloc(30);
      await fh.read(lh, 0, 30, local);
      const start = local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      entries.push({ name, method, start, csize });
    }
    return entries;
  } finally {
    await fh.close();
  }
}

/** 상가 CSV 하나를 줄 단위로 읽어 술 가게만 */
async function readEntry(file, entry, onShop) {
  const raw = fs.createReadStream(file, { start: entry.start, end: entry.start + entry.csize - 1 });
  const stream = entry.method === 8 ? raw.pipe(zlib.createInflateRaw()) : raw;
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let head = null;
  let rows = 0;
  for await (const line of rl) {
    if (!head) {
      head = parseCsvLine(line.replace(/^﻿/, ''));
      continue;
    }
    if (!line) continue;
    rows++;
    const cells = parseCsvLine(line);
    // 빠르게 거르기: 소매 업종이 아니면 건너뜀
    if (!line.includes('소매')) continue;
    const r = Object.fromEntries(head.map((h, i) => [h, cells[i]]));
    const shop = semasShop(r);
    if (shop) onShop(shop);
  }
  return rows;
}

export async function readSemasZip(file) {
  const shops = new Map();
  let rows = 0;
  for (const e of await zipEntries(file)) {
    if (!/\.csv$/i.test(e.name)) continue;
    rows += await readEntry(file, e, (s) => shops.set(s.id, s));
  }
  return { shops: [...shops.values()].sort((a, b) => a.id.localeCompare(b.id)), rows };
}

// ---------- 저장 ----------

async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(value)}\n`);
  await fsp.rename(tmp, file);
}

/** stores.json 에 shops.json 을 합쳐 다시 쓰기 */
export async function mergeIntoStores(dataDir = DATA_DIR) {
  const storesFile = path.join(dataDir, 'stores.json');
  const stores = await readJson(storesFile);
  const shops = await readJson(path.join(dataDir, 'shops.json'));
  if (!stores?.stores || !shops?.shops) return null;
  const { stores: list, merged } = mergeShops(stores.stores, shops.shops);
  await writeJsonAtomic(storesFile, { ...stores, source: `OpenStreetMap + ${SEMAS_SOURCE}`, shopsBaseDate: shops.baseDate, count: list.length, stores: list });
  return { count: list.length, added: list.filter((s) => s.id.startsWith('sm')).length, merged };
}

async function main() {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const shopsFile = path.join(DATA_DIR, 'shops.json');
  const old = await readJson(shopsFile);
  let file = arg('file');
  let baseDate = arg('date') || null;
  let tmp = null;
  if (!file) {
    log('공공데이터포털 파일 정보 확인 중');
    const info = await semasFileInfo();
    baseDate = info.baseDate;
    if (old?.baseDate === baseDate && !process.argv.includes('--force')) {
      log(`이미 최신이에요 (${baseDate} 기준). stores.json 에 다시 합치기만 해요`);
      const r = await mergeIntoStores();
      if (r) log(`  매장 ${r.count}곳 (상가정보 가게 ${r.added}곳, 지도와 겹친 ${r.merged}곳)`);
      return;
    }
    tmp = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'semas-')), 'semas.zip');
    log(`${info.dataNm}.zip 받는 중 (약 350MB)`);
    await download(info, tmp);
    file = tmp;
  }
  try {
    log('술 가게 고르는 중');
    const { shops, rows } = await readSemasZip(file);
    if (shops.length < 300) throw new Error(`술 가게가 너무 적어요 (${shops.length}곳) — 파일을 바꾸지 않아요`);
    const byLabel = {};
    for (const s of shops) byLabel[s.b] = (byLabel[s.b] || 0) + 1;
    await writeJsonAtomic(shopsFile, {
      version: 1,
      source: SEMAS_SOURCE,
      dataset: `https://www.data.go.kr/data/${SEMAS_DATASET}/fileData.do`,
      license: '이용허락범위 제한 없음',
      baseDate,
      updatedAt: new Date().toISOString(),
      count: shops.length,
      byLabel,
      shops,
    });
    log(`  전국 상가 ${rows.toLocaleString()}곳 중 술 가게 ${shops.length}곳`, byLabel);
    const r = await mergeIntoStores();
    if (r) log(`  stores.json: 매장 ${r.count}곳 (상가정보 가게 ${r.added}곳 더함, 지도와 겹친 ${r.merged}곳은 하나로)`);
  } finally {
    if (tmp) await fsp.rm(path.dirname(tmp), { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[shops] 실패:', err.message);
    process.exit(1);
  });
}
