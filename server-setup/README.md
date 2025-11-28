# MTXCast Server Setup

MTXCastはOBSなどの配信用途から直接WHIP(WebRTC-HTTP ingestion protocol)で送られてくる映像・音声、もしくはHTTP API経由で受信するメタデータ(URL/再生時間など)をもとに、PySide6製の独自プレイヤーで全画面再生を行う統合キャストサーバーです。

## 主な機能
- FastAPIベースのHTTP+WHIPエンドポイント
- yt-dlpを用いたオンデマンドのストリーム解決と即時再生
- 動画・音声ファイルのアップロードと再生
- 再生/一時停止/シーク/音量調整などのリモート制御API
- PySide6 + QtMultimediaによる内蔵プレイヤー、設定ダイアログ、タスクトレイ常駐
- プレイヤー下部のコントローラーからもマウス操作で再生/一時停止/停止/シーク/音量調整が可能
- qasyncを利用したQt Event Loopとasyncioの統合

## 依存関係
Python 3.10+ を想定しています。必要なパッケージは `requirements.txt` にまとめています。

```
pip install -r requirements.txt
```

## 実行方法
1. `python -m mtxcast.app`
2. 初回起動時に設定ウィンドウが開くので、待受アドレスやポートなどを設定
3. トレイアイコンから状態確認やアプリ終了が可能

## APIエンドポイント概要
- `POST /whip` : WHIPクライアント(OBS等)からのSDP Offerを受信し、ストリームを内部プレイヤーに接続
- `POST /metadata` : `{ "source_url": "https://...", "start_time": 30 }` のようなメタデータで再生を開始
- `POST /upload` : 動画・音声ファイルをアップロードして再生を開始
- `POST /control/play` / `pause` / `stop` / `seek` / `volume`
- `GET /status` : 現在のストリーム種別や音量に加え、メタデータ再生時は `position` / `duration` / `is_seekable` を返すのでクライアント側で再生位置同期に利用可能

詳細は `src/mtxcast/api_server.py` を参照してください。

### API使用例
`X-API-Token` を設定している場合は適宜ヘッダーを付与してください。

#### メタデータ経由での再生開始
```
curl -X POST http://127.0.0.1:8080/metadata \
  -H "Content-Type: application/json" \
  -d '{
        "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "start_time": 15
      }'
```

#### ファイルアップロード
```
# 動画・音声ファイルをアップロードして再生
curl -X POST http://127.0.0.1:8080/upload \
  -F "file=@/path/to/video.mp4" \
  -F "start_time=0.0"

# レスポンス例
{
  "stream_type": "METADATA",
  "title": "video.mp4",
  "is_playing": true,
  "file_path": "/home/user/.mtxcast/uploads/tmpXXXXXX.mp4"
}
```

#### 再生コントロール
```
# 再生/一時停止/停止
curl -X POST http://127.0.0.1:8080/control/play
curl -X POST http://127.0.0.1:8080/control/pause
curl -X POST http://127.0.0.1:8080/control/stop

# シーク(秒指定)
curl -X POST http://127.0.0.1:8080/control/seek \
  -H "Content-Type: application/json" \
  -d '{"position": 120}'

# 音量(0.0〜1.0)
curl -X POST http://127.0.0.1:8080/control/volume \
  -H "Content-Type: application/json" \
  -d '{"volume": 0.5}'

# 現在のステータス (position/duration はメタデータ再生時のみ有効)
curl http://127.0.0.1:8080/status
{
  "stream_type": "METADATA",
  "title": "Sample Stream",
  "is_playing": true,
  "volume": 0.8,
  "position": 123.4,
  "duration": 3600.0,
  "is_seekable": true
}
```

#### WHIPエンドポイント
OBSなどからWHIP出力を有効化し、エンドポイントURLを `http://<host>:8080/whip` に設定すると、SDP Offer/Answerが自動交換されて内部プレイヤーに接続されます。

## 使用例

### ブラウザ拡張機能からの使用

1. **動画のキャスト**
   - ウェブページ上の動画に表示される「📺 Cast」ボタンをクリック
   - サーバー側で自動的に再生が開始されます
   - 元動画とサーバー側の再生時間が自動同期されます

2. **ファイルのアップロード**
   - 拡張機能のポップアップを開く
   - 「コントロール」タブの「ファイルアップロード」セクションでファイルを選択
   - 「アップロードして再生」をクリック
   - アップロード完了後、自動的に再生が開始されます

3. **画面ミラーリング**
   - 拡張機能のポップアップから「ミラー開始」をクリック
   - 画面共有の許可を選択
   - WHIP経由でサーバー側にストリームが送信されます

### コマンドラインからの使用

#### YouTube動画の再生
```bash
curl -X POST http://127.0.0.1:8080/metadata \
  -H "Content-Type: application/json" \
  -d '{
    "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "start_time": 0
  }'
```

#### ローカルファイルのアップロードと再生
```bash
# 動画ファイルをアップロード
curl -X POST http://127.0.0.1:8080/upload \
  -F "file=@/path/to/video.mp4" \
  -F "start_time=0.0"

# 音声ファイルをアップロード
curl -X POST http://127.0.0.1:8080/upload \
  -F "file=@/path/to/audio.mp3" \
  -F "start_time=0.0"
```

#### 再生制御の例
```bash
# ステータス確認
curl http://127.0.0.1:8080/status

# 一時停止
curl -X POST http://127.0.0.1:8080/control/pause

# 再生再開
curl -X POST http://127.0.0.1:8080/control/play

# 30秒にシーク
curl -X POST http://127.0.0.1:8080/control/seek \
  -H "Content-Type: application/json" \
  -d '{"position": 30}'

# 音量を50%に設定
curl -X POST http://127.0.0.1:8080/control/volume \
  -H "Content-Type: application/json" \
  -d '{"volume": 0.5}'

# 停止
curl -X POST http://127.0.0.1:8080/control/stop
```

### Pythonスクリプトからの使用例

```python
import requests

# サーバーURL
BASE_URL = "http://127.0.0.1:8080"

# YouTube動画を再生
response = requests.post(
    f"{BASE_URL}/metadata",
    json={
        "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "start_time": 0
    }
)
print(response.json())

# ファイルをアップロード
with open("video.mp4", "rb") as f:
    files = {"file": f}
    data = {"start_time": "0.0"}
    response = requests.post(f"{BASE_URL}/upload", files=files, data=data)
    print(response.json())

# ステータス確認
status = requests.get(f"{BASE_URL}/status").json()
print(f"現在の再生位置: {status.get('position')}秒")
print(f"タイトル: {status.get('title')}")

# シーク
requests.post(
    f"{BASE_URL}/control/seek",
    json={"position": 60}
)

# 音量調整
requests.post(
    f"{BASE_URL}/control/volume",
    json={"volume": 0.8}
)
```

### APIトークンを使用する場合

サーバー設定でAPIトークンを設定している場合、すべてのリクエストに `X-API-Token` ヘッダーを追加してください。

```bash
curl -X POST http://127.0.0.1:8080/metadata \
  -H "Content-Type: application/json" \
  -H "X-API-Token: your-api-token" \
  -d '{"source_url": "https://...", "start_time": 0}'
```

## ライセンス
本プロジェクトは同一ルートにある `LICENSE` に従います。



