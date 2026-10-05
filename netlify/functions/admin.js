const docs = require('../lib/docs');
const { store, getSettings, getCodes, getCode, setCode, delCode, normCode, verify, json, DEFAULT_SETTINGS } = require('../lib/core');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const b = JSON.parse(event.body || '{}');
  if (!verify(b.token)) return json(401, { error: 'Session expired — please log in again' });
  const s = store(event);

  try {
    switch (b.action) {
      case 'load': {
        const [settings, codes] = await Promise.all([getSettings(s), getCodes(s)]);
        const { blobs } = await s.list({ prefix: 'reg/' });
        const regs = (await Promise.all(blobs.map(x => s.get(x.key, { type: 'json' })))).filter(Boolean)
          .sort((a, c) => (c.createdAt || '').localeCompare(a.createdAt || ''));
        return json(200, { settings, codes, regs, defaults: DEFAULT_SETTINGS });
      }

      case 'saveSettings': {
        const n = b.settings || {};
        const num = (v, d) => (v === '' || v == null || isNaN(Number(v))) ? d : Number(v);
        const cur = await getSettings(s);
        const next = {
          courseStart: n.courseStart || cur.courseStart,
          earlyBirdEnd: n.earlyBirdEnd || cur.earlyBirdEnd,
          early: num(n.early, cur.early),
          earlyGroup: { 2: num(n.earlyGroup?.[2], cur.earlyGroup[2]), 3: num(n.earlyGroup?.[3], cur.earlyGroup[3]), 4: num(n.earlyGroup?.[4], cur.earlyGroup[4]) },
          standard: num(n.standard, cur.standard),
          group: { 2: num(n.group?.[2], cur.group[2]), 3: num(n.group?.[3], cur.group[3]), 4: num(n.group?.[4], cur.group[4]) },
          certFee: num(n.certFee, cur.certFee),
          capacity: num(n.capacity, cur.capacity),
          showSeatsLeftBelow: num(n.showSeatsLeftBelow, cur.showSeatsLeftBelow),
          invoicePrefix: (n.invoicePrefix ?? cur.invoicePrefix) || '',
          receiptPrefix: (n.receiptPrefix ?? cur.receiptPrefix) || '',
          invoiceDueDate: n.invoiceDueDate || cur.invoiceDueDate
        };
        await s.setJSON('settings', next);
        return json(200, { ok: true, settings: next });
      }

      case 'addCodes': {
        // single: {code} or batch: {prefix, from, to}
        const pct = Number(b.pct);
        if (!(pct > 0 && pct <= 100)) return json(400, { error: 'Discount % must be between 1 and 100' });
        let list = [];
        if (b.code) list = String(b.code).split(/[\s,]+/).map(normCode).filter(Boolean);
        else {
          const p = normCode(b.prefix), f = parseInt(b.from, 10), t = parseInt(b.to, 10);
          if (!p || !(f >= 0) || !(t >= f) || t - f > 500) return json(400, { error: 'Check prefix and number range (max 500 codes at once)' });
          for (let i = f; i <= t; i++) list.push(p + i);
        }
        const codes = await getCodes(s);
        let added = 0, updated = 0;
        for (const k of list) {
          const prev = (await getCode(s, k)) || codes[k];
          const v = {
            pct, maxUses: parseInt(b.maxUses, 10) || 0, expires: b.expires || '',
            note: b.note || '', active: true, used: prev ? prev.used || 0 : 0,
            createdAt: prev ? prev.createdAt : new Date().toISOString()
          };
          await setCode(s, k, v); codes[k] = v;
          prev ? updated++ : added++;
        }
        return json(200, { ok: true, added, updated, codes });
      }

      case 'updateCode': {
        const k = normCode(b.code);
        const c = await getCode(s, k);
        if (!c) return json(404, { error: 'Code not found' });
        const f = b.fields || {};
        if ('active' in f) c.active = !!f.active;
        if ('pct' in f) c.pct = Number(f.pct);
        if ('maxUses' in f) c.maxUses = parseInt(f.maxUses, 10) || 0;
        if ('expires' in f) c.expires = f.expires || '';
        if ('used' in f) c.used = parseInt(f.used, 10) || 0;
        if ('note' in f) c.note = f.note || '';
        await setCode(s, k, c);
        const codes = await getCodes(s); codes[k] = c;
        return json(200, { ok: true, codes });
      }

      case 'deleteCodes': {
        const ks = (b.codes || []).map(normCode).filter(Boolean);
        for (const k of ks) await delCode(s, k);
        const codes = await getCodes(s); ks.forEach(k => delete codes[k]);
        return json(200, { ok: true, codes });
      }

      case 'updateReg': {
        const key = 'reg/' + b.id;
        const r = await s.get(key, { type: 'json' });
        if (!r) return json(404, { error: 'Registration not found' });
        if (b.status) r.status = b.status;
        if (typeof b.adminNote === 'string') r.adminNote = b.adminNote;
        if (typeof b.invoiceSent === 'boolean') { r.invoiceSent = b.invoiceSent; if (b.invoiceSent && !r.invoiceSentAt) r.invoiceSentAt = new Date().toISOString(); }
        if (typeof b.receiptSent === 'boolean') { r.receiptSent = b.receiptSent; if (b.receiptSent && !r.receiptSentAt) r.receiptSentAt = new Date().toISOString(); }
        await s.setJSON(key, r);
        return json(200, { ok: true, reg: r });
      }

      case 'docPdf':
      case 'docSend': {
        const kind = b.kind === 'receipt' ? 'receipt' : 'invoice';
        const key = 'reg/' + b.id;
        const r = await s.get(key, { type: 'json' });
        if (!r) return json(404, { error: 'Registration not found' });
        const st = await getSettings(s);
        // Assign a number the first time. The admin page sends the next number it expects (hint),
        // which keeps numbers unique even while storage is catching up.
        const field = kind === 'invoice' ? 'invoiceNo' : 'receiptNo';
        const dateField = kind === 'invoice' ? 'invoiceDate' : 'receiptDate';
        const prefix = kind === 'invoice' ? st.invoicePrefix : st.receiptPrefix;
        if (!r[field]) {
          const { blobs } = await s.list({ prefix: 'reg/' });
          let max = 0;
          for (const x of blobs) {
            const o = x.key === key ? r : await s.get(x.key, { type: 'json' });
            const m = o && o[field] && String(o[field]).match(/(\d+)$/);
            if (m) max = Math.max(max, parseInt(m[1], 10));
          }
          max = Math.max(max, (parseInt(b.hint, 10) || 1) - 1);
          r[field] = prefix + String(max + 1).padStart(4, '0');
          r[dateField] = new Date().toISOString();
        }
        const pdf = await docs.build(kind, r, st);
        if (b.action === 'docSend') {
          const to = await docs.sendDoc(kind, r, pdf);
          r[kind + 'Sent'] = true; r[kind + 'SentAt'] = new Date().toISOString(); r[kind + 'SentTo'] = to;
        }
        await s.setJSON(key, r);
        return json(200, { ok: true, reg: r, filename: `${kind === 'invoice' ? 'Invoice' : 'Receipt'}_${r[field]}.pdf`, pdf: b.action === 'docPdf' ? pdf.toString('base64') : undefined });
      }

      case 'deleteReg': {
        await s.delete('reg/' + b.id);
        return json(200, { ok: true });
      }

      default: return json(400, { error: 'Unknown action' });
    }
  } catch (e) {
    console.error(e);
    return json(500, { error: 'Server error: ' + e.message });
  }
};
