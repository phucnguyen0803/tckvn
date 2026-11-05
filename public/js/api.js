// Gọi API (Netlify Function) + cache phía trình duyệt
const mem = new Map();

async function getJSON(path) {
  const r = await fetch(`/api/${path}`);
  let j;
  try { j = await r.json(); } catch { throw new Error(`Lỗi máy chủ (${r.status})`); }
  if (!r.ok || (j && j.error && !Array.isArray(j))) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

async function cached(key, ttlMs, loader) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.val;
  if (hit?.pending) return hit.pending;
  const pending = loader().then((val) => { mem.set(key, { at: Date.now(), val }); return val; })
    .catch((e) => { mem.delete(key); throw e; });
  mem.set(key, { at: 0, pending });
  return pending;
}

function lsCached(key, ttlMs, loader) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) { const o = JSON.parse(raw); if (Date.now() - o.at < ttlMs) return Promise.resolve(o.val); }
  } catch { /* bỏ qua */ }
  return loader().then((val) => { try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), val })); } catch { /* đầy */ } return val; });
}

/** Lịch sử giá nhiều mã (gom lô 20 mã/lần) */
export async function histories(symbols, days = 900) {
  const out = {}, need = [];
  for (const s of symbols) {
    const hit = mem.get(`h:${s}:${days}`);
    if (hit && !hit.pending && Date.now() - hit.at < 4 * 60e3) out[s] = hit.val; else need.push(s);
  }
  for (let i = 0; i < need.length; i += 20) {
    const chunk = need.slice(i, i + 20);
    const res = await getJSON(`history?symbols=${chunk.join(",")}&days=${days}`);
    for (const s of chunk) {
      const v = res[s];
      if (v && !v.error) { out[s] = v; mem.set(`h:${s}:${days}`, { at: Date.now(), val: v }); }
      else out[s] = { error: v?.error || "Không có dữ liệu" };
    }
  }
  return out;
}
export const history = async (s, days = 900) => {
  const r = (await histories([s], days))[s];
  if (r.error) throw new Error(r.error);
  return r;
};
export const board = (symbols) => cached(`b:${[...symbols].sort().join(",")}`, 4000,
  () => getJSON(`board?symbols=${symbols.join(",")}`));
export const indices = () => cached("ix", 4000, () => getJSON("indices"));
export const group = (g) => lsCached(`vsp_group_${g}`, 864e5, () => getJSON(`group?g=${g}`));
export const stocks = () => lsCached("vsp_stocks", 864e5, () => getJSON("stocks"));
const retry = async (fn, n = 2, wait = 1200) => {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (i >= n) throw e; await new Promise((r) => setTimeout(r, wait * (i + 1))); }
  }
};
export const fin = (s) => cached(`f:${s}`, 6 * 3600e3, () => retry(() => getJSON(`fin?symbol=${s}`)));
