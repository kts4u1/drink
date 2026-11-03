// data/stores.json, data/prices.json 불러오기 (한 번만 받고 재사용)

const cache = new Map();

async function getJson(path) {
  let res;
  try {
    res = await fetch(path, { headers: { Accept: 'application/json' } });
  } catch {
    throw new Error('데이터를 받지 못했어요. 인터넷 연결을 확인해 주세요.');
  }
  if (!res.ok) throw new Error(`데이터를 받지 못했어요 (${res.status})`);
  return res.json();
}

function once(path) {
  if (!cache.has(path)) {
    const p = getJson(path).catch((err) => {
      cache.delete(path);
      throw err;
    });
    cache.set(path, p);
  }
  return cache.get(path);
}

/** { stores: [...], updatedAt, ... } */
export const loadStores = () => once('data/stores.json');

/** { products, stores, prices, brands, inspectDay, ... } */
export const loadPrices = () => once('data/prices.json');
