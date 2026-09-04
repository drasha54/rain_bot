/**
 * Fetches today's hourly precipitation forecast from Open-Meteo.
 * The result is a map such as {"2026-09-04T16:00": 0.4}.
 */
function fetchHourlyForecast_(now, startHour) {
  var query = [
    'latitude=' + encodeURIComponent(CONFIG.TARGET_LAT),
    'longitude=' + encodeURIComponent(CONFIG.TARGET_LON),
    'hourly=precipitation',
    'timezone=' + encodeURIComponent(CONFIG.TIMEZONE),
    'forecast_days=1'
  ].join('&');

  var payload = fetchJson_('Open-Meteo', CONFIG.OPEN_METEO_ENDPOINT + '?' + query);
  if (!payload.hourly || !Array.isArray(payload.hourly.time) ||
      !Array.isArray(payload.hourly.precipitation) ||
      payload.hourly.time.length !== payload.hourly.precipitation.length) {
    throw makeApiError_('Open-Meteo', null, 'Unexpected hourly forecast response');
  }

  var dateKey = formatDateKey_(now);
  var forecast = {};
  payload.hourly.time.forEach(function (timeKey, index) {
    var normalizedKey = normalizeHourKey_(timeKey);
    if (normalizedKey.substring(0, 10) !== dateKey) {
      return;
    }

    var hour = Number(normalizedKey.substring(11, 13));
    if (hour < startHour || hour > CONFIG.FORECAST_END_HOUR) {
      return;
    }

    var precipitation = Number(payload.hourly.precipitation[index]);
    if (Number.isFinite(precipitation)) {
      forecast[normalizedKey] = precipitation;
    }
  });

  if (Object.keys(forecast).length === 0) {
    throw makeApiError_('Open-Meteo', null, 'No hourly forecast was returned for the requested period');
  }
  return forecast;
}

function fetchJson_(apiName, url) {
  var response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      headers: {Accept: 'application/json'}
    });
  } catch (error) {
    throw makeApiError_(apiName, null, error && error.message ? error.message : String(error));
  }

  var status = response.getResponseCode();
  var body = response.getContentText('UTF-8');
  if (status < 200 || status >= 300) {
    throw makeApiError_(apiName, status, truncateForLog_(body));
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw makeApiError_(apiName, status, 'Invalid JSON: ' + truncateForLog_(body));
  }
}

function isRain_(precipitation) {
  return Number(precipitation) >= CONFIG.RAIN_THRESHOLD;
}

/** Converts rainy hourly buckets into half-open intervals. */
function toRainEvents_(forecast) {
  var rainyKeys = Object.keys(forecast || {})
    .filter(function (key) { return isRain_(forecast[key]); })
    .sort();
  var events = [];

  rainyKeys.forEach(function (key) {
    var last = events.length ? events[events.length - 1] : null;
    if (last && last.end === key) {
      last.end = addMinutesToKey_(key, 60);
    } else {
      events.push({start: key, end: addMinutesToKey_(key, 60)});
    }
  });
  return events;
}

/** Adds the maximum hourly precipitation to each event for morning messages. */
function addMaximumPrecipitation_(events, forecast) {
  return (events || []).map(function (event) {
    var maximum = hourKeysInEvent_(event).reduce(function (currentMaximum, key) {
      var precipitation = Number(forecast[key]);
      return Number.isFinite(precipitation) ?
        Math.max(currentMaximum, precipitation) : currentMaximum;
    }, 0);
    return {
      start: event.start,
      end: event.end,
      maxPrecipitation: maximum
    };
  });
}

/**
 * Finds only actionable non-rain -> rain changes.
 * An extension at the end of an existing event is deliberately ignored.
 */
function findActionableForecastChanges_(previousForecast, currentForecast, notifiedEvents) {
  if (!previousForecast || Object.keys(previousForecast).length === 0) {
    return [];
  }

  var previousEvents = toRainEvents_(previousForecast);
  var currentEvents = toRainEvents_(currentForecast);
  var changes = [];

  currentEvents.forEach(function (currentEvent) {
    var transitionedKeys = hourKeysInEvent_(currentEvent).filter(function (key) {
      return Object.prototype.hasOwnProperty.call(previousForecast, key) &&
        !isRain_(previousForecast[key]) &&
        isRain_(currentForecast[key]);
    });
    if (transitionedKeys.length === 0) {
      return;
    }

    var overlappingPrevious = previousEvents.filter(function (previousEvent) {
      // When a later check drops past hourly buckets, a pure end extension can
      // look like a brand-new event. Treat an event ending exactly where the
      // current one starts as the same event so that extension stays silent.
      return eventsOverlap_(currentEvent, previousEvent) ||
        previousEvent.end === currentEvent.start;
    });

    if (overlappingPrevious.length === 0) {
      if (!isEventAlreadyNotified_(currentEvent, notifiedEvents)) {
        changes.push({type: 'new', event: currentEvent});
      }
      return;
    }

    var previousStart = overlappingPrevious
      .map(function (event) { return event.start; })
      .sort()[0];
    var changedBeforePreviousStart = transitionedKeys.some(function (key) {
      return key < previousStart;
    });
    if (currentEvent.start < previousStart && changedBeforePreviousStart) {
      var newlyEarlierPart = {start: currentEvent.start, end: previousStart};
      if (!isEventAlreadyNotified_(newlyEarlierPart, notifiedEvents)) {
        changes.push({type: 'earlier', event: currentEvent, newPart: newlyEarlierPart});
      }
    }
  });

  return changes;
}

function hourKeysInEvent_(event) {
  var keys = [];
  var key = event.start;
  while (key < event.end) {
    keys.push(key);
    key = addMinutesToKey_(key, 60);
  }
  return keys;
}

function eventsOverlap_(first, second) {
  return first.start < second.end && second.start < first.end;
}

function isEventAlreadyNotified_(event, notifiedEvents) {
  return (notifiedEvents || []).some(function (notified) {
    return eventsOverlap_(event, notified);
  });
}

function formatEventRange_(event) {
  return formatTimeFromKey_(event.start) + '〜' + formatTimeFromKey_(event.end) + '頃';
}

function formatEventRanges_(events) {
  return events.map(formatEventRange_).join('、');
}

function formatPrecipitation_(precipitation) {
  return (Math.round(Number(precipitation) * 10) / 10).toFixed(1);
}

function normalizeHourKey_(value) {
  return String(value).substring(0, 13) + ':00';
}

function formatTimeFromKey_(key) {
  return String(key).substring(11, 16);
}

function addMinutesToKey_(key, minutes) {
  var date = Utilities.parseDate(key, CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm");
  return Utilities.formatDate(
    new Date(date.getTime() + minutes * 60 * 1000),
    CONFIG.TIMEZONE,
    "yyyy-MM-dd'T'HH:mm"
  );
}
