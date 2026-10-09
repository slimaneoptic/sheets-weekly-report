/**
 * Cleaning rules for the Orders sheet. Pure functions: no sheet access, so they are easy to test.
 * A row with any problem is left out of the totals and listed in the Issues sheet with the reason.
 */
var ORDERS_SHEET = 'Orders';
var ORDER_FIELDS = [
  { key: 'id', header: 'Order ID', required: true },
  { key: 'date', header: 'Order Date', required: true },
  { key: 'customer', header: 'Customer', required: false },
  { key: 'region', header: 'Region', required: true },
  { key: 'product', header: 'Product', required: true },
  { key: 'qty', header: 'Qty', required: true },
  { key: 'amount', header: 'Amount', required: true },
  { key: 'currency', header: 'Currency', required: true },
];
var CURRENCY_ALIASES = { '€': 'EUR', 'EURO': 'EUR', 'EUROS': 'EUR', '£': 'GBP', '$': 'USD', 'US$': 'USD', 'DH': 'MAD', 'DHS': 'MAD', 'DIRHAM': 'MAD' };
var ISSUE_LABELS = {
  duplicate: 'Duplicate row',
  id_conflict: 'Order ID reused with different values',
  missing_id: 'Missing order ID',
  missing_date: 'Missing date',
  bad_date: 'Unreadable date',
  future_date: 'Date in the future',
  missing_region: 'Missing region',
  missing_product: 'Missing product',
  bad_qty: 'Bad quantity',
  missing_amount: 'Missing amount',
  bad_amount: 'Bad amount',
  missing_currency: 'Missing currency',
  unknown_currency: 'No exchange rate for currency',
};

/**
 * values: the Orders sheet as getValues() returns it (header row first).
 * opts: { dateOrder: 'DMY' | 'MDY', todayKey: 'yyyy-MM-dd', timeZone: 'Area/City' }
 * Returns { rows, issues, stats }.
 */
function cleanOrders_(values, opts) {
  if (!values || values.length === 0) throw new Error('The Orders sheet is empty.');
  var cols = findColumns_(values[0]);
  var rows = [];
  var issues = [];
  var blank = 0;

  for (var i = 1; i < values.length; i++) {
    var raw = values[i];
    var sheetRow = i + 1;
    if (raw.every(function (v) { return tidyText_(v) === ''; })) { blank++; continue; }

    var cell = function (key) { return cols[key] === undefined ? '' : raw[cols[key]]; };
    var problems = [];
    var add = function (code, detail) { problems.push({ code: code, text: ISSUE_LABELS[code] + (detail ? ': ' + detail : '') }); };

    var id = tidyText_(cell('id'));
    if (!id) add('missing_id');

    var date = parseDate_(cell('date'), opts.dateOrder, opts.timeZone);
    if (date.error === 'missing') add('missing_date');
    else if (date.error) add('bad_date', '"' + tidyText_(cell('date')) + '"');
    else if (opts.todayKey && date.key > opts.todayKey) add('future_date', date.key);

    var region = tidyText_(cell('region'));
    if (!region) add('missing_region');
    var product = tidyText_(cell('product'));
    if (!product) add('missing_product');

    var qtyText = tidyText_(cell('qty'));
    var qty = parseAmount_(cell('qty'));
    if (qty === null || qty <= 0 || Math.floor(qty) !== qty) {
      add('bad_qty', (qtyText === '' ? 'blank' : '"' + qtyText + '"') + ' (needs a whole number above 0)');
    }

    var amountText = tidyText_(cell('amount'));
    var amount = parseAmount_(cell('amount'));
    if (amountText === '') add('missing_amount');
    else if (amount === null) add('bad_amount', '"' + amountText + '" is not a number');
    else if (amount <= 0) add('bad_amount', amountText + ' (must be above 0)');

    var currency = normalizeCurrency_(cell('currency'));
    if (currency.error === 'missing') add('missing_currency');
    else if (currency.error) add('unknown_currency', '"' + tidyText_(cell('currency')) + '"');

    if (problems.length) {
      issues.push(makeIssue_(sheetRow, id, problems, raw, cols, opts.timeZone));
      continue;
    }
    rows.push({
      row: sheetRow, id: id, dayKey: date.key, customer: tidyText_(cell('customer')),
      region: region, product: product, qty: qty, amount: round2_(amount), currency: currency.code, raw: raw, cols: cols,
    });
  }

  // Same name in different letter case or spacing counts as one (the most used spelling wins).
  canonicalizeNames_(rows, 'region');
  canonicalizeNames_(rows, 'product');

  // Duplicates: the first valid copy of an order ID is kept.
  var seen = Object.create(null); // keyed by text from the sheet: no inherited keys such as "constructor"
  var kept = [];
  rows.forEach(function (r) {
    var key = r.id.toLowerCase();
    var first = seen[key];
    if (!first) { seen[key] = r; kept.push(r); return; }
    var same = signature_(first) === signature_(r);
    var problem = same
      ? { code: 'duplicate', text: 'Duplicate of row ' + first.row }
      : { code: 'id_conflict', text: 'Order ID ' + r.id + ' already used in row ' + first.row + ' with different values (row ' + first.row + ' kept)' };
    issues.push(makeIssue_(r.row, r.id, [problem], r.raw, cols, opts.timeZone));
  });

  issues.sort(function (a, b) { return a.row - b.row; });
  return {
    rows: kept,
    issues: issues,
    stats: { read: values.length - 1, blank: blank, kept: kept.length, issues: issues.length },
  };
}

function findColumns_(header) {
  var index = Object.create(null);
  header.forEach(function (h, i) { index[tidyText_(h).toLowerCase()] = i; });
  var cols = {};
  var missing = [];
  ORDER_FIELDS.forEach(function (f) {
    var i = index[f.header.toLowerCase()];
    if (i === undefined) { if (f.required) missing.push(f.header); } else cols[f.key] = i;
  });
  if (missing.length) {
    throw new Error('The Orders sheet is missing column(s): ' + missing.join(', ') +
      '. Row 1 must have these headers: ' + ORDER_FIELDS.map(function (f) { return f.header; }).join(', ') + '.');
  }
  return cols;
}

function makeIssue_(sheetRow, id, problems, raw, cols, timeZone) {
  return {
    row: sheetRow,
    id: id || '',
    codes: problems.map(function (p) { return p.code; }),
    reason: problems.map(function (p) { return p.text; }).join('; '),
    values: ORDER_FIELDS.map(function (f) { return cols[f.key] === undefined ? '' : displayValue_(raw[cols[f.key]], timeZone); }),
  };
}

function signature_(r) {
  return [r.dayKey, r.customer.toLowerCase(), r.region, r.product, r.qty, r.amount, r.currency].join('|');
}

/** Trim, collapse inner spaces (including non-breaking spaces). */
function tidyText_(v) {
  if (v === null || v === undefined) return '';
  if (isDate_(v)) return String(v);
  return String(v).replace(/[\s ]+/g, ' ').trim();
}

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

function displayValue_(v, timeZone) {
  if (isDate_(v)) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, timeZone || 'Etc/UTC', 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v);
}

function canonicalizeNames_(rows, field) {
  var counts = Object.create(null);
  rows.forEach(function (r) {
    var key = r[field].toLowerCase();
    counts[key] = counts[key] || Object.create(null);
    counts[key][r[field]] = (counts[key][r[field]] || 0) + 1;
  });
  var best = Object.create(null);
  Object.keys(counts).forEach(function (key) {
    var spellings = counts[key];
    best[key] = Object.keys(spellings).sort(function (a, b) { return spellings[b] - spellings[a]; })[0];
  });
  rows.forEach(function (r) { r[field] = best[r[field].toLowerCase()]; });
}

/**
 * Reads a date cell. Real date cells, YYYY-MM-DD text (optionally with a time), DD/MM/YYYY or MM/DD/YYYY text
 * (set in Settings), and Sheets date serial numbers. Returns { key: 'yyyy-MM-dd' } or { error }.
 */
function parseDate_(v, dateOrder, timeZone) {
  if (v === null || v === undefined || v === '') return { error: 'missing' };
  if (isDate_(v)) {
    if (isNaN(v.getTime())) return { error: 'bad' };
    return { key: Utilities.formatDate(v, timeZone || 'Etc/UTC', 'yyyy-MM-dd') };
  }
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return { error: 'bad' }; // Sheets serial numbers for years 1954 to 2119
    var ms = Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000;
    var d = new Date(ms);
    return { key: dayKey_(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) };
  }
  var s = tidyText_(v);
  if (s === '') return { error: 'missing' };
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (m) return validDay_(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (m) return dateOrder === 'MDY' ? validDay_(+m[3], +m[1], +m[2]) : validDay_(+m[3], +m[2], +m[1]);
  return { error: 'bad' };
}

function validDay_(y, mo, d) {
  var t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return { error: 'bad' };
  return { key: dayKey_(y, mo, d) };
}

function dayKey_(y, m, d) {
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
}

/**
 * Reads a number typed in many ways: 1250, "1,250.00", "1250,50", "1.250,50", "$ 845.00", "€95,00".
 * Returns null when it is not a clear number.
 */
function parseAmount_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = tidyText_(v);
  if (s === '') return null;
  s = s.replace(/^(USD|EUR|GBP|MAD|US\$|DHS?|€|£|\$)\s*/i, '').replace(/\s*(USD|EUR|GBP|MAD|DHS?|€|£|\$)$/i, '');
  s = s.replace(/[\s ']/g, '');
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return parseFloat(s.replace(/,/g, ''));
  if (/^-?\d+,\d{1,2}$/.test(s)) return parseFloat(s.replace(',', '.'));
  if (/^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  return null;
}

function normalizeCurrency_(v) {
  var s = tidyText_(v).toUpperCase();
  if (s === '') return { error: 'missing' };
  if (CURRENCY_ALIASES[s]) return { code: CURRENCY_ALIASES[s] };
  if (/^[A-Z]{3}$/.test(s)) return { code: s };
  return { error: 'unknown' };
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}
