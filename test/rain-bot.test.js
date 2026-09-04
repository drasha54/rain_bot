const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function partsInTokyo(date) {
  const values = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).forEach((part) => { values[part.type] = part.value; });
  return values;
}

const properties = new Map();
const context = {
  console,
  Date,
  JSON,
  Math,
  Number,
  Object,
  Array,
  String,
  Error,
  encodeURIComponent,
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty: (key) => properties.get(key) || null,
        setProperty: (key, value) => properties.set(key, value),
        deleteProperty: (key) => properties.delete(key)
      };
    }
  },
  Utilities: {
    parseDate(value, timezone, format) {
      assert.equal(timezone, 'Asia/Tokyo');
      if (format === 'yyyyMMddHHmm') {
        return new Date(
          `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` +
          `T${value.slice(8, 10)}:${value.slice(10, 12)}:00+09:00`
        );
      }
      return new Date(`${value}:00+09:00`);
    },
    formatDate(date, timezone, format) {
      assert.equal(timezone, 'Asia/Tokyo');
      const p = partsInTokyo(date);
      if (format === 'yyyy-MM-dd') return `${p.year}-${p.month}-${p.day}`;
      if (format === "yyyy-MM-dd'T'HH:mm") {
        return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
      }
      if (format === 'H') return String(Number(p.hour));
      if (format === 'HH:mm') return `${p.hour}:${p.minute}`;
      throw new Error(`Unsupported test format: ${format}`);
    }
  }
};

vm.createContext(context);
const root = path.resolve(__dirname, '..');
const source = [
  'Config.gs', 'Weather.gs', 'Nowcast.gs', 'Slack.gs', 'State.gs', 'Main.gs'
].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
vm.runInContext(source + `
  this.bot = {
    fetchHourlyForecast_, fetchNowcastRainEvent_,
    toRainEvents_, addMaximumPrecipitation_,
    findActionableForecastChanges_, formatEventRanges_,
    buildMorningMessage_, buildForecastChangeMessage_, formatMinutesUntil_,
    isNowcastEventKnown_, createEmptyState_, addNotifiedEvents_
  };
`, context);

const bot = context.bot;
const plain = (value) => JSON.parse(JSON.stringify(value));
const key = (hour) => `2026-09-04T${String(hour).padStart(2, '0')}:00`;

function forecast(values) {
  const result = {};
  Object.entries(values).forEach(([hour, rain]) => { result[key(Number(hour))] = rain; });
  return result;
}

test('groups consecutive rainy hours and uses the following hour as the end', () => {
  const events = bot.toRainEvents_(forecast({8: 0, 9: 0.2, 10: 0.8, 11: 0, 17: 0.1}));
  assert.deepEqual(plain(events), [
    {start: key(9), end: key(11)},
    {start: key(17), end: key(18)}
  ]);
  assert.equal(bot.formatEventRanges_(events), '09:00〜11:00頃、17:00〜18:00頃');
});

test('detects a newly introduced rain event', () => {
  const previous = forecast({17: 0, 18: 0, 19: 0});
  const current = forecast({17: 0, 18: 0.4, 19: 0.8});
  assert.deepEqual(plain(bot.findActionableForecastChanges_(previous, current, [])), [
    {type: 'new', event: {start: key(18), end: key(20)}}
  ]);
});

test('does not notify for intensity changes, rain removal, or end extension', () => {
  assert.deepEqual(plain(bot.findActionableForecastChanges_(
    forecast({17: 0.3, 18: 0}), forecast({17: 2.0, 18: 0}), []
  )), []);
  assert.deepEqual(plain(bot.findActionableForecastChanges_(
    forecast({17: 1.0}), forecast({17: 0}), []
  )), []);
  assert.deepEqual(plain(bot.findActionableForecastChanges_(
    forecast({17: 0.5, 18: 0.5, 19: 0}),
    forecast({17: 0.5, 18: 0.5, 19: 0.5}),
    []
  )), []);

  // At 19:00, the current response no longer contains the already-rainy
  // 18:00 bucket. The new 19:00 bucket is still only an end extension.
  assert.deepEqual(plain(bot.findActionableForecastChanges_(
    forecast({18: 0.5, 19: 0}),
    forecast({19: 0.5}),
    []
  )), []);
});

test('detects an earlier start but suppresses one already notified', () => {
  const previous = forecast({17: 0, 18: 0.5, 19: 0.5});
  const current = forecast({17: 0.2, 18: 0.5, 19: 0.5});
  const changes = bot.findActionableForecastChanges_(previous, current, []);
  assert.deepEqual(plain(changes), [{
    type: 'earlier',
    event: {start: key(17), end: key(20)},
    newPart: {start: key(17), end: key(18)}
  }]);
  assert.match(bot.buildForecastChangeMessage_(changes), /17:00頃から/);

  const notified = [{start: key(17), end: key(20)}];
  assert.deepEqual(plain(bot.findActionableForecastChanges_(previous, current, notified)), []);
});

test('does not treat a restored, previously notified event as new', () => {
  const previous = forecast({18: 0, 19: 0});
  const current = forecast({18: 0.4, 19: 0.3});
  const notified = [{start: key(18), end: key(20)}];
  assert.deepEqual(plain(bot.findActionableForecastChanges_(previous, current, notified)), []);
});

test('suppresses a nowcast close to an hourly event and keeps a distant event', () => {
  const state = bot.createEmptyState_('2026-09-04');
  state.morningEvents = [{start: key(18), end: key(20)}];
  assert.equal(bot.isNowcastEventKnown_({
    start: '2026-09-04T17:30', end: '2026-09-04T18:10'
  }, state), true);
  assert.equal(bot.isNowcastEventKnown_({
    start: '2026-09-04T15:30', end: '2026-09-04T15:40'
  }, state), false);
});

test('formats user-facing morning and nowcast wording', () => {
  const message = bot.buildMorningMessage_([
    {start: key(8), end: key(11), maxPrecipitation: 1.24},
    {start: key(12), end: key(22), maxPrecipitation: 3.8}
  ]);
  assert.match(message, /☔ 今日の雨予報/);
  assert.match(message, /・08:00〜11:00頃（最大 1\.2 mm\/h）/);
  assert.match(message, /・12:00〜22:00頃（最大 3\.8 mm\/h）/);
  assert.doesNotMatch(message, /傘を持っていく/);
  assert.equal(bot.formatMinutesUntil_(28), '約30分後');
  assert.equal(bot.formatMinutesUntil_(4), 'まもなく');
});

test('calculates maximum precipitation separately for each morning event', () => {
  const values = forecast({
    8: 0.2, 9: 1.4, 10: 0.6, 11: 0,
    12: 0.1, 13: 2.7, 14: 0.4
  });
  const events = bot.addMaximumPrecipitation_(bot.toRainEvents_(values), values);
  assert.deepEqual(plain(events), [
    {start: key(8), end: key(11), maxPrecipitation: 1.4},
    {start: key(12), end: key(15), maxPrecipitation: 2.7}
  ]);
});

test('parses and filters an Open-Meteo hourly response', () => {
  context.UrlFetchApp = {
    fetch(url) {
      assert.match(url, /latitude=35\.0262/);
      assert.match(url, /timezone=Asia%2FTokyo/);
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          hourly: {
            time: [
              '2026-09-04T14:00', '2026-09-04T15:00',
              '2026-09-04T21:00', '2026-09-04T22:00'
            ],
            precipitation: [0.8, 0, 0.2, 1.0]
          }
        })
      };
    }
  };
  const result = bot.fetchHourlyForecast_(
    new Date('2026-09-04T15:10:00+09:00'), 15
  );
  assert.deepEqual(plain(result), {
    [key(15)]: 0,
    [key(21)]: 0.2
  });
});

test('parses Yahoo! forecast timestamps and finds the first rain', () => {
  properties.set('YAHOO_APP_ID', 'test-client-id');
  context.UrlFetchApp = {
    fetch(url) {
      assert.match(url, /coordinates=135\.7808%2C35\.0262/);
      assert.match(url, /appid=test-client-id/);
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          Feature: [{
            Property: {
              WeatherList: {
                Weather: [
                  {Type: 'observation', Date: '202609041600', Rainfall: '0.00'},
                  {Type: 'forecast', Date: '202609041610', Rainfall: '0.00'},
                  {Type: 'forecast', Date: '202609041620', Rainfall: '0.00'},
                  {Type: 'forecast', Date: '202609041630', Rainfall: '0.20'},
                  {Type: 'forecast', Date: '202609041640', Rainfall: '0.80'},
                  {Type: 'forecast', Date: '202609041650', Rainfall: '0.00'}
                ]
              }
            }
          }]
        })
      };
    }
  };
  const event = bot.fetchNowcastRainEvent_(new Date('2026-09-04T16:02:00+09:00'));
  assert.deepEqual(plain(event), {
    start: '2026-09-04T16:30',
    end: '2026-09-04T16:50',
    minutesUntil: 28
  });
});
