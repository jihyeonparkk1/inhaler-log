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

// 10) 실내 습도 추정 (Magnus): 바깥 0°C·60% → 실내 22°C에서 약 14%
assert.equal(A.estIndoorRh(0, 60, 22), 14);
assert.equal(A.estIndoorRh(-10, 70, 22), 8);       // 한겨울 → 매우 건조
assert.equal(A.estIndoorRh(15, 80, 22), 52);
assert.equal(A.estIndoorRh(30, 80, 22), 65);       // 바깥이 더 더우면(냉방) 65%로 자름
assert.equal(A.estIndoorRh(24, 50, 22), 50);
assert.equal(A.estIndoorRh(null, 50), null);
// 실내 기록: 직접 적은 습도 우선, 없으면 추정
const ie = [ev("2026-01-10", 9, 1, { place: "in", indoor: { t: 21, rh: 45, pm25: null }, wx: { t: 0, rh: 60 } }), ev("2026-01-10", 21, 2, { place: "in", wx: { t: 0, rh: 60 } }), ev("2026-01-11", 9, 1, { place: "out", wx: { t: 0, rh: 60 } })];
const irh = A.indoorStats(ie).find(s => s.title === "실내 습도");
assert.equal(irh.measured, 1); assert.equal(irh.estimated, 2);
assert.equal(irh.rows.find(r => r.name.startsWith("매우 건조")).sum, 2);
assert.equal(irh.rows.find(r => r.name.startsWith("적정")).sum, 1);
// 날씨 비교에 실내 습도(추정) 구간 포함
const wc2 = A.weatherCompare([{ date: "2026-01-10", puffs: 3, wx: { tmean: 0, tmin: -3, tmax: 3, rh: 60 } }, { date: "2026-05-10", puffs: 1, wx: { tmean: 18, tmin: 12, tmax: 24, rh: 70 } }]);
const sec = wc2.sections.find(s => s.title.startsWith("실내 습도"));
assert.equal(sec.rows.find(r => r.name.startsWith("매우 건조")).sum, 3);
assert.equal(sec.rows.find(r => r.name.startsWith("적정")).sum, 1); // 18°C·70% → 22°C에서 약 55%
console.log("indoor estimate tests: all passed");
