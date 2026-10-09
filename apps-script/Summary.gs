/**
 * Weekly totals (weeks run Monday to Sunday), by region and product, top 5 products, change vs the previous week.
 * buildSummary_ is pure; writeSummarySheet_ writes the Summary sheet and its chart.
 */
var SUMMARY_SHEET = 'Summary';
var WEEKS_SHOWN = 8;
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayIndex_(key) {
  var p = key.split('-');
  return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
}

function keyFromIndex_(n) {
  var d = new Date(n * 86400000);
  return dayKey_(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function weekStartKey_(key) {
  var n = dayIndex_(key);
  var mondayBased = (new Date(n * 86400000).getUTCDay() + 6) % 7;
  return keyFromIndex_(n - mondayBased);
}

function addDays_(key, days) {
  return keyFromIndex_(dayIndex_(key) + days);
}

/** "21–27 Sep" or "31 Aug–6 Sep"; with year when asked. */
function weekLabel_(startKey, withYear) {
  var endKey = addDays_(startKey, 6);
  var s = startKey.split('-');
  var e = endKey.split('-');
  var label = +s[1] === +e[1]
    ? +s[2] + '–' + +e[2] + ' ' + MONTHS[+e[1] - 1]
    : +s[2] + ' ' + MONTHS[+s[1] - 1] + '–' + +e[2] + ' ' + MONTHS[+e[1] - 1];
  return withYear ? label + ' ' + e[0] : label;
}

/** The report week: the last full Monday-Sunday week before today, or the week containing Settings > Report week ending. */
function reportWeek_(todayKey, weekEnding, dateOrder, timeZone) {
  var start;
  if (weekEnding !== null && weekEnding !== undefined && weekEnding !== '') {
    var parsed = parseDate_(weekEnding, dateOrder, timeZone);
    if (parsed.error) throw new Error('Settings > Report week ending is not a readable date: "' + tidyText_(weekEnding) + '".');
    start = weekStartKey_(parsed.key);
  } else {
    start = addDays_(weekStartKey_(todayKey), -7);
  }
  return { start: start, end: addDays_(start, 6), label: weekLabel_(start, true) };
}

function buildSummary_(rows, week) {
  var byWeek = Object.create(null);
  rows.forEach(function (r) {
    r.weekStart = weekStartKey_(r.dayKey);
    var w = byWeek[r.weekStart] || (byWeek[r.weekStart] = { orders: 0, units: 0, revenue: 0 });
    w.orders += 1;
    w.units += r.qty;
    w.revenue += r.amountUsd;
  });
  var totalsFor = function (start) { return byWeek[start] || { orders: 0, units: 0, revenue: 0 }; };

  var weekly = [];
  for (var k = WEEKS_SHOWN - 1; k >= 0; k--) {
    var ws = addDays_(week.start, -7 * k);
    var t = totalsFor(ws);
    var before = totalsFor(addDays_(ws, -7));
    weekly.push({ weekStart: ws, label: weekLabel_(ws, false), orders: t.orders, revenue: round2_(t.revenue), change: change_(t.revenue, before.revenue) });
  }

  var prevStart = addDays_(week.start, -7);
  var thisRows = rows.filter(function (r) { return r.weekStart === week.start; });
  var prevRows = rows.filter(function (r) { return r.weekStart === prevStart; });
  var cur = totalsFor(week.start);
  var prev = totalsFor(prevStart);
  var byProduct = groupWeek_(thisRows, prevRows, 'product');
  var total = round2_(cur.revenue);

  return {
    week: week,
    previousWeek: { start: prevStart, end: addDays_(prevStart, 6), label: weekLabel_(prevStart, true) },
    kpis: {
      revenue: total,
      orders: cur.orders,
      units: cur.units,
      avgOrder: cur.orders ? round2_(cur.revenue / cur.orders) : 0,
      prevRevenue: round2_(prev.revenue),
      prevOrders: prev.orders,
      change: change_(cur.revenue, prev.revenue),
    },
    weekly: weekly,
    byRegion: groupWeek_(thisRows, prevRows, 'region'),
    byProduct: byProduct,
    top5: byProduct.filter(function (p) { return p.revenue > 0; }).slice(0, 5).map(function (p, i) {
      return { rank: i + 1, name: p.name, orders: p.orders, units: p.units, revenue: p.revenue, share: total ? p.revenue / total : 0 };
    }),
    dataFrom: rows.length ? rows.reduce(function (m, r) { return r.dayKey < m ? r.dayKey : m; }, rows[0].dayKey) : '',
    dataTo: rows.length ? rows.reduce(function (m, r) { return r.dayKey > m ? r.dayKey : m; }, rows[0].dayKey) : '',
  };
}

function groupWeek_(thisRows, prevRows, field) {
  var groups = Object.create(null);
  var get = function (name) { return groups[name] || (groups[name] = { name: name, orders: 0, units: 0, revenue: 0, prevRevenue: 0 }); };
  thisRows.forEach(function (r) { var g = get(r[field]); g.orders += 1; g.units += r.qty; g.revenue += r.amountUsd; });
  prevRows.forEach(function (r) { get(r[field]).prevRevenue += r.amountUsd; });
  return Object.keys(groups).map(function (name) {
    var g = groups[name];
    g.revenue = round2_(g.revenue);
    g.prevRevenue = round2_(g.prevRevenue);
    g.change = change_(g.revenue, g.prevRevenue);
    return g;
  }).sort(function (a, b) { return b.revenue - a.revenue || (a.name < b.name ? -1 : 1); });
}

/** Share change vs the previous value, or null when there is nothing to compare with. */
function change_(cur, prev) {
  return prev > 0 ? (cur - prev) / prev : null;
}

var FMT_USD = '#,##0.00';
var FMT_INT = '#,##0';
var FMT_PCT = '+0.0%;-0.0%;0.0%';

function writeSummarySheet_(ss, s, meta) {
  var sheet = getOrCreateSheet_(ss, SUMMARY_SHEET);
  resetSheet_(sheet);
  var changeCell = function (c, cur) { return c === null ? (cur > 0 ? 'new' : '') : c; };

  sheet.getRange(1, 1, 2, 1).setValues([['Weekly sales report: ' + s.week.label],
    ['All amounts in USD. Updated ' + meta.generatedText + '. ' + meta.rowsLeftOut + ' row(s) left out, see the Issues sheet.']]);
  sheet.getRange(1, 1).setFontSize(14).setFontWeight('bold');
  sheet.getRange(2, 1).setFontColor('#5B6B7A');

  var row = 4;
  row = writeTable_(sheet, row, 'This week',
    ['Revenue (USD)', 'Orders', 'Average order (USD)', 'vs previous week', 'Previous week (USD)'],
    [[s.kpis.revenue, s.kpis.orders, s.kpis.avgOrder, changeCell(s.kpis.change, s.kpis.revenue), s.kpis.prevRevenue]],
    [FMT_USD, FMT_INT, FMT_USD, FMT_PCT, FMT_USD]);

  var weeklyTop = row + 2; // first data row of the weekly table (after its title and header): the chart reads it
  row = writeTable_(sheet, row, 'Revenue by week',
    ['Week (Mon–Sun)', 'Orders', 'Revenue (USD)', 'vs previous week'],
    s.weekly.map(function (w) { return [w.label, w.orders, w.revenue, w.change === null ? '' : w.change]; }),
    ['@', FMT_INT, FMT_USD, FMT_PCT]);

  var groupRows = function (list) {
    return list.map(function (g) { return [safeText_(g.name), g.orders, g.revenue, g.prevRevenue, changeCell(g.change, g.revenue)]; });
  };
  row = writeTable_(sheet, row, 'By region',
    ['Region', 'Orders', 'Revenue (USD)', 'Previous week (USD)', 'vs previous week'], groupRows(s.byRegion),
    ['@', FMT_INT, FMT_USD, FMT_USD, FMT_PCT]);
  row = writeTable_(sheet, row, 'By product',
    ['Product', 'Orders', 'Revenue (USD)', 'Previous week (USD)', 'vs previous week'], groupRows(s.byProduct),
    ['@', FMT_INT, FMT_USD, FMT_USD, FMT_PCT]);
  row = writeTable_(sheet, row, 'Top 5 products',
    ['Rank', 'Product', 'Revenue (USD)', 'Share of week'],
    s.top5.map(function (p) { return [p.rank, safeText_(p.name), p.revenue, p.share]; }),
    [FMT_INT, '@', FMT_USD, '0.0%']);

  var fxRows = meta.currencies.map(function (c) { return [c, meta.fx.rates[c]]; });
  row = writeTable_(sheet, row, 'Exchange rates used (' + meta.fx.date + ', ' + meta.fx.source + ')',
    ['Currency', 'Units per 1 USD'], fxRows, ['@', '0.0000']);

  var chart = sheet.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(sheet.getRange(weeklyTop, 1, s.weekly.length, 1))
    .addRange(sheet.getRange(weeklyTop, 3, s.weekly.length, 1))
    .setPosition(4, 7, 0, 0)
    .setOption('title', 'Revenue by week (USD)')
    .setOption('legend', { position: 'none' })
    .setOption('width', 560)
    .setOption('height', 320)
    .build();
  sheet.insertChart(chart);
  sheet.setColumnWidth(1, 170);
  sheet.autoResizeColumns(2, 4);
  return sheet;
}

/** Writes a titled table and returns the next free row (one blank row after the table). */
function writeTable_(sheet, row, title, header, rows, formats) {
  sheet.getRange(row, 1).setValue(title).setFontWeight('bold');
  sheet.getRange(row + 1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#EEF2F6');
  if (rows.length) {
    sheet.getRange(row + 2, 1, rows.length, header.length).setValues(rows);
    formats.forEach(function (f, i) { sheet.getRange(row + 2, i + 1, rows.length, 1).setNumberFormat(f); });
  }
  return row + 2 + rows.length + 1;
}
