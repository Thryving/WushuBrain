const { store, getSettings, getCodes, checkCode, quote, json } = require('../lib/core');
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  try {
    const b = JSON.parse(event.body || '{}');
    const s = store(event);
    const [st, codes] = await Promise.all([getSettings(s), getCodes(s)]);
    const c = b.code ? checkCode(codes, b.code) : null;
    const q = quote(st, { seats: b.seats, certCount: b.certCount, code: c });
    return json(200, { ...q, code: c ? { ok: c.ok, code: c.code, pct: c.pct, reason: c.reason } : null });
  } catch (e) { return json(500, { error: 'quote-failed' }); }
};
