// Open-Meteo (무료, 키 없음, 전 세계): 날씨·대기질. 좌표만 보내고 개인정보는 보내지 않는다.
import { aggregateHourly, addDays, ymd, pad } from "./analysis.js";

const FORECAST = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const AIR = "https://air-quality-api.open-meteo.com/v1/air-quality";
const GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const REVERSE ="https://api.bigdatacloud.net/data/reverse-geocode-client";

const WX_VARS = "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,snowfall,weather_code,wind_speed_10m,surface_pressure";
const AIR_VARS = "pm10,pm2_5,dust,ozone,nitrogen_dioxide,us_aqi,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen";
const POLLEN = { alder_pollen: "오리나무", birch_pollen: "자작나무", grass_pollen: "풀", mugwort_pollen: "쑥", olive_pollen: "올리브", ragweed_pollen: "돼지풀" };

const qs = o => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
const r2 = v => (v == null ? null : Math.round(v * 10) / 10);

async function getJSON(url, ms = 15000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

function pack(w, a, src) {
  const pollen = {};
  if (a) for (const k of Object.keys(POLLEN)) if (a[k] != null && a[k] > 0) pollen[POLLEN[k]] = r2(a[k]);
  return {
    src,
    t: r2(w?.temperature_2m), feels: r2(w?.apparent_temperature), rh: r2(w?.relative_humidity_2m),
    precip: r2(w?.precipitation), snow: r2(w?.snowfall), code: w?.weather_code ?? null,
    wind: r2(w?.wind_speed_10m), pressure: r2(w?.surface_pressure),
    pm10: r2(a?.pm10), pm25: r2(a?.pm2_5), dust: r2(a?.dust), o3: r2(a?.ozone), no2: r2(a?.nitrogen_dioxide), aqi: a?.us_aqi ?? null,
    pollen,
  };
}

/** 지금 이 순간 날씨 (기록 버튼을 누를 때) */
export async function currentWeather(lat, lon) {
  const [w, a] = await Promise.allSettled([
    getJSON(`${FORECAST}?${qs({ latitude: lat, longitude: lon, current: WX_VARS, timezone: "auto" })}`),
    getJSON(`${AIR}?${qs({ latitude: lat, longitude: lon, current: AIR_VARS, timezone: "auto" })}`),
  ]);
  if (w.status !== "fulfilled" && a.status !== "fulfilled") throw new Error("날씨 서버에 연결하지 못했어요");
  return pack(w.value?.current, a.value?.current, "current");
}

function hourlyRow(json, iso) {
  const h = json?.hourly; if (!h) return null;
  const i = h.time.indexOf(iso); if (i < 0) return null;
  const row = {}; for (const k of Object.keys(h)) if (k !== "time") row[k] = h[k][i];
  return row;
}

/** 지난 시각의 날씨 (오프라인일 때 저장한 기록, 시간을 직접 넣은 기록) */
export async function weatherAt(lat, lon, ts) {
  const d = new Date(ts); const date = ymd(d); const iso = `${date}T${pad(d.getHours())}:00`;
  const old = date < addDays(ymd(new Date()), -80);
  const [w, a] = await Promise.allSettled([
    getJSON(`${old ? ARCHIVE : FORECAST}?${qs({ latitude: lat, longitude: lon, hourly: WX_VARS, timezone: "auto", start_date: date, end_date: date })}`),
    getJSON(`${AIR}?${qs({ latitude: lat, longitude: lon, hourly: AIR_VARS, timezone: "auto", start_date: date, end_date: date })}`),
  ]);
  const wr = w.status === "fulfilled" ? hourlyRow(w.value, iso) : null;
  const ar = a.status === "fulfilled" ? hourlyRow(a.value, iso) : null;
  if (!wr && !ar) throw new Error("그 시각 날씨를 찾지 못했어요");
  return pack(wr, ar, "hourly");
}

/** 날짜 범위의 하루 단위 날씨 (분석용). 80일보다 오래된 날은 과거 기록 API를 쓴다. */
export async function dailyRange(lat, lon, start, end) {
  const cut = addDays(ymd(new Date()), -80);
  const parts = [];
  if (start < cut) parts.push([ARCHIVE, start, end < cut ? end : addDays(cut, -1)]);
  if (end >= cut) parts.push([FORECAST, start < cut ? cut : start, end]);
  const wxVars = "temperature_2m,relative_humidity_2m,precipitation,snowfall,wind_speed_10m,weather_code";
  const results = [];
  for (const [base, s, e] of parts) {
    const [w, a] = await Promise.allSettled([
      getJSON(`${base}?${qs({ latitude: lat, longitude: lon, hourly: wxVars, timezone: "auto", start_date: s, end_date: e })}`, 25000),
      getJSON(`${AIR}?${qs({ latitude: lat, longitude: lon, hourly: "pm10,pm2_5", timezone: "auto", start_date: s, end_date: e })}`, 25000),
    ]);
    if (w.status !== "fulfilled") throw new Error("날씨 기록을 가져오지 못했어요");
    results.push(...aggregateHourly(w.value, a.status === "fulfilled" ? a.value : null));
  }
  return results;
}

/** 도시 검색. Open-Meteo는 한글 지명을 못 찾아서, 결과가 없으면 OpenStreetMap(Nominatim)으로 다시 찾는다. */
export async function searchPlace(name) {
  try {
    const j = await getJSON(`${GEOCODE}?${qs({ name, count: 6, language: "ko", format: "json" })}`);
    const r = (j.results || []).map(r => ({ lat: r.latitude, lon: r.longitude, place: [r.name, r.admin1, r.country].filter(Boolean).join(", ") }));
    if (r.length) return r;
  } catch { /* 아래 OSM으로 */ }
  const osm = async extra => (await getJSON(`${NOMINATIM}?${qs({ q: name, format: "jsonv2", limit: 6, "accept-language": "ko", ...extra })}`))
    .map(r => ({ lat: +(+r.lat).toFixed(4), lon: +(+r.lon).toFixed(4), place: r.display_name.split(", ").slice(0, 3).join(", ") }));
  const towns = await osm({ featureType: "settlement" });
  return towns.length ? towns : osm({});
}

export async function placeName(lat, lon) {
  try {
    const j = await getJSON(`${REVERSE}?${qs({ latitude: lat, longitude: lon, localityLanguage: "ko" })}`, 8000);
    return [j.locality || j.city, j.principalSubdivision, j.countryName].filter(Boolean).slice(0, 2).join(", ") || null;
  } catch { return null; }
}
