// Loads every .gs file of the Apps Script project into one shared global scope (as Apps Script does),
// with the mocked services as globals. Top-level functions and vars become properties of the returned context.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_DIR = path.join(__dirname, '..', 'apps-script');

function loadProject(env) {
  const ctx = vm.createContext({ ...env.globals });
  // With env.clock (createGasEnv's asOfDay), new Date() and Date.now() in the script read the shifted clock.
  // new Date(value) and the other Date functions are unchanged, so durations stay real.
  if (env.clock) {
    vm.runInContext(`(function (shift) {
      var RealDate = Date;
      class ShiftedDate extends RealDate {
        constructor(...args) { if (args.length === 0) super(RealDate.now() + shift); else super(...args); }
        static now() { return RealDate.now() + shift; }
      }
      globalThis.Date = ShiftedDate;
    })`, ctx, { filename: 'harness/clock' })(env.clock.shiftMs);
  }
  const files = fs.readdirSync(PROJECT_DIR).filter((f) => f.endsWith('.gs')).sort();
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(PROJECT_DIR, f), 'utf8'), ctx, { filename: `apps-script/${f}` });
  return ctx;
}

/** Puts 2D values into a sheet of the mock spreadsheet (creating it). */
function fillSheet(env, name, values) {
  const sheet = env.ss.getSheetByName(name) || env.ss.insertSheet(name);
  const width = Math.max(...values.map((r) => r.length));
  const padded = values.map((r) => r.concat(Array(width - r.length).fill('')));
  sheet.getRange(1, 1, padded.length, width).setValues(padded);
  return sheet;
}

module.exports = { loadProject, fillSheet, PROJECT_DIR };
