/**
 * One run of the weekly report: read Orders, clean, convert to USD, summarize, write the sheets, email, log.
 * Everything is computed first; the sheets are written only when all checks passed.
 */
function runWeeklyReportFromMenu() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('Cleaning the orders and building the report...', 'Weekly report', 30);
  var result = runReport_('menu', new Date());
  var ui = SpreadsheetApp.getUi();
  var title = result.status === 'OK' ? 'Weekly report done' : result.status === 'FAILED' ? 'The weekly report did not run' : 'Weekly report';
  ui.alert(title, result.message, ui.ButtonSet.OK);
  return result;
}

/** Called by the weekly time trigger (see Menu.gs). */
function runWeeklyReportScheduled() {
  return runReport_('weekly trigger', new Date());
}

function runReport_(source, now) {
  var t0 = Date.now();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) return { status: 'SKIPPED', message: 'Another run is in progress. Try again in a minute.' };

  var tz = ss.getSpreadsheetTimeZone();
  var meta = { spreadsheetName: ss.getName(), url: ss.getUrl(), generatedText: Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm') + ' (' + tz + ')', source: source };
  var log = { at: now, source: source, status: 'FAILED', read: '', kept: '', issues: '', week: '', revenue: '', change: '', fx: '', emailTo: '', seconds: 0, note: '' };
  var settings = null;
  var writing = false;
  var result;

  try {
    settings = readSettings_(ss);
    var orders = ss.getSheetByName(ORDERS_SHEET);
    if (!orders) throw new Error('There is no sheet named "' + ORDERS_SHEET + '". Rename the tab that holds the orders to ' + ORDERS_SHEET + '.');
    var todayKey = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    var week = reportWeek_(todayKey, settings.weekEnding, settings.dateOrder, tz);

    var cleaned = cleanOrders_(orders.getDataRange().getValues(), { dateOrder: settings.dateOrder, todayKey: todayKey, timeZone: tz });
    log.read = cleaned.stats.read;
    var fx = getUsdRates_(now.getTime());
    log.fx = fx.date + ' (' + fx.source + ')';
    var converted = applyFx_(cleaned.rows, fx.rates, tz);
    var issues = cleaned.issues.concat(converted.issues).sort(function (a, b) { return a.row - b.row; });
    var summary = buildSummary_(converted.rows, week);

    meta.stats = { read: cleaned.stats.read, blank: cleaned.stats.blank, kept: converted.rows.length };
    meta.issues = issues;
    meta.fx = fx;
    meta.rowsLeftOut = issues.length;
    meta.currencies = Object.keys(converted.rows.reduce(function (m, r) { m[r.currency] = true; return m; }, {})).sort();

    writing = true;
    writeCleanSheet_(ss, converted.rows);
    writeIssuesSheet_(ss, issues);
    writeSummarySheet_(ss, summary, meta);
    SpreadsheetApp.flush();

    var notes = [];
    if (fx.warning) notes.push(fx.warning);
    if (summary.kpis.orders === 0) notes.push('No orders in the report week.');
    if (!settings.sendEmail) {
      notes.push('Email is turned off in Settings.');
    } else if (!settings.ownerEmail) {
      notes.push(settings.ownerEmailRaw ? 'The owner email in Settings is not valid, so no email was sent.' : 'No owner email in Settings, so no email was sent.');
    } else {
      MailApp.sendEmail({
        to: settings.ownerEmail,
        subject: emailSubject_(summary),
        htmlBody: buildEmailHtml_(summary, meta),
        body: buildEmailText_(summary, meta),
        name: 'Weekly report',
      });
      log.emailTo = settings.ownerEmail;
    }

    log.status = 'OK';
    log.kept = converted.rows.length;
    log.issues = issues.length;
    log.week = summary.week.label;
    log.revenue = summary.kpis.revenue;
    log.change = summary.kpis.change === null ? '' : summary.kpis.change;
    log.note = notes.join(' ');
    result = {
      status: 'OK', summary: summary, issues: issues, rows: converted.rows, stats: meta.stats, fx: fx, settings: settings,
      message: summary.week.label + ': ' + money_(summary.kpis.revenue) + ' revenue (' + pctText_(summary.kpis.change) + ' vs previous week). ' +
        cleaned.stats.read + ' rows read, ' + converted.rows.length + ' used, ' + issues.length + ' left out (see the Issues sheet). ' +
        (log.emailTo ? 'Email sent to ' + log.emailTo + '.' : notes.join(' ')),
    };
  } catch (err) {
    var message = err && err.message ? err.message : String(err);
    if (writing) message += ' (The run stopped while writing the sheets: run it again to rebuild them.)';
    log.status = 'FAILED';
    log.note = message;
    if (settings && settings.ownerEmail) {
      try {
        MailApp.sendEmail({
          to: settings.ownerEmail,
          subject: 'Weekly report FAILED: ' + ss.getName(),
          htmlBody: buildErrorEmailHtml_({ message: message }, meta, writing),
          body: 'The weekly report did not run: ' + message,
          name: 'Weekly report',
        });
        log.emailTo = settings.ownerEmail + ' (error email)';
      } catch (mailErr) {
        log.note += ' Error email also failed: ' + mailErr.message;
      }
    }
    result = { status: 'FAILED', message: message };
  } finally {
    log.seconds = Math.round((Date.now() - t0) / 100) / 10;
    try {
      appendRunLog_(ss, log);
    } catch (logErr) {
      console.error('Could not write the Run log: ' + logErr.message);
    }
    lock.releaseLock();
  }
  return result;
}
