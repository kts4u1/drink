// GitHub Pages 에 올릴 dist/ 만들기
//   dist/            public/ 의 화면 파일
//   dist/data/       data/stores.json, data/prices.json
//   dist/vendor/     지도 라이브러리(Leaflet)
// 데이터를 새로 받으려면 먼저 npm run data:update
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

async function main() {
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.cp(path.join(ROOT, 'public'), DIST, { recursive: true });

  await fs.mkdir(path.join(DIST, 'data'), { recursive: true });
  for (const file of ['stores.json', 'prices.json']) {
    const src = path.join(ROOT, 'data', file);
    const text = await fs.readFile(src, 'utf8');
    JSON.parse(text); // 깨진 파일이면 여기서 멈춤
    await fs.writeFile(path.join(DIST, 'data', file), text);
  }

  // 라벨 글자 인식(Tesseract.js)·바코드(zxing-wasm) — 기기 안에서 무료로 술 알아보기
  const pkg = (name) => path.dirname(require.resolve(`${name}/package.json`));
  const tess = path.join(DIST, 'vendor', 'tesseract');
  await fs.mkdir(tess, { recursive: true });
  for (const f of ['tesseract.esm.min.js', 'worker.min.js']) await fs.cp(path.join(pkg('tesseract.js'), 'dist', f), path.join(tess, f));
  const core = path.join(DIST, 'vendor', 'tesseract-core');
  await fs.mkdir(core, { recursive: true });
  // LSTM 엔진만 써서 *-lstm 파일만 (기기가 지원하는 것 하나만 받아감)
  for (const f of await fs.readdir(pkg('tesseract.js-core'))) if (/lstm\.wasm\.js$/.test(f)) await fs.cp(path.join(pkg('tesseract.js-core'), f), path.join(core, f));
  const tessdata = path.join(DIST, 'vendor', 'tessdata');
  await fs.mkdir(tessdata, { recursive: true });
  for (const lang of ['eng', 'kor']) await fs.cp(path.join(pkg(`@tesseract.js-data/${lang}`), '4.0.0_best_int', `${lang}.traineddata.gz`), path.join(tessdata, `${lang}.traineddata.gz`));
  const zxingDist = path.resolve(path.dirname(require.resolve('zxing-wasm/reader')), '..', '..');
  const zxingEs = path.join(zxingDist, 'es');
  await fs.mkdir(path.join(DIST, 'vendor', 'zxing', 'es', 'reader'), { recursive: true });
  await fs.cp(path.join(zxingEs, 'share.js'), path.join(DIST, 'vendor', 'zxing', 'es', 'share.js'));
  await fs.cp(path.join(zxingEs, 'reader', 'index.js'), path.join(DIST, 'vendor', 'zxing', 'es', 'reader', 'index.js'));
  await fs.cp(path.join(zxingDist, 'reader', 'zxing_reader.wasm'), path.join(DIST, 'vendor', 'zxing', 'zxing_reader.wasm'));

  const leaflet = path.dirname(require.resolve('leaflet/dist/leaflet.js'));
  const vendor = path.join(DIST, 'vendor', 'leaflet');
  await fs.mkdir(vendor, { recursive: true });
  await fs.cp(path.join(leaflet, 'leaflet.js'), path.join(vendor, 'leaflet.js'));
  await fs.cp(path.join(leaflet, 'leaflet.css'), path.join(vendor, 'leaflet.css'));
  await fs.cp(path.join(leaflet, 'images'), path.join(vendor, 'images'), { recursive: true });

  // 사진 인식 API 주소 (Cloudflare Worker). 비어 있으면 같은 주소의 /api 를 씀 (개발 서버)
  const apiBase = String(process.env.API_BASE || '').trim().replace(/\/+$/, '');
  if (apiBase && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(apiBase)) throw new Error(`API_BASE 형식이 올바르지 않아요: ${apiBase}`);
  // api: false 면 화면이 서버 AI 를 찾지 않고 바로 기기 안 분석을 씀 (GitHub Pages 에는 /api 가 없음)
  await fs.writeFile(path.join(DIST, 'config.json'), `${JSON.stringify({ apiBase, api: Boolean(apiBase) })}\n`);

  // GitHub Pages 가 밑줄로 시작하는 파일을 숨기지 않도록
  await fs.writeFile(path.join(DIST, '.nojekyll'), '');

  // 데이터가 바뀌면 서비스워커 캐시 이름도 바꿔 새 데이터를 받게
  const prices = JSON.parse(await fs.readFile(path.join(DIST, 'data', 'prices.json'), 'utf8'));
  const stores = JSON.parse(await fs.readFile(path.join(DIST, 'data', 'stores.json'), 'utf8'));
  const stamp = `${prices.inspectDay || ''}-${(stores.updatedAt || '').slice(0, 10)}`.replace(/[^0-9a-z-]/gi, '');
  const swPath = path.join(DIST, 'sw.js');
  const sw = await fs.readFile(swPath, 'utf8');
  await fs.writeFile(swPath, sw.replace(/const CACHE = 'sulsul-v(\d+)';/, `const CACHE = 'sulsul-v$1-${stamp}';`));

  console.log(`dist/ 완료 (참가격 ${prices.inspectDay}, 매장 ${stores.count}곳, 사진 인식 API: ${apiBase || '없음'})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
