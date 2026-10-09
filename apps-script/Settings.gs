/**
 * Settings sheet: one setting per row (Setting | Value | Help).
 * Created with defaults the first time the report runs, so the owner only fills in their email.
 */
var SETTINGS_SHEET = 'Settings';
var SETTINGS_DEFAULTS = [
  ['Owner email', '', 'Where the weekly report and any error email are sent.'],
  ['Send email', 'Yes', 'Yes or No.'],
  ['Text dates are', 'DD/MM/YYYY', 'How to read dates typed as text: DD/MM/YYYY or MM/DD/YYYY. Real date cells and YYYY-MM-DD always work.'],
  ['Report week ending', '', 'Blank = the last full week (Monday to Sunday). Or a date, to re-run the week that contains it.'],
];

function readSettings_(ss) {
  var sheet = ss.getSheetByName(SETTINGS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SETTINGS_SHEET);
    var rows = [['Setting', 'Value', 'Help']].concat(SETTINGS_DEFAULTS);
    sheet.getRange(1, 1, rows.length, 3).setValues(rows);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  var map = Object.create(null);
  sheet.getDataRange().getValues().forEach(function (row) {
    var key = String(row[0] === undefined ? '' : row[0]).trim().toLowerCase();
    if (key) map[key] = row[1];
  });
  var text = function (key) { return map[key] === undefined || map[key] === null ? '' : String(map[key]).trim(); };

  var email = text('owner email');
  var dateOrder = /^mm/i.test(text('text dates are')) ? 'MDY' : 'DMY';
  var weekEnding = map['report week ending'];
  return {
    ownerEmail: isValidEmail_(email) ? email : '',
    ownerEmailRaw: email,
    sendEmail: !/^(no|n|false|0)$/i.test(text('send email')),
    dateOrder: dateOrder,
    weekEnding: weekEnding === '' || weekEnding === undefined || weekEnding === null ? null : weekEnding,
  };
}

function isValidEmail_(value) {
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[A-Za-z]{2,}$/.test(String(value || ''));
}
