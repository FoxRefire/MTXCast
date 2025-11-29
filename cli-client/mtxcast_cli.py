#!/usr/bin/env python3
"""
MTXCast CLI Client
Command-line interface for controlling MTXCast server
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

import requests
from requests.exceptions import RequestException


class MTXCastClient:
    """Client for interacting with MTXCast server"""

    def __init__(self, base_url: str, api_token: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.headers = {}
        if api_token:
            self.headers["X-API-Token"] = api_token

    def _request(self, method: str, endpoint: str, **kwargs) -> dict:
        """Make HTTP request to server"""
        url = f"{self.base_url}{endpoint}"
        try:
            response = requests.request(method, url, headers=self.headers, **kwargs)
            response.raise_for_status()
            if response.content:
                return response.json()
            return {}
        except RequestException as e:
            print(f"Error: {e}", file=sys.stderr)
            if hasattr(e.response, "text"):
                print(f"Response: {e.response.text}", file=sys.stderr)
            sys.exit(1)

    def get_status(self) -> dict:
        """Get current server status"""
        return self._request("GET", "/status")

    def play(self) -> dict:
        """Start/resume playback"""
        return self._request("POST", "/control/play")

    def pause(self) -> dict:
        """Pause playback"""
        return self._request("POST", "/control/pause")

    def stop(self) -> dict:
        """Stop playback"""
        return self._request("POST", "/control/stop")

    def seek(self, position: float) -> dict:
        """Seek to position (in seconds)"""
        return self._request("POST", "/control/seek", json={"position": position})

    def set_volume(self, volume: float) -> dict:
        """Set volume (0.0 to 1.0)"""
        volume = max(0.0, min(1.0, volume))
        return self._request("POST", "/control/volume", json={"volume": volume})

    def play_metadata(self, source_url: str, start_time: float = 0.0) -> dict:
        """Play media from URL using metadata"""
        return self._request(
            "POST",
            "/metadata",
            json={"source_url": source_url, "start_time": start_time},
        )

    def upload_file(self, file_path: str, start_time: float = 0.0) -> dict:
        """Upload and play a media file"""
        path = Path(file_path)
        if not path.exists():
            print(f"Error: File not found: {file_path}", file=sys.stderr)
            sys.exit(1)

        with open(path, "rb") as f:
            files = {"file": (path.name, f, "application/octet-stream")}
            data = {"start_time": str(start_time)}
            return self._request("POST", "/upload", files=files, data=data)


def format_status(status: dict) -> str:
    """Format status output for display"""
    lines = []
    lines.append(f"Stream Type: {status.get('stream_type', 'N/A')}")
    lines.append(f"Title: {status.get('title', 'N/A')}")
    lines.append(f"Playing: {status.get('is_playing', False)}")
    lines.append(f"Volume: {status.get('volume', 0.0):.1%}")

    if status.get("position") is not None:
        position = status.get("position", 0.0)
        duration = status.get("duration", 0.0)
        seekable = status.get("is_seekable", False)
        lines.append(f"Position: {position:.1f}s / {duration:.1f}s")
        lines.append(f"Seekable: {seekable}")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="MTXCast CLI Client - Control MTXCast server from command line",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Get server status
  mtxcast-cli status

  # Play YouTube video
  mtxcast-cli play-url "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

  # Upload and play local file
  mtxcast-cli upload video.mp4

  # Control playback
  mtxcast-cli play
  mtxcast-cli pause
  mtxcast-cli seek 120
  mtxcast-cli volume 0.5
  mtxcast-cli stop
        """,
    )

    parser.add_argument(
        "--server",
        default="http://127.0.0.1:8080",
        help="Server URL (default: http://127.0.0.1:8080)",
    )
    parser.add_argument(
        "--token",
        help="API token (if required by server)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output results as JSON",
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to execute")

    # Status command
    subparsers.add_parser("status", help="Get server status")

    # Playback control commands
    subparsers.add_parser("play", help="Start/resume playback")
    subparsers.add_parser("pause", help="Pause playback")
    subparsers.add_parser("stop", help="Stop playback")

    # Seek command
    seek_parser = subparsers.add_parser("seek", help="Seek to position (seconds)")
    seek_parser.add_argument("position", type=float, help="Position in seconds")

    # Volume command
    volume_parser = subparsers.add_parser("volume", help="Set volume (0.0 to 1.0)")
    volume_parser.add_argument("volume", type=float, help="Volume level (0.0 to 1.0)")

    # Play URL command
    url_parser = subparsers.add_parser("play-url", help="Play media from URL")
    url_parser.add_argument("url", help="Media URL (e.g., YouTube URL)")
    url_parser.add_argument(
        "--start-time",
        type=float,
        default=0.0,
        help="Start time in seconds (default: 0.0)",
    )

    # Upload command
    upload_parser = subparsers.add_parser("upload", help="Upload and play media file")
    upload_parser.add_argument("file", help="Path to media file")
    upload_parser.add_argument(
        "--start-time",
        type=float,
        default=0.0,
        help="Start time in seconds (default: 0.0)",
    )

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    client = MTXCastClient(args.server, args.token)

    try:
        if args.command == "status":
            result = client.get_status()
            if args.json:
                print(json.dumps(result, indent=2))
            else:
                print(format_status(result))

        elif args.command == "play":
            result = client.play()
            if args.json:
                print(json.dumps(result, indent=2))
            else:
                print(f"Playing: {result.get('is_playing', False)}")

        elif args.command == "pause":
            result = client.pause()
            if args.json:
                print(json.dumps(result, indent=2))
            else:
                print(f"Playing: {result.get('is_playing', False)}")

        elif args.command == "stop":
            result = client.stop()
            if args.json:
                print(json.dumps(result, indent=2))
            else:
                print(f"Stream Type: {result.get('stream_type', 'N/A')}")
                print(f"Playing: {result.get('is_playing', False)}")

        elif args.command == "seek":
            result = client.seek(args.position)
            if args.json:
                print(json.dumps(result, indent=2))
            else:
                print(f"Seeked to {args.position}s")

        elif args.command == "volume":
            result = client.set_volume(args.volume)
            if args.json:
                print(json.dumps(result, indent=2))
            else:
                print(f"Volume set to {result.get('volume', 0.0):.1%}")

        elif args.command == "play-url":
            result = client.play_metadata(args.url, args.start_time)
            if args.json:
                print(json.dumps(result, indent=2))
            else:
                print(f"Stream Type: {result.get('stream_type', 'N/A')}")
                print(f"Title: {result.get('title', 'N/A')}")
                print(f"Playing: {result.get('is_playing', False)}")

        elif args.command == "upload":
            result = client.upload_file(args.file, args.start_time)
            if args.json:
                print(json.dumps(result, indent=2))
            else:
                print(f"Stream Type: {result.get('stream_type', 'N/A')}")
                print(f"Title: {result.get('title', 'N/A')}")
                print(f"Playing: {result.get('is_playing', False)}")
                print(f"File: {result.get('file_path', 'N/A')}")

    except KeyboardInterrupt:
        print("\nInterrupted by user", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
