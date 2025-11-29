# MTXCast

MTXCast is an integrated cast server that performs full-screen playback using a custom PySide6 player, receiving video/audio directly via WHIP (WebRTC-HTTP ingestion protocol) from broadcasting tools like OBS, or metadata (URL/playback time, etc.) via HTTP API.

## Project Structure

- **`server-setup/`**: MTXCast server (Python/FastAPI)
- **`browser-extension/`**: Browser extension (Chrome/Firefox compatible)
- **`cli-client/`**: Command-line client (Python)
- **`android-app/`**: Android app (Kotlin)

## Quick Start

### Starting the Server

```bash
cd server-setup
pip install -r requirements.txt
python -m mtxcast.app
```

For details, see [`server-setup/README.md`](server-setup/README.md).

### Using the CLI Client

```bash
cd cli-client
pip install -r requirements.txt

# Check status
python mtxcast_cli.py status

# Play YouTube video
python mtxcast_cli.py play-url "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Playback control
python mtxcast_cli.py play
python mtxcast_cli.py pause
python mtxcast_cli.py seek 120
python mtxcast_cli.py volume 0.5
```

For details, see [`cli-client/README.md`](cli-client/README.md).

### Using the Android App

1. Open `android-app/` in Android Studio
2. Build and install on device
3. Launch the app and enter the server URL in the settings screen
4. Control the server from the main screen

For details, see [`android-app/README.md`](android-app/README.md).

### Using the Browser Extension

1. Load the extension in Chrome or Firefox
2. A "📺 Cast" button will appear on videos on web pages
3. Click the button to cast to the server

## Main Features

### Server Features

- FastAPI-based HTTP+WHIP endpoints
- On-demand stream resolution and instant playback using yt-dlp
- Video/audio file upload and playback
- Remote control API for play/pause/seek/volume adjustment, etc.
- Built-in player using PySide6 + QtMultimedia
- System tray resident

### Client Features

#### CLI Client

- Full feature control from command line
- JSON format output support
- Remote server connection support

#### Android App

- Real-time status display
- Intuitive UI operations
- File upload functionality
- Media playback from URL

#### Browser Extension

- Cast videos on web pages
- Screen mirroring
- File upload

## API Endpoints

- `POST /whip`: Receive SDP Offer from WHIP client
- `POST /metadata`: Start playback with metadata
- `POST /upload`: Upload video/audio file and start playback
- `POST /control/play` / `pause` / `stop` / `seek` / `volume`: Playback control
- `GET /status`: Get current status

For details, see [`server-setup/README.md`](server-setup/README.md).

## License

This project follows the `LICENSE` file.
