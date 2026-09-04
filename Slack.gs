function sendSlackMessage_(text) {
  var webhookUrl = getRequiredScriptProperty_(CONFIG.SLACK_WEBHOOK_PROPERTY);
  var response;
  try {
    response = UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json; charset=utf-8',
      payload: JSON.stringify({text: text}),
      muteHttpExceptions: true
    });
  } catch (error) {
    throw makeApiError_('Slack Incoming Webhook', null,
      error && error.message ? error.message : String(error));
  }

  var status = response.getResponseCode();
  var body = response.getContentText('UTF-8');
  if (status < 200 || status >= 300 || body.trim() !== 'ok') {
    throw makeApiError_('Slack Incoming Webhook', status, truncateForLog_(body));
  }
}

function buildMorningMessage_(events) {
  return '☔ 今日の雨予報\n\n' +
    CONFIG.LOCATION_NAME + 'では、次の時間帯に雨の予報です。\n' +
    events.map(function (event) {
      return '・' + formatEventRange_(event) +
        '（最大 ' + formatPrecipitation_(event.maxPrecipitation) + ' mm/h）';
    }).join('\n');
}

function buildForecastChangeMessage_(changes) {
  var allEarlier = changes.every(function (change) { return change.type === 'earlier'; });
  if (allEarlier) {
    var starts = changes.map(function (change) {
      return formatTimeFromKey_(change.event.start) + '頃';
    });
    return '☔ 雨の降り始めが早まりました\n\n' +
      CONFIG.LOCATION_NAME + 'では、\n' +
      starts.join('、') + 'から雨になる予報に変わりました。';
  }

  return '☔ 雨予報に変わりました\n\n' +
    CONFIG.LOCATION_NAME + 'では、\n' +
    formatEventRanges_(changes.map(function (change) { return change.event; })) +
    'に雨の予報です。';
}

function buildNowcastMessage_(event) {
  return '🌧️ 雨が近づいています\n\n' +
    CONFIG.LOCATION_NAME + 'では、\n' +
    formatMinutesUntil_(event.minutesUntil) + 'から雨が降り始める予報です。\n\n' +
    CONFIG.YAHOO_ATTRIBUTION;
}
