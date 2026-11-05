// Kế hoạch giao dịch: vùng mua, SL, TP, khối lượng, điểm tổng hợp
const PRICE_LIMIT = { HSX: 0.07, HOSE: 0.07, HNX: 0.1, UPCOM: 0.15 };
const MAX_LOSS = 0.08;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export function tick(price, board = "HSX") {
  if (board === "HNX" || board === "UPCOM") return 0.1;
  return price < 10 ? 0.01 : price < 50 ? 0.05 : 0.1;
}
export function rnd(p, board = "HSX", mode = "near") {
  const t = tick(p, board);
  const f = { near: Math.round, down: Math.floor, up: Math.ceil }[mode];
  return Math.round(f(p / t + 1e-9) * t * 100) / 100;
}

/** Ngày giao dịch hiện tại theo giờ VN dưới dạng epoch giây 00:00 UTC (khớp định dạng dchart) */
export function todayKey() {
  const vn = new Date(Date.now() + 7 * 3600 * 1000);
  return { t: Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) / 1000, wd: vn.getUTCDay() };
}

/** Gắn giá realtime vào nến cuối */
export function mergeLive(b, live) {
  if (!live || !live.price) return b;
  const x = { t: [...b.t], o: [...b.o], h: [...b.h], l: [...b.l], c: [...b.c], v: [...b.v] };
  const n = x.t.length, { t, wd } = todayKey();
  if (x.t[n - 1] === t) {
    x.c[n - 1] = live.price;
    if (live.high) x.h[n - 1] = Math.max(x.h[n - 1], live.high);
    if (live.low) x.l[n - 1] = Math.min(x.l[n - 1], live.low);
    if (live.volume) x.v[n - 1] = Math.max(x.v[n - 1], live.volume);
  } else if (wd >= 1 && wd <= 5 && live.volume && t > x.t[n - 1]) {
    x.t.push(t); x.o.push(live.open || live.price); x.h.push(live.high || live.price);
    x.l.push(live.low || live.price); x.c.push(live.price); x.v.push(live.volume);
  }
  return x;
}

export function tradePlan(T, board = "HSX", fundScore = null, marketScore = null) {
  const x = T.data, n = x.c.length, c = x.c[n - 1];
  const atr = isNum(x.atr[n - 1]) ? x.atr[n - 1] : c * 0.03;
  const ma20 = isNum(x.ma20[n - 1]) ? x.ma20[n - 1] : c;
  const ma50 = isNum(x.ma50[n - 1]) ? x.ma50[n - 1] : c;
  const notes = [];
  const buys = T.signals.filter((s) => s.side === "buy"), sells = T.signals.filter((s) => s.side === "sell");
  const sup = T.levels.filter((l) => l.price < c * 0.995), res = T.levels.filter((l) => l.price > c * 1.005);
  const low20 = Math.min(...x.l.slice(-20));
  const nearSup = sup.length ? Math.max(...sup.map((l) => l.price)) : Math.min(low20, ma50);
  const resS = res.map((l) => l.price).sort((a, b) => a - b);
  const names = new Set(buys.map((s) => s.name));

  let setup, eLow, eHigh, baseStop;
  if (names.has("Breakout nền giá")) {
    setup = "Breakout"; eLow = c * 0.99; eHigh = c * 1.02;
    baseStop = Math.min(x.hh20[n - 2] - 0.5 * atr, c - 1.5 * atr);
  } else if (names.has("Pullback về MA20 trong uptrend") || names.has("Test MA50 với KL thấp")) {
    setup = "Pullback";
    const anchor = names.has("Pullback về MA20 trong uptrend") ? ma20 : ma50;
    eLow = anchor * 0.99; eHigh = Math.max(c, anchor * 1.02);
    baseStop = Math.min(anchor - 1.2 * atr, nearSup - 0.3 * atr);
  } else if (T.score >= 60) {
    setup = "Tích cực – chờ nhịp chỉnh về hỗ trợ";
    const a = Math.max(ma20, nearSup); eLow = a * 0.995; eHigh = a * 1.02;
    baseStop = Math.min(ma50, nearSup) - 0.5 * atr;
  } else {
    setup = "Chưa có điểm mua"; eLow = nearSup * 0.995; eHigh = nearSup * 1.02; baseStop = nearSup - atr;
  }
  const em = (eLow + eHigh) / 2;
  let stop = Math.max(baseStop, em * (1 - MAX_LOSS));
  stop = Math.min(stop, em - atr);
  const risk = em - stop, riskPct = risk / em;

  const tp1c = resS.filter((p) => p * 0.99 >= em + 1.5 * risk);
  const tp1 = tp1c.length ? tp1c[0] * 0.99 : em + 1.5 * risk;
  const tp2c = resS.filter((p) => p * 0.99 >= Math.max(tp1 * 1.03, em + 2.5 * risk));
  let tp2 = tp2c.length ? tp2c[0] * 0.99 : em + 3 * risk;
  tp2 = Math.max(tp2, tp1 + risk);
  if (resS.length && resS[0] < em + 1.5 * risk) notes.push(`Kháng cự gần ${resS[0].toFixed(2)} nằm trước TP1 – có thể bị cản, cân nhắc chốt một phần tại đây`);

  const weak = marketScore != null && marketScore < 45;
  const inZone = eLow <= c && c <= eHigh * 1.005;
  let action = "THEO DÕI – chưa có setup";
  if (sells.length && sells.reduce((a, s) => a + s.strength, 0) >= 3) action = "BÁN / GIẢM TỶ TRỌNG";
  else if (T.score < 40 || T.trend === "Giảm" || T.trend === "Giảm mạnh") action = "TRÁNH";
  else if (buys.length && T.score >= 60 && (fundScore == null || fundScore >= 45)) {
    if (weak) {
      action = inZone && T.score >= 70 ? "MUA THĂM DÒ (≤30% vị thế)" : "CHỜ MUA – thị trường chung yếu";
      notes.push("Thị trường chung yếu – tín hiệu mua dễ thất bại, chỉ giải ngân thăm dò, SL chặt");
    } else action = inZone ? "MUA" : "CHỜ MUA (đặt lệnh tại vùng mua)";
  } else if (T.score >= 55) action = "THEO DÕI – chờ điểm mua";
  if (fundScore != null && fundScore < 40 && /^(MUA|CHỜ)/.test(action)) notes.push("Cơ bản yếu – chỉ nên lướt sóng ngắn, kỷ luật SL chặt");
  const atrPct = x.atr_pct[n - 1];
  if (atrPct > 4.5) notes.push(`Biến động cao (ATR ${atrPct.toFixed(1)}%/phiên) – giảm khối lượng vị thế`);
  if (riskPct > (PRICE_LIMIT[board] || 0.07)) notes.push("Khoảng SL lớn hơn biên độ 1 phiên – có thể không thoát kịp nếu giảm sàn liên tiếp");
  notes.push("Hàng mua về T+2 (chiều) mới bán được – SL thực tế có thể trượt nếu giá giảm mạnh trước đó");

  return {
    action, setup, entryLow: rnd(eLow, board), entryHigh: rnd(eHigh, board), stop: rnd(stop, board, "down"),
    tp1: rnd(tp1, board), tp2: rnd(tp2, board), riskPct,
    rr1: risk > 0 ? (tp1 - em) / risk : NaN, rr2: risk > 0 ? (tp2 - em) / risk : NaN,
    trailing: `Khi đạt TP1: chốt 30–50%, dời SL về giá vốn. Phần còn lại trailing theo MA20 (hiện ${ma20.toFixed(2)}) hoặc đóng cửa dưới đỉnh cao nhất − 2×ATR (${(2 * atr).toFixed(2)}).`,
    notes,
  };
}

export function positionSize(capital, riskPerTrade, entry, stop, maxAlloc = 0.25) {
  const perShare = (entry - stop) * 1000;
  if (!(perShare > 0) || !(entry > 0)) return { shares: 0, value: 0, risk: 0, alloc: 0, capped: false };
  let sh = Math.floor((capital * riskPerTrade) / perShare / 100) * 100;
  const capSh = Math.floor((capital * maxAlloc) / (entry * 1000) / 100) * 100;
  sh = Math.max(0, Math.min(sh, capSh));
  const value = sh * entry * 1000;
  return { shares: sh, value, risk: sh * perShare, alloc: capital ? value / capital : 0, capped: sh === capSh };
}

export function overall(tech, fund, market) {
  let total = fund == null ? tech : 0.55 * tech + 0.45 * fund;
  if (market != null) total += (market - 50) * 0.1;
  total = Math.min(100, Math.max(0, total));
  const label = total >= 75 ? "★★★★★ Rất tích cực" : total >= 65 ? "★★★★ Tích cực" : total >= 52 ? "★★★ Trung tính – theo dõi"
    : total >= 40 ? "★★ Tiêu cực" : "★ Rất tiêu cực – tránh";
  return { total, label };
}
