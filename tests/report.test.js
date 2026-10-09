// Tests for the Apps Script weekly report, run in Node with mocked Google services.
// FX tests marked "live" call the real Frankfurter API through the UrlFetchApp mock.
// Run: node --test tests/*.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createGasEnv, sheetValuesFromCsv, zonedMidnight } = require('../harness/gas-mocks');
const { loadProject, fillSheet, PROJECT_DIR } = require('../harness/load-gas');

const ROOT = path.join(__dirname, '..');
const ORDERS_CSV = fs.readFileSync(path.join(ROOT, 'sample-data', 'orders.csv'), 'utf8');
const HEADER = ['Order ID', 'Order Date', 'Customer', 'Region', 'Product', 'Qty', 'Amount', 'Currency'];
const OPTS = { dateOrder: 'DMY', todayKey: '2026-10-01', timeZone: 'America/New_York' };
// The script's clock reads this day (real time of day) in every test, so results do not depend on the day they run.
const AS_OF_DAY = '2026-10-01';

function setup({ tz = 'America/New_York', email = 'owner@example.com', orders, fetchImpl, asOfDay = AS_OF_DAY, weekEnding = '', extraSettings = [] } = {}) {
  const env = createGasEnv({ timeZone: tz, fetchImpl, asOfDay });
  const gas = loadProject(env);
  fillSheet(env, 'Orders', orders || sheetValuesFromCsv(ORDERS_CSV, tz));
  fillSheet(env, 'Settings', [['Setting', 'Value', 'Help'], ['Owner email', email, ''], ['Send email', 'Yes', ''],
    ['Text dates are', 'DD/MM/YYYY', ''], ['Report week ending', weekEnding, ''], ...extraSettings]);
  return { env, gas };
}
const FIXED_RATES = JSON.stringify([
  { date: '2026-10-01', base: 'USD', quote: 'EUR', rate: 0.8 },
  { date: '2026-10-01', base: 'USD', quote: 'GBP', rate: 0.5 },
  { date: '2026-10-01', base: 'USD', quote: 'MAD', rate: 10 },
]);
const fixedFetch = () => ({ code: 200, body: FIXED_RATES });
const down = () => ({ error: 'getaddrinfo ENOTFOUND api.frankfurter.dev' });
// Objects made inside the Apps Script context come from another JavaScript realm: compare them as plain JSON.
const eq = (actual, expected, msg) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, msg);
const row = (id, date, region, product, qty, amount, currency, customer = 'CUST-1') => [id, date, customer, region, product, qty, amount, currency];

// ---------------------------------------------------------------- cleaning rules
test('cleaning: trims spaces and merges names that differ only in case or spacing', () => {
  const { gas } = setup();
  const out = gas.cleanOrders_([HEADER,
    row('A1', '2026-09-21', 'Europe', 'Office Chair', 1, 100, 'EUR'),
    row('A2', '2026-09-22', '  europe ', 'office  chair', 1, 100, 'EUR'),
    row('A3', '2026-09-23', 'Europe', 'Office Chair ', 1, 100, 'eur'),
    row('A4', '2026-09-24', 'EUROPE', 'Office Chair', 1, 100, '€'),
  ], OPTS);
  assert.equal(out.issues.length, 0);
  eq(out.rows.map((r) => [r.region, r.product, r.currency]), Array(4).fill(['Europe', 'Office Chair', 'EUR']));
});

test('cleaning: exact duplicates are removed after trimming; a reused order ID with other values is flagged', () => {
  const { gas } = setup();
  const out = gas.cleanOrders_([HEADER,
    row('A1', '2026-09-21', 'Europe', 'Desk Lamp', 1, 40, 'EUR'),
    row('A1 ', '2026-09-21', ' Europe', 'desk lamp', 1, '40.00', 'EUR'),
    row('A1', '2026-09-21', 'Europe', 'Desk Lamp', 1, 80, 'EUR'),
  ], OPTS);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].row, 2);
  eq(out.issues.map((i) => [i.row, i.codes[0]]), [[3, 'duplicate'], [4, 'id_conflict']]);
  assert.match(out.issues[0].reason, /Duplicate of row 2/);
  assert.match(out.issues[1].reason, /already used in row 2 with different values \(row 2 kept\)/);
});

test('cleaning: dates (blank, unreadable, impossible, future, text formats)', () => {
  const { gas } = setup();
  const out = gas.cleanOrders_([HEADER,
    row('D1', '', 'Europe', 'Webcam HD', 1, 50, 'EUR'),
    row('D2', 'TBD', 'Europe', 'Webcam HD', 1, 50, 'EUR'),
    row('D3', '31/09/2026', 'Europe', 'Webcam HD', 1, 50, 'EUR'),
    row('D4', '2027-01-15', 'Europe', 'Webcam HD', 1, 50, 'EUR'),
    row('D5', '07/09/2026', 'Europe', 'Webcam HD', 1, 50, 'EUR'),
    row('D6', '2026-09-14 10:32', 'Europe', 'Webcam HD', 1, 50, 'EUR'),
    row('D7', 46280, 'Europe', 'Webcam HD', 1, 50, 'EUR'),
  ], OPTS);
  eq(out.issues.map((i) => i.codes[0]), ['missing_date', 'bad_date', 'bad_date', 'future_date']);
  eq(out.rows.map((r) => r.dayKey), ['2026-09-07', '2026-09-14', '2026-09-15']);
  const us = gas.cleanOrders_([HEADER, row('D5', '07/09/2026', 'Europe', 'Webcam HD', 1, 50, 'EUR')], { ...OPTS, dateOrder: 'MDY' });
  assert.equal(us.rows[0].dayKey, '2026-07-09');
});

test('cleaning: real date cells keep their calendar day in the spreadsheet time zone', () => {
  const { gas } = setup({ tz: 'Europe/Paris' });
  const midnightParis = zonedMidnight(2026, 9, 21, 'Europe/Paris'); // 2026-09-20T22:00Z
  assert.equal(midnightParis.toISOString(), '2026-09-20T22:00:00.000Z');
  assert.equal(gas.parseDate_(midnightParis, 'DMY', 'Europe/Paris').key, '2026-09-21');
  const midnightNY = zonedMidnight(2026, 9, 21, 'America/New_York');
  assert.equal(gas.parseDate_(midnightNY, 'DMY', 'America/New_York').key, '2026-09-21');
});

test('import: unticked "Convert text to numbers, dates, and formulas" keeps text; ticked reads n/n/yyyy in the locale order', () => {
  const tz = 'America/New_York';
  const csv = 'Order Date,Qty\n2026-09-21,2\n05/09/2026,1\n14/08/2026,1\n31/09/2026,1\n';
  eq(sheetValuesFromCsv(csv, tz).slice(1), [['2026-09-21', '2'], ['05/09/2026', '1'], ['14/08/2026', '1'], ['31/09/2026', '1']]);
  const { gas } = setup();
  const days = (locale) => sheetValuesFromCsv(csv, tz, { convert: true, locale }).slice(1)
    .map((r) => (typeof r[0] === 'string' ? `text ${r[0]}` : `cell ${gas.parseDate_(r[0], 'DMY', tz).key}`));
  eq(days('en_GB'), ['cell 2026-09-21', 'cell 2026-09-05', 'cell 2026-08-14', 'text 31/09/2026']);
  // A US-locale sheet reads 05/09/2026 month first: the cell is already 9 May, so the script cannot see the swap.
  eq(days('en_US'), ['cell 2026-09-21', 'cell 2026-05-09', 'text 14/08/2026', 'text 31/09/2026']);
});

test('import: the sample gives the same clean data as text or ticked in a day-first locale; ticked in a US locale it does not', () => {
  const { gas } = setup();
  const clean = (mode) => gas.cleanOrders_(sheetValuesFromCsv(ORDERS_CSV, OPTS.timeZone, mode), OPTS);
  const view = (out) => JSON.parse(JSON.stringify({ stats: out.stats,
    rows: out.rows.map((r) => [r.row, r.id, r.dayKey, r.region, r.product, r.qty, r.amount, r.currency]),
    issues: out.issues.map((i) => [i.row, i.codes]) }));
  const asText = view(clean({ convert: false }));
  assert.deepEqual(view(clean({ convert: true, locale: 'en_GB' })), asText);
  const us = view(clean({ convert: true, locale: 'en_US' }));
  const textDay = new Map(asText.rows.map((r) => [r[0], r[2]]));
  const moved = us.rows.filter((r) => textDay.get(r[0]) !== r[2]).map((r) => [textDay.get(r[0]), r[2]]);
  eq(moved, [['2026-09-05', '2026-05-09'], ['2026-09-06', '2026-06-09'], ['2026-09-07', '2026-07-09']]);
  const lost = asText.rows.filter((r) => !us.rows.some((u) => u[0] === r[0])).map((r) => r[2]);
  eq(lost, ['2026-08-10', '2026-09-12']); // become 8 Oct and 9 Dec: flagged as future dates
  assert.equal(us.stats.kept, asText.stats.kept - 2);
  assert.equal(us.issues.length, asText.issues.length + 2);
});

test('cleaning: amounts typed in many ways', () => {
  const { gas } = setup();
  const cases = [[1250, 1250], ['1250', 1250], ['1,250.00', 1250], ['1250,50', 1250.5], ['1.250,50', 1250.5], ['$1,250.00', 1250],
    ['€ 95,00', 95], [' 845.00 ', 845], ['1.25', 1.25], ['MAD 4 250', 4250], ['N/A', null], ['12..50', null], ['abc', null], ['', null]];
  for (const [input, expected] of cases) assert.equal(gas.parseAmount_(input), expected, `parseAmount_(${JSON.stringify(input)})`);
});

test('cleaning: bad amounts, quantities, currencies and missing fields go to Issues with the reason', () => {
  const { gas } = setup();
  const out = gas.cleanOrders_([HEADER,
    row('B1', '2026-09-21', 'Europe', 'Headset', 1, 'N/A', 'EUR'),
    row('B2', '2026-09-21', 'Europe', 'Headset', 1, '-120.00', 'EUR'),
    row('B3', '2026-09-21', 'Europe', 'Headset', 1, '', 'EUR'),
    row('B4', '2026-09-21', 'Europe', 'Headset', 'two', 100, 'EUR'),
    row('B5', '2026-09-21', 'Europe', 'Headset', 1, 100, ''),
    row('B6', '2026-09-21', '', 'Headset', 1, 100, 'EUR'),
    row('B7', '2026-09-21', 'Europe', '', 1, 100, 'EUR'),
    row('', '2026-09-21', 'Europe', 'Headset', 1, 100, 'EUR'),
    row('B9', '2026-09-21', 'Europe', 'Headset', 1, 100, '€'),
    row('B10', '2026-09-21', 'Morocco', 'Headset', 1, 100, 'Dh'),
    ['', '', '', '', '', '', '', ''],
  ], OPTS);
  eq(out.issues.map((i) => i.codes.join('+')),
    ['bad_amount', 'bad_amount', 'missing_amount', 'bad_qty', 'missing_currency', 'missing_region', 'missing_product', 'missing_id']);
  assert.match(out.issues[0].reason, /Bad amount: "N\/A" is not a number/);
  eq(out.rows.map((r) => r.currency), ['EUR', 'MAD']);
  assert.equal(out.stats.blank, 1);
  assert.equal(out.stats.read, 11);
});

test('cleaning: currency symbols and lowercase codes are recognized', () => {
  const { gas } = setup();
  const cases = [['€', 'EUR'], ['£', 'GBP'], ['$', 'USD'], ['Dh', 'MAD'], ['eur', 'EUR'], [' gbp ', 'GBP'], ['MAD', 'MAD']];
  for (const [input, code] of cases) assert.equal(gas.normalizeCurrency_(input).code, code, input);
  assert.equal(gas.normalizeCurrency_('').error, 'missing');
  assert.equal(gas.normalizeCurrency_('euro dollars').error, 'unknown');
});

test('cleaning: names such as "constructor" or "__proto__" are ordinary values', () => {
  const { gas } = setup();
  const out = gas.cleanOrders_([HEADER,
    row('constructor', '2026-09-21', 'constructor', '__proto__', 1, 10, 'USD'),
    row('__proto__', '2026-09-22', 'toString', 'constructor', 1, 10, 'USD'),
    row('__proto__', '2026-09-22', 'toString', 'constructor', 1, 10, 'USD'),
  ], OPTS);
  eq(out.rows.map((r) => [r.id, r.region, r.product]), [['constructor', 'constructor', '__proto__'], ['__proto__', 'toString', 'constructor']]);
  eq(out.issues.map((i) => i.codes), [['duplicate']]);
  const s = gas.buildSummary_(out.rows.map((r) => ({ ...r, amountUsd: r.amount })), gas.reportWeek_('2026-10-01', null, 'DMY', 'UTC'));
  eq(s.byRegion.map((g) => [g.name, g.revenue]), [['constructor', 10], ['toString', 10]]);
});

test('cleaning: a missing column stops the run with a clear message', () => {
  const { gas } = setup();
  assert.throws(() => gas.cleanOrders_([['Order ID', 'Order Date', 'Region', 'Product', 'Qty', 'Amount']], OPTS),
    /missing column\(s\): Currency/);
});

// ---------------------------------------------------------------- FX (live API)
test('fx (live): fetches real USD rates once, then serves them from the cache', () => {
  const { env, gas } = setup();
  const now = Date.now();
  const first = gas.getUsdRates_(now);
  assert.equal(first.source, 'live');
  assert.equal(first.rates.USD, 1);
  for (const c of ['EUR', 'GBP', 'MAD']) assert.ok(first.rates[c] > 0, `rate for ${c}`);
  const ageDays = (now - Date.parse(first.date)) / 86400000;
  assert.ok(ageDays >= -1 && ageDays < 7, `rates dated ${first.date}`);
  const second = gas.getUsdRates_(now);
  assert.equal(second.source, 'cache');
  eq(second.rates, JSON.parse(JSON.stringify(first.rates)));
  assert.equal(env.fetches.length, 1, 'only one HTTP request');
  assert.ok(env.props.get('fx_last_good_rates'), 'last good rates saved for outages');
});

test('fx (live): converts each order to USD as amount / rate, and flags currencies without a rate', () => {
  const { gas } = setup();
  const fx = gas.getUsdRates_(Date.now());
  const cleaned = gas.cleanOrders_([HEADER,
    row('F1', '2026-09-21', 'Europe', 'Headset', 1, 150, 'EUR'),
    row('F2', '2026-09-21', 'Morocco', 'Headset', 1, 1470, 'MAD'),
    row('F3', '2026-09-21', 'North America', 'Headset', 1, 150, 'USD'),
    row('F4', '2026-09-21', 'Europe', 'Headset', 1, 150, 'XYZ'),
  ], OPTS);
  const out = gas.applyFx_(cleaned.rows, fx.rates, 'America/New_York');
  assert.equal(out.rows[0].amountUsd, Math.round((150 / fx.rates.EUR) * 100) / 100);
  assert.equal(out.rows[1].amountUsd, Math.round((1470 / fx.rates.MAD) * 100) / 100);
  assert.equal(out.rows[2].amountUsd, 150);
  eq(out.issues.map((i) => [i.row, i.codes[0]]), [[5, 'unknown_currency']]);
});

test('fx: reads both API formats and rejects a broken answer', () => {
  const { gas } = setup();
  eq(gas.parseFxResponse_(FIXED_RATES).rates, { USD: 1, EUR: 0.8, GBP: 0.5, MAD: 10 });
  assert.equal(gas.parseFxResponse_('{"base":"USD","date":"2026-10-01","rates":{"EUR":0.9}}').rates.EUR, 0.9);
  assert.throws(() => gas.parseFxResponse_('{"status":404}'), /Unexpected answer/);
});

test('fx: when the API is down, saved rates up to 7 days old are used and the email says so', () => {
  const { env, gas } = setup({ fetchImpl: down });
  const saved = { rates: { USD: 1, EUR: 0.8 }, date: '2026-09-29', fetchedAt: new Date(Date.now() - 2 * 86400000).toISOString() };
  env.props.set('fx_last_good_rates', JSON.stringify(saved));
  const fx = gas.getUsdRates_(Date.now());
  assert.equal(fx.source, 'saved');
  assert.match(fx.warning, /rates saved on 2026-09-29 were used/);
  assert.equal(env.fetches.length, 3, 'tried 3 times');
  eq(env.sleeps, [1500, 3000]);
});

test('fx: a 4xx answer is not retried', () => {
  const { env, gas } = setup({ fetchImpl: () => ({ code: 422, body: '{}' }) });
  assert.throws(() => gas.getUsdRates_(Date.now()), /HTTP 422/);
  assert.equal(env.fetches.length, 1);
});

test('fx: with no rates at all the run stops, changes no output sheet, logs FAILED and emails the error', () => {
  const { env, gas } = setup({ fetchImpl: down });
  const ordersBefore = JSON.stringify(env.ss.getSheetByName('Orders').cells);
  env.context = 'trigger';
  const result = gas.runWeeklyReportScheduled();
  assert.equal(result.status, 'FAILED');
  assert.match(result.message, /Nothing in the spreadsheet was changed/);
  for (const name of ['Summary', 'Issues', 'Clean data']) assert.equal(env.ss.getSheetByName(name), null, `${name} not created`);
  assert.equal(JSON.stringify(env.ss.getSheetByName('Orders').cells), ordersBefore);
  const log = env.ss.getSheetByName('Run log').getDataRange().getValues();
  assert.equal(log.length, 2);
  assert.equal(log[1][2], 'FAILED');
  assert.equal(env.emails.length, 1);
  assert.match(env.emails[0].subject, /^Weekly report FAILED/);
  assert.match(env.emails[0].htmlBody, /were not changed/);
});

// ---------------------------------------------------------------- weekly totals
test('weeks: the report covers the last full Monday-Sunday week, or the week set in Settings', () => {
  const { gas } = setup();
  const w = (today, setting = null) => { const r = gas.reportWeek_(today, setting, 'DMY', 'America/New_York'); return [r.start, r.end, r.label]; };
  eq(w('2026-10-01'), ['2026-09-21', '2026-09-27', '21–27 Sep 2026']);
  eq(w('2026-09-28'), ['2026-09-21', '2026-09-27', '21–27 Sep 2026']);
  eq(w('2026-09-27'), ['2026-09-14', '2026-09-20', '14–20 Sep 2026']);
  eq(w('2026-10-01', '16/09/2026'), ['2026-09-14', '2026-09-20', '14–20 Sep 2026']);
  eq(w('2026-09-10'), ['2026-08-31', '2026-09-06', '31 Aug–6 Sep 2026']);
  assert.throws(() => w('2026-10-01', 'soon'), /not a readable date/);
});

test('weeks: a run reports the last full week before its day in the sheet time zone; Settings > Report week ending overrides it', () => {
  const run = (asOfDay, weekEnding = '') => {
    const { env, gas } = setup({ asOfDay, weekEnding, fetchImpl: fixedFetch });
    env.context = 'trigger';
    const r = gas.runWeeklyReportScheduled();
    assert.equal(r.status, 'OK', r.message);
    assert.ok(env.emails[0].subject.startsWith(`Weekly sales report, ${r.summary.week.label}:`));
    return [r.summary.week.label, r.summary.kpis.orders, r.summary.kpis.revenue];
  };
  const base = run(AS_OF_DAY);
  assert.equal(base[0], '21–27 Sep 2026');
  assert.ok(base[1] > 0 && base[2] > 0);
  eq(run('2026-10-04'), base, 'Sunday 4 Oct: the week of 28 Sep is not over yet');
  eq(run('2026-10-05'), ['28 Sep–4 Oct 2026', 0, 0], 'Monday 5 Oct: the next week, which has no orders in the sample');
  eq(run('2026-10-12', '27/09/2026'), base, 'Settings > Report week ending picks the week');
  eq(run('2027-03-01', '2026-09-27'), base, 'also after the planted 2027-01-15 date is no longer in the future');
});

test('weeks: totals by week, region and product, top 5 and change vs previous week', () => {
  const { gas } = setup();
  const mk = (dayKey, region, product, usd, qty = 1) => ({ dayKey, region, product, qty, amountUsd: usd });
  const rows = [
    mk('2026-09-14', 'Europe', 'Desk', 100), mk('2026-09-20', 'Asia', 'Lamp', 100),
    mk('2026-09-21', 'Europe', 'Desk', 150), mk('2026-09-27', 'Europe', 'Lamp', 50, 2), mk('2026-09-25', 'Morocco', 'Chair', 25),
    mk('2026-09-28', 'Europe', 'Desk', 999),
  ];
  const s = gas.buildSummary_(rows, gas.reportWeek_('2026-10-01', null, 'DMY', 'UTC'));
  eq(s.kpis, { revenue: 225, orders: 3, units: 4, avgOrder: 75, prevRevenue: 200, prevOrders: 2, change: 0.125 });
  assert.equal(s.weekly.length, 8);
  eq(s.weekly.slice(-2).map((x) => [x.weekStart, x.orders, x.revenue, x.change]), [['2026-09-14', 2, 200, null], ['2026-09-21', 3, 225, 0.125]]);
  eq(s.byRegion.map((g) => [g.name, g.revenue, g.prevRevenue, g.change]),
    [['Europe', 200, 100, 1], ['Morocco', 25, 0, null], ['Asia', 0, 100, -1]]);
  eq(s.top5.map((p) => [p.rank, p.name, p.revenue]), [[1, 'Desk', 150], [2, 'Lamp', 50], [3, 'Chair', 25]]);
  assert.equal(s.top5[0].share, 150 / 225);
});

// ---------------------------------------------------------------- full run on the sample data (live FX)
test('full run (live FX): every row is accounted for and the totals add up', () => {
  const { env, gas } = setup();
  const ordersBefore = JSON.stringify(env.ss.getSheetByName('Orders').cells);
  const r = gas.runWeeklyReportFromMenu();
  assert.equal(r.status, 'OK', r.message);
  assert.equal(r.stats.read, 500);
  assert.equal(r.stats.read, r.stats.kept + r.issues.length + r.stats.blank);
  const s = r.summary;
  const sum = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
  const inWindow = r.rows.filter((x) => x.weekStart >= s.weekly[0].weekStart && x.weekStart <= s.week.start);
  assert.equal(sum(s.weekly.map((w) => w.revenue)), sum(inWindow.map((x) => x.amountUsd)));
  assert.equal(sum(s.weekly.map((w) => w.orders)), inWindow.length);
  assert.equal(sum(s.byRegion.map((g) => g.revenue)), s.kpis.revenue);
  assert.equal(sum(s.byProduct.map((g) => g.revenue)), s.kpis.revenue);
  assert.equal(sum(s.byRegion.map((g) => g.orders)), s.kpis.orders);
  assert.ok(s.top5.every((p, i) => i === 0 || s.top5[i - 1].revenue >= p.revenue));
  assert.equal(JSON.stringify(env.ss.getSheetByName('Orders').cells), ordersBefore, 'Orders sheet unchanged');
  const chart = env.ss.getSheetByName('Summary').getCharts();
  assert.equal(chart.length, 1);
  assert.equal(chart[0].spec.type, 'COLUMN');
});

test('full run (live FX): the Issues sheet lists each dirty row of the sample with its reason', () => {
  const { env, gas } = setup();
  const r = gas.runWeeklyReportFromMenu();
  const byCode = {};
  r.issues.forEach((i) => i.codes.forEach((c) => { byCode[c] = (byCode[c] || 0) + 1; }));
  // What sample-data/make-orders.js planted: 10 duplicates, 2 reused IDs and 22 broken values.
  eq(byCode, { duplicate: 10, id_conflict: 2, missing_date: 5, bad_date: 2, future_date: 1, bad_amount: 5, missing_amount: 1,
    missing_currency: 2, unknown_currency: 1, missing_product: 1, missing_region: 1, bad_qty: 2, missing_id: 1 });
  const sheet = env.ss.getSheetByName('Issues').getDataRange().getValues();
  eq(sheet[0], ['Orders row', 'Problem', ...HEADER]);
  assert.equal(sheet.length - 1, r.issues.length);
  const orders = env.ss.getSheetByName('Orders').getDataRange().getValues();
  for (const line of sheet.slice(1)) {
    assert.ok(line[1].length > 5, 'has a reason');
    assert.equal(line[2], String(orders[line[0] - 1][0]), `row ${line[0]} shows the original order ID`);
  }
  // Running again replaces the Issues sheet rather than appending to it, and adds one Run log row.
  gas.runWeeklyReportFromMenu();
  assert.equal(env.ss.getSheetByName('Issues').getDataRange().getValues().length - 1, r.issues.length);
  assert.equal(env.ss.getSheetByName('Run log').getDataRange().getValues().length, 3);
});

// ---------------------------------------------------------------- email
test('email: subject and HTML carry the real numbers, the issues and a link to the sheet', () => {
  const { env, gas } = setup();
  const r = gas.runWeeklyReportFromMenu();
  assert.equal(env.emails.length, 1);
  const m = env.emails[0];
  assert.equal(m.to, 'owner@example.com');
  assert.equal(m.subject, `Weekly sales report, 21–27 Sep 2026: ${gas.money_(r.summary.kpis.revenue)} (${gas.pctText_(r.summary.kpis.change)} vs previous week)`);
  for (const text of ['21–27 Sep 2026', gas.money_(r.summary.kpis.revenue), ...r.summary.byRegion.map((g) => g.name),
    ...r.summary.top5.map((p) => p.name), `${r.issues.length} rows were left out`, 'Duplicate row: 10', 'Open the sheet', '1 USD = ']) {
    assert.ok(m.htmlBody.includes(text), `email contains ${text}`);
  }
  assert.ok(m.body.includes('Top 5 products'), 'plain-text version');
  // The 8 week bars are table cells with width and bgcolor attributes, not sized <div>s.
  assert.equal((m.htmlBody.match(/<td width="\d+%" height="14" bgcolor="#/g) || []).length, 8);
  assert.ok(!/<div[^>]*[";]\s*(height|width):/.test(m.htmlBody), 'no sized <div>');
});

test('email: values from the sheet are escaped', () => {
  const { env, gas } = setup({ fetchImpl: fixedFetch, orders: [HEADER,
    row('X1', '2026-09-22', 'Europe', '<img src=x onerror=alert(1)>', 1, 80, 'EUR'),
    row('X2', '2026-09-15', 'Europe', 'Desk', 1, 80, 'EUR')] });
  gas.runWeeklyReportFromMenu();
  const html = env.emails[0].htmlBody;
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('email: no owner email means no email, and the Run log says why', () => {
  const { env, gas } = setup({ email: '', fetchImpl: fixedFetch });
  const r = gas.runWeeklyReportFromMenu();
  assert.equal(r.status, 'OK');
  assert.equal(env.emails.length, 0);
  const log = env.ss.getSheetByName('Run log').getDataRange().getValues();
  assert.match(log[1][12], /No owner email in Settings/);
});

test('first run: with no Settings tab, it creates one with defaults, writes the report and explains the missing email', () => {
  const env = createGasEnv({ timeZone: 'America/New_York', fetchImpl: fixedFetch, asOfDay: AS_OF_DAY });
  const gas = loadProject(env);
  fillSheet(env, 'Orders', [HEADER, row('S1', '2026-09-22', 'Europe', 'Desk', 1, 80, 'EUR')]);
  const r = gas.runWeeklyReportFromMenu();
  assert.equal(r.status, 'OK');
  const settings = env.ss.getSheetByName('Settings').getDataRange().getValues();
  eq(settings.map((x) => x[0]), ['Setting', 'Owner email', 'Send email', 'Text dates are', 'Report week ending']);
  assert.equal(env.emails.length, 0);
  assert.match(env.alerts[0].prompt, /No owner email in Settings/);
  assert.ok(env.ss.getSheetByName('Summary'));
});

// ---------------------------------------------------------------- menu, trigger, scopes
test('menu: Reports > Run weekly report and Install weekly trigger point to real functions', () => {
  const { env, gas } = setup();
  gas.onOpen();
  assert.equal(env.menus[0].caption, 'Reports');
  const items = env.menus[0].items.filter((i) => !i.separator);
  eq(items.map((i) => i.label), ['Run weekly report', 'Install weekly trigger', 'Remove weekly trigger']);
  for (const i of items) assert.equal(typeof gas[i.fn], 'function', i.fn);
});

test('trigger: installing twice keeps one Monday 7 am trigger in the sheet time zone; remove deletes it', () => {
  const { env, gas } = setup({ tz: 'Europe/London' });
  gas.installWeeklyTrigger();
  gas.installWeeklyTrigger();
  assert.equal(env.triggers.length, 1);
  eq(env.triggers[0].spec, { handler: 'runWeeklyReportScheduled', weekDay: 'MONDAY', hour: 7, timeZone: 'Europe/London' });
  assert.equal(typeof gas.runWeeklyReportScheduled, 'function');
  gas.removeWeeklyTrigger();
  assert.equal(env.triggers.length, 0);
});

test('trigger: a scheduled run works without any UI call', () => {
  const { env, gas } = setup({ fetchImpl: fixedFetch });
  env.context = 'trigger';
  assert.equal(gas.runWeeklyReportScheduled().status, 'OK');
  assert.equal(env.ss.getSheetByName('Run log').getDataRange().getValues()[1][1], 'weekly trigger');
});

test('scopes: the manifest asks only for narrow scopes, and the code uses nothing that needs more', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, 'appsscript.json'), 'utf8'));
  eq(manifest.oauthScopes.sort(), [
    'https://www.googleapis.com/auth/script.container.ui',
    'https://www.googleapis.com/auth/script.external_request',
    'https://www.googleapis.com/auth/script.scriptapp',
    'https://www.googleapis.com/auth/script.send_mail',
    'https://www.googleapis.com/auth/spreadsheets.currentonly',
  ]);
  const code = fs.readdirSync(PROJECT_DIR).filter((f) => f.endsWith('.gs')).map((f) => fs.readFileSync(path.join(PROJECT_DIR, f), 'utf8')).join('\n');
  for (const broad of ['GmailApp', 'DriveApp', 'openById', 'openByUrl', 'Session.getActiveUser', 'Session.getEffectiveUser']) {
    assert.ok(!code.includes(broad), `uses ${broad}`);
  }
});

test('safety: text that looks like a formula is written as text', () => {
  const { gas } = setup();
  assert.equal(gas.safeText_('=IMPORTXML("x")'), "'=IMPORTXML(\"x\")");
  assert.equal(gas.safeText_('Office Chair'), 'Office Chair');
  assert.equal(gas.safeText_('-120.00'), '-120.00');
});
