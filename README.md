# クロ ポモドーロ

クロがいっしょにがんばってくれるポモドーロタイマー（PWA）。
作業25分 → 休憩5分、4回ごとに長い休憩15分。スタート・休憩・休憩おわりなどで、クロが声をかけて口パクする。

- タブレット・スマホ両対応（横長は左右、縦長は上下のレイアウト）
- ホーム画面に追加するとアプリっぽく全画面で使える。一度開けばオフラインでもOK
- タイマーは「終わる時刻」で管理しているので、アプリを閉じても時間はずれない
  - ただし閉じている間は声は鳴らない（戻ってきたときに状態が進む）
- 動いている間は画面がスリープしない
- クロをタップすると反応する。「今日◯回」を押すと今日の回数を教えてくれる

## ファイル構成

```
index.html / app.css / app.js   アプリ本体
serifu.json                     セリフ一覧（場面ごと。同じ場面はランダム）
voice/                          VOICEVOX で作った音声（tools/make_voices.py で生成）
voice/index.json                アプリが読む音声の一覧（自動生成）
tools/make_voices.py            音声をまとめて作るスクリプト（Mac で実行）
assets/                         クロの絵・パーツ・アイコン
manifest.webmanifest / sw.js    PWA 用（ホーム画面追加・オフライン）
```

## 音声の作り方（Mac）

1. [VOICEVOX](https://voicevox.hiroshiba.jp/) を入れて起動しておく
2. このリポジトリのフォルダで実行

   ```bash
   python3 tools/make_voices.py
   ```

   - セリフを変えたときは `serifu.json` を編集して、`--force`（全部作り直し）か `--only start_1,tap_2`（指定したものだけ）
   - 声の速さ・高さ・抑揚は `serifu.json` の `voice` で調整
3. `voice/` をコミットして push

音声ファイルが無いセリフは、ブラウザの読み上げで代わりにしゃべる。

## 動作確認

`?speed=60` を付けると60倍速で動く（25分 → 25秒）。

```bash
python3 -m http.server 8000
# → http://localhost:8000/?speed=60
```

## 更新するとき

オフライン用にファイルをキャッシュしているので、`app.js` などを変えたら `sw.js` の `VERSION` を上げる。
（`serifu.json` と `voice/index.json` は毎回新しいものを取りに行く）

## 表情を増やすとき

`app.js` の `CONFIG.parts` にパーツ（画像と元画像での座標）を足す。座標はすべて元画像（1402x1122）のピクセル。

## クレジット

- 音声: VOICEVOX:冥鳴ひまり
- イラスト: ChatGPT の画像生成で作成
