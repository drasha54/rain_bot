# 京都・吉田 雨予報 Slack Bot

京都市左京区吉田周辺の雨を、必要なときだけ Slack に通知する Google Apps Script（GAS）です。

- 毎朝8時頃、当日8:00〜21:00（21時台を含む）に雨があれば、雨の時間帯ごとの最大降水量とともに通知
- 15:00〜19:00の30分ごとに、時間予報の「非雨 → 雨」と降り始めの前倒しを検知
- 時間予報は登録・APIキー不要のMET Norway Locationforecast APIを使用
- 時間予報で未通知の雨だけ、Yahoo! 気象情報APIの60分予報で接近通知（利用条件確認後に有効化）
- 雨の強弱、雨の消滅、終了時刻の延長は通知しない
- 通知済み状態は GAS の Script Properties に日単位で保存
- APIエラーは Slack に送らず、GAS の実行ログだけに記録

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `Main.gs` | 朝・午後処理、排他制御、トリガー作成、動作確認関数 |
| `Weather.gs` | MET Norway取得、UTCからJSTへの変換、雨イベント化、予報変更判定 |
| `Nowcast.gs` | Yahoo! 気象情報API取得、60分以内の雨判定 |
| `Slack.gs` | Slack Incoming Webhook送信、通知文生成 |
| `State.gs` | 日別状態、通知済みイベント、Script Properties管理 |
| `Config.gs` | 閾値、時刻、座標などの公開設定 |
| `appsscript.json` | GASマニフェスト、タイムゾーン、権限 |
| `test/` | Node.jsで実行できる判定ロジックのテスト |

## 先に用意するもの

- この GitHub リポジトリを操作できるPC
- Node.js 20以降
- Google アカウント
- 通知先ワークスペースにアプリを追加できる Slack 権限

GitHub ActionsやGASのWebアプリ公開は不要です。定期実行はGASの時間主導型トリガーが担当します。
MET Norwayの利用登録やAPIキーも不要です。コードはAPIの利用条件に従い、識別用User-Agentと通知末尾の出典・ライセンス表記を自動で付けます。
リポジトリの移動・改名時は、[Config.gs](./Config.gs) の `MET_NORWAY_USER_AGENT` と `MET_NORWAY_CONTACT_URL` を、連絡先を確認できる新しいURLへ変更してください。

> [!IMPORTANT]
> Yahoo!公式FAQでは、気象情報APIの無償利用は「一般公開された無償のサービス」に限られ、非公開サイト・イントラネットでは利用できないと案内されています。研究室内などの非公開Slack Botはこの制限に該当する可能性が高いため、`NOWCAST_ENABLED` の初期値は `false` です。時間別通知はYahoo!なしで動作します。直前雨通知を有効にする前に、[Yahoo! Open Local Platform FAQ](https://developer.yahoo.co.jp/webapi/map/faq.html) と所属組織の利用条件を確認し、必要ならYahoo!側へ問い合わせるか、利用可能な別プロバイダーへの変更を検討してください。

## 1. SlackでIncoming Webhookを作る

1. [Slack API: Your Apps](https://api.slack.com/apps) を開きます。
2. `Create New App` → `From scratch` を選びます。
3. アプリ名（例: `吉田 雨予報Bot`）と対象ワークスペースを選び、作成します。
4. 左メニューの `Incoming Webhooks` を開きます。
5. `Activate Incoming Webhooks` を `On` にします。
6. `Add New Webhook to Workspace` を押します。
7. 通知先チャンネルを選び、`Allow` / `許可する` を押します。
8. `Webhook URLs for Your Workspace` に表示された `https://hooks.slack.com/services/...` をコピーします。

Webhook URLは認証情報です。README、ソースコード、Issue、チャット、GitHubには貼らないでください。後ほどGASのScript Propertiesだけに保存します。非公開チャンネルを選ぶ場合、設定作業をするユーザーが先にそのチャンネルへ参加している必要があります。

## 2. Yahoo!のClient IDを発行する（今回は不要）

`NOWCAST_ENABLED` の初期値は `false` なので、この手順は飛ばしてください。MET Norwayによる朝・午後の時間別通知はYahoo!なしで動作します。将来、利用条件を確認したうえで直前雨通知を有効にするときだけ、以下を行います。

1. [Yahoo!デベロッパーネットワーク](https://developer.yahoo.co.jp/) にYahoo! JAPAN IDでログインします。
2. [アプリケーションの管理](https://e.developer.yahoo.co.jp/dashboard/) から新しいアプリケーションを登録します。
3. このBotではユーザーのYahoo!アカウント情報を取得しないため、選択肢がある場合は `ID連携を利用しない` を選びます。
4. アプリ名、利用者情報、用途（例: `研究室への移動用の降雨通知`）など、画面の必須項目を入力して規約に同意します。
5. 発行された `Client ID`（画面によってはアプリケーションID表記）をコピーします。

このBotが使う気象情報APIは、現在から60分後までの降水強度を返します。APIには座標を `経度,緯度` の順で送信します。Client IDは後ほど `YAHOO_APP_ID` として保存します。

利用条件の確認が済んだ場合だけ、[Config.gs](./Config.gs) の `NOWCAST_ENABLED` を `true` に変更してください。Yahoo!指定のプレーンテキスト形式クレジットは直前雨通知の末尾に自動挿入されます。文言を削除・改変せず、[公式のクレジット表示ルール](https://developer.yahoo.co.jp/attribution/)も確認してください。

## 3. Google Apps Scriptプロジェクトを作る

### 3-1. Apps Script APIを有効にする

1. [Google Apps Script設定](https://script.google.com/home/usersettings) を開きます。
2. `Google Apps Script API` をオンにします。

これはローカルの `clasp` からGASへコードを送るために必要です。

### 3-2. 空のGASプロジェクトを作る

1. [Google Apps Script](https://script.google.com/) を開きます。
2. `新しいプロジェクト` を作成します。
3. プロジェクト名を `京都・吉田 雨予報Bot` などに変更します。
4. 左側の歯車アイコン `プロジェクトの設定` を開きます。
5. `ID` 欄の `スクリプトID` をコピーします。

最初からある `コード.gs` は、最初の `clasp push` でこのリポジトリのファイルに置き換わります。

### 3-3. claspを設定してコードを送る

PowerShellでこのリポジトリへ移動し、次を実行します。

```powershell
npm install -g @google/clasp
clasp login
Copy-Item .clasp.example.json .clasp.json
```

`.clasp.json` を開き、`PASTE_YOUR_APPS_SCRIPT_ID_HERE` を手順3-2でコピーしたスクリプトIDに置き換えます。その後、次を実行します。

```powershell
clasp push
clasp open-script
```

`.clasp.json` と `.clasprc.json` は `.gitignore` 対象です。特にログイン情報を含む `.clasprc.json` は絶対にコミットしないでください。以後、ローカルでコードを変更したら `clasp push` で反映します。GASエディタ側とローカル側を同時に編集すると競合しやすいため、このリポジトリを正本にしてください。

## 4. GASに秘密情報を登録する

GASエディタで次の操作をします。

1. 左側の歯車アイコン `プロジェクトの設定` を開きます。
2. `スクリプト プロパティ` まで移動します。
3. `スクリプト プロパティを追加` を押し、次を追加します。

| プロパティ | 値 |
| --- | --- |
| `SLACK_WEBHOOK_URL` | 手順1でコピーしたSlack Webhook URL |
| `YAHOO_APP_ID` | 今回は不要。将来 `NOWCAST_ENABLED: true` にする場合のみ追加 |

4. `スクリプト プロパティを保存` を押します。

名前は大文字・小文字も含めて完全一致させます。値の前後に引用符や余分な空白は付けません。Botの状態は同じ領域の `RAIN_BOT_STATE_V1` にコードから自動保存されます。

## 5. 対象地点を確認・変更する

初期値は吉田周辺のおおよその座標です。

```javascript
TARGET_LAT: 35.0262,
TARGET_LON: 135.7808,
```

研究室など実際の目的地に合わせる場合は、Google マップで地点を右クリックし、表示された `緯度, 経度` をコピーして [Config.gs](./Config.gs) の `TARGET_LAT` と `TARGET_LON` を変更します。Google マップの表示順と異なり、コードがYahoo!へ問い合わせる際は内部で `経度,緯度` の順に並べ替えます。

場所の表示名を変える場合は `LOCATION_NAME` も変更します。変更後は再度実行します。

```powershell
clasp push
```

## 6. 本番前の動作確認

GASエディタ上部の関数選択欄から、次の順に手動実行します。

### 6-1. `testWeatherApis`

MET Norwayを呼び、結果を実行ログへ表示します。`NOWCAST_ENABLED: true` の場合はYahoo!も1回呼びます。Slackには投稿しません。

初回はGoogleの権限確認画面が出ます。使用するGoogleアカウントを選び、外部サービスへの接続とトリガー管理を許可してください。自作スクリプトとして警告画面が出る場合は、内容とプロジェクト名を確認したうえで詳細表示から進みます。

実行後、左メニューの `実行数` でステータスが `完了` になり、ログに `hourly` が表示されることを確認します。直前雨機能が無効なら `nowcastRainEvent` は `{"disabled":true}`、有効でも雨がなければ `null` で正常です。

### 6-2. `scheduleAutomaticWeatherApiTest`

以前Open-Meteoが時間主導型トリガーからだけ429になった環境では、この確認も行います。

1. 関数選択欄から `scheduleAutomaticWeatherApiTest` を選び、1回手動実行します。
2. 最短1分後に、時間主導型の `testAutomaticWeatherApi` が1回実行されます。多少遅れる場合があります。
3. 左メニューの `実行数` を開き、`testAutomaticWeatherApi` が `完了` になっていることを確認します。
4. 実行ログに `hourly` が表示されていれば、MET Norwayへの自動アクセスは成功です。Slack投稿とBotの状態変更は行いません。

テスト用トリガーは実行後にコードが削除します。失敗した場合は、実行ログの `httpStatus` と `error` を確認してください。

### 6-3. `testSlackNotification`

1件だけ、次のテストメッセージを投稿します。

```text
✅ 京都・吉田 雨予報Botのテスト通知です。
```

想定したSlackチャンネルに届けばWebhook設定は完了です。

### 6-4. 任意の判定確認

- `showRainBotState`: 現在の日別状態をログへ表示
- `clearRainBotState`: 保存済み状態だけを削除（通知テストをやり直す場合などに使用）
- `runMorningCheck`: 朝処理を手動実行。雨予報がある場合は実際にSlack通知する
- `runAfternoonCheck`: 15:00〜19:00の間だけ手動実行可能。条件に該当すれば実際に通知する

`clearRainBotState` はWebhook URLとYahoo! Client IDを削除しません。

## 7. 定期トリガーを作る

GASエディタで `setupTriggers` を1回手動実行します。次の10個が作成されます。

- `runMorningCheck`: 毎日8:00頃
- 午後用ラッパー9個: 15:00、15:30、16:00、16:30、17:00、17:30、18:00、18:30、19:00頃

左メニューの時計アイコン `トリガー` を開き、10件あることを確認します。`setupTriggers` を再実行しても、このBot用の既存トリガーだけを消して作り直すため重複しません。別プロジェクトのトリガーや、同じプロジェクト内でも別名のハンドラーは削除しません。

GASの時間主導型トリガーは指定時刻の前後にずれることがあります。コードは各スロットを日ごとに一度だけ処理し、同時実行はスクリプトロックで直列化します。

トリガーをすべて止めたい場合は、`deleteRainBotTriggers` を手動実行します。

## 8. 運用確認とトラブルシューティング

### 通知が届かない

1. 晴天日は仕様どおり通知ゼロです。まず `testSlackNotification` でWebhook単体を確認します。
2. GASの `実行数` で、対象関数が実行されているか確認します。
3. エラー詳細の `api`、`httpStatus`、`error` を確認します。
4. Script Propertiesのキー名と値を再確認します。
5. Slackアプリが削除・無効化されていないか、通知先チャンネルがアーカイブされていないか確認します。

### よくあるエラー

| ログ | 主な確認箇所 |
| --- | --- |
| `Configuration` / `SLACK_WEBHOOK_URL is not set` | Script PropertiesのWebhook URL |
| `Configuration` / `YAHOO_APP_ID is not set` | Script PropertiesのYahoo! Client ID |
| `MET Norway` / HTTP 403 | 座標が小数4桁以内か、識別用User-Agentが有効か |
| `MET Norway` / HTTP 429・5xx | APIの一時的な制限・障害。少し時間を空けて再確認 |
| `Yahoo! Weather` / HTTP 400 | Client ID、座標、Yahoo!側の登録反映状況 |
| `Slack Incoming Webhook` / HTTP 4xx | Webhook URL、Slackアプリ、チャンネル状態 |
| `LockService` | 直前の実行が継続中。通常は次回実行を待てばよい |

エラーはGASのログにJSON形式で記録され、Slackへエラー通知は送りません。これによりAPI障害時の大量投稿を防ぎます。

### Webhook URLを漏らした場合

Slackのアプリ設定で該当Webhookを無効化または再発行し、GASの `SLACK_WEBHOOK_URL` を新しい値へ更新します。Git履歴や共有メッセージに残った値は、削除だけで安全になったとは考えず必ず失効させてください。

### Yahoo! Client IDを変更した場合

GASの `YAHOO_APP_ID` だけを差し替えます。コード変更やトリガー再作成は不要です。

## ローカルテスト

外部APIやSlackへ接続せず、雨イベントと通知抑制の判定を検証できます。

```powershell
npm test
```

テスト対象には、新しい雨、開始前倒し、強弱変化、雨の消滅、終了延長、通知済みイベントの再出現、直前通知の重複抑制が含まれます。

## 実装上の補足

- 雨は `precipitation >= 0.1 mm/h` と定義します。
- MET Norwayの `next_1_hours` にある1時間値 `16:00` は16時台を表すため、16・17・18時台が雨なら `16:00〜19:00頃` と表示します。
- MET Norwayの時刻はUTCで返るため、コード内で `Asia/Tokyo` のJSTへ変換します。APIの条件に合わせ、送信する緯度・経度は小数4桁に丸めます。
- MET Norway由来のSlack通知には、CC BY 4.0の出典、ライセンス、Botで抽出・整形した旨を表示します。
- 午後の初回に比較元がない場合、その時点の予報を基準として保存し、時間予報の変更通知は送りません。60分以内の未通知の雨はYahoo!予報で補完できます。
- 朝または午後に通知した時間帯の60分前から終了時刻までは、同じ雨とみなして直前通知を抑制します。
- 日付が変わると前日の予報と通知済み状態は自動的に破棄されます。
- 1日10回の通常実行で、直前雨機能が有効なら最大19回程度の気象APIリクエスト（MET Norway 10回、Yahoo! 最大9回、通知時のみ別途Slack）です。無効ならYahoo!へのリクエストは行いません。

## 参考（公式ドキュメント）

- [MET Norway Weather API](https://api.met.no/)
- [Locationforecast data model](https://docs.api.met.no/doc/locationforecast/datamodel.html)
- [MET Norway Terms of Service](https://api.met.no/doc/TermsOfService)
- [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)
- [Yahoo! 気象情報API](https://developer.yahoo.co.jp/webapi/map/openlocalplatform/v1/weather.html)
- [Yahoo!デベロッパーネットワーク ご利用ガイド](https://developer.yahoo.co.jp/start/)
- [Yahoo! Open Local Platform FAQ](https://developer.yahoo.co.jp/webapi/map/faq.html)
- [Yahoo! クレジット表示](https://developer.yahoo.co.jp/attribution/)
- [Slack Incoming Webhooks](https://api.slack.com/messaging/webhooks)
- [Google Apps Script: clasp](https://developers.google.com/apps-script/guides/clasp)
- [Google Apps Script: Script Properties](https://developers.google.com/apps-script/guides/properties)
- [Google Apps Script: Installable Triggers](https://developers.google.com/apps-script/guides/triggers/installable)
