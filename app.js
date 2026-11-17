import { store } from "./store.js";
import * as A from "./analysis.js";
import { currentWeather, weatherAt, dailyRange, searchPlace, placeName } from "./weather.js";

const VERSION = "1.2.0";
const TAGS = [["exercise", "운동"], ["cold", "감기·기침"], ["night", "밤에 깸"], ["smoke", "담배 연기"], ["dust", "먼지·청소"],
  ["pollen", "꽃가루"], ["pet", "반려동물"], ["chill", "찬 공기"], ["stress", "스트레스"], ["smell", "강한 냄새"],
  ["cooking", "요리 연기"], ["mold", "곰팡이"], ["hvac", "에어컨·난방"]];
const PLACENAME = Object.fromEntries(A.PLACES);
const TAGNAME = Object.fromEntries(TAGS);

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const today = () => A.ymd(new Date());
const r1 = v => (Math.round(v * 10) / 10).toFixed(1);
const hm = ts => { const d = new Date(ts); return `${A.pad(d.getHours())}:${A.pad(d.getMinutes())}`; };
const prettyDate = s => { const d = A.parseYmd(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${A.WEEKDAYS[d.getDay()]})`; };

const S = { events: [], daily: new Map(), meta: {}, view: "log", period: "month", wxFilter: "all", shown: 7, syncing: false, syncNote: "", editing: null };

/* ---------- 저장 ---------- */
async function saveEvent(ev) { await store.put("events", ev); }
async function setMeta(k, v) { S.meta[k] = v; if (v == null) await store.del("meta", k); else await store.put("meta", v, k); }
function sortEvents() { S.events.sort((a, b) => b.ts - a.ts); }

/* ---------- 위치 ---------- */
function gps() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4), acc: Math.round(p.coords.accuracy), src: "gps", at: Date.now() }),
      err => { S.gpsError = err.code; resolve(null); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 });
  });
}
async function getLocation() {
  const g = await gps();
  if (g) { S.gpsError = null; await setMeta("lastLoc", g); return g; }
  if (S.meta.manualLoc) return { ...S.meta.manualLoc, src: "manual" };
  if (S.meta.lastLoc) return { ...S.meta.lastLoc, src: "last" };
  return null;
}
const fallbackLoc = () => S.meta.manualLoc || S.meta.lastLoc || null;

/* ---------- 기록 ---------- */
async function logPuff() {
  const btn = $("#pressBtn");
  btn.classList.remove("pulse"); void btn.offsetWidth; btn.classList.add("pulse");
  if (navigator.vibrate) navigator.vibrate(25);
  const ev = { id: uid(), ts: Date.now(), puffs: 1, tags: [], note: "", place: S.meta.place || null, indoor: null, loc: null, wx: null, wxStatus: "loading" };
  S.events.unshift(ev);
  await saveEvent(ev);
  renderLog(); showJust(ev);
  toast(`${hm(ev.ts)} 기록했어요`, "취소", () => removeEvent(ev.id));
  askPersist();

  const loc = await getLocation();
  if (!S.events.includes(ev)) return; // 그새 취소됨
  if (!loc) { ev.wxStatus = "noloc"; await saveEvent(ev); renderLog(); showJust(ev); return; }
  ev.loc = loc;
  try { ev.wx = await currentWeather(loc.lat, loc.lon); ev.wxStatus = "ok"; }
  catch { ev.wxStatus = "pending"; }
  if (!S.events.includes(ev)) return;
  await saveEvent(ev); renderLog(); showJust(ev);
  const place = loc.place || await placeName(loc.lat, loc.lon);
  if (place && S.events.includes(ev)) { ev.loc.place = place; await saveEvent(ev); if (loc.src === "gps") await setMeta("lastLoc", { ...S.meta.lastLoc, place }); renderLog(); showJust(ev); }
  scheduleSync();
}

async function removeEvent(id) {
  S.events = S.events.filter(e => e.id !== id);
  await store.del("events", id);
  if (S.justId === id) $("#justCard").hidden = true;
  renderAll();
}

/* 날씨를 못 붙인 기록(오프라인·시간 수정·위치 없음)에 나중에 그 시각 날씨를 채운다 */
let backfilling = false;
async function backfill() {
  if (backfilling || !navigator.onLine) return;
  backfilling = true;
  try {
    const todo = S.events.filter(e => e.wxStatus === "pending" || e.wxStatus === "loading" && Date.now() - e.ts > 120000 || (e.wxStatus === "noloc" && fallbackLoc()));
    for (const ev of todo.slice(0, 30)) {
      if (!ev.loc) { const f = fallbackLoc(); ev.loc = { lat: f.lat, lon: f.lon, place: f.place || null, src: "assumed" }; }
      try { ev.wx = await weatherAt(ev.loc.lat, ev.loc.lon, ev.ts); ev.wxStatus = "ok"; }
      catch { ev.wxStatus = "pending"; }
      await saveEvent(ev);
    }
    if (todo.length) renderAll();
  } finally { backfilling = false; }
}

/* ---------- 분석용 하루 날씨 ---------- */
let syncTimer;
function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(syncDaily, 1500); }
async function syncDaily() {
  if (S.syncing || !navigator.onLine) return;
  const t = today();
  const days = A.dailyCounts(S.events, t);
  if (!days.length) return;
  const locs = A.dayLocations(days, S.events, fallbackLoc());
  const need = [];
  for (const d of days) {
    const l = locs.get(d.date); if (!l) continue;
    const rec = S.daily.get(`${d.date}@${l.key}`);
    const fresh = rec && (d.date < A.addDays(t, -1) ? rec.fetchedDay > d.date : Date.now() - rec.fetchedAt < 3 * 3600e3);
    if (!fresh) need.push({ date: d.date, ...l });
  }
  if (!need.length) return;
  const groups = [];
  for (const n of need) {
    const g = groups[groups.length - 1];
    if (g && g.key === n.key && A.addDays(g.end, 1) === n.date) g.end = n.date;
    else groups.push({ key: n.key, lat: +n.key.split(",")[0], lon: +n.key.split(",")[1], start: n.date, end: n.date });
  }
  S.syncing = true; S.syncNote = ""; renderStats();
  let failed = 0;
  for (const g of groups) {
    try {
      const rows = await dailyRange(g.lat, g.lon, g.start, g.end);
      const recs = rows.filter(r => r.date >= g.start && r.date <= g.end).map(r => ({ ...r, key: `${r.date}@${g.key}`, fetchedAt: Date.now(), fetchedDay: t }));
      if (recs.length) { await store.putMany("daily", recs); recs.forEach(r => S.daily.set(r.key, r)); }
    } catch { failed++; }
  }
  S.syncing = false;
  S.syncNote = failed ? "일부 날짜의 날씨를 가져오지 못했어요. 인터넷이 연결되면 다시 시도해요." : "";
  renderStats();
}

/* ---------- 화면: 공통 ---------- */
let toastTimer;
function toast(msg, actionLabel, action) {
  const el = $("#toast");
  el.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ""}`;
  el.hidden = false;
  if (actionLabel) el.querySelector("button").onclick = () => { el.hidden = true; action(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, actionLabel ? 6000 : 3000);
}

function switchView(v) {
  S.view = v;
  for (const id of ["log", "stats", "settings"]) $(`#view-${id}`).hidden = id !== v;
  document.querySelectorAll(".tabs button").forEach(b => b.toggleAttribute("aria-current", b.dataset.view === v));
  if (b(v)) b(v)();
  window.scrollTo(0, 0);
  function b(x) { return { log: renderLog, stats: () => { renderStats(); scheduleSync(); }, settings: renderSettings }[x]; }
}

function placePills(ev) {
  if (!ev.place) return "";
  let s = `<span class="pill place">${PLACENAME[ev.place]}</span>`;
  const i = ev.indoor;
  if (ev.place === "in" && i) {
    const p = [];
    if (i.t != null) p.push(`${i.t}°C`); if (i.rh != null) p.push(`습도 ${i.rh}%`);
    if (i.pm25 != null) p.push(`초미세 ${i.pm25} ${A.pm25Grade(i.pm25)}`);
    if (p.length) s += `<span class="pill">실내 ${p.join(" · ")}</span>`;
  }
  if (ev.place === "in" && !(i && i.rh != null)) {
    const est = A.estIndoorRh(ev.wx?.t, ev.wx?.rh, indoorT());
    if (est != null) s += `<span class="pill${est < 30 ? " bad" : ""}" title="바깥 기온·습도와 실내 ${indoorT()}°C로 계산한 값">실내 습도 약 ${est}% (추정)</span>`;
  }
  return s;
}
const indoorT = () => (Number.isFinite(S.meta.indoorTemp) ? S.meta.indoorTemp : A.DEFAULT_INDOOR_T);
function wxPills(ev) {
  return placePills(ev) + (ev.place === "in" ? `<span class="pill status">바깥</span>` : "") + outdoorPills(ev);
}
function outdoorPills(ev) {
  if (ev.wxStatus === "loading") return `<span class="pill status">날씨 가져오는 중…</span>`;
  if (ev.wxStatus === "noloc") return `<span class="pill status">위치를 몰라 날씨 없음</span>`;
  if (ev.wxStatus === "pending" || !ev.wx) return `<span class="pill status">날씨 대기 중 (인터넷 연결 시 채움)</span>`;
  const w = ev.wx, p = [];
  if (w.t != null) p.push(`<span class="pill">${Math.round(w.t)}°C${w.feels != null && Math.abs(w.feels - w.t) >= 3 ? ` (체감 ${Math.round(w.feels)}°)` : ""}</span>`);
  const tx = A.wmoText(w.code); if (tx) p.push(`<span class="pill">${tx}</span>`);
  if (w.rh != null) p.push(`<span class="pill">습도 ${Math.round(w.rh)}%</span>`);
  const g10 = A.pm10Grade(w.pm10), g25 = A.pm25Grade(w.pm25);
  const cls = g => (g === "나쁨" || g === "매우나쁨" ? " bad" : g === "좋음" ? " good" : "");
  if (g10) p.push(`<span class="pill${cls(g10)}">미세 ${Math.round(w.pm10)} ${g10}</span>`);
  if (g25) p.push(`<span class="pill${cls(g25)}">초미세 ${Math.round(w.pm25)} ${g25}</span>`);
  if (w.wind != null && w.wind >= 30) p.push(`<span class="pill">바람 ${Math.round(w.wind)}km/h</span>`);
  const pol = Object.keys(w.pollen || {}); if (pol.length) p.push(`<span class="pill">꽃가루 ${esc(pol.join("·"))}</span>`);
  return p.join("");
}
const placeText = ev => !ev.loc ? "" : (ev.loc.place ? esc(ev.loc.place) : `${ev.loc.lat.toFixed(2)}, ${ev.loc.lon.toFixed(2)}`) + (ev.loc.src === "manual" ? " (기본 지역)" : ev.loc.src === "last" ? " (마지막 위치)" : ev.loc.src === "assumed" ? " (추정 위치)" : "");

/* ---------- 화면: 기록 ---------- */
function renderLog() {
  const t = today();
  const todays = S.events.filter(e => A.evDate(e) === t);
  const n = todays.reduce((a, e) => a + A.evPuffs(e), 0);
  const last = S.events[0];
  let line = `오늘 ${n}회`;
  if (last) { const mins = Math.round((Date.now() - last.ts) / 60000); line += ` · 마지막 ${A.evDate(last) === t ? hm(last.ts) : prettyDate(A.evDate(last))}` + (mins < 60 ? ` (${mins}분 전)` : mins < 24 * 60 ? ` (${Math.floor(mins / 60)}시간 전)` : ""); }
  else line = "아직 기록이 없어요. 흡입할 때 아래 버튼을 눌러 주세요.";
  $("#todayLine").textContent = line;

  const byDay = new Map();
  for (const e of S.events) { const d = A.evDate(e); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(e); }
  const dayKeys = [...byDay.keys()].slice(0, S.shown);
  $("#recent").innerHTML = dayKeys.length ? dayKeys.map(d => {
    const evs = byDay.get(d), sum = evs.reduce((a, e) => a + A.evPuffs(e), 0);
    return `<div><div class="dayhead"><b>${d === t ? "오늘" : prettyDate(d)}</b><span>${sum}회</span></div><div class="daygroup">${evs.map(e => `
      <button class="ev" type="button" data-id="${e.id}">
        <span class="t">${hm(e.ts)}</span>
        <span class="body"><span class="wx">${wxPills(e)}</span>${(e.tags || []).length || e.note ? `<span class="tagline">${esc([...(e.tags || []).map(k => TAGNAME[k]).filter(Boolean), e.note].filter(Boolean).join(" · "))}</span>` : ""}<span class="place">${placeText(e)}</span></span>
        <span class="cnt">${A.evPuffs(e) > 1 ? `×${A.evPuffs(e)}` : ""}</span>
      </button>`).join("")}</div></div>`;
  }).join("") : `<div class="card empty"><p>기록이 여기에 날짜별로 쌓여요. 각 기록에는 시각, 위치, 기온, 습도, 미세먼지가 붙어요.</p><p class="sub">깜빡하고 못 누른 흡입은 “시간 정해서 추가”로 넣으면 그 시각 날씨를 찾아 붙여요.</p></div>`;
  $("#moreBtn").hidden = byDay.size <= S.shown;
}

function showJust(ev) {
  S.justId = ev.id;
  const el = $("#justCard");
  el.hidden = false;
  const needIndoor = ev.place === "in" && !ev.indoor;
  el.innerHTML = `<div class="row between"><span class="when">${hm(ev.ts)} 기록됨</span><button class="ghost small" type="button" data-edit="${ev.id}">${needIndoor ? "실내 수치·상황 적기" : "상황 추가·수정"}</button></div>
    <div class="wx">${wxPills(ev)}</div>${ev.loc ? `<span class="sub">${placeText(ev)}</span>` : ""}
    ${ev.place ? "" : `<span class="sub">실내였는지 실외였는지 위의 “지금 있는 곳”에서 골라 두면 다음 기록부터 함께 저장돼요.</span>`}`;
}

/* ---------- 수정 창 ---------- */
function toLocalInput(ts) { const d = new Date(ts); return `${A.ymd(d)}T${A.pad(d.getHours())}:${A.pad(d.getMinutes())}`; }
function openEdit(ev, isNew) {
  S.editing = { ev, isNew, puffs: A.evPuffs(ev), tags: [...(ev.tags || [])], place: isNew ? (S.meta.place || null) : (ev.place || null), delArm: false };
  const i = ev.indoor || {};
  $("#inT").value = i.t ?? ""; $("#inRh").value = i.rh ?? ""; $("#inPm").value = i.pm25 ?? "";
  const est = A.estIndoorRh(ev.wx?.t, ev.wx?.rh, indoorT());
  $("#inRh").placeholder = est != null ? `추정 ${est}` : "";
  $("#inT").placeholder = String(indoorT());
  $("#inLast").hidden = !lastIndoor(ev.id);
  $("#editTitle").textContent = isNew ? "지난 기록 추가" : "기록 수정";
  $("#editTime").value = toLocalInput(ev.ts);
  $("#editTime").max = toLocalInput(Date.now());
  $("#editNote").value = ev.note || "";
  $("#editDelete").hidden = isNew;
  $("#editDelete").textContent = "삭제";
  $("#editWx").innerHTML = isNew ? "저장하면 그 시각·마지막 위치의 날씨를 찾아 붙여요." : "";
  paintEdit();
  $("#editDlg").showModal();
}
function paintEdit() {
  const e = S.editing;
  $("#editPuffs").textContent = e.puffs;
  $("#editTags").innerHTML = TAGS.map(([k, n]) => `<button type="button" class="chip" data-tag="${k}" aria-pressed="${e.tags.includes(k)}">${n}</button>`).join("");
  $("#editPlace").innerHTML = A.PLACES.map(([k, n]) => `<button type="button" class="chip" data-place="${k}" aria-pressed="${e.place === k}">${n}</button>`).join("");
  $("#indoorBox").hidden = e.place !== "in";
}
function lastIndoor(exceptId) { return S.events.find(x => x.id !== exceptId && x.place === "in" && x.indoor); }
$("#editPlace").onclick = e => { const b = e.target.closest("[data-place]"); if (!b) return; const k = b.dataset.place; S.editing.place = S.editing.place === k ? null : k; paintEdit(); };
$("#inLast").onclick = () => { const l = lastIndoor(S.editing.ev.id); if (!l) return; $("#inT").value = l.indoor.t ?? ""; $("#inRh").value = l.indoor.rh ?? ""; $("#inPm").value = l.indoor.pm25 ?? ""; };
function readIndoor() {
  const num = (id, lo, hi) => { const v = $(id).value.trim(); if (v === "") return null; const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 10) / 10 : undefined; };
  const t = num("#inT", -10, 45), rh = num("#inRh", 0, 100), pm25 = num("#inPm", 0, 999);
  if ([t, rh, pm25].includes(undefined)) return undefined;
  return t == null && rh == null && pm25 == null ? null : { t, rh, pm25 };
}
$("#editPlus").onclick = () => { S.editing.puffs = Math.min(20, S.editing.puffs + 1); paintEdit(); };
$("#editMinus").onclick = () => { S.editing.puffs = Math.max(1, S.editing.puffs - 1); paintEdit(); };
$("#editTags").onclick = e => { const b = e.target.closest("[data-tag]"); if (!b) return; const k = b.dataset.tag, t = S.editing.tags; S.editing.tags = t.includes(k) ? t.filter(x => x !== k) : [...t, k]; paintEdit(); };
$("#editCancel").onclick = () => $("#editDlg").close();
$("#editDelete").onclick = async () => {
  const e = S.editing;
  if (!e.delArm) { e.delArm = true; $("#editDelete").textContent = "한 번 더 누르면 삭제"; return; }
  $("#editDlg").close(); await removeEvent(e.ev.id); toast("기록을 삭제했어요");
};
$("#editForm").onsubmit = async e => {
  e.preventDefault();
  const ed = S.editing, ev = ed.ev;
  const ts = new Date($("#editTime").value).getTime();
  if (!Number.isFinite(ts)) { $("#editWx").textContent = "시각을 다시 골라 주세요."; return; }
  if (ts > Date.now() + 60000) { $("#editWx").textContent = "앞으로의 시각은 기록할 수 없어요."; return; }
  const indoor = ed.place === "in" ? readIndoor() : null;
  if (indoor === undefined) { $("#editWx").textContent = "실내 수치를 확인해 주세요 (기온 −10~45, 습도 0~100, 초미세먼지 0~999)."; return; }
  const hourChanged = Math.floor(ts / 3600000) !== Math.floor(ev.ts / 3600000);
  ev.ts = ts; ev.puffs = ed.puffs; ev.tags = ed.tags; ev.note = $("#editNote").value.trim().slice(0, 300);
  ev.place = ed.place; ev.indoor = indoor;
  if (ed.isNew) {
    const f = fallbackLoc();
    ev.loc = f ? { lat: f.lat, lon: f.lon, place: f.place || null, src: "assumed" } : null;
    ev.wxStatus = f ? "pending" : "noloc"; ev.wx = null;
    S.events.push(ev);
  } else if (hourChanged && ev.loc) { ev.wxStatus = "pending"; ev.wx = null; }
  sortEvents();
  await saveEvent(ev);
  $("#editDlg").close();
  renderAll(); if (S.justId === ev.id) showJust(ev);
  toast(ed.isNew ? "기록을 추가했어요" : "저장했어요");
  backfill().then(() => { if (S.justId === ev.id) showJust(ev); scheduleSync(); });
};

/* ---------- 화면: 분석 ---------- */
function niceMax(v) { if (v <= 0) return 1; const e = Math.pow(10, Math.floor(Math.log10(v))); for (const s of [1, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (s * e >= v) return s * e; return 10 * e; }
function barChart(el, items, { height = 190, fmt = r1, every = 0, mark = [] } = {}) {
  if (!items.length) { el.innerHTML = ""; return; }
  const W = Math.max(280, el.clientWidth || 600), H = height, ml = 30, mr = 6, mt = 20, mb = 24;
  const pw = W - ml - mr, ph = H - mt - mb;
  const max = niceMax(Math.max(...items.map(i => i.value)) * 1.1);
  const band = pw / items.length, bw = Math.min(36, band * 0.64);
  const y = v => mt + ph - (v / max) * ph;
  const step = every || Math.ceil(items.length / (W < 420 ? 6 : 12));
  const maxI = items.reduce((b, it, i) => (it.value > items[b].value ? i : b), 0);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (const t of [0, max / 2, max]) s += `<line x1="${ml}" x2="${W - mr}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${ml - 6}" y="${y(t) + 4}" text-anchor="end">${+t.toFixed(1)}</text>`;
  items.forEach((it, i) => {
    const cx = ml + band * i + band / 2, x = cx - bw / 2, top = y(it.value), h = mt + ph - top, rr = Math.min(4, h, bw / 2);
    if (h > 0.5) s += `<path d="M${x},${mt + ph}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + bw - rr}Q${x + bw},${top} ${x + bw},${top + rr}V${mt + ph}Z" fill="${it.alt ? "var(--more)" : "var(--accent)"}"/>`;
    if ((i === maxI || mark.includes(i)) && it.value > 0) s += `<text class="val" x="${cx}" y="${top - 6}" text-anchor="middle">${fmt(it.value)}</text>`;
    if (i % step === 0 || i === items.length - 1 && step === 1) s += `<text x="${cx}" y="${H - 7}" text-anchor="middle">${esc(it.label)}</text>`;
    s += `<rect x="${ml + band * i}" y="${mt}" width="${band}" height="${ph}" fill="transparent" data-i="${i}"/>`;
  });
  s += `</svg><div class="tip" hidden></div>`;
  el.innerHTML = s;
  const tip = el.querySelector(".tip"), svg = el.querySelector("svg");
  const show = e => {
    const r = e.target.closest("[data-i]"); if (!r) { tip.hidden = true; return; }
    const i = +r.dataset.i, it = items[i], sb = svg.getBoundingClientRect(), eb = el.getBoundingClientRect(), sc = sb.width / W;
    tip.style.left = Math.max(90, Math.min(eb.width - 90, (ml + band * i + band / 2) * sc)) + "px";
    tip.style.top = (y(it.value) * sc - 8) + "px";
    tip.textContent = it.tip; tip.hidden = false;
  };
  svg.addEventListener("pointermove", show); svg.addEventListener("pointerdown", show); svg.addEventListener("pointerleave", () => { tip.hidden = true; });
}

function divRows(cmp) {
  const ok = cmp.rows.filter(r => r.n >= 3);
  const maxAbs = Math.max(0.5, ...ok.map(r => Math.abs(r.diff)));
  return `<div class="axis-note"><div></div><div><span>덜 씀</span><span>평균 ${r1(cmp.overall)}회</span><span>더 씀</span></div><div></div></div>` +
    cmp.rows.map(r => {
      if (!r.n) return `<div class="drow thin"><div class="name">${esc(r.name)}</div><div class="track"></div><div class="figs">없음</div></div>`;
      const w = Math.min(50, (Math.abs(r.diff) / maxAbs) * 50);
      const bar = Math.abs(r.diff) < 0.05 ? "" : r.diff > 0 ? `<div class="bar more" style="left:50%;width:${w}%"></div>` : `<div class="bar less" style="right:50%;width:${w}%"></div>`;
      return `<div class="drow${r.n < 3 ? " thin" : ""}"><div class="name">${esc(r.name)}<small>${r.n}일</small></div><div class="track">${bar}</div><div class="figs">${r1(r.avg)}회<span>${r.diff >= 0 ? "+" : "−"}${r1(Math.abs(r.diff))}</span></div></div>`;
    }).join("");
}
function insight(rows, what) {
  const ok = rows.filter(r => r.n >= 3);
  if (ok.length < 2) return `<div class="insight"><span>${what}별로 3일 넘게 기록이 쌓이면 어디서 더 쓰는지 알려 드려요.</span></div>`;
  const more = ok.filter(r => r.diff >= 0.2).sort((a, b) => b.diff - a.diff).slice(0, 3);
  const less = ok.filter(r => r.diff <= -0.2).sort((a, b) => a.diff - b.diff).slice(0, 3);
  const lst = a => a.map(r => `${esc(r.name)}(${r1(r.avg)}회)`).join(", ");
  let h = "";
  if (more.length) h += `<div><b class="more">더 많이 씀</b> ${lst(more)}</div>`;
  if (less.length) h += `<div><b class="less">덜 씀</b> ${lst(less)}</div>`;
  return `<div class="insight">${h || `<span>${what}에 따른 차이가 아직 크지 않아요 (하루 0.2회 미만).</span>`}</div>`;
}

function renderStats() {
  if (S.view !== "stats") return;
  const t = today();
  const days = A.dailyCounts(S.events, t);
  const locsCache = A.dayLocations(days, S.events, fallbackLoc());
  $("#statsEmpty").hidden = !!days.length; $("#statsBody").hidden = !days.length;
  if (!days.length) { $("#statsLine").textContent = ""; return; }
  $("#statsLine").textContent = `${prettyDate(days[0].date)}부터 ${days.length}일 · 총 ${days.reduce((a, d) => a + d.puffs, 0)}회`;

  const T = A.tiles(days, t);
  const tile = s => `<div class="tile"><div class="k">${s.label} 하루 평균</div><div class="v">${s.n ? r1(s.avg) : "–"}<small>회</small></div><div class="n">${s.n}일 · 총 ${s.sum}회</div></div>`;
  $("#tiles").innerHTML = tile(T.month) + tile(T.quarter) + tile(T.year) + tile(T.all);
  const alert = T.week.useDays > 2;
  $("#controlCard").className = `card control${alert ? " alert" : ""}`;
  $("#controlCard").innerHTML = `<div class="big">${T.week.useDays}</div><div><b>최근 7일 중 사용한 날 (${T.week.sum}회)</b><p class="sub">${alert ? "증상 완화용 흡입기를 주 2일 넘게 쓰면 천식 조절이 충분하지 않을 수 있어요(GINA 기준). 담당 의사와 상의해 보세요." : "증상 완화용 흡입기를 주 2일 이하로 쓰면 GINA 기준으로 조절이 잘 되는 편이에요."}</p></div>`;

  const ps = A.periodSeries(days, S.period);
  barChart($("#periodChart"), ps.map(p => ({ label: p.label, value: p.avg, tip: `${p.full} · 하루 ${r1(p.avg)}회 · ${p.n}일 · 총 ${p.sum}회` })), { mark: [ps.length - 1], every: ps.length <= 8 ? 1 : 0 });

  const tod = A.timeOfDay(S.events);
  $("#blocks").innerHTML = tod.blocks.map((b, i) => `<div class="${i === 0 && b.share >= 0.15 ? "night" : ""}"><b>${Math.round(b.share * 100)}%</b>${b.name}</div>`).join("");
  barChart($("#hourChart"), tod.hours.map((v, h) => ({ label: `${h}시`, value: v, alt: h < 6, tip: `${h}시대 · ${v}회` })), { height: 160, fmt: v => String(v), every: 6 });

  const ps2 = A.placeSplit(S.events);
  $("#placeBlocks").innerHTML = ps2.rows.filter(r => r.key !== null || r.sum > 0).map(r => `<div><b>${Math.round(r.share * 100)}%</b>${esc(r.key === "move" ? "드나든 직후" : r.name)}<br><span class="num">${r.sum}회</span></div>`).join("");
  const ins = A.indoorStats(S.events, indoorT());
  $("#indoorStats").innerHTML = ins.length
    ? ins.map(s => `<div class="wxsec"><h3>${esc(s.title)} <small>(${s.estimated ? `직접 적은 ${s.measured}회 · 바깥 날씨로 추정 ${s.estimated}회` : `직접 적은 ${s.n}회`})</small></h3>${s.rows.map(r => `<div class="inrow"><span>${esc(r.name)}</span><span class="num">${r.sum}회</span></div>`).join("")}</div>`).join("")
    : `<p class="sub">실내에서 쓸 때 기록을 눌러 실내 기온·습도·초미세먼지를 적어 두면 여기에 어떤 실내 환경에서 많이 썼는지 나와요.</p>`;

  // 날씨 비교: 전체 / 실외에서 쓴 횟수만 / 실내에서 쓴 횟수만 (0회 날 포함, 기간은 같음)
  const pick = S.wxFilter === "out" ? S.events.filter(e => e.place === "out" || e.place === "move") : S.wxFilter === "in" ? S.events.filter(e => e.place === "in") : S.events;
  const fdays = S.wxFilter === "all" ? days : A.dailyCounts(pick, t, days[0].date);
  const daysWx = fdays.map(d => { const l = locsCache.get(d.date); const rec = l && S.daily.get(`${d.date}@${l.key}`); return { ...d, wx: rec || null }; });
  const wc = A.weatherCompare(daysWx, indoorT());
  const syncing = S.syncing ? " · 날씨 기록 가져오는 중…" : "";
  const fnote = S.wxFilter === "out" ? ` · 실외·드나든 직후 ${pick.length}건만 셈` : S.wxFilter === "in" ? ` · 실내 ${pick.length}건만 셈` : "";
  $("#wxLine").textContent = `날씨를 아는 ${wc.n}일 / 전체 ${days.length}일${fnote}${syncing}${S.syncNote ? " · " + S.syncNote : ""}`;
  if (!wc.n) {
    $("#wxInsight").innerHTML = `<div class="insight"><span>${fallbackLoc() || S.events.some(e => e.loc) ? (navigator.onLine ? "날씨 기록을 가져오는 중이에요." : "인터넷이 연결되면 날씨 기록을 가져와요.") : "위치를 알 수 없어 날씨를 비교할 수 없어요. 설정에서 위치를 허용하거나 기본 지역을 정해 주세요."}</span></div>`;
    $("#wxSections").innerHTML = "";
  } else {
    $("#wxInsight").innerHTML = insight(wc.sections.flatMap(s => s.rows.map(r => ({ ...r, name: `${s.title.split(" ")[0]} ${r.name}` }))), "날씨 조건");
    $("#wxSections").innerHTML = wc.sections.map(s => `<div class="wxsec"><h3>${esc(s.title)}</h3><div class="div-list">${divRows(s)}</div></div>`).join("");
  }

  const sc = A.seasonCompare(days);
  $("#seasonInsight").innerHTML = insight(sc.rows, "계절");
  $("#seasonRows").innerHTML = divRows(sc);

  const wd = A.weekdayAvg(days);
  barChart($("#weekChart"), wd.map(w => ({ label: w.name, value: w.avg, tip: `${w.name}요일 · 하루 ${r1(w.avg)}회 · ${w.n}일` })), { height: 150, every: 1 });

  const tc = A.tagCounts(S.events, TAGS);
  $("#tagCard").hidden = !tc.length;
  $("#tagRows").innerHTML = tc.map(x => `<div class="tagrow"><span>${esc(x.name)}</span><span class="num">${x.n}회</span></div>`).join("");
}

/* ---------- 화면: 설정 ---------- */
async function renderSettings() {
  const l = S.meta.lastLoc;
  let perm = "";
  try { const p = await navigator.permissions?.query({ name: "geolocation" }); if (p) perm = { granted: "허용됨", denied: "거부됨", prompt: "아직 묻지 않음" }[p.state] || ""; } catch { /* Safari 일부 버전 */ }
  $("#locStatus").textContent = (perm ? `위치 권한: ${perm}. ` : "") + (l ? `마지막 위치: ${l.place || `${l.lat}, ${l.lon}`} (${new Date(l.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })})` : "아직 위치를 받은 적이 없어요.") + (S.gpsError === 1 ? " 위치 권한이 꺼져 있어요. 설정 앱 → 개인정보 보호 → 위치 서비스에서 허용해 주세요." : "");
  const m = S.meta.manualLoc;
  $("#manualLine").innerHTML = m ? `기본 지역: <b>${esc(m.place)}</b> <button class="ghost small" type="button" id="clearManual">지우기</button>` : "기본 지역: 정하지 않음";
  const c = S.events.length, lb = S.meta.lastBackup;
  $("#backupLine").textContent = `기록 ${c}건 · 마지막 백업: ${lb ? new Date(lb).toLocaleDateString("ko-KR") : "없음"}`;
  try { const p = await navigator.storage?.persisted?.(); $("#persistLine").textContent = p ? "이 기기에 영구 저장으로 설정됨" : "브라우저가 공간이 부족할 때 지울 수 있는 상태예요. 홈 화면에 추가해서 쓰고 백업을 자주 만들어 주세요."; } catch { $("#persistLine").textContent = ""; }
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  $("#installCard").hidden = !!standalone;
  $("#versionLine").textContent = `버전 ${VERSION}`;
  if (document.activeElement !== $("#indoorTempInput")) $("#indoorTempInput").value = indoorT();
  const sample = A.estIndoorRh(0, 60, indoorT());
  $("#indoorTempLine").textContent = `예: 바깥 0°C·습도 60%일 때 실내 습도는 약 ${sample}%로 추정해요.`;
}
$("#locCheckBtn").onclick = async () => { $("#locStatus").textContent = "위치 확인 중…"; const g = await gps(); if (g) { await setMeta("lastLoc", g); const p = await placeName(g.lat, g.lon); if (p) await setMeta("lastLoc", { ...g, place: p }); backfill(); scheduleSync(); } renderSettings(); };
$("#placeForm").onsubmit = async e => {
  e.preventDefault(); const q = $("#placeInput").value.trim(); if (!q) return;
  $("#placeResults").innerHTML = `<p class="sub">찾는 중…</p>`;
  try {
    const r = await searchPlace(q); S.placeHits = r;
    $("#placeResults").innerHTML = r.length ? r.map((x, i) => `<button type="button" data-i="${i}">${esc(x.place)}</button>`).join("") : `<p class="sub">“${esc(q)}”을(를) 찾지 못했어요. 영어 이름으로도 찾아보세요.</p>`;
  } catch { $("#placeResults").innerHTML = `<p class="sub">검색하지 못했어요. 인터넷 연결을 확인해 주세요.</p>`; }
};
$("#placeResults").onclick = async e => { const b = e.target.closest("[data-i]"); if (!b) return; await setMeta("manualLoc", S.placeHits[+b.dataset.i]); $("#placeResults").innerHTML = ""; $("#placeInput").value = ""; renderSettings(); backfill(); scheduleSync(); toast("기본 지역을 정했어요"); };
$("#manualLine").onclick = async e => { if (e.target.id === "clearManual") { await setMeta("manualLoc", null); renderSettings(); } };

$("#indoorTempInput").onchange = async e => {
  const v = Number(e.target.value);
  if (!Number.isFinite(v) || v < 15 || v > 30) { e.target.value = indoorT(); toast("15~30°C 사이로 적어 주세요"); return; }
  await setMeta("indoorTemp", Math.round(v * 2) / 2); renderSettings(); renderLog(); toast(`실내 온도를 ${indoorT()}°C로 정했어요`);
};
$("#exportBtn").onclick = async () => {
  const data = { app: "inhaler-log", version: 1, exportedAt: new Date().toISOString(), events: S.events, meta: { manualLoc: S.meta.manualLoc || null, indoorTemp: S.meta.indoorTemp ?? null } };
  const name = `흡입기기록-${today()}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const file = new File([blob], name, { type: "application/json" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "흡입기 기록 백업" }); }
    else { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
    await setMeta("lastBackup", Date.now()); renderSettings(); toast("백업 파일을 만들었어요. 파일 앱이나 iCloud에 보관하세요.");
  } catch (err) { if (err && err.name !== "AbortError") toast("백업을 만들지 못했어요"); }
};
$("#importInput").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (j.app !== "inhaler-log" || !Array.isArray(j.events)) throw new Error("bad");
    const have = new Set(S.events.map(x => x.id)); let added = 0;
    const fresh = j.events.filter(x => x && x.id && Number.isFinite(x.ts) && !have.has(x.id));
    for (const x of fresh) { S.events.push(x); added++; }
    await store.putMany("events", fresh); sortEvents();
    if (!S.meta.manualLoc && j.meta?.manualLoc) await setMeta("manualLoc", j.meta.manualLoc);
    renderAll(); toast(`${added}건을 불러왔어요 (이미 있던 ${j.events.length - added}건은 건너뜀)`); backfill(); scheduleSync();
  } catch { toast("이 파일은 흡입기 기록 백업이 아니에요"); }
};

let persistAsked = false;
function askPersist() { if (persistAsked) return; persistAsked = true; try { navigator.storage?.persist?.(); } catch { /* 무시 */ } }

/* ---------- 이벤트 연결 ---------- */
$("#pressBtn").onclick = logPuff;
$("#addPastBtn").onclick = () => openEdit({ id: uid(), ts: Date.now() - 30 * 60000, puffs: 1, tags: [], note: "" }, true);
$("#moreBtn").onclick = () => { S.shown += 14; renderLog(); };
$("#recent").onclick = e => { const b = e.target.closest("[data-id]"); if (!b) return; const ev = S.events.find(x => x.id === b.dataset.id); if (ev) openEdit(ev, false); };
$("#justCard").onclick = e => { const b = e.target.closest("[data-edit]"); if (!b) return; const ev = S.events.find(x => x.id === b.dataset.edit); if (ev) openEdit(ev, false); };
document.querySelectorAll(".tabs button").forEach(b => { b.onclick = () => switchView(b.dataset.view); });
document.querySelectorAll("[data-wxf]").forEach(b => { b.onclick = () => { S.wxFilter = b.dataset.wxf; document.querySelectorAll("[data-wxf]").forEach(x => x.setAttribute("aria-pressed", x === b)); renderStats(); }; });
function paintPlaceSeg() { document.querySelectorAll("#placeSeg [data-place]").forEach(x => x.setAttribute("aria-pressed", x.dataset.place === S.meta.place)); }
$("#placeSeg").onclick = async e => {
  const b = e.target.closest("[data-place]"); if (!b) return;
  const k = b.dataset.place;
  await setMeta("place", S.meta.place === k ? null : k);
  paintPlaceSeg();
};
document.querySelectorAll("[data-period]").forEach(b => { b.onclick = () => { S.period = b.dataset.period; document.querySelectorAll("[data-period]").forEach(x => x.setAttribute("aria-pressed", x === b)); renderStats(); }; });
window.addEventListener("online", () => { backfill(); scheduleSync(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) { renderAll(); backfill(); scheduleSync(); } });
let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(renderStats, 150); });

function renderAll() { renderLog(); renderStats(); if (S.view === "settings") renderSettings(); }

/* ---------- 시작 ---------- */
(async function start() {
  try {
    const [events, daily] = await Promise.all([store.all("events"), store.all("daily")]);
    S.events = events; sortEvents();
    daily.forEach(r => S.daily.set(r.key, r));
    for (const k of ["lastLoc", "manualLoc", "lastBackup", "place", "indoorTemp"]) S.meta[k] = await store.get("meta", k);
    paintPlaceSeg();
  } catch {
    $("#todayLine").textContent = "이 브라우저에서는 기록을 저장할 수 없어요 (개인정보 보호 모드인지 확인해 주세요).";
    $("#pressBtn").disabled = true; return;
  }
  renderAll();
  backfill(); scheduleSync();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
