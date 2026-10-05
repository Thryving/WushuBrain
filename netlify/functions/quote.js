const { store, getSettings, getCode, normCode, checkCode, quote, json } = require('../lib/core');
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  try {
    const b = JSON.parse(event.body || '{}');
    const s = store(event);
    const k = normCode(b.code);
    const [st, one] = await Promise.all([getSettings(s), getCode(s, k)]);
    const codes = one ? { [k]: one } : {};
    const c = b.code ? checkCode(codes, b.code) : null;
    const q = quote(st, { seats: b.seats, certCount: b.certCount, code: c });
    return json(200, { ...q, code: c ? { ok: c.ok, code: c.code, pct: c.pct, reason: c.reason } : null });
  } catch (e) { return json(500, { error: 'quote-failed' }); }
};
