from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Optional

from pydantic import BaseModel, HttpUrl
from yt_dlp import YoutubeDL


class MetadataPayload(BaseModel):
    source_url: HttpUrl
    start_time: Optional[float] = 0.0
    duration: Optional[float] = None
    title: Optional[str] = None


@dataclass
class ResolvedMedia:
    playback_url: str
    title: str | None = None
    start_time: float = 0.0


class MetadataResolver:
    def __init__(self, yt_format: str = "best") -> None:
        self._yt_format = yt_format

    async def resolve(self, payload: MetadataPayload) -> ResolvedMedia:
        def _run() -> ResolvedMedia:
            with YoutubeDL({"quiet": True, "format": self._yt_format}) as ydl:
                info = ydl.extract_info(str(payload.source_url), download=False)
            playback_url = info.get("url") or str(payload.source_url)
            title = payload.title or info.get("title")
            return ResolvedMedia(
                playback_url=playback_url,
                title=title,
                start_time=payload.start_time or 0.0,
            )

        return await asyncio.to_thread(_run)

