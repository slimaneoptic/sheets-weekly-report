// Builds sample-data/orders.csv: about 500 synthetic orders over 8 weeks (Mon 3 Aug to Sun 27 Sep 2026),
// in USD, EUR, GBP and MAD, with deliberately dirty rows mixed in. Seeded, so every run gives the same file.
// Usage: node sample-data/make-orders.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261002);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

// Region -> currency, plus a rough local price factor used only to make realistic local prices.
const REGIONS = [
  { name: 'North America', currency: 'USD', factor: 1, weight: 0.38 },
  { name: 'Europe', currency: 'EUR', factor: 0.9, weight: 0.3 },
  { name: 'United Kingdom', currency: 'GBP', factor: 0.78, weight: 0.17 },
  { name: 'Morocco', currency: 'MAD', factor: 9.8, weight: 0.15 },
];
const PRODUCTS = [
  { name: 'Standing Desk', price: 420, weight: 0.1 },
  { name: 'Office Chair', price: 260, weight: 0.14 },
  { name: 'USB-C Dock', price: 130, weight: 0.12 },
  { name: 'Headset', price: 150, weight: 0.12 },
  { name: 'Monitor Arm', price: 85, weight: 0.13 },
  { name: 'Wireless Keyboard', price: 70, weight: 0.14 },
  { name: 'Webcam HD', price: 60, weight: 0.12 },
  { name: 'Desk Lamp', price: 45, weight: 0.13 },
];
function weighted(items) {
  let r = rnd();
  for (const it of items) { if ((r -= it.weight) <= 0) return it; }
  return items[items.length - 1];
}
const pad = (n, w = 2) => String(n).padStart(w, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dmy = (d) => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;

// 1. Clean orders. Weekly volume drifts so week-on-week changes are visible.
const start = Date.UTC(2026, 7, 3); // Monday 3 Aug 2026
const weeklyOrders = [56, 58, 57, 61, 60, 64, 62, 68];
const clean = [];
let seq = 10001;
weeklyOrders.forEach((count, w) => {
  for (let i = 0; i < count; i++) {
    const day = new Date(start + (w * 7 + int(0, 6)) * 86400000);
    const region = weighted(REGIONS);
    const product = weighted(PRODUCTS);
    const qty = rnd() < 0.8 ? 1 : int(2, 3);
    const unit = Math.round(product.price * region.factor * (0.92 + rnd() * 0.16));
    clean.push({
      id: '', date: day, customer: `CUST-${pad(int(1, 180), 4)}`, region: region.name,
      product: product.name, qty, amount: (unit * qty).toFixed(2), currency: region.currency,
    });
  }
});
clean.sort((a, b) => a.date - b.date);
for (const o of clean) o.id = `SO-${seq++}`;

const toRow = (o, over = {}) => {
  const r = { id: o.id, date: iso(o.date), customer: o.customer, region: o.region, product: o.product,
    qty: String(o.qty), amount: o.amount, currency: o.currency, ...over };
  return [r.id, r.date, r.customer, r.region, r.product, r.qty, r.amount, r.currency];
};
const rows = clean.map((o) => toRow(o));

// 2. Messy but valid values: the report must read these correctly.
const messyValid = [
  ...Array.from({ length: 12 }, () => ['date', (o) => dmy(o.date)]), // text dates DD/MM/YYYY
  ['region', (o) => `  ${o.region.toLowerCase()} `],
  ['region', (o) => o.region.toUpperCase()],
  ['product', (o) => o.product.toLowerCase()],
  ['product', (o) => o.product.replace(' ', '  ')],
  ['product', (o) => ` ${o.product}`],
  ['currency', (o) => o.currency.toLowerCase()],
  ['currency', (o) => o.currency.toLowerCase()],
  ['currency', (o) => ({ EUR: '€', GBP: '£', USD: '$', MAD: 'Dh' })[o.currency]],
  ['currency', (o) => ({ EUR: '€', GBP: '£', USD: '$', MAD: 'Dh' })[o.currency]],
  ['amount', (o) => `$${Number(o.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, (o) => o.currency === 'USD'],
  ['amount', (o) => o.amount.replace('.', ',')],
  ['amount', (o) => ` ${o.amount} `],
];
const used = new Set();
const freeIndex = (ok = () => true) => {
  let i;
  do { i = int(0, rows.length - 1); } while (used.has(i) || !ok(clean[i]));
  used.add(i);
  return i;
};
const colOf = { id: 0, date: 1, customer: 2, region: 3, product: 4, qty: 5, amount: 6, currency: 7 };
for (const [field, fn, ok] of messyValid) {
  const i = freeIndex(ok);
  rows[i][colOf[field]] = fn(clean[i]);
}

// 3. Invalid rows: each replaces a clean order, so the report must leave it out and list it in Issues.
const broken = [
  ['date', ''], ['date', ''], ['date', ''], ['date', ''], ['date', ''],
  ['date', '31/09/2026'], ['date', 'TBD'], ['date', '2027-01-15'],
  ['amount', 'N/A'], ['amount', ''], ['amount', '-120.00'], ['amount', '12..50'], ['amount', 'abc'], ['amount', '0'],
  ['currency', ''], ['currency', ''], ['currency', 'XYZ'],
  ['product', ''], ['region', ''],
  ['qty', '0'], ['qty', 'two'],
  ['id', ''],
];
for (const [field, value] of broken) {
  const i = freeIndex();
  rows[i][colOf[field]] = value;
}

// 4. Duplicates: exact copies (some differ only by spaces or letter case) and two order IDs reused with a different amount.
const extra = [];
for (let k = 0; k < 10; k++) {
  const i = freeIndex();
  const copy = rows[i].slice();
  if (k % 3 === 0) copy[3] = ` ${copy[3]}  `;
  if (k % 3 === 1) copy[4] = copy[4].toLowerCase();
  extra.push({ after: i + int(1, 25), row: copy });
}
for (let k = 0; k < 2; k++) {
  const i = freeIndex();
  const copy = rows[i].slice();
  copy[6] = (Number(copy[6]) + 40).toFixed(2);
  extra.push({ after: i + int(1, 25), row: copy });
}
// Two fully blank lines, as often left behind by copy-paste.
extra.push({ after: int(100, 200), row: ['', '', '', '', '', '', '', ''] });
extra.push({ after: int(300, 400), row: ['', '', '', '', '', '', '', ''] });

extra.sort((a, b) => b.after - a.after);
for (const e of extra) rows.splice(Math.min(e.after, rows.length), 0, e.row);

const csvCell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const header = ['Order ID', 'Order Date', 'Customer', 'Region', 'Product', 'Qty', 'Amount', 'Currency'];
const out = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
fs.writeFileSync(path.join(__dirname, 'orders.csv'), out);
console.log(`orders.csv: ${rows.length} data rows (${clean.length} generated orders, ${extra.length} extra lines, ${broken.length} broken values)`);
