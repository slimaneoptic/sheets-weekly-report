// Full local run of the Apps Script project on sample-data/orders.csv, with the LIVE Frankfurter API.
// 1. onOpen (menu), Install weekly trigger, then "Reports > Run weekly report" (live rates).
// 2. A second run as the weekly trigger would start it (rates come from the 6-hour cache).
// 3. A separate, simulated outage: the rate API is unreachable and no rates were saved, so the run must stop
//    without touching the sheets and send the error email.
// Everything the script writes (sheets, email, run log, chart spec) is saved in outputs/.
// Usage: node harness/run-local.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createGasEnv, sheetValuesFromCsv, sheetToCsv } = require('./gas-mocks');
const { loadProject, fillSheet } = require('./load-gas');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'outputs');
const TZ = 'America/New_York';
const OWNER = 'owner@example.com';
// The script's "today" is pinned to this day (sheet time zone, real time of day), so re-running this file later gives
// the same report week (21–27 Sep 2026) and the same future-date check. The exchange rates are still live.
const AS_OF_DAY = '2026-10-01';
// The CSV is imported the way INSTALL.md says: "Convert text to numbers, dates, and formulas" unticked, so every cell is text.
const IMPORT = { convert: false };
const IMPORT_NOTE = 'orders.csv imported as text ("Convert text to numbers, dates, and formulas" unticked), as INSTALL.md says';
const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const write = (rel, text) => { const p = path.join(OUT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const csv = (header, rows) => [header, ...rows].map((r) => r.map((v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(',')).join('\n') + '\n';
const htmlDoc = (title, body) => `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>\n<body style="margin:0;padding:24px;background:#ffffff">\n${body}\n</body></html>\n`;

function settingsRows(email) {
  return [['Setting', 'Value', 'Help'], ['Owner email', email, ''], ['Send email', 'Yes', ''], ['Text dates are', 'DD/MM/YYYY', ''], ['Report week ending', '', '']];
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const ordersCsv = fs.readFileSync(path.join(ROOT, 'sample-data', 'orders.csv'), 'utf8');

// ---------- 1 + 2: the real runs ----------
const env = createGasEnv({ timeZone: TZ, spreadsheetName: 'Sales orders (sample)', asOfDay: AS_OF_DAY });
const clockNote = env.clock.shiftMs === 0
  ? `script clock = real clock (today is ${AS_OF_DAY} in ${TZ})`
  : `script clock shifted ${Math.round(env.clock.shiftMs / 3600000)} h to show ${AS_OF_DAY} in ${TZ} (real time of day)`;
const gas = loadProject(env);
fillSheet(env, 'Orders', sheetValuesFromCsv(ordersCsv, TZ, IMPORT));
fillSheet(env, 'Settings', settingsRows(OWNER));

const startedAt = new Date();
say(`Local test run of the Apps Script weekly report, ${startedAt.toISOString()} (spreadsheet time zone ${TZ})`);
say(`Input: ${IMPORT_NOTE}`);
say(`Clock: as of ${AS_OF_DAY}, ${clockNote}`);
gas.onOpen();
say(`Menu: ${env.menus.map((m) => `${m.caption} > ${m.items.filter((i) => !i.separator).map((i) => i.label).join(' | ')}`).join('; ')}`);
gas.installWeeklyTrigger();
const trig = env.triggers[0];
say(`Trigger: ${trig.getHandlerFunction()} every ${trig.spec.weekDay} at hour ${trig.spec.hour} (${trig.spec.timeZone})`);

const run1 = gas.runWeeklyReportFromMenu();
say(`Run 1 (menu): ${run1.status}. ${run1.message}`);
say(`  Exchange rates: ${run1.fx.source}, dated ${run1.fx.date}, fetched in ${env.fetches[0] && env.fetches[0].ms} ms from ${env.fetches[0] && env.fetches[0].url}`);
if (run1.status !== 'OK') { console.error('Run 1 failed'); process.exit(1); }
const email1 = env.emails[0];

env.context = 'trigger';
const run2 = gas.runWeeklyReportScheduled();
say(`Run 2 (weekly trigger): ${run2.status}. Rates from ${run2.fx.source}. HTTP requests so far: ${env.fetches.length}`);

// ---------- Save the outputs of the real runs ----------
const s = run1.summary;
const usedCurrencies = [...new Set(run1.rows.map((r) => r.currency))].sort();
write('summary.json', JSON.stringify(s, null, 2) + '\n');
write('summary-weekly.csv', csv(['week_start', 'week', 'orders', 'revenue_usd', 'change_vs_previous_week'],
  s.weekly.map((w) => [w.weekStart, w.label, w.orders, w.revenue.toFixed(2), w.change === null ? '' : w.change.toFixed(4)])));
const groupCsv = (list) => csv(['name', 'orders', 'units', 'revenue_usd', 'previous_week_usd', 'change_vs_previous_week'],
  list.map((g) => [g.name, g.orders, g.units, g.revenue.toFixed(2), g.prevRevenue.toFixed(2), g.change === null ? '' : g.change.toFixed(4)]));
write('summary-by-region.csv', groupCsv(s.byRegion));
write('summary-by-product.csv', groupCsv(s.byProduct));
write('summary-top5.csv', csv(['rank', 'product', 'orders', 'revenue_usd', 'share_of_week'], s.top5.map((p) => [p.rank, p.name, p.orders, p.revenue.toFixed(2), p.share.toFixed(4)])));
write('issues.json', JSON.stringify(run1.issues.map((i) => ({ row: i.row, id: i.id, codes: i.codes, reason: i.reason, values: i.values })), null, 2) + '\n');

for (const sheet of env.ss.getSheets()) {
  const file = sheet.getName().toLowerCase().replace(/\s+/g, '-');
  write(`sheets/${file}.csv`, sheetToCsv(sheet, TZ));
}
const summarySheet = env.ss.getSheetByName('Summary');
write('chart.json', JSON.stringify(summarySheet.getCharts().map((c) => c.spec), null, 2) + '\n');

write('email.html', htmlDoc(email1.subject, email1.htmlBody));
write('email-body.html', email1.htmlBody + '\n');
write('email.txt', email1.body + '\n');
write('email-meta.json', JSON.stringify({ to: email1.to, subject: email1.subject, name: email1.name, note: 'Captured by the MailApp mock in the local test run; not actually sent.' }, null, 2) + '\n');

const fxSaved = { source_url: env.fetches[0].url, date: run1.fx.date, fetchedAt: run1.fx.fetchedAt, fetch_ms: env.fetches[0].ms,
  used: Object.fromEntries(usedCurrencies.map((c) => [c, run1.fx.rates[c]])), currencies_in_answer: Object.keys(run1.fx.rates).length, rates: run1.fx.rates };
write('fx-rates.json', JSON.stringify(fxSaved, null, 2) + '\n');

const counts = gas.issueCounts_(run1.issues);
const runSummary = {
  note: 'Local test run: the real Apps Script files in apps-script/ run in Node with mocked Google services; UrlFetchApp made a real request to the Frankfurter API. Emails were captured, not sent.',
  started_at: startedAt.toISOString(),
  node: process.version,
  time_zone: TZ,
  clock: { as_of_day: AS_OF_DAY, shift_hours: Math.round(env.clock.shiftMs / 3600000), note: clockNote },
  input: { file: 'sample-data/orders.csv', import: IMPORT_NOTE, rows_read: run1.stats.read, blank_rows_skipped: run1.stats.blank, clean_orders: run1.stats.kept, issue_rows: run1.issues.length },
  issues_by_reason: counts.map((c) => ({ reason: c.label, rows: c.count })),
  report_week: s.week, previous_week: s.previousWeek, kpis: s.kpis, data_from: s.dataFrom, data_to: s.dataTo,
  fx: { date: run1.fx.date, source_run1: run1.fx.source, source_run2: run2.fx.source, fetch_ms: env.fetches[0].ms, http_requests_total: env.fetches.length, used: fxSaved.used },
  runs: env.ss.getSheetByName('Run log').getDataRange().getValues().slice(1).map((r) => ({ source: r[1], status: r[2], seconds: r[11], fx: r[9], email: r[10] })),
  email: { to: email1.to, subject: email1.subject, bytes: Buffer.byteLength(email1.htmlBody) },
  emails_captured: env.emails.length,
  menu: env.menus,
  trigger: trig.spec,
  alerts: env.alerts,
  sheets: env.ss.getSheets().map((sh) => sh.getName()),
};

// ---------- 3: simulated outage (separate spreadsheet, no saved rates) ----------
const outage = createGasEnv({ timeZone: TZ, spreadsheetName: 'Sales orders (sample)', asOfDay: AS_OF_DAY, fetchImpl: () => ({ error: 'getaddrinfo ENOTFOUND api.frankfurter.dev' }) });
const gas3 = loadProject(outage);
fillSheet(outage, 'Orders', sheetValuesFromCsv(ordersCsv, TZ, IMPORT));
fillSheet(outage, 'Settings', settingsRows(OWNER));
outage.context = 'trigger';
const run3 = gas3.runWeeklyReportScheduled();
const touched = ['Summary', 'Issues', 'Clean data'].filter((n) => outage.ss.getSheetByName(n));
say(`Run 3 (simulated outage, rate API unreachable, no saved rates): ${run3.status}. ${run3.message}`);
say(`  Retries: ${outage.fetches.length} requests. Output sheets created: ${touched.length ? touched.join(', ') : 'none'}. Error email to: ${outage.emails.map((e) => e.to).join(', ')}`);
write('simulated-outage/error-email.html', htmlDoc(outage.emails[0].subject, outage.emails[0].htmlBody));
write('simulated-outage/run-log.csv', sheetToCsv(outage.ss.getSheetByName('Run log'), TZ));
runSummary.simulated_outage = { status: run3.status, message: run3.message, requests: outage.fetches.length, output_sheets_written: touched, error_email_subject: outage.emails[0].subject };

write('run-summary.json', JSON.stringify(runSummary, null, 2) + '\n');
write('run-console.txt', lines.join('\n') + '\n');
say(`Saved outputs to ${path.relative(process.cwd(), OUT) || 'outputs'}/`);
