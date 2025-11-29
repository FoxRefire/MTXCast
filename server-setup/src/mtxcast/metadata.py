from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Optional

from pydantic import BaseModel, HttpUrl
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

LOGGER = logging.getLogger(__name__)


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
            url = str(payload.source_url)
            info = None
            
            # Helper function to extract info and validate URL
            def _try_extract(opts: dict) -> dict | None:
                try:
                    with YoutubeDL(opts) as ydl:
                        extracted_info = ydl.extract_info(url, download=False)
                    # Check if we got a valid URL (QMediaPlayer needs a direct URL, not merged streams)
                    if extracted_info.get("url"):
                        return extracted_info
                    return None
                except DownloadError:
                    return None
            
            # Try with the specified format first
            info = _try_extract({"quiet": True, "format": self._yt_format})
            
            if info is None:
                # If the requested format is not available, try with single-stream formats
                # QMediaPlayer can't handle merged streams (bestvideo+bestaudio/best)
                LOGGER.warning(
                    "Requested format '%s' not available or no direct URL for %s, trying fallback formats",
                    self._yt_format,
                    url
                )
                
                # Try single-stream formats that return direct URLs
                fallback_formats = ["best", "worst"]
                for fallback_format in fallback_formats:
                    info = _try_extract({"quiet": True, "format": fallback_format})
                    if info:
                        LOGGER.info("Successfully extracted info using format: %s", fallback_format)
                        break
                
                # If still no URL, try to find a playable format from available formats list
                if not info or not info.get("url"):
                    # Get format list without specifying format
                    try:
                        with YoutubeDL({"quiet": True}) as ydl:
                            format_list_info = ydl.extract_info(url, download=False)
                        
                        formats = format_list_info.get("formats", [])
                        if formats:
                            # Prefer formats with both video and audio
                            for fmt in formats:
                                if fmt.get("url") and fmt.get("vcodec") != "none" and fmt.get("acodec") != "none":
                                    format_id = fmt.get("format_id")
                                    LOGGER.info("Trying format ID with video+audio: %s", format_id)
                                    info = _try_extract({"quiet": True, "format": format_id})
                                    if info:
                                        break
                            
                            # If no video+audio format found, try any format with a URL
                            if not info or not info.get("url"):
                                for fmt in formats:
                                    if fmt.get("url"):
                                        format_id = fmt.get("format_id")
                                        LOGGER.info("Trying format ID as fallback: %s", format_id)
                                        info = _try_extract({"quiet": True, "format": format_id})
                                        if info:
                                            break
                    except DownloadError as e:
                        LOGGER.error("Failed to get format list: %s", e)
            
            if info is None or not info.get("url"):
                raise RuntimeError("No playable format found with direct URL")
            
            playback_url = info.get("url")
            title = payload.title or info.get("title")
            return ResolvedMedia(
                playback_url=playback_url,
                title=title,
                start_time=payload.start_time or 0.0,
            )

        return await asyncio.to_thread(_run)



