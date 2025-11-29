# MTXCast CLI Client

A CLI client for controlling the MTXCast server from the command line.

## Installation

```bash
pip install -r requirements.txt
```

To make it executable (optional):
```bash
chmod +x mtxcast_cli.py
# or
python -m pip install --editable .
```

## Usage

### Basic Options

- `--server URL`: Specify server URL (default: `http://127.0.0.1:8080`)
- `--token TOKEN`: Specify API token (if configured on server)
- `--json`: Output results in JSON format

### Commands

#### Check Status

```bash
# Get current status
mtxcast-cli status

# Output in JSON format
mtxcast-cli --json status
```

#### Playback Control

```bash
# Play/resume
mtxcast-cli play

# Pause
mtxcast-cli pause

# Stop
mtxcast-cli stop
```

#### Seek and Volume

```bash
# Seek to 120 seconds
mtxcast-cli seek 120

# Set volume to 50%
mtxcast-cli volume 0.5
```

#### Play from URL

```bash
# Play YouTube video
mtxcast-cli play-url "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Start playback from 15 seconds
mtxcast-cli play-url "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --start-time 15
```

#### File Upload

```bash
# Upload and play video file
mtxcast-cli upload video.mp4

# Start playback from 30 seconds
mtxcast-cli upload video.mp4 --start-time 30
```

### Connecting to Remote Server

```bash
# Connect to remote server
mtxcast-cli --server http://192.168.1.100:8080 status

# Use API token
mtxcast-cli --server http://192.168.1.100:8080 --token your-api-token status
```

## Examples

```bash
# Check server status
mtxcast-cli status

# Play YouTube video
mtxcast-cli play-url "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Wait 60 seconds then pause
sleep 60
mtxcast-cli pause

# Seek to 120 seconds
mtxcast-cli seek 120

# Resume playback
mtxcast-cli play

# Set volume to 80%
mtxcast-cli volume 0.8

# Stop
mtxcast-cli stop
```

## Error Handling

If an error occurs, an error message and HTTP response will be displayed. Please check if the server is running, and if the URL and API token are correct.
