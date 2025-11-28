from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import Body, Depends, FastAPI, File, Form, Header, HTTPException, Request, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from .config import ServerConfig
from .metadata import MetadataPayload
from .stream_manager import StreamManager
from .webrtc import WhipEndpoint

LOGGER = logging.getLogger(__name__)


def _token_dependency(expected: str | None):
    async def _verify(x_api_token: Annotated[str | None, Header(alias="X-API-Token")] = None) -> None:
        if expected and x_api_token != expected:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API token")

    return _verify


def build_api(manager: StreamManager, whip: WhipEndpoint, config: ServerConfig) -> FastAPI:
    app = FastAPI(title="MTXCast", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    token_dep = Depends(_token_dependency(config.api_token))

    @app.post(config.metadata_endpoint, dependencies=[token_dep])
    async def post_metadata(payload: MetadataPayload) -> dict:
        status_state = await manager.handle_metadata(payload)
        return {
            "stream_type": status_state.stream_type.name,
            "title": status_state.title,
            "is_playing": status_state.is_playing,
        }

    @app.post(config.whip_endpoint, response_class=PlainTextResponse, dependencies=[token_dep])
    async def post_whip_offer(
        request: Request,
        body: Annotated[str, Body(media_type="application/sdp")],
        x_client: Annotated[str | None, Header(alias="X-Client", convert_underscores=False)] = None,
    ) -> Response:
        LOGGER.info("WHIP offer received from %s", x_client or "unknown client")
        answer_sdp, resource_id = await whip.handle_offer(body, client_info=x_client)
        
        # Build resource URL
        base_url = str(request.base_url).rstrip("/")
        resource_url = f"{base_url}{config.whip_endpoint}/{resource_id}"
        
        return Response(
            content=answer_sdp,
            media_type="application/sdp",
            status_code=status.HTTP_201_CREATED,
            headers={
                "Location": resource_url,
                "Allow": "DELETE",
            },
        )

    @app.delete(f"{config.whip_endpoint}/{{resource_id}}", dependencies=[token_dep])
    async def delete_whip_resource(resource_id: str) -> Response:
        await whip.delete_resource(resource_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/status", dependencies=[token_dep])
    async def get_status() -> dict:
        state = await manager.current_status()
        return {
            "stream_type": state.stream_type.name,
            "title": state.title,
            "is_playing": state.is_playing,
            "volume": state.volume,
            "position": state.position,
            "duration": state.duration,
            "is_seekable": state.is_seekable,
        }

    @app.post(f"{config.control_endpoint}/play", dependencies=[token_dep])
    async def control_play() -> dict:
        state = await manager.resume()
        return {"is_playing": state.is_playing}

    @app.post(f"{config.control_endpoint}/pause", dependencies=[token_dep])
    async def control_pause() -> dict:
        state = await manager.pause()
        return {"is_playing": state.is_playing}

    @app.post(f"{config.control_endpoint}/seek", dependencies=[token_dep])
    async def control_seek(payload: dict = Body(...)) -> dict:
        position = float(payload.get("position", 0.0))
        state = await manager.seek(position)
        return {"position": position, "stream_type": state.stream_type.name}

    @app.post(f"{config.control_endpoint}/volume", dependencies=[token_dep])
    async def control_volume(payload: dict = Body(...)) -> dict:
        volume = float(payload.get("volume", 1.0))
        volume = max(0.0, min(volume, 1.0))
        state = await manager.set_volume(volume)
        return {"volume": state.volume}

    @app.post(f"{config.control_endpoint}/stop", dependencies=[token_dep])
    async def control_stop() -> dict:
        state = await manager.stop()
        return {
            "stream_type": state.stream_type.name,
            "is_playing": state.is_playing,
        }

    @app.post("/upload", dependencies=[token_dep])
    async def upload_file(
        file: UploadFile = File(...),
        start_time: Annotated[float, Form()] = 0.0,
    ) -> dict:
        """Upload and play a media file"""
        # Validate file type
        content_type = file.content_type or ""
        if not any(content_type.startswith(prefix) for prefix in ["video/", "audio/"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported file type: {content_type}. Only video and audio files are supported."
            )
        
        # Create temporary directory for uploaded files
        temp_dir = Path.home() / ".mtxcast" / "uploads"
        temp_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate unique filename
        file_extension = Path(file.filename or "file").suffix
        temp_file = tempfile.NamedTemporaryFile(
            delete=False,
            suffix=file_extension,
            dir=temp_dir
        )
        
        try:
            # Save uploaded file
            content = await file.read()
            temp_file.write(content)
            temp_file.close()
            
            file_path = Path(temp_file.name)
            LOGGER.info(f"File uploaded: {file_path} ({len(content)} bytes)")
            
            # Play the file
            state = await manager.handle_file(str(file_path), start_time, file.filename)
            
            return {
                "stream_type": state.stream_type.name,
                "title": state.title,
                "is_playing": state.is_playing,
                "file_path": str(file_path),
            }
        except Exception as e:
            # Clean up on error
            if file_path.exists():
                file_path.unlink()
            LOGGER.error(f"Error processing uploaded file: {e}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to process file: {str(e)}"
            )

    return app



