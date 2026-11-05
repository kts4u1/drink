// 백과 콘텐츠 모음
import wine from './categories/wine.js';
import whisky from './categories/whisky.js';
import beer from './categories/beer.js';
import { brandy, gin, rum, tequila, vodka } from './categories/spirits.js';
import { cocktail, liqueur } from './categories/liqueur.js';
import { baijiu, sake, soju, traditional } from './categories/asian.js';

export { GLOSSARY } from './glossary.js';
export { GUIDES } from './guides.js';
export { PRODUCTS, TAG_LABELS } from './products.js';
export { BUY_BY_CATEGORY, CHANNELS, SHOP_TYPES, STORE_KINDS, STORE_KIND_ORDER } from './channels.js';

/** 화면에 보여 줄 순서 */
export const CATEGORIES = [wine, whisky, beer, soju, traditional, sake, brandy, vodka, gin, rum, tequila, liqueur, baijiu, cocktail];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

export const GROUPS = {
  ferment: { name: '양조주', desc: '발효만으로 만든 술' },
  distill: { name: '증류주', desc: '끓여서 알코올을 모은 술' },
  mixed: { name: '혼성주·칵테일', desc: '향과 단맛을 더하거나 섞은 술' },
};
