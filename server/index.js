// 내 PC 에서 앱을 열어 보는 개발용 서버 (정적 파일만 내려줌)
// 배포는 GitHub Pages 로 합니다 (npm run build → dist/). README 참고.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import express from 'express';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  const leafletDist = path.dirname(require.resolve('leaflet/dist/leaflet.js'));
  app.use('/vendor/leaflet', express.static(leafletDist, { maxAge: '7d' }));
  app.use('/data', express.static(path.join(ROOT, 'data'), { maxAge: 0 }));
  app.use(express.static(path.join(ROOT, 'public'), { maxAge: 0 }));
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createApp().listen(PORT, () => {
    console.log(`\n  술술 서버가 실행되었습니다: http://localhost:${PORT}\n`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') console.error(`\n  포트 ${PORT} 을(를) 이미 쓰고 있어요. PORT=3001 npm start 로 실행해 보세요.\n`);
    else console.error(err);
    process.exit(1);
  });
}
