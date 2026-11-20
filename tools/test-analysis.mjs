// 분석 계산 검증: node tools/test-analysis.mjs
import assert from "node:assert/strict";
import * as A from "../analysis.js";

const ts = (d, h, m = 0) => { const [y, mo, da] = d.split("-").map(Number); return new Date(y, mo - 1, da, h, m).getTime(); };
const ev = (d, h, puffs = 1, extra = {}) => ({ id: d + h + Math.random(), ts: ts(d, h), puffs, tags: [], ...extra });

// 1) 0회 날 포함한 하루 평균
const events = [ev("2026-01-30", 8), ev("2026-01-30", 22, 2), ev("2026-02-02", 3)];
const days = A.dailyCounts(events, "2026-02-03");
assert.deepEqual(days.map(d => d.puffs), [3, 0, 0, 1, 0]);
const T = A.tiles(days, "2026-02-03");
assert.equal(T.all.n, 5); assert.equal(T.all.sum, 4); assert.equal(T.all.avg, 0.8);
assert.equal(T.month.n, 3); assert.equal(T.month.sum, 1);            // 2월 1~3일
assert.equal(T.quarter.n, 5); assert.equal(T.year.n, 5);
assert.equal(T.week.useDays, 2);

// 2) 월·분기·연 시리즈
const ms = A.periodSeries(days, "month");
assert.deepEqual(ms.map(m => [m.full, m.n, m.sum]), [["2026년 1월", 2, 3], ["2026년 2월", 3, 1]]);
assert.equal(A.periodSeries(days, "quarter").length, 1);
const longDays = A.dailyCounts([ev("2024-12-31", 9), ev("2026-03-01", 9)], "2026-03-01");
assert.deepEqual(A.periodSeries(longDays, "year").map(y => y.full), ["2024년", "2025년", "2026년"]);
assert.equal(A.periodSeries(longDays, "month").length, 12);

// 3) 계절: 12월은 겨울, 3월은 봄
const sc = A.seasonCompare(A.dailyCounts([ev("2025-12-31", 9, 4), ev("2026-03-01", 9)], "2026-03-01"));
const winter = sc.rows.find(r => r.name === "겨울"), spring = sc.rows.find(r => r.name === "봄");
assert.equal(winter.n, 60); assert.equal(winter.sum, 4); assert.equal(spring.n, 1); assert.equal(spring.sum, 1);

// 4) 시간대: 새벽 3시 1회, 8시 1회, 22시 2회
const tod = A.timeOfDay(events);
assert.equal(tod.total, 4); assert.equal(tod.hours[3], 1); assert.equal(tod.hours[22], 2);
assert.equal(tod.blocks[0].share, 0.25);

// 5) 미세먼지 등급 경계 (환경부)
assert.equal(A.pm10Grade(30), "좋음"); assert.equal(A.pm10Grade(31), "보통"); assert.equal(A.pm10Grade(81), "나쁨"); assert.equal(A.pm10Grade(151), "매우나쁨");
assert.equal(A.pm25Grade(15), "좋음"); assert.equal(A.pm25Grade(36), "나쁨"); assert.equal(A.pm25Grade(null), null);

// 6) 날씨 비교: PM10 나쁨인 날 3회, 좋은 날 0~1회
const wdays = [
  { date: "2026-03-01", puffs: 3, wx: { tmean: 8, tmin: 2, tmax: 14, rh: 35, precip: 0, snow: 0, wind: 10, pm10: 120, pm25: 50 } },
  { date: "2026-03-02", puffs: 3, wx: { tmean: 9, tmin: 3, tmax: 15, rh: 35, precip: 0, snow: 0, wind: 10, pm10: 100, pm25: 40 } },
  { date: "2026-03-03", puffs: 0, wx: { tmean: 12, tmin: 9, tmax: 15, rh: 80, precip: 5, snow: 0, wind: 35, pm10: 20, pm25: 8 } },
  { date: "2026-03-04", puffs: 1, wx: { tmean: 12, tmin: 9, tmax: 15, rh: 60, precip: 0, snow: 0, wind: 10, pm10: 25, pm25: 10 } },
  { date: "2026-03-05", puffs: 2, wx: null },
];
const wc = A.weatherCompare(wdays);
assert.equal(wc.n, 4);
const pm = wc.sections.find(s => s.title.startsWith("미세먼지"));
assert.equal(pm.overall, 1.75);
assert.equal(pm.rows.find(r => r.name === "나쁨").avg, 3);
assert.equal(pm.rows.find(r => r.name === "좋음").avg, 0.5);
const swing = wc.sections.find(s => s.title === "일교차");
assert.equal(swing.rows[0].n, 2); // 일교차 12°C 두 날

// 7) hourly 집계: 24시간, 비 합계, 미세먼지 평균
const hours = Array.from({ length: 24 }, (_, i) => `2026-03-01T${String(i).padStart(2, "0")}:00`);
const agg = A.aggregateHourly(
  { hourly: { time: hours, temperature_2m: hours.map((_, i) => i), relative_humidity_2m: hours.map(() => 50), precipitation: hours.map((_, i) => (i < 4 ? 0.5 : 0)), snowfall: hours.map(() => 0), wind_speed_10m: hours.map((_, i) => i), weather_code: hours.map((_, i) => (i < 4 ? 61 : 3)) } },
  { hourly: { time: hours, pm10: hours.map(() => 40), pm2_5: hours.map(() => 20) } });
assert.equal(agg.length, 1);
assert.deepEqual([agg[0].tmin, agg[0].tmax, agg[0].tmean, agg[0].precip, agg[0].wind, agg[0].pm10, agg[0].pm25, agg[0].code], [0, 23, 11.5, 2, 23, 40, 20, 61]);

// 8) 하루 위치: 기록 없는 날은 직전 위치를 이어 씀
const locs = A.dayLocations(days, [ev("2026-01-30", 8, 1, { loc: { lat: 37.57, lon: 126.98 } }), ev("2026-02-02", 3, 1, { loc: { lat: 35.68, lon: 139.69 } })], null);
assert.equal(locs.get("2026-01-31").key, A.locKey(37.57, 126.98));
assert.equal(locs.get("2026-02-03").key, A.locKey(35.68, 139.69));

console.log("analysis tests: all passed");

// 9) 실내·실외 비율, 실내 수치 분포, 필터한 하루 횟수(첫날은 전체 기준)
const pe = [ev("2026-04-01", 9, 1, { place: "in", indoor: { t: 22, rh: 35, pm25: 40 } }), ev("2026-04-01", 18, 2, { place: "out" }), ev("2026-04-03", 7, 1, { place: "in", indoor: { t: 17, rh: 65, pm25: null } }), ev("2026-04-03", 8)];
const sp = A.placeSplit(pe);
assert.equal(sp.total, 5); assert.equal(sp.rows.find(r => r.key === "in").sum, 2); assert.equal(sp.rows.find(r => r.key === "out").sum, 2); assert.equal(sp.rows.find(r => r.key === null).sum, 1);
const is = A.indoorStats(pe);
assert.equal(is.find(s => s.title === "실내 습도").rows[1].sum, 1);   // 35% 건조 (30–40%)
assert.equal(is.find(s => s.title === "실내 습도").rows[3].sum, 1);   // 65% 습함
assert.equal(is.find(s => s.title === "실내 초미세먼지").n, 1);
const outDays = A.dailyCounts(pe.filter(e => e.place === "out"), "2026-04-03", "2026-04-01");
assert.deepEqual(outDays.map(d => d.puffs), [2, 0, 0]);
assert.deepEqual(A.dailyCounts([], "2026-04-02", "2026-04-01").map(d => d.puffs), [0, 0]);
console.log("place tests: all passed");

// 10) 실내 평균값: 11월 22°C·35%, 7월 26°C·62%
assert.deepEqual(A.typicalIndoor(ts("2026-11-17", 9)), { t: 22, rh: 35 });
assert.deepEqual(A.typicalIndoor(ts("2026-07-01", 9)), { t: 26, rh: 62 });
// 직접 적은 값 우선, 없으면 평균값
const evIn = ev("2026-11-17", 9, 1, { place: "in", indoor: { t: 25.7, rh: null, pm25: null } });
assert.deepEqual(A.indoorOf(evIn), { t: 25.7, tEst: false, rh: 35, rhEst: true });
// 우리 집 보정: 습도계 40%(평균 35%보다 +5) → 다른 실내 기록도 +5
const evMeasured = ev("2026-11-16", 9, 1, { place: "in", indoor: { t: null, rh: 40, pm25: null } });
const now = ts("2026-11-17", 12);
assert.deepEqual(A.humidityOffset([evIn, evMeasured], now), { offset: 5, n: 1 });
assert.equal(A.indoorOf(ev("2026-01-05", 9, 1, { place: "in" }), 5).rh, 35); // 1월 30% + 5
assert.equal(A.humidityOffset([ev("2026-11-16", 9, 1, { place: "in", indoor: { rh: 80 } })], now).offset, 15); // 최대 ±15
assert.equal(A.humidityOffset([ev("2026-01-01", 9, 1, { place: "in", indoor: { rh: 80 } })], now).n, 0);       // 90일 지난 값은 안 씀
// 실내 통계: 평균값으로 채운 횟수와 직접 적은 횟수 구분
const st2 = A.indoorStats([evIn, ev("2026-11-17", 21, 2, { place: "in" }), ev("2026-11-17", 22, 1, { place: "out" })]);
const tSec = st2.find(s => s.title === "실내 기온"), hSec = st2.find(s => s.title === "실내 습도");
assert.equal(tSec.measured, 1); assert.equal(tSec.estimated, 2);
assert.equal(tSec.rows.find(r => r.name === "24°C 넘음").sum, 1);   // 25.7
assert.equal(tSec.rows.find(r => r.name === "18–24°C").sum, 2);     // 평균 22
assert.equal(hSec.estimated, 3); assert.equal(hSec.rows.find(r => r.name.startsWith("건조")).sum, 3); // 35%
console.log("indoor average tests: all passed");

// 11) 복용 계획: 기본 1+1, 증량 2+2
assert.equal(A.dayStatus(0), "none"); assert.equal(A.dayStatus(1), "less"); assert.equal(A.dayStatus(2), "routine");
assert.equal(A.dayStatus(3), "up"); assert.equal(A.dayStatus(4), "up"); assert.equal(A.dayStatus(5), "over");
assert.equal(A.dayStatus(3, { am: 2, pm: 2, amUp: 4, pmUp: 4 }), "less");
const pd = ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"].map((date, i) => ({ date, puffs: [2, 2, 4, 3, 1, 0, 6, 1][i] }));
const ss = A.statusSummary(pd, "2026-11-20");
assert.deepEqual(ss, { days: 7, none: 1, less: 1, routine: 2, up: 2, over: 1 }); // 오늘(20일, 1회)은 제외
assert.equal(A.upDays(pd), 3);
console.log("plan tests: all passed");
