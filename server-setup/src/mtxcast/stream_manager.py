from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from enum import Enum, auto
from typing import Optional, Protocol

from aiortc import RTCPeerConnection
from aiortc.mediastreams import MediaStreamTrack

from .metadata import MetadataPayload, MetadataResolver

LOGGER = logging.getLogger(__name__)


@dataclass
class PlaybackMetrics:
    position: Optional[float] = None  # seconds
    duration: Optional[float] = None  # seconds
    is_seekable: bool = False


class PlayerTransport(Protocol):
    async def play_url(self, url: str, start_time: float = 0.0, title: str | None = None) -> None: ...

    async def attach_webrtc_track(self, track: MediaStreamTrack, pc: RTCPeerConnection) -> None: ...

    async def pause(self) -> None: ...

    async def resume(self) -> None: ...

    async def seek(self, position: float) -> None: ...

    async def set_volume(self, volume: float) -> None: ...

    async def get_metrics(self) -> PlaybackMetrics: ...

    async def stop(self) -> None: ...


class StreamType(Enum):
    IDLE = auto()
    METADATA = auto()
    WHIP = auto()


@dataclass
class PlayerStatus:
    stream_type: StreamType = StreamType.IDLE
    title: Optional[str] = None
    is_playing: bool = False
    volume: float = 1.0
    position: Optional[float] = None
    duration: Optional[float] = None
    is_seekable: bool = False


class StreamManager:
    def __init__(self, player: PlayerTransport, resolver: MetadataResolver) -> None:
        self._player = player
        self._resolver = resolver
        self._status = PlayerStatus()
        self._lock = asyncio.Lock()

    @property
    def status(self) -> PlayerStatus:
        return self._status

    async def handle_metadata(self, payload: MetadataPayload) -> PlayerStatus:
        async with self._lock:
            resolved = await self._resolver.resolve(payload)
            
            # If file_path is set (e.g., for niconico), use file playback
            # Note: We use _handle_file_impl here because we already hold the lock
            if resolved.file_path:
                LOGGER.info("Using downloaded file for playback: %s", resolved.file_path)
                try:
                    return await self._handle_file_impl(resolved.file_path, resolved.start_time, resolved.title)
                except Exception as e:
                    LOGGER.error("Error playing file %s: %s", resolved.file_path, e, exc_info=True)
                    raise
            
            # Check if we have separated streams
            if resolved.video_url and resolved.audio_url:
                await self._player.play_separated_streams(
                    resolved.video_url, 
                    resolved.audio_url, 
                    resolved.start_time, 
                    resolved.title
                )
            else:
                await self._player.play_url(resolved.playback_url, resolved.start_time, resolved.title)
            self._status = PlayerStatus(
                stream_type=StreamType.METADATA,
                title=resolved.title,
                is_playing=True,
                volume=self._status.volume,
                position=resolved.start_time,
                duration=None,
                is_seekable=True,
            )
            return self._status

    async def handle_whip_track(self, track: MediaStreamTrack, pc: RTCPeerConnection, title: str | None = None) -> PlayerStatus:
        async with self._lock:
            LOGGER.info("Attaching WHIP track to player")
            await self._player.attach_webrtc_track(track, pc)
            LOGGER.info("WHIP track attached successfully")
            self._status = PlayerStatus(
                stream_type=StreamType.WHIP,
                title=title or "Live WHIP Stream",
                is_playing=True,
                volume=self._status.volume,
                position=None,
                duration=None,
                is_seekable=False,
            )
            return self._status

    async def handle_file(self, file_path: str, start_time: float = 0.0, title: str | None = None) -> PlayerStatus:
        """Handle file playback with lock management"""
        async with self._lock:
            return await self._handle_file_impl(file_path, start_time, title)
    
    async def _handle_file_impl(self, file_path: str, start_time: float = 0.0, title: str | None = None) -> PlayerStatus:
        """Internal implementation of file playback (assumes lock is already held)"""
        from pathlib import Path
        
        LOGGER.info("handle_file called with path: %s", file_path)
        
        # Check file existence
        path = Path(file_path)
        if not path.exists():
            abs_path = path.absolute()
            LOGGER.error("File not found: %s (absolute: %s)", file_path, abs_path)
            raise FileNotFoundError(f"File not found: {file_path}")
        
        LOGGER.info("File exists: %s (size: %d bytes)", file_path, path.stat().st_size)
        
        # Use filename as title if not provided
        if not title:
            title = path.name
        
        # Convert file path to file:// URL for QMediaPlayer
        # Use fromLocalFile for better Unicode support
        from PySide6.QtCore import QUrl
        file_url = QUrl.fromLocalFile(str(path.absolute())).toString()
        
        LOGGER.info("Playing file: %s (start_time: %.2f, title: %s)", file_url, start_time, title)
        
        try:
            await self._player.play_url(file_url, start_time, title)
            LOGGER.info("play_url completed successfully")
        except Exception as e:
            LOGGER.error("Error in play_url: %s", e, exc_info=True)
            raise
        
        self._status = PlayerStatus(
            stream_type=StreamType.METADATA,
            title=title,
            is_playing=True,
            volume=self._status.volume,
            position=start_time,
            duration=None,
            is_seekable=True,
        )
        return self._status

    async def pause(self) -> PlayerStatus:
        async with self._lock:
            await self._player.pause()
            self._status.is_playing = False
            return self._status

    async def resume(self) -> PlayerStatus:
        async with self._lock:
            await self._player.resume()
            self._status.is_playing = True
            return self._status

    async def seek(self, position: float) -> PlayerStatus:
        async with self._lock:
            await self._player.seek(position)
            return self._status

    async def set_volume(self, volume: float) -> PlayerStatus:
        async with self._lock:
            await self._player.set_volume(volume)
            self._status.volume = volume
            return self._status

    async def current_status(self) -> PlayerStatus:
        async with self._lock:
            metrics = await self._player.get_metrics()
            self._status.position = metrics.position
            self._status.duration = metrics.duration
            self._status.is_seekable = metrics.is_seekable
            return self._status

    async def stop(self) -> PlayerStatus:
        async with self._lock:
            await self._player.stop()
            volume = self._status.volume
            self._status = PlayerStatus(
                stream_type=StreamType.IDLE,
                title=None,
                is_playing=False,
                volume=volume,
                position=None,
                duration=None,
                is_seekable=False,
            )
            return self._status



