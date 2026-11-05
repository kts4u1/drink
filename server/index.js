// 내 PC 에서 앱을 열어 보는 개발용 서버
// - 화면·데이터 파일을 내려주고
// - .env 에 ANTHROPIC_API_KEY 가 있으면 /api/identify (사진으로 술 알아보기) 도 처리합니다.
// 배포는 GitHub Pages(화면) + Cloudflare Worker(사진 인식)로 합니다. README 참고.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { DEFAULT_MODEL, createIdentifier } from './identify/claude.js';
import { createMemoryLimiter, createMemoryStore, handleIdentify, healthBody } from './identify/handler.js';
import { handlePriceGet, handlePriceReport } from './prices/handler.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** zxing-wasm 의 dist 폴더 (package.json 을 내보내지 않아서 reader 진입점에서 거슬러 올라감) */
export function zxingDist() {
  return path.resolve(path.dirname(require.resolve('zxing-wasm/reader')), '..', '..');
}

/** 화면에서 쓰는 라이브러리 파일 (개발 서버는 node_modules 에서 바로, 배포는 build.js 가 dist/vendor 로 복사) */
export function vendorDirs() {
  const pkg = (name) => path.dirname(require.resolve(`${name}/package.json`));
  return [
    ['/vendor/leaflet', path.dirname(require.resolve('leaflet/dist/leaflet.js'))],
    ['/vendor/tesseract', path.join(pkg('tesseract.js'), 'dist')],
    ['/vendor/tesseract-core', pkg('tesseract.js-core')],
    ['/vendor/tessdata', path.join(pkg('@tesseract.js-data/eng'), '4.0.0_best_int')],
    ['/vendor/tessdata', path.join(pkg('@tesseract.js-data/kor'), '4.0.0_best_int')],
    ['/vendor/zxing/es', path.join(zxingDist(), 'es')],
    ['/vendor/zxing', path.join(zxingDist(), 'reader')],
  ];
}

export function loadEnvFile(file = path.join(ROOT, '.env')) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

export function identifierFromEnv(env = process.env) {
  const apiKey = String(env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) return null;
  return createIdentifier({ apiKey, model: env.CLAUDE_MODEL || DEFAULT_MODEL, baseURL: env.ANTHROPIC_BASE_URL || undefined });
}

export function createApp({ identifier = null, dailyLimit = 0, limiter = createMemoryLimiter() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  const store = createMemoryStore();
  const priceStore = createMemoryStore(5000);
  app.get('/api/health', (req, res) => res.json(healthBody({ identifier, dailyLimit, prices: true })));
  // 사용자 가격 제보 (개발 서버는 메모리에만 — 다시 켜면 사라짐)
  app.get(['/api/prices', '/api/prices/:id'], async (req, res) => {
    const { status, body } = await handlePriceGet({ id: req.params.id || '' }, { store: priceStore });
    res.status(status).json(body);
  });
  app.post('/api/prices', express.json({ limit: '4kb' }), async (req, res) => {
    const { status, body } = await handlePriceReport({ body: req.body, ip: req.ip }, { store: priceStore });
    res.status(status).json(body);
  });
  app.post('/api/identify', express.json({ limit: '12mb' }), async (req, res) => {
    const { status, body } = await handleIdentify({ body: req.body, ip: req.ip }, { identifier, store, limiter, dailyLimit, log: console.log });
    res.status(status).json(body);
  });
  app.use('/api', (req, res) => res.status(404).json({ error: '없는 API 입니다.' }));
  // 본문이 너무 크거나 JSON 이 깨졌을 때
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: '사진이 너무 커요.', code: 'image_too_large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '요청 형식이 올바르지 않아요.', code: 'bad_input' });
    console.error(err);
    return res.status(500).json({ error: '서버 오류가 발생했어요.' });
  });

  for (const [route, dir] of vendorDirs()) app.use(route, express.static(dir, { maxAge: '7d' }));
  app.use('/data', express.static(path.join(ROOT, 'data'), { maxAge: 0 }));
  app.use(express.static(path.join(ROOT, 'public'), { maxAge: 0 }));
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnvFile();
  const PORT = Number(process.env.PORT) || 3000;
  const identifier = identifierFromEnv();
  const server = createApp({ identifier, dailyLimit: Number(process.env.DAILY_LIMIT) || 0 }).listen(PORT, () => {
    console.log(`\n  술술 서버가 실행되었습니다: http://localhost:${PORT}`);
    console.log(
      identifier
        ? `  사진으로 술 알아보기: 서버 AI 켜짐 (${identifier.model})\n`
        : '  사진으로 술 알아보기: 기기 안 분석 (무료, 브라우저에서 글자·바코드 인식). 서버 AI 는 README 참고\n',
    );
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') console.error(`\n  포트 ${PORT} 을(를) 이미 쓰고 있어요. PORT=3001 npm start 로 실행해 보세요.\n`);
    else console.error(err);
    process.exit(1);
  });
}
