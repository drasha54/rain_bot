function loadDailyState_(now) {
  var dateKey = formatDateKey_(now);
  var raw = PropertiesService.getScriptProperties().getProperty(CONFIG.STATE_PROPERTY_KEY);
  if (!raw) {
    return createEmptyState_(dateKey);
  }

  try {
    var state = JSON.parse(raw);
    if (state.date !== dateKey) {
      return createEmptyState_(dateKey);
    }
    state.previousForecast = state.previousForecast || {};
    state.morningEvents = state.morningEvents || [];
    state.afternoonEvents = state.afternoonEvents || [];
    state.nowcastEvents = state.nowcastEvents || [];
    state.processedSlots = state.processedSlots || {};
    return state;
  } catch (error) {
    logError_('PropertiesService', null, 'Invalid state was reset: ' + error.message);
    return createEmptyState_(dateKey);
  }
}

function createEmptyState_(dateKey) {
  return {
    date: dateKey,
    previousForecast: {},
    morningEvents: [],
    afternoonEvents: [],
    nowcastEvents: [],
    processedSlots: {}
  };
}

function saveDailyState_(state) {
  PropertiesService.getScriptProperties().setProperty(
    CONFIG.STATE_PROPERTY_KEY,
    JSON.stringify(state)
  );
}

function getAllNotifiedEvents_(state) {
  return []
    .concat(state.morningEvents || [])
    .concat(state.afternoonEvents || [])
    .concat(state.nowcastEvents || []);
}

function addNotifiedEvents_(target, events, now) {
  events.forEach(function (event) {
    target.push({
      start: event.start,
      end: event.end,
      notifiedAt: formatDateTimeKey_(now)
    });
  });
  return mergeStoredEvents_(target);
}

function mergeStoredEvents_(events) {
  var sorted = (events || []).slice().sort(function (a, b) {
    return a.start.localeCompare(b.start);
  });
  var merged = [];
  sorted.forEach(function (event) {
    var last = merged.length ? merged[merged.length - 1] : null;
    if (last && event.start <= last.end) {
      if (event.end > last.end) {
        last.end = event.end;
      }
      last.notifiedAt = event.notifiedAt || last.notifiedAt;
    } else {
      merged.push({start: event.start, end: event.end, notifiedAt: event.notifiedAt});
    }
  });
  return merged;
}

function isNowcastEventKnown_(event, state) {
  var toleranceMillis = CONFIG.NOTIFIED_EVENT_MATCH_MINUTES * 60 * 1000;
  var startMillis = keyToMillis_(event.start);
  var endMillis = keyToMillis_(event.end);
  return getAllNotifiedEvents_(state).some(function (notified) {
    var notifiedStart = keyToMillis_(notified.start);
    var notifiedEnd = keyToMillis_(notified.end);
    if (startMillis < notifiedEnd && notifiedStart < endMillis) {
      return true;
    }
    var gap = startMillis >= notifiedEnd ?
      startMillis - notifiedEnd : notifiedStart - endMillis;
    return gap >= 0 && gap <= toleranceMillis;
  });
}

function keyToMillis_(key) {
  return Utilities.parseDate(key, CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm").getTime();
}

function formatDateKey_(date) {
  return Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function getRequiredScriptProperty_(name) {
  var value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) {
    throw makeApiError_('Configuration', null,
      'Script Property "' + name + '" is not set');
  }
  return value;
}

function clearRainBotState() {
  PropertiesService.getScriptProperties().deleteProperty(CONFIG.STATE_PROPERTY_KEY);
  console.log('Rain bot state was cleared.');
}

function showRainBotState() {
  var state = loadDailyState_(new Date());
  console.log(JSON.stringify(state, null, 2));
  return state;
}
