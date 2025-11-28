from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Optional, Tuple

from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc import rtcdtlstransport
from aiortc.contrib.media import MediaBlackhole
from fastapi import HTTPException
from cryptography.x509.base import InvalidVersion

from .stream_manager import StreamManager

LOGGER = logging.getLogger(__name__)


# Some WHIP clients (e.g., certain OBS builds) emit DTLS certificates with a non-standard
# version number, causing cryptography.x509 to raise InvalidVersion. We patch the aiortc
# validator to log and continue instead of aborting the session.
_ORIGINAL_VALIDATE = rtcdtlstransport.RTCDtlsTransport._validate_peer_identity


def _safe_validate_peer_identity(self, remote_parameters):
    try:
        return _ORIGINAL_VALIDATE(self, remote_parameters)
    except InvalidVersion as exc:  # pragma: no cover - defensive
        LOGGER.warning("Skipping peer certificate validation due to invalid version: %s", exc)


rtcdtlstransport.RTCDtlsTransport._validate_peer_identity = _safe_validate_peer_identity


class WhipEndpoint:
    def __init__(self, manager: StreamManager) -> None:
        self._manager = manager
        self._pcs: dict[str, RTCPeerConnection] = {}
        self._cleanup_lock = asyncio.Lock()

    async def handle_offer(self, sdp_offer: str, client_info: Optional[str] = None) -> Tuple[str, str]:
        """
        Returns (answer_sdp, resource_id)
        """
        resource_id = str(uuid.uuid4())
        pc = RTCPeerConnection()
        self._pcs[resource_id] = pc
        media_blackhole = MediaBlackhole()

        @pc.on("iceconnectionstatechange")
        async def on_state_change() -> None:
            state = pc.iceConnectionState
            LOGGER.info("WHIP peer %s ICE state=%s", client_info or resource_id, state)
            if state == "connected":
                LOGGER.info("WHIP peer %s connected successfully", client_info or resource_id)
            elif state in {"failed", "closed", "disconnected"}:
                LOGGER.warning("WHIP peer %s disconnected (state=%s)", client_info or resource_id, state)
                await self._cleanup_peer(resource_id)

        @pc.on("track")
        async def on_track(track) -> None:  # type: ignore[no-redef]
            LOGGER.info(
                "WHIP track received kind=%s, id=%s",
                getattr(track, "kind", "unknown"),
                getattr(track, "id", "n/a"),
            )
            if track.kind == "video":
                LOGGER.info("Processing video track")
                await self._manager.handle_whip_track(track, pc)
            else:
                LOGGER.info("Consuming audio track")
                # Consume audio to keep peer alive even if we do not render it yet.
                media_blackhole.addTrack(track)

        try:
            offer = RTCSessionDescription(sdp=sdp_offer, type="offer")
            await pc.setRemoteDescription(offer)
            answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
        except Exception as exc:  # pragma: no cover - defensive
            await self._cleanup_peer(resource_id)
            LOGGER.exception("Failed to process WHIP offer: %s", exc)
            raise HTTPException(status_code=500, detail="Failed to negotiate WHIP session") from exc

        assert pc.localDescription is not None
        return pc.localDescription.sdp, resource_id

    async def delete_resource(self, resource_id: str) -> None:
        await self._cleanup_peer(resource_id)

    async def _cleanup_peer(self, resource_id: str) -> None:
        async with self._cleanup_lock:
            pc = self._pcs.pop(resource_id, None)
            if pc:
                await pc.close()



