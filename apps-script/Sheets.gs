/**
 * Writes the output sheets. The Orders sheet itself is never changed.
 */
var ISSUES_SHEET = 'Issues';
var CLEAN_SHEET = 'Clean data';
var RUN_LOG_SHEET = 'Run log';
var RUN_LOG_HEADER = ['Run at', 'Started by', 'Status', 'Rows read', 'Clean orders', 'Issues', 'Report week',
  'Revenue (USD)', 'vs previous week', 'Exchange rates', 'Email sent to', 'Seconds', 'Note'];

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/** Empties a sheet (values, formats and charts) before it is rewritten. */
function resetSheet_(sheet) {
  sheet.getCharts().forEach(function (c) { sheet.removeChart(c); });
  sheet.clear();
}

/** Text that starts with "=" would be read as a formula; a leading apostrophe keeps it as text. */
function safeText_(v) {
  return typeof v === 'string' && /^[=+@]/.test(v) && isNaN(Number(v)) ? "'" + v : v;
}

function writeIssuesSheet_(ss, issues) {
  var sheet = getOrCreateSheet_(ss, ISSUES_SHEET);
  resetSheet_(sheet);
  var header = ['Orders row', 'Problem'].concat(ORDER_FIELDS.map(function (f) { return f.header; }));
  var rows = issues.map(function (i) { return [i.row, i.reason].concat(i.values.map(function (v) { return safeText_(String(v)); })); });
  if (!rows.length) rows = [['', 'No problems found in this run.', '', '', '', '', '', '', '', '']];
  sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#FDECEA');
  // Text format first, so values such as "31/09/2026" or "-120.00" stay exactly as they were typed.
  sheet.getRange(2, 3, rows.length, header.length - 2).setNumberFormat('@');
  sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(2, 380);
  return sheet;
}

function writeCleanSheet_(ss, rows) {
  var sheet = getOrCreateSheet_(ss, CLEAN_SHEET);
  resetSheet_(sheet);
  var header = ['Order ID', 'Order Date', 'Week (Mon)', 'Customer', 'Region', 'Product', 'Qty', 'Amount', 'Currency', 'Rate (per USD)', 'Amount (USD)', 'Orders row'];
  var values = rows.map(function (r) {
    return [safeText_(r.id), r.dayKey, r.weekStart || weekStartKey_(r.dayKey), safeText_(r.customer), safeText_(r.region),
      safeText_(r.product), r.qty, r.amount, r.currency, r.rate, r.amountUsd, r.row];
  });
  sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#EEF2F6');
  if (values.length) {
    sheet.getRange(2, 1, values.length, header.length).setValues(values);
    sheet.getRange(2, 2, values.length, 2).setNumberFormat('yyyy-mm-dd');
    sheet.getRange(2, 8, values.length, 1).setNumberFormat('#,##0.00');
    sheet.getRange(2, 10, values.length, 1).setNumberFormat('0.0000');
    sheet.getRange(2, 11, values.length, 1).setNumberFormat('#,##0.00');
  }
  sheet.setFrozenRows(1);
  return sheet;
}

/** One row per run, newest at the bottom. Never cleared. */
function appendRunLog_(ss, entry) {
  var sheet = ss.getSheetByName(RUN_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(RUN_LOG_SHEET);
    sheet.getRange(1, 1, 1, RUN_LOG_HEADER.length).setValues([RUN_LOG_HEADER]).setFontWeight('bold').setBackground('#EEF2F6');
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([entry.at, entry.source, entry.status, entry.read, entry.kept, entry.issues, entry.week,
    entry.revenue, entry.change, entry.fx, entry.emailTo, entry.seconds, entry.note]);
  var last = sheet.getLastRow();
  sheet.getRange(last, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange(last, 8).setNumberFormat('#,##0.00');
  sheet.getRange(last, 9).setNumberFormat('+0.0%;-0.0%;0.0%');
  if (entry.status !== 'OK') sheet.getRange(last, 1, 1, RUN_LOG_HEADER.length).setBackground('#FDECEA');
  return sheet;
}
