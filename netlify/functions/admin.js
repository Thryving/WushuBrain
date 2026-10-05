const { store, getSettings, getCodes, normCode, verify, json, DEFAULT_SETTINGS } = require('../lib/core');

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
          showSeatsLeftBelow: num(n.showSeatsLeftBelow, cur.showSeatsLeftBelow)
        };
        await s.setJSON('settings', next);
        return json(200, { ok: true, settings: next });
      }

      case 'addCodes': {
        // single: {code} or batch: {prefix, from, to}
        const codes = await getCodes(s);
        const pct = Number(b.pct);
        if (!(pct > 0 && pct <= 100)) return json(400, { error: 'Discount % must be between 1 and 100' });
        let list = [];
        if (b.code) list = String(b.code).split(/[\s,]+/).map(normCode).filter(Boolean);
        else {
          const p = normCode(b.prefix), f = parseInt(b.from, 10), t = parseInt(b.to, 10);
          if (!p || !(f >= 0) || !(t >= f) || t - f > 500) return json(400, { error: 'Check prefix and number range (max 500 codes at once)' });
          for (let i = f; i <= t; i++) list.push(p + i);
        }
        let added = 0, updated = 0;
        for (const k of list) {
          const prev = codes[k];
          codes[k] = {
            pct, maxUses: parseInt(b.maxUses, 10) || 0, expires: b.expires || '',
            note: b.note || '', active: true, used: prev ? prev.used || 0 : 0,
            createdAt: prev ? prev.createdAt : new Date().toISOString()
          };
          prev ? updated++ : added++;
        }
        await s.setJSON('codes', codes);
        return json(200, { ok: true, added, updated, codes });
      }

      case 'updateCode': {
        const codes = await getCodes(s);
        const k = normCode(b.code);
        if (!codes[k]) return json(404, { error: 'Code not found' });
        const f = b.fields || {};
        if ('active' in f) codes[k].active = !!f.active;
        if ('pct' in f) codes[k].pct = Number(f.pct);
        if ('maxUses' in f) codes[k].maxUses = parseInt(f.maxUses, 10) || 0;
        if ('expires' in f) codes[k].expires = f.expires || '';
        if ('used' in f) codes[k].used = parseInt(f.used, 10) || 0;
        if ('note' in f) codes[k].note = f.note || '';
        await s.setJSON('codes', codes);
        return json(200, { ok: true, codes });
      }

      case 'deleteCodes': {
        const codes = await getCodes(s);
        (b.codes || []).map(normCode).forEach(k => delete codes[k]);
        await s.setJSON('codes', codes);
        return json(200, { ok: true, codes });
      }

      case 'updateReg': {
        const key = 'reg/' + b.id;
        const r = await s.get(key, { type: 'json' });
        if (!r) return json(404, { error: 'Registration not found' });
        if (b.status) r.status = b.status;
        if (typeof b.adminNote === 'string') r.adminNote = b.adminNote;
        await s.setJSON(key, r);
        return json(200, { ok: true, reg: r });
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
