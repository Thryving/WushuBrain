// Invoice / receipt PDF generation + email sending.
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// Find bundled assets (works locally and on Netlify, where included_files are copied next to the function)
function asset(name) {
  const tries = [
    path.join(__dirname, '..', 'assets', name),
    path.join(__dirname, 'netlify', 'assets', name),
    path.join(process.cwd(), 'netlify', 'assets', name),
    path.join(process.env.LAMBDA_TASK_ROOT || '', 'netlify', 'assets', name),
    path.join(__dirname, name)
  ];
  for (const p of tries) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
  throw new Error('Asset not found: ' + name);
}

const NAVY = '#13325f', RED = '#c8241d', GREEN = '#1e7b34', GREY = '#666666';
const CJK_RE = /[⺀-鿿豈-﫿＀-￯　-〿]/;
const SGT = 'Asia/Singapore';

const fmtDate = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: SGT });
const money = v => '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function tierLabel(tier, seats) {
  if (!tier) return '';
  if (tier === 'early-bird') return 'Early-bird rate';
  if (tier === 'early-bird-group') return `Early-bird package (${seats} seats)`;
  if (tier === 'group') return `Group package (${seats} seats)`;
  if (tier === 'standard') return 'Standard rate';
  if (tier.startsWith('code:')) return `Discount code ${tier.slice(5)}`;
  return tier;
}

// Write text that may mix English and Chinese: Latin runs use Helvetica, CJK runs use the bundled CJK font.
function mixed(doc, str, x, y, { size = 10, bold = false, color = '#000', align = 'left', width } = {}) {
  str = String(str || '');
  const runs = []; let cur = '', curCJK = null;
  for (const ch of str) {
    const isC = CJK_RE.test(ch);
    if (curCJK === null || isC === curCJK || ch === ' ') { cur += ch; if (curCJK === null && ch !== ' ') curCJK = isC; }
    else { runs.push([cur, curCJK]); cur = ch; curCJK = isC; }
  }
  if (cur) runs.push([cur, curCJK]);
  const fontFor = c => c ? 'CJK' : (bold ? 'Helvetica-Bold' : 'Helvetica');
  let total = 0;
  for (const [t, c] of runs) { doc.font(fontFor(c)).fontSize(size); total += doc.widthOfString(t); }
  let cx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
  doc.fillColor(color);
  for (const [t, c] of runs) {
    doc.font(fontFor(c)).fontSize(size).text(t, cx, y + size * 0.86, { lineBreak: false, baseline: 'alphabetic' });
    cx += doc.widthOfString(t);
  }
  return total;
}

function build(kind, reg, settings) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `${kind === 'invoice' ? 'Invoice' : 'Receipt'} ${kind === 'invoice' ? reg.invoiceNo : reg.receiptNo}`, Author: 'ThrYving Pte Ltd' } });
    const bufs = []; doc.on('data', b => bufs.push(b)); doc.on('end', () => resolve(Buffer.concat(bufs))); doc.on('error', reject);
    doc.registerFont('CJK', asset('cjk.ttf'));
    const W = 595.28, H = 841.89, L = 50, R = W - 50;
    // PDF y grows downward in pdfkit
    const logo = asset('logo.png');
    doc.image(logo, R - 150, 34, { width: 150 });
    doc.font('Helvetica-Bold').fontSize(30).fillColor(NAVY).text(kind.toUpperCase(), L, 48, { lineBreak: false });

    // Attn block
    const p = reg.participants || [];
    const c0 = p[0] || {};
    let y = 150;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text('Attn:', L, y, { lineBreak: false });
    mixed(doc, (c0.name || '') + (c0.nameZh ? '  ' + c0.nameZh : ''), 95, y - 1, { size: 11, bold: true });
    let ay = y;
    if (c0.org) { ay += 15; mixed(doc, c0.org, 95, ay, { size: 10 }); }
    ay += 15; mixed(doc, [c0.email, c0.phone].filter(Boolean).join('  ·  '), 95, ay, { size: 9, color: GREY });

    // Meta (right)
    const meta = kind === 'invoice'
      ? [['Invoice Date', fmtDate(reg.invoiceDate)], ['Invoice Number', reg.invoiceNo], ['Invoice Due Date', fmtDate(settings.invoiceDueDate + 'T12:00:00+08:00')]]
      : [['Receipt Date', fmtDate(reg.receiptDate)], ['Receipt Number', reg.receiptNo], ...(reg.invoiceNo ? [['Invoice Number', reg.invoiceNo]] : []), ['Payment Date', fmtDate(reg.createdAt)], ['Payment Method', 'PayNow']];
    let my = y;
    for (const [k, v] of meta) {
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000');
      doc.text(k, R - 260, my, { width: 160 - 7, align: 'right', lineBreak: false });
      doc.font('Helvetica').text(String(v), R - 100, my, { lineBreak: false });
      my += 16;
    }

    // Table
    let ty = Math.max(ay, my) + 28;
    const C = { sn: L, date: 78, desc: 160, units: 372, rate: 412 };
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000');
    doc.text('S/N', C.sn, ty, { lineBreak: false }); doc.text('Date', C.date, ty, { lineBreak: false });
    doc.text('Description', C.desc, ty, { lineBreak: false }); doc.text('Units', C.units, ty, { lineBreak: false });
    doc.text('Rates', C.rate, ty, { lineBreak: false }); doc.text('Line Total', R - 100, ty, { width: 100, align: 'right', lineBreak: false });
    doc.lineWidth(1.2).strokeColor('#222').moveTo(L, ty + 15).lineTo(R, ty + 15).stroke().moveTo(L, ty + 17.5).lineTo(R, ty + 17.5).stroke();
    let ry = ty + 30;
    const w1 = mixed(doc, 'Brain Optimisation & Wushu', C.desc, ry, { size: 9.5, bold: true });
    mixed(doc, '青少儿脑优化与武术', C.desc + w1 + 5, ry, { size: 9.5 });
    ry += 13;
    mixed(doc, `3-day teacher training · 21–23 Dec 2026 · ${tierLabel(reg.expected && reg.expected.tier, reg.seats)}`, C.desc, ry, { size: 8, color: GREY });
    ry += 22;

    const seats = reg.seats || p.length || 1;
    const course = reg.expected && reg.expected.course != null ? reg.expected.course : (reg.declaredAmount || 0);
    const perSeat = Math.round((course / seats) * 100) / 100;
    const certFee = Number(settings.certFee || 200);
    let total = 0;
    const row = (sn, date, desc, sub, rate) => {
      if (sn) doc.font('Helvetica').fontSize(9.5).fillColor('#000').text(String(sn), C.sn + 6, ry, { lineBreak: false });
      if (date) doc.font('Helvetica').fontSize(8.5).fillColor('#000').text(date, C.date, ry + 0.5, { lineBreak: false });
      mixed(doc, desc, C.desc, ry, { size: 9.5 });
      doc.font('Helvetica').fontSize(9.5).fillColor('#000').text('1', C.units + 8, ry, { lineBreak: false });
      doc.text(money(rate), C.rate, ry, { lineBreak: false });
      doc.text(money(rate), R - 100, ry, { width: 100, align: 'right', lineBreak: false });
      ry += 12; mixed(doc, sub, C.desc, ry, { size: 8, color: GREY }); ry += 23;
      total += rate;
    };
    p.slice(0, seats).forEach((person, i) => {
      if (ry > 640) { doc.addPage(); ry = 60; }
      row(i + 1, '21–23 Dec 2026', (person.name || `Participant ${i + 1}`) + (person.nameZh ? '  ' + person.nameZh : ''), 'Course fee incl. course completion certificate', perSeat);
      if (person.cert === 'china') row('', '', `China Vocational Cert for ${person.name || 'Participant ' + (i + 1)}`, 'China Vocational Skills Training Certificate', certFee);
    });
    total = Math.round(total * 100) / 100;
    doc.lineWidth(1.2).strokeColor('#222').moveTo(L, ry - 8).lineTo(R, ry - 8).stroke();
    ry += 6;
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#000').text(kind === 'invoice' ? 'Grand Total' : 'Amount Received', R - 260, ry + 2, { width: 150, align: 'right', lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(13).fillColor(GREEN).text(money(total), R - 110, ry, { width: 110, align: 'right', lineBreak: false });
    if (kind === 'receipt') {
      ry += 20;
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#000').text('Balance Due', R - 260, ry, { width: 150, align: 'right', lineBreak: false });
      doc.text('$0.00', R - 110, ry, { width: 110, align: 'right', lineBreak: false });
      // PAID stamp
      doc.save().translate(105, ry - 6).rotate(-12);
      doc.lineWidth(2.5).strokeColor(RED).roundedRect(-55, -20, 110, 40, 6).stroke();
      doc.font('Helvetica-Bold').fontSize(24).fillColor(RED).text('PAID', -55, -12, { width: 110, align: 'center', lineBreak: false });
      doc.restore();
    }

    // Notes
    let ny = ry + 50;
    const notes = kind === 'invoice' ? [
      `1) For Payment by PayNow: UEN 202524083D (THRYVING PTE. LTD.)`,
      `     Please use your invoice number (${reg.invoiceNo}) as the payment reference`,
      '2) For Payment by InterBank Transfer:', '     Beneficiary Name: Thryving Pte Ltd', '     Bank Name: OCBC', '     Account Number: 604642264001 - SGD',
      '     Bank Code: 7339   Branch Code: 604', '     Bank Address: OCBC Bank, 65 Chulia Street, OCBC Centre, Singapore 049513', '     SWIFT BIC Code: OCBCSGSG',
      '3) Venue: Yuanju 缘聚, 12 Arumugam Road, LTC Bldg B, #01-01A, Singapore 409958', '     21–23 Dec 2026 (Mon–Wed) · full schedule on the course website',
      '4) For questions on this invoice, please contact Dr. Jasmine Low at +65 9340 0272',
      '5) This is a computer generated invoice. No signature is required'
    ] : [
      '1) Payment received with thanks. This receipt confirms your seat(s) for the programme.',
      '2) Programme: 21–23 Dec 2026 (Mon–Wed) · full schedule on the course website',
      '3) Venue: Yuanju 缘聚, 12 Arumugam Road, LTC Bldg B, #01-01A, Singapore 409958',
      '4) Please wear comfortable clothing and sports shoes; bring a water bottle and notebook.',
      '5) For questions, please contact Dr. Jasmine Low at +65 9340 0272',
      '6) This is a computer generated receipt. No signature is required'
    ];
    const need = notes.length * 13 + (kind === 'invoice' ? 30 : 0);
    if (ny + need > H - 125) { doc.addPage(); ny = 60; }
    if (kind === 'invoice') doc.image(asset('sgqr.png'), R - 92, ny - 4, { width: 92 });
    for (const n of notes) { mixed(doc, n, L, ny, { size: 8.5 }); ny += 13; }

    // Closing
    mixed(doc, 'Move the Mind  ·  Move the Body  ·  Move the Future', W / 2, H - 108, { size: 13, bold: true, color: NAVY, align: 'center' });
    mixed(doc, '动脑 · 动身 · 动未来 —— 期待与您相见！', W / 2, H - 88, { size: 12, color: RED, align: 'center' });
    mixed(doc, 'ThrYving Pte Ltd  ·  UEN 202524083D', W / 2, H - 48, { size: 7.5, color: GREY, align: 'center' });
    doc.end();
  });
}

async function sendDoc(kind, reg, pdf) {
  const { SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) throw new Error('Email is not set up yet: add SMTP_USER and SMTP_PASS (Zoho app password) in Netlify environment variables, then redeploy.');
  const nodemailer = require('nodemailer');
  const tx = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtppro.zoho.com',
    port: Number(process.env.SMTP_PORT || 465), secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  const c0 = (reg.participants || [])[0] || {};
  if (!c0.email) throw new Error('This registration has no email address');
  const no = kind === 'invoice' ? reg.invoiceNo : reg.receiptNo;
  const subject = kind === 'invoice'
    ? `Invoice ${no} – 青少儿脑优化与武术 Brain Optimisation & Wushu (21–23 Dec 2026)`
    : `Receipt ${no} – 青少儿脑优化与武术 Brain Optimisation & Wushu (21–23 Dec 2026)`;
  const name = c0.name || '';
  const html = kind === 'invoice' ? `
<p>${name} 您好，</p>
<p>感谢您报名 <b>青少儿脑优化与武术</b> 3天师资培训（2026年12月21–23日）。附件为您的发票 <b>${no}</b>。请通过 PayNow（UEN 202524083D）付款，并以发票号码作为付款参考。</p>
<hr>
<p>Dear ${name},</p>
<p>Thank you for registering for the <b>Brain Optimisation &amp; Wushu</b> 3-day teacher training (21–23 Dec 2026). Please find attached your invoice <b>${no}</b>. Payment can be made by PayNow (UEN 202524083D) — please use the invoice number as the reference.</p>
<p>Questions? WhatsApp Dr. Jasmine Low at +65 9340 0272.</p>
<p>动脑 · 动身 · 动未来<br>Move the Mind · Move the Body · Move the Future</p>
<p>ThrYving Pte Ltd</p>` : `
<p>${name} 您好，</p>
<p>我们已收到您的付款，谢谢！附件为您的收据 <b>${no}</b>，您的名额已确认。期待12月21日与您相见！</p>
<hr>
<p>Dear ${name},</p>
<p>We have received your payment — thank you! Please find attached your receipt <b>${no}</b>. Your seat(s) are confirmed for 21–23 Dec 2026 at Yuanju 缘聚, 12 Arumugam Road, #01-01A.</p>
<p>Questions? WhatsApp Dr. Jasmine Low at +65 9340 0272.</p>
<p>动脑 · 动身 · 动未来<br>Move the Mind · Move the Body · Move the Future</p>
<p>ThrYving Pte Ltd</p>`;
  await tx.sendMail({
    from: `"ThrYving Pte Ltd" <${SMTP_USER}>`,
    to: c0.email,
    bcc: SMTP_USER,
    replyTo: SMTP_USER,
    subject, html,
    attachments: [{ filename: `${kind === 'invoice' ? 'Invoice' : 'Receipt'}_${no}.pdf`, content: pdf, contentType: 'application/pdf' }]
  });
  return c0.email;
}

module.exports = { build, sendDoc, tierLabel };
