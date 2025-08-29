# MTXCast Server Setup

MTXCastはOBSなどの配信用途から直接WHIP(WebRTC-HTTP ingestion protocol)で送られてくる映像・音声、もしくはHTTP API経由で受信するメタデータ(URL/再生時間など)をもとに、PySide6製の独自プレイヤーで全画面再生を行う統合キャストサーバーです。

## 主な機能
- FastAPIベースのHTTP+WHIPエンドポイント
- yt-dlpを用いたオンデマンドのストリーム解決と即時再生
- 再生/一時停止/シーク/音量調整などのリモート制御API
- PySide6 + QtMultimediaによる内蔵プレイヤー、設定ダイアログ、タスクトレイ常駐
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
- `POST /control/play` / `pause` / `seek` / `volume`

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

#### 再生コントロール
```
# 再生/一時停止
curl -X POST http://127.0.0.1:8080/control/play
curl -X POST http://127.0.0.1:8080/control/pause

# シーク(秒指定)
curl -X POST http://127.0.0.1:8080/control/seek \
  -H "Content-Type: application/json" \
  -d '{"position": 120}'

# 音量(0.0〜1.0)
curl -X POST http://127.0.0.1:8080/control/volume \
  -H "Content-Type: application/json" \
  -d '{"volume": 0.5}'
```

#### WHIPエンドポイント
OBSなどからWHIP出力を有効化し、エンドポイントURLを `http://<host>:8080/whip` に設定すると、SDP Offer/Answerが自動交換されて内部プレイヤーに接続されます。

## ライセンス
本プロジェクトは同一ルートにある `LICENSE` に従います。

