// Phân tích cơ bản: BCTC, tăng trưởng, hiệu quả, sức khỏe, F-Score, định giá
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const clip = (v, a, b) => Math.min(b, Math.max(a, v));
const pct = (v, d = 0) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;
const pctU = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return NaN; const p = (s.length - 1) * q, lo = Math.floor(p); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (p - lo); };

const periodKey = (r, q) => (q ? `${r.yearReport}-Q${r.lengthReport}` : `${r.yearReport}`);

/** Gom các báo cáo thành Map(period -> record) đã sắp xếp */
function byPeriod(recs, quarterly) {
  const rs = [...(recs || [])].sort((a, b) => a.yearReport - b.yearReport || (a.lengthReport || 0) - (b.lengthReport || 0));
  const m = new Map();
  for (const r of rs) m.set(periodKey(r, quarterly), r);
  return m;
}

function find(metrics, section, ...kw) {
  for (const m of metrics[section] || []) {
    const t = (m.t || "").toLowerCase();
    if (kw.every((k) => t.includes(k.toLowerCase()))) return m.f;
  }
  return null;
}

/** Bảng chỉ tiêu dễ đọc (tiếng Việt), đơn vị tỷ đồng: {periods, rows:[{name, level, values}]} */
export function readable(fin, sectionKey, quarterly, lastN = 8) {
  const secName = { is: "INCOME_STATEMENT", bs: "BALANCE_SHEET", cf: "CASH_FLOW" }[sectionKey];
  const map = byPeriod(fin[sectionKey]?.[quarterly ? "quarters" : "years"], quarterly);
  const periods = [...map.keys()].slice(-lastN);
  const rows = [];
  for (const m of fin.metrics[secName] || []) {
    if (!m.f) continue;
    const vals = periods.map((p) => map.get(p)?.[m.f]);
    if (vals.every((v) => !isNum(v) || v === 0)) continue;
    const isEps = (m.t || "").includes("cổ phiếu (VND)");
    rows.push({ name: m.t || m.f, level: m.l || 1, values: vals.map((v) => (isNum(v) ? (isEps ? v : v / 1e9) : null)) });
  }
  return { periods, rows };
}

function items(fin, quarterly) {
  const M = fin.metrics, key = quarterly ? "quarters" : "years";
  const is = byPeriod(fin.is[key], quarterly), bs = byPeriod(fin.bs[key], quarterly), cf = byPeriod(fin.cf[key], quarterly);
  const periods = [...new Set([...is.keys(), ...bs.keys(), ...cf.keys()])].sort((a, b) => (a < b ? -1 : 1));
  const bank = (M.INCOME_STATEMENT || []).some((m) => (m.f || "").startsWith("isb"));
  const toi = bank ? find(M, "INCOME_STATEMENT", "tổng thu nhập hoạt động") : null;
  const ocfF = find(M, "CASH_FLOW", "lưu chuyển tiền", "hoạt động", "kinh doanh");
  const g = (mp, p, ...fs) => { const r = mp.get(p); if (!r) return NaN; for (const f of fs) if (f && isNum(r[f])) return r[f]; return NaN; };
  const rows = periods.map((p) => {
    let revenue;
    if (bank) {
      revenue = toi ? g(is, p, toi) : NaN;
      if (!isNum(revenue)) {
        const r = is.get(p) || {};
        const cols = ["isb27", "isb30", "isb31", "isb32", "isb33", "isb34", "isb35", "isb36"].filter((c) => isNum(r[c]));
        revenue = cols.length ? cols.reduce((s, c) => s + r[c], 0) : NaN;
      }
    } else revenue = g(is, p, "isa3");
    const np = g(is, p, "isa20");
    let npp = g(is, p, "isa22"); if (!isNum(npp) || (npp === 0 && np)) npp = np;
    return {
      period: p, revenue, gross: bank ? NaN : g(is, p, "isa5"), interestExp: bank ? NaN : Math.abs(g(is, p, "isa8")),
      ebt: g(is, p, "isa16"), np, npParent: npp, eps: g(is, p, "isa23"),
      assets: g(bs, p, "bsa53"), liab: g(bs, p, "bsa54"), equity: g(bs, p, "bsa78"),
      curAssets: g(bs, p, "bsa1"), curLiab: g(bs, p, "bsa55"), ltLiab: g(bs, p, "bsa67"),
      ocf: g(cf, p, "cfa18", ocfF),
    };
  });
  return { rows, bank };
}

function gr(a, b) {
  if (!isNum(a) || !isNum(b) || b === 0) return NaN;
  return b < 0 ? (a - b) / Math.abs(b) : a / b - 1;
}
function cagr(arr, years) {
  const s = arr.filter(isNum);
  if (s.length <= years) return NaN;
  const a = s[s.length - 1], b = s[s.length - 1 - years];
  return a > 0 && b > 0 ? (a / b) ** (1 / years) - 1 : NaN;
}

export function piotroski(yRows) {
  const y = yRows.filter((r) => isNum(r.np) && isNum(r.assets) && r.assets);
  if (y.length < 2) return { score: null, detail: [] };
  const a = y[y.length - 1], b = y[y.length - 2], det = [];
  const roaA = a.np / a.assets, roaB = b.np / b.assets;
  det.push(["ROA dương", roaA > 0]);
  if (isNum(a.ocf) && a.ocf !== 0) { det.push(["Dòng tiền HĐKD dương", a.ocf > 0]); det.push(["Dòng tiền HĐKD > Lợi nhuận (chất lượng LN)", a.ocf > a.np]); }
  det.push(["ROA cải thiện so với năm trước", roaA > roaB]);
  if (isNum(a.ltLiab) && isNum(b.ltLiab)) det.push(["Đòn bẩy dài hạn giảm", a.ltLiab / a.assets <= b.ltLiab / b.assets]);
  if (a.curLiab && b.curLiab && isNum(a.curAssets)) det.push(["Thanh toán hiện hành cải thiện", a.curAssets / a.curLiab > b.curAssets / b.curLiab]);
  if (a.eps && b.eps) det.push(["Không pha loãng cổ phiếu đáng kể", a.npParent / a.eps <= (b.npParent / b.eps) * 1.02]);
  if (isNum(a.gross) && a.revenue && b.revenue) det.push(["Biên lợi nhuận gộp cải thiện", a.gross / a.revenue > b.gross / b.revenue]);
  if (a.revenue && b.revenue) det.push(["Vòng quay tài sản cải thiện", a.revenue / a.assets > b.revenue / b.assets]);
  const ok = det.filter((d) => d[1]).length;
  return { score: Math.round((ok * 9) / det.length), detail: det };
}

/** price: nghìn đồng */
export function analyze(fin, price) {
  const Y = items(fin, false), Q = items(fin, true);
  const y = Y.rows, q = Q.rows, bank = Y.bank;
  const rt = [...(fin.ratios || [])].sort((a, b) => a.yearReport - b.yearReport || a.quarter - b.quarter);
  const latest = fin.latest || {};
  const pros = [], cons = [], key = {};
  const lastOf = (arr, f) => { for (let i = arr.length - 1; i >= 0; i--) if (isNum(arr[i][f])) return arr[i][f]; return NaN; };

  const q4 = q.filter((r) => isNum(r.np)).slice(-4);
  const sum = (arr, f) => arr.reduce((s, r) => s + (isNum(r[f]) ? r[f] : 0), 0);
  const ttmNp = q4.length === 4 ? sum(q4, "npParent") : lastOf(y, "npParent");
  const ttmRev = q4.length === 4 ? sum(q4, "revenue") : lastOf(y, "revenue");
  const shares = rt.length ? lastOf(rt, "numberOfSharesMktCap") : NaN;
  const eps = latest.EPS_TR ?? (shares ? ttmNp / shares : NaN);
  const bvps = latest.BVPS_CR ?? (shares ? lastOf(q, "equity") / shares : NaN);
  const pe = eps > 0 ? (price * 1000) / eps : NaN;
  const pb = bvps > 0 ? (price * 1000) / bvps : NaN;
  const roe = rt.length && isNum(lastOf(rt, "roe")) ? lastOf(rt, "roe") : latest.ROAE_TR_AVG5Q ?? NaN;
  const roa = rt.length && isNum(lastOf(rt, "roa")) ? lastOf(rt, "roa") : latest.ROAA_TR_AVG5Q ?? NaN;
  Object.assign(key, {
    "Vốn hóa (tỷ đ)": shares ? (price * 1000 * shares) / 1e9 : (latest.MARKETCAP || NaN) / 1e9,
    "EPS TTM (đ)": eps, "BVPS (đ)": bvps, "P/E": pe, "P/B": pb, ROE: roe, ROA: roa,
    "Doanh thu TTM (tỷ)": ttmRev / 1e9, "LNST cty mẹ TTM (tỷ)": ttmNp / 1e9,
    "Tỷ suất cổ tức": latest.DIVIDEND_YIELD ?? NaN, Beta: latest.BETA ?? NaN, "Số CP lưu hành": shares,
  });

  // ---- tăng trưởng theo năm
  const yy = y.filter((r) => isNum(r.revenue) && r.revenue).slice(-6);
  const growth = yy.map((r, i) => ({
    period: r.period, revenue: r.revenue / 1e9, npParent: r.npParent / 1e9,
    grossMargin: bank ? NaN : r.gross / r.revenue,
    revGrowth: i ? r.revenue / yy[i - 1].revenue - 1 : NaN, npGrowth: i ? gr(r.npParent, yy[i - 1].npParent) : NaN,
    netMargin: r.np / r.revenue, roe: r.npParent / r.equity, de: r.liab / r.equity, cfoNp: r.ocf / r.np,
  }));
  const qq = q.filter((r) => isNum(r.revenue) && r.revenue).slice(-12);
  const quarterly = qq.map((r, i) => ({
    period: r.period, revenue: r.revenue / 1e9, npParent: r.npParent / 1e9,
    revYoY: i >= 4 ? r.revenue / qq[i - 4].revenue - 1 : NaN, npYoY: i >= 4 ? gr(r.npParent, qq[i - 4].npParent) : NaN,
  }));
  const revC3 = cagr(y.map((r) => r.revenue), 3), npC3 = cagr(y.map((r) => r.npParent), 3);
  const yoys = quarterly.map((r) => r.npYoY).filter(isNum), ryoys = quarterly.map((r) => r.revYoY).filter(isNum);
  const qNp = yoys.length ? yoys[yoys.length - 1] : NaN, qRev = ryoys.length ? ryoys[ryoys.length - 1] : NaN;
  const prevQNp = yoys.length >= 2 ? yoys[yoys.length - 2] : NaN;
  Object.assign(key, { "CAGR DT 3 năm": revC3, "CAGR LN 3 năm": npC3, "LN quý gần nhất YoY": qNp, "DT quý gần nhất YoY": qRev });

  let s = 50;
  if (isNum(qNp)) {
    if (qNp >= 0.25) { pros.push(`LN quý gần nhất tăng ${pct(qNp)} YoY (đạt chuẩn CANSLIM ≥25%)`); s += 8; }
    else if (qNp >= 0.1) { pros.push(`LN quý gần nhất tăng ${pct(qNp)} YoY`); s += 4; }
    else if (qNp < -0.1) { cons.push(`LN quý gần nhất giảm ${pct(qNp)} YoY`); s -= 8; }
    if (isNum(prevQNp) && qNp > prevQNp && prevQNp > 0) { pros.push("Tăng trưởng LN đang tăng tốc"); s += 3; }
  }
  if (isNum(npC3)) {
    if (npC3 >= 0.15) { pros.push(`LN tăng trưởng kép ${pctU(npC3, 0)}/năm (3 năm)`); s += 6; }
    else if (npC3 < 0) { cons.push(`LN suy giảm ${pctU(npC3, 0)}/năm (3 năm)`); s -= 6; }
  }
  if (isNum(revC3) && revC3 >= 0.12) { pros.push(`Doanh thu tăng kép ${pctU(revC3, 0)}/năm`); s += 3; }

  if (isNum(roe)) {
    if (roe >= 0.2) { pros.push(`ROE ${pctU(roe)} – hiệu quả sử dụng vốn rất tốt`); s += 8; }
    else if (roe >= 0.15) { pros.push(`ROE ${pctU(roe)} – tốt`); s += 4; }
    else if (roe < 0.08) { cons.push(`ROE ${pctU(roe)} – thấp`); s -= 6; }
  }
  if (!bank) {
    const gm = growth.map((r) => r.grossMargin).filter(isNum);
    if (gm.length >= 2 && gm[gm.length - 1] < gm[gm.length - 2] - 0.03) { cons.push(`Biên gộp giảm ${pctU(gm[gm.length - 2])} → ${pctU(gm[gm.length - 1])}`); s -= 3; }
  }

  // ---- sức khỏe tài chính
  const lb = [...q].reverse().find((r) => isNum(r.equity) && r.equity) || [...y].reverse().find((r) => isNum(r.equity)) || {};
  const de = lb.equity ? lb.liab / lb.equity : NaN;
  key["Nợ/VCSH"] = de;
  if (!bank) {
    const cr = lb.curLiab ? lb.curAssets / lb.curLiab : NaN;
    key["Thanh toán hiện hành"] = cr;
    if (isNum(de)) {
      if (de > 2.5) { cons.push(`Nợ phải trả/VCSH ${de.toFixed(1)} lần – đòn bẩy cao`); s -= 6; }
      else if (de < 1) { pros.push(`Nợ phải trả/VCSH ${de.toFixed(2)} – cấu trúc vốn an toàn`); s += 3; }
    }
    if (isNum(cr) && cr < 1) { cons.push(`Thanh toán hiện hành ${cr.toFixed(2)} < 1 – áp lực thanh khoản ngắn hạn`); s -= 4; }
    if (q4.length === 4) {
      const ie = sum(q4, "interestExp"), ebt = sum(q4, "ebt");
      if (ie > 0) {
        const icr = (ebt + ie) / ie; key["Khả năng trả lãi (EBIT/lãi vay)"] = icr;
        if (icr < 2) { cons.push(`EBIT chỉ gấp ${icr.toFixed(1)} lần chi phí lãi vay`); s -= 4; }
      }
      const cfo4 = sum(q4, "ocf");
      if (ttmNp > 0 && q4.some((r) => isNum(r.ocf))) {
        const ratio = cfo4 / ttmNp; key["CFO/LNST (TTM)"] = ratio;
        if (ratio >= 0.8) { pros.push(`Dòng tiền HĐKD/LN = ${ratio.toFixed(2)} – lợi nhuận chất lượng`); s += 3; }
        else if (ratio < 0) { cons.push("Dòng tiền HĐKD âm trong 4 quý – LN 'trên giấy'"); s -= 5; }
      }
    }
  } else if (rt.length) {
    const r = rt[rt.length - 1];
    const A = (v) => (isNum(v) && v !== 0 ? Math.abs(v) : null);
    const nim = A(r.netInterestMargin), npl = A(r.npl), cir = A(r.cir) ?? A(r.costToIncome);
    const ldr = A(r.ldrLoanDepositRatio), cov = A(r.loansLossReservesToNPLs);
    for (const [k, v] of [["NIM", nim], ["Nợ xấu (NPL)", npl], ["CIR", cir], ["LDR", ldr], ["Bao phủ nợ xấu", cov]]) if (v) key[k] = v;
    if (nim && nim >= 0.035) { pros.push(`NIM ${pctU(nim, 2)} – biên lãi tốt`); s += 3; }
    if (npl && npl > 0.025) { cons.push(`Nợ xấu ${pctU(npl, 2)} – cao`); s -= 5; }
    else if (npl && npl < 0.015) { pros.push(`Nợ xấu ${pctU(npl, 2)} – thấp`); s += 3; }
    if (cov && cov < 0.8) { cons.push(`Bao phủ nợ xấu ${pctU(cov, 0)} – mỏng`); s -= 3; }
    else if (cov && cov > 1.5) { pros.push(`Bao phủ nợ xấu ${pctU(cov, 0)} – dày`); s += 2; }
  }

  const fs = piotroski(y);
  if (fs.score != null) {
    if (fs.score >= 7) { pros.push(`Piotroski F-Score ${fs.score}/9 – nền tảng tài chính mạnh`); s += 6; }
    else if (fs.score <= 3) { cons.push(`Piotroski F-Score ${fs.score}/9 – nền tảng yếu`); s -= 6; }
  }

  // ---- định giá
  const val = { pe, pb };
  if (rt.length) {
    const hist = rt.slice(-20);
    val.peHist = hist.map((r) => ({ p: `${r.yearReport}-Q${r.quarter}`, pe: r.pe, pb: r.pb }));
    const peH = hist.map((r) => r.pe).filter((v) => isNum(v) && v > 0 && v < 100);
    const pbH = hist.map((r) => r.pb).filter((v) => isNum(v) && v > 0 && v < 20);
    Object.assign(val, {
      peMedian: median(peH), pbMedian: median(pbH), peP25: quantile(peH, 0.25), pbP25: quantile(pbH, 0.25),
      pePct: isNum(pe) && peH.length ? peH.filter((v) => v < pe).length / peH.length : NaN,
      pbPct: isNum(pb) && pbH.length ? pbH.filter((v) => v < pb).length / pbH.length : NaN,
    });
  }
  const fv = [], fvBase = [];
  if (eps > 0) {
    if (isNum(val.peP25)) { val.fvPe = (val.peP25 * eps) / 1000; fv.push(val.fvPe); }
    if (isNum(val.peMedian)) fvBase.push((val.peMedian * eps) / 1000);
  }
  if (bvps > 0) {
    if (isNum(val.pbP25)) { val.fvPb = (val.pbP25 * bvps) / 1000; fv.push(val.fvPb); }
    if (isNum(val.pbMedian)) fvBase.push((val.pbMedian * bvps) / 1000);
  }
  if (eps > 0 && bvps > 0) { val.graham = Math.sqrt(22.5 * eps * bvps) / 1000; fv.push(val.graham); }
  const g = isNum(npC3) ? npC3 : qNp;
  if (isNum(pe) && isNum(g) && g > 0) val.peg = pe / (g * 100);
  if (fv.length) { val.fairValue = fv.reduce((a, b) => a + b, 0) / fv.length; val.upside = val.fairValue / price - 1; }
  if (fvBase.length) val.fairValueBase = fvBase.reduce((a, b) => a + b, 0) / fvBase.length;
  if (isNum(val.upside)) {
    if (val.upside >= 0.2) { pros.push(`Định giá hấp dẫn: giá trị hợp lý ~${val.fairValue.toFixed(1)} (tiềm năng ${pct(val.upside)})`); s += 8; }
    else if (val.upside >= 0.05) { pros.push(`Định giá hợp lý, còn dư địa ${pct(val.upside)}`); s += 3; }
    else if (val.upside < -0.15) { cons.push(`Đang định giá cao hơn mức thận trọng (${pct(val.upside)})`); s -= 6; }
  }
  if (isNum(val.peg)) {
    if (val.peg < 1) { pros.push(`PEG ${val.peg.toFixed(2)} < 1 – tăng trưởng tốt so với giá`); s += 3; }
    else if (val.peg > 2) { cons.push(`PEG ${val.peg.toFixed(2)} – trả giá cao cho tăng trưởng`); s -= 2; }
  }
  if (!isNum(pe) || eps <= 0) { cons.push("EPS TTM âm – doanh nghiệp đang lỗ"); s -= 12; }

  return { score: clip(s, 0, 100), isBank: bank, key, growth, quarterly, fscore: fs.score, fscoreDetail: fs.detail, valuation: val, pros, cons };
}
