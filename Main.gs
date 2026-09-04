/** Entry point for the daily morning trigger. */
function runMorningCheck() {
  runWithLock_(function () {
    var now = new Date();
    var state = loadDailyState_(now);
    var forecast;
    try {
      forecast = fetchHourlyForecast_(now, CONFIG.MORNING_START_HOUR);
    } catch (error) {
      logCaughtError_(error);
      return;
    }

    var allNotified = getAllNotifiedEvents_(state);
    var rainEvents = addMaximumPrecipitation_(toRainEvents_(forecast), forecast);
    var newEvents = rainEvents.filter(function (event) {
      return !isEventAlreadyNotified_(event, allNotified);
    });

    if (newEvents.length > 0) {
      try {
        sendSlackMessage_(buildMorningMessage_(newEvents));
        state.morningEvents = addNotifiedEvents_(state.morningEvents, newEvents, now);
      } catch (error) {
        logCaughtError_(error);
      }
    }

    state.previousForecast = forecast;
    state.morningCheckedAt = formatDateTimeKey_(now);
    saveDailyState_(state);
  });
}

/**
 * Manual afternoon entry point. It calls APIs only from 15:00 through 19:00
 * local time. Scheduled triggers use the slot-specific wrappers below.
 */
function runAfternoonCheck() {
  var now = new Date();
  if (!isWithinAfternoonWindow_(now)) {
    console.log('Afternoon check skipped outside ' +
      CONFIG.AFTERNOON_SCAN_START + '-' + CONFIG.AFTERNOON_SCAN_END + '.');
    return;
  }
  runAfternoonCheckForSlot_(null);
}

function runAfternoonCheckForSlot_(slot) {
  runWithLock_(function () {
    var now = new Date();
    var state = loadDailyState_(now);
    if (slot && state.processedSlots[slot]) {
      console.log('Afternoon slot ' + slot + ' was already processed.');
      return;
    }

    var forecastFetched = false;
    var forecastChangeDetected = false;
    var notificationSent = false;
    try {
      var currentHour = Number(Utilities.formatDate(now, CONFIG.TIMEZONE, 'H'));
      var scheduledHour = slot ? Number(slot.substring(0, 2)) : currentHour;
      var startHour = Math.max(currentHour, scheduledHour);
      var forecast = fetchHourlyForecast_(now, Math.max(startHour, CONFIG.MORNING_START_HOUR));
      forecastFetched = true;

      var changes = findActionableForecastChanges_(
        state.previousForecast,
        forecast,
        getAllNotifiedEvents_(state)
      );
      if (changes.length > 0) {
        forecastChangeDetected = true;
        sendSlackMessage_(buildForecastChangeMessage_(changes));
        state.afternoonEvents = addNotifiedEvents_(
          state.afternoonEvents,
          changes.map(function (change) { return change.event; }),
          now
        );
        notificationSent = true;
      }

      state.previousForecast = forecast;
      state.lastForecastCheckedAt = formatDateTimeKey_(now);
    } catch (error) {
      logCaughtError_(error);
    }

    if (CONFIG.NOWCAST_ENABLED && !forecastChangeDetected && !notificationSent) {
      try {
        var nowcastEvent = fetchNowcastRainEvent_(now);
        if (nowcastEvent && !isNowcastEventKnown_(nowcastEvent, state)) {
          sendSlackMessage_(buildNowcastMessage_(nowcastEvent));
          state.nowcastEvents = addNotifiedEvents_(state.nowcastEvents, [nowcastEvent], now);
          notificationSent = true;
        }
        state.lastNowcastCheckedAt = formatDateTimeKey_(now);
      } catch (error) {
        logCaughtError_(error);
      }
    }

    if (slot) {
      state.processedSlots[slot] = formatDateTimeKey_(now);
    }
    if (forecastFetched || notificationSent || slot) {
      saveDailyState_(state);
    }
  });
}

function isWithinAfternoonWindow_(date) {
  var time = Utilities.formatDate(date, CONFIG.TIMEZONE, 'HH:mm');
  return time >= CONFIG.AFTERNOON_SCAN_START && time <= CONFIG.AFTERNOON_SCAN_END;
}

function runWithLock_(callback) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) {
    logError_('LockService', null, 'Another rain-bot execution is still running');
    return;
  }
  try {
    callback();
  } catch (error) {
    logCaughtError_(error);
  } finally {
    lock.releaseLock();
  }
}

// Trigger-specific wrappers make the intended nine daily slots explicit.
function afternoon1500Trigger() { runAfternoonCheckForSlot_('15:00'); }
function afternoon1530Trigger() { runAfternoonCheckForSlot_('15:30'); }
function afternoon1600Trigger() { runAfternoonCheckForSlot_('16:00'); }
function afternoon1630Trigger() { runAfternoonCheckForSlot_('16:30'); }
function afternoon1700Trigger() { runAfternoonCheckForSlot_('17:00'); }
function afternoon1730Trigger() { runAfternoonCheckForSlot_('17:30'); }
function afternoon1800Trigger() { runAfternoonCheckForSlot_('18:00'); }
function afternoon1830Trigger() { runAfternoonCheckForSlot_('18:30'); }
function afternoon1900Trigger() { runAfternoonCheckForSlot_('19:00'); }

/** Deletes this bot's triggers and recreates the morning + nine afternoon jobs. */
function setupTriggers() {
  deleteRainBotTriggers();

  ScriptApp.newTrigger('runMorningCheck')
    .timeBased().atHour(7).nearMinute(0).everyDays(1)
    .inTimezone(CONFIG.TIMEZONE).create();

  var slots = [
    ['afternoon1500Trigger', 15, 0],
    ['afternoon1530Trigger', 15, 30],
    ['afternoon1600Trigger', 16, 0],
    ['afternoon1630Trigger', 16, 30],
    ['afternoon1700Trigger', 17, 0],
    ['afternoon1730Trigger', 17, 30],
    ['afternoon1800Trigger', 18, 0],
    ['afternoon1830Trigger', 18, 30],
    ['afternoon1900Trigger', 19, 0]
  ];
  slots.forEach(function (slot) {
    ScriptApp.newTrigger(slot[0])
      .timeBased().atHour(slot[1]).nearMinute(slot[2]).everyDays(1)
      .inTimezone(CONFIG.TIMEZONE).create();
  });
  console.log('Created 10 rain-bot triggers.');
}

function deleteRainBotTriggers() {
  var handlers = [
    'runMorningCheck',
    'afternoon1500Trigger', 'afternoon1530Trigger',
    'afternoon1600Trigger', 'afternoon1630Trigger',
    'afternoon1700Trigger', 'afternoon1730Trigger',
    'afternoon1800Trigger', 'afternoon1830Trigger',
    'afternoon1900Trigger'
  ];
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

/** Manual setup check: fetch both weather APIs without posting to Slack. */
function testWeatherApis() {
  var now = new Date();
  var currentHour = Number(Utilities.formatDate(now, CONFIG.TIMEZONE, 'H'));
  var forecast = fetchHourlyForecast_(now, Math.min(currentHour, CONFIG.FORECAST_END_HOUR));
  var nowcast = CONFIG.NOWCAST_ENABLED ?
    fetchNowcastRainEvent_(now) : {disabled: true};
  console.log(JSON.stringify({hourly: forecast, nowcastRainEvent: nowcast}, null, 2));
}

/** Manual setup check: posts one clearly marked test message to Slack. */
function testSlackNotification() {
  sendSlackMessage_('✅ 京都・吉田 雨予報Botのテスト通知です。');
}

function makeApiError_(apiName, status, message) {
  var error = new Error(message);
  error.apiName = apiName;
  error.httpStatus = status;
  return error;
}

function logCaughtError_(error) {
  logError_(
    error && error.apiName ? error.apiName : 'RainBot',
    error && error.httpStatus !== undefined ? error.httpStatus : null,
    error && error.stack ? error.stack : String(error)
  );
}

function logError_(apiName, status, message) {
  console.error(JSON.stringify({
    occurredAt: new Date().toISOString(),
    api: apiName,
    httpStatus: status,
    error: truncateForLog_(message)
  }));
}

function truncateForLog_(value) {
  var text = String(value === undefined || value === null ? '' : value);
  return text.length > 1000 ? text.substring(0, 1000) + '...' : text;
}
