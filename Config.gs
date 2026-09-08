/**
 * Public, non-secret settings for the rain bot.
 * Secrets must be stored in Apps Script Script Properties.
 */
var CONFIG = Object.freeze({
  RAIN_THRESHOLD: 0.1,

  MORNING_TRIGGER_HOUR: 8,
  MORNING_START_HOUR: 8,
  FORECAST_END_HOUR: 21,

  AFTERNOON_SCAN_START: '15:00',
  AFTERNOON_SCAN_END: '19:00',
  AFTERNOON_SCAN_INTERVAL_MINUTES: 30,

  // Yahoo! Weather's free-use terms restrict the service to publicly
  // available free applications. Keep this false for a private Slack unless
  // your intended use has been confirmed as permitted (see README).
  NOWCAST_ENABLED: false,

  // Approximate coordinates for the Yoshida area. Replace these with the
  // coordinates of the actual destination when you deploy the bot.
  TARGET_LAT: 35.0262,
  TARGET_LON: 135.7808,
  LOCATION_NAME: '吉田付近',
  TIMEZONE: 'Asia/Tokyo',

  MET_NORWAY_ENDPOINT:
    'https://api.met.no/weatherapi/locationforecast/2.0/compact',
  // MET Norway requires an identifiable User-Agent. Keep a working contact
  // URL here if this repository is moved or renamed.
  MET_NORWAY_USER_AGENT:
    'rain_bot/1.0 github.com/drasha54/rain_bot',
  MET_NORWAY_CONTACT_URL:
    'https://github.com/drasha54/rain_bot',
  MET_NORWAY_ATTRIBUTION:
    '天気予報データ: <https://api.met.no/|MET Norway> ' +
    '（<https://creativecommons.org/licenses/by/4.0/|CC BY 4.0>、Botで抽出・整形）',
  YAHOO_WEATHER_ENDPOINT: 'https://map.yahooapis.jp/weather/V1/place',
  YAHOO_ATTRIBUTION:
    'Webサービス by Yahoo! JAPAN （https://developer.yahoo.co.jp/sitemap/）',

  STATE_PROPERTY_KEY: 'RAIN_BOT_STATE_V1',
  SLACK_WEBHOOK_PROPERTY: 'SLACK_WEBHOOK_URL',
  YAHOO_APP_ID_PROPERTY: 'YAHOO_APP_ID',

  NOWCAST_MINUTES: 60,
  NOTIFIED_EVENT_MATCH_MINUTES: 60,
  LOCK_TIMEOUT_MS: 20000
});
