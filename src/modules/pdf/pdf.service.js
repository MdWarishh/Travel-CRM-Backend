/**
 * pdf.service.js
 *
 * Generates a landscape (1000×600px) multi-page itinerary PDF
 * using Puppeteer + an inline HTML template.
 *
 * Pages produced (itinerary):
 *  1. Cover page
 *  2. One page per itinerary day
 *  3. Inclusions page
 *  4. Exclusions + Policies page
 *  5. Accounts / Payment page
 *  6. Thank You page
 *
 * Booking Voucher: 2-page A4 PDF with payment summary
 */

import puppeteer from 'puppeteer';
import { format } from 'date-fns';

// ─────────────────────────────────────────────
// BROWSER SINGLETON
// ─────────────────────────────────────────────
let _browser = null;
let _browserLaunchPromise = null;

async function getBrowser() {
  if (_browser && _browser.connected) return _browser;
  if (_browserLaunchPromise) return _browserLaunchPromise;

  _browserLaunchPromise = puppeteer
    .launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--hide-scrollbars',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-first-run',
        '--safebrowsing-disable-auto-update',
        '--font-render-hinting=none',
      ],
    })
    .then((browser) => {
      _browser = browser;
      _browserLaunchPromise = null;
      browser.on('disconnected', () => {
        _browser = null;
        _browserLaunchPromise = null;
      });
      return browser;
    })
    .catch((err) => {
      _browserLaunchPromise = null;
      throw err;
    });

  return _browserLaunchPromise;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const fmt    = (date) => (date ? format(new Date(date), 'dd MMM yyyy') : '—');
const esc    = (str) => String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nl2br  = (str) => esc(str ?? '').replace(/\n/g, '<br/>');
const inr    = (n)   => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

// ─────────────────────────────────────────────
// ITINERARY PDF BUILDER  (unchanged)
// ─────────────────────────────────────────────
function buildHtml(itinerary, { customerName, travelDate, numberOfTravelers }) {
  const theme = itinerary.theme ?? {};
  const primary = theme.primaryColor ?? '#1a56db';
  const bg = theme.backgroundColor ?? '#ffffff';
  const text = theme.textColor ?? '#111827';
  const accent = theme.accentColor ?? '#f59e0b';

  const policies = itinerary.policies ?? {};
  const thankYou = itinerary.thankYou ?? {};
  const accounts = itinerary.accounts ?? [];

  const coverPage = `
<div class="page cover-page" style="background-image: url('${esc(itinerary.heroImageUrl ?? '')}');">
  <div class="cover-overlay"></div>
  <div class="cover-content">
    <div class="cover-left">
      ${itinerary.heroImageUrl
        ? `<img class="cover-hero" src="${esc(itinerary.heroImageUrl)}" alt="cover"/>`
        : `<div class="cover-hero-placeholder"></div>`}
    </div>
    <div class="cover-right">
      <p class="cover-tagline">Travel Itinerary</p>
      <h1 class="cover-title">${esc(itinerary.title)}</h1>
      ${itinerary.durationLabel ? `<div class="cover-badge">${esc(itinerary.durationLabel)}</div>` : ''}
      <div class="cover-meta">
        ${customerName ? `<div class="meta-row"><span class="meta-icon">👤</span><span>${esc(customerName)}</span></div>` : ''}
        ${itinerary.destination ? `<div class="meta-row"><span class="meta-icon">📍</span><span>${esc(itinerary.destination)}</span></div>` : ''}
        ${itinerary.startPoint ? `<div class="meta-row"><span class="meta-icon">🛫</span><span>${esc(itinerary.startPoint)} → ${esc(itinerary.endPoint ?? '')}</span></div>` : ''}
        ${travelDate ? `<div class="meta-row"><span class="meta-icon">📅</span><span>${fmt(travelDate)}</span></div>` : ''}
        ${numberOfTravelers ? `<div class="meta-row"><span class="meta-icon">👥</span><span>${numberOfTravelers} Traveler${numberOfTravelers > 1 ? 's' : ''}</span></div>` : ''}
        ${itinerary.totalPrice ? `<div class="meta-row price-row"><span class="meta-icon">💰</span><span>₹${Number(itinerary.totalPrice).toLocaleString('en-IN')}</span></div>` : ''}
      </div>
    </div>
  </div>
</div>`;

  const dayPages = (itinerary.days ?? []).map((day) => {
    const images = day.images ?? [];
    const layout = day.imageLayout ?? 'IMAGE_TOP';
    const imageBlock = (cls = '') => images.length
      ? images.map((img) => `<img class="day-img ${cls}" src="${esc(img.url)}" alt="${esc(img.altText ?? '')}" />`).join('')
      : '';

    let bodyHtml = '';
    if (layout === 'IMAGE_RIGHT') {
      bodyHtml = `<div class="day-body-split"><div class="day-text-col">${day.description ? `<p class="day-description">${nl2br(day.description)}</p>` : ''}${quickFacts(day)}</div>${images.length ? `<div class="day-img-col">${imageBlock('img-right')}</div>` : ''}</div>`;
    } else if (layout === 'GRID') {
      bodyHtml = `<div class="day-body-stack">${day.description ? `<p class="day-description">${nl2br(day.description)}</p>` : ''}${quickFacts(day)}${images.length ? `<div class="day-img-grid">${imageBlock('img-grid')}</div>` : ''}</div>`;
    } else {
      bodyHtml = `<div class="day-body-stack">${images.length ? `<div class="day-img-row">${imageBlock('img-top')}</div>` : ''}${day.description ? `<p class="day-description">${nl2br(day.description)}</p>` : ''}${quickFacts(day)}</div>`;
    }

    return `
<div class="page day-page">
  <div class="day-header" style="background:${primary};">
    <div class="day-number">Day ${day.dayNumber}</div>
    <div class="day-title-wrap">
      <h2 class="day-title">${esc(day.title ?? '')}</h2>
      ${day.date ? `<span class="day-date">${fmt(day.date)}</span>` : ''}
      ${day.destination ? `<span class="day-dest">📍 ${esc(day.destination)}</span>` : ''}
    </div>
  </div>
  <div class="day-body">${bodyHtml}</div>
</div>`;
  });

  const inclusionsPage = (itinerary.inclusions || itinerary.exclusions) ? `
<div class="page info-page">
  <div class="info-page-header" style="background:${primary};"><h2>Inclusions & Exclusions</h2></div>
  <div class="info-two-col">
    <div class="info-col"><h3 class="info-col-title" style="color:${primary};">✅ Inclusions</h3><div class="info-content">${nl2br(itinerary.inclusions ?? 'None specified')}</div></div>
    <div class="info-col"><h3 class="info-col-title" style="color:#e11d48;">❌ Exclusions</h3><div class="info-content">${nl2br(itinerary.exclusions ?? 'None specified')}</div></div>
  </div>
</div>` : '';

  const policiesPage = (policies.bookingPolicy || policies.cancellationPolicy || policies.paymentTerms) ? `
<div class="page info-page">
  <div class="info-page-header" style="background:${primary};"><h2>Booking Policies</h2></div>
  <div class="policy-grid">
    ${policies.bookingPolicy ? `<div class="policy-block"><h3>📋 Booking Policy</h3><p>${nl2br(policies.bookingPolicy)}</p></div>` : ''}
    ${policies.cancellationPolicy ? `<div class="policy-block"><h3>🔄 Cancellation Policy</h3><p>${nl2br(policies.cancellationPolicy)}</p></div>` : ''}
    ${policies.paymentTerms ? `<div class="policy-block"><h3>💳 Payment Terms</h3><p>${nl2br(policies.paymentTerms)}</p></div>` : ''}
    ${policies.otherPolicies ? `<div class="policy-block"><h3>📌 Other Policies</h3><p>${nl2br(policies.otherPolicies)}</p></div>` : ''}
  </div>
</div>` : '';

  const accountsPage = accounts.length ? `
<div class="page info-page">
  <div class="info-page-header" style="background:${primary};"><h2>Payment Details</h2></div>
  <div class="accounts-grid">
    ${accounts.map((acc) => `
    <div class="account-card">
      <div class="account-details">
        ${acc.bankName ? `<div class="acc-row"><span class="acc-label">Bank</span><span>${esc(acc.bankName)}</span></div>` : ''}
        ${acc.accountName ? `<div class="acc-row"><span class="acc-label">Account Name</span><span>${esc(acc.accountName)}</span></div>` : ''}
        ${acc.accountNumber ? `<div class="acc-row"><span class="acc-label">Account No.</span><span class="mono">${esc(acc.accountNumber)}</span></div>` : ''}
        ${acc.ifscCode ? `<div class="acc-row"><span class="acc-label">IFSC</span><span class="mono">${esc(acc.ifscCode)}</span></div>` : ''}
        ${acc.upiId ? `<div class="acc-row"><span class="acc-label">UPI</span><span class="mono">${esc(acc.upiId)}</span></div>` : ''}
      </div>
      ${acc.upiQrImageUrl ? `<div class="qr-wrap"><img class="qr-img" src="${esc(acc.upiQrImageUrl)}" alt="QR"/><p class="qr-label">Scan to Pay</p></div>` : ''}
    </div>`).join('')}
  </div>
  ${thankYou.companyName ? `<div class="company-footer"><div class="company-info"><strong>${esc(thankYou.companyName)}</strong>${thankYou.companyAddress ? `<p>${esc(thankYou.companyAddress)}</p>` : ''}</div><div class="company-contact">${thankYou.companyPhone ? `<span>📞 ${esc(thankYou.companyPhone)}</span>` : ''}${thankYou.companyEmail ? `<span>✉️ ${esc(thankYou.companyEmail)}</span>` : ''}${thankYou.companyWebsite ? `<span>🌐 ${esc(thankYou.companyWebsite)}</span>` : ''}</div></div>` : ''}
</div>` : '';

  const thankYouPage = `
<div class="page thankyou-page" style="${thankYou.backgroundImageUrl ? `background-image:url('${esc(thankYou.backgroundImageUrl)}');background-size:cover;background-position:center;` : `background:${primary};`}">
  <div class="thankyou-overlay"></div>
  <div class="thankyou-content">
    <div class="thankyou-icon">✈️</div>
    <h1 class="thankyou-heading">Thank You!</h1>
    <p class="thankyou-message">${nl2br(thankYou.message ?? 'We look forward to making your journey unforgettable.')}</p>
    ${thankYou.findUsText ? `<div class="find-us"><h3>Find Us</h3><p>${nl2br(thankYou.findUsText)}</p></div>` : ''}
    ${thankYou.companyName ? `<div class="thankyou-company">${esc(thankYou.companyName)}</div>` : ''}
  </div>
</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=1000"/>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root { --primary: ${primary}; --bg: ${bg}; --text: ${text}; --accent: ${accent}; --font: -apple-system, 'Segoe UI', system-ui, sans-serif; }
  html, body { width: 1000px; background: white; font-family: var(--font); color: var(--text); }
  .page { width: 1000px; height: 600px; overflow: hidden; position: relative; page-break-after: always; page-break-inside: avoid; background: var(--bg); }
  .cover-page { display: flex; background-size: cover; background-position: center; }
  .cover-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.35); z-index: 0; }
  .cover-content { position: relative; z-index: 1; display: flex; width: 100%; height: 100%; }
  .cover-left { width: 45%; height: 100%; overflow: hidden; flex-shrink: 0; }
  .cover-hero { width: 100%; height: 100%; object-fit: cover; }
  .cover-hero-placeholder { width: 100%; height: 100%; background: linear-gradient(135deg, var(--primary), #0f2d6b); }
  .cover-right { flex: 1; padding: 48px 40px; display: flex; flex-direction: column; justify-content: center; background: rgba(0,0,0,0.55); color: #fff; }
  .cover-tagline { font-size: 12px; letter-spacing: 3px; text-transform: uppercase; opacity: .7; margin-bottom: 12px; }
  .cover-title { font-size: 36px; font-weight: 700; line-height: 1.2; margin-bottom: 16px; }
  .cover-badge { display: inline-block; background: var(--accent); color: #111; font-size: 13px; font-weight: 600; padding: 4px 14px; border-radius: 99px; margin-bottom: 24px; }
  .cover-meta { display: flex; flex-direction: column; gap: 10px; }
  .meta-row { display: flex; align-items: center; gap: 10px; font-size: 14px; opacity: .9; }
  .meta-icon { font-size: 16px; }
  .price-row { font-size: 18px; font-weight: 700; color: var(--accent); opacity: 1; }
  .day-page { display: flex; flex-direction: column; }
  .day-header { display: flex; align-items: center; gap: 20px; padding: 14px 32px; color: #fff; flex-shrink: 0; }
  .day-number { font-size: 13px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; opacity: .85; border-right: 1px solid rgba(255,255,255,.3); padding-right: 20px; min-width: 60px; }
  .day-title-wrap { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
  .day-title { font-size: 22px; font-weight: 700; }
  .day-date, .day-dest { font-size: 13px; opacity: .8; }
  .day-body { flex: 1; overflow: hidden; padding: 20px 32px; }
  .day-body-stack { display: flex; flex-direction: column; height: 100%; gap: 14px; }
  .day-img-row { display: flex; gap: 10px; height: 220px; flex-shrink: 0; }
  .img-top { flex: 1; object-fit: cover; border-radius: 8px; width: 0; min-width: 0; }
  .day-body-split { display: flex; height: 100%; gap: 20px; }
  .day-text-col { flex: 1; overflow: hidden; }
  .day-img-col { width: 280px; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
  .img-right { width: 100%; flex: 1; object-fit: cover; border-radius: 8px; min-height: 0; }
  .day-img-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; }
  .img-grid { width: 100%; height: 120px; object-fit: cover; border-radius: 8px; }
  .day-description { font-size: 14px; line-height: 1.65; color: var(--text); overflow: hidden; }
  .quick-facts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .fact-pill { display: flex; align-items: center; gap: 6px; background: #f3f4f6; padding: 5px 12px; border-radius: 99px; font-size: 12px; font-weight: 500; }
  .info-page { display: flex; flex-direction: column; }
  .info-page-header { padding: 16px 36px; color: #fff; flex-shrink: 0; }
  .info-page-header h2 { font-size: 22px; font-weight: 700; }
  .info-two-col { display: flex; flex: 1; gap: 0; overflow: hidden; }
  .info-col { flex: 1; padding: 24px 32px; overflow: hidden; border-right: 1px solid #e5e7eb; }
  .info-col:last-child { border-right: none; }
  .info-col-title { font-size: 15px; font-weight: 700; margin-bottom: 12px; }
  .info-content { font-size: 13px; line-height: 1.75; color: #374151; }
  .policy-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; flex: 1; overflow: hidden; }
  .policy-block { padding: 20px 28px; border-right: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; overflow: hidden; }
  .policy-block h3 { font-size: 13px; font-weight: 700; margin-bottom: 8px; color: #374151; }
  .policy-block p { font-size: 12px; line-height: 1.7; color: #6b7280; }
  .accounts-grid { display: flex; gap: 24px; padding: 24px 36px; flex: 1; overflow: hidden; flex-wrap: wrap; }
  .account-card { display: flex; gap: 20px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px 24px; flex: 1; min-width: 280px; }
  .account-details { flex: 1; display: flex; flex-direction: column; gap: 8px; }
  .acc-row { display: flex; flex-direction: column; gap: 2px; }
  .acc-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; }
  .acc-row span:last-child { font-size: 13px; font-weight: 600; color: #111; }
  .mono { font-family: 'Courier New', monospace !important; }
  .qr-wrap { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .qr-img { width: 90px; height: 90px; object-fit: contain; border-radius: 8px; border: 1px solid #e5e7eb; }
  .qr-label { font-size: 10px; color: #6b7280; }
  .company-footer { display: flex; justify-content: space-between; align-items: center; padding: 14px 36px; border-top: 1px solid #e5e7eb; background: #f9fafb; font-size: 12px; color: #374151; }
  .company-contact { display: flex; gap: 20px; }
  .company-contact span { display: flex; align-items: center; gap: 6px; }
  .thankyou-page { display: flex; align-items: center; justify-content: center; }
  .thankyou-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.55); z-index: 0; }
  .thankyou-content { position: relative; z-index: 1; text-align: center; color: #fff; max-width: 600px; padding: 40px; }
  .thankyou-icon { font-size: 48px; margin-bottom: 16px; }
  .thankyou-heading { font-size: 48px; font-weight: 800; margin-bottom: 16px; }
  .thankyou-message { font-size: 16px; line-height: 1.7; opacity: .9; margin-bottom: 24px; }
  .find-us { border-top: 1px solid rgba(255,255,255,.3); padding-top: 16px; margin-top: 16px; }
  .find-us h3 { font-size: 13px; letter-spacing: 2px; text-transform: uppercase; opacity: .7; margin-bottom: 8px; }
  .find-us p { font-size: 13px; opacity: .85; }
  .thankyou-company { margin-top: 24px; font-size: 14px; font-weight: 700; letter-spacing: 1px; opacity: .7; }
  @media print { body { margin: 0; } .page { page-break-after: always; } }
</style>
</head>
<body>
${coverPage}
${dayPages.join('\n')}
${inclusionsPage}
${policiesPage}
${accountsPage}
${thankYouPage}
</body>
</html>`;
}

function quickFacts(day) {
  const facts = [
    day.hotel && { icon: '🏨', label: day.hotel },
    day.meals && { icon: '🍽️', label: day.meals },
    day.transfers && { icon: '🚐', label: day.transfers },
    day.sightseeing && { icon: '🗺️', label: day.sightseeing },
    day.activities && { icon: '🎯', label: day.activities },
  ].filter(Boolean);
  if (!facts.length) return '';
  return `<div class="quick-facts">${facts.map((f) => `<div class="fact-pill"><span>${f.icon}</span><span>${esc(f.label)}</span></div>`).join('')}</div>`;
}

// ─────────────────────────────────────────────
// PUBLIC API — ITINERARY PDF
// ─────────────────────────────────────────────
export const generateItineraryPdf = async (itinerary, opts = {}) => {
  const html = buildHtml(itinerary, opts);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      const blocked = ['fonts.googleapis.com', 'fonts.gstatic.com', 'google-analytics.com', 'googletagmanager.com', 'facebook.com', 'analytics', 'tracking'];
      if (blocked.some((b) => url.includes(b))) req.abort();
      else req.continue();
    });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 300));
    const pdfRaw = await page.pdf({ width: '1000px', height: '600px', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    const pdfBuffer = Buffer.from(pdfRaw);
    const header = pdfBuffer.slice(0, 4).toString('ascii');
    if (header !== '%PDF') throw new Error(`Invalid PDF generated. Header was: ${header}`);
    return pdfBuffer;
  } finally {
    await page.close().catch(() => {});
  }
};

// ─────────────────────────────────────────────
// BOOKING VOUCHER PDF  — A4, 2 pages
// ─────────────────────────────────────────────
export const generateBookingVoucherPdf = async (booking) => {
  const html = buildVoucherHtml(booking);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on('request', (req) => req.continue());
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 500));
    const pdfRaw = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' } });
    return Buffer.from(pdfRaw);
  } finally {
    await page.close().catch(() => {});
  }
};

// ─────────────────────────────────────────────
// VOUCHER HTML BUILDER  — full payment section
// ─────────────────────────────────────────────
function buildVoucherHtml(booking) {
  const customer    = booking.customer       ?? {};
  const hotels      = booking.hotelBookings  ?? [];
  const flights     = booking.flightBookings ?? [];
  const transports  = booking.transportBookings ?? [];
  const days        = booking.days           ?? [];
  const payments    = booking.bookingPayments ?? [];  // ✅ installment records

  // ── Payment calculations ───────────────────
  const totalAmount   = Number(booking.totalAmount  ?? 0);
  const advancePaid   = Number(booking.advancePaid  ?? 0);
  const dueAmount     = Math.max(0, totalAmount - advancePaid);
  const progressPct   = totalAmount > 0 ? Math.min(100, Math.round((advancePaid / totalAmount) * 100)) : 0;

  // Per-person breakdown
  const pricePerAdult = Number(booking.pricePerAdult ?? 0);
  const pricePerChild = Number(booking.pricePerChild ?? 0);
  const adults        = Number(booking.adults  ?? 0);
  const children      = Number(booking.children ?? 0);

  const hasPerPerson  = pricePerAdult > 0;
  const breakdownRows = hasPerPerson ? [
    adults   > 0 ? { label: `Adults (${adults})`,    unit: pricePerAdult, qty: adults,   total: pricePerAdult * adults } : null,
    children > 0 && pricePerChild > 0 ? { label: `Children (${children})`, unit: pricePerChild, qty: children, total: pricePerChild * children } : null,
  ].filter(Boolean) : [];

  // Payment status label + color
  const psRaw = (booking.paymentStatus ?? 'PENDING').toUpperCase();
  const psLabel = psRaw === 'PAID' ? 'Fully Paid' : psRaw === 'PARTIAL' || psRaw === 'PARTIALLY_PAID' ? 'Partially Paid' : 'Payment Pending';
  const psBg    = psRaw === 'PAID' ? '#d1fae5' : psRaw.includes('PARTIAL') ? '#fef3c7' : '#fee2e2';
  const psColor = psRaw === 'PAID' ? '#065f46' : psRaw.includes('PARTIAL') ? '#92400e' : '#991b1b';
  const psDot   = psRaw === 'PAID' ? '#10b981' : psRaw.includes('PARTIAL') ? '#f59e0b' : '#ef4444';

  // Helpers
  const fmtDate     = (d) => { if (!d) return '—'; try { return format(new Date(d), 'dd MMM yyyy'); } catch { return '—'; } };
  const fmtDateTime = (d) => { if (!d) return '—'; try { return format(new Date(d), 'dd MMM yyyy, hh:mm a'); } catch { return '—'; } };

  const logoHtml = booking.companyLogoUrl
    ? `<img src="${booking.companyLogoUrl}" style="max-height:70px;max-width:160px;object-fit:contain;" alt="Logo" />`
    : `<div style="font-size:22px;font-weight:900;color:#8B1A1A;font-family:Georgia,serif;">Travel CRM</div>`;

  // Inclusions
  const inclusionLines = (booking.inclusions ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

  // Day-wise
  const dayWiseRaw = booking.dayWiseItinerary ?? '';
  const hasDays    = days.length > 0;
  let dayWiseSection = '';
  if (hasDays) {
    dayWiseSection = days.map((d) => `
      <div style="margin-bottom:18px;">
        <div style="font-size:14px;font-weight:700;color:#1f2937;margin-bottom:4px;">Day ${String(d.dayNumber).padStart(2, '0')} ${d.title ? '– ' + esc(d.title) : ''}</div>
        <div style="font-size:12px;color:#374151;line-height:1.7;">${esc(d.description ?? d.notes ?? '').replace(/\n/g, '<br/>')}</div>
      </div>`).join('');
  } else if (dayWiseRaw) {
    dayWiseSection = dayWiseRaw.split('\n').map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return '<div style="height:8px"></div>';
      const isDay = /^day\s*0?\d/i.test(trimmed);
      if (isDay) return `<div style="font-size:13px;font-weight:700;color:#1f2937;margin-top:12px;margin-bottom:3px;">${esc(trimmed)}</div>`;
      return `<div style="font-size:12px;color:#374151;line-height:1.7;">${esc(trimmed)}</div>`;
    }).join('');
  }

  // Table row helpers
  const fieldRow = (label, value) => `
    <tr>
      <td style="padding:10px 16px;font-size:13px;font-weight:600;color:#374151;border-bottom:1px solid #f3f4f6;width:38%;">${esc(label)}</td>
      <td style="padding:10px 16px;font-size:13px;color:#1f2937;font-weight:500;border-bottom:1px solid #f3f4f6;background:#fafafa;">${value}</td>
    </tr>`;

  const roomTypes = ['Standard', 'Delux', 'Suite'];
  const currentRoom = (hotels[0]?.roomType ?? '').toLowerCase();
  const roomCheckboxes = roomTypes.map((r) => {
    const checked = currentRoom === r.toLowerCase() || currentRoom === r.toLowerCase().replace('x', 'xe');
    return `<span style="margin-right:18px;font-size:13px;color:#374151;">
      <span style="display:inline-block;width:14px;height:14px;border:2px solid ${checked ? '#8B1A1A' : '#d1d5db'};border-radius:50%;background:${checked ? '#8B1A1A' : '#fff'};vertical-align:middle;margin-right:5px;"></span>${r}</span>`;
  }).join('');

  const hotelRows = hotels.map((h, i) => `
    <tr style="background:${i % 2 === 0 ? '#fff' : '#f9f9f9'};">
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:12px;">${esc(h.city)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:12px;font-weight:600;">${esc(h.hotelName)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:12px;">${fmtDate(h.checkIn)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:12px;">${fmtDate(h.checkOut)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:12px;text-align:center;">${h.nights}N</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:12px;">${h.rooms}R × ${h.guests}G${h.extraBed ? ' + Bed' : ''}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:12px;">${esc(h.mealPlan)}</td>
    </tr>`).join('');

  const flightRows = flights.map((f, i) => `
    <tr style="background:${i % 2 === 0 ? '#fff' : '#f9f9f9'};">
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:12px;font-weight:600;">${esc(f.from)} → ${esc(f.to)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:12px;">${esc(f.airline ?? '—')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:12px;font-family:monospace;">${esc(f.flightNumber ?? '—')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:12px;">${fmtDateTime(f.departure)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:12px;">${fmtDateTime(f.arrival)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:12px;font-weight:700;font-family:monospace;">${esc(f.pnr ?? '—')}</td>
    </tr>`).join('');

  const transportRows = transports.map((t, i) => `
    <tr style="background:${i % 2 === 0 ? '#fff' : '#f9f9f9'};">
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:12px;font-weight:600;">${esc(t.vehicleType)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:12px;">${esc(t.pickup)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:12px;">${esc(t.drop)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:12px;">${fmtDateTime(t.datetime)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:12px;">${t.driverName ? esc(t.driverName) : '—'}${t.driverPhone ? `<br/><span style="font-size:11px;color:#6b7280;">${esc(t.driverPhone)}</span>` : ''}</td>
    </tr>`).join('');

  // ── Payment history rows ──────────────────
  const MODE_ICONS = { CASH: '💵', UPI: '📱', BANK_TRANSFER: '🏦', CHEQUE: '📄', CARD: '💳' };
  const paymentRows = payments.map((p, i) => `
    <tr style="background:${i % 2 === 0 ? '#fff' : '#f9fafb'};">
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#6b7280;">${i + 1}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;font-weight:700;color:#111827;">${inr(p.amount)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#374151;">${MODE_ICONS[p.mode] ?? '💰'} ${esc(p.mode)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#374151;">${fmtDate(p.paidAt)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#6b7280;font-style:italic;">${esc(p.note ?? '—')}</td>
    </tr>`).join('');

  // ── Progress bar fill color ───────────────
  const barColor = progressPct === 100 ? '#10b981' : progressPct > 50 ? '#3b82f6' : '#f59e0b';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1f2937; background: #fff; }
  .page { width: 210mm; min-height: 297mm; padding: 28px 32px; background: #fff; position: relative; }
  .page-break { page-break-after: always; }
  h2.sec { font-size: 13px; font-weight: 700; color: #8B1A1A; text-transform: uppercase;
            letter-spacing: 1.5px; border-bottom: 2px solid #8B1A1A; padding-bottom: 5px; margin: 20px 0 10px; }
  table.data { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  table.data thead tr { background: #8B1A1A; }
  table.data thead th { padding: 8px 10px; font-size: 11px; font-weight: 600; color: #fff;
                         text-transform: uppercase; letter-spacing: 0.5px; text-align: left; }
  table.data thead th:first-child { border-radius: 6px 0 0 0; }
  table.data thead th:last-child  { border-radius: 0 6px 0 0; }
  .incl-list { list-style: none; padding: 0; }
  .incl-list li { font-size: 12.5px; color: #374151; padding: 5px 0; padding-left: 18px; position: relative; line-height: 1.5; }
  .incl-list li::before { content: "•"; position: absolute; left: 0; color: #8B1A1A; font-weight: 700; }
  .footer-note { margin-top: 28px; padding-top: 12px; border-top: 1px solid #e5e7eb;
                  font-size: 11px; color: #9ca3af; text-align: center; }
</style>
</head>
<body>

<!-- ════════ PAGE 1 — Booking Form ════════ -->
<div class="page page-break">

  <!-- Logo + Ref -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
    <div>${logoHtml}</div>
    <div style="text-align:right;">
      <div style="font-size:9px;color:#9ca3af;text-transform:uppercase;letter-spacing:2px;">Ref No.</div>
      <div style="font-size:13px;font-weight:700;font-family:monospace;color:#374151;">#${esc(String(booking.id ?? '').slice(-8).toUpperCase())}</div>
    </div>
  </div>

  <!-- Title bar -->
  <div style="background:#8B1A1A;color:#fff;padding:10px 18px;border-radius:6px;display:flex;align-items:center;gap:10px;margin-bottom:20px;">
    <span style="font-size:15px;font-weight:700;letter-spacing:0.5px;">BOOKING CONFIRMATION VOUCHER</span>
    <span style="margin-left:auto;font-size:18px;">✓</span>
  </div>

  <!-- Form fields -->
  <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:16px;">
    <tbody>
      ${fieldRow('Full Name', `<strong>${esc(customer.name ?? '—')}</strong>`)}
      ${fieldRow('Start Details', esc(booking.startDetails ?? '—'))}
      ${fieldRow('End Details',   esc(booking.endDetails   ?? '—'))}
      ${fieldRow('Check In',  booking.travelStart ? `<strong>${fmtDate(booking.travelStart)}</strong>` : '—')}
      ${fieldRow('Check Out', booking.travelEnd   ? `<strong>${fmtDate(booking.travelEnd)}</strong>`   : '—')}
      ${fieldRow('Phone', `<strong>${esc(customer.phone ?? '—')}</strong>`)}
      ${fieldRow('Email', esc(customer.email ?? '—'))}
    </tbody>
  </table>

  <!-- Room Preference -->
  <div style="margin-bottom:14px;">
    <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:8px;">Room Preference</div>
    <div>${roomCheckboxes}</div>
  </div>

  <!-- Adults / Children / Child Age / Tour Days -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
    <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <div style="background:#f3f4f6;padding:6px 12px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Number of Adults</div>
      <div style="padding:10px 12px;font-size:14px;font-weight:700;color:#8B1A1A;text-align:center;">${String(booking.adults ?? 0).padStart(2, '0')} ADULTS</div>
    </div>
    <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <div style="background:#f3f4f6;padding:6px 12px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Number of Child</div>
      <div style="padding:10px 12px;font-size:14px;font-weight:700;color:#8B1A1A;text-align:center;">${String(booking.children ?? 0).padStart(2, '0')} CHILDREN</div>
    </div>
    <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <div style="background:#f3f4f6;padding:6px 12px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Child Age</div>
      <div style="padding:10px 12px;font-size:14px;font-weight:700;color:#8B1A1A;text-align:center;">${booking.childAge ? esc(booking.childAge) : '00 YEARS'}</div>
    </div>
    <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <div style="background:#f3f4f6;padding:6px 12px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">No. Tour Days</div>
      <div style="padding:10px 12px;font-size:14px;font-weight:700;color:#8B1A1A;text-align:center;">${booking.tourDays ? esc(booking.tourDays.toUpperCase()) : '—'}</div>
    </div>
  </div>

  <!-- Hotels -->
  ${hotels.length ? `
  <h2 class="sec">🏨 Hotel Details</h2>
  <table class="data">
    <thead><tr><th>City</th><th>Hotel</th><th>Check-in</th><th>Check-out</th><th>Nights</th><th>Rooms</th><th>Meal</th></tr></thead>
    <tbody>${hotelRows}</tbody>
  </table>` : ''}

  <!-- Flights -->
  ${flights.length ? `
  <h2 class="sec">✈️ Flight Details</h2>
  <table class="data">
    <thead><tr><th>Route</th><th>Airline</th><th>Flight No</th><th>Departure</th><th>Arrival</th><th>PNR</th></tr></thead>
    <tbody>${flightRows}</tbody>
  </table>` : ''}

  <!-- Transport -->
  ${transports.length ? `
  <h2 class="sec">🚗 Transport Details</h2>
  <table class="data">
    <thead><tr><th>Vehicle</th><th>Pickup</th><th>Drop</th><th>Date & Time</th><th>Driver</th></tr></thead>
    <tbody>${transportRows}</tbody>
  </table>` : ''}

  <div class="footer-note">
    This is a computer-generated voucher · Generated on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
  </div>
</div>

<!-- ════════ PAGE 2 — Itinerary + Inclusions + Payment Summary ════════ -->
<div class="page">

  <!-- Header repeat -->
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #8B1A1A;">
    <div>${logoHtml}</div>
    <div style="text-align:right;font-size:12px;color:#6b7280;">
      <strong style="color:#1f2937;">${esc(customer.name ?? '')}</strong><br/>
      ${booking.travelStart ? fmtDate(booking.travelStart) : ''} ${booking.travelEnd ? '→ ' + fmtDate(booking.travelEnd) : ''}
    </div>
  </div>

  ${(dayWiseSection || dayWiseRaw) ? `
  <h2 class="sec">Confirmed Itinerary And Inclusions</h2>
  <div style="margin-bottom:20px;">
    <div style="font-size:11px;font-weight:700;color:#8B1A1A;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;">Day Wise Itinerary</div>
    <div>${dayWiseSection || esc(dayWiseRaw).replace(/\n/g, '<br/>')}</div>
  </div>` : ''}

  ${inclusionLines.length ? `
  <div style="margin-bottom:20px;">
    <div style="font-size:11px;font-weight:700;color:#8B1A1A;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px;">Inclusions</div>
    <ul class="incl-list">${inclusionLines.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
  </div>` : ''}

  <!-- ════ PAYMENT SUMMARY SECTION ════ -->
  <h2 class="sec">💰 Payment Summary</h2>

  <!-- Status badge + progress bar -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:16px;">
    <div style="display:inline-flex;align-items:center;gap:8px;background:${psBg};color:${psColor};border-radius:99px;padding:6px 16px;font-size:12px;font-weight:700;">
      <span style="width:8px;height:8px;border-radius:50%;background:${psDot};display:inline-block;"></span>
      ${psLabel}
    </div>
    <div style="flex:1;max-width:260px;">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#6b7280;margin-bottom:4px;">
        <span>Payment Progress</span>
        <span style="font-weight:700;">${progressPct}%</span>
      </div>
      <div style="width:100%;background:#e5e7eb;border-radius:99px;height:8px;overflow:hidden;">
        <div style="width:${progressPct}%;background:${barColor};height:100%;border-radius:99px;"></div>
      </div>
    </div>
  </div>

  <!-- 3 amount cards: Total / Paid / Due -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px;">
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;text-align:center;">
      <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Total Package</div>
      <div style="font-size:20px;font-weight:800;color:#111827;">${inr(totalAmount)}</div>
    </div>
    <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:14px 16px;text-align:center;">
      <div style="font-size:10px;font-weight:700;color:#065f46;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Amount Paid</div>
      <div style="font-size:20px;font-weight:800;color:#059669;">${inr(advancePaid)}</div>
    </div>
    <div style="background:${dueAmount > 0 ? '#fef2f2' : '#f0fdf4'};border:1px solid ${dueAmount > 0 ? '#fca5a5' : '#bbf7d0'};border-radius:10px;padding:14px 16px;text-align:center;">
      <div style="font-size:10px;font-weight:700;color:${dueAmount > 0 ? '#991b1b' : '#166534'};text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">${dueAmount > 0 ? 'Balance Due' : 'Balance Due'}</div>
      <div style="font-size:20px;font-weight:800;color:${dueAmount > 0 ? '#dc2626' : '#16a34a'};">${inr(dueAmount)}</div>
    </div>
  </div>

  <!-- Per-person breakdown (only if pricePerAdult is set) -->
  ${breakdownRows.length ? `
  <div style="margin-bottom:16px;">
    <div style="font-size:11px;font-weight:700;color:#8B1A1A;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">Per Person Breakdown</div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th style="padding:8px 14px;font-size:11px;font-weight:600;color:#6b7280;text-align:left;text-transform:uppercase;">Category</th>
          <th style="padding:8px 14px;font-size:11px;font-weight:600;color:#6b7280;text-align:right;text-transform:uppercase;">Unit Price</th>
          <th style="padding:8px 14px;font-size:11px;font-weight:600;color:#6b7280;text-align:center;text-transform:uppercase;">Qty</th>
          <th style="padding:8px 14px;font-size:11px;font-weight:600;color:#6b7280;text-align:right;text-transform:uppercase;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${breakdownRows.map((row, i) => `
        <tr style="background:${i % 2 === 0 ? '#fff' : '#fafafa'};">
          <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#1f2937;border-bottom:1px solid #f3f4f6;">${esc(row.label)}</td>
          <td style="padding:10px 14px;font-size:13px;color:#374151;text-align:right;border-bottom:1px solid #f3f4f6;">${inr(row.unit)}</td>
          <td style="padding:10px 14px;font-size:13px;color:#374151;text-align:center;border-bottom:1px solid #f3f4f6;">× ${row.qty}</td>
          <td style="padding:10px 14px;font-size:13px;font-weight:700;color:#111827;text-align:right;border-bottom:1px solid #f3f4f6;">${inr(row.total)}</td>
        </tr>`).join('')}
        <tr style="background:#f9fafb;">
          <td colspan="3" style="padding:10px 14px;font-size:13px;font-weight:700;color:#1f2937;">Grand Total</td>
          <td style="padding:10px 14px;font-size:14px;font-weight:800;color:#8B1A1A;text-align:right;">${inr(totalAmount)}</td>
        </tr>
      </tbody>
    </table>
  </div>` : ''}

  <!-- Payment history (installments) -->
  ${payments.length ? `
  <div>
    <div style="font-size:11px;font-weight:700;color:#8B1A1A;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">Payment History (${payments.length} Transaction${payments.length > 1 ? 's' : ''})</div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#8B1A1A;">
          <th style="padding:8px 12px;font-size:11px;font-weight:600;color:#fff;text-align:left;">#</th>
          <th style="padding:8px 12px;font-size:11px;font-weight:600;color:#fff;text-align:left;">Amount</th>
          <th style="padding:8px 12px;font-size:11px;font-weight:600;color:#fff;text-align:left;">Mode</th>
          <th style="padding:8px 12px;font-size:11px;font-weight:600;color:#fff;text-align:left;">Date</th>
          <th style="padding:8px 12px;font-size:11px;font-weight:600;color:#fff;text-align:left;">Note</th>
        </tr>
      </thead>
      <tbody>${paymentRows}</tbody>
      ${payments.length > 1 ? `
      <tfoot>
        <tr style="background:#f9fafb;border-top:2px solid #e5e7eb;">
          <td colspan="4" style="padding:10px 12px;font-size:13px;font-weight:700;color:#1f2937;text-align:right;">Total Collected</td>
          <td style="padding:10px 12px;font-size:13px;font-weight:800;color:#059669;text-align:left;">${inr(advancePaid)}</td>
        </tr>
      </tfoot>` : ''}
    </table>
    ${dueAmount > 0 ? `
    <div style="margin-top:10px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;">
      <span style="font-size:12px;font-weight:600;color:#991b1b;">⚠️ Balance Due</span>
      <span style="font-size:15px;font-weight:800;color:#dc2626;">${inr(dueAmount)}</span>
    </div>` : `
    <div style="margin-top:10px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;">
      <span style="font-size:12px;font-weight:600;color:#065f46;">✅ Payment Complete</span>
      <span style="font-size:15px;font-weight:800;color:#059669;">${inr(totalAmount)}</span>
    </div>`}
  </div>` : totalAmount > 0 ? `
  <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;">
    <div>
      <div style="font-size:12px;font-weight:700;color:#991b1b;">⚠️ No Payments Recorded Yet</div>
      <div style="font-size:11px;color:#b91c1c;margin-top:2px;">Total amount: ${inr(totalAmount)}</div>
    </div>
    <div style="font-size:18px;font-weight:800;color:#dc2626;">Due: ${inr(dueAmount)}</div>
  </div>` : ''}

  <div class="footer-note">
    For queries, contact your travel advisor · Generated on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
  </div>
</div>

</body>
</html>`;
}