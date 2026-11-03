// 배포 전에 사진 인식 결과 저장소(Workers KV)를 준비합니다 (GitHub Actions 에서 실행).
// - 'sulsul-cache' 이름의 KV 가 없으면 만들고, 그 id 를 wrangler.jsonc 에 넣습니다.
// - 실패하면 KV 설정을 빼서 배포는 계속되게 합니다 (그때는 Worker 메모리에 잠깐만 보관하고 하루 한도가 정확하지 않음).
// 어디갈까(kts4u1/Tour) 앱의 scripts/ensure-kv.js 와 같은 방식입니다.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'wrangler.jsonc');
const TITLE = 'sulsul-cache';
const PLACEHOLDER = 'SULSUL_KV_ID_PLACEHOLDER';

function wrangler(args) {
  return execFileSync('npx', ['wrangler', ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** wrangler 출력에서 JSON 배열 부분만 꺼냄 (앞뒤에 안내 문구가 붙을 수 있음) */
export function parseNamespaceList(output) {
  const start = output.indexOf('[');
  const end = output.lastIndexOf(']');
  if (start === -1 || end < start) return [];
  try {
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    return [];
  }
}

export function findNamespace(list, title = TITLE) {
  return list.find((n) => n.title === title) || list.find((n) => typeof n.title === 'string' && n.title.endsWith(title));
}

/** KV 설정 부분을 뺀 설정 파일 */
export function withoutKv(config) {
  return config.replace(/\s*\/\/ kv-start[\s\S]*?\/\/ kv-end\n/, '\n');
}

function main() {
  const config = fs.readFileSync(CONFIG, 'utf8');
  if (!config.includes(PLACEHOLDER)) {
    console.log('wrangler.jsonc 에 이미 KV id 가 들어 있습니다.');
    return;
  }
  try {
    let ns = findNamespace(parseNamespaceList(wrangler(['kv', 'namespace', 'list'])));
    if (!ns) {
      console.log(`KV 저장소 "${TITLE}" 를 만듭니다...`);
      const out = wrangler(['kv', 'namespace', 'create', TITLE]);
      ns = findNamespace(parseNamespaceList(wrangler(['kv', 'namespace', 'list'])));
      if (!ns) {
        const id = out.match(/\b[0-9a-f]{32}\b/)?.[0];
        if (id) ns = { id, title: TITLE };
      }
    }
    if (!ns?.id) throw new Error('KV id 를 찾지 못했습니다.');
    fs.writeFileSync(CONFIG, config.replace(PLACEHOLDER, ns.id));
    console.log(`KV 저장소 준비 완료: ${ns.title} (${ns.id})`);
  } catch (err) {
    const detail = err.stderr ? String(err.stderr).slice(0, 500) : err.message;
    console.log(`::warning::결과 저장소(KV)를 준비하지 못해 KV 없이 배포합니다. API 토큰에 "Workers KV Storage: Edit" 권한이 있는지 확인하세요. (${detail})`);
    fs.writeFileSync(CONFIG, withoutKv(config));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
