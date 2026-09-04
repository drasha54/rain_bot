/** Returns the first rainy event forecast by Yahoo! within the next hour. */
function fetchNowcastRainEvent_(now) {
  var appId = getRequiredScriptProperty_(CONFIG.YAHOO_APP_ID_PROPERTY);
  var query = [
    'coordinates=' + encodeURIComponent(CONFIG.TARGET_LON + ',' + CONFIG.TARGET_LAT),
    'appid=' + encodeURIComponent(appId),
    'output=json',
    'interval=10'
  ].join('&');
  var payload = fetchJson_('Yahoo! Weather', CONFIG.YAHOO_WEATHER_ENDPOINT + '?' + query);

  var weather;
  try {
    weather = payload.Feature[0].Property.WeatherList.Weather;
  } catch (error) {
    throw makeApiError_('Yahoo! Weather', null, 'Unexpected nowcast response');
  }
  if (!Array.isArray(weather)) {
    throw makeApiError_('Yahoo! Weather', null, 'Weather list is missing from the response');
  }

  var nowMillis = now.getTime();
  var limitMillis = nowMillis + CONFIG.NOWCAST_MINUTES * 60 * 1000;
  var forecasts = weather
    .filter(function (item) { return item.Type === 'forecast'; })
    .map(function (item) {
      return {
        time: parseYahooDate_(String(item.Date)),
        precipitation: Number(item.Rainfall)
      };
    })
    .filter(function (item) {
      return Number.isFinite(item.precipitation) &&
        item.time.getTime() >= nowMillis && item.time.getTime() <= limitMillis;
    })
    .sort(function (a, b) { return a.time.getTime() - b.time.getTime(); });

  var firstRainIndex = forecasts.findIndex(function (item) {
    return isRain_(item.precipitation);
  });
  if (firstRainIndex < 0) {
    return null;
  }

  var intervalMinutes = 10;
  if (forecasts.length >= 2) {
    intervalMinutes = Math.max(1, Math.round(
      (forecasts[1].time.getTime() - forecasts[0].time.getTime()) / 60000
    ));
  }

  var lastRainIndex = firstRainIndex;
  while (lastRainIndex + 1 < forecasts.length &&
         isRain_(forecasts[lastRainIndex + 1].precipitation) &&
         forecasts[lastRainIndex + 1].time.getTime() - forecasts[lastRainIndex].time.getTime() <=
           intervalMinutes * 60000) {
    lastRainIndex += 1;
  }

  var start = forecasts[firstRainIndex].time;
  var end = new Date(forecasts[lastRainIndex].time.getTime() + intervalMinutes * 60000);
  return {
    start: formatDateTimeKey_(start),
    end: formatDateTimeKey_(end),
    minutesUntil: Math.max(0, Math.round((start.getTime() - nowMillis) / 60000))
  };
}

function parseYahooDate_(value) {
  if (!/^\d{12}$/.test(value)) {
    throw makeApiError_('Yahoo! Weather', null, 'Invalid forecast date: ' + value);
  }
  return Utilities.parseDate(value, CONFIG.TIMEZONE, 'yyyyMMddHHmm');
}

function formatDateTimeKey_(date) {
  return Utilities.formatDate(date, CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm");
}

function formatMinutesUntil_(minutes) {
  var rounded = Math.max(0, Math.round(minutes / 10) * 10);
  return rounded <= 0 ? 'まもなく' : '約' + rounded + '分後';
}
