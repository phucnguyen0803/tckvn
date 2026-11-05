// Phân tích kỹ thuật: xu hướng, tín hiệu, điểm kỹ thuật 0-100, trạng thái thị trường
import { addAll, supportResistance, isNum, sma } from "./indicators.js";

const clip = (v, a, b) => Math.min(b, Math.max(a, v));

function slope(a, n) {
  const s = a.filter(isNum);
  if (s.length <= n) return 0;
  return (s[s.length - 1] / s[s.length - 1 - n] - 1) * 100;
}

function label(s) {
  if (s >= 2) return "Tăng mạnh";
  if (s >= 1) return "Tăng";
  if (s > -1) return "Đi ngang";
  if (s > -2) return "Giảm";
  return "Giảm mạnh";
}

/** Căn chỉnh chuỗi chỉ số theo ngày của cổ phiếu (forward fill) */
function alignIndex(x, idx) {
  const map = new Map(idx.t.map((t, i) => [t, idx.c[i]]));
  let prev = NaN;
  return x.t.map((t) => { const v = map.get(t); if (isNum(v)) prev = v; return prev; });
}

export function analyze(bars, indexBars = null) {
  const n = bars.c.length;
  if (n < 60) throw new Error("Cần tối thiểu 60 phiên dữ liệu");
  const x = addAll(bars);
  const L = (k) => { const v = x[k][n - 1]; return isNum(v) ? v : null; };
  const P = (k) => { const v = x[k][n - 2]; return isNum(v) ? v : null; };
  const c = x.c[n - 1];
  const pros = [], cons = [], signals = [];
  const ma20 = L("ma20"), ma50 = L("ma50"), ma150 = L("ma150"), ma200 = L("ma200"), ema9 = L("ema9"), ema21 = L("ema21");

  // ---- xu hướng đa khung
  let st = (ema9 && ema21 && ema9 > ema21 ? 1 : -1) + (ma20 && c > ma20 ? 1 : -1) + (slope(x.ma20, 5) > 0 ? 0.5 : -0.5);
  let mt = (ma20 && ma50 && ma20 > ma50 ? 1 : -1) + (ma50 && c > ma50 ? 1 : -1) + (slope(x.ma50, 10) > 0 ? 0.5 : -0.5);
  let lt = 0;
  if (ma200) lt = (c > ma200 ? 1 : -1) + (slope(x.ma200, 20) > 0 ? 1 : -1) + (ma50 && ma50 > ma200 ? 0.5 : -0.5);
  const composite = 0.25 * st + 0.4 * mt + 0.35 * lt;
  const trend = label(composite);

  const adxV = L("adx") || 0, pdi = L("pdi") || 0, mdi = L("mdi") || 0;
  if (adxV >= 25) (pdi > mdi ? pros : cons).push(`ADX ${adxV.toFixed(0)} – xu hướng ${pdi > mdi ? "tăng" : "giảm"} có sức mạnh rõ ràng`);
  else if (adxV < 18) cons.push(`ADX ${adxV.toFixed(0)} – thị trường đi ngang, tín hiệu xu hướng kém tin cậy`);

  // ---- giai đoạn Weinstein
  const s150 = slope(x.ma150, 20), s150l = slope(x.ma150, 60);
  let stage;
  if (ma150 == null) stage = "Chưa xác định";
  else if (c > ma150 && s150 > 0.5) stage = "Giai đoạn 2 – Uptrend";
  else if (c < ma150 && s150 < -0.5) stage = "Giai đoạn 4 – Downtrend";
  else if (s150 >= -0.5 && c >= ma150 * 0.97 && s150l < 0) stage = "Giai đoạn 1 – Tích lũy đáy";
  else stage = s150l > 0 ? "Giai đoạn 3 – Phân phối/đi ngang đỉnh" : "Giai đoạn 1 – Tích lũy";

  // ---- Trend Template (Minervini)
  const hh52 = L("hh52w"), ll52 = L("ll52w");
  let rs3m = null;
  if (indexBars && indexBars.c.length > 130) {
    const ic = alignIndex(x, indexBars);
    rs3m = slope(x.c, 63) - slope(ic, 63);
  }
  const tt = [
    ma150 && ma200 && c > ma150 && c > ma200,
    ma150 && ma200 && ma150 > ma200,
    ma200 && slope(x.ma200, 22) > 0,
    ma50 && ma150 && ma200 && ma50 > ma150 && ma150 > ma200,
    ma50 && c > ma50,
    ll52 && c >= 1.3 * ll52,
    hh52 && c >= 0.75 * hh52,
    rs3m != null && rs3m > 0,
  ];
  const templatePass = tt.filter(Boolean).length;
  if (templatePass >= 7) pros.push(`Đạt ${templatePass}/8 tiêu chí Trend Template (Minervini) – cổ phiếu dẫn dắt`);
  else if (templatePass <= 3) cons.push(`Chỉ đạt ${templatePass}/8 tiêu chí Trend Template – chưa ở xu hướng tăng chuẩn`);

  // ---- động lượng
  const rsiV = L("rsi") ?? 50;
  if (rsiV >= 50 && rsiV <= 70) pros.push(`RSI ${rsiV.toFixed(0)} – động lượng tích cực, chưa quá mua`);
  else if (rsiV > 75) cons.push(`RSI ${rsiV.toFixed(0)} – quá mua, dễ rung lắc/điều chỉnh ngắn hạn`);
  else if (rsiV < 30) cons.push(`RSI ${rsiV.toFixed(0)} – quá bán (yếu, nhưng có thể hồi kỹ thuật)`);
  else if (rsiV < 45) cons.push(`RSI ${rsiV.toFixed(0)} – động lượng yếu`);
  const macdUp = L("macd") != null && L("macd") > L("macd_sig");
  if (L("macd") != null) (macdUp ? pros : cons).push(macdUp ? "MACD nằm trên đường tín hiệu" : "MACD nằm dưới đường tín hiệu");

  // ---- dòng tiền
  const minObv = Math.min(...x.obv);
  const obvSlope = slope(x.obv.map((v) => v - minObv + 1), 20), pSlope = slope(x.c, 20);
  const mfiV = L("mfi") ?? 50;
  if (obvSlope > 0 && pSlope <= 0) pros.push("OBV tăng trong khi giá đi ngang/giảm – dấu hiệu gom hàng");
  else if (obvSlope < 0 && pSlope > 0) cons.push("Giá tăng nhưng OBV giảm – phân kỳ âm dòng tiền");
  if (mfiV > 80) cons.push(`MFI ${mfiV.toFixed(0)} – dòng tiền quá nóng`);
  let dist = 0, acc = 0;
  for (let i = Math.max(1, n - 25); i < n; i++) {
    const big = x.v[i] > x.vol_ma20[i] * 1.1;
    if (big && x.c[i] < x.c[i - 1]) dist++;
    if (big && x.c[i] > x.c[i - 1]) acc++;
  }
  if (dist >= 5 && dist > acc) cons.push(`${dist} phiên phân phối (giảm kèm vol lớn) trong 25 phiên`);
  else if (acc >= 5 && acc > dist) pros.push(`${acc} phiên tích lũy (tăng kèm vol lớn) trong 25 phiên`);
  let avgVal = 0; const k20 = Math.min(20, n);
  for (let i = n - k20; i < n; i++) avgVal += x.c[i] * x.v[i];
  avgVal = avgVal / k20 / 1e6; // tỷ đồng
  if (avgVal < 3) cons.push(`Thanh khoản thấp (~${avgVal.toFixed(1)} tỷ/phiên) – rủi ro trượt giá, khó thoát hàng`);
  if (rs3m != null) {
    if (rs3m > 5) pros.push(`Mạnh hơn VN-Index ${rs3m >= 0 ? "+" : ""}${rs3m.toFixed(1)} điểm % trong 3 tháng`);
    else if (rs3m < -5) cons.push(`Yếu hơn VN-Index ${rs3m.toFixed(1)} điểm % trong 3 tháng`);
  }

  // ---- tín hiệu
  const vr = L("vol_ratio") || 0;
  const hh20prev = isNum(x.hh20[n - 2]) ? x.hh20[n - 2] : null;
  const rng = x.h[n - 1] - x.l[n - 1] || 1e-9;
  const closePos = (c - x.l[n - 1]) / rng;
  const low = x.l[n - 1];
  if (hh20prev && c > hh20prev && vr >= 1.5 && closePos >= 0.6)
    signals.push({ name: "Breakout nền giá", side: "buy", strength: 3, note: `Vượt đỉnh 20 phiên ${hh20prev.toFixed(2)} với KL gấp ${vr.toFixed(1)} lần TB20` });
  else if (hh20prev && c > hh20prev && vr < 1)
    signals.push({ name: "Vượt đỉnh thiếu thanh khoản", side: "watch", strength: 1, note: "Giá vượt đỉnh 20 phiên nhưng KL thấp – dễ là bull trap" });
  if (composite >= 1 && ma20 && low <= ma20 * 1.015 && c >= ma20 && rsiV >= 40 && rsiV <= 62)
    signals.push({ name: "Pullback về MA20 trong uptrend", side: "buy", strength: 2, note: "Điều chỉnh lành mạnh về hỗ trợ động MA20" });
  if (composite >= 0.5 && ma50 && low <= ma50 * 1.015 && c >= ma50 * 0.995 && vr < 1.2)
    signals.push({ name: "Test MA50 với KL thấp", side: "buy", strength: 2, note: "Kiểm định MA50, áp lực bán cạn" });
  const mh = x.macd_hist, h1 = mh[n - 1], h0 = mh[n - 2];
  if (isNum(h1) && isNum(h0) && h1 > 0 && h0 <= 0) {
    const below = x.macd[n - 1] < 0;
    signals.push({ name: "MACD cắt lên", side: "buy", strength: below ? 2 : 1, note: "MACD cắt lên đường tín hiệu" + (below ? " dưới vùng 0 (đảo chiều sớm)" : "") });
  }
  if (isNum(h1) && isNum(h0) && h1 < 0 && h0 >= 0) signals.push({ name: "MACD cắt xuống", side: "sell", strength: 2, note: "Động lượng suy yếu" });
  const bw = x.bb_width.filter(isNum);
  if (bw.length > 120) {
    const w = bw.slice(-120).sort((a, b) => a - b);
    if (bw[bw.length - 1] <= w[Math.floor(0.15 * (w.length - 1))])
      signals.push({ name: "Bollinger thắt chặt (squeeze)", side: "watch", strength: 1, note: "Biến động nén thấp – chuẩn bị bùng nổ, chờ xác nhận hướng" });
  }
  const pr = P("rsi");
  if (pr != null && pr < 30 && rsiV >= 30) signals.push({ name: "RSI thoát quá bán", side: "buy", strength: 1, note: "Hồi kỹ thuật – ngược xu hướng, chỉ lướt ngắn, SL chặt" });
  if (ma50 && P("ma50") && x.c[n - 2] >= P("ma50") && c < ma50 && vr >= 1.3)
    signals.push({ name: "Gãy MA50 kèm KL lớn", side: "sell", strength: 3, note: "Tín hiệu bán/giảm tỷ trọng quan trọng" });
  if (ma20 && P("ma20") && c < ma20 && x.c[n - 2] >= P("ma20") && composite > 0)
    signals.push({ name: "Mất MA20", side: "sell", strength: 1, note: "Cảnh báo ngắn hạn" });
  if (rsiV > 78) signals.push({ name: "Quá mua mạnh", side: "sell", strength: 1, note: "Cân nhắc chốt lời một phần, không mua đuổi" });
  if (hh52 && c >= 0.98 * hh52 && vr >= 1.2) signals.push({ name: "Gần/tạo đỉnh 52 tuần", side: "buy", strength: 1, note: "Không còn cản trên – cổ phiếu dẫn dắt" });

  // ---- điểm
  let score = 50;
  score += (clip(composite, -3, 3) / 3) * 22;
  score += (templatePass - 4) * 2.5;
  score += clip((rsiV - 50) / 20, -1, 1) * 6 * (rsiV > 75 ? 0 : 1);
  score += macdUp ? 4 : -4;
  score += clip(obvSlope / 10, -1, 1) * 4;
  score += clip(acc - dist, -5, 5);
  if (rs3m != null) score += clip(rs3m / 10, -1, 1) * 6;
  score += signals.filter((s) => s.side === "buy").reduce((a, s) => a + s.strength * 1.5, 0);
  score -= signals.filter((s) => s.side === "sell").reduce((a, s) => a + s.strength * 2, 0);
  if (rsiV > 78) score -= 5;
  score = clip(score, 0, 100);

  return {
    score, trend, trendShort: label(st), trendMid: label(mt), trendLong: ma200 ? label(lt) : "Chưa đủ dữ liệu",
    composite, stage, adx: adxV, rsi: rsiV, rs3m, templatePass, signals, pros, cons,
    levels: supportResistance(x), data: x, distDays: dist, accDays: acc, avgValue: avgVal,
  };
}

export function marketRegime(indexBars) {
  const r = analyze(indexBars);
  const x = r.data, n = x.c.length;
  let dist = 0;
  for (let i = Math.max(1, n - 25); i < n; i++) if (x.c[i] < x.c[i - 1] * 0.998 && x.v[i] > x.v[i - 1]) dist++;
  let regime, exposure;
  if (r.score >= 65 && dist <= 4) [regime, exposure] = ["Tích cực – xu hướng tăng", "60–100%"];
  else if (r.score >= 50) [regime, exposure] = ["Trung tính – thận trọng chọn lọc", "30–60%"];
  else if (r.score >= 35) [regime, exposure] = ["Rủi ro – điều chỉnh", "10–30%"];
  else [regime, exposure] = ["Tiêu cực – downtrend", "0–10% (ưu tiên tiền mặt)"];
  return { regime, exposure, score: r.score, trend: r.trend, distributionDays: dist, tech: r };
}

export { sma };
