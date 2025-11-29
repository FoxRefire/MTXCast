# MTXCast Android Client

An Android application for controlling the MTXCast server from Android devices.

## Features

- Server status display (real-time updates)
- Playback control (play/pause/stop)
- Volume adjustment
- Seek functionality
- Media playback from URL (YouTube, etc.)
- File upload and playback
- Server settings (URL, API token)

## Building

### Prerequisites

- Android Studio Hedgehog (2023.1.1) or later
- JDK 8 or later
- Android SDK 24 or later

### Build Steps

1. Open the project in Android Studio
2. Execute `File > Sync Project with Gradle Files`
3. Build with `Build > Make Project`
4. Run on device or emulator

### Build with Gradle Command

```bash
cd android-app
./gradlew assembleDebug
```

The APK file will be generated at `app/build/outputs/apk/debug/app-debug.apk`.

## Usage

### Initial Setup

1. Launch the app
2. Select "Settings" from the menu
3. Enter the server URL (e.g., `http://192.168.1.100:8080`)
4. Enter API token if configured (optional)
5. Tap "Save"

### Basic Operations

- **Status**: Current stream information is displayed at the top of the screen (auto-updates every 2 seconds)
- **Playback Control**: Control with Play/Pause/Stop buttons
- **Volume**: Adjust volume with slider (0-100%)
- **Seek**: Specify position and seek with "Seek" button
- **URL Playback**: Enter URL with "Play URL" button to play
- **File Upload**: Select file with "Upload File" button to upload

### Screen Mirroring (MediaProjection + WHIP)

1. Register the server URL and API token (if needed) in the settings screen. The WHIP endpoint is fixed at `http(s)://<server>/whip`.
2. On the main screen, verify that the endpoint display in the "Screen Mirroring" card at the bottom is correct.
3. Tap "Start Mirroring" and select "Start now" in Android's screen capture permission dialog.
4. The screen video captured via MediaProjection is sent to the WHIP endpoint via WebRTC and mirrored to the server-side player.
5. To stop, tap the same button which will have changed to "Stop Mirroring". WHIP resources are automatically deleted when the session ends.

> **Note**: Mirroring only works while the app is running. It does not run in the background or display notifications, so please be careful not to let the screen sleep during long streaming sessions.

## Notes

- The server and Android device must be connected to the same network
- HTTP communication is used; if HTTPS is required, configure it on the server side
- File upload may take time for large files

## Troubleshooting

### Connection Errors

1. Check if the server is running
2. Verify the server URL is correct (must start with `http://` or `https://`)
3. Check firewall settings
4. Verify connection to the same network

### API Token Errors

1. Check if API token is configured on the server side
2. Verify the API token is correctly entered in the settings screen

## License

This project follows the `LICENSE` file in the same root directory.
