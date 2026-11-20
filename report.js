// 진료용 한 장 요약: A4 세로(150dpi, 1240×1754px) 캔버스에 그리고 PDF 한 쪽으로 감싼다. 외부 라이브러리 없음.
import * as A from "./analysis.js";

const PW = 1240, PH = 1754, M = 70, CW = PW - M * 2;
const C = { ink: "#14212b", muted: "#5a6a74", line: "#dce4e8", soft: "#eef3f5", accent: "#1d5f8a", routine: "#23877a", up: "#d0702f", over: "#9b2c12", less: "#b08a1e", none: "#c9d2d7" };
const FONT = `-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard","Noto Sans KR","Malgun Gothic",sans-serif`;
const dot = s => s.replaceAll("-", ".");
const r1 = v => (Math.round(v * 10) / 10).toFixed(1);

function txt(ctx, s, x, y, { size = 22, weight = 400, color = C.ink, align = "left", base = "alphabetic" } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base; ctx.fillText(s, x, y);
}
function wrap(ctx, s, x, y, maxW, lh, opt = {}) {
  ctx.font = `${opt.weight || 400} ${opt.size || 22}px ${FONT}`;
  let line = "", yy = y;
  for (const ch of [...s]) {
    if (ctx.measureText(line + ch).width > maxW && line) { txt(ctx, line, x, yy, opt); line = ch.trimStart(); yy += lh; }
    else line += ch;
  }
  if (line) txt(ctx, line, x, yy, opt);
  return yy + lh;
}
function rule(ctx, y) { ctx.fillStyle = C.line; ctx.fillRect(M, y, CW, 2); }
function heading(ctx, s, x, y, sub) { txt(ctx, s, x, y, { size: 27, weight: 700 }); if (sub) txt(ctx, sub, x, y + 30, { size: 19, color: C.muted }); }
function roundTop(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h); ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h); ctx.closePath(); ctx.fill();
}
function niceMax(v) { if (v <= 0) return 1; const e = Math.pow(10, Math.floor(Math.log10(v))); for (const s of [1, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (s * e >= v) return s * e; return 10 * e; }

/** 보고서에 들어갈 숫자를 모은다 (그리기와 분리 — node에서 검증 가능) */
export function reportData({ events, days, daysWx, plan, from, to }) {
  const inRange = d => d >= from && d <= to;
  const rd = days.filter(d => inRange(d.date));
  const rw = daysWx.filter(d => inRange(d.date));
  const re = events.filter(e => inRange(A.evDate(e)));
  const pt = A.planTotals(plan);
  const cnt = { none: 0, less: 0, routine: 0, up: 0, over: 0 };
  for (const d of rd) cnt[A.dayStatus(d.puffs, plan)]++;
  const total = rd.reduce((a, d) => a + d.puffs, 0);
  const night = re.filter(e => new Date(e.ts).getHours() < 6);
  const nightDays = new Set(night.map(A.evDate)).size;

  // 더/덜 쓴 조건: 날씨·계절·요일 비교에서 3일 이상·0.2회 이상 차이 나는 것
  const conds = [];
  const wc = A.weatherCompare(rw);
  for (const s of wc.sections) for (const r of s.rows) if (r.n >= 3) conds.push({ label: s.title.startsWith("비") ? r.name : `${s.title.split(" ")[0]} ${r.name}`, ...r, base: s.overall });
  const sc = A.seasonCompare(rd);
  for (const r of sc.rows) if (r.n >= 3) conds.push({ label: `${r.name}`, ...r, base: sc.overall });
  const more = conds.filter(c => c.diff >= 0.2).sort((a, b) => b.diff - a.diff).slice(0, 5);
  const less = conds.filter(c => c.diff <= -0.2).sort((a, b) => a.diff - b.diff).slice(0, 4);

  // 월별
  const months = new Map();
  for (const d of rd) { const k = d.date.slice(0, 7); if (!months.has(k)) months.set(k, []); months.get(k).push(d); }
  const monthly = [...months].map(([k, ds]) => ({ key: k, n: ds.length, avg: ds.reduce((a, d) => a + d.puffs, 0) / ds.length, up: A.upDays(ds, plan) })).slice(-6);

  return {
    from, to, nDays: rd.length, total, avg: rd.length ? total / rd.length : 0, pt, cnt,
    night: night.reduce((a, e) => a + A.evPuffs(e), 0), nightDays,
    days: rd, tod: A.timeOfDay(re), places: A.placeSplit(re), tags: re, more, less, monthly, wxDays: wc.n,
  };
}

/** A4 한 장을 캔버스에 그린다 */
export function drawReport(D, plan, tagNames) {
  const cv = document.createElement("canvas"); cv.width = PW; cv.height = PH;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, PW, PH);

  // 머리말
  txt(ctx, "흡입기 사용 기록 요약", M, 112, { size: 46, weight: 800 });
  txt(ctx, `${dot(D.from)} – ${dot(D.to)} (${D.nDays}일)`, PW - M, 112, { size: 25, weight: 600, align: "right" });
  txt(ctx, `${plan.name || "흡입기"} · 정기 복용 아침 ${plan.am}·저녁 ${plan.pm}회(하루 ${D.pt.base}회) · 악화 시 아침 ${plan.amUp}·저녁 ${plan.pmUp}회(하루 ${D.pt.up}회)까지 증량`, M, 156, { size: 22, color: C.muted });
  rule(ctx, 180);

  // 핵심 숫자 6칸
  const pct = n => (D.nDays ? Math.round((n / D.nDays) * 100) : 0);
  const tiles = [
    ["하루 평균", `${r1(D.avg)}회`, `총 ${D.total}회`, C.ink],
    ["계획대로", `${D.cnt.routine}일`, `${pct(D.cnt.routine)}% · 하루 ${D.pt.base}회`, C.routine],
    ["증량한 날", `${D.cnt.up}일`, `${pct(D.cnt.up)}% · 하루 ${D.pt.base + 1}–${D.pt.up}회`, C.up],
    ["증량보다 많이", `${D.cnt.over}일`, `하루 ${D.pt.up + 1}회 이상`, C.over],
    ["계획보다 적게·기록 없음", `${D.cnt.less + D.cnt.none}일`, `적게 ${D.cnt.less} · 없음 ${D.cnt.none}`, C.less],
    ["야간 사용 (0–6시)", `${D.night}회`, `${D.nightDays}일`, C.ink],
  ];
  const tw = (CW - 40) / 3, th = 118;
  tiles.forEach(([k, v, s, col], i) => {
    const x = M + (i % 3) * (tw + 20), y = 206 + Math.floor(i / 3) * (th + 18);
    ctx.fillStyle = C.soft; ctx.fillRect(x, y, tw, th);
    ctx.fillStyle = col; ctx.fillRect(x, y, 6, th);
    txt(ctx, k, x + 24, y + 36, { size: 21, color: C.muted, weight: 600 });
    txt(ctx, v, x + 24, y + 84, { size: 40, weight: 800, color: col === C.ink ? C.ink : col });
    txt(ctx, s, x + tw - 18, y + 84, { size: 18, color: C.muted, align: "right" });
  });

  // 날짜별(또는 주별) 막대
  let y0 = 500;
  const weekly = D.days.length > 120;
  const series = weekly ? weeklySeries(D.days) : D.days.map(d => ({ label: d.date, v: d.puffs, st: A.dayStatus(d.puffs, plan) }));
  heading(ctx, weekly ? "주별 하루 평균 흡입 횟수" : "날짜별 흡입 횟수", M, y0);
  const legend = weekly ? [["주 평균", C.accent]] : [["계획대로", C.routine], ["증량", C.up], ["증량보다 많이", C.over], ["적게", C.less]];
  let lx = PW - M;
  for (const [name, col] of [...legend].reverse()) {
    ctx.font = `400 19px ${FONT}`; const w = ctx.measureText(name).width;
    lx -= w; txt(ctx, name, lx, y0 - 4, { size: 19, color: C.muted }); lx -= 26; ctx.fillStyle = col; ctx.fillRect(lx, y0 - 20, 18, 18); lx -= 22;
  }
  const cx0 = M + 44, cy0 = y0 + 30, cw = CW - 44, ch = 300;
  const maxV = niceMax(Math.max(D.pt.up + 1, ...series.map(s => s.v)));
  const yy = v => cy0 + ch - (v / maxV) * ch;
  ctx.strokeStyle = C.line; ctx.lineWidth = 1.5;
  for (let v = 0; v <= maxV; v += maxV <= 6 ? 1 : 2) { ctx.beginPath(); ctx.moveTo(cx0, yy(v)); ctx.lineTo(cx0 + cw, yy(v)); ctx.stroke(); txt(ctx, String(v), cx0 - 10, yy(v) + 7, { size: 18, color: C.muted, align: "right" }); }
  const band = cw / Math.max(1, series.length), bw = Math.max(1.5, Math.min(26, band * 0.72));
  series.forEach((s, i) => {
    if (s.v <= 0) return;
    ctx.fillStyle = weekly ? C.accent : C[s.st] || C.accent;
    roundTop(ctx, cx0 + band * i + (band - bw) / 2, yy(s.v), bw, cy0 + ch - yy(s.v), bw > 8 ? 4 : 0);
  });
  ctx.setLineDash([10, 7]); ctx.lineWidth = 2;
  for (const [v, name, col] of [[D.pt.base, `정기 ${D.pt.base}회`, C.routine], [D.pt.up, `증량 상한 ${D.pt.up}회`, C.up]]) {
    ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(cx0, yy(v)); ctx.lineTo(cx0 + cw, yy(v)); ctx.stroke();
  }
  ctx.setLineDash([]);
  // 기준선 이름: 막대에 가리지 않게 흰 바탕 위에
  for (const [v, name, col] of [[D.pt.base, `정기 ${D.pt.base}회`, C.routine], [D.pt.up, `증량 상한 ${D.pt.up}회`, C.up]]) {
    ctx.font = `700 18px ${FONT}`; const w = ctx.measureText(name).width;
    ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fillRect(cx0 + cw - w - 12, yy(v) - 28, w + 12, 24);
    txt(ctx, name, cx0 + cw - 6, yy(v) - 10, { size: 18, color: col, align: "right", weight: 700 });
  }
  // x축: 달이 바뀌는 곳 표시
  let lastM = "";
  series.forEach((s, i) => {
    const m = s.label.slice(0, 7);
    if (m !== lastM) { lastM = m; const x = cx0 + band * i; ctx.fillStyle = C.line; ctx.fillRect(x, cy0 + ch, 2, 10); txt(ctx, `${+m.slice(5)}월${i === 0 ? ` ${+s.label.slice(8)}일` : ""}`, x + 4, cy0 + ch + 32, { size: 18, color: C.muted }); }
  });

  // 시간대 + 월별 표
  y0 = 930;
  heading(ctx, "시간대별 사용 (합계)", M, y0, "0–6시는 야간");
  const hx = M + 10, hy = y0 + 60, hw = 520, hh = 210;
  const hmax = Math.max(1, ...D.tod.hours);
  const hb = hw / 24;
  D.tod.hours.forEach((v, h) => { if (!v) return; ctx.fillStyle = h < 6 ? C.over : C.accent; roundTop(ctx, hx + h * hb + 2, hy + hh - (v / hmax) * hh, hb - 4, (v / hmax) * hh, 3); });
  ctx.fillStyle = C.line; ctx.fillRect(hx, hy + hh, hw, 2);
  for (const h of [0, 6, 12, 18, 23]) txt(ctx, `${h}시`, hx + h * hb + hb / 2, hy + hh + 28, { size: 17, color: C.muted, align: "center" });
  const blocks = D.tod.blocks.map(b => `${b.name} ${Math.round(b.share * 100)}%`).join(" · ");
  txt(ctx, blocks, hx, hy + hh + 62, { size: 19, color: C.ink });

  const tx = M + 640, tw2 = CW - 640;
  heading(ctx, "월별", tx, y0, "하루 평균 · 증량한 날");
  let ty = y0 + 78;
  txt(ctx, "월", tx, ty, { size: 19, color: C.muted, weight: 600 }); txt(ctx, "하루 평균", tx + tw2 * 0.55, ty, { size: 19, color: C.muted, weight: 600, align: "right" }); txt(ctx, "증량", tx + tw2, ty, { size: 19, color: C.muted, weight: 600, align: "right" });
  ty += 12; ctx.fillStyle = C.line; ctx.fillRect(tx, ty, tw2, 2);
  for (const mo of D.monthly) {
    ty += 36;
    txt(ctx, `${mo.key.slice(0, 4)}.${+mo.key.slice(5)}월${mo.n < 28 ? ` (${mo.n}일)` : ""}`, tx, ty, { size: 21 });
    txt(ctx, `${r1(mo.avg)}회`, tx + tw2 * 0.55, ty, { size: 21, weight: 700, align: "right" });
    txt(ctx, `${mo.up}일`, tx + tw2, ty, { size: 21, weight: 700, align: "right", color: mo.up ? C.up : C.ink });
  }

  // 함께 나타난 조건
  y0 = 1310;
  rule(ctx, y0 - 44);
  heading(ctx, "사용이 많았던 / 적었던 조건", M, y0, `그 조건이었던 날의 하루 평균 (기간 평균 ${r1(D.avg)}회 · 날씨를 아는 ${D.wxDays}일 기준)`);
  const col2 = M + CW / 2 + 10;
  const listCol = (items, x, title, color) => {
    let y = y0 + 80;
    txt(ctx, title, x, y, { size: 22, weight: 700, color }); y += 40;
    if (!items.length) { txt(ctx, "뚜렷한 차이 없음 (3일 이상인 조건 중)", x, y, { size: 20, color: C.muted }); return; }
    for (const c of items) { txt(ctx, `• ${c.label}`, x, y, { size: 21 }); txt(ctx, `${r1(c.avg)}회 (${c.diff >= 0 ? "+" : "−"}${r1(Math.abs(c.diff))}) · ${c.n}일`, x + CW / 2 - 30, y, { size: 20, color: C.muted, align: "right" }); y += 36; }
  };
  listCol(D.more, M, "더 많이 쓴 조건", C.up);
  listCol(D.less, col2, "덜 쓴 조건", C.routine);

  // 장소·상황
  y0 = 1590;
  const pl = D.places.rows.filter(r => r.sum > 0).map(r => `${r.key === "move" ? "드나든 직후" : r.name} ${Math.round(r.share * 100)}%`).join(" · ") || "기록 없음";
  txt(ctx, "있던 곳", M, y0, { size: 21, weight: 700 }); txt(ctx, pl, M + 120, y0, { size: 21 });
  const tc = A.tagCounts(D.tags, tagNames).slice(0, 6).map(t => `${t.name} ${t.n}`).join(" · ") || "기록 없음";
  txt(ctx, "적은 상황", M, y0 + 40, { size: 21, weight: 700 }); wrap(ctx, tc, M + 120, y0 + 40, CW - 120, 30, { size: 21 });

  // 꼬리말
  rule(ctx, PH - 92);
  const today = new Date(); const gen = `${today.getFullYear()}.${today.getMonth() + 1}.${today.getDate()}`;
  wrap(ctx, `생성 ${gen} · 흡입기 기록 앱에 환자가 직접 기록한 자료 · 기록하지 않은 날은 0회로 계산 · 날씨·대기질은 Open-Meteo 모델 추정치로 측정소 값과 다를 수 있음 · 함께 나타난 경향이며 원인을 뜻하지 않음`, M, PH - 56, CW, 26, { size: 17, color: C.muted });
  return cv;
}

function weeklySeries(days) {
  const out = [];
  for (let i = 0; i < days.length; i += 7) { const w = days.slice(i, i + 7); out.push({ label: w[0].date, v: w.reduce((a, d) => a + d.puffs, 0) / w.length }); }
  return out;
}

/** JPEG 한 장을 A4 한 쪽에 꽉 채운 PDF */
export function jpegToPdf(jpeg, wpx, hpx) {
  const W = 595.28, H = 841.89, enc = new TextEncoder();
  const chunks = []; const off = []; let len = 0;
  const put = x => { const b = typeof x === "string" ? enc.encode(x) : x; chunks.push(b); len += b.length; };
  const obj = (n, parts) => { off[n] = len; put(`${n} 0 obj\n`); parts.forEach(put); put("\nendobj\n"); };
  put("%PDF-1.4\n%âãÏÓ\n");
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]);
  obj(3, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`]);
  obj(4, [`<< /Type /XObject /Subtype /Image /Width ${wpx} /Height ${hpx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, "\nendstream"]);
  const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
  obj(5, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
  const xref = len;
  put(`xref\n0 6\n0000000000 65535 f \n${off.slice(1).map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`);
  put(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: "application/pdf" });
}

export const canvasJpeg = cv => new Promise(res => cv.toBlob(b => b.arrayBuffer().then(a => res(new Uint8Array(a))), "image/jpeg", 0.92));
