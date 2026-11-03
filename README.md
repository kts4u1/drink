# 술술 · 술 백과와 내 주변 최저가

와인·위스키·맥주·막걸리처럼 **일반인이 잘 모르는 술을 쉽게 설명**하고,
**내 근처 어디에서 싸게 살 수 있는지**, **특정 술은 어디로 가야 파는지**를 알려주는 웹앱입니다.
**술병 사진을 찍으면 AI(Claude)가 어떤 술인지 알아보고** 이름·종류·맛·마시는 법·가격까지 설명해 줍니다.
휴대폰에서 홈 화면에 추가해 앱처럼 쓸 수 있습니다(PWA). 위치 지정 화면은 [어디갈까](https://github.com/kts4u1/Tour) 앱의 것을 그대로 가져왔습니다.

| 술 백과 | 종류별 설명 | 제품 상세 | 내 주변 | 최저가 |
| --- | --- | --- | --- | --- |
| ![술 백과](docs/screenshots/guide.png) | ![위스키 설명](docs/screenshots/article.png) | ![제품 상세](docs/screenshots/product.png) | ![내 주변](docs/screenshots/nearby.png) | ![최저가](docs/screenshots/prices.png) |

술 백과·내 주변·최저가는 **API 키 없이** GitHub Pages 로 무료 배포됩니다.
사진으로 알아보기만 Anthropic API 키(유료)와 Cloudflare Worker(무료)가 필요합니다 → [사진으로 술 알아보기 켜기](#사진으로-술-알아보기-켜기)

## 주요 기능

### 📷 사진으로 술 알아보기 (AI)
- **사진 찍기 / 앨범에서 고르기** (최대 3장: 앞 라벨 + 뒷면 한글 수입사 스티커를 같이 찍으면 더 정확)
- 와인·위스키·코냑·사케·전통주 등 **라벨이 보이는 술이면 무엇이든**: 앱에 넣어 둔 제품 목록과 상관없이 AI 가 알아봅니다
- 결과: 한국어/원어 이름, 생산자, 종류·세부 스타일, 나라·지역, 숙성 연수·빈티지, 도수·용량, 소개,
  **향·맛·여운**, 단맛·진하기, **마시는 온도·잔·방법**(하이볼 비율 등), 어울리는 음식(한식 포함),
  **AI 추정 국내 판매가**와 그 기준, 어디서 사면 좋은지 + **내 주변 가장 가까운 매장**, 비슷한 술(누르면 바로 알아보기), 보관법, 재미있는 이야기
- **AI 판단 정도**(정확히 / 대체로 / 짐작)와 라벨에서 읽은 글자를 함께 보여 줘서 틀렸는지 확인할 수 있음
- 앱 목록에 같은 제품이 있으면 연결, 소주·맥주·막걸리는 참가격 실제 판매가도 함께
- **이름으로 AI 에게 묻기**: 검색창에 "샤또 마고 2015"처럼 적고 "AI에게 물어보기" (백과·술 찾기 어디서나)
- **최근 알아본 술** 20개를 이 기기에 저장 (사진은 작은 미리보기만)
- 술이 아니거나 흐린 사진이면 다시 찍는 요령을 알려 줌

### 술 백과
- 14가지 술: 와인, 위스키, 맥주, 소주, 전통주, 사케, 브랜디·코냑, 보드카, 진, 럼, 데킬라, 리큐르, 중국술, 하이볼·칵테일
- 술마다: 어떻게 만드는지, 종류, (와인) 포도 품종·나라별 특징, (위스키) 스카치 지역·오크통, 맛 표현,
  맛있게 마시는 온도·잔, 한식과 어울리는 음식, 라벨 읽는 법, 가격대 가이드, 처음이라면 무엇부터, 보관, 자주 묻는 질문
- 그 술을 **어디서 사면 좋은지**(창고형 마트·전문점·대형마트·앱 스마트오더·면세점 …)와 **내 주변 가장 가까운 곳**
- **취향 찾기**: 질문 4개(맛·도수·마시는 법·예산)로 제품 추천
- **용어 사전** 89개 (탄닌, 피트, 캐스크 스트렝스, 정미율, 생막걸리 …), **술의 기초**, **싸게 사는 법**(구매처·시기·면세 한도·스마트오더)
- 술 이름·별명·영어·용어 통합 검색 (예: "맥켈란"처럼 흔히 틀리는 표기도 찾음)

### 술 찾기
- 대표 제품 78개: 이름으로 찾거나 종류·가격순으로 보기
- 제품 상세: 도수·용량·**참고 가격대**, 단맛·진하기, 맛 설명, 마시는 법, 어울리는 음식
- **어디서 사면 좋을까**: 그 술에 맞는 구매처 순서와 이유, 구매처마다 **내 주변 가장 가까운 매장 2곳**
- 소주·맥주·막걸리는 **실제 판매 가격**(참가격)으로 "가장 싼 곳 1,240원 · 이마트 신촌점 1.2km"처럼 표시
- 목록에 없는 술은 네이버 가격 검색, 카카오맵·네이버지도의 "근처 보틀샵" 검색으로 연결

### 내 주변
- 현재 위치(GPS) 또는 도시 선택, 지도에서 직접 고른 위치 기준
- 반경 **1 / 3 / 5 / 10 / 20km**, 종류: 주류 전문점 · 창고형 마트 · 대형마트 · 동네 슈퍼(SSM) · 백화점 · 양조장
- 정렬: 가까운 순 · 싸게 사기 좋은 순 · 종류 많은 순, 목록 / 지도 보기
- 매장 상세: 길찾기(카카오맵), 카카오맵·네이버지도, 전화, 영업시간, 참가격 조사 매장이면 그 매장의 소주·맥주·막걸리 가격
- OpenStreetMap 에 없는 동네 와인샵을 위해 "**마포구 동교동 와인샵**"처럼 동네 이름을 붙인 카카오맵·네이버지도 검색 링크

### 최저가 (소주·맥주·막걸리)
- 한국소비자원 **참가격**이 매주 금요일 조사한 전국 약 400개 대형마트·SSM·백화점의 실제 가격
- 참이슬·처음처럼·카스·테라·하이트·장수/국순당 막걸리 등: 내 주변 싼 순 / 가까운 순, 주변 보통 가격 대비 얼마나 싼지, 할인·1+1 표시
- **편의점 본사 가격**(GS25·CU·세븐일레븐·이마트24 전국 공통)과 비교: "편의점보다 660원 ↓"
- 반경 안에 조사 매장이 없으면 가장 가까운 곳을 자동으로 보여 줌

## 데이터는 어디서 오나요

| 데이터 | 출처 | 갱신 |
| --- | --- | --- |
| 술 설명·제품·용어·구매처 가이드 | 직접 작성 (`public/js/content/`) | 직접 고침 |
| 소주·맥주·막걸리 실제 가격 | 한국소비자원 참가격 — [세일레이더](https://github.com/kts4u1/Sale-and-Discount) 앱이 매일 받아 GitHub Pages 에 올리는 스냅샷에서 술만 골라냄 | 매일 (조사는 매주 금요일) |
| 술 살 수 있는 곳 위치 | [OpenStreetMap](https://www.openstreetmap.org) (전국 마트·백화점·주류 전문점·양조장 약 2,100곳) + 참가격 조사 매장 | 매일 |
| 사진·이름으로 술 알아보기 | Anthropic Claude API (Cloudflare Worker 를 거쳐 호출, 키는 Worker 에만) | 요청할 때 |
| 동네 이름 | OpenStreetMap Nominatim (위치가 바뀔 때만 한 번, 이 기기에 저장) | - |
| 지도 | Leaflet + OpenStreetMap 타일 | - |

### 왜 카카오 로컬 API 를 쓰지 않았나요?

카카오 디벨로퍼스 [운영정책](https://developers.kakao.com/terms/latest/ko/site-policies) 제4조가 **"담배/주류 관련 서비스"를 금지**하고,
주류는 서비스 안에 **본인확인 기관을 통한 성인인증**을 넣고 카카오의 별도 검토를 받아야만 예외로 허용합니다
(카카오 로그인은 성인인증 수단으로 인정되지 않음). 위반하면 API 가 차단되고 **같은 계정에 연결된 다른 앱까지 막힐 수 있습니다.**
어디갈까·한끼 최저가·세일레이더가 쓰는 카카오 키를 지키기 위해, 매장 위치는 OpenStreetMap 으로 가져오고
카카오맵·네이버지도는 API 가 아닌 일반 웹 링크(검색·길찾기)로만 연결했습니다.

## 빠른 시작

Node.js 20.12 이상이 필요합니다.

```bash
npm install
```

```bash
npm start
```

브라우저에서 http://localhost:3000 을 엽니다. 저장소에 데이터 파일(`data/`)이 들어 있어서 바로 동작합니다.

데이터를 최신으로 받으려면 (2~3분, 인터넷 필요):

```bash
npm run data:update
```

받다가 실패하면 기존 파일을 그대로 둡니다. `-- --only=prices` 또는 `-- --only=stores` 로 하나만 받을 수 있습니다.

## GitHub Pages 에 배포하기

1. 저장소 **Settings › Pages › Build and deployment › Source** 를 **GitHub Actions** 로 바꿉니다.
2. **Actions › GitHub Pages 배포 › Run workflow** (또는 기본 브랜치에 push).
3. 끝나면 `https://kts4u1.github.io/drink/` 에서 열립니다.

그 뒤로는 **매일 새벽 6시 23분(한국 시간)** 에 최신 가격·매장 데이터로 자동 재배포됩니다. Secrets 는 필요 없습니다.
데이터 받기가 실패하면 저장소에 들어 있는 데이터로 배포합니다.

내 PC 에서 배포본 그대로 만들어 보기: `npm run build` → `dist/` 폴더.

## 사진으로 술 알아보기 켜기

화면(GitHub Pages)은 정적 파일이라 API 키를 숨길 수 없어서, **Claude API 는 Cloudflare Worker 가 대신 부릅니다.**
키는 GitHub Secrets → Worker 시크릿으로만 옮겨지고 화면·휴대폰에는 가지 않습니다. 어디갈까 앱과 같은 방식입니다.

```
휴대폰 ── 사진 ──▶ Cloudflare Worker (sulsul-api) ── 키 ──▶ Claude API
  ▲   GitHub Pages 화면      CORS·분당 제한·하루 한도·결과 저장(KV)
  └──────────── 결과 JSON ◀──────────────────────────────┘
```

### 1. Anthropic API 키 만들기
1. [Claude Platform 콘솔](https://platform.claude.com) 가입 → **결제 수단 등록·크레딧 충전**
2. **API Keys › Create Key** → 키 복사 (한 번만 보여 줌)
3. **꼭 하세요: Limits(사용 한도)에서 월 사용 한도를 정해 두세요** (예: 월 10~20달러). 앱의 하루 한도와 함께 비용 사고를 막아 줍니다.

### 2. Cloudflare 정보 (어디갈까 앱에 넣은 것과 같은 값)
- **계정 ID**: Cloudflare 대시보드 › Workers 및 Pages 오른쪽의 계정 ID
- **API 토큰**: 내 프로필 › API 토큰 › 토큰 생성 › **Cloudflare Workers 편집** 템플릿 (Workers KV 편집 권한 포함)

### 3. GitHub Secrets 에 넣기
저장소 **Settings › Secrets and variables › Actions › New repository secret**

| Name | 값 |
| --- | --- |
| `ANTHROPIC_API_KEY` | 1번의 Anthropic API 키 |
| `CLOUDFLARE_API_TOKEN` | 2번의 API 토큰 |
| `CLOUDFLARE_ACCOUNT_ID` | 2번의 계정 ID |

### 4. 배포
**Actions › GitHub Pages 배포 › Run workflow**. 워크플로가 Worker(`sulsul-api`)를 배포하고, 그 주소를 화면의 `config.json` 에 넣어
GitHub Pages 를 다시 배포합니다. 술 찾기 탭 맨 위에 "사진은 분석에만 쓰고 저장하지 않아요"가 보이면 켜진 것입니다.

처음 Workers 를 쓰는 계정이면 Cloudflare 대시보드에서 workers.dev 서브도메인을 먼저 정하라고 나올 수 있습니다.
Worker 주소를 직접 정하고 싶으면 저장소 **Settings › Secrets and variables › Actions › Variables** 에 `API_BASE`(예: `https://sulsul-api.내이름.workers.dev`)를 넣으세요.

### 비용과 보호 장치
- 기본 모델은 **Claude Opus 5.5**(입력 100만 토큰당 4달러, 출력 20달러)입니다. 사진 1장 분석에 대략 **입력 3~4천, 출력 2~4천 토큰**이라
  **한 번에 약 0.07~0.1달러(100~140원)** 정도로 예상됩니다(사진 장 수·설명 길이에 따라 다름). 실제 사용량은 콘솔의 Usage 에서 확인하세요.
- 비용을 줄이려면 `wrangler.jsonc` 의 `CLAUDE_MODEL` 을 `claude-sonnet-5-5`(약 절반 가격)로 바꾸고 다시 배포하세요.
- **하루 한도** `DAILY_LIMIT`(기본 100번, 한국 시간 기준) — 넘으면 "오늘 사용량을 모두 썼어요"
- **IP 마다 1분에 6번**까지 (Cloudflare Rate Limiting)
- **같은 사진·같은 이름은 7일 동안 저장된 결과**를 다시 써서 비용이 들지 않음 (술이 아니라고 나온 결과는 저장 안 함)
- **허용한 주소의 화면만** API 를 부를 수 있음 (`ALLOWED_ORIGINS`, 기본 `https://kts4u1.github.io`)
- 사진은 한 장 최대 4MB, 화면에서 1600px 로 줄여 보내고, Worker 는 사진을 저장하지 않습니다.
- 안전 분류기가 잘못 거절하면 Anthropic 이 권장하는 다른 모델로 한 번 더 시도합니다(`fallbacks: "default"`).

### 내 PC 에서 시험하기
`.env.example` 을 `.env` 로 복사하고 `ANTHROPIC_API_KEY` 를 넣은 뒤 `npm start`. 터미널에 "사진으로 술 알아보기: 켜짐"이 나오면 됩니다.

## 휴대폰에서 사용하기

- **현재 위치(GPS)는 https 주소에서만** 동작합니다(localhost 는 예외). GitHub Pages 주소는 https 라 그대로 됩니다.
- 처음 열면 **만 19세 이상인지** 묻고, 그다음 위치 안내 화면이 나옵니다. 위치 권한을 거부해도 도시를 골라 쓸 수 있습니다.
- 위쪽 📷 버튼을 누르면 어느 화면에서든 바로 카메라가 열립니다.
- 휴대폰 브라우저 메뉴의 **홈 화면에 추가**로 앱처럼 설치됩니다.

## 내용 고치기

| 고칠 것 | 파일 |
| --- | --- |
| 술 종류별 설명 | `public/js/content/categories/*.js` |
| 제품 (참고 가격·도수·맛) | `public/js/content/products.js` |
| 용어 사전 | `public/js/content/glossary.js` |
| 구매처 설명, 술 종류별 추천 구매처 | `public/js/content/channels.js` |
| 술의 기초, 싸게 사는 법 | `public/js/content/guides.js` |

`npm test` 가 빠진 연결(없는 술 종류, 잘못된 구매처 이름, 참가격과 안 맞는 제품 등)을 찾아 줍니다.

## 폴더 구조

```
public/
  index.html, styles.css, sw.js, manifest.webmanifest, icons/
  js/app.js            시작점 · 탭 · 나이 확인
  js/view-guide.js     술 백과 (첫 화면 · 종류별 글 · 용어 사전 · 취향 찾기)
  js/view-find.js      술 찾기
  js/view-nearby.js    내 주변
  js/view-prices.js    최저가
  js/sheets.js         제품·매장 상세
  js/snap.js           사진으로 술 알아보기 (사진 줄이기 · 분석 · 결과 · 최근 기록)
  js/location.js       현재 위치 · 도시 선택 · 위치 권한 안내 (어디갈까 앱에서 가져옴)
  js/map.js            지도 (Leaflet)
  js/place.js          동네 이름 · 카카오맵/네이버지도 링크
  js/lib/              검색 · 거리 · 가격 비교 · 취향 추천 · AI 결과 다듬기 (테스트도 이 파일로)
  js/content/          술 백과 콘텐츠
scripts/
  update-data.js       데이터 받기 (참가격 + OpenStreetMap)
  lib/osm.js           OpenStreetMap 매장 분류
  lib/kca.js           참가격에서 술 고르기
  build.js             GitHub Pages 용 dist/ 만들기
data/                  stores.json (매장), prices.json (참가격 술 가격)
server/index.js        개발용 서버 (.env 에 키가 있으면 /api/identify 도)
server/identify/       사진 인식: Claude 호출(claude.js) · JSON 형식(schema.js) · 지시문(prompt.js) · 검사·캐시·한도(handler.js)
worker/index.js        Cloudflare Worker (사진 인식 API)
wrangler.jsonc         Worker 설정 (모델, 하루 한도, 허용 주소)
scripts/ensure-kv.js   Worker 결과 저장소(KV) 만들기
test/                  자동 테스트
```

## 테스트

```bash
npm test
```

OpenStreetMap 매장 분류("케이마트", "이마트24" 같은 이름에 속지 않는지), 참가격 술 상품 고르기("박카스맛 젤리"·"폰테라 버터" 같은 상품 제외),
가짜 스냅샷 서버로 데이터 받기 전체 흐름, 반경 검색·가격 비교·검색·취향 추천, 콘텐츠 연결, 데이터 파일 형식,
그리고 **가짜 Claude API 서버로 사진 인식 전체 흐름**(요청 모양·JSON 스키마·저장된 결과·하루 한도·분당 제한·거절·키 오류·Worker 의 CORS)을 검사합니다.

## 알아둘 점

- **사진 인식은 AI 판단이라 틀릴 수 있습니다.** 특히 빈티지·숙성 연수·한정판처럼 라벨의 작은 글자는 놓칠 수 있어,
  결과에 판단 정도와 라벨에서 읽은 글자를 함께 보여 줍니다. **AI 추정가는 실제 가격이 아니니** 네이버 가격 검색으로 확인하세요.
- 실제 Anthropic API 키로는 아직 시험하지 못했습니다(가짜 서버로 전체 흐름만 확인). 키를 넣은 뒤 사진 몇 장으로 결과를 한 번 확인해 주세요.

- **참고 가격대는 직접 넣은 대략적인 값**입니다(2025~2026년 국내 마트·전문점 기준). 매장·행사·환율·수입사마다 크게 다르니,
  틀린 값이 보이면 `products.js` 에서 고쳐 주세요. 와인·위스키는 공공 가격 자료가 없어 실제 매장 가격 비교는 소주·맥주·막걸리만 됩니다.
- 참가격은 **매주 금요일 조사한 가격**이라 오늘 매장 가격과 다를 수 있고, 전국 약 400개 매장만 조사합니다(편의점은 본사 가격).
- 참가격 자료는 세일레이더 앱의 공개 스냅샷에 기대고 있습니다. 세일레이더의 자료 형식이 바뀌면 받기를 멈추고 기존 파일을 지킵니다(`version` 확인).
- OpenStreetMap 은 대형 매장은 잘 들어 있지만 **동네 와인샵·보틀샵은 빠진 곳이 많습니다.** 그래서 지도 앱 검색 링크를 함께 보여 줍니다.
- 나이 확인은 "만 19세 이상인가요?"를 묻는 확인 창이며 본인인증은 아닙니다. 이 앱은 술을 팔지 않고 정보만 보여 줍니다.
- 지도 타일과 Nominatim 은 OpenStreetMap 공용 서버입니다. 사용자가 많아지면 [타일 정책](https://operations.osmfoundation.org/policies/tiles/)·[Nominatim 정책](https://operations.osmfoundation.org/policies/nominatim/)에 맞춰 다른 서비스로 바꾸는 것이 좋습니다.

## 다음에 해 볼 만한 것

- 마셔 본 술 기록·별점, 찜 목록
- 제품 사진 (저작권 문제 없는 이미지로)
- 와인·위스키 가격을 사용자가 제보하는 기능
- 앱스토어 출시: [Capacitor](https://capacitorjs.com) 로 웹앱 감싸기
