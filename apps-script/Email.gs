/**
 * The weekly email (HTML with inline styles and a plain-text copy) and the error email.
 */
var C_INK = '#14202B';
var C_MUTED = '#5B6B7A';
var C_RULE = '#D5DBE1';
var C_UP = '#1B7F4B';
var C_DOWN = '#B3261E';
var C_BAR = '#2A78D6';

function escapeHtml_(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function money_(n) {
  var neg = n < 0;
  var parts = Math.abs(n).toFixed(0).split('.');
  return (neg ? '-$' : '$') + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function int_(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function pctText_(c) {
  if (c === null || c === undefined) return 'new';
  var v = (c * 100).toFixed(1);
  return (c > 0 ? '+' : '') + v + '%';
}

function changeHtml_(c) {
  if (c === null || c === undefined) return '<span style="color:' + C_MUTED + '">new</span>';
  var color = c > 0 ? C_UP : c < 0 ? C_DOWN : C_MUTED;
  var arrow = c > 0 ? '&#9650; ' : c < 0 ? '&#9660; ' : '';
  return '<span style="color:' + color + ';white-space:nowrap">' + arrow + escapeHtml_(pctText_(c)) + '</span>';
}

function emailSubject_(s) {
  return 'Weekly sales report, ' + s.week.label + ': ' + money_(s.kpis.revenue) +
    (s.kpis.change === null ? '' : ' (' + pctText_(s.kpis.change) + ' vs previous week)');
}

/** meta: { spreadsheetName, url, generatedText, stats, issues, fx, currencies } */
function buildEmailHtml_(s, meta) {
  var th = 'style="text-align:left;padding:6px 8px;border-bottom:2px solid ' + C_RULE + ';color:' + C_MUTED + ';font-weight:600;font-size:13px"';
  var thr = 'style="text-align:right;padding:6px 8px;border-bottom:2px solid ' + C_RULE + ';color:' + C_MUTED + ';font-weight:600;font-size:13px"';
  var td = 'style="padding:6px 8px;border-bottom:1px solid ' + C_RULE + ';font-size:14px"';
  var tdr = 'style="padding:6px 8px;border-bottom:1px solid ' + C_RULE + ';font-size:14px;text-align:right;white-space:nowrap"';
  var table = 'width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 20px"';
  var h3 = function (t) { return '<h3 style="font-size:16px;margin:24px 0 8px;color:' + C_INK + '">' + escapeHtml_(t) + '</h3>'; };

  var kpi = function (label, value, note) {
    return '<td style="padding:12px;border:1px solid ' + C_RULE + ';border-radius:6px;vertical-align:top;width:33%">' +
      '<div style="font-size:12px;color:' + C_MUTED + '">' + escapeHtml_(label) + '</div>' +
      '<div style="font-size:22px;font-weight:700;color:' + C_INK + ';margin-top:2px">' + value + '</div>' +
      (note ? '<div style="font-size:12px;margin-top:2px">' + note + '</div>' : '') + '</td>';
  };

  var html = [];
  html.push('<div style="font-family:Arial,Helvetica,sans-serif;color:' + C_INK + ';max-width:640px;margin:0 auto;line-height:1.4">');
  html.push('<h2 style="font-size:20px;margin:0 0 4px">Weekly sales report</h2>');
  html.push('<div style="color:' + C_MUTED + ';font-size:14px;margin-bottom:16px">' + escapeHtml_(s.week.label) +
    ' (Monday to Sunday) &middot; all amounts in USD</div>');

  html.push('<table width="100%" cellpadding="0" cellspacing="8" style="border-collapse:separate;margin:0 -8px 8px"><tr>' +
    kpi('Revenue', escapeHtml_(money_(s.kpis.revenue)), changeHtml_(s.kpis.change) + ' <span style="color:' + C_MUTED + '">vs ' + escapeHtml_(money_(s.kpis.prevRevenue)) + '</span>') +
    kpi('Orders', escapeHtml_(int_(s.kpis.orders)), '<span style="color:' + C_MUTED + '">previous week ' + escapeHtml_(int_(s.kpis.prevOrders)) + '</span>') +
    kpi('Average order', escapeHtml_(money_(s.kpis.avgOrder)), '') +
    '</tr></table>');

  html.push(h3('By region'));
  html.push('<table ' + table + '><tr><th ' + th + '>Region</th><th ' + thr + '>Orders</th><th ' + thr + '>Revenue</th><th ' + thr + '>vs previous week</th></tr>');
  s.byRegion.forEach(function (g) {
    html.push('<tr><td ' + td + '>' + escapeHtml_(g.name) + '</td><td ' + tdr + '>' + int_(g.orders) + '</td><td ' + tdr + '>' +
      escapeHtml_(money_(g.revenue)) + '</td><td ' + tdr + '>' + changeHtml_(g.change) + '</td></tr>');
  });
  html.push('</table>');

  html.push(h3('Top 5 products'));
  html.push('<table ' + table + '><tr><th ' + th + '>#</th><th ' + th + '>Product</th><th ' + thr + '>Revenue</th><th ' + thr + '>Share</th></tr>');
  s.top5.forEach(function (p) {
    html.push('<tr><td ' + td + '>' + p.rank + '</td><td ' + td + '>' + escapeHtml_(p.name) + '</td><td ' + tdr + '>' +
      escapeHtml_(money_(p.revenue)) + '</td><td ' + tdr + '>' + (p.share * 100).toFixed(1) + '%</td></tr>');
  });
  html.push('</table>');

  var max = s.weekly.reduce(function (m, w) { return Math.max(m, w.revenue); }, 0) || 1;
  html.push(h3('Last ' + s.weekly.length + ' weeks'));
  html.push('<table ' + table + '>');
  s.weekly.forEach(function (w, i) {
    var pct = Math.max(1, Math.round((w.revenue / max) * 100));
    var color = i === s.weekly.length - 1 ? C_BAR : '#9DB9DD';
    // Each bar is a table cell with width and bgcolor attributes, not a sized <div>.
    var bar = '<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse"><tr>' +
      '<td width="' + pct + '%" height="14" bgcolor="' + color + '" style="background:' + color + ';height:14px;font-size:1px;line-height:1px">&nbsp;</td>' +
      (pct < 100 ? '<td width="' + (100 - pct) + '%" style="font-size:1px;line-height:1px">&nbsp;</td>' : '') + '</tr></table>';
    html.push('<tr><td style="padding:3px 8px 3px 0;font-size:13px;color:' + C_MUTED + ';white-space:nowrap;width:110px">' + escapeHtml_(w.label) + '</td>' +
      '<td style="padding:3px 0">' + bar + '</td>' +
      '<td style="padding:3px 0 3px 8px;font-size:13px;text-align:right;white-space:nowrap;width:80px">' + escapeHtml_(money_(w.revenue)) + '</td></tr>');
  });
  html.push('</table>');

  html.push(h3('Data checks'));
  if (meta.issues.length) {
    var counts = issueCounts_(meta.issues);
    html.push('<p style="font-size:14px;margin:0 0 8px">' + int_(meta.stats.read) + ' rows read, ' + int_(meta.stats.kept) + ' used. <b>' +
      int_(meta.issues.length) + ' rows were left out</b> and are listed in the Issues sheet with the reason:</p>');
    html.push('<ul style="font-size:14px;margin:0 0 8px;padding-left:20px">');
    counts.forEach(function (c) { html.push('<li>' + escapeHtml_(c.label) + ': ' + c.count + '</li>'); });
    html.push('</ul>');
  } else {
    html.push('<p style="font-size:14px">' + int_(meta.stats.read) + ' rows read, all used. No problems found.</p>');
  }
  if (meta.fx.warning) {
    html.push('<p style="font-size:14px;color:' + C_DOWN + '">' + escapeHtml_(meta.fx.warning) + '</p>');
  }

  if (meta.url) {
    html.push('<p style="margin:20px 0"><a href="' + escapeHtml_(meta.url) + '" style="background:' + C_INK +
      ';color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;display:inline-block">Open the sheet</a></p>');
  }
  var rates = meta.currencies.filter(function (c) { return c !== 'USD'; }).map(function (c) {
    return '1 USD = ' + meta.fx.rates[c] + ' ' + c;
  }).join(', ');
  html.push('<p style="font-size:12px;color:' + C_MUTED + ';margin-top:16px">Exchange rates: ' + escapeHtml_(rates) +
    ' (Frankfurter, ' + escapeHtml_(meta.fx.date) + ', ' + escapeHtml_(meta.fx.source) + '). Sent by the weekly report script in "' +
    escapeHtml_(meta.spreadsheetName) + '", ' + escapeHtml_(meta.generatedText) + '.</p>');
  html.push('</div>');
  return html.join('\n');
}

/** Plain-text version for mail apps that do not show HTML. */
function buildEmailText_(s, meta) {
  var lines = ['Weekly sales report, ' + s.week.label + ' (USD)', '',
    'Revenue: ' + money_(s.kpis.revenue) + ' (' + pctText_(s.kpis.change) + ' vs previous week)',
    'Orders: ' + s.kpis.orders + ', average order ' + money_(s.kpis.avgOrder), '', 'By region:'];
  s.byRegion.forEach(function (g) { lines.push('  ' + g.name + ': ' + money_(g.revenue) + ' (' + pctText_(g.change) + ')'); });
  lines.push('', 'Top 5 products:');
  s.top5.forEach(function (p) { lines.push('  ' + p.rank + '. ' + p.name + ': ' + money_(p.revenue)); });
  lines.push('', meta.issues.length + ' rows left out, see the Issues sheet.');
  if (meta.url) lines.push('', meta.url);
  return lines.join('\n');
}

function issueCounts_(issues) {
  var counts = Object.create(null);
  issues.forEach(function (i) { i.codes.forEach(function (c) { counts[c] = (counts[c] || 0) + 1; }); });
  return Object.keys(counts).map(function (c) { return { code: c, label: ISSUE_LABELS[c] || c, count: counts[c] }; })
    .sort(function (a, b) { return b.count - a.count || (a.label < b.label ? -1 : 1); });
}

function buildErrorEmailHtml_(err, meta, writing) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;color:' + C_INK + ';max-width:640px;line-height:1.4">' +
    '<h2 style="font-size:20px;margin:0 0 8px;color:' + C_DOWN + '">The weekly report did not run</h2>' +
    '<p style="font-size:14px">' + escapeHtml_(err && err.message ? err.message : String(err)) + '</p>' +
    '<p style="font-size:14px">' + (writing ? 'Some output sheets may be half-written: run the report again from the Reports menu.'
      : 'The Summary, Issues and Clean data sheets were not changed.') + ' The failure is also in the Run log sheet.</p>' +
    (meta.url ? '<p><a href="' + escapeHtml_(meta.url) + '">Open the sheet</a></p>' : '') +
    '<p style="font-size:12px;color:' + C_MUTED + '">' + escapeHtml_(meta.spreadsheetName) + ', ' + escapeHtml_(meta.generatedText) +
    ', started by: ' + escapeHtml_(meta.source) + '.</p></div>';
}
