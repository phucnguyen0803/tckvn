// VN Stock Pro – giao diện web
import * as API from "./api.js";
import * as T from "./core/technical.js";
import * as F from "./core/fundamental.js";
import * as S from "./core/strategy.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ------------------------------------------------------------------ lưu trữ
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bỏ qua */ } },
};
const DEFAULT_WL = ["FPT", "HPG", "MWG", "VCB", "TCB", "MBB", "SSI", "VNM", "DGC", "GMD"];
const state = {
  watchlist: LS.get("vsp_watchlist", DEFAULT_WL),
  settings: { capital: 500e6, risk: 1, maxAlloc: 25, refresh: 15, withFund: true, ...LS.get("vsp_settings", {}) },
  market: null, marketAt: 0, timers: [], stocks: null,
};
const saveWL = () => LS.set("vsp_watchlist", state.watchlist);
const saveSettings = () => LS.set("vsp_settings", state.settings);

// ------------------------------------------------------------------ định dạng
const nf = (d) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt = (v, d = 2) => (isNum(v) ? nf(d).format(v) : "–");
const fmtInt = (v) => (isNum(v) ? nf(0).format(v) : "–");
const fmtPct = (v, d = 1, sign = false) => (isNum(v) ? `${sign && v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%` : "–");
const fmtSigned = (v, d = 2) => (isNum(v) ? `${v >= 0 ? "+" : ""}${nf(d).format(v)}` : "–");
const cls = (v) => (!isNum(v) ? "" : v > 0 ? "up" : v < 0 ? "down" : "ref");
function priceCls(b) {
  if (!b || !isNum(b.price)) return "";
  if (b.ceiling && b.price >= b.ceiling) return "ceil";
  if (b.floor && b.price <= b.floor) return "floor";
  return b.price > b.ref ? "up" : b.price < b.ref ? "down" : "ref";
}
const scoreBadge = (s) => {
  if (!isNum(s)) return "–";
  const h = Math.max(0, Math.min(1, (s - 20) / 65)) * 120;
  return `<span class="score" style="background:hsl(${h},70%,55%)">${Math.round(s)}</span>`;
};
const actionCls = (a) => (/^MUA/.test(a) ? "p-buy" : /^(CHỜ|THEO)/.test(a) ? "p-wait" : /^(BÁN|TRÁNH)/.test(a) ? "p-avoid" : "p-neutral");
const pill = (a) => `<span class="pill ${actionCls(a)}">${esc(a)}</span>`;
const verdictCls = (a) => (/^MUA/.test(a) ? "v-buy" : /^(CHỜ|THEO)/.test(a) ? "v-wait" : "v-avoid");
const loading = (msg = "Đang tải…") => `<div class="loading"><span class="spinner"></span> ${esc(msg)}</div>`;
const errBox = (e) => `<div class="err">⚠️ ${esc(e?.message || e)}</div>`;
const list = (items, icon) => (items.length ? `<ul class="list">${items.map((i) => `<li>${icon} ${esc(i)}</li>`).join("")}</ul>` : `<p class="muted">–</p>`);
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2200); }

// ------------------------------------------------------------------ giờ giao dịch
function sessionInfo() {
  const vn = new Date(Date.now() + 7 * 3600e3), wd = vn.getUTCDay(), m = vn.getUTCHours() * 60 + vn.getUTCMinutes();
  if (wd === 0 || wd === 6) return { live: false, text: "Cuối tuần – nghỉ giao dịch" };
  if (m >= 540 && m < 690) return { live: true, text: "🟢 Đang giao dịch (sáng)" };
  if (m >= 690 && m < 780) return { live: false, text: "🟡 Nghỉ trưa" };
  if (m >= 780 && m <= 900) return { live: true, text: m >= 885 ? "🟢 Phiên ATC" : "🟢 Đang giao dịch (chiều)" };
  return { live: false, text: "⚪ Ngoài giờ giao dịch" };
}
function updateBadge() {
  const s = sessionInfo(), b = $("#session-badge");
  b.textContent = s.text; b.classList.toggle("live", s.live);
}

// ------------------------------------------------------------------ timers
function every(fn, ms) {
  const h = setInterval(() => { if (!document.hidden) fn(); }, ms);
  state.timers.push(h);
}
function clearTimers() { state.timers.forEach(clearInterval); state.timers = []; }

// ------------------------------------------------------------------ dữ liệu dùng chung
async function getMarket() {
  if (state.market && Date.now() - state.marketAt < 5 * 60e3) return state.market;
  const idx = await API.history("VNINDEX", 900);
  const mr = T.marketRegime(idx);
  state.market = { ...mr, indexBars: idx }; state.marketAt = Date.now();
  $("#market-mini").innerHTML = `VN-Index: <b>${esc(mr.trend)}</b><br>Tỷ trọng gợi ý: ${esc(mr.exposure)}`;
  return state.market;
}
async function getStocks() {
  if (!state.stocks) {
    const arr = await API.stocks();
    state.stocks = new Map(arr.map((s) => [s.s, s]));
  }
  return state.stocks;
}
const ICB = { "0500": "Dầu khí", "1300": "Hóa chất", "1700": "Tài nguyên cơ bản", "2300": "Xây dựng & Vật liệu", "2700": "Hàng & DV công nghiệp",
  "3300": "Ô tô & phụ tùng", "3500": "Thực phẩm & Đồ uống", "3700": "Hàng cá nhân & Gia dụng", "4500": "Y tế", "5300": "Bán lẻ", "5500": "Truyền thông",
  "5700": "Du lịch & Giải trí", "6500": "Viễn thông", "7500": "Tiện ích", "8300": "Ngân hàng", "8500": "Bảo hiểm", "8600": "Bất động sản",
  "8700": "Dịch vụ tài chính", "9500": "Công nghệ thông tin" };

async function mapLimit(items, limit, fn, onProgress) {
  const out = new Array(items.length); let i = 0, done = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { error: e }; }
      done++; onProgress?.(done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Phân tích đầy đủ 1 mã */
async function analyzeSymbol(sym, bars, live, withFund, mkt) {
  const b = S.mergeLive(bars, live);
  const tech = T.analyze(b, mkt?.indexBars);
  let fund = null, finData = null;
  if (withFund) {
    try { finData = await API.fin(sym); fund = F.analyze(finData, b.c[b.c.length - 1]); } catch { fund = null; }
  }
  const board = live?.board || "HSX";
  const plan = S.tradePlan(tech, board, fund?.score ?? null, mkt?.score ?? null);
  const o = S.overall(tech.score, fund?.score ?? null, mkt?.score ?? null);
  return { sym, bars: b, tech, fund, finData, plan, total: o.total, label: o.label, board, live };
}

// ------------------------------------------------------------------ bảng sắp xếp được
function table(el, columns, rows, opt = {}) {
  let sortKey = opt.sortKey, dir = opt.dir ?? -1;
  const draw = () => {
    const rs = [...rows];
    if (sortKey) rs.sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      if (x == null || (typeof x === "number" && !isNum(x))) return 1;
      if (y == null || (typeof y === "number" && !isNum(y))) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
    });
    el.innerHTML = `<div class="tbl-wrap" style="${opt.maxH ? `max-height:${opt.maxH}px` : ""}"><table><thead><tr>${columns.map((c) =>
      `<th class="${c.l ? "l" : ""}" data-k="${c.key}">${esc(c.label)}${sortKey === c.key ? (dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
      <tbody>${rs.map((r) => `<tr>${columns.map((c) => `<td class="${c.l ? "l" : "num"} ${c.cls ? c.cls(r) : ""}">${c.fmt ? c.fmt(r[c.key], r) : esc(r[c.key])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    el.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.k; if (sortKey === k) dir = -dir; else { sortKey = k; dir = -1; } draw();
    }));
  };
  draw();
}
const symLink = (s) => `<a href="#/stock/${encodeURIComponent(s)}">${esc(s)}</a>`;

// ------------------------------------------------------------------ biểu đồ
const PLOT_BASE = {
  paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: { color: "#8b97ad", family: "Inter", size: 11 },
  margin: { l: 50, r: 70, t: 10, b: 30 }, hovermode: "x unified", showlegend: true,
  legend: { orientation: "h", y: 1.04, x: 0, font: { size: 10 }, traceorder: "normal" },
};
const GRID = { gridcolor: "#1d2840", zerolinecolor: "#24304a" };
const plotCfg = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"] };
const dlabel = (t) => { const d = new Date(t * 1000); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(2)}`; };

function priceChart(el, x, plan, levels, nBars = 180) {
  if (!window.Plotly) { el.innerHTML = errBox("Không tải được thư viện biểu đồ"); return; }
  const n = x.c.length, s = Math.max(0, n - nBars), sl = (a) => a.slice(s);
  const X = sl(x.t).map(dlabel);
  const tr = [
    { type: "candlestick", x: X, open: sl(x.o), high: sl(x.h), low: sl(x.l), close: sl(x.c), name: "Giá",
      increasing: { line: { color: "#22c55e" } }, decreasing: { line: { color: "#ef4444" } }, yaxis: "y" },
    ...[["ma20", "#f59e0b", 1.2], ["ma50", "#3b82f6", 1.4], ["ma200", "#a855f7", 1.6]].map(([k, c, w]) =>
      ({ type: "scatter", mode: "lines", x: X, y: sl(x[k]), name: k.toUpperCase(), line: { color: c, width: w }, yaxis: "y" })),
    { type: "scatter", mode: "lines", x: X, y: sl(x.bb_up), name: "BB", line: { color: "rgba(139,151,173,.45)", dash: "dot", width: 1 }, yaxis: "y" },
    { type: "scatter", mode: "lines", x: X, y: sl(x.bb_lo), name: "BB dưới", showlegend: false, line: { color: "rgba(139,151,173,.45)", dash: "dot", width: 1 },
      fill: "tonexty", fillcolor: "rgba(139,151,173,.05)", yaxis: "y" },
    { type: "bar", x: X, y: sl(x.v), name: "KL", marker: { color: sl(x.c).map((c, i) => (c >= sl(x.o)[i] ? "rgba(34,197,94,.6)" : "rgba(239,68,68,.6)")) }, yaxis: "y2" },
    { type: "scatter", mode: "lines", x: X, y: sl(x.vol_ma20), name: "KL TB20", showlegend: false, line: { color: "#f59e0b", width: 1 }, yaxis: "y2" },
    { type: "scatter", mode: "lines", x: X, y: sl(x.rsi), name: "RSI", line: { color: "#a78bfa", width: 1.3 }, yaxis: "y3" },
    { type: "bar", x: X, y: sl(x.macd_hist), name: "MACD hist", showlegend: false, marker: { color: sl(x.macd_hist).map((v) => (v >= 0 ? "rgba(34,197,94,.55)" : "rgba(239,68,68,.55)")) }, yaxis: "y4" },
    { type: "scatter", mode: "lines", x: X, y: sl(x.macd), name: "MACD", line: { color: "#3b82f6", width: 1.2 }, yaxis: "y4" },
    { type: "scatter", mode: "lines", x: X, y: sl(x.macd_sig), name: "Signal", line: { color: "#f59e0b", width: 1.2 }, yaxis: "y4" },
  ];
  const lo = Math.min(...sl(x.l)), hi = Math.max(...sl(x.h));
  const shapes = [], ann = [];
  const hline = (y, color, dash, text, yref = "y", pos = "right") => {
    shapes.push({ type: "line", xref: "paper", x0: 0, x1: 1, yref, y0: y, y1: y, line: { color, width: 1.2, dash } });
    if (text) ann.push(pos === "right"
      ? { xref: "paper", x: 1, xanchor: "left", yref, y, text, showarrow: false, font: { color, size: 10 } }
      : { xref: "paper", x: 0.004, xanchor: "left", yanchor: "bottom", yref, y, text, showarrow: false, font: { color: "#8b97ad", size: 9 } });
  };
  for (const lv of levels) if (lv.price >= lo * 0.9 && lv.price <= hi * 1.1) hline(lv.price, "rgba(139,151,173,.45)", "dot", `${lv.kind === "support" ? "HT" : "KC"} ${lv.price.toFixed(2)}`, "y", "left");
  if (plan) {
    shapes.push({ type: "rect", xref: "paper", x0: 0, x1: 1, yref: "y", y0: plan.entryLow, y1: plan.entryHigh, fillcolor: "rgba(59,130,246,.15)", line: { width: 0 } });
    ann.push({ xref: "paper", x: 1, xanchor: "left", yref: "y", y: (plan.entryLow + plan.entryHigh) / 2, text: "Vùng mua", showarrow: false, font: { color: "#60a5fa", size: 10 } });
    hline(plan.stop, "#ef4444", "dash", `SL ${plan.stop.toFixed(2)}`);
    hline(plan.tp1, "#22c55e", "dash", `TP1 ${plan.tp1.toFixed(2)}`);
    hline(plan.tp2, "#22c55e", "dash", `TP2 ${plan.tp2.toFixed(2)}`);
  }
  hline(70, "rgba(139,151,173,.4)", "dot", "", "y3"); hline(30, "rgba(139,151,173,.4)", "dot", "", "y3");
  const layout = {
    ...PLOT_BASE, height: 720, shapes, annotations: ann, barmode: "overlay",
    xaxis: { ...GRID, type: "category", rangeslider: { visible: false }, nticks: 10, anchor: "y4", showspikes: true, spikemode: "across", spikethickness: 1 },
    yaxis: { ...GRID, domain: [0.44, 1], side: "left" },
    yaxis2: { ...GRID, domain: [0.31, 0.42], showticklabels: true, nticks: 3 },
    yaxis3: { ...GRID, domain: [0.165, 0.285], range: [0, 100], tickvals: [30, 50, 70] },
    yaxis4: { ...GRID, domain: [0, 0.14] },
  };
  Plotly.react(el, tr, layout, plotCfg);
}

function barChart(el, labels, series, title, height = 300) {
  if (!window.Plotly) return;
  const colors = ["#3b82f6", "#22c55e", "#f59e0b"];
  Plotly.react(el, series.map((s, i) => ({ type: "bar", x: labels, y: s.y, name: s.name, marker: { color: colors[i % 3] } })),
    { ...PLOT_BASE, height, barmode: "group", title: { text: title, font: { size: 13, color: "#e5e9f2" }, x: 0 },
      margin: { l: 50, r: 10, t: 40, b: 40 }, legend: { orientation: "h", y: -0.18 },
      xaxis: { ...GRID, type: "category" }, yaxis: { ...GRID } }, plotCfg);
}

// ================================================================== TRANG: THỊ TRƯỜNG
async function viewMarket(el) {
  el.innerHTML = `<h1>Tổng quan thị trường</h1><div id="ix" class="grid g4">${loading()}</div>
    <div id="regime"></div><div class="card"><div id="vnchart" class="chart"></div></div>
    <div class="grid g2" style="margin-top:12px"><div class="card"><h3>Điểm cộng</h3><div id="mpros"></div></div><div class="card"><h3>Rủi ro</h3><div id="mcons"></div></div></div>
    <h2>VN30 hôm nay <span id="vn30sum" class="muted small"></span></h2><div id="vn30">${loading()}</div>`;
  const drawIdx = async () => {
    try {
      const ix = await API.indices();
      $("#ix").innerHTML = ix.map((r) => `<div class="card metric"><div class="lbl">${esc(r.symbol)}</div>
        <div class="val ${cls(r.change)}">${fmt(r.price)}</div><div class="sub ${cls(r.change)}">${fmtSigned(r.change)} (${fmtSigned(r.pct)}%)</div>
        <div class="muted small" style="margin-top:4px">▲ ${r.up ?? "–"} · ■ ${r.flat ?? "–"} · ▼ ${r.down ?? "–"} · ${fmt(r.value_bn, 0)} tỷ</div></div>`).join("");
    } catch (e) { $("#ix").innerHTML = errBox(e); }
  };
  const drawVN30 = async () => {
    try {
      const syms = await API.group("VN30");
      const b = await API.board(syms);
      const tot = b.reduce((s, r) => s + (r.foreign_net_bn || 0), 0);
      $("#vn30sum").innerHTML = `· Khối ngoại ròng <b class="${cls(tot)}">${fmtSigned(tot, 1)} tỷ</b>`;
      table($("#vn30"), [
        { key: "symbol", label: "Mã", l: true, fmt: symLink, cls: () => "sym" },
        { key: "price", label: "Giá", fmt: (v) => fmt(v), cls: (r) => priceCls(r) },
        { key: "pct", label: "%", fmt: (v) => fmtSigned(v), cls: (r) => priceCls(r) },
        { key: "volume", label: "KL", fmt: fmtInt },
        { key: "value_bn", label: "GT (tỷ)", fmt: (v) => fmt(v, 1) },
        { key: "foreign_net_bn", label: "NN ròng (tỷ)", fmt: (v) => fmtSigned(v, 1), cls: (r) => cls(r.foreign_net_bn) },
      ], b, { sortKey: "pct", maxH: 520 });
    } catch (e) { $("#vn30").innerHTML = errBox(e); }
  };
  drawIdx(); drawVN30();
  every(drawIdx, state.settings.refresh * 1000);
  every(drawVN30, Math.max(15, state.settings.refresh) * 1000);
  try {
    const m = await getMarket();
    const c = m.score >= 60 ? "v-buy" : m.score >= 45 ? "v-wait" : "v-avoid";
    $("#regime").innerHTML = `<div class="verdict ${c}"><b>Trạng thái thị trường:</b> ${esc(m.regime)} · Xu hướng VN-Index: <b>${esc(m.trend)}</b>
      · Điểm kỹ thuật ${m.score.toFixed(0)}/100 · Phiên phân phối (25 phiên): ${m.distributionDays}
      <div class="big" style="margin-top:6px">👉 Tỷ trọng cổ phiếu khuyến nghị: ${esc(m.exposure)}</div></div>`;
    priceChart($("#vnchart"), m.tech.data, null, m.tech.levels, 250);
    $("#mpros").innerHTML = list(m.tech.pros, "✅"); $("#mcons").innerHTML = list(m.tech.cons, "⚠️");
  } catch (e) { $("#regime").innerHTML = errBox(e); }
}

// ================================================================== TRANG: DANH MỤC
async function viewWatchlist(el) {
  el.innerHTML = `<h1>Danh mục theo dõi</h1>
    <div class="row"><input id="addsym" list="symlist" placeholder="Thêm mã, VD: FPT, HPG" style="min-width:240px" autocomplete="off" />
      <button id="addbtn" class="primary">＋ Thêm</button>
      <label class="chk"><input type="checkbox" id="wfund" ${state.settings.withFund ? "checked" : ""}/> Kèm phân tích cơ bản</label>
      <span id="wstatus" class="muted small"></span></div>
    <datalist id="symlist"></datalist>
    <div id="chips" class="chips"></div><div id="walerts" class="alerts"></div><div id="wtable">${loading("Đang phân tích danh mục…")}</div>
    <p class="muted small">Bấm vào mã để xem phân tích chi tiết. Bấm tiêu đề cột để sắp xếp.</p>`;
  getStocks().then((m) => { $("#symlist").innerHTML = [...m.values()].map((s) => `<option value="${s.s}">${esc(s.n)}</option>`).join(""); }).catch(() => {});
  const drawChips = () => {
    $("#chips").innerHTML = state.watchlist.map((s) => `<span class="chip">${esc(s)}<button data-rm="${s}" title="Bỏ">×</button></span>`).join("");
    $("#chips").querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
      state.watchlist = state.watchlist.filter((x) => x !== b.dataset.rm); saveWL(); drawChips(); refresh(true);
    }));
  };
  const add = async () => {
    const raw = $("#addsym").value.toUpperCase().split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!raw.length) return;
    let valid = null; try { valid = await getStocks(); } catch { /* bỏ qua kiểm tra */ }
    const bad = [];
    for (const s of raw) {
      if (valid && !valid.has(s)) { bad.push(s); continue; }
      if (!state.watchlist.includes(s)) state.watchlist.push(s);
    }
    saveWL(); $("#addsym").value = ""; drawChips();
    if (bad.length) toast(`Mã không hợp lệ: ${bad.join(", ")}`);
    refresh(true);
  };
  $("#addbtn").addEventListener("click", add);
  $("#addsym").addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  $("#wfund").addEventListener("change", (e) => { state.settings.withFund = e.target.checked; saveSettings(); refresh(true); });
  drawChips();

  let busy = false;
  async function refresh(force = false) {
    if (busy && !force) return; busy = true;
    const wl = [...state.watchlist];
    if (!wl.length) { $("#wtable").innerHTML = `<div class="card muted">Danh mục trống – hãy thêm mã.</div>`; $("#walerts").innerHTML = ""; busy = false; return; }
    try {
      const [mkt, boardArr, hist] = await Promise.all([getMarket().catch(() => null), API.board(wl), API.histories(wl)]);
      const bd = Object.fromEntries(boardArr.map((b) => [b.symbol, b]));
      const res = await mapLimit(wl, 4, async (s) => {
        if (hist[s]?.error) throw new Error(hist[s].error);
        return analyzeSymbol(s, hist[s], bd[s], state.settings.withFund, mkt);
      });
      const rows = [], alerts = [];
      res.forEach((r, i) => {
        if (!r || r.error) { rows.push({ sym: wl[i], action: `Lỗi: ${r?.error?.message || "?"}`.slice(0, 60) }); return; }
        const b = r.live || {}, t = r.tech, p = r.plan;
        rows.push({ sym: r.sym, price: b.price ?? r.bars.c.at(-1), pct: b.pct, volume: b.volume, fnet: b.foreign_net_bn, _b: b,
          trend: t.trend, tscore: t.score, fscore: r.fund?.score ?? NaN, total: r.total, action: p.action, setup: p.setup,
          zone: `${fmt(p.entryLow)}–${fmt(p.entryHigh)}`, stop: p.stop, tp1: p.tp1, tp2: p.tp2,
          signals: t.signals.map((s) => s.name).join(", ") || "–" });
        if (/^MUA/.test(p.action)) alerts.push(`<div class="alert buy">🟢 <b>${symLink(r.sym)}</b> – ${esc(p.action)} · ${esc(p.setup)}: vùng mua <b class="mono">${fmt(p.entryLow)}–${fmt(p.entryHigh)}</b>, SL <b class="mono down">${fmt(p.stop)}</b>, TP <b class="mono up">${fmt(p.tp1)} / ${fmt(p.tp2)}</b></div>`);
        for (const s of t.signals) if (s.side === "sell" && s.strength >= 2) alerts.push(`<div class="alert sell">🔴 <b>${symLink(r.sym)}</b> – ${esc(s.name)}: ${esc(s.note)}</div>`);
      });
      $("#walerts").innerHTML = alerts.join("");
      table($("#wtable"), [
        { key: "sym", label: "Mã", l: true, fmt: symLink, cls: () => "sym" },
        { key: "price", label: "Giá", fmt: (v) => fmt(v), cls: (r) => priceCls(r._b) },
        { key: "pct", label: "%", fmt: (v) => fmtSigned(v), cls: (r) => priceCls(r._b) },
        { key: "volume", label: "KL", fmt: fmtInt },
        { key: "fnet", label: "NN ròng (tỷ)", fmt: (v) => fmtSigned(v, 1), cls: (r) => cls(r.fnet) },
        { key: "trend", label: "Xu hướng", l: true },
        { key: "tscore", label: "KT", fmt: scoreBadge },
        { key: "fscore", label: "CB", fmt: scoreBadge },
        { key: "total", label: "Tổng", fmt: scoreBadge },
        { key: "action", label: "Khuyến nghị", l: true, fmt: pill },
        { key: "setup", label: "Setup", l: true },
        { key: "zone", label: "Vùng mua" },
        { key: "stop", label: "SL", fmt: (v) => fmt(v), cls: () => "down" },
        { key: "tp1", label: "TP1", fmt: (v) => fmt(v), cls: () => "up" },
        { key: "tp2", label: "TP2", fmt: (v) => fmt(v), cls: () => "up" },
        { key: "signals", label: "Tín hiệu", l: true },
      ], rows, { sortKey: "total" });
      const m = state.market;
      $("#wstatus").innerHTML = `Cập nhật ${new Date().toLocaleTimeString("vi-VN")} · tự làm mới ${state.settings.refresh}s` +
        (m && m.score < 45 ? ` · <span class="ref">⚠️ Thị trường chung yếu – hạn chế mua mới</span>` : "");
    } catch (e) { $("#wtable").innerHTML = errBox(e); }
    busy = false;
  }
  refresh(true);
  every(() => refresh(), state.settings.refresh * 1000);
}

// ================================================================== TRANG: MÁY QUÉT
async function viewScanner(el) {
  el.innerHTML = `<h1>Máy quét cơ hội</h1>
    <div class="card"><div class="row">
      <label>Phạm vi <select id="univ"><option value="WL">Danh mục theo dõi</option><option>VN30</option><option selected>VN100</option>
        <option>VNMidCap</option><option>HNX30</option><option value="HOSE">Toàn bộ HOSE (chậm)</option></select></label>
      <label>Thanh khoản tối thiểu <input id="minliq" type="number" value="10" min="0" step="5" style="width:80px"/> tỷ/phiên</label>
      <label class="chk"><input type="checkbox" id="sfund" checked/> Chấm điểm cơ bản (top 25)</label>
      <label class="chk"><input type="checkbox" id="sbuy"/> Chỉ mã có điểm mua</label>
      <button id="run" class="primary">🚀 Bắt đầu quét</button></div>
      <div class="progress"><div id="bar"></div></div><div id="pmsg" class="muted small">Quét kỹ thuật toàn bộ phạm vi → chọn top theo điểm → chấm điểm cơ bản → lập kế hoạch SL/TP.</div></div>
    <div id="sres"></div>`;
  $("#run").addEventListener("click", async () => {
    const btn = $("#run"); btn.disabled = true;
    const prog = (d, n, msg) => { $("#bar").style.width = `${(d / n) * 100}%`; $("#pmsg").textContent = `${msg} ${d}/${n}`; };
    try {
      const u = $("#univ").value, minLiq = +$("#minliq").value || 0;
      const syms = u === "WL" ? [...state.watchlist] : await API.group(u);
      const mkt = await getMarket().catch(() => null);
      prog(0, syms.length, "Đang tải dữ liệu giá…");
      const bdArr = await API.board(syms).catch(() => []);
      const bd = Object.fromEntries(bdArr.map((b) => [b.symbol, b]));
      const hist = {};
      const chunks = []; for (let i = 0; i < syms.length; i += 20) chunks.push(syms.slice(i, i + 20));
      let got = 0;
      await mapLimit(chunks, 3, async (ch) => { Object.assign(hist, await API.histories(ch)); got += ch.length; prog(got, syms.length, "Đang tải dữ liệu giá…"); });
      let res = [];
      syms.forEach((s, i) => {
        const h = hist[s]; if (!h || h.error || h.c.length < 120) return;
        const b = S.mergeLive(h, bd[s]); const n = b.c.length;
        let liq = 0; for (let k = n - 20; k < n; k++) liq += b.c[k] * b.v[k]; liq = liq / 20 / 1e6;
        if (liq < minLiq) return;
        try {
          const tech = T.analyze(b, mkt?.indexBars);
          const plan = S.tradePlan(tech, bd[s]?.board || "HSX", null, mkt?.score ?? null);
          res.push({ sym: s, bars: b, tech, plan, fund: null, total: S.overall(tech.score, null, mkt?.score ?? null).total, liq, live: bd[s] });
        } catch { /* bỏ qua */ }
        if (i % 20 === 0) prog(i + 1, syms.length, "Đang phân tích kỹ thuật…");
      });
      res.sort((a, b) => b.tech.score - a.tech.score);
      if ($("#sfund").checked) {
        res = res.slice(0, 25);
        await mapLimit(res, 3, async (r, k) => {
          const full = await analyzeSymbol(r.sym, hist[r.sym], r.live, true, mkt);
          res[k] = { ...full, liq: r.liq };
        }, (d, n) => prog(d, n, "Đang chấm điểm cơ bản…"));
      }
      const onlyBuy = $("#sbuy").checked;
      const rows = res.filter((r) => r && !r.error && (!onlyBuy || /^(MUA|CHỜ MUA)/.test(r.plan.action))).map((r) => ({
        sym: r.sym, price: r.bars.c.at(-1), total: r.total, tscore: r.tech.score, fscore: r.fund?.score ?? NaN, trend: r.tech.trend,
        stage: r.tech.stage.split("–")[0].trim(), tt: r.tech.templatePass, rs: r.tech.rs3m ?? NaN, action: r.plan.action, setup: r.plan.setup,
        zone: `${fmt(r.plan.entryLow)}–${fmt(r.plan.entryHigh)}`, stop: r.plan.stop, risk: r.plan.riskPct, tp1: r.plan.tp1, tp2: r.plan.tp2,
        rr: r.plan.rr2, pe: r.fund?.key["P/E"] ?? NaN, roe: r.fund?.key.ROE ?? NaN, liq: r.liq, signals: r.tech.signals.map((s) => s.name).join(", ") || "–",
      }));
      $("#bar").style.width = "100%";
      $("#pmsg").textContent = `Hoàn tất: ${rows.length} mã · ${new Date().toLocaleTimeString("vi-VN")}`;
      if (!rows.length) { $("#sres").innerHTML = `<div class="card">Không có mã nào có điểm mua phù hợp lúc này – đứng ngoài cũng là một vị thế.</div>`; return; }
      const warn = mkt && mkt.score < 45 ? `<div class="verdict v-avoid">Thị trường chung: <b>${esc(mkt.regime)}</b>. Tín hiệu mua có tỷ lệ thắng thấp khi VN-Index downtrend – ưu tiên quản trị rủi ro, tỷ trọng ${esc(mkt.exposure)}.</div>` : "";
      $("#sres").innerHTML = `${warn}<div class="row" style="margin:10px 0"><button id="csv">⬇️ Tải CSV</button></div><div id="stbl"></div>`;
      table($("#stbl"), [
        { key: "sym", label: "Mã", l: true, fmt: symLink, cls: () => "sym" },
        { key: "price", label: "Giá", fmt: (v) => fmt(v) },
        { key: "total", label: "Tổng", fmt: scoreBadge }, { key: "tscore", label: "KT", fmt: scoreBadge }, { key: "fscore", label: "CB", fmt: scoreBadge },
        { key: "trend", label: "Xu hướng", l: true }, { key: "stage", label: "Giai đoạn", l: true },
        { key: "tt", label: "Minervini", fmt: (v) => `${v}/8` }, { key: "rs", label: "RS 3T", fmt: (v) => fmtSigned(v, 1), cls: (r) => cls(r.rs) },
        { key: "action", label: "Khuyến nghị", l: true, fmt: pill }, { key: "setup", label: "Setup", l: true }, { key: "zone", label: "Vùng mua" },
        { key: "stop", label: "SL", fmt: (v) => fmt(v), cls: () => "down" }, { key: "risk", label: "Rủi ro", fmt: (v) => fmtPct(v) },
        { key: "tp1", label: "TP1", fmt: (v) => fmt(v), cls: () => "up" }, { key: "tp2", label: "TP2", fmt: (v) => fmt(v), cls: () => "up" },
        { key: "rr", label: "R:R", fmt: (v) => fmt(v, 1) }, { key: "pe", label: "P/E", fmt: (v) => fmt(v, 1) }, { key: "roe", label: "ROE", fmt: (v) => fmtPct(v) },
        { key: "liq", label: "TK (tỷ)", fmt: (v) => fmt(v, 1) }, { key: "signals", label: "Tín hiệu", l: true },
      ], rows, { sortKey: "total", maxH: 760 });
      $("#csv").addEventListener("click", () => {
        const keys = ["sym", "price", "total", "tscore", "fscore", "trend", "stage", "tt", "rs", "action", "setup", "zone", "stop", "risk", "tp1", "tp2", "rr", "pe", "roe", "liq", "signals"];
        const csv = "﻿" + [keys.join(","), ...rows.map((r) => keys.map((k) => { const v = r[k]; return typeof v === "number" ? (isNum(v) ? +v.toFixed(4) : "") : `"${String(v).replace(/"/g, '""')}"`; }).join(","))].join("\n");
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        a.download = `scan_${u}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.csv`; a.click();
      });
    } catch (e) { $("#sres").innerHTML = errBox(e); } finally { btn.disabled = false; }
  });
}

// ================================================================== TRANG: PHÂN TÍCH MÃ
async function viewStock(el, sym) {
  sym = (sym || LS.get("vsp_last", "FPT")).toUpperCase();
  el.innerHTML = `<div class="row" style="margin-bottom:10px"><input id="sq" list="symlist2" value="${esc(sym)}" placeholder="Nhập mã…" style="width:160px;text-transform:uppercase" autocomplete="off"/>
    <button id="sgo" class="primary">Phân tích</button><button id="sadd">⭐ Thêm vào danh mục</button></div><datalist id="symlist2"></datalist><div id="sbody">${loading(`Đang phân tích ${sym}…`)}</div>`;
  const go = () => { const v = $("#sq").value.trim().toUpperCase(); if (v) location.hash = `#/stock/${encodeURIComponent(v)}`; };
  $("#sgo").addEventListener("click", go);
  $("#sq").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  $("#sadd").addEventListener("click", () => { if (!state.watchlist.includes(sym)) { state.watchlist.push(sym); saveWL(); } toast(`Đã thêm ${sym} vào danh mục`); });
  let stocks;
  try { stocks = await getStocks(); $("#symlist2").innerHTML = [...stocks.values()].map((s) => `<option value="${s.s}">${esc(s.n)}</option>`).join(""); } catch { stocks = null; }
  const info = stocks?.get(sym);
  if (stocks && !info) { $("#sbody").innerHTML = errBox(`Không tìm thấy mã ${sym} (chỉ hỗ trợ cổ phiếu niêm yết HOSE/HNX/UPCOM).`); return; }
  LS.set("vsp_last", sym);
  let r;
  try {
    const [mkt, bArr, bars] = await Promise.all([getMarket().catch(() => null), API.board([sym]).catch(() => []), API.history(sym, 900)]);
    r = await analyzeSymbol(sym, bars, bArr[0], true, mkt);
  } catch (e) { $("#sbody").innerHTML = errBox(e); return; }
  const { tech: t, fund: fr, plan: p } = r, x = t.data, n = x.c.length, live = r.live || {};
  const m = state.market;
  const sector = ICB[info?.i] || "–";
  $("#sbody").innerHTML = `
    <h1 style="margin-bottom:2px">${esc(sym)} <span class="muted" style="font-weight:500;font-size:16px">${esc(info?.f || info?.n || live.name || "")}</span></h1>
    <div class="muted small">Sàn ${esc(info?.b || live.board || "–")} · Ngành: ${esc(sector)} · Phiên: ${esc(live.session || "–")}</div>
    <div class="grid g6" style="margin-top:12px" id="hdr"></div>
    <div class="verdict ${verdictCls(p.action)}">
      <div class="big">${esc(r.label)} · Điểm tổng hợp ${scoreBadge(r.total)}
        <span class="muted small" style="font-weight:500">(Kỹ thuật ${fmt(t.score, 0)} · Cơ bản ${fr ? fmt(fr.score, 0) : "–"} · Thị trường ${m ? fmt(m.score, 0) : "–"})</span></div>
      <div style="margin-top:6px;font-size:15px">Khuyến nghị: ${pill(p.action)} · Setup: <b>${esc(p.setup)}</b></div>
      <div class="plan"><span>🎯 Vùng mua <b>${fmt(p.entryLow)} – ${fmt(p.entryHigh)}</b></span><span>🛑 SL <b class="down">${fmt(p.stop)}</b> (−${fmtPct(p.riskPct)})</span>
        <span>✅ TP1 <b class="up">${fmt(p.tp1)}</b> (R:R ${fmt(p.rr1, 1)})</span><span>TP2 <b class="up">${fmt(p.tp2)}</b> (R:R ${fmt(p.rr2, 1)})</span></div>
      <div class="muted small" style="margin-top:6px">${esc(p.trailing)}</div>
      <ul class="list small muted">${p.notes.map((nn) => `<li>${esc(nn)}</li>`).join("")}</ul></div>
    <div class="tabs" id="stabs"><button data-t="tech" class="active">📉 Kỹ thuật</button><button data-t="fin">📑 Báo cáo tài chính</button>
      <button data-t="val">💰 Định giá</button><button data-t="plan">🧮 Kế hoạch & khối lượng</button></div><div id="tabc"></div>`;

  const drawHeader = (lv) => {
    const price = lv.price ?? x.c[n - 1];
    $("#hdr").innerHTML = [
      ["Giá", `<span class="${priceCls(lv)}">${fmt(price)}</span>`, `<span class="${priceCls(lv)}">${fmtSigned(lv.change)} (${fmtSigned(lv.pct)}%)</span>`],
      ["KL khớp", fmtInt(lv.volume), `${fmt(x.vol_ratio[n - 1], 1)}× TB20`],
      ["Khối ngoại ròng", `<span class="${cls(lv.foreign_net_bn)}">${fmtSigned(lv.foreign_net_bn, 1)}</span>`, "tỷ đồng"],
      ["P/E · P/B", fr ? `${fmt(fr.key["P/E"], 1)} · ${fmt(fr.key["P/B"], 2)}` : "–", fr ? `EPS ${fmtInt(fr.key["EPS TTM (đ)"])} đ` : ""],
      ["ROE", fr ? fmtPct(fr.key.ROE) : "–", fr ? `ROA ${fmtPct(fr.key.ROA)}` : ""],
      ["Vốn hóa", fr ? `${fmtInt(fr.key["Vốn hóa (tỷ đ)"])}` : "–", "tỷ đồng"],
    ].map(([a, b, c]) => `<div class="card metric"><div class="lbl">${a}</div><div class="val">${b}</div><div class="sub muted">${c}</div></div>`).join("");
  };
  drawHeader(live);
  every(async () => { try { const b = await API.board([sym]); if (b[0]) drawHeader(b[0]); } catch { /* giữ nguyên */ } }, state.settings.refresh * 1000);

  const tabs = {
    tech: (c) => {
      const sup = t.levels.filter((l) => l.kind === "support").slice(-3).reverse(), res = t.levels.filter((l) => l.kind === "resistance").slice(0, 3);
      c.innerHTML = `<div class="row" style="margin-bottom:8px"><span class="muted small">Khung:</span>${[60, 120, 180, 250, 500].map((b) => `<button data-b="${b}" ${b === 180 ? 'class="primary"' : ""}>${b}</button>`).join("")}</div>
        <div class="card"><div id="pchart" class="chart"></div></div>
        <div class="grid g3" style="margin-top:12px">
          <div class="card"><h3>Xu hướng</h3><b>${esc(t.trend)}</b><br>Ngắn hạn: ${esc(t.trendShort)}<br>Trung hạn: ${esc(t.trendMid)}<br>Dài hạn: ${esc(t.trendLong)}<br><span class="muted">${esc(t.stage)}</span></div>
          <div class="card"><h3>Động lượng</h3>RSI <b>${fmt(t.rsi, 0)}</b> · ADX <b>${fmt(t.adx, 0)}</b><br>Trend Template: <b>${t.templatePass}/8</b><br>
            RS vs VN-Index (3T): <b class="${cls(t.rs3m)}">${fmtSigned(t.rs3m, 1)}</b> điểm %<br>ATR: ${fmt(x.atr[n - 1])} (${fmt(x.atr_pct[n - 1], 1)}%/phiên)</div>
          <div class="card"><h3>Vùng giá</h3>Hỗ trợ: <b class="mono">${sup.map((l) => fmt(l.price)).join(", ") || "–"}</b><br>Kháng cự: <b class="mono">${res.map((l) => fmt(l.price)).join(", ") || "–"}</b><br>
            Đỉnh/đáy 52T: <span class="mono">${fmt(x.hh52w[n - 1])} / ${fmt(x.ll52w[n - 1])}</span><br>Thanh khoản TB20: ${fmt(t.avgValue, 1)} tỷ</div></div>
        ${t.signals.length ? `<div class="card" style="margin-top:12px"><h3>Tín hiệu hiện tại</h3><ul class="list">${t.signals.map((s) => `<li>${{ buy: "🟢", sell: "🔴", watch: "🟡" }[s.side]} <b>${esc(s.name)}</b> – ${esc(s.note)}</li>`).join("")}</ul></div>` : ""}
        <div class="grid g2" style="margin-top:12px"><div class="card"><h3>Điểm cộng kỹ thuật</h3>${list(t.pros, "✅")}</div><div class="card"><h3>Điểm trừ kỹ thuật</h3>${list(t.cons, "⚠️")}</div></div>`;
      const draw = (b) => priceChart($("#pchart"), x, p, t.levels, b);
      draw(180);
      c.querySelectorAll("[data-b]").forEach((btn) => btn.addEventListener("click", () => {
        c.querySelectorAll("[data-b]").forEach((q) => q.classList.remove("primary")); btn.classList.add("primary"); draw(+btn.dataset.b);
      }));
    },
    fin: (c) => {
      if (!fr) { c.innerHTML = errBox("Không tải được BCTC cho mã này."); return; }
      const g = fr.growth, q = fr.quarterly.slice(-8);
      const pr = (v) => fmtPct(v), num = (v) => fmt(v, 1);
      const growthRows = [["Doanh thu (tỷ)", "revenue", num], ["LNST cty mẹ (tỷ)", "npParent", num], ...(fr.isBank ? [] : [["Biên LN gộp", "grossMargin", pr]]),
        ["Tăng trưởng DT", "revGrowth", (v) => fmtPct(v, 1, true)], ["Tăng trưởng LN", "npGrowth", (v) => fmtPct(v, 1, true)], ["Biên LN ròng", "netMargin", pr],
        ["ROE (cuối kỳ)", "roe", pr], ["Nợ/VCSH", "de", (v) => fmt(v, 2)], ["CFO/LNST", "cfoNp", (v) => fmt(v, 2)]];
      const tblT = (periods, rows, getter) => `<div class="tbl-wrap"><table><thead><tr><th class="l">Chỉ tiêu</th>${periods.map((p_) => `<th>${esc(p_)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map(([lab, k, f]) => `<tr><td class="l">${esc(lab)}</td>${getter(k).map((v) => `<td class="num ${/Tăng|YoY/.test(lab) ? cls(v) : ""}">${f(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      const kv = Object.entries(fr.key).map(([k, v]) => {
        const isP = /ROE|ROA|CAGR|YoY|cổ tức|NIM|NPL|CIR|LDR|Bao phủ/.test(k);
        return `<tr><td>${esc(k)}</td><td>${isP ? fmtPct(v) : /Số CP|EPS|BVPS|Vốn hóa/.test(k) ? fmtInt(v) : fmt(v, 2)}</td></tr>`;
      }).join("");
      c.innerHTML = `<div class="grid g2"><div class="card"><div id="qchart"></div></div><div class="card"><div id="ychart"></div></div></div>
        <h2>Tăng trưởng & hiệu quả theo năm</h2>${tblT(g.map((r) => r.period), growthRows, (k) => g.map((r) => r[k]))}
        <h2>Kết quả theo quý</h2>${tblT(q.map((r) => r.period), [["Doanh thu (tỷ)", "revenue", num], ["LNST cty mẹ (tỷ)", "npParent", num],
          ["DT YoY", "revYoY", (v) => fmtPct(v, 1, true)], ["LN YoY", "npYoY", (v) => fmtPct(v, 1, true)]], (k) => q.map((r) => r[k]))}
        <h2>Báo cáo chi tiết</h2><div class="row"><select id="fsec"><option value="is">Kết quả kinh doanh</option><option value="bs">Cân đối kế toán</option><option value="cf">Lưu chuyển tiền tệ</option></select>
          <select id="fper"><option value="y">Theo năm</option><option value="q">Theo quý</option></select><span class="muted small">Đơn vị: tỷ đồng (EPS: đồng)</span></div>
        <div id="fstmt" style="margin-top:8px"></div>
        <div class="grid g2" style="margin-top:12px"><div class="card"><h3>Điểm mạnh</h3>${list(fr.pros, "✅")}</div><div class="card"><h3>Điểm yếu</h3>${list(fr.cons, "⚠️")}</div></div>
        <div class="grid g2" style="margin-top:12px"><div class="card"><h3>Piotroski F-Score: ${fr.fscore ?? "–"}/9</h3><ul class="list">${fr.fscoreDetail.map(([nm, ok]) => `<li>${ok ? "✅" : "❌"} ${esc(nm)}</li>`).join("")}</ul></div>
          <div class="card"><h3>Chỉ số chính</h3><table class="kv">${kv}</table></div></div>`;
      barChart($("#qchart"), q.map((r) => r.period), [{ name: "Doanh thu", y: q.map((r) => r.revenue) }, { name: "LNST cty mẹ", y: q.map((r) => r.npParent) }], "Doanh thu & lợi nhuận theo quý (tỷ)");
      barChart($("#ychart"), g.map((r) => r.period), [{ name: "Doanh thu", y: g.map((r) => r.revenue) }, { name: "LNST cty mẹ", y: g.map((r) => r.npParent) }], "Theo năm (tỷ)");
      const drawStmt = () => {
        const d = F.readable(r.finData, $("#fsec").value, $("#fper").value === "q");
        $("#fstmt").innerHTML = `<div class="tbl-wrap" style="max-height:520px"><table><thead><tr><th class="l">Chỉ tiêu</th>${d.periods.map((p_) => `<th>${esc(p_)}</th>`).join("")}</tr></thead><tbody>${
          d.rows.map((row) => `<tr><td class="l" style="padding-left:${10 + (row.level - 1) * 16}px;${row.level === 1 ? "font-weight:600" : "color:var(--muted)"}">${esc(row.name)}</td>${row.values.map((v) => `<td class="num">${fmt(v, 1)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      };
      $("#fsec").addEventListener("change", drawStmt); $("#fper").addEventListener("change", drawStmt); drawStmt();
    },
    val: (c) => {
      if (!fr) { c.innerHTML = errBox("Không có dữ liệu định giá."); return; }
      const v = fr.valuation, price = live.price ?? x.c[n - 1];
      c.innerHTML = `<div class="grid g3">
        <div class="card metric"><div class="lbl">Giá trị hợp lý (thận trọng)</div><div class="val">${fmt(v.fairValue)}</div><div class="sub ${cls(v.upside)}">${fmtPct(v.upside, 1, true)} so với giá</div></div>
        <div class="card metric"><div class="lbl">Kịch bản cơ sở (trung vị 5 năm)</div><div class="val">${fmt(v.fairValueBase)}</div><div class="sub ${cls(v.fairValueBase / price - 1)}">${isNum(v.fairValueBase) ? fmtPct(v.fairValueBase / price - 1, 1, true) : "–"}</div></div>
        <div class="card metric"><div class="lbl">Chỉ số Graham</div><div class="val">${fmt(v.graham)}</div><div class="sub muted">PEG ${fmt(v.peg)}</div></div></div>
        <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th class="l">Phương pháp</th><th>Bội số</th><th>Giá trị (nghìn đ)</th></tr></thead><tbody>
          <tr><td class="l">P/E hiện tại</td><td class="num">${fmt(v.pe, 1)} (phân vị ${fmtPct(v.pePct, 0)} trong 5 năm)</td><td>–</td></tr>
          <tr><td class="l">P/E phân vị 25% × EPS TTM</td><td class="num">${fmt(v.peP25, 1)}</td><td class="num">${fmt(v.fvPe)}</td></tr>
          <tr><td class="l">P/B hiện tại</td><td class="num">${fmt(v.pb, 2)} (phân vị ${fmtPct(v.pbPct, 0)})</td><td>–</td></tr>
          <tr><td class="l">P/B phân vị 25% × BVPS</td><td class="num">${fmt(v.pbP25, 2)}</td><td class="num">${fmt(v.fvPb)}</td></tr>
          <tr><td class="l">Graham √(22.5 × EPS × BVPS)</td><td>–</td><td class="num">${fmt(v.graham)}</td></tr>
          <tr><td class="l">P/E · P/B trung vị 5 năm</td><td class="num">${fmt(v.peMedian, 1)} · ${fmt(v.pbMedian, 2)}</td><td class="num">${fmt(v.fairValueBase)}</td></tr></tbody></table></div>
        <div class="card" style="margin-top:12px"><div id="vchart"></div></div>
        <p class="muted small">Định giá theo bội số lịch sử giả định thị trường sẽ định giá lại về vùng trung bình. Nếu triển vọng ngành/doanh nghiệp đã thay đổi, bội số thấp có thể là "bẫy giá trị".</p>`;
      if (v.peHist && window.Plotly) {
        Plotly.react($("#vchart"), [
          { type: "scatter", mode: "lines+markers", x: v.peHist.map((h) => h.p), y: v.peHist.map((h) => h.pe), name: "P/E", line: { color: "#3b82f6" } },
          { type: "scatter", mode: "lines+markers", x: v.peHist.map((h) => h.p), y: v.peHist.map((h) => h.pb), name: "P/B", yaxis: "y2", line: { color: "#f59e0b" } },
        ], { ...PLOT_BASE, height: 320, margin: { l: 50, r: 50, t: 40, b: 40 }, title: { text: "P/E, P/B lịch sử (TTM theo quý)", font: { size: 13, color: "#e5e9f2" }, x: 0 },
          xaxis: { ...GRID, type: "category" }, yaxis: { ...GRID, title: "P/E" }, yaxis2: { overlaying: "y", side: "right", title: "P/B", showgrid: false } }, plotCfg);
      }
    },
    plan: (c) => {
      const st = state.settings, em = (p.entryLow + p.entryHigh) / 2;
      c.innerHTML = `<div class="card"><div class="row">
          <label>Giá mua <input id="pe_" type="number" step="0.05" value="${em.toFixed(2)}" style="width:100px"/></label>
          <label>Cắt lỗ <input id="ps_" type="number" step="0.05" value="${p.stop.toFixed(2)}" style="width:100px"/></label>
          <label>Rủi ro (% vốn) <input id="pr_" type="number" step="0.25" value="${st.risk}" style="width:80px"/></label>
          <span class="muted small">Vốn: ${fmtInt(st.capital)} đ · Tối đa ${st.maxAlloc}%/mã (đổi trong ⚙️ Quản trị vốn)</span></div>
        <div class="grid g4" id="psz" style="margin-top:12px"></div></div>
        <div class="card" style="margin-top:12px"><h3>Kịch bản giao dịch ${esc(sym)}</h3><ol>
          <li><b>Mua:</b> chia 2 lần trong vùng ${fmt(p.entryLow)}–${fmt(p.entryHigh)}; chỉ mua khi phiên có lực cầu xác nhận (đóng cửa trên MA20, KL ≥ TB20). Không mua đuổi khi giá vượt ${fmt(p.entryHigh * 1.03)}.</li>
          <li><b>Cắt lỗ:</b> đóng cửa dưới <b class="down">${fmt(p.stop)}</b> → bán toàn bộ, không bình quân giá xuống.</li>
          <li><b>Chốt lời:</b> TP1 <b class="up">${fmt(p.tp1)}</b> bán 30–50%, dời SL về giá vốn; TP2 <b class="up">${fmt(p.tp2)}</b> bán tiếp; phần còn lại trailing theo MA20.</li>
          <li><b>Vô hiệu kịch bản:</b> VN-Index gãy hỗ trợ kèm thanh khoản lớn, hoặc xuất hiện tín hiệu 🔴 trên mã.</li></ol></div>`;
      const calc = () => {
        const ps = S.positionSize(st.capital, (+$("#pr_").value || 0) / 100, +$("#pe_").value, +$("#ps_").value, st.maxAlloc / 100);
        $("#psz").innerHTML = [["Khối lượng mua", `${fmtInt(ps.shares)} cp`], ["Giá trị lệnh", `${fmt(ps.value / 1e6, 1)} tr`], ["Tỷ trọng", fmtPct(ps.alloc)],
          ["Lỗ tối đa nếu chạm SL", `${fmt(ps.risk / 1e6, 2)} tr`]].map(([a, b]) => `<div class="metric"><div class="lbl">${a}</div><div class="val">${b}</div></div>`).join("") +
          (ps.capped ? `<div class="muted small" style="grid-column:1/-1">Khối lượng đã bị giới hạn bởi tỷ trọng tối đa ${st.maxAlloc}%/mã.</div>` : "");
      };
      c.querySelectorAll("input").forEach((i) => i.addEventListener("input", calc)); calc();
    },
  };
  const show = (k) => {
    $("#stabs").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.t === k));
    tabs[k]($("#tabc"));
  };
  $("#stabs").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => show(b.dataset.t)));
  show("tech");
}

// ================================================================== TRANG: QUẢN TRỊ VỐN
function viewSettings(el) {
  const s = state.settings;
  el.innerHTML = `<h1>Quản trị vốn & cài đặt</h1><div class="card" style="max-width:640px">
    <div class="grid g2">
      <label>Tổng vốn (đồng)<br><input id="cap" type="number" step="10000000" value="${s.capital}" style="width:100%"/></label>
      <label>Rủi ro tối đa mỗi lệnh (% vốn)<br><input id="rsk" type="number" step="0.25" min="0.25" max="5" value="${s.risk}" style="width:100%"/></label>
      <label>Tỷ trọng tối đa 1 mã (%)<br><input id="mal" type="number" step="5" min="5" max="100" value="${s.maxAlloc}" style="width:100%"/></label>
      <label>Làm mới bảng giá (giây)<br><select id="rfr" style="width:100%">${[5, 10, 15, 30, 60].map((v) => `<option ${v === s.refresh ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    </div><div class="row" style="margin-top:12px"><button id="sv" class="primary">Lưu cài đặt</button></div></div>
    <h2>Sao lưu / chuyển danh mục sang thiết bị khác</h2>
    <div class="card" style="max-width:640px"><p class="muted small">Danh mục được lưu trong trình duyệt này. Sao chép chuỗi dưới đây và dán vào trang này trên máy khác để chuyển danh mục.</p>
      <textarea id="wlio" rows="3" style="width:100%;font:inherit;color:var(--text);background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:8px">${state.watchlist.join(", ")}</textarea>
      <div class="row" style="margin-top:8px"><button id="wlcopy">📋 Sao chép</button><button id="wlload">⬆️ Nạp danh mục từ ô trên</button></div></div>`;
  $("#sv").addEventListener("click", () => {
    Object.assign(s, { capital: +$("#cap").value || s.capital, risk: +$("#rsk").value || s.risk, maxAlloc: +$("#mal").value || s.maxAlloc, refresh: +$("#rfr").value });
    saveSettings(); toast("Đã lưu cài đặt");
  });
  $("#wlcopy").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("#wlio").value); toast("Đã sao chép"); } catch { $("#wlio").select(); } });
  $("#wlload").addEventListener("click", () => {
    const arr = $("#wlio").value.toUpperCase().split(/[,;\s]+/).filter((v) => /^[A-Z0-9]{2,12}$/.test(v));
    state.watchlist = [...new Set(arr)]; saveWL(); toast(`Đã nạp ${state.watchlist.length} mã`);
  });
}

// ================================================================== TRANG: PHƯƠNG PHÁP
async function viewMethod(el) {
  el.innerHTML = loading();
  try {
    const [md, { marked }] = await Promise.all([fetch("PHUONG_PHAP.md").then((r) => r.text()), import("https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js")]);
    el.innerHTML = `<div class="method" style="max-width:900px"><h1>Phương pháp & cách đọc kết quả</h1>${marked.parse(md)}</div>`;
  } catch (e) { el.innerHTML = errBox(e); }
}

// ------------------------------------------------------------------ router
const VIEWS = { market: viewMarket, watchlist: viewWatchlist, scanner: viewScanner, stock: viewStock, settings: viewSettings, method: viewMethod };
async function route() {
  clearTimers();
  const [, view = "watchlist", arg] = (location.hash || "#/watchlist").split("/");
  const v = VIEWS[view] ? view : "watchlist";
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === v));
  const el = $("#view");
  if (window.Plotly) el.querySelectorAll(".js-plotly-plot").forEach((p) => Plotly.purge(p));
  window.scrollTo(0, 0);
  try { await VIEWS[v](el, arg ? decodeURIComponent(arg) : undefined); } catch (e) { el.innerHTML = errBox(e); }
}
window.addEventListener("hashchange", route);
updateBadge(); setInterval(updateBadge, 30e3);
getMarket().catch(() => {});
route();
