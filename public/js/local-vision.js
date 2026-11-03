// 기기 안에서 무료로 술 알아보기 (서버·유료 API 없음)
//   1) 바코드: 브라우저 BarcodeDetector → 없으면 zxing-wasm → Open Food Facts(무료 공개 제품 DB)에서 제품 찾기
//   2) 라벨 글자: Tesseract.js (영어+한국어) 로 글자 읽기
//   3) lib/label.js 로 브랜드 사전·백과와 맞춰 설명 만들기
// 글자 인식 파일(약 9MB)은 이 사이트(vendor/)에서 처음 한 번만 받고 브라우저에 저장돼요.
import { BRANDS } from './content/brands.js';
import { BUY_BY_CATEGORY, CATEGORY_BY_ID, PRODUCTS } from './content/index.js';
import { analyzeLabel } from './lib/label.js';

const abs = (path) => new URL(path, document.baseURI).href;
export const OCR_DOWNLOAD_MB = 9;

let tesseract = null; // Promise<worker>
let zxing = null; // Promise<module>

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('사진을 열지 못했어요.'));
    img.src = dataUrl;
  });
}

function canvasOf(img, maxEdge = 1600) {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// ---------- 바코드 ----------

/** EAN-13 / EAN-8 / UPC-A 체크 숫자 확인 */
export function validBarcode(code) {
  if (!/^(\d{8}|\d{12}|\d{13})$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

async function detectNative(canvas) {
  if (!('BarcodeDetector' in globalThis)) return null;
  try {
    const supported = await globalThis.BarcodeDetector.getSupportedFormats();
    const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter((f) => supported.includes(f));
    if (!formats.length) return null;
    const found = await new globalThis.BarcodeDetector({ formats }).detect(canvas);
    return found.map((f) => f.rawValue);
  } catch {
    return null;
  }
}

async function detectZxing(canvas) {
  zxing ||= import('../vendor/zxing/es/reader/index.js').then((mod) => {
    mod.prepareZXingModule({
      overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? abs('vendor/zxing/zxing_reader.wasm') : prefix + path) },
    });
    return mod;
  });
  try {
    const mod = await zxing;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const results = await mod.readBarcodes(imageData, { formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE'], tryHarder: true, maxNumberOfSymbols: 2 });
    return results.filter((r) => r.isValid !== false).map((r) => r.text);
  } catch {
    zxing = null;
    return [];
  }
}

export async function readBarcode(canvas) {
  const native = await detectNative(canvas);
  const codes = native && native.length ? native : await detectZxing(canvas);
  return codes.find(validBarcode) || null;
}

/** Open Food Facts 에서 바코드로 제품 찾기 (무료, 키 없음) */
export async function lookupBarcode(code) {
  try {
    const fields = 'product_name,product_name_ko,product_name_en,brands,quantity,categories_tags,countries_tags';
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${fields}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const body = await res.json();
    if (body.status !== 1 || !body.product) return null;
    const p = body.product;
    // 술이 아닌 제품이면 버림
    const tags = (p.categories_tags || []).join(' ');
    if (tags && !/alcoholic|wine|beer|spirit|liquor|whisk|vodka|gin|rum|tequila|cognac|brand|liqueur|sake|soju|cider|champagne/.test(tags)) return null;
    return p;
  } catch {
    return null;
  }
}

// ---------- 글자 인식 ----------

async function getTesseract(onProgress) {
  tesseract ||= (async () => {
    const mod = await import('../vendor/tesseract/tesseract.esm.min.js');
    const createWorker = mod.createWorker || mod.default?.createWorker;
    return createWorker(['eng', 'kor'], 1, {
      workerPath: abs('vendor/tesseract/worker.min.js'),
      corePath: abs('vendor/tesseract-core/'),
      langPath: abs('vendor/tessdata'),
      workerBlobURL: false,
      logger: (m) => onProgressRef?.(m),
    });
  })().catch((err) => {
    tesseract = null;
    throw err;
  });
  onProgressRef = onProgress;
  return tesseract;
}
let onProgressRef = null;

export async function readText(canvas, onProgress) {
  const worker = await getTesseract(onProgress);
  onProgressRef = onProgress;
  const { data } = await worker.recognize(canvas);
  return data.text || '';
}

// ---------- 전체 ----------

/**
 * images: dataURL 배열 (최대 3장)
 * onStep(step, detail): 'barcode' | 'ocr-load' | 'ocr' | 'match'
 */
export async function analyzeLocally(images, onStep = () => {}) {
  const canvases = [];
  for (const url of images) canvases.push(canvasOf(await loadImage(url)));

  onStep('barcode');
  let barcode = null;
  let off = null;
  for (const c of canvases) {
    barcode = await readBarcode(c);
    if (barcode) break;
  }
  if (barcode) off = await lookupBarcode(barcode);

  let text = '';
  // 바코드로 제품과 브랜드를 다 알았어도 숙성 연수·빈티지를 위해 글자도 읽음
  for (let i = 0; i < canvases.length; i++) {
    onStep('ocr', { index: i, total: canvases.length });
    try {
      text += `\n${await readText(canvases[i], (m) => {
        if (m.status && /load|init/i.test(m.status)) onStep('ocr-load', { progress: m.progress || 0 });
        else if (m.status === 'recognizing text') onStep('ocr', { index: i, total: canvases.length, progress: m.progress || 0 });
      })}`;
    } catch (err) {
      if (!off) throw new Error(`글자 인식을 불러오지 못했어요. 인터넷 연결을 확인해 주세요. (${err.message || err})`);
    }
  }

  onStep('match');
  return analyzeLabel(
    { text, off, barcode, source: 'photo' },
    { brands: BRANDS, products: PRODUCTS, categories: CATEGORY_BY_ID, buy: BUY_BY_CATEGORY },
  );
}

/** 이름으로 찾기 (글자 인식 없이 브랜드 사전·백과에서) */
export function analyzeName(text) {
  return analyzeLabel({ text, source: 'text' }, { brands: BRANDS, products: PRODUCTS, categories: CATEGORY_BY_ID, buy: BUY_BY_CATEGORY });
}
