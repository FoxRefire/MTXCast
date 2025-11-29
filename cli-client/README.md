# MTXCast CLI Client

MTXCastサーバーをコマンドラインから制御するためのCLIクライアントです。

## インストール

```bash
pip install -r requirements.txt
```

実行可能にする場合（オプション）:
```bash
chmod +x mtxcast_cli.py
# または
python -m pip install --editable .
```

## 使用方法

### 基本オプション

- `--server URL`: サーバーURLを指定（デフォルト: `http://127.0.0.1:8080`）
- `--token TOKEN`: APIトークンを指定（サーバーで設定されている場合）
- `--json`: 結果をJSON形式で出力

### コマンド

#### ステータス確認

```bash
# 現在のステータスを取得
mtxcast-cli status

# JSON形式で出力
mtxcast-cli --json status
```

#### 再生制御

```bash
# 再生/再開
mtxcast-cli play

# 一時停止
mtxcast-cli pause

# 停止
mtxcast-cli stop
```

#### シークと音量

```bash
# 120秒の位置にシーク
mtxcast-cli seek 120

# 音量を50%に設定
mtxcast-cli volume 0.5
```

#### URLから再生

```bash
# YouTube動画を再生
mtxcast-cli play-url "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# 15秒の位置から再生開始
mtxcast-cli play-url "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --start-time 15
```

#### ファイルアップロード

```bash
# 動画ファイルをアップロードして再生
mtxcast-cli upload video.mp4

# 30秒の位置から再生開始
mtxcast-cli upload video.mp4 --start-time 30
```

### リモートサーバーへの接続

```bash
# リモートサーバーに接続
mtxcast-cli --server http://192.168.1.100:8080 status

# APIトークンを使用
mtxcast-cli --server http://192.168.1.100:8080 --token your-api-token status
```

## 例

```bash
# サーバーの状態を確認
mtxcast-cli status

# YouTube動画を再生
mtxcast-cli play-url "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# 60秒待ってから一時停止
sleep 60
mtxcast-cli pause

# 120秒の位置にシーク
mtxcast-cli seek 120

# 再生再開
mtxcast-cli play

# 音量を80%に設定
mtxcast-cli volume 0.8

# 停止
mtxcast-cli stop
```

## エラーハンドリング

エラーが発生した場合、エラーメッセージとHTTPレスポンスが表示されます。サーバーが起動しているか、URLやAPIトークンが正しいか確認してください。
