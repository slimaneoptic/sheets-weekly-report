// Minimal mocks of the Apps Script services this project uses, so the real .gs files run in Node.
// UrlFetchApp does a REAL HTTP request (synchronously, like Apps Script) unless a test passes its own fetchImpl.
// Each mock checks the limits that matter here (CacheService 100 KB / 6 h, PropertiesService 9 KB, setValues shape),
// and SpreadsheetApp.getUi() throws in a trigger context, as it does on Google's servers.
'use strict';
const { execFileSync } = require('node:child_process');

const colLetter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const a1 = (row, col, nr, nc) => (nr === 1 && nc === 1 ? `${colLetter(col)}${row}` : `${colLetter(col)}${row}:${colLetter(col + nc - 1)}${row + nr - 1}`);
const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]';

// ---------- Utilities.formatDate (subset of Java SimpleDateFormat, time-zone aware) ----------
function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', weekday: 'short',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, M: +p.month, d: +p.day, H: +p.hour, m: +p.minute, s: +p.second, E: p.weekday };
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(date, timeZone, pattern) {
  if (!isDate(date) || isNaN(date.getTime())) throw new Error('Utilities.formatDate: invalid date');
  const p = zonedParts(date, timeZone);
  const pad = (n, w) => String(n).padStart(w, '0');
  return pattern.replace(/'([^']*)'|y+|M+|d+|H+|m+|s+|E+|[a-zA-Z]+/g, (tok, literal) => {
    if (literal !== undefined) return literal;
    switch (tok[0]) {
      case 'y': return tok.length === 2 ? pad(p.y % 100, 2) : String(p.y);
      case 'M': return tok.length >= 3 ? MONTHS[p.M - 1] : pad(p.M, tok.length);
      case 'd': return pad(p.d, tok.length);
      case 'H': return pad(p.H, tok.length);
      case 'm': return pad(p.m, tok.length);
      case 's': return pad(p.s, tok.length);
      case 'E': return p.E;
      default: throw new Error(`Utilities.formatDate mock: unsupported pattern "${tok}"`);
    }
  });
}
/** Midnight of a calendar day in a time zone, as a Date (what a date cell holds in Sheets). */
function zonedMidnight(y, m, d, timeZone) {
  let guess = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(p.y, p.M - 1, p.d, p.H, p.m, p.s);
    guess += Date.UTC(y, m - 1, d) - asUtc;
  }
  return new Date(guess);
}

/**
 * Milliseconds to add to the real clock so that it shows the same time of day on asOfDay, in a time zone.
 * Used by the harness and tests so that "today" (and with it the report week and the future-date check) does not
 * depend on the day they are re-run. 0 when asOfDay is today.
 */
function dayShiftMs(asOfDay, timeZone, nowMs = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDay)) throw new Error(`asOfDay must be yyyy-MM-dd, got "${asOfDay}"`);
  const p = zonedParts(new Date(nowMs), timeZone);
  const [y, m, d] = asOfDay.split('-').map(Number);
  let shift = zonedMidnight(y, m, d, timeZone).getTime() - zonedMidnight(p.y, p.M, p.d, timeZone).getTime();
  // Near midnight on a daylight-saving change day the shifted time can land on the next or previous day: step back in.
  for (let i = 0; i < 2 && formatDate(new Date(nowMs + shift), timeZone, 'yyyy-MM-dd') !== asOfDay; i++) {
    shift += formatDate(new Date(nowMs + shift), timeZone, 'yyyy-MM-dd') > asOfDay ? -3600000 : 3600000;
  }
  return shift;
}

// ---------- SpreadsheetApp ----------
class MockRange {
  constructor(sheet, row, col, nr = 1, nc = 1) {
    if (!(row >= 1 && col >= 1 && nr >= 1 && nc >= 1)) throw new Error(`Range out of bounds: ${row},${col},${nr},${nc}`);
    Object.assign(this, { sheet, row, col, nr, nc });
  }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
  getA1Notation() { return a1(this.row, this.col, this.nr, this.nc); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const src = this.sheet.cells[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.nc; c++) { const v = src[this.col - 1 + c]; line.push(v === undefined || v === null ? '' : v); }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (!Array.isArray(values) || values.length !== this.nr) throw new Error(`The number of rows in the data does not match the number of rows in the range. The data has ${values && values.length} but the range has ${this.nr}.`);
    values.forEach((line, r) => {
      if (!Array.isArray(line) || line.length !== this.nc) throw new Error(`The number of columns in the data does not match the number of columns in the range. The data has ${line && line.length} but the range has ${this.nc}.`);
      line.forEach((v, c) => {
        if (v !== null && typeof v === 'object' && !isDate(v)) throw new Error('Cannot convert object to a cell value');
        this.sheet.setCell(this.row + r, this.col + c, v);
      });
    });
    return this;
  }
  setValue(v) { return this.setValues(Array.from({ length: this.nr }, () => Array(this.nc).fill(v))); }
  fmt(kind, value) { this.sheet.formats.push({ range: this.getA1Notation(), kind, value }); return this; }
  setFontWeight(v) { return this.fmt('fontWeight', v); }
  setFontSize(v) { return this.fmt('fontSize', v); }
  setFontColor(v) { return this.fmt('fontColor', v); }
  setBackground(v) { return this.fmt('background', v); }
  setNumberFormat(v) { return this.fmt('numberFormat', v); }
}

class MockSheet {
  constructor(name) { this.name = name; this.cells = []; this.formats = []; this.charts = []; this.frozenRows = 0; this.columnWidths = {}; }
  getName() { return this.name; }
  setCell(row, col, v) {
    while (this.cells.length < row) this.cells.push([]);
    const line = this.cells[row - 1];
    while (line.length < col) line.push('');
    line[col - 1] = v === null || v === undefined ? '' : v;
  }
  getLastRow() {
    for (let r = this.cells.length; r >= 1; r--) if (this.cells[r - 1].some((v) => v !== '')) return r;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.cells.forEach((line) => { for (let c = line.length; c > max; c--) if (line[c - 1] !== '') { max = c; break; } });
    return max;
  }
  getDataRange() { return new MockRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  getRange(row, col, nr, nc) {
    if (typeof row !== 'number') throw new Error('Mock getRange supports (row, column, numRows, numColumns) only');
    return new MockRange(this, row, col, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc);
  }
  appendRow(values) {
    const row = this.getLastRow() + 1;
    values.forEach((v, c) => this.setCell(row, c + 1, v));
    return this;
  }
  clear() { this.cells = []; this.formats = []; return this; }
  clearContents() { this.cells = []; return this; }
  setFrozenRows(n) { this.frozenRows = n; }
  getFrozenRows() { return this.frozenRows; }
  setColumnWidth(col, width) { this.columnWidths[col] = width; return this; }
  autoResizeColumns(start, count) { this.autoResized = [start, count]; return this; }
  getCharts() { return this.charts.slice(); }
  removeChart(chart) { this.charts = this.charts.filter((c) => c !== chart); }
  insertChart(chart) { this.charts.push(chart); }
  newChart() {
    const spec = { type: null, ranges: [], position: null, options: {} };
    const builder = {
      setChartType(t) { if (!t) throw new Error('Unknown chart type'); spec.type = t; return builder; },
      addRange(r) { if (!(r instanceof MockRange)) throw new Error('addRange needs a Range'); spec.ranges.push(r.getA1Notation()); return builder; },
      setPosition(row, col, ox, oy) { spec.position = { row, col, offsetX: ox, offsetY: oy }; return builder; },
      setOption(k, v) { spec.options[k] = v; return builder; },
      build() { if (!spec.type || !spec.ranges.length || !spec.position) throw new Error('Chart needs a type, a range and a position'); return { spec }; },
    };
    return builder;
  }
}

class MockSpreadsheet {
  constructor(name, timeZone, url) { this.name = name; this.timeZone = timeZone; this.url = url; this.sheets = []; this.toasts = []; }
  getName() { return this.name; }
  getUrl() { return this.url; }
  getSpreadsheetTimeZone() { return this.timeZone; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
  insertSheet(name) {
    if (this.getSheetByName(name)) throw new Error(`A sheet with the name "${name}" already exists.`);
    const s = new MockSheet(name);
    this.sheets.push(s);
    return s;
  }
  toast(msg, title, seconds) { this.toasts.push({ msg, title, seconds }); }
}

// ---------- Real synchronous HTTP for UrlFetchApp ----------
const FETCH_CHILD = `
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
fetch(input.url, { method: input.method, headers: input.headers, redirect: 'follow', signal: AbortSignal.timeout(30000) })
  .then(async (r) => process.stdout.write(JSON.stringify({ code: r.status, body: await r.text(), headers: Object.fromEntries(r.headers) })))
  .catch((e) => process.stdout.write(JSON.stringify({ error: String((e && e.cause && e.cause.code) || (e && e.message) || e) })));
`;
function realFetchSync(url, params) {
  const out = execFileSync(process.execPath, ['-e', FETCH_CHILD], {
    input: JSON.stringify({ url, method: (params.method || 'GET').toUpperCase(), headers: params.headers || {} }),
    maxBuffer: 50 * 1024 * 1024, timeout: 45000,
  });
  return JSON.parse(out.toString('utf8'));
}

// ---------- Environment ----------
function createGasEnv(options = {}) {
  const env = {
    timeZone: options.timeZone || 'America/New_York',
    context: options.context || 'menu', // 'menu' or 'trigger'
    emails: [], alerts: [], menus: [], fetches: [], sleeps: [], logs: [], triggers: [],
    cache: new Map(), props: new Map(), lockHeld: false,
  };
  env.ss = new MockSpreadsheet(options.spreadsheetName || 'Sales 2026', env.timeZone, options.url || 'https://docs.google.com/spreadsheets/d/LOCAL-TEST/edit');
  // options.asOfDay ('yyyy-MM-dd'): the script's clock shows that day in the sheet time zone, at the real time of day
  // (load-gas.js installs it). Without it the script sees the real date.
  if (options.asOfDay) env.clock = { asOfDay: options.asOfDay, shiftMs: dayShiftMs(options.asOfDay, env.timeZone) };
  const fetchImpl = options.fetchImpl || realFetchSync;

  const ui = {
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO' },
    Button: { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO' },
    createMenu(caption) {
      const menu = { caption, items: [] };
      const b = {
        addItem(label, fn) { if (typeof fn !== 'string') throw new Error('addItem needs a function name'); menu.items.push({ label, fn }); return b; },
        addSeparator() { menu.items.push({ separator: true }); return b; },
        addToUi() { env.menus.push(menu); },
      };
      return b;
    },
    alert(...args) {
      const [title, prompt] = args.length >= 3 ? [args[0], args[1]] : [null, args[0]];
      env.alerts.push({ title, prompt });
      return 'OK';
    },
  };

  const SpreadsheetApp = {
    getActiveSpreadsheet: () => env.ss,
    getUi: () => {
      if (env.context === 'trigger') throw new Error('Cannot call SpreadsheetApp.getUi() from this context.');
      return ui;
    },
    flush: () => {},
  };

  const MailApp = {
    sendEmail(...args) {
      const msg = args.length === 1 ? { ...args[0] } : { to: args[0], subject: args[1], body: args[2], ...(args[3] || {}) };
      if (!msg.to || !msg.subject) throw new Error('Invalid argument: recipient and subject are required');
      if (options.mailFails) throw new Error('Service invoked too many times for one day: email.');
      env.emails.push(msg);
    },
    getRemainingDailyQuota: () => 100 - env.emails.length,
  };

  const Utilities = {
    formatDate,
    sleep(ms) { env.sleeps.push(ms); },
  };

  const scriptCache = {
    get(key) {
      const hit = env.cache.get(key);
      if (!hit || hit.expires <= Date.now()) return null;
      return hit.value;
    },
    put(key, value, seconds = 600) {
      if (typeof value !== 'string') throw new Error('Cache values must be strings');
      if (Buffer.byteLength(value) > 100 * 1024) throw new Error('Argument too large: value');
      if (seconds > 21600) throw new Error('Cache expiration above 21600 seconds');
      env.cache.set(key, { value, expires: Date.now() + seconds * 1000, seconds });
    },
    remove(key) { env.cache.delete(key); },
  };
  const CacheService = { getScriptCache: () => scriptCache };

  const scriptProps = {
    getProperty: (k) => (env.props.has(k) ? env.props.get(k) : null),
    setProperty(k, v) {
      if (Buffer.byteLength(String(v)) > 9 * 1024) throw new Error('Argument too large: value');
      env.props.set(k, String(v));
      return scriptProps;
    },
    deleteProperty(k) { env.props.delete(k); return scriptProps; },
    getProperties: () => Object.fromEntries(env.props),
  };
  const PropertiesService = { getScriptProperties: () => scriptProps };

  const LockService = {
    getScriptLock: () => ({
      tryLock() { if (env.lockHeld) return false; env.lockHeld = true; return true; },
      releaseLock() { env.lockHeld = false; },
      hasLock() { return env.lockHeld; },
    }),
  };

  const WeekDay = { MONDAY: 'MONDAY', TUESDAY: 'TUESDAY', WEDNESDAY: 'WEDNESDAY', THURSDAY: 'THURSDAY', FRIDAY: 'FRIDAY', SATURDAY: 'SATURDAY', SUNDAY: 'SUNDAY' };
  let triggerId = 0;
  const ScriptApp = {
    WeekDay,
    EventType: { CLOCK: 'CLOCK' },
    newTrigger(handler) {
      const spec = { handler };
      const clock = {
        onWeekDay(d) { if (!WeekDay[d]) throw new Error('Invalid week day'); spec.weekDay = d; return clock; },
        atHour(h) { if (!(h >= 0 && h <= 23)) throw new Error('Hour must be 0-23'); spec.hour = h; return clock; },
        inTimezone(tz) { formatDate(new Date(), tz, 'yyyy'); spec.timeZone = tz; return clock; },
        create() {
          if (!spec.weekDay || spec.hour === undefined) throw new Error('A weekly trigger needs a week day and an hour');
          const id = String(++triggerId);
          const t = { spec, getHandlerFunction: () => handler, getUniqueId: () => id, getEventType: () => 'CLOCK' };
          env.triggers.push(t);
          return t;
        },
      };
      return { timeBased: () => clock };
    },
    getProjectTriggers: () => env.triggers.slice(),
    deleteTrigger(t) { env.triggers = env.triggers.filter((x) => x !== t); },
  };

  const UrlFetchApp = {
    fetch(url, params = {}) {
      const t0 = Date.now();
      const res = fetchImpl(url, params);
      env.fetches.push({ url, ms: Date.now() - t0, code: res.code, error: res.error });
      if (res.error) throw new Error(`Exception: ${res.error}: ${url}`);
      if (!params.muteHttpExceptions && res.code >= 400) throw new Error(`Exception: Request failed for ${url} returned code ${res.code}.`);
      return {
        getResponseCode: () => res.code,
        getContentText: () => res.body,
        getHeaders: () => res.headers || {},
      };
    },
  };

  const Charts = { ChartType: { COLUMN: 'COLUMN', BAR: 'BAR', LINE: 'LINE', PIE: 'PIE', AREA: 'AREA' } };
  const Logger = { log: (...a) => env.logs.push(a.join(' ')) };
  const quietConsole = { log: (...a) => env.logs.push(a.join(' ')), error: (...a) => env.logs.push('ERROR ' + a.join(' ')), warn: (...a) => env.logs.push('WARN ' + a.join(' ')) };

  env.globals = { SpreadsheetApp, MailApp, Utilities, CacheService, PropertiesService, LockService, ScriptApp, UrlFetchApp, Charts, Logger, console: quietConsole };
  return env;
}

// ---------- Helpers for loading a CSV like a Sheets import and exporting sheets ----------
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * Like File > Import of a CSV into Google Sheets.
 * convert: false  = "Convert text to numbers, dates, and formulas" unticked (what INSTALL.md says): every cell stays text.
 * convert: true   = ticked: plain numbers become numbers, YYYY-MM-DD becomes a date cell, and n/n/yyyy text becomes a
 *                   date cell read in the sheet locale's order (en_US: month first, en_GB: day first). Text that is not
 *                   a real date in that order stays text. A US sheet therefore turns 05/09/2026 into 9 May, silently.
 */
function sheetValuesFromCsv(text, timeZone, { convert = false, locale = 'en_US' } = {}) {
  if (!['en_US', 'en_GB'].includes(locale)) throw new Error(`sheetValuesFromCsv: unsupported locale ${locale}`);
  const rows = parseCsv(text);
  const dateCell = (y, mo, d) => {
    const t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? zonedMidnight(y, mo, d, timeZone) : null;
  };
  return rows.map((r, i) => (i === 0 || !convert ? r : r.map((v) => {
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return dateCell(+m[1], +m[2], +m[3]) || v;
    m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return (locale === 'en_US' ? dateCell(+m[3], +m[1], +m[2]) : dateCell(+m[3], +m[2], +m[1])) || v;
    return v;
  })));
}

function cellText(v, timeZone) {
  if (isDate(v)) {
    const full = formatDate(v, timeZone, 'yyyy-MM-dd HH:mm:ss');
    return full.endsWith(' 00:00:00') ? full.slice(0, 10) : full;
  }
  return v === null || v === undefined ? '' : String(v);
}

function sheetToCsv(sheet, timeZone) {
  const esc = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const width = sheet.getLastColumn();
  return sheet.cells.slice(0, sheet.getLastRow()).map((line) => {
    const out = [];
    for (let c = 0; c < width; c++) out.push(esc(cellText(line[c], timeZone)));
    return out.join(',');
  }).join('\n') + '\n';
}

module.exports = { createGasEnv, sheetValuesFromCsv, sheetToCsv, parseCsv, cellText, formatDate, zonedMidnight, dayShiftMs, realFetchSync, MockRange };
