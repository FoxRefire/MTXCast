from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path
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
    video_url: str | None = None  # For separated streams (video only)
    audio_url: str | None = None  # For separated streams (audio only)
    file_path: str | None = None  # Local file path (for sites requiring download like niconico)
    video_file_path: str | None = None  # Local file path for separated video stream
    audio_file_path: str | None = None  # Local file path for separated audio stream


class MetadataResolver:
    def __init__(self, yt_format: str = "best") -> None:
        self._yt_format = yt_format

    def _is_niconico(self, url: str) -> bool:
        """Check if URL is from niconico"""
        return "nicovideo.jp" in url or "nico.ms" in url

    def _download_to_temp_file(self, url: str, title: str | None = None) -> str:
        """Download video to temporary file using yt-dlp"""
        # Create temporary directory for downloads
        temp_dir = Path.home() / ".mtxcast" / "downloads"
        temp_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate filename from title or use default
        if title:
            # Sanitize filename
            safe_title = "".join(c for c in title if c.isalnum() or c in (' ', '-', '_')).strip()[:100]
            filename_template = f"{safe_title}.%(ext)s"
        else:
            filename_template = "video.%(ext)s"
        
        output_path = temp_dir / filename_template
        
        LOGGER.info("Downloading video to temporary file: %s", output_path)
        
        # For niconico and other sites that may not support "best" format,
        # don't specify format to let yt-dlp auto-select the best available format
        # This avoids "Requested format is not available" errors
        ydl_opts = {
            "quiet": True,
            "outtmpl": str(output_path),
            # Don't specify format - let yt-dlp choose the best available format
            # This is more reliable for sites like niconico
        }
        
        # Track files before download
        files_before = set(temp_dir.glob("*"))
        
        with YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        
        # Find the newly created file
        files_after = set(temp_dir.glob("*"))
        new_files = files_after - files_before
        
        LOGGER.debug("Files before download: %d, after: %d, new: %d", 
                    len(files_before), len(files_after), len(new_files))
        
        if new_files:
            # Get the most recently modified file (should be the downloaded one)
            downloaded_file = max(new_files, key=lambda p: p.stat().st_mtime)
            LOGGER.info("Downloaded file found: %s (size: %d bytes)", downloaded_file, downloaded_file.stat().st_size)
            return str(downloaded_file)
        
        # Fallback: try to find file matching the template pattern
        base_name = output_path.stem.split("%")[0] if "%" in output_path.name else output_path.stem
        for ext in [".mp4", ".webm", ".mkv", ".m4a", ".mp3", ".flv"]:
            candidate = temp_dir / f"{base_name}{ext}"
            if candidate.exists():
                LOGGER.info("Downloaded file (found by pattern): %s", candidate)
                return str(candidate)
        
        raise RuntimeError(f"Downloaded file not found in {temp_dir}")

    async def resolve(self, payload: MetadataPayload) -> ResolvedMedia:
        def _run() -> ResolvedMedia:
            url = str(payload.source_url)
            is_niconico = self._is_niconico(url)
            
            # For niconico, download to temporary file to avoid 403 errors
            if is_niconico:
                LOGGER.info("Detected niconico URL, downloading to temporary file")
                try:
                    # First extract info to get title
                    with YoutubeDL({"quiet": True}) as ydl:
                        info = ydl.extract_info(url, download=False)
                    
                    title = payload.title or info.get("title")
                    
                    # Download to temporary file
                    file_path = self._download_to_temp_file(url, title)
                    
                    LOGGER.info("Niconico video downloaded successfully: %s", file_path)
                    
                    return ResolvedMedia(
                        playback_url="",  # Not used when file_path is set
                        title=title,
                        start_time=payload.start_time or 0.0,
                        video_url=None,
                        audio_url=None,
                        file_path=file_path,
                    )
                except Exception as e:
                    LOGGER.error("Failed to download niconico video: %s", e)
                    raise RuntimeError(f"Failed to download niconico video: {e}")
            
            # Let yt-dlp automatically select the best format
            # If it selects separated streams (bestvideo+bestaudio), we'll handle them separately
            try:
                with YoutubeDL({"quiet": True}) as ydl:
                    info = ydl.extract_info(url, download=False)
                
                # Log extracted info for debugging
                LOGGER.debug("Extractor: %s", info.get("extractor") if info else None)
                LOGGER.debug("Format: %s", info.get("format") if info else None)
                LOGGER.debug("Format ID: %s", info.get("format_id") if info else None)
                
                # Check if we have separated streams (requested_formats)
                requested_formats = info.get("requested_formats", [])
                if requested_formats and len(requested_formats) >= 2:
                    # We have separated streams (video + audio)
                    LOGGER.info("Detected separated streams (video + audio)")
                    
                    video_format = None
                    audio_format = None
                    video_url = None
                    audio_url = None
                    
                    for fmt in requested_formats:
                        fmt_url = fmt.get("url") or fmt.get("manifest_url") or fmt.get("fragment_base_url")
                        if not fmt_url:
                            continue
                        
                        has_video = fmt.get("vcodec") != "none"
                        has_audio = fmt.get("acodec") != "none"
                        
                        if has_video and not has_audio:
                            video_format = fmt
                            video_url = fmt_url
                        elif has_audio and not has_video:
                            audio_format = fmt
                            audio_url = fmt_url
                    
                    if video_format and audio_format and video_url and audio_url:
                        LOGGER.info("Using separated streams - Video: %s, Audio: %s", 
                                   video_format.get("format_id"), audio_format.get("format_id"))
                        title = payload.title or info.get("title")
                        return ResolvedMedia(
                            playback_url="",  # Not used for separated streams
                            title=title,
                            start_time=payload.start_time or 0.0,
                            video_url=video_url,
                            audio_url=audio_url,
                            file_path=None,
                            video_file_path=None,
                            audio_file_path=None,
                        )
                    else:
                        LOGGER.warning("Could not find both video and audio in separated streams")
                
                # Single stream (video + audio combined) or fallback
                playback_url = (
                    info.get("url") or 
                    info.get("manifest_url") or 
                    info.get("fragment_base_url")
                )
                
                if not playback_url:
                    # Try to get URL from formats list if available
                    formats = info.get("formats", [])
                    if formats:
                        LOGGER.info("No direct URL, trying to find from formats list")
                        for fmt in formats:
                            fmt_url = fmt.get("url") or fmt.get("manifest_url") or fmt.get("fragment_base_url")
                            if fmt_url:
                                playback_url = fmt_url
                                LOGGER.info("Found URL in format %s", fmt.get("format_id"))
                                break
                
                if not playback_url:
                    LOGGER.error("No playback URL found. Available fields: %s", list(info.keys()) if info else None)
                    raise RuntimeError("No playable format found with direct URL")
                
                LOGGER.info("Using single stream URL: %s", playback_url[:100] if playback_url else None)
                title = payload.title or info.get("title")
                return ResolvedMedia(
                    playback_url=playback_url,
                    title=title,
                    start_time=payload.start_time or 0.0,
                    video_url=None,
                    audio_url=None,
                    file_path=None,
                    video_file_path=None,
                    audio_file_path=None,
                )
            except DownloadError as e:
                LOGGER.error("Failed to extract video info: %s", e)
                raise RuntimeError(f"Failed to extract video info: {e}")
            except Exception as e:
                LOGGER.error("Unexpected error during extraction: %s", e)
                raise RuntimeError(f"Unexpected error during extraction: {e}")

        return await asyncio.to_thread(_run)



