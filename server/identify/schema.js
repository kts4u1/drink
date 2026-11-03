// 사진·이름으로 술을 알아볼 때 Claude 가 돌려주는 JSON 형식 (구조화된 출력)
// 숫자 범위(1~5 등)는 구조화된 출력 스키마가 지원하지 않아서, 받은 뒤 normalizeResult 에서 맞춥니다.

/** 백과의 술 종류 id (public/js/content 와 같게) + 그 밖 */
export const CATEGORY_IDS = [
  'wine', 'whisky', 'beer', 'soju', 'traditional', 'sake', 'brandy',
  'vodka', 'gin', 'rum', 'tequila', 'liqueur', 'baijiu', 'cocktail', 'other',
];

const str = (description) => ({ type: 'string', description });
const obj = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const RESULT_SCHEMA = obj({
  is_alcohol: { type: 'boolean', description: '사진(또는 이름)이 술인지' },
  not_alcohol_reason: str('술이 아니거나 알아볼 수 없을 때 이유와 다시 찍는 요령. 술이면 빈 문자열'),
  confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: '제품을 정확히 알아봤는지' },
  confidence_note: str('무엇을 보고 판단했는지, 확실하지 않은 부분'),
  label_text: str('라벨에서 읽은 주요 글자 (이름 입력이면 빈 문자열)'),
  name_ko: str('한국어 제품명 (국내 수입명이 있으면 그것)'),
  name_original: str('원래 표기 제품명'),
  producer: str('생산자·브랜드·증류소·와이너리'),
  category: { type: 'string', enum: CATEGORY_IDS },
  style: str('세부 종류. 예: 싱글 몰트 스카치 · 스페이사이드 / 레드 · 카베르네 소비뇽 / 준마이 다이긴조'),
  country: str('나라'),
  region: str('지역 (모르면 빈 문자열)'),
  ingredients: str('포도 품종·원료 (모르면 빈 문자열)'),
  age_or_vintage: str('숙성 연수·빈티지·등급(VSOP 등). 라벨에서 확인 안 되면 그렇게 적기'),
  abv: str('알코올 도수. 예: 40% (모르면 빈 문자열)'),
  volume: str('용량. 예: 700ml (모르면 빈 문자열)'),
  summary: str('한두 문장 소개'),
  description: str('생산자·역사·스타일·특징을 3~6문장으로 쉽게'),
  tasting: obj({
    nose: str('향'),
    palate: str('맛'),
    finish: str('여운'),
  }),
  sweetness: { type: 'integer', description: '단맛 1(드라이)~5(아주 달콤)' },
  body: { type: 'integer', description: '무게감 1(가벼움)~5(아주 진함)' },
  how_to_drink: obj({
    temperature: str('알맞은 온도'),
    glass: str('알맞은 잔'),
    methods: { type: 'array', items: { type: 'string' }, description: '마시는 방법 2~4개 (스트레이트, 하이볼 비율 등)' },
    tips: str('맛있게 마시는 팁'),
  }),
  food_pairing: { type: 'array', items: { type: 'string' }, description: '어울리는 음식 3~5개 (한식 하나 이상)' },
  price: obj({
    krw_low: { type: 'integer', description: '국내 일반 판매가 추정 최저(원). 모르면 0' },
    krw_high: { type: 'integer', description: '국내 일반 판매가 추정 최고(원). 모르면 0' },
    basis: str('어떤 기준의 추정인지 (용량, 판매처, 시기)'),
    note: str('가격에 대한 참고 (행사·면세점·해외와 차이 등)'),
  }),
  where_to_buy: str('국내에서 이 술을 사기 좋은 곳과 이유'),
  similar: {
    type: 'array',
    description: '비슷한 술 2~3개 (더 싼 대안 하나 포함)',
    items: obj({ name: str('제품명'), why: str('비슷한 점·차이') }),
  },
  storage: str('보관법, 개봉 후'),
  fun_fact: str('재미있는 이야기 한 가지'),
  search_query: str('네이버에서 가격을 검색할 때 쓸 검색어 (한국어 제품명 + 용량)'),
});
