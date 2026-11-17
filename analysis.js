// 순수 계산 함수 모음 — DOM·네트워크 없이 node로도 테스트할 수 있다.
export const pad = n => String(n).padStart(2, "0");
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const evDate = ev => ymd(new Date(ev.ts));
export const evPuffs = ev => (Number.isFinite(+ev.puffs) && +ev.puffs > 0 ? +ev.puffs : 1);

export function dayList(a, b) { const out = []; for (let s = a; s <= b; s = addDays(s, 1)) out.push(s); return out; }
export const seasonOf = m => (m >= 3 && m <= 5 ? "spring" : m >= 6 && m <= 8 ? "summer" : m >= 9 && m <= 11 ? "autumn" : "winter");
export const SEASONS = [["spring", "봄"], ["summer", "여름"], ["autumn", "가을"], ["winter", "겨울"]];

function stats(values) {
  const n = values.length; let sum = 0; for (const v of values) sum += v;
  return { n, sum, avg: n ? sum / n : 0 };
}

/** 첫 기록일부터 today까지 모든 날짜. 기록 없는 날은 0회(앱으로 매번 기록한다는 전제).
 *  first를 주면 그날부터 센다 — 실내/실외만 골라 셀 때도 전체 기록의 첫날 기준으로 0회 날을 채우려고. */
export function dailyCounts(events, today, first) {
  if (!events.length && !first) return [];
  const map = new Map(); let start = first || today;
  for (const ev of events) { const d = evDate(ev); if (!first && d < start) start = d; map.set(d, (map.get(d) || 0) + evPuffs(ev)); }
  return dayList(start, today).map(date => ({ date, puffs: map.get(date) || 0 }));
}

/* 실내·실외 */
export const PLACES = [["in", "실내"], ["out", "실외"], ["move", "나가거나 들어온 직후"]];
export function placeSplit(events) {
  const total = events.reduce((a, e) => a + evPuffs(e), 0);
  const rows = [...PLACES, [null, "선택 안 함"]].map(([k, name]) => {
    const sum = events.filter(e => (e.place || null) === k).reduce((a, e) => a + evPuffs(e), 0);
    return { key: k, name, sum, share: total ? sum / total : 0 };
  });
  return { total, rows };
}

/* 실내 평균값: 한국 아파트의 달별 대략적인 실내 기온·습도(난방철 건조, 장마·냉방철 습함).
 * 정확한 값이 아니라 "그 달 보통 이 정도"라는 기준이다. 사용자가 습도계 값을 적으면 그 차이만큼 보정한다. */
export const TYPICAL_INDOOR = [ // [기온°C, 습도%] 1월~12월
  [22, 30], [22, 32], [22, 38], [22, 42], [23, 48], [25, 58], [26, 62], [26, 62], [25, 55], [23, 45], [22, 35], [22, 32]];
export function typicalIndoor(ts) { const [t, rh] = TYPICAL_INDOOR[new Date(ts).getMonth()]; return { t, rh }; }

/** 습도계로 직접 적은 값과 그 달 평균값의 차이(최근 90일, 최대 ±15%p). 우리 집이 평균보다 습한지 건조한지. */
export function humidityOffset(events, now = Date.now()) {
  const d = events.filter(e => e.place === "in" && e.indoor && e.indoor.rh != null && now - e.ts < 90 * 864e5).map(e => e.indoor.rh - typicalIndoor(e.ts).rh);
  if (!d.length) return { offset: 0, n: 0 };
  const avg = d.reduce((a, b) => a + b, 0) / d.length;
  return { offset: Math.round(Math.max(-15, Math.min(15, avg))), n: d.length };
}
/** 이 기록의 실내 기온·습도: 직접 적은 값이 있으면 그 값, 없으면 그 달 평균(+우리 집 보정). */
export function indoorOf(e, offset = 0) {
  const ty = typicalIndoor(e.ts), i = e.indoor || {};
  return {
    t: i.t != null ? i.t : ty.t, tEst: i.t == null,
    rh: i.rh != null ? i.rh : Math.max(10, Math.min(90, ty.rh + offset)), rhEst: i.rh == null,
  };
}
export const INDOOR_RH_BANDS = [["매우 건조 (30% 미만)", v => v < 30], ["건조 (30–40%)", v => v >= 30 && v < 40], ["적정 (40–60%)", v => v >= 40 && v <= 60], ["습함 (60% 넘음)", v => v > 60]];

/** 실내 기록의 실내 수치별 흡입 횟수. 기온·습도는 직접 적은 값이 없으면 그 달 평균값(습도는 우리 집 보정)을 쓴다. */
export function indoorStats(events, offset = 0) {
  const ins = events.filter(e => e.place === "in");
  const sum = arr => arr.reduce((a, e) => a + evPuffs(e), 0);
  const filled = (title, key, estKey, defs) => {
    const xs = ins.map(e => ({ e, v: indoorOf(e, offset) }));
    return {
      title, n: sum(ins), measured: sum(xs.filter(x => !x.v[estKey]).map(x => x.e)), estimated: sum(xs.filter(x => x.v[estKey]).map(x => x.e)),
      rows: defs.map(([name, test]) => ({ name, sum: sum(xs.filter(x => test(x.v[key])).map(x => x.e)) })),
    };
  };
  const has = ins.filter(e => e.indoor && e.indoor.pm25 != null);
  return [
    filled("실내 기온", "t", "tEst", [["18°C 미만", v => v < 18], ["18–24°C", v => v >= 18 && v <= 24], ["24°C 넘음", v => v > 24]]),
    filled("실내 습도", "rh", "rhEst", INDOOR_RH_BANDS),
    { title: "실내 초미세먼지", n: sum(has), measured: sum(has), estimated: 0, rows: ["좋음", "보통", "나쁨", "매우나쁨"].map(g => ({ name: g, sum: sum(has.filter(e => pm25Grade(e.indoor.pm25) === g)) })) },
  ].filter(s => s.n > 0);
}

export function tiles(days, today) {
  const t = parseYmd(today), y = t.getFullYear(), m = t.getMonth() + 1, q = Math.ceil(m / 3);
  const pick = f => stats(days.filter(f).map(d => d.puffs));
  const last7 = days.filter(d => d.date > addDays(today, -7));
  return {
    month: { label: `${m}월`, ...pick(d => d.date.startsWith(`${y}-${pad(m)}`)) },
    quarter: { label: `${q}분기`, ...pick(d => { const dd = parseYmd(d.date); return dd.getFullYear() === y && Math.ceil((dd.getMonth() + 1) / 3) === q; }) },
    year: { label: `${y}년`, ...pick(d => d.date.startsWith(`${y}-`)) },
    all: { label: "전체", ...pick(() => true) },
    week: { days: last7.length, useDays: last7.filter(d => d.puffs > 0).length, sum: last7.reduce((a, d) => a + d.puffs, 0) },
  };
}

export function periodSeries(days, period) {
  const g = new Map();
  for (const d of days) {
    const dd = parseYmd(d.date), y = dd.getFullYear(), m = dd.getMonth() + 1, q = Math.ceil(m / 3);
    const key = period === "month" ? `${y}-${pad(m)}` : period === "quarter" ? `${y}-Q${q}` : `${y}`;
    if (!g.has(key)) g.set(key, { key, y, m, q, vals: [] });
    g.get(key).vals.push(d.puffs);
  }
  let arr = [...g.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  if (period === "month") arr = arr.slice(-12);
  if (period === "quarter") arr = arr.slice(-8);
  return arr.map((x, i) => ({
    ...stats(x.vals),
    label: period === "month" ? (i === 0 || x.m === 1 ? `${String(x.y).slice(2)}.${x.m}월` : `${x.m}월`) : period === "quarter" ? `${String(x.y).slice(2)}년 ${x.q}Q` : `${x.y}`,
    full: period === "month" ? `${x.y}년 ${x.m}월` : period === "quarter" ? `${x.y}년 ${x.q}분기` : `${x.y}년`,
  }));
}

/** 그룹별 하루 평균과 기준 평균의 차이. groups: [{name, test(day)}] */
export function compare(days, groups) {
  const overall = stats(days.map(d => d.puffs)).avg;
  return { overall, n: days.length, rows: groups.map(g => { const s = stats(days.filter(g.test).map(d => d.puffs)); return { name: g.name, ...s, diff: s.avg - overall }; }) };
}

export function seasonCompare(days) {
  return compare(days, SEASONS.map(([k, name]) => ({ name, test: d => seasonOf(parseYmd(d.date).getMonth() + 1) === k })));
}

// 한국 환경부 미세먼지 예보 등급
export const pm10Grade = v => (v == null ? null : v <= 30 ? "좋음" : v <= 80 ? "보통" : v <= 150 ? "나쁨" : "매우나쁨");
export const pm25Grade = v => (v == null ? null : v <= 15 ? "좋음" : v <= 35 ? "보통" : v <= 75 ? "나쁨" : "매우나쁨");

/** days: [{date, puffs, wx:{tmin,tmax,tmean,rh,precip,snow,wind,pm10,pm25}}] — wx 있는 날만 비교 */
export function weatherCompare(days) {
  const w = days.filter(d => d.wx && d.wx.tmean != null);
  const has = k => d => d.wx[k] != null;
  const sections = [
    { title: "기온 (하루 평균)", groups: [
      { name: "0°C 이하", test: d => d.wx.tmean <= 0 },
      { name: "0–10°C", test: d => d.wx.tmean > 0 && d.wx.tmean <= 10 },
      { name: "10–20°C", test: d => d.wx.tmean > 10 && d.wx.tmean <= 20 },
      { name: "20–27°C", test: d => d.wx.tmean > 20 && d.wx.tmean <= 27 },
      { name: "27°C 넘음", test: d => d.wx.tmean > 27 },
    ] },
    { title: "일교차", groups: [
      { name: "10°C 이상", test: d => d.wx.tmax - d.wx.tmin >= 10 },
      { name: "10°C 미만", test: d => d.wx.tmax - d.wx.tmin < 10 },
    ] },
    { title: "습도 (하루 평균)", groups: [
      { name: "건조 (40% 미만)", test: d => d.wx.rh != null && d.wx.rh < 40 },
      { name: "보통 (40–70%)", test: d => d.wx.rh != null && d.wx.rh >= 40 && d.wx.rh <= 70 },
      { name: "습함 (70% 넘음)", test: d => d.wx.rh != null && d.wx.rh > 70 },
    ] },
    { title: "미세먼지 PM10", only: has("pm10"), groups: ["좋음", "보통", "나쁨", "매우나쁨"].map(g => ({ name: g, test: d => pm10Grade(d.wx.pm10) === g })) },
    { title: "초미세먼지 PM2.5", only: has("pm25"), groups: ["좋음", "보통", "나쁨", "매우나쁨"].map(g => ({ name: g, test: d => pm25Grade(d.wx.pm25) === g })) },
    { title: "비·눈", groups: [
      { name: "비나 눈 온 날", test: d => (d.wx.precip || 0) >= 1 || (d.wx.snow || 0) > 0 },
      { name: "안 온 날", test: d => !((d.wx.precip || 0) >= 1 || (d.wx.snow || 0) > 0) },
    ] },
    { title: "바람 (최대 풍속)", groups: [
      { name: "강함 (30km/h 이상)", test: d => d.wx.wind != null && d.wx.wind >= 30 },
      { name: "약함", test: d => d.wx.wind != null && d.wx.wind < 30 },
    ] },
  ];
  return { n: w.length, sections: sections.map(s => { const pool = s.only ? w.filter(s.only) : w; return { title: s.title, ...compare(pool, s.groups) }; }).filter(s => s.n > 0) };
}

export const HOUR_BLOCKS = [["새벽", 0, 6], ["오전", 6, 12], ["오후", 12, 18], ["저녁·밤", 18, 24]];
export function timeOfDay(events) {
  const hours = Array(24).fill(0);
  for (const ev of events) hours[new Date(ev.ts).getHours()] += evPuffs(ev);
  const total = hours.reduce((a, b) => a + b, 0);
  const blocks = HOUR_BLOCKS.map(([name, a, b]) => { const sum = hours.slice(a, b).reduce((x, y) => x + y, 0); return { name, sum, share: total ? sum / total : 0 }; });
  return { hours, total, blocks };
}

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
export function weekdayAvg(days) {
  return WEEKDAYS.map((name, i) => ({ name, ...stats(days.filter(d => parseYmd(d.date).getDay() === i).map(d => d.puffs)) }));
}

export function tagCounts(events, tags) {
  return tags.map(([k, name]) => ({ key: k, name, n: events.filter(e => (e.tags || []).includes(k)).length })).filter(t => t.n > 0).sort((a, b) => b.n - a.n);
}

/** 하루 날씨를 가져올 위치: 그날 첫 기록 위치, 없으면 직전에 알던 위치. 약 25km 격자로 묶는다. */
export const locKey = (lat, lon) => `${(Math.round(lat * 4) / 4).toFixed(2)},${(Math.round(lon * 4) / 4).toFixed(2)}`;
export function dayLocations(days, events, fallback) {
  const byDay = new Map();
  for (const ev of [...events].sort((a, b) => a.ts - b.ts)) if (ev.loc && !byDay.has(evDate(ev))) byDay.set(evDate(ev), ev.loc);
  let cur = null; const out = new Map();
  const firstKnown = [...byDay.values()][0] || fallback || null;
  for (const d of days) { if (byDay.has(d.date)) cur = byDay.get(d.date); const l = cur || firstKnown; if (l) out.set(d.date, { lat: l.lat, lon: l.lon, key: locKey(l.lat, l.lon) }); }
  return out;
}

/** hourly 응답 → 날짜별 집계 */
export function aggregateHourly(wx, aq) {
  const out = new Map();
  const get = date => { if (!out.has(date)) out.set(date, { t: [], rh: [], p: 0, s: 0, w: [], pm10: [], pm25: [], codes: [] }); return out.get(date); };
  if (wx && wx.hourly) {
    const h = wx.hourly;
    h.time.forEach((iso, i) => {
      const r = get(iso.slice(0, 10));
      if (h.temperature_2m?.[i] != null) r.t.push(h.temperature_2m[i]);
      if (h.relative_humidity_2m?.[i] != null) r.rh.push(h.relative_humidity_2m[i]);
      r.p += h.precipitation?.[i] || 0; r.s += h.snowfall?.[i] || 0;
      if (h.wind_speed_10m?.[i] != null) r.w.push(h.wind_speed_10m[i]);
      if (h.weather_code?.[i] != null) r.codes.push(h.weather_code[i]);
    });
  }
  if (aq && aq.hourly) {
    const h = aq.hourly;
    h.time.forEach((iso, i) => { const r = get(iso.slice(0, 10)); if (h.pm10?.[i] != null) r.pm10.push(h.pm10[i]); if (h.pm2_5?.[i] != null) r.pm25.push(h.pm2_5[i]); });
  }
  const avg = a => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
  const res = [];
  for (const [date, r] of out) {
    if (r.t.length < 12) continue; // 하루 중 절반도 안 되면 집계하지 않음
    const codeCount = new Map(); r.codes.forEach(c => codeCount.set(c, (codeCount.get(c) || 0) + 1));
    const code = r.codes.length ? Math.max(...r.codes.filter(c => codeCount.get(c) >= 3), 0) : null;
    res.push({ date, tmin: Math.min(...r.t), tmax: Math.max(...r.t), tmean: avg(r.t), rh: avg(r.rh), precip: Math.round(r.p * 10) / 10, snow: Math.round(r.s * 10) / 10, wind: r.w.length ? Math.max(...r.w) : null, pm10: r.pm10.length >= 12 ? avg(r.pm10) : null, pm25: r.pm25.length >= 12 ? avg(r.pm25) : null, code });
  }
  return res.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function wmoText(c) {
  if (c == null) return "";
  if (c === 0) return "맑음"; if (c <= 2) return "구름 조금"; if (c === 3) return "흐림";
  if (c === 45 || c === 48) return "안개"; if (c >= 51 && c <= 57) return "이슬비"; if (c >= 61 && c <= 67) return "비";
  if (c >= 71 && c <= 77) return "눈"; if (c >= 80 && c <= 82) return "소나기"; if (c === 85 || c === 86) return "눈 소나기";
  if (c >= 95) return "뇌우"; return "";
}
