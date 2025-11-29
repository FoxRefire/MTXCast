# MTXCast

MTXCastはOBSなどの配信用途から直接WHIP(WebRTC-HTTP ingestion protocol)で送られてくる映像・音声、もしくはHTTP API経由で受信するメタデータ(URL/再生時間など)をもとに、PySide6製の独自プレイヤーで全画面再生を行う統合キャストサーバーです。

## プロジェクト構成

- **`server-setup/`**: MTXCastサーバー（Python/FastAPI）
- **`browser-extension/`**: ブラウザ拡張機能（Chrome/Firefox対応）
- **`cli-client/`**: コマンドラインクライアント（Python）
- **`android-app/`**: Androidアプリ（Kotlin）

## クイックスタート

### サーバーの起動

```bash
cd server-setup
pip install -r requirements.txt
python -m mtxcast.app
```

詳細は [`server-setup/README.md`](server-setup/README.md) を参照してください。

### CLIクライアントの使用

```bash
cd cli-client
pip install -r requirements.txt

# ステータス確認
python mtxcast_cli.py status

# YouTube動画を再生
python mtxcast_cli.py play-url "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# 再生制御
python mtxcast_cli.py play
python mtxcast_cli.py pause
python mtxcast_cli.py seek 120
python mtxcast_cli.py volume 0.5
```

詳細は [`cli-client/README.md`](cli-client/README.md) を参照してください。

### Androidアプリの使用

1. Android Studioで `android-app/` を開く
2. ビルドしてデバイスにインストール
3. アプリを起動し、設定画面でサーバーURLを入力
4. メイン画面からサーバーを制御

詳細は [`android-app/README.md`](android-app/README.md) を参照してください。

### ブラウザ拡張機能の使用

1. ChromeまたはFirefoxで拡張機能を読み込む
2. ウェブページ上の動画に「📺 Cast」ボタンが表示される
3. ボタンをクリックしてサーバーにキャスト

## 主な機能

### サーバー機能

- FastAPIベースのHTTP+WHIPエンドポイント
- yt-dlpを用いたオンデマンドのストリーム解決と即時再生
- 動画・音声ファイルのアップロードと再生
- 再生/一時停止/シーク/音量調整などのリモート制御API
- PySide6 + QtMultimediaによる内蔵プレイヤー
- タスクトレイ常駐

### クライアント機能

#### CLIクライアント

- コマンドラインからの全機能制御
- JSON形式での出力対応
- リモートサーバー接続対応

#### Androidアプリ

- リアルタイムステータス表示
- 直感的なUI操作
- ファイルアップロード機能
- URLからのメディア再生

#### ブラウザ拡張機能

- ウェブページ上の動画キャスト
- 画面ミラーリング
- ファイルアップロード

## APIエンドポイント

- `POST /whip`: WHIPクライアントからのSDP Offerを受信
- `POST /metadata`: メタデータで再生を開始
- `POST /upload`: 動画・音声ファイルをアップロードして再生
- `POST /control/play` / `pause` / `stop` / `seek` / `volume`: 再生制御
- `GET /status`: 現在のステータス取得

詳細は [`server-setup/README.md`](server-setup/README.md) を参照してください。

## ライセンス

本プロジェクトは `LICENSE` に従います。
