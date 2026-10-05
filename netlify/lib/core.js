// Shared logic: settings, pricing, discount codes, auth, storage.
const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');

const DEFAULT_SETTINGS = {
  courseStart: '2026-12-21',
  // Early bird ends 30 Nov 2026, 23:59 SGT
  earlyBirdEnd: '2026-11-30T23:59:59+08:00',
  early: 500,            // early bird, per person
  earlyGroup: { 2: 980, 3: 1455, 4: 1920 }, // early-bird group totals
  standard: 800,         // standard, per person
  group: { 2: 1440, 3: 2040, 4: 2560 }, // standard group totals
  certFee: 200,          // China national certification, per person (optional)
  capacity: 30,          // total seats; 0 = don't show seats left
  showSeatsLeftBelow: 10 // only show "seats left" when at or below this
};

function store(event) {
  if (event) { try { connectLambda(event); } catch (e) { /* local / already connected */ } }
  return getStore('xjtt');
}

async function getSettings(s) {
  const saved = (await s.get('settings', { type: 'json' })) || {};
  return { ...DEFAULT_SETTINGS, ...saved, group: { ...DEFAULT_SETTINGS.group, ...(saved.group || {}) }, earlyGroup: { ...DEFAULT_SETTINGS.earlyGroup, ...(saved.earlyGroup || {}) } };
}
// Each discount code is stored as its own entry ("code/NSA1") so edits never overwrite each other.
async function getCodes(s) {
  const { blobs } = await s.list({ prefix: 'code/' });
  const out = {};
  await Promise.all(blobs.map(async b => { const v = await s.get(b.key, { type: 'json' }); if (v) out[b.key.slice(5)] = v; }));
  return out;
}
async function getCode(s, k) { return k ? await s.get('code/' + k, { type: 'json' }) : null; }
async function setCode(s, k, v) { await s.setJSON('code/' + k, v); }
async function delCode(s, k) { await s.delete('code/' + k); }

function normCode(c) { return String(c || '').trim().toUpperCase().replace(/\s+/g, ''); }

// Returns {ok, code?, pct?, reason?}
function checkCode(codes, raw, now = new Date()) {
  const key = normCode(raw);
  if (!key) return { ok: false, reason: 'empty' };
  const c = codes[key];
  if (!c) return { ok: false, reason: 'invalid' };
  if (c.active === false) return { ok: false, reason: 'inactive' };
  if (c.expires && now > new Date(c.expires + 'T23:59:59+08:00')) return { ok: false, reason: 'expired' };
  if (c.maxUses && (c.used || 0) >= c.maxUses) return { ok: false, reason: 'used' };
  return { ok: true, code: key, pct: Number(c.pct) || 0 };
}

const round = n => Math.round(n * 100) / 100;

// Best price applies; discount codes do not stack with early-bird / group pricing.
function quote(settings, { seats = 1, certCount = 0, code = null }, now = new Date()) {
  seats = Math.min(4, Math.max(1, parseInt(seats, 10) || 1));
  certCount = Math.min(seats, Math.max(0, parseInt(certCount, 10) || 0));
  const early = now <= new Date(settings.earlyBirdEnd);
  let tier, course;
  if (early) {
    course = seats >= 2 ? Number(settings.earlyGroup[seats]) : settings.early;
    tier = seats >= 2 ? 'early-bird-group' : 'early-bird';
  } else if (seats >= 2) {
    course = Number(settings.group[seats]); tier = 'group';
  } else {
    course = settings.standard; tier = 'standard';
  }
  let codeApplied = false, codeNote = null;
  if (code && code.ok) {
    const codeTotal = round(settings.standard * seats * (1 - code.pct / 100));
    if (codeTotal < course) { course = codeTotal; tier = 'code:' + code.code; codeApplied = true; }
    else codeNote = 'better-price-already';
  }
  const cert = certCount * settings.certFee;
  return {
    seats, certCount, early, tier,
    course: round(course), cert, total: round(course + cert),
    perSeat: round(course / seats), standardTotal: settings.standard * seats,
    codeApplied, codeNote
  };
}

// ---------- auth (stateless signed token) ----------
function secret() {
  return process.env.ADMIN_SECRET || ('xjtt:' + (process.env.ADMIN_PASSWORD || ''));
}
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + sig;
}
function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const good = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (!p.exp || Date.now() > p.exp) return null;
  return p;
}
function safeEq(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

const json = (status, obj) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj)
});

async function seatsTaken(s) {
  const { blobs } = await s.list({ prefix: 'reg/' });
  let n = 0;
  for (const b of blobs) {
    const r = await s.get(b.key, { type: 'json' });
    if (r && r.status !== 'cancelled') n += r.seats || 1;
  }
  return n;
}

module.exports = { DEFAULT_SETTINGS, store, getSettings, getCodes, getCode, setCode, delCode, normCode, checkCode, quote, sign, verify, safeEq, json, seatsTaken };
