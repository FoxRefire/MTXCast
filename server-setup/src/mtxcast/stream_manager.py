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

