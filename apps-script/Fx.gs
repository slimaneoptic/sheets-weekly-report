/**
 * Live exchange rates to USD from Frankfurter (free, no key): https://frankfurter.dev
 * The v2 endpoint covers about 160 currencies, including MAD (the older api.frankfurter.app endpoint has no MAD).
 * Rates are cached for 6 hours. If the API is down, the last good rates (up to 7 days old) are used and the
 * email says so. With no usable rates the run stops before anything in the spreadsheet is changed.
 */
var FX_URL = 'https://api.frankfurter.dev/v2/rates?base=USD';
var FX_CACHE_KEY = 'fx_usd_rates_v2';
var FX_CACHE_SECONDS = 6 * 60 * 60; // CacheService maximum
var FX_SAVED_KEY = 'fx_last_good_rates';
var FX_SAVED_MAX_DAYS = 7;
var FX_TRIES = 3;

/** Returns { rates: { EUR: 0.88, ... } (units per 1 USD), date, fetchedAt, source: 'live' | 'cache' | 'saved', warning? } */
function getUsdRates_(nowMs) {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(FX_CACHE_KEY);
  if (cached) {
    var fromCache = JSON.parse(cached);
    fromCache.source = 'cache';
    return fromCache;
  }

  var lastError = '';
  for (var attempt = 1; attempt <= FX_TRIES; attempt++) {
    try {
      var response = UrlFetchApp.fetch(FX_URL, { muteHttpExceptions: true, headers: { Accept: 'application/json' } });
      var code = response.getResponseCode();
      if (code === 200) {
        var parsed = parseFxResponse_(response.getContentText());
        var payload = { rates: parsed.rates, date: parsed.date, fetchedAt: new Date(nowMs).toISOString() };
        var json = JSON.stringify(payload);
        cache.put(FX_CACHE_KEY, json, FX_CACHE_SECONDS);
        PropertiesService.getScriptProperties().setProperty(FX_SAVED_KEY, json);
        payload.source = 'live';
        return payload;
      }
      lastError = 'HTTP ' + code;
      if (code !== 429 && code < 500) break; // a client error will not fix itself
    } catch (err) {
      lastError = err && err.message ? err.message : String(err);
    }
    if (attempt < FX_TRIES) Utilities.sleep(1500 * attempt);
  }

  var saved = PropertiesService.getScriptProperties().getProperty(FX_SAVED_KEY);
  if (saved) {
    var old = JSON.parse(saved);
    var ageDays = (nowMs - Date.parse(old.fetchedAt)) / 86400000;
    if (ageDays <= FX_SAVED_MAX_DAYS) {
      old.source = 'saved';
      old.warning = 'Live exchange rates were unavailable (' + lastError + '), so rates saved on ' + old.date + ' were used.';
      return old;
    }
  }
  throw new Error('Exchange rates are unavailable (' + lastError + ') and there are no saved rates from the last ' +
    FX_SAVED_MAX_DAYS + ' days. Nothing in the spreadsheet was changed.');
}

/** Accepts the v2 list format [{date, base, quote, rate}] and the v1 format {base, date, rates: {...}}. */
function parseFxResponse_(text) {
  var data = JSON.parse(text);
  var rates = { USD: 1 };
  var date = '';
  var keep = function (quote, rate, day) {
    if (typeof quote === 'string' && /^[A-Z]{3}$/.test(quote) && typeof rate === 'number' && isFinite(rate) && rate > 0) {
      rates[quote] = rate;
      if (day && day > date) date = day;
    }
  };
  if (Array.isArray(data)) {
    data.forEach(function (r) { if (r && r.base === 'USD') keep(r.quote, r.rate, r.date); });
  } else if (data && data.base === 'USD' && data.rates) {
    Object.keys(data.rates).forEach(function (q) { keep(q, data.rates[q], data.date); });
  }
  if (Object.keys(rates).length < 2 || !date) throw new Error('Unexpected answer from the exchange-rate API.');
  return { rates: rates, date: date };
}

/** Adds amountUsd to every row. Rows in a currency with no rate move to the issues list. */
function applyFx_(rows, rates, timeZone) {
  var converted = [];
  var issues = [];
  rows.forEach(function (r) {
    var rate = rates[r.currency];
    if (!rate) {
      issues.push(makeIssue_(r.row, r.id, [{ code: 'unknown_currency', text: ISSUE_LABELS.unknown_currency + ': "' + r.currency + '"' }],
        r.raw, r.cols, timeZone));
      return;
    }
    r.rate = rate;
    r.amountUsd = round2_(r.amount / rate);
    converted.push(r);
  });
  return { rows: converted, issues: issues };
}

