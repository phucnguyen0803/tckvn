// Netlify Function: trung gian lấy dữ liệu chứng khoán VN (VNDirect, Vietcap)
// Đường dẫn: /api/<route>?...
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const VCI_H = {
  "User-Agent": UA, Accept: "application/json, text/plain, */*", "Accept-Language": "vi-VN,vi;q=0.9",
  Origin: "https://trading.vietcap.com.vn", Referer: "https://trading.vietcap.com.vn/",
};
const GEN_H = { "User-Agent": UA, Accept: "*/*" };
const DCHART = "https://dchart-api.vndirect.com.vn/dchart/history";
const VCI_PRICE = "https://trading.vietcap.com.vn/api/price";
const VCI_IQ = "https://iq.vietcap.com.vn/api/iq-insight-service/v1/company";
const FINFO = "https://api-finfo.vndirect.com.vn/v4";
const INDEX_MAP = { VNINDEX: "VNINDEX", VN30: "VN30", HNXIndex: "HNX", HNXUpcomIndex: "UPCOM" };
const SYM_RE = /^[A-Z0-9]{2,12}$/;

async function fetchJSON(url, opts = {}, retries = 2) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), opts.timeout || 8000);
      const r = await fetch(url, { ...opts, signal: ctl.signal });
      clearTimeout(timer);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      last = e;
      await new Promise((res) => setTimeout(res, 300 * (i + 1)));
    }
  }
  throw new Error(`Lỗi gọi ${url.split("?")[0]}: ${last?.message || last}`);
}

const cleanSyms = (s) => (s || "").toUpperCase().split(",").map((x) => x.trim()).filter((x) => SYM_RE.test(x));

async function history(symbol, days, res) {
  const now = Math.floor(Date.now() / 1000);
  const url = `${DCHART}?resolution=${res}&symbol=${symbol}&from=${now - days * 86400}&to=${now}`;
  const d = await fetchJSON(url, { headers: GEN_H });
  if (!d || d.s !== "ok" || !d.t?.length) throw new Error(`Không có dữ liệu giá ${symbol}`);
  return { t: d.t, o: d.o, h: d.h, l: d.l, c: d.c, v: d.v };
}

async function board(symbols) {
  const out = [];
  for (let i = 0; i < symbols.length; i += 50) {
    const data = await fetchJSON(`${VCI_PRICE}/symbols/getList`, {
      method: "POST", headers: { ...VCI_H, "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: symbols.slice(i, i + 50) }),
    });
    for (const it of data || []) {
      const li = it.listingInfo || {}, mp = it.matchPrice || {}, ba = it.bidAsk || {};
      const ref = (li.refPrice || mp.referencePrice || 0) / 1000;
      const price = (mp.matchPrice || 0) / 1000 || ref;
      const bids = ba.bidPrices || [], asks = ba.askPrices || [];
      out.push({
        symbol: li.symbol || mp.symbol, name: li.organShortName || li.organName, board: li.board,
        ref, ceiling: (li.ceiling || 0) / 1000, floor: (li.floor || 0) / 1000, price,
        change: ref ? price - ref : 0, pct: ref ? (price / ref - 1) * 100 : 0,
        open: (mp.openPrice || 0) / 1000, high: (mp.highest || 0) / 1000, low: (mp.lowest || 0) / 1000,
        volume: mp.accumulatedVolume || 0, value_bn: (mp.accumulatedValue || 0) / 1000,
        foreign_net_bn: ((mp.foreignBuyValue || 0) - (mp.foreignSellValue || 0)) / 1e9,
        foreign_room: mp.currentRoom ?? null,
        bid1: bids[0] ? bids[0].price / 1000 : null, ask1: asks[0] ? asks[0].price / 1000 : null,
        bid_vol: bids.reduce((a, b) => a + (b.volume || 0), 0), ask_vol: asks.reduce((a, b) => a + (b.volume || 0), 0),
        listed_shares: li.listedShare ?? null, session: mp.session || ba.session || null, time: mp.time || null,
      });
    }
  }
  return out;
}

async function indices() {
  const data = await fetchJSON(`${VCI_PRICE}/marketIndex/getList`, {
    method: "POST", headers: { ...VCI_H, "Content-Type": "application/json" },
    body: JSON.stringify({ symbols: Object.keys(INDEX_MAP) }),
  });
  return (data || []).map((it) => ({
    symbol: INDEX_MAP[it.symbol] || it.symbol, price: it.price, change: it.change, pct: it.changePercent,
    value_bn: (it.totalValue || 0) / 1000, up: it.totalStockIncrease, down: it.totalStockDecline,
    flat: it.totalStockNoChange, ceil: it.totalStockCeiling, floor: it.totalStockFloor, time: it.time,
  }));
}

async function iq(symbol, path) {
  const d = await fetchJSON(`${VCI_IQ}/${symbol}/${path}`, { headers: VCI_H, timeout: 9000 }, 1);
  if (!d?.successful) throw new Error(`Không lấy được ${path}`);
  return d.data;
}

const STRIP = new Set(["organCode", "ticker", "createDate", "updateDate"]);
const slim = (recs) => (recs || []).map((r) => {
  const o = {};
  for (const [k, v] of Object.entries(r)) if (!STRIP.has(k) && v !== null) o[k] = v;
  return o;
});

async function fin(symbol) {
  const secs = ["INCOME_STATEMENT", "BALANCE_SHEET", "CASH_FLOW"];
  const codes = ["MARKETCAP", "PRICE_TO_EARNINGS", "PRICE_TO_BOOK", "ROAE_TR_AVG5Q", "ROAA_TR_AVG5Q",
    "DIVIDEND_YIELD", "BETA", "EPS_TR", "BVPS_CR"];
  const latestUrl = `${FINFO}/ratios/latest?filter=ratioCode:${codes.join(",")}&where=code:${symbol}&order=reportDate&fields=ratioCode,value,reportDate`;
  const [metrics, is, bs, cf, ratios, latest] = await Promise.allSettled([
    iq(symbol, "financial-statement/metrics"),
    ...secs.map((s) => iq(symbol, `financial-statement?section=${s}`)),
    iq(symbol, "statistics-financial"),
    fetchJSON(latestUrl, { headers: GEN_H }, 1),
  ]);
  if (metrics.status !== "fulfilled" || is.status !== "fulfilled") throw new Error(`Không có BCTC cho ${symbol}`);
  const m = {};
  for (const [k, arr] of Object.entries(metrics.value || {})) {
    if (!secs.includes(k)) continue;
    m[k] = (arr || []).map((x) => ({ f: x.field, t: x.titleVi, l: x.level }));
  }
  const st = (p) => (p.status === "fulfilled" ? { years: slim(p.value.years), quarters: slim(p.value.quarters) } : { years: [], quarters: [] });
  const lat = {};
  if (latest.status === "fulfilled") for (const r of latest.value?.data || []) lat[r.ratioCode] = r.value;
  return {
    metrics: m, is: st(is), bs: st(bs), cf: st(cf),
    ratios: ratios.status === "fulfilled" ? slim(ratios.value) : [], latest: lat,
  };
}

const json = (body, maxAge = 0, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Netlify-CDN-Cache-Control": maxAge ? `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}` : "no-store",
  },
});

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/(\.netlify\/functions\/)?api\/?/, "").replace(/\/$/, "");
  const q = url.searchParams;
  try {
    switch (route) {
      case "history": {
        const syms = cleanSyms(q.get("symbols") || q.get("symbol")).slice(0, 25);
        if (!syms.length) return json({ error: "Thiếu mã" }, 0, 400);
        const days = Math.min(parseInt(q.get("days") || "900", 10) || 900, 3000);
        const res = ["D", "W", "M", "1", "5", "15", "30", "60"].includes(q.get("res")) ? q.get("res") : "D";
        const results = await Promise.allSettled(syms.map((s) => history(s, days, res)));
        const out = {};
        syms.forEach((s, i) => { out[s] = results[i].status === "fulfilled" ? results[i].value : { error: String(results[i].reason?.message) }; });
        return json(out, 60);
      }
      case "board": {
        const syms = cleanSyms(q.get("symbols")).slice(0, 500);
        return json(syms.length ? await board(syms) : [], 3);
      }
      case "indices":
        return json(await indices(), 3);
      case "group": {
        const g = (q.get("g") || "VN30").replace(/[^A-Za-z0-9]/g, "");
        const d = await fetchJSON(`${VCI_PRICE}/symbols/getByGroup?group=${g}`, { headers: VCI_H });
        return json((d || []).map((x) => x.symbol).filter(Boolean), 86400);
      }
      case "stocks": {
        const d = await fetchJSON(`${VCI_PRICE}/symbols/getAll`, { headers: VCI_H, timeout: 9000 });
        return json((d || []).filter((x) => x.type === "STOCK").map((x) => ({
          s: x.symbol, b: x.board, n: x.organShortName || x.organName, f: x.organName, i: x.icbCode2,
        })), 86400);
      }
      case "fin": {
        const s = cleanSyms(q.get("symbol"))[0];
        if (!s) return json({ error: "Thiếu mã" }, 0, 400);
        return json(await fin(s), 6 * 3600);
      }
      default:
        return json({ error: "Không có route này", routes: ["history", "board", "indices", "group", "stocks", "fin"] }, 0, 404);
    }
  } catch (e) {
    return json({ error: String(e?.message || e) }, 0, 502);
  }
};

export const config = { path: "/api/*" };
