/**
 * The Reports menu and the weekly trigger.
 */
var TRIGGER_HANDLER = 'runWeeklyReportScheduled';
var TRIGGER_HOUR = 7; // Google runs it at a random minute between 7:00 and 8:00

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Reports')
    .addItem('Run weekly report', 'runWeeklyReportFromMenu')
    .addSeparator()
    .addItem('Install weekly trigger', 'installWeeklyTrigger')
    .addItem('Remove weekly trigger', 'removeWeeklyTrigger')
    .addToUi();
}

/** Every Monday between 7 and 8 am in the spreadsheet's time zone. Installing twice keeps a single trigger. */
function installWeeklyTrigger() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var settings = readSettings_(ss);
  deleteReportTriggers_();
  ScriptApp.newTrigger(TRIGGER_HANDLER)
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(TRIGGER_HOUR)
    .inTimezone(tz)
    .create();
  var ui = SpreadsheetApp.getUi();
  ui.alert('Weekly trigger installed',
    'The report will run every Monday between ' + TRIGGER_HOUR + ' and ' + (TRIGGER_HOUR + 1) + ' am (' + tz + ') and ' +
    (settings.ownerEmail ? 'email ' + settings.ownerEmail + '.' : 'write the sheets. Add your email in the Settings sheet to get the email too.'),
    ui.ButtonSet.OK);
}

function removeWeeklyTrigger() {
  var removed = deleteReportTriggers_();
  var ui = SpreadsheetApp.getUi();
  ui.alert('Weekly trigger', removed ? 'The weekly trigger was removed.' : 'There was no weekly trigger to remove.', ui.ButtonSet.OK);
}

function deleteReportTriggers_() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  return removed;
}
