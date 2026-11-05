// Chỉ báo kỹ thuật – mảng số, NaN cho giá trị chưa đủ dữ liệu
export const isNum = (v) => typeof v === "number" && Number.isFinite(v);
export const last = (a, k = 1) => a[a.length - k];
export const lastValid = (a) => { for (let i = a.length - 1; i >= 0; i--) if (isNum(a[i])) return a[i]; return NaN; };

export function sma(a, n) {
  const out = new Array(a.length).fill(NaN);
  let s = 0, cnt = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i]; cnt++;
    if (i >= n) { s -= a[i - n]; cnt--; }
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

// EMA kiểu pandas ewm(adjust=False, min_periods=n), bỏ qua NaN đầu chuỗi
export function ewm(a, alpha, minPeriods = 1) {
  const out = new Array(a.length).fill(NaN);
  let y = NaN, seen = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (!isNum(x)) { if (seen) out[i] = seen >= minPeriods ? y : NaN; continue; }
    y = seen === 0 ? x : alpha * x + (1 - alpha) * y;
    seen++;
    if (seen >= minPeriods) out[i] = y;
  }
  return out;
}
export const ema = (a, n) => ewm(a, 2 / (n + 1), n);
export const wilder = (a, n) => ewm(a, 1 / n, n);

export const rollMax = (a, n, minP = n) => a.map((_, i) => (i + 1 < minP ? NaN : Math.max(...a.slice(Math.max(0, i - n + 1), i + 1))));
export const rollMin = (a, n, minP = n) => a.map((_, i) => (i + 1 < minP ? NaN : Math.min(...a.slice(Math.max(0, i - n + 1), i + 1))));

export function rollStd(a, n) {
  return a.map((_, i) => {
    if (i < n - 1) return NaN;
    const w = a.slice(i - n + 1, i + 1);
    const m = w.reduce((s, x) => s + x, 0) / n;
    return Math.sqrt(w.reduce((s, x) => s + (x - m) ** 2, 0) / n);
  });
}

export function rsi(c, n = 14) {
  const up = [NaN], dn = [NaN];
  for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1]; up.push(Math.max(d, 0)); dn.push(Math.max(-d, 0)); }
  const au = wilder(up, n), ad = wilder(dn, n);
  return au.map((u, i) => (!isNum(u) || !isNum(ad[i]) ? NaN : ad[i] === 0 ? 100 : 100 - 100 / (1 + u / ad[i])));
}

export function macd(c, f = 12, s = 26, sig = 9) {
  const ef = ema(c, f), es = ema(c, s);
  const m = ef.map((v, i) => v - es[i]);
  const sg = ewm(m, 2 / (sig + 1), 1);
  return { macd: m, signal: sg, hist: m.map((v, i) => v - sg[i]) };
}

export function trueRange(h, l, c) {
  return h.map((_, i) => (i === 0 ? h[0] - l[0] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))));
}

export function adx(h, l, c, n = 14) {
  const pdm = [0], mdm = [0];
  for (let i = 1; i < h.length; i++) {
    const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
    pdm.push(up > dn && up > 0 ? up : 0); mdm.push(dn > up && dn > 0 ? dn : 0);
  }
  const tr = wilder(trueRange(h, l, c), n);
  const pdi = wilder(pdm, n).map((v, i) => (100 * v) / tr[i]);
  const mdi = wilder(mdm, n).map((v, i) => (100 * v) / tr[i]);
  const dx = pdi.map((p, i) => (p + mdi[i] === 0 ? NaN : (100 * Math.abs(p - mdi[i])) / (p + mdi[i])));
  return { adx: wilder(dx, n), pdi, mdi };
}

export function obv(c, v) {
  let s = 0;
  return c.map((x, i) => { if (i > 0) s += Math.sign(x - c[i - 1]) * v[i]; return s; });
}

export function mfi(h, l, c, v, n = 14) {
  const tp = c.map((x, i) => (h[i] + l[i] + x) / 3);
  return tp.map((_, i) => {
    if (i < n) return NaN;
    let pos = 0, neg = 0;
    for (let j = i - n + 1; j <= i; j++) {
      const mf = tp[j] * v[j];
      if (tp[j] > tp[j - 1]) pos += mf; else if (tp[j] < tp[j - 1]) neg += mf;
    }
    return neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  });
}

/** Thêm toàn bộ chỉ báo. bars = {t,o,h,l,c,v} */
export function addAll(b) {
  const { h, l, c, v } = b;
  const x = { ...b };
  for (const n of [10, 20, 50, 100, 150, 200]) x[`ma${n}`] = sma(c, n);
  x.ema9 = ema(c, 9); x.ema21 = ema(c, 21);
  x.rsi = rsi(c);
  Object.assign(x, (({ macd: m, signal, hist }) => ({ macd: m, macd_sig: signal, macd_hist: hist }))(macd(c)));
  const sd = rollStd(c, 20);
  x.bb_mid = x.ma20; x.bb_up = x.ma20.map((m, i) => m + 2 * sd[i]); x.bb_lo = x.ma20.map((m, i) => m - 2 * sd[i]);
  x.bb_width = x.bb_up.map((u, i) => (u - x.bb_lo[i]) / x.bb_mid[i]);
  x.atr = wilder(trueRange(h, l, c), 14);
  x.atr_pct = x.atr.map((a, i) => (a / c[i]) * 100);
  Object.assign(x, adx(h, l, c));
  x.obv = obv(c, v);
  x.mfi = mfi(h, l, c, v);
  x.vol_ma20 = sma(v, 20);
  x.vol_ratio = v.map((vv, i) => vv / x.vol_ma20[i]);
  x.hh20 = rollMax(h, 20); x.ll20 = rollMin(l, 20);
  x.hh52w = rollMax(h, 250, 60); x.ll52w = rollMin(l, 250, 60);
  return x;
}

/** Hỗ trợ/kháng cự: gom cụm các đỉnh/đáy swing */
export function supportResistance(x, lookback = 250, tolPct = 1.5, maxLevels = 6) {
  const n = x.c.length, start = Math.max(0, n - lookback);
  if (n - start < 30) return [];
  const h = x.h.slice(start), l = x.l.slice(start), k = 4, pts = [];
  for (let i = k; i < h.length - k; i++) {
    const wh = h.slice(i - k, i + k + 1), wl = l.slice(i - k, i + k + 1);
    if (h[i] === Math.max(...wh)) pts.push(h[i]);
    if (l[i] === Math.min(...wl)) pts.push(l[i]);
  }
  pts.sort((a, b) => a - b);
  const clusters = [];
  for (const p of pts) {
    const lastC = clusters[clusters.length - 1];
    const mean = lastC ? lastC.reduce((s, q) => s + q, 0) / lastC.length : 0;
    if (lastC && Math.abs(p / mean - 1) * 100 <= tolPct) lastC.push(p); else clusters.push([p]);
  }
  const lc = x.c[n - 1];
  const levels = clusters.map((cl) => ({ price: cl.reduce((s, q) => s + q, 0) / cl.length, touches: cl.length }));
  levels.forEach((lv) => { lv.kind = lv.price < lc ? "support" : "resistance"; });
  levels.sort((a, b) => b.touches - a.touches || Math.abs(a.price / lc - 1) - Math.abs(b.price / lc - 1));
  return levels.slice(0, maxLevels * 2).sort((a, b) => a.price - b.price);
}
