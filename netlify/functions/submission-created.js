// Runs automatically whenever a Netlify Form is submitted.
const { store, getSettings, getCodes, checkCode, quote, normCode } = require('../lib/core');

exports.handler = async (event) => {
  try {
    const { payload } = JSON.parse(event.body || '{}');
    if (!payload || payload.form_name !== 'registration') return { statusCode: 200, body: 'ignored' };
    const d = payload.data || {};
    const seats = Math.min(4, Math.max(1, parseInt(d.package, 10) || 1));
    const participants = [];
    for (let i = 1; i <= seats; i++) {
      participants.push({
        name: d[`p${i}_name`] || '', nameZh: d[`p${i}_name_zh`] || '',
        phone: d[`p${i}_phone`] || '', email: d[`p${i}_email`] || '',
        role: d[`p${i}_role`] || '', org: d[`p${i}_org`] || '',
        cert: d[`p${i}_cert`] === 'china' ? 'china' : 'course'
      });
    }
    const certCount = participants.filter(p => p.cert === 'china').length;
    const s = store(event);
    const [st, codes] = await Promise.all([getSettings(s), getCodes(s)]);
    const code = normCode(d.discount_code);
    const chk = code ? checkCode(codes, code, new Date(payload.created_at || Date.now())) : null;
    const q = quote(st, { seats, certCount, code: chk }, new Date(payload.created_at || Date.now()));
    const declared = Number(d.amount) || 0;
    const flags = [];
    if (code && !chk.ok) flags.push('code ' + chk.reason);
    if (Math.abs(declared - q.total) > 0.01) flags.push(`amount mismatch: form S$${declared}, expected S$${q.total}`);

    const id = new Date(payload.created_at || Date.now()).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6);
    const proof = d['payment-proof'];
    await s.setJSON('reg/' + id, {
      id, createdAt: payload.created_at || new Date().toISOString(), netlifyId: payload.id || null,
      seats, participants, certCount, discountCode: code || null,
      declaredAmount: declared, expected: q, flags,
      paymentProof: proof && (proof.url || proof) || null,
      question: d.question || '', comments: d.comments || '', status: 'pending', adminNote: ''
    });

    if (chk && chk.ok && q.codeApplied) {
      const fresh = await getCodes(s);
      if (fresh[chk.code]) { fresh[chk.code].used = (fresh[chk.code].used || 0) + 1; await s.setJSON('codes', fresh); }
    }
    return { statusCode: 200, body: 'stored' };
  } catch (e) {
    console.error(e);
    return { statusCode: 200, body: 'error-logged' }; // never block the submission
  }
};
