# MTXCast Server Setup

MTXCast is an integrated cast server that performs full-screen playback using a custom PySide6 player, receiving video/audio directly via WHIP (WebRTC-HTTP ingestion protocol) from broadcasting tools like OBS, or metadata (URL/playback time, etc.) via HTTP API.

## Main Features
- FastAPI-based HTTP+WHIP endpoints
- On-demand stream resolution and instant playback using yt-dlp
- Video/audio file upload and playback
- Remote control API for play/pause/seek/volume adjustment, etc.
- Built-in player using PySide6 + QtMultimedia, settings dialog, and system tray resident
- Playback control (play/pause/stop/seek/volume) via mouse operations from the controller at the bottom of the player
- Integration of Qt Event Loop and asyncio using qasync

## Dependencies
Python 3.10+ is assumed. Required packages are listed in `requirements.txt`.

```
pip install -r requirements.txt
```

## Running
1. `python -m mtxcast.app`
2. On first launch, a settings window will open where you can configure the listen address, port, etc.
3. Status checking and app termination are available from the tray icon

## API Endpoints Overview
- `POST /whip`: Receive SDP Offer from WHIP client (OBS, etc.) and connect stream to internal player
- `POST /metadata`: Start playback with metadata like `{ "source_url": "https://...", "start_time": 30 }`
- `POST /upload`: Upload video/audio file and start playback
- `POST /control/play` / `pause` / `stop` / `seek` / `volume`
- `GET /status`: Returns current stream type and volume, plus `position` / `duration` / `is_seekable` during metadata playback, which can be used for playback position synchronization on the client side

For details, see `src/mtxcast/api_server.py`.

### API Usage Examples
If `X-API-Token` is configured, add the header as appropriate.

#### Starting Playback via Metadata
```
curl -X POST http://127.0.0.1:8080/metadata \
  -H "Content-Type: application/json" \
  -d '{
        "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "start_time": 15
      }'
```

#### File Upload
```
# Upload and play video/audio file
curl -X POST http://127.0.0.1:8080/upload \
  -F "file=@/path/to/video.mp4" \
  -F "start_time=0.0"

# Response example
{
  "stream_type": "METADATA",
  "title": "video.mp4",
  "is_playing": true,
  "file_path": "/home/user/.mtxcast/uploads/tmpXXXXXX.mp4"
}
```

#### Playback Control
```
# Play/pause/stop
curl -X POST http://127.0.0.1:8080/control/play
curl -X POST http://127.0.0.1:8080/control/pause
curl -X POST http://127.0.0.1:8080/control/stop

# Seek (specify seconds)
curl -X POST http://127.0.0.1:8080/control/seek \
  -H "Content-Type: application/json" \
  -d '{"position": 120}'

# Volume (0.0 to 1.0)
curl -X POST http://127.0.0.1:8080/control/volume \
  -H "Content-Type: application/json" \
  -d '{"volume": 0.5}'

# Current status (position/duration is only valid during metadata playback)
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

#### WHIP Endpoint
Enable WHIP output from OBS, etc., and set the endpoint URL to `http://<host>:8080/whip`. SDP Offer/Answer will be automatically exchanged and connected to the internal player.

## Usage Examples

### Using from Browser Extension

1. **Casting Videos**
   - Click the "📺 Cast" button that appears on videos on web pages
   - Playback will automatically start on the server side
   - Playback time is automatically synchronized between the original video and the server side

2. **File Upload**
   - Open the extension popup
   - Select a file in the "File Upload" section of the "Control" tab
   - Click "Upload and Play"
   - After upload completes, playback will automatically start

3. **Screen Mirroring**
   - Click "Start Mirror" from the extension popup
   - Select screen sharing permission
   - Stream is sent to the server side via WHIP

### Using from Command Line

#### Playing YouTube Videos
```bash
curl -X POST http://127.0.0.1:8080/metadata \
  -H "Content-Type: application/json" \
  -d '{
    "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "start_time": 0
  }'
```

#### Uploading and Playing Local Files
```bash
# Upload video file
curl -X POST http://127.0.0.1:8080/upload \
  -F "file=@/path/to/video.mp4" \
  -F "start_time=0.0"

# Upload audio file
curl -X POST http://127.0.0.1:8080/upload \
  -F "file=@/path/to/audio.mp3" \
  -F "start_time=0.0"
```

#### Playback Control Examples
```bash
# Check status
curl http://127.0.0.1:8080/status

# Pause
curl -X POST http://127.0.0.1:8080/control/pause

# Resume playback
curl -X POST http://127.0.0.1:8080/control/play

# Seek to 30 seconds
curl -X POST http://127.0.0.1:8080/control/seek \
  -H "Content-Type: application/json" \
  -d '{"position": 30}'

# Set volume to 50%
curl -X POST http://127.0.0.1:8080/control/volume \
  -H "Content-Type: application/json" \
  -d '{"volume": 0.5}'

# Stop
curl -X POST http://127.0.0.1:8080/control/stop
```

### Usage Example from Python Script

```python
import requests

# Server URL
BASE_URL = "http://127.0.0.1:8080"

# Play YouTube video
response = requests.post(
    f"{BASE_URL}/metadata",
    json={
        "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "start_time": 0
    }
)
print(response.json())

# Upload file
with open("video.mp4", "rb") as f:
    files = {"file": f}
    data = {"start_time": "0.0"}
    response = requests.post(f"{BASE_URL}/upload", files=files, data=data)
    print(response.json())

# Check status
status = requests.get(f"{BASE_URL}/status").json()
print(f"Current playback position: {status.get('position')} seconds")
print(f"Title: {status.get('title')}")

# Seek
requests.post(
    f"{BASE_URL}/control/seek",
    json={"position": 60}
)

# Adjust volume
requests.post(
    f"{BASE_URL}/control/volume",
    json={"volume": 0.8}
)
```

### Using API Token

If an API token is configured in the server settings, add the `X-API-Token` header to all requests.

```bash
curl -X POST http://127.0.0.1:8080/metadata \
  -H "Content-Type: application/json" \
  -H "X-API-Token: your-api-token" \
  -d '{"source_url": "https://...", "start_time": 0}'
```

## License
This project follows the `LICENSE` file in the same root directory.
