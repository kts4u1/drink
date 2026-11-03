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

  const leaflet = path.dirname(require.resolve('leaflet/dist/leaflet.js'));
  const vendor = path.join(DIST, 'vendor', 'leaflet');
  await fs.mkdir(vendor, { recursive: true });
  await fs.cp(path.join(leaflet, 'leaflet.js'), path.join(vendor, 'leaflet.js'));
  await fs.cp(path.join(leaflet, 'leaflet.css'), path.join(vendor, 'leaflet.css'));
  await fs.cp(path.join(leaflet, 'images'), path.join(vendor, 'images'), { recursive: true });

  // GitHub Pages 가 밑줄로 시작하는 파일을 숨기지 않도록
  await fs.writeFile(path.join(DIST, '.nojekyll'), '');

  // 데이터가 바뀌면 서비스워커 캐시 이름도 바꿔 새 데이터를 받게
  const prices = JSON.parse(await fs.readFile(path.join(DIST, 'data', 'prices.json'), 'utf8'));
  const stores = JSON.parse(await fs.readFile(path.join(DIST, 'data', 'stores.json'), 'utf8'));
  const stamp = `${prices.inspectDay || ''}-${(stores.updatedAt || '').slice(0, 10)}`.replace(/[^0-9a-z-]/gi, '');
  const swPath = path.join(DIST, 'sw.js');
  const sw = await fs.readFile(swPath, 'utf8');
  await fs.writeFile(swPath, sw.replace(/const CACHE = 'sulsul-v(\d+)';/, `const CACHE = 'sulsul-v$1-${stamp}';`));

  console.log(`dist/ 완료 (참가격 ${prices.inspectDay}, 매장 ${stores.count}곳)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
