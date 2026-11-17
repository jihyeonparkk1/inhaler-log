# 흡입기 기록 (PWA)

흡입기를 쓸 때마다 버튼 한 번으로 **시각·GPS 위치·날씨·미세먼지**를 함께 저장하고,
월·분기·연 평균, 시간대, 계절, 날씨·미세먼지별 사용 패턴을 분석하는 휴대폰 웹앱이에요.
아이폰·안드로이드 모두 브라우저에서 열고 "홈 화면에 추가"하면 앱처럼 쓸 수 있어요.

## 저장되는 것
- 기록마다: 시각, 흡입 횟수, 상황 태그(운동·밤에 깸 등), 메모, 위치(좌표·지명)
- 그 순간 날씨: 기온·체감온도·습도·강수·눈·날씨 상태·풍속·기압
- 그 순간 대기질: PM10·PM2.5(환경부 등급)·황사(dust)·오존·이산화질소·AQI, 꽃가루(유럽만)
- 오프라인이거나 시간을 직접 넣은 기록은 인터넷이 연결되면 **그 시각 날씨**를 찾아 채워요.
- 분석용 하루 날씨(그날 위치 기준)는 자동으로 받아서 이 기기에 캐시해요.

기록은 **이 휴대폰 안(IndexedDB)에만** 저장되고 서버로 보내지 않아요.
설정 → 백업에서 JSON 파일로 내보내고 다시 불러올 수 있어요.

## 외부 서비스 (키 필요 없음)
| 용도 | 서비스 |
|---|---|
| 날씨 (현재·과거) | Open-Meteo Forecast / Archive API |
| 대기질 | Open-Meteo Air Quality API (CAMS 모델 추정치) |
| 도시 검색 | Open-Meteo Geocoding, 한글은 OpenStreetMap Nominatim |
| 좌표→지명 | BigDataCloud reverse-geocode-client |

좌표만 보내고 다른 정보는 보내지 않아요.

## 파일
- `index.html`, `style.css`, `app.js` — 화면
- `analysis.js` — 평균·계절·날씨 비교 계산 (순수 함수)
- `weather.js` — 날씨 API 호출
- `store.js` — IndexedDB 저장
- `sw.js`, `manifest.webmanifest`, `icons/` — 오프라인 실행·홈 화면 앱
- `tools/` — 개발용 (서버, 테스트, 아이콘 생성). 배포에 필요 없음

## 개발
```bash
node tools/serve.mjs 5180      # http://localhost:5180
node tools/test-analysis.mjs   # 계산 테스트
node tools/make-icons.mjs      # 아이콘 다시 만들기
```

## 배포
GPS와 홈 화면 앱(서비스 워커)은 **HTTPS**에서만 동작해요. 빌드가 필요 없는 정적 파일이라
GitHub Pages나 Cloudflare Pages에 폴더를 그대로 올리면 돼요. 코드를 바꿀 때는 `sw.js`의 `CACHE` 버전도 올려 주세요.
